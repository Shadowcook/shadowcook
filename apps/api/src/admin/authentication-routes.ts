import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';
import { loadSmtpConfiguration } from './mail-routes.js';

type LoginMode = 'PASSWORD_ONLY' | 'EMAIL_CODE_ONLY' | 'PASSWORD_OR_EMAIL_CODE';
export function registerAuthenticationSettingsRoutes(api: FastifyInstance, pool: Pool, key: Buffer | null): void {
  api.get('/admin/authentication-settings', async (request, reply) => { if (await requireInstancePermission(pool, request, reply, 'instance:administer') === null) return; const result = await pool.query<{ login_mode: LoginMode }>('SELECT login_mode FROM instance_authentication_settings WHERE singleton = true'); return reply.send({ loginMode: result.rows[0]?.login_mode ?? 'PASSWORD_OR_EMAIL_CODE' }); });
  api.put('/admin/authentication-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = await requireInstancePermission(pool, request, reply, 'instance:administer'); if (principal === null) return;
    const value: unknown = (request.body as Record<string, unknown> | null)?.loginMode; if (value !== 'PASSWORD_ONLY' && value !== 'EMAIL_CODE_ONLY' && value !== 'PASSWORD_OR_EMAIL_CODE') return reply.code(400).send({ code: 'INVALID_AUTHENTICATION_SETTINGS', error: 'The authentication mode is invalid.' });
    if (value === 'EMAIL_CODE_ONLY' && (key === null || await loadSmtpConfiguration(pool, key) === null)) return reply.code(409).send({ code: 'SMTP_REQUIRED', error: 'Email-code-only sign-in requires configured SMTP delivery.' });
    await pool.query('INSERT INTO instance_authentication_settings (singleton, login_mode, updated_by_principal_id) VALUES (true, $1, $2) ON CONFLICT (singleton) DO UPDATE SET login_mode = EXCLUDED.login_mode, updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = now()', [value, principal]); return reply.code(204).send();
  });
}
