import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';
import { decryptSecret, encryptSecret } from '../security/encryption.js';
import { createSmtpTransport, senderAddress } from '../mail/smtp.js';
import type { SmtpConfiguration, TransportSecurity } from '../mail/smtp.js';

interface MailSettingsRow {
  smtp_host: string;
  smtp_port: number;
  transport_security: TransportSecurity;
  username: string | null;
  encrypted_password: Buffer | null;
  from_email: string;
  from_name: string;
}
interface MailSettingsBody { host: string; port: number; transportSecurity: TransportSecurity; username: string | null; password: string | null | undefined; fromEmail: string; fromName: string; }
interface TestMailBody { recipient: string; }

export function registerAdminMailRoutes(api: FastifyInstance, pool: Pool, instanceSecretKey: Buffer | null): void {
  api.get('/admin/mail-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(pool, request, reply, 'instance:mail-manage');
    if (principalId === null) return;
    const result = await pool.query<MailSettingsRow>('SELECT smtp_host, smtp_port, transport_security, username, encrypted_password, from_email, from_name FROM instance_mail_settings WHERE singleton = true');
    const settings: MailSettingsRow | undefined = result.rows[0];
    if (settings === undefined) return reply.send({ configured: false });
    return reply.send({ configured: true, host: settings.smtp_host, port: settings.smtp_port, transportSecurity: settings.transport_security, username: settings.username, hasPassword: settings.encrypted_password !== null, fromEmail: settings.from_email, fromName: settings.from_name });
  });

  api.put('/admin/mail-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(pool, request, reply, 'instance:mail-manage');
    if (principalId === null) return;
    if (instanceSecretKey === null) return reply.code(503).send({ code: 'INSTANCE_SECRET_KEY_REQUIRED', error: 'INSTANCE_SECRET_KEY must be configured before mail settings can be stored.' });
    const body: MailSettingsBody | null = parseMailSettingsBody(request.body);
    if (body === null) return reply.code(400).send({ code: 'INVALID_MAIL_SETTINGS', error: 'The mail settings are invalid.' });
    const previousResult = await pool.query<Pick<MailSettingsRow, 'encrypted_password'>>('SELECT encrypted_password FROM instance_mail_settings WHERE singleton = true');
    const previousPassword: Buffer | null = previousResult.rows[0]?.encrypted_password ?? null;
    const encryptedPassword: Buffer | null = body.password === undefined ? previousPassword : body.password === null ? null : encryptSecret(body.password, instanceSecretKey);
    if ((body.username === null) !== (encryptedPassword === null)) return reply.code(400).send({ code: 'INVALID_MAIL_SETTINGS', error: 'SMTP username and password must both be set or both be empty.' });
    await pool.query(`INSERT INTO instance_mail_settings (singleton, smtp_host, smtp_port, transport_security, username, encrypted_password, from_email, from_name, updated_by_principal_id) VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (singleton) DO UPDATE SET smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port, transport_security = EXCLUDED.transport_security, username = EXCLUDED.username, encrypted_password = EXCLUDED.encrypted_password, from_email = EXCLUDED.from_email, from_name = EXCLUDED.from_name, updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = now()`, [body.host, body.port, body.transportSecurity, body.username, encryptedPassword, body.fromEmail, body.fromName, principalId]);
    return reply.code(204).send();
  });

  api.post('/admin/mail-settings/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(pool, request, reply, 'instance:mail-manage');
    if (principalId === null) return;
    if (instanceSecretKey === null) return reply.code(503).send({ code: 'INSTANCE_SECRET_KEY_REQUIRED', error: 'INSTANCE_SECRET_KEY must be configured before mail can be sent.' });
    const body: TestMailBody | null = parseTestMailBody(request.body);
    if (body === null) return reply.code(400).send({ code: 'INVALID_TEST_RECIPIENT', error: 'A valid test recipient is required.' });
    const settings = await loadSmtpConfiguration(pool, instanceSecretKey);
    if (settings === null) return reply.code(409).send({ code: 'MAIL_NOT_CONFIGURED', error: 'Mail settings must be saved before sending a test message.' });
    try {
      const transport = createSmtpTransport(settings);
      await transport.sendMail({ from: senderAddress(settings), to: body.recipient, subject: 'Shadowcook mail configuration test', text: 'This message confirms that Shadowcook can deliver email through the configured SMTP server.' });
    } catch (error: unknown) {
      request.log.warn({ error }, 'SMTP test delivery failed');
      return reply.code(502).send({ code: 'MAIL_DELIVERY_FAILED', error: 'The SMTP server could not deliver the test message.' });
    }
    return reply.code(204).send();
  });
}

export async function loadSmtpConfiguration(pool: Pool, key: Buffer): Promise<SmtpConfiguration | null> {
  const result = await pool.query<MailSettingsRow>('SELECT smtp_host, smtp_port, transport_security, username, encrypted_password, from_email, from_name FROM instance_mail_settings WHERE singleton = true');
  const row: MailSettingsRow | undefined = result.rows[0];
  if (row === undefined) return null;
  return { host: row.smtp_host, port: row.smtp_port, transportSecurity: row.transport_security, username: row.username, password: row.encrypted_password === null ? null : decryptSecret(row.encrypted_password, key), fromEmail: row.from_email, fromName: row.from_name };
}

function parseMailSettingsBody(value: unknown): MailSettingsBody | null {
  if (!isRecord(value) || typeof value.host !== 'string' || !Number.isSafeInteger(value.port) || (value.transportSecurity !== 'STARTTLS' && value.transportSecurity !== 'IMPLICIT_TLS') || (typeof value.username !== 'string' && value.username !== null) || (typeof value.password !== 'string' && value.password !== null && value.password !== undefined) || typeof value.fromEmail !== 'string' || typeof value.fromName !== 'string') return null;
  const username: string | null = value.username === null || value.username.trim().length === 0 ? null : value.username.trim();
  const password: string | null | undefined = value.password === undefined ? undefined : value.password === null || value.password.length === 0 ? null : value.password;
  if (value.host.trim().length === 0 || value.fromName.trim().length === 0 || !isEmail(value.fromEmail)) return null;
  const port: number = value.port as number;
  return { host: value.host.trim(), port, transportSecurity: value.transportSecurity, username, password, fromEmail: value.fromEmail.trim(), fromName: value.fromName.trim() };
}

function parseTestMailBody(value: unknown): TestMailBody | null { return isRecord(value) && typeof value.recipient === 'string' && isEmail(value.recipient) ? { recipient: value.recipient.trim() } : null; }
function isEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
