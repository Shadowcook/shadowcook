import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { currentSessionUser } from '../auth/session.js';
import { consumeEmailCode, normalizeEmail, requestEmailCode } from '../auth/email-code.js';
import { sendInstanceMail } from '../mail/service.js';
import { requireInstancePermission } from './authorization.js';

interface CreateTenantBody {
  firstName: string;
  lastName: string;
  email: string;
  cookbookName: string;
  slug: string;
}
const invitationLifetime: number = 7 * 24 * 60 * 60 * 1000;
const reservedSlugs: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'assets',
  'auth',
  'health',
  'login',
  'logout',
  'recipes',
  'settings',
]);
export function registerTenantRoutes(
  api: FastifyInstance,
  pool: Pool,
  key: Buffer | null,
  publicOrigin: string,
): void {
  api.get('/admin/tenants', async (request, reply) => {
    if ((await requireInstancePermission(pool, request, reply, 'tenant:create')) === null) return;
    const result = await pool.query(
      `SELECT tenant.public_id, tenant.display_name, tenant.description, tenant.slug, tenant.disabled_at, count(recipe.id)::integer AS recipe_count, string_agg(user_account.display_name, ', ' ORDER BY user_account.display_name) FILTER (WHERE tenant_role.name = 'Owner') AS owner_name FROM tenant LEFT JOIN recipe ON recipe.tenant_id = tenant.id AND recipe.published_revision_id IS NOT NULL LEFT JOIN tenant_membership_role ON tenant_membership_role.tenant_id = tenant.id LEFT JOIN tenant_role ON tenant_role.id = tenant_membership_role.tenant_role_id LEFT JOIN user_account ON user_account.principal_id = tenant_membership_role.principal_id GROUP BY tenant.id ORDER BY tenant.display_name`,
    );
    return reply.send({ tenants: result.rows });
  });
  api.patch('/admin/tenants/:publicId', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'tenant:create')) === null) return;
    const body = request.body as { displayName?: unknown; disabled?: unknown };
    const id = (request.params as { publicId: string }).publicId;
    if (typeof body.displayName === 'string' && body.displayName.trim().length > 0) {
      const result = await pool.query(
        'UPDATE tenant SET display_name = $1, updated_at = now() WHERE public_id = $2',
        [body.displayName.trim(), id],
      );
      return result.rowCount === 1
        ? reply.code(204).send()
        : reply.code(404).send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });
    }
    if (typeof body.disabled === 'boolean') {
      const result = await pool.query(
        'UPDATE tenant SET disabled_at = CASE WHEN $1 THEN now() ELSE NULL END, updated_at = now() WHERE public_id = $2',
        [body.disabled, id],
      );
      return result.rowCount === 1
        ? reply.code(204).send()
        : reply.code(404).send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });
    }
    return reply
      .code(400)
      .send({ code: 'INVALID_TENANT_UPDATE', error: 'The tenant update is invalid.' });
  });
  api.delete('/admin/tenants/:publicId', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'tenant:create')) === null) return;
    const publicId = (request.params as { publicId: string }).publicId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tenant_access_grant WHERE receiving_tenant_public_id = $1', [
        publicId,
      ]);
      await client.query('DELETE FROM tenant_invite WHERE claimed_by_tenant_public_id = $1', [
        publicId,
      ]);
      const result = await client.query('DELETE FROM tenant WHERE public_id = $1', [publicId]);
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK');
        return reply
          .code(404)
          .send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });
      }
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  api.get('/admin/users', async (request, reply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const result = await pool.query(
      `SELECT user_account.public_id, user_account.email, user_account.display_name, user_account.password_change_required, COALESCE(json_agg(json_build_object('publicId', tenant.public_id, 'name', tenant.display_name)) FILTER (WHERE tenant.id IS NOT NULL), '[]') AS tenants FROM user_account LEFT JOIN tenant_membership ON tenant_membership.principal_id = user_account.principal_id LEFT JOIN tenant ON tenant.id = tenant_membership.tenant_id GROUP BY user_account.id ORDER BY user_account.email`,
    );
    return reply.send({ users: result.rows });
  });
  api.post('/admin/tenants', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = await requireInstancePermission(pool, request, reply, 'tenant:create');
    if (principal === null) return;
    const body = parseCreateTenant(request.body);
    if (body === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_TENANT', error: 'The tenant details are invalid.' });
    const email = normalizeEmail(body.email);
    if (email === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_TENANT', error: 'The tenant details are invalid.' });
    const slug = validateSlug(body.slug);
    if (slug === null)
      return reply.code(400).send({
        code: 'INVALID_TENANT_SLUG',
        error: 'The tenant slug must contain only lowercase letters, digits, and hyphens.',
      });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenantResult = await client.query<{ id: string; public_id: string }>(
        'INSERT INTO tenant (display_name, slug) VALUES ($1, $2) RETURNING id, public_id',
        [body.cookbookName.trim(), slug],
      );
      const tenant = tenantResult.rows[0]!;
      const roleResult = await client.query<{ id: string }>(
        'INSERT INTO tenant_role (tenant_id, name) VALUES ($1, $2) RETURNING id',
        [tenant.id, 'Owner'],
      );
      await client.query(
        "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code LIKE 'tenant:%' OR code LIKE 'recipe:%' OR code LIKE 'variant:%' OR code LIKE 'ingredient:%' OR code LIKE 'category:%' OR code = 'service-account:manage'",
        [roleResult.rows[0]!.id],
      );
      const token = randomBytes(32).toString('base64url');
      await client.query(
        'INSERT INTO tenant_invitation (tenant_id, invited_email, first_name, last_name, tenant_role_id, token_hash, expires_at, created_by_principal_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          tenant.id,
          email,
          body.firstName.trim(),
          body.lastName.trim(),
          roleResult.rows[0]!.id,
          hashToken(token),
          new Date(Date.now() + invitationLifetime),
          principal,
        ],
      );
      await client.query(
        "INSERT INTO audit_event (tenant_id, principal_id, operation, entity_type, entity_key, after_json) VALUES ($1, $2, 'CREATE', 'TENANT', $1, jsonb_build_object('slug', $3::text))",
        [tenant.id, principal, slug],
      );
      const code = await requestEmailCode(pool, email, 'TENANT_INVITATION', request.ip ?? null, {
        invitationToken: token,
      });
      if (code === null) throw new InvitationDeliveryError('INVITATION_CODE_RATE_LIMITED');
      const delivered: boolean = await sendInstanceMail(
        pool,
        key,
        email,
        'You are invited to Shadowcook',
        `You are invited to ${body.cookbookName}. Open ${publicOrigin}/invitations/${token} and enter this code: ${code}. The code expires in 10 minutes.`,
      );
      if (!delivered) throw new InvitationDeliveryError('MAIL_NOT_CONFIGURED');
      await client.query('COMMIT');
      return reply.code(201).send({ publicId: tenant.public_id, slug });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof InvitationDeliveryError)
        return reply
          .code(error.code === 'MAIL_NOT_CONFIGURED' ? 503 : 429)
          .send({ code: error.code, error: 'The tenant invitation could not be delivered.' });
      if (isUniqueViolation(error))
        return reply
          .code(409)
          .send({ code: 'TENANT_SLUG_CONFLICT', error: 'That cookbook name is already in use.' });
      request.log.warn({ err: error }, 'Tenant invitation delivery failed');
      return reply.code(502).send({
        code: 'MAIL_DELIVERY_FAILED',
        error: 'The tenant invitation could not be delivered.',
      });
    } finally {
      client.release();
    }
  });
  api.get('/invitations/:token', async (request, reply) => {
    const invitation = await invitationForToken(pool, (request.params as { token: string }).token);
    if (invitation === null)
      return reply
        .code(404)
        .send({ code: 'INVITATION_NOT_FOUND', error: 'The invitation is invalid or expired.' });
    return reply.send({
      email: invitation.invited_email,
      firstName: invitation.first_name,
      lastName: invitation.last_name,
      cookbookName: invitation.display_name,
    });
  });
  api.post('/invitations/:token/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.params as { token: string }).token;
    const body = request.body as { code?: unknown };
    if (typeof body?.code !== 'string')
      return reply
        .code(400)
        .send({ code: 'INVALID_EMAIL_CODE', error: 'A valid email code is required.' });
    const invitation = await invitationForToken(pool, token);
    if (invitation === null)
      return reply
        .code(404)
        .send({ code: 'INVITATION_NOT_FOUND', error: 'The invitation is invalid or expired.' });
    const session = await currentSessionUser(pool, request);
    if (session !== null && session.email !== invitation.invited_email)
      return reply.code(403).send({
        code: 'INVITATION_EMAIL_MISMATCH',
        error: 'The active session belongs to another email address.',
      });
    const context = await consumeEmailCode(
      pool,
      invitation.invited_email,
      'TENANT_INVITATION',
      body.code,
    );
    if (context?.invitationToken !== token)
      return reply
        .code(401)
        .send({ code: 'INVALID_EMAIL_CODE', error: 'The code is invalid or expired.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; principal_id: string }>(
        'SELECT id, principal_id FROM user_account WHERE email = $1 FOR UPDATE',
        [invitation.invited_email],
      );
      let principalId: string;
      if (existing.rows[0] === undefined) {
        const principal = await client.query<{ id: string }>(
          "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
        );
        principalId = principal.rows[0]!.id;
        await client.query(
          'INSERT INTO user_account (principal_id, email, display_name, password_change_required) VALUES ($1, $2, $3, true)',
          [
            principalId,
            invitation.invited_email,
            `${invitation.first_name} ${invitation.last_name}`,
          ],
        );
      } else principalId = existing.rows[0].principal_id;
      const claimed = await client.query(
        'UPDATE tenant_invitation SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL',
        [invitation.id],
      );
      if (claimed.rowCount !== 1) throw new Error('Invitation was already accepted.');
      await client.query(
        'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [invitation.tenant_id, principalId],
      );
      await client.query(
        'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [invitation.tenant_id, principalId, invitation.tenant_role_id],
      );
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
function parseCreateTenant(value: unknown): CreateTenantBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  return typeof v.firstName === 'string' &&
    typeof v.lastName === 'string' &&
    typeof v.email === 'string' &&
    typeof v.cookbookName === 'string' &&
    typeof v.slug === 'string' &&
    v.firstName.trim() &&
    v.lastName.trim() &&
    v.cookbookName.trim()
    ? {
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        cookbookName: v.cookbookName,
        slug: v.slug,
      }
    : null;
}
function validateSlug(value: string): string | null {
  const slug: string = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !reservedSlugs.has(slug) ? slug : null;
}
function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
class InvitationDeliveryError extends Error {
  public readonly code: 'INVITATION_CODE_RATE_LIMITED' | 'MAIL_NOT_CONFIGURED';
  public constructor(code: 'INVITATION_CODE_RATE_LIMITED' | 'MAIL_NOT_CONFIGURED') {
    super(code);
    this.code = code;
  }
}
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
async function invitationForToken(pool: Pool, token: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT tenant_invitation.*, tenant.display_name FROM tenant_invitation INNER JOIN tenant ON tenant.id = tenant_invitation.tenant_id WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() AND tenant.disabled_at IS NULL`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}
