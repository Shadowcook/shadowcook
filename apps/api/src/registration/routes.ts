import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { RegistrationConfig } from '../config.js';
import { normalizeEmail } from '../auth/email-code.js';
import { hashPassword, minimumPasswordEntropy } from '../auth/password.js';
import { sendInstanceMail } from '../mail/service.js';
import {
  publicRegistrationEnabled,
  turnstileRequired,
} from '../admin/registration-settings-routes.js';

interface RegistrationBody {
  email: string;
  password: string;
  tenantName: string;
  turnstileToken: string;
  website: string;
}
interface ResendBody {
  email: string;
}
interface VerifyBody {
  token: string;
}
interface TurnstileResponse {
  success?: boolean;
}

const genericRegistrationResponse: { message: string } = {
  message: 'If registration can continue, a verification email has been sent.',
};

export function registerPublicRegistrationRoutes(
  api: FastifyInstance,
  pool: Pool,
  instanceSecretKey: Buffer | null,
  publicWebOrigin: string,
  config: RegistrationConfig,
): void {
  api.get('/registration/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      enabled: await publicRegistrationEnabled(pool),
      turnstileSiteKey: config.turnstileSiteKey,
      turnstileRequired: await turnstileRequired(pool, config),
    });
  });

  api.post('/registration', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await publicRegistrationEnabled(pool))) return registrationDisabled(reply);
    const body: RegistrationBody | null = parseRegistrationBody(request.body);
    if (body === null) return invalidRegistration(reply);
    if (!(await allowRegistrationAttempt(pool, request.ip ?? null, config))) {
      request.log.warn('Registration rate limited');
      return reply
        .code(429)
        .send({ code: 'REGISTRATION_RATE_LIMITED', error: 'Please try again later.' });
    }
    if (body.website.trim().length > 0) {
      request.log.warn('Registration honeypot triggered');
      return reply.code(202).send(genericRegistrationResponse);
    }
    if (
      (await turnstileRequired(pool, config)) &&
      !(await verifyTurnstile(body.turnstileToken, request.ip ?? null, config.turnstileSecret))
    ) {
      request.log.warn('Registration Turnstile validation failed');
      return reply.code(400).send({
        code: 'TURNSTILE_REJECTED',
        error: 'The verification challenge could not be completed.',
      });
    }
    const email: string | null = normalizeEmail(body.email);
    const tenantName: string = body.tenantName.trim();
    if (email === null || tenantName.length < 1 || tenantName.length > 120)
      return invalidRegistration(reply);
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(body.password, await minimumPasswordEntropy(pool));
    } catch (_error: unknown) {
      return invalidRegistration(reply);
    }
    const activeUser = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL) AS exists',
      [email],
    );
    if (activeUser.rows[0]?.exists === true)
      return reply.code(202).send(genericRegistrationResponse);
    const activePending = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pending_registration WHERE email = $1 AND expires_at > now()) AS exists',
      [email],
    );
    if (
      activePending.rows[0]?.exists === true &&
      !(await allowResend(pool, email, request.ip ?? null, config))
    ) {
      request.log.warn('Registration verification email resend rate limited');
      return reply.code(202).send(genericRegistrationResponse);
    }
    const token: string = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO pending_registration (email, password_hash, tenant_name, verification_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, tenant_name = EXCLUDED.tenant_name,
         verification_token_hash = EXCLUDED.verification_token_hash, created_at = now(), expires_at = EXCLUDED.expires_at`,
      [
        email,
        passwordHash,
        tenantName,
        hashToken(token),
        new Date(Date.now() + config.pendingLifetimeMilliseconds),
      ],
    );
    try {
      const delivered: boolean = await sendVerificationMail(
        pool,
        instanceSecretKey,
        email,
        token,
        publicWebOrigin,
      );
      if (!delivered) throw new Error('SMTP is not configured.');
    } catch (error: unknown) {
      await pool.query(
        'DELETE FROM pending_registration WHERE email = $1 AND verification_token_hash = $2',
        [email, hashToken(token)],
      );
      request.log.warn({ err: error }, 'Registration verification email delivery failed');
      return reply.code(503).send({
        code: 'REGISTRATION_UNAVAILABLE',
        error: 'Registration is temporarily unavailable.',
      });
    }
    request.log.info('Registration accepted');
    return reply.code(202).send(genericRegistrationResponse);
  });

  api.post(
    '/registration/resend-verification',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await publicRegistrationEnabled(pool))) return registrationDisabled(reply);
      const body: ResendBody | null = parseResendBody(request.body);
      const email: string | null = body === null ? null : normalizeEmail(body.email);
      if (email === null) return reply.code(202).send(genericRegistrationResponse);
      if (!(await allowResend(pool, email, request.ip ?? null, config))) {
        request.log.warn('Registration verification email resend rate limited');
        return reply.code(202).send(genericRegistrationResponse);
      }
      const token: string = randomBytes(32).toString('base64url');
      const pending = await pool.query<{ id: string }>(
        'UPDATE pending_registration SET verification_token_hash = $1 WHERE email = $2 AND expires_at > now() RETURNING id',
        [hashToken(token), email],
      );
      if (pending.rows[0] !== undefined) {
        try {
          await sendVerificationMail(pool, instanceSecretKey, email, token, publicWebOrigin);
        } catch (error: unknown) {
          request.log.warn({ err: error }, 'Registration verification email resend failed');
        }
      }
      return reply.code(202).send(genericRegistrationResponse);
    },
  );

  api.post('/registration/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const body: VerifyBody | null = parseVerifyBody(request.body);
    if (body === null) return invalidVerification(reply);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<{
        id: string;
        email: string;
        password_hash: string;
        tenant_name: string;
      }>(
        'DELETE FROM pending_registration WHERE verification_token_hash = $1 AND expires_at > now() RETURNING id, email, password_hash, tenant_name',
        [hashToken(body.token)],
      );
      const registration = pending.rows[0];
      if (registration === undefined) {
        await client.query('ROLLBACK');
        request.log.info('Registration verification failed');
        return invalidVerification(reply);
      }
      const existing = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL) AS exists',
        [registration.email],
      );
      if (existing.rows[0]?.exists === true) {
        await client.query('COMMIT');
        return invalidVerification(reply);
      }
      const principal = await client.query<{ id: string }>(
        "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
      );
      const user = await client.query<{ id: string; principal_id: string }>(
        'INSERT INTO user_account (principal_id, email, display_name, password_hash, password_changed_at) VALUES ($1, $2, $3, $4, now()) RETURNING id, principal_id',
        [
          principal.rows[0]!.id,
          registration.email,
          displayName(registration.email),
          registration.password_hash,
        ],
      );
      const tenant = await client.query<{ id: string; public_id: string; slug: string }>(
        'INSERT INTO tenant (display_name, slug) VALUES ($1, $2) RETURNING id, public_id, slug',
        [registration.tenant_name, tenantSlug(registration.tenant_name)],
      );
      const owner = await client.query<{ id: string }>(
        "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Owner') RETURNING id",
        [tenant.rows[0]!.id],
      );
      await client.query(
        "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code LIKE 'tenant:%' OR code LIKE 'recipe:%' OR code LIKE 'variant:%' OR code LIKE 'ingredient:%' OR code LIKE 'unit:%' OR code LIKE 'category:%' OR code = 'service-account:manage'",
        [owner.rows[0]!.id],
      );
      const editor = await client.query<{ id: string }>(
        "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Editor') RETURNING id",
        [tenant.rows[0]!.id],
      );
      await client.query(
        "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code IN ('recipe:read', 'recipe:revision:read', 'recipe:create', 'recipe:update', 'variant:read', 'variant:create', 'variant:update', 'ingredient:read', 'ingredient:create', 'ingredient:update', 'unit:read', 'unit:create', 'unit:update', 'category:read', 'category:update')",
        [editor.rows[0]!.id],
      );
      const viewer = await client.query<{ id: string }>(
        "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Viewer') RETURNING id",
        [tenant.rows[0]!.id],
      );
      await client.query(
        "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code IN ('recipe:read', 'variant:read', 'ingredient:read', 'unit:read', 'category:read')",
        [viewer.rows[0]!.id],
      );
      await client.query(
        'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
        [tenant.rows[0]!.id, user.rows[0]!.principal_id],
      );
      await client.query(
        'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
        [tenant.rows[0]!.id, user.rows[0]!.principal_id, owner.rows[0]!.id],
      );
      await client.query('COMMIT');
      request.log.info('Registration verification succeeded');
      return reply.code(201).send({ tenantSlug: tenant.rows[0]!.slug });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function cleanupExpiredPendingRegistrations(pool: Pool): Promise<number> {
  const deleted = await pool.query('DELETE FROM pending_registration WHERE expires_at <= now()');
  await pool.query(
    "DELETE FROM registration_rate_event WHERE created_at < now() - interval '25 hours'",
  );
  return deleted.rowCount ?? 0;
}

async function allowRegistrationAttempt(
  pool: Pool,
  ip: string | null,
  config: RegistrationConfig,
): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('registration:' || COALESCE($1, 'unknown')))",
      [ip],
    );
    const result = await client.query<{ short_count: string; daily_count: string }>(
      `SELECT count(*) FILTER (WHERE created_at > $2)::text AS short_count, count(*)::text AS daily_count
       FROM registration_rate_event WHERE event_type = 'REGISTRATION' AND requested_ip = $1::inet AND created_at > $3`,
      [
        ip,
        new Date(Date.now() - config.shortWindowMilliseconds),
        new Date(Date.now() - config.dailyWindowMilliseconds),
      ],
    );
    const row = result.rows[0];
    if (
      Number(row?.short_count ?? 0) >= config.shortWindowRequests ||
      Number(row?.daily_count ?? 0) >= config.dailyWindowRequests
    ) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      "INSERT INTO registration_rate_event (event_type, requested_ip) VALUES ('REGISTRATION', $1::inet)",
      [ip],
    );
    await client.query('COMMIT');
    return true;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function allowResend(
  pool: Pool,
  email: string,
  ip: string | null,
  config: RegistrationConfig,
): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('registration-resend:' || $1))", [
      email,
    ]);
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM registration_rate_event WHERE event_type = 'VERIFICATION_RESEND' AND normalized_email = $1 AND created_at > $2`,
      [email, new Date(Date.now() - config.resendWindowMilliseconds)],
    );
    if (Number(result.rows[0]?.count ?? 0) >= config.resendRequests) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      "INSERT INTO registration_rate_event (event_type, requested_ip, normalized_email) VALUES ('VERIFICATION_RESEND', $1::inet, $2)",
      [ip, email],
    );
    await client.query('COMMIT');
    return true;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function verifyTurnstile(token: string, ip: string | null, secret: string): Promise<boolean> {
  if (token.length === 0 || secret.length === 0) return false;
  try {
    const form: URLSearchParams = new URLSearchParams({ secret, response: token });
    if (ip !== null) form.set('remoteip', ip);
    const response: Response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form, signal: AbortSignal.timeout(5_000) },
    );
    const result = (await response.json()) as TurnstileResponse;
    return response.ok && result.success === true;
  } catch (_error: unknown) {
    return false;
  }
}
async function sendVerificationMail(
  pool: Pool,
  key: Buffer | null,
  email: string,
  token: string,
  origin: string,
): Promise<boolean> {
  return sendInstanceMail(
    pool,
    key,
    email,
    'Verify your Shadowcook email address',
    `Verify your email address to create your Shadowcook account: ${origin}/verify-email/${token}. This link expires in 24 hours.`,
  );
}
function parseRegistrationBody(value: unknown): RegistrationBody | null {
  if (
    !isRecord(value) ||
    typeof value.email !== 'string' ||
    typeof value.password !== 'string' ||
    typeof value.tenantName !== 'string' ||
    typeof value.turnstileToken !== 'string' ||
    typeof value.website !== 'string'
  )
    return null;
  return {
    email: value.email,
    password: value.password,
    tenantName: value.tenantName,
    turnstileToken: value.turnstileToken,
    website: value.website,
  };
}
function parseResendBody(value: unknown): ResendBody | null {
  return isRecord(value) && typeof value.email === 'string' ? { email: value.email } : null;
}
function parseVerifyBody(value: unknown): VerifyBody | null {
  return isRecord(value) && typeof value.token === 'string' && value.token.length <= 512
    ? { token: value.token }
    : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
function displayName(email: string): string {
  return email.split('@', 1)[0]!.slice(0, 120) || 'User';
}
function tenantSlug(name: string): string {
  const normalized: string =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 45) || 'cookbook';
  return `${normalized}-${randomBytes(4).toString('hex')}`;
}
function invalidRegistration(reply: FastifyReply): FastifyReply {
  return reply
    .code(400)
    .send({ code: 'INVALID_REGISTRATION', error: 'The registration details are invalid.' });
}
function invalidVerification(reply: FastifyReply): FastifyReply {
  return reply
    .code(400)
    .send({ code: 'INVALID_VERIFICATION', error: 'The verification link is invalid or expired.' });
}
function registrationDisabled(reply: FastifyReply): FastifyReply {
  return reply
    .code(403)
    .send({ code: 'REGISTRATION_DISABLED', error: 'Public registration is unavailable.' });
}
