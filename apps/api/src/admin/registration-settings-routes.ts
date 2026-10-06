import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';
import type { RegistrationConfig } from '../config.js';

export function registerRegistrationSettingsRoutes(
  api: FastifyInstance,
  pool: Pool,
  config: RegistrationConfig,
): void {
  api.get('/admin/registration-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    return reply.send(await registrationSettings(pool, config));
  });
  api.put('/admin/registration-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal: string | null = await requireInstancePermission(
      pool,
      request,
      reply,
      'instance:administer',
    );
    const body: unknown = request.body;
    if (principal === null) return;
    if (
      typeof body !== 'object' ||
      body === null ||
      !('enabled' in body) ||
      typeof body.enabled !== 'boolean' ||
      !('turnstileEnabled' in body) ||
      typeof body.turnstileEnabled !== 'boolean'
    )
      return reply.code(400).send({
        code: 'INVALID_REGISTRATION_SETTINGS',
        error: 'The registration setting is invalid.',
      });
    if (body.turnstileEnabled && !turnstileConfigured(config))
      return reply.code(409).send({
        code: 'TURNSTILE_NOT_CONFIGURED',
        error: 'Turnstile is not configured for this deployment.',
      });
    await pool.query(
      'INSERT INTO instance_registration_settings (singleton, enabled, turnstile_enabled, updated_by_principal_id) VALUES (true, $1, $2, $3) ON CONFLICT (singleton) DO UPDATE SET enabled = EXCLUDED.enabled, turnstile_enabled = EXCLUDED.turnstile_enabled, updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = now()',
      [body.enabled, body.turnstileEnabled, principal],
    );
    return reply.code(204).send();
  });
}

export async function turnstileRequired(pool: Pool, config: RegistrationConfig): Promise<boolean> {
  if (!turnstileConfigured(config)) return false;
  const result = await pool.query<{ turnstile_enabled: boolean }>(
    'SELECT turnstile_enabled FROM instance_registration_settings WHERE singleton = true',
  );
  return result.rows[0]?.turnstile_enabled ?? false;
}

async function registrationSettings(
  pool: Pool,
  config: RegistrationConfig,
): Promise<{ enabled: boolean; turnstileEnabled: boolean; turnstileConfigured: boolean }> {
  const result = await pool.query<{ enabled: boolean; turnstile_enabled: boolean }>(
    'SELECT enabled, turnstile_enabled FROM instance_registration_settings WHERE singleton = true',
  );
  const configured: boolean = turnstileConfigured(config);
  return {
    enabled: result.rows[0]?.enabled ?? true,
    turnstileEnabled: configured && (result.rows[0]?.turnstile_enabled ?? false),
    turnstileConfigured: configured,
  };
}

function turnstileConfigured(config: RegistrationConfig): boolean {
  return config.turnstileSiteKey.trim().length > 0 && config.turnstileSecret.trim().length > 0;
}

export async function publicRegistrationEnabled(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    'SELECT enabled FROM instance_registration_settings WHERE singleton = true',
  );
  return result.rows[0]?.enabled ?? true;
}
