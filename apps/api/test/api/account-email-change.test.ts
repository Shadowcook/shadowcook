import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test, type TestContext } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import nodemailer from 'nodemailer';
import type { QueryResult } from 'pg';
import type { EmailChangeStatus } from '../../src/account/email-change.js';
import type { EmailChangeVerification } from '../../src/account/email-change-verification.js';
import { hashSessionToken } from '../../src/auth/session.js';
import { createPasswordResetToken } from '../../src/auth/password-reset.js';
import { requestEmailCode } from '../../src/auth/email-code.js';
import { createTestApi } from '../helpers/api.js';
import { assignTenantRole, createTestUser, type TestUser } from '../helpers/actors.js';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from '../helpers/disposable-postgres.js';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

interface MailCapture {
  messages: Mail[];
  fail: boolean;
}

let database: DisposablePostgresDatabase;
let api: FastifyInstance;

before(async (): Promise<void> => {
  database = await createDisposablePostgresDatabase();
  api = createTestApi(database.pool);
  await api.ready();
  const administrator: TestUser = await createTestUser(database.pool, {
    email: 'email-mail-admin@example.test',
  });
  await database.pool.query(
    `INSERT INTO instance_mail_settings
     (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id)
     VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', $1)`,
    [administrator.principalId],
  );
});

after(async (): Promise<void> => {
  if (api !== undefined) await api.close();
  if (database !== undefined) await database.close();
});

function captureMail(context: TestContext): MailCapture {
  const capture: MailCapture = { messages: [], fail: false };
  context.mock.method(nodemailer, 'createTransport', (): object => ({
    sendMail: async (mail: Mail): Promise<void> => {
      if (capture.fail) throw new Error('Simulated SMTP failure');
      capture.messages.push(mail);
    },
  }));
  return capture;
}

function latestToken(capture: MailCapture): string {
  const token: string | undefined = capture.messages
    .at(-1)
    ?.text.match(/\/settings\/email\/verify\/([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token);
  return token;
}

async function loginCookie(user: TestUser): Promise<string> {
  const response: LightMyRequestResponse = await api.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  assert.equal(response.statusCode, 200);
  const cookie: string | string[] | undefined = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return cookie as string;
}

async function send(cookie: string, email: string): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/account/email-change',
    headers: { cookie },
    payload: { email },
  });
}

async function resend(cookie: string): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/account/email-change/resend',
    headers: { cookie },
    payload: {},
  });
}

async function verify(token: string, cookie?: string): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/account/email-change/verify',
    headers: cookie === undefined ? {} : { cookie },
    payload: { token },
  });
}

async function verificationDetails(
  token: string,
  cookie?: string,
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/account/email-change/verification',
    headers: cookie === undefined ? {} : { cookie },
    payload: { token },
  });
}

async function allowNextSend(userId: string): Promise<void> {
  await database.pool.query(
    "UPDATE account_email_change SET last_sent_at = now() - interval '2 hours' WHERE user_account_id = $1",
    [userId],
  );
}

test('email change requires authentication and validates addresses without sending mail', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  for (const url of ['/account/email-change', '/account/email-change/resend']) {
    const response: LightMyRequestResponse = await api.inject({ method: 'POST', url, payload: {} });
    assert.equal(response.statusCode, 401);
  }
  assert.equal((await api.inject({ method: 'GET', url: '/account/email-change' })).statusCode, 401);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-validation@example.test',
  });
  const cookie: string = await loginCookie(user);
  const existing: TestUser = await createTestUser(database.pool, {
    email: 'email-taken@example.test',
  });
  for (const email of ['', 'invalid', 'a@b', 'x'.repeat(255) + '@example.test']) {
    const response: LightMyRequestResponse = await send(cookie, email);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ code: string }>().code, 'INVALID_EMAIL');
  }
  assert.equal((await send(cookie, user.email)).json<{ code: string }>().code, 'EMAIL_UNCHANGED');
  assert.equal((await send(cookie, existing.email)).statusCode, 409);
  assert.equal((await resend(cookie)).json<{ code: string }>().code, 'NO_PENDING_EMAIL_CHANGE');
  assert.equal(capture.messages.length, 0);
});

test('confirmation atomically changes email, preserves identity and memberships, and consumes old recovery credentials', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-confirm-old@example.test',
  });
  await assignTenantRole(database.pool, user.principalId, 'email-change-cookbook');
  const cookie: string = await loginCookie(user);
  await createPasswordResetToken(database.pool, user.userId, false);
  await requestEmailCode(database.pool, user.email, 'LOGIN', null);
  const response: LightMyRequestResponse = await send(cookie, '  EMAIL-CONFIRM-NEW@example.test  ');
  assert.equal(response.statusCode, 202);
  const status: EmailChangeStatus = response.json<EmailChangeStatus>();
  assert.equal(status.email, user.email);
  assert.equal(status.pending?.email, 'email-confirm-new@example.test');
  assert.equal(Date.parse(status.pending!.expiresAt) - Date.parse(status.serverTime), 86400000);
  assert.equal(Date.parse(status.nextResendAt!) - Date.parse(status.serverTime), 60000);
  assert.equal(capture.messages[0]?.to, status.pending?.email);
  assert.match(capture.messages[0]!.text, /Hello Test user/);
  assert.match(capture.messages[0]!.text, /24 hours/);
  const token: string = latestToken(capture);
  const stored: QueryResult<{ token_hash: Buffer }> = await database.pool.query(
    'SELECT token_hash FROM account_email_change WHERE user_account_id = $1',
    [user.userId],
  );
  assert.deepEqual(stored.rows[0]?.token_hash, createHash('sha256').update(token).digest());
  const beforeConfirmation: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie },
  });
  assert.equal(beforeConfirmation.json<{ email: string }>().email, user.email);
  const confirmations: LightMyRequestResponse[] = await Promise.all([
    verify(token, cookie),
    verify(token, cookie),
  ]);
  assert.deepEqual(
    confirmations.map((result: LightMyRequestResponse): number => result.statusCode).sort(),
    [204, 400],
  );
  const account: QueryResult<{ principal_id: string; email: string }> = await database.pool.query(
    'SELECT principal_id, email FROM user_account WHERE id = $1',
    [user.userId],
  );
  assert.deepEqual(account.rows[0], {
    principal_id: user.principalId,
    email: status.pending?.email,
  });
  const membership: QueryResult<{ count: number }> = await database.pool.query(
    'SELECT count(*)::integer AS count FROM tenant_membership WHERE principal_id = $1',
    [user.principalId],
  );
  assert.equal(membership.rows[0]?.count, 1);
  const remaining: QueryResult<{ pending: number; resets: number; codes: number }> =
    await database.pool.query(
      `SELECT (SELECT count(*)::integer FROM account_email_change WHERE user_account_id = $1) AS pending,
      (SELECT count(*)::integer FROM password_reset_token WHERE user_account_id = $1 AND consumed_at IS NULL) AS resets,
      (SELECT count(*)::integer FROM email_one_time_code WHERE normalized_email = $2 AND consumed_at IS NULL) AS codes`,
      [user.userId, user.email],
    );
  assert.deepEqual(remaining.rows[0], { pending: 0, resets: 0, codes: 0 });
  const session: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie },
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json<{ email: string }>().email, status.pending?.email);
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password: user.password },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await api.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: status.pending?.email, password: user.password },
      })
    ).statusCode,
    200,
  );
});

test('resends enforce increasing waits, prevent address-based bypasses, and invalidate older links', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-resend@example.test',
  });
  const cookie: string = await loginCookie(user);
  assert.equal((await send(cookie, 'email-resend-target@example.test')).statusCode, 202);
  let previousToken: string = latestToken(capture);
  for (const cooldownSeconds of [180, 600, 1800, 3600, 3600]) {
    const blocked: LightMyRequestResponse = await resend(cookie);
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers['retry-after']) >= 1);
    assert.equal((await send(cookie, 'email-resend-other@example.test')).statusCode, 429);
    await allowNextSend(user.userId);
    const response: LightMyRequestResponse = await resend(cookie);
    assert.equal(response.statusCode, 202);
    const status: EmailChangeStatus = response.json<EmailChangeStatus>();
    assert.equal(
      Date.parse(status.nextResendAt!) - Date.parse(status.serverTime),
      cooldownSeconds * 1000,
    );
    assert.equal(Date.parse(status.pending!.expiresAt) - Date.parse(status.serverTime), 86400000);
    assert.equal((await verify(previousToken, cookie)).statusCode, 400);
    previousToken = latestToken(capture);
  }
  await allowNextSend(user.userId);
  const concurrent: LightMyRequestResponse[] = await Promise.all([resend(cookie), resend(cookie)]);
  assert.deepEqual(
    concurrent.map((response: LightMyRequestResponse): number => response.statusCode).sort(),
    [202, 429],
  );
});

test('a new target replaces the pending address without resetting its wait progression', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-replace@example.test',
  });
  const cookie: string = await loginCookie(user);
  await send(cookie, 'email-replace-first@example.test');
  const oldToken: string = latestToken(capture);
  await allowNextSend(user.userId);
  const response: LightMyRequestResponse = await send(cookie, 'email-replace-second@example.test');
  assert.equal(response.statusCode, 202);
  const status: EmailChangeStatus = response.json<EmailChangeStatus>();
  assert.equal(status.pending?.email, 'email-replace-second@example.test');
  assert.equal(Date.parse(status.nextResendAt!) - Date.parse(status.serverTime), 180000);
  assert.equal((await verify(oldToken, cookie)).statusCode, 400);
  assert.equal((await verify(latestToken(capture), cookie)).statusCode, 204);
});

test('expired links leave the current address unchanged and a fresh request works after inactivity', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-expiry@example.test',
  });
  const cookie: string = await loginCookie(user);
  await send(cookie, 'email-expiry-target@example.test');
  const token: string = latestToken(capture);
  await database.pool.query(
    `UPDATE account_email_change SET expires_at = now() - interval '1 second',
       last_sent_at = now() - interval '25 hours', send_count = 5 WHERE user_account_id = $1`,
    [user.userId],
  );
  const response: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/email-change',
    headers: { cookie },
  });
  assert.equal(response.json<EmailChangeStatus>().pending, null);
  assert.equal(response.json<EmailChangeStatus>().email, user.email);
  assert.equal((await verify(token, cookie)).statusCode, 400);
  assert.equal((await resend(cookie)).statusCode, 409);
  const restarted: LightMyRequestResponse = await send(cookie, 'email-expiry-target@example.test');
  assert.equal(restarted.statusCode, 202);
  const status: EmailChangeStatus = restarted.json<EmailChangeStatus>();
  assert.equal(Date.parse(status.nextResendAt!) - Date.parse(status.serverTime), 60000);
});

test('SMTP failure preserves pending address, token, expiration, and resend count', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-smtp-failure@example.test',
  });
  const cookie: string = await loginCookie(user);
  capture.fail = true;
  assert.equal((await send(cookie, 'email-smtp-target@example.test')).statusCode, 502);
  const initial: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/account/email-change',
    headers: { cookie },
  });
  assert.equal(initial.json<EmailChangeStatus>().pending, null);
  capture.fail = false;
  await send(cookie, 'email-smtp-target@example.test');
  const originalToken: string = latestToken(capture);
  await allowNextSend(user.userId);
  const beforeFailure: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM account_email_change WHERE user_account_id = $1',
    [user.userId],
  );
  capture.fail = true;
  assert.equal((await resend(cookie)).statusCode, 502);
  assert.equal((await send(cookie, 'email-smtp-other@example.test')).statusCode, 502);
  const afterFailure: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM account_email_change WHERE user_account_id = $1',
    [user.userId],
  );
  assert.deepEqual(afterFailure.rows, beforeFailure.rows);
  assert.equal((await verify(originalToken, cookie)).statusCode, 204);
});

test('confirmation rechecks availability and rejects disabled or deleted accounts', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const first: TestUser = await createTestUser(database.pool, {
    email: 'email-race-first@example.test',
  });
  const second: TestUser = await createTestUser(database.pool, {
    email: 'email-race-second@example.test',
  });
  const firstCookie: string = await loginCookie(first);
  const secondCookie: string = await loginCookie(second);
  await send(firstCookie, 'email-race-target@example.test');
  const firstToken: string = latestToken(capture);
  await send(secondCookie, 'email-race-target@example.test');
  const secondToken: string = latestToken(capture);
  const confirmations: LightMyRequestResponse[] = await Promise.all([
    verify(firstToken, firstCookie),
    verify(secondToken, secondCookie),
  ]);
  assert.deepEqual(
    confirmations.map((response: LightMyRequestResponse): number => response.statusCode).sort(),
    [204, 409],
  );
  for (const field of ['disabled_at', 'deleted_at'] as const) {
    const user: TestUser = await createTestUser(database.pool, {
      email: `email-${field}@example.test`,
    });
    const cookie: string = await loginCookie(user);
    await send(cookie, `email-target-${field}@example.test`);
    const token: string = latestToken(capture);
    await database.pool.query(`UPDATE user_account SET ${field} = now() WHERE id = $1`, [
      user.userId,
    ]);
    assert.equal((await verify(token, cookie)).statusCode, 401);
    const account: QueryResult<{ email: string }> = await database.pool.query(
      'SELECT email FROM user_account WHERE id = $1',
      [user.userId],
    );
    assert.equal(account.rows[0]?.email, user.email);
  }
});

test('email-change templates are customizable and required password changes must be completed before confirmation', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-template@example.test',
  });
  const cookie: string = await loginCookie(user);
  await database.pool.query(
    `INSERT INTO instance_email_template (template_key, subject_template, body_template)
     VALUES ('EMAIL_CHANGE_VERIFICATION', 'Custom {{instance_name}}', 'Hello {{recipient_name}}: {{action_url}} ({{expires_in}})')`,
  );
  try {
    await send(cookie, 'email-template-target@example.test');
    assert.match(capture.messages[0]!.subject, /^Custom /);
    assert.match(capture.messages[0]!.text, /^Hello Test user:/);
    const token: string = latestToken(capture);
    await database.pool.query(
      'UPDATE user_account SET password_change_required = true WHERE id = $1',
      [user.userId],
    );
    assert.equal((await resend(cookie)).statusCode, 403);
    assert.equal((await verify(token, cookie)).statusCode, 403);
    const passwordChange: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: user.password, newPassword: user.password },
    });
    assert.equal(passwordChange.statusCode, 204);
    assert.equal((await verify(token, cookie)).statusCode, 204);
  } finally {
    await database.pool.query(
      "DELETE FROM instance_email_template WHERE template_key = 'EMAIL_CHANGE_VERIFICATION'",
    );
  }
});

test('confirmation rejects missing or mismatched sessions without consuming the link or exposing account details', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const owner: TestUser = await createTestUser(database.pool, {
    email: 'email-link-owner@example.test',
  });
  const other: TestUser = await createTestUser(database.pool, {
    email: 'email-link-other@example.test',
  });
  const ownerCookie: string = await loginCookie(owner);
  const otherCookie: string = await loginCookie(other);
  await send(ownerCookie, 'email-link-target@example.test');
  const token: string = latestToken(capture);
  const beforeRejections: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM account_email_change WHERE user_account_id = $1',
    [owner.userId],
  );
  for (const result of [await verificationDetails(token), await verify(token)]) {
    assert.equal(result.statusCode, 401);
    assert.equal(result.json<{ code: string }>().code, 'AUTHENTICATION_REQUIRED');
  }
  for (const result of [
    await verificationDetails(token, otherCookie),
    await verify(token, otherCookie),
  ]) {
    assert.equal(result.statusCode, 403);
    assert.equal(result.json<{ code: string }>().code, 'EMAIL_CHANGE_ACCOUNT_MISMATCH');
    assert.deepEqual(Object.keys(result.json()).sort(), ['code', 'error']);
  }
  const afterRejections: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM account_email_change WHERE user_account_id = $1',
    [owner.userId],
  );
  assert.deepEqual(afterRejections.rows, beforeRejections.rows);
  const otherSession: LightMyRequestResponse = await api.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { cookie: otherCookie },
  });
  assert.equal(otherSession.json<{ email: string }>().email, other.email);
  const details: LightMyRequestResponse = await verificationDetails(token, ownerCookie);
  assert.equal(details.statusCode, 200);
  assert.deepEqual(details.json<EmailChangeVerification>(), {
    currentEmail: owner.email,
    email: 'email-link-target@example.test',
    expiresAt: (beforeRejections.rows[0]!.expires_at as Date).toISOString(),
    reauthenticationRequired: false,
  });
  const newOwnerCookie: string = await loginCookie(owner);
  assert.equal((await verify(token, newOwnerCookie)).statusCode, 204);
});

test('old, expired, and revoked sessions cannot confirm and fresh password authentication restores access without extending the link', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-fresh-auth@example.test',
  });
  const cookie: string = await loginCookie(user);
  const sessionToken: string = cookie.match(/^shadowcook_session=([^;]+)/)![1]!;
  await send(cookie, 'email-fresh-auth-target@example.test');
  const token: string = latestToken(capture);
  const original: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM account_email_change WHERE user_account_id = $1',
    [user.userId],
  );
  await database.pool.query(
    "UPDATE user_session SET created_at = now() - interval '10 minutes' WHERE token_hash = $1",
    [hashSessionToken(sessionToken)],
  );
  const details: LightMyRequestResponse = await verificationDetails(token, cookie);
  assert.equal(details.statusCode, 200);
  assert.equal(details.json<EmailChangeVerification>().reauthenticationRequired, true);
  const stale: LightMyRequestResponse = await verify(token, cookie);
  assert.equal(stale.statusCode, 403);
  assert.equal(stale.json<{ code: string }>().code, 'REAUTHENTICATION_REQUIRED');
  await database.pool.query(
    "UPDATE user_session SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
    [hashSessionToken(sessionToken)],
  );
  assert.equal((await verify(token, cookie)).statusCode, 401);
  const revokedCookie: string = await loginCookie(user);
  await api.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: revokedCookie } });
  assert.equal((await verify(token, revokedCookie)).statusCode, 401);
  const preserved: QueryResult<Record<string, unknown>> = await database.pool.query(
    'SELECT * FROM account_email_change WHERE user_account_id = $1',
    [user.userId],
  );
  assert.deepEqual(preserved.rows, original.rows);
  const freshCookie: string = await loginCookie(user);
  assert.equal((await verify(token, freshCookie)).statusCode, 204);
});

test('email-code-only accounts can confirm after fresh authentication with their existing email address', async (context: TestContext): Promise<void> => {
  const capture: MailCapture = captureMail(context);
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-code-confirm@example.test',
  });
  const cookie: string = await loginCookie(user);
  await send(cookie, 'email-code-confirm-target@example.test');
  const token: string = latestToken(capture);
  await database.pool.query(
    `INSERT INTO instance_authentication_settings (login_mode) VALUES ('EMAIL_CODE_ONLY')
     ON CONFLICT (singleton) DO UPDATE SET login_mode = EXCLUDED.login_mode`,
  );
  try {
    const codeRequest: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/auth/email-code/request',
      payload: { email: user.email },
    });
    assert.equal(codeRequest.statusCode, 204);
    assert.equal(capture.messages.at(-1)?.to, user.email);
    const code: string | undefined = capture.messages.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    const authentication: LightMyRequestResponse = await api.inject({
      method: 'POST',
      url: '/auth/email-code/verify',
      payload: { email: user.email, code },
    });
    assert.equal(authentication.statusCode, 200);
    const freshCookie: string | string[] | undefined = authentication.headers['set-cookie'];
    assert.equal(typeof freshCookie, 'string');
    assert.equal((await verify(token, freshCookie as string)).statusCode, 204);
  } finally {
    await database.pool.query(
      "UPDATE instance_authentication_settings SET login_mode = 'PASSWORD_OR_EMAIL_CODE'",
    );
  }
});

test('missing SMTP configuration creates no pending email change', async (): Promise<void> => {
  const user: TestUser = await createTestUser(database.pool, {
    email: 'email-no-smtp@example.test',
  });
  const cookie: string = await loginCookie(user);
  await database.pool.query('DELETE FROM instance_mail_settings');
  try {
    const response: LightMyRequestResponse = await send(
      cookie,
      'email-no-smtp-target@example.test',
    );
    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ code: string }>().code, 'SMTP_REQUIRED');
    const status: LightMyRequestResponse = await api.inject({
      method: 'GET',
      url: '/account/email-change',
      headers: { cookie },
    });
    assert.equal(status.json<EmailChangeStatus>().pending, null);
  } finally {
    await database.pool.query(
      `INSERT INTO instance_mail_settings
       (smtp_host, smtp_port, transport_security, from_email, from_name, updated_by_principal_id)
       VALUES ('smtp.invalid', 587, 'STARTTLS', 'noreply@example.test', 'Shadowcook', $1)`,
      [user.principalId],
    );
  }
});
