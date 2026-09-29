import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { currentSessionUser } from '../auth/session.js';
import { consumeEmailCode, normalizeEmail, requestEmailCode } from '../auth/email-code.js';
import { createPasswordResetToken } from '../auth/password-reset.js';
import { hashPassword } from '../auth/password.js';
import { sendInstanceMail } from '../mail/service.js';
import { requireInstancePermission, requireTenantPermission } from './authorization.js';

interface CreateTenantBody {
  firstName: string;
  lastName: string;
  email: string;
  cookbookName: string;
  slug: string;
}
interface UpdateUserBody {
  displayName?: string;
  disabled?: boolean;
}
interface CreateUserInvitationBody {
  email: string;
  roleCode: string;
}
interface AcceptUserInvitationBody {
  displayName: string;
  password?: string;
}
interface UpdateInstanceRolesBody {
  roleCodes: string[];
}
interface CreateTenantUserInvitationBody {
  email: string;
  roleId: string;
}
interface AuthenticationSettingsRow {
  login_mode: 'PASSWORD_ONLY' | 'EMAIL_CODE_ONLY' | 'PASSWORD_OR_EMAIL_CODE';
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
      `SELECT user_account.public_id, user_account.email, user_account.display_name, user_account.password_change_required, user_account.disabled_at, user_account.deleted_at, user_account.last_login_at, COALESCE((SELECT json_agg(json_build_object('publicId', tenant.public_id, 'name', tenant.display_name) ORDER BY tenant.display_name) FROM tenant_membership INNER JOIN tenant ON tenant.id = tenant_membership.tenant_id WHERE tenant_membership.principal_id = user_account.principal_id), '[]') AS tenants, COALESCE((SELECT json_agg(instance_role.code ORDER BY instance_role.name) FROM principal_instance_role INNER JOIN instance_role ON instance_role.id = principal_instance_role.instance_role_id WHERE principal_instance_role.principal_id = user_account.principal_id), '[]') AS instance_roles FROM user_account ORDER BY user_account.email, user_account.created_at`,
    );
    return reply.send({ users: result.rows });
  });
  api.get('/admin/instance-roles', async (request, reply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const result = await pool.query<{ code: string; name: string }>(
      'SELECT code, name FROM instance_role ORDER BY name',
    );
    return reply.send({ roles: result.rows });
  });
  api.put(
    '/admin/users/:publicId/instance-roles',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const body: UpdateInstanceRolesBody | null = parseUpdateInstanceRoles(request.body);
      if (body === null)
        return reply
          .code(400)
          .send({ code: 'INVALID_INSTANCE_ROLES', error: 'The role assignment is invalid.' });
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const user = await client.query<{ principal_id: string }>(
          'SELECT principal_id FROM user_account WHERE public_id = $1 AND deleted_at IS NULL FOR UPDATE',
          [(request.params as { publicId: string }).publicId],
        );
        if (user.rows[0] === undefined) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ code: 'USER_NOT_FOUND', error: 'The user was not found.' });
        }
        const roles = await client.query<{ code: string }>(
          'SELECT code FROM instance_role WHERE code = ANY($1::text[])',
          [body.roleCodes],
        );
        if (roles.rowCount !== body.roleCodes.length) {
          await client.query('ROLLBACK');
          return reply
            .code(400)
            .send({ code: 'INVALID_INSTANCE_ROLES', error: 'The role assignment is invalid.' });
        }
        await client.query('DELETE FROM principal_instance_role WHERE principal_id = $1', [
          user.rows[0].principal_id,
        ]);
        if (body.roleCodes.length > 0)
          await client.query(
            'INSERT INTO principal_instance_role (principal_id, instance_role_id) SELECT $1, id FROM instance_role WHERE code = ANY($2::text[])',
            [user.rows[0].principal_id, body.roleCodes],
          );
        await client.query('COMMIT');
        return reply.code(204).send();
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
  api.post('/admin/users/invitations', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal: string | null = await requireInstancePermission(
      pool,
      request,
      reply,
      'instance:administer',
    );
    if (principal === null) return;
    const body: CreateUserInvitationBody | null = parseCreateUserInvitation(request.body);
    const email: string | null = body === null ? null : normalizeEmail(body.email);
    if (email === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_USER_INVITATION', error: 'The invitation email is invalid.' });
    const existing = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL) AS exists',
      [email],
    );
    if (existing.rows[0]?.exists === true)
      return reply.code(409).send({
        code: 'USER_EMAIL_CONFLICT',
        error: 'An active user already uses this email address.',
      });
    const role = await pool.query<{ id: string }>('SELECT id FROM instance_role WHERE code = $1', [
      body!.roleCode,
    ]);
    if (role.rows[0] === undefined)
      return reply
        .code(400)
        .send({ code: 'INVALID_USER_INVITATION', error: 'The invitation role is invalid.' });
    const token: string = randomBytes(32).toString('base64url');
    const invitation = await pool.query<{ id: string }>(
      'INSERT INTO user_invitation (invited_email, instance_role_id, token_hash, expires_at, created_by_principal_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [
        email,
        role.rows[0].id,
        hashToken(token),
        new Date(Date.now() + invitationLifetime),
        principal,
      ],
    );
    try {
      const delivered: boolean = await sendInstanceMail(
        pool,
        key,
        email,
        'You are invited to Shadowcook',
        `You are invited to Shadowcook. Open ${publicOrigin}/user-invitations/${token} to create your account. The link expires in seven days.`,
      );
      if (delivered) return reply.code(201).send();
    } catch (error: unknown) {
      request.log.warn({ error }, 'User invitation email delivery failed');
    }
    await pool.query('DELETE FROM user_invitation WHERE id = $1 AND accepted_at IS NULL', [
      invitation.rows[0]!.id,
    ]);
    return reply.code(503).send({
      code: 'MAIL_NOT_CONFIGURED',
      error: 'The user invitation could not be delivered.',
    });
  });
  api.post(
    '/cookbook/tenant-users/invitations',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantSlug: unknown = (request.query as { tenantSlug?: unknown }).tenantSlug;
      const body: CreateTenantUserInvitationBody | null = parseCreateTenantUserInvitation(
        request.body,
      );
      if (typeof tenantSlug !== 'string' || body === null)
        return reply
          .code(400)
          .send({ code: 'INVALID_TENANT_USER_INVITATION', error: 'The invitation is invalid.' });
      const tenantId: string | null = await requireTenantPermission(
        pool,
        request,
        reply,
        tenantSlug,
        'tenant:manage',
      );
      if (tenantId === null) return;
      const principal = await currentSessionUser(pool, request);
      if (principal === null) return;
      const email: string | null = normalizeEmail(body.email);
      if (email === null)
        return reply
          .code(400)
          .send({ code: 'INVALID_TENANT_USER_INVITATION', error: 'The invitation is invalid.' });
      const role = await pool.query<{ id: string }>(
        'SELECT id FROM tenant_role WHERE id = $1 AND tenant_id = $2',
        [body.roleId, tenantId],
      );
      if (role.rows[0] === undefined)
        return reply
          .code(400)
          .send({ code: 'INVALID_TENANT_USER_INVITATION', error: 'The invitation is invalid.' });
      const existing = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL) AS exists',
        [email],
      );
      if (existing.rows[0]?.exists === true)
        return reply.code(409).send({
          code: 'USER_EMAIL_CONFLICT',
          error: 'An active user already uses this email address.',
        });
      const token: string = randomBytes(32).toString('base64url');
      const invitation = await pool.query<{ id: string }>(
        'INSERT INTO user_invitation (tenant_id, tenant_role_id, invited_email, token_hash, expires_at, created_by_principal_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [
          tenantId,
          body.roleId,
          email,
          hashToken(token),
          new Date(Date.now() + invitationLifetime),
          principal.principal_id,
        ],
      );
      try {
        const delivered: boolean = await sendInstanceMail(
          pool,
          key,
          email,
          'You are invited to Shadowcook',
          `You are invited to a Shadowcook cookbook. Open ${publicOrigin}/user-invitations/${token} to create your account. The link expires in seven days.`,
        );
        if (delivered) return reply.code(201).send();
      } catch (error: unknown) {
        request.log.warn({ error }, 'Tenant user invitation email delivery failed');
      }
      await pool.query('DELETE FROM user_invitation WHERE id = $1 AND accepted_at IS NULL', [
        invitation.rows[0]!.id,
      ]);
      return reply
        .code(503)
        .send({ code: 'MAIL_NOT_CONFIGURED', error: 'The invitation could not be delivered.' });
    },
  );
  api.patch('/admin/users/:publicId', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const body: UpdateUserBody | null = parseUpdateUser(request.body);
    if (body === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_USER_UPDATE', error: 'The user update is invalid.' });
    const publicId: string = (request.params as { publicId: string }).publicId;
    if (body.displayName !== undefined) {
      const result = await pool.query(
        'UPDATE user_account SET display_name = $1, updated_at = now() WHERE public_id = $2 AND deleted_at IS NULL',
        [body.displayName, publicId],
      );
      return userUpdateResult(reply, result.rowCount);
    }
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'UPDATE user_account SET disabled_at = CASE WHEN $1 THEN now() ELSE NULL END, updated_at = now() WHERE public_id = $2 AND deleted_at IS NULL RETURNING id',
        [body.disabled, publicId],
      );
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'USER_NOT_FOUND', error: 'The user was not found.' });
      }
      if (body.disabled === true)
        await client.query(
          'UPDATE user_session SET revoked_at = now() WHERE user_account_id = $1 AND revoked_at IS NULL',
          [result.rows[0]!.id],
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
  api.post(
    '/admin/users/:publicId/reset-password',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
        return;
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<{ id: string; email: string }>(
          'UPDATE user_account SET password_change_required = true, updated_at = now() WHERE public_id = $1 AND disabled_at IS NULL AND deleted_at IS NULL RETURNING id, email',
          [(request.params as { publicId: string }).publicId],
        );
        if (result.rowCount !== 1) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ code: 'USER_NOT_FOUND', error: 'The user was not found.' });
        }
        const user = result.rows[0]!;
        await client.query(
          'UPDATE user_session SET revoked_at = now() WHERE user_account_id = $1 AND revoked_at IS NULL',
          [user.id],
        );
        await client.query('COMMIT');
        const token: string = await createPasswordResetToken(pool, user.id, true);
        let delivered: boolean;
        try {
          delivered = await sendInstanceMail(
            pool,
            key,
            user.email,
            'Reset your Shadowcook password',
            `An administrator requires you to reset your Shadowcook password. Use this link: ${publicOrigin}/password-reset/${token}. The link expires in one hour.`,
          );
        } catch (error: unknown) {
          request.log.warn({ error }, 'Administrator password-reset email delivery failed');
          return reply.code(502).send({
            code: 'MAIL_DELIVERY_FAILED',
            error: 'The password-reset email could not be delivered.',
          });
        }
        if (!delivered)
          return reply.code(503).send({
            code: 'MAIL_NOT_CONFIGURED',
            error: 'The password-reset email could not be delivered.',
          });
        return reply.code(204).send();
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
  api.delete('/admin/users/:publicId', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'UPDATE user_account SET deleted_at = now(), disabled_at = now(), updated_at = now() WHERE public_id = $1 AND deleted_at IS NULL RETURNING id',
        [(request.params as { publicId: string }).publicId],
      );
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'USER_NOT_FOUND', error: 'The user was not found.' });
      }
      await client.query(
        'UPDATE user_session SET revoked_at = now() WHERE user_account_id = $1 AND revoked_at IS NULL',
        [result.rows[0]!.id],
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
      const editorRole = await client.query<{ id: string }>(
        "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Editor') RETURNING id",
        [tenant.id],
      );
      await client.query(
        "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code IN ('recipe:read', 'recipe:revision:read', 'recipe:create', 'recipe:update', 'variant:read', 'variant:create', 'variant:update', 'ingredient:read', 'ingredient:create', 'ingredient:update', 'category:read', 'category:update')",
        [editorRole.rows[0]!.id],
      );
      const viewerRole = await client.query<{ id: string }>(
        "INSERT INTO tenant_role (tenant_id, name) VALUES ($1, 'Viewer') RETURNING id",
        [tenant.id],
      );
      await client.query(
        "INSERT INTO tenant_role_permission (tenant_role_id, permission_code) SELECT $1, code FROM permission WHERE code IN ('recipe:read', 'variant:read', 'ingredient:read', 'category:read')",
        [viewerRole.rows[0]!.id],
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
        'SELECT id, principal_id FROM user_account WHERE email = $1 AND deleted_at IS NULL FOR UPDATE',
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
  api.get('/user-invitations/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const invitation = await userInvitationForToken(
      pool,
      (request.params as { token: string }).token,
    );
    if (invitation === null)
      return reply
        .code(404)
        .send({ code: 'USER_INVITATION_NOT_FOUND', error: 'The user invitation is unavailable.' });
    const settings: AuthenticationSettingsRow = await authenticationSettings(pool);
    return reply.send({
      email: invitation.invited_email,
      passwordRequired: settings.login_mode !== 'EMAIL_CODE_ONLY',
    });
  });
  api.post(
    '/user-invitations/:token/accept',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body: AcceptUserInvitationBody | null = parseAcceptUserInvitation(request.body);
      if (body === null)
        return reply
          .code(400)
          .send({ code: 'INVALID_USER_INVITATION', error: 'The invitation details are invalid.' });
      const invitation = await userInvitationForToken(
        pool,
        (request.params as { token: string }).token,
      );
      if (invitation === null)
        return reply.code(404).send({
          code: 'USER_INVITATION_NOT_FOUND',
          error: 'The user invitation is unavailable.',
        });
      const settings: AuthenticationSettingsRow = await authenticationSettings(pool);
      if (settings.login_mode !== 'EMAIL_CODE_ONLY' && body.password === undefined)
        return reply
          .code(400)
          .send({ code: 'INVALID_PASSWORD', error: 'A password is required for this invitation.' });
      let passwordHash: string | null = null;
      try {
        if (body.password !== undefined) passwordHash = await hashPassword(body.password);
      } catch (error: unknown) {
        return reply.code(400).send({
          code: 'INVALID_PASSWORD',
          error: error instanceof Error ? error.message : 'Invalid password.',
        });
      }
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const claimed = await client.query<{
          invited_email: string;
          tenant_id: string | null;
          tenant_role_id: string | null;
          instance_role_id: string | null;
        }>(
          'UPDATE user_invitation SET accepted_at = now() WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() RETURNING invited_email, tenant_id, tenant_role_id, instance_role_id',
          [hashToken((request.params as { token: string }).token)],
        );
        const claim = claimed.rows[0];
        if (claim === undefined) {
          await client.query('ROLLBACK');
          return reply.code(404).send({
            code: 'USER_INVITATION_NOT_FOUND',
            error: 'The user invitation is unavailable.',
          });
        }
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM user_account WHERE email = $1 AND deleted_at IS NULL FOR UPDATE',
          [claim.invited_email],
        );
        if (existing.rows[0] !== undefined) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            code: 'USER_EMAIL_CONFLICT',
            error: 'An active user already uses this email address.',
          });
        }
        const principal = await client.query<{ id: string }>(
          "INSERT INTO principal (principal_type) VALUES ('USER') RETURNING id",
        );
        await client.query(
          'INSERT INTO user_account (principal_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
          [principal.rows[0]!.id, claim.invited_email, body.displayName, passwordHash],
        );
        const globalRoleId: string =
          claim.instance_role_id ??
          (await client.query<{ id: string }>("SELECT id FROM instance_role WHERE code = 'user'"))
            .rows[0]!.id;
        await client.query(
          'INSERT INTO principal_instance_role (principal_id, instance_role_id) VALUES ($1, $2)',
          [principal.rows[0]!.id, globalRoleId],
        );
        if (claim.tenant_id !== null && claim.tenant_role_id !== null) {
          await client.query(
            'INSERT INTO tenant_membership (tenant_id, principal_id) VALUES ($1, $2)',
            [claim.tenant_id, principal.rows[0]!.id],
          );
          await client.query(
            'INSERT INTO tenant_membership_role (tenant_id, principal_id, tenant_role_id) VALUES ($1, $2, $3)',
            [claim.tenant_id, principal.rows[0]!.id, claim.tenant_role_id],
          );
        }
        await client.query('COMMIT');
        return reply.code(204).send();
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
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
function parseUpdateUser(value: unknown): UpdateUserBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const body: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof body.displayName === 'string' && body.displayName.trim().length > 0)
    return { displayName: body.displayName.trim() };
  if (typeof body.disabled === 'boolean') return { disabled: body.disabled };
  return null;
}
function parseUpdateInstanceRoles(value: unknown): UpdateInstanceRolesBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const roleCodes: unknown = (value as Record<string, unknown>).roleCodes;
  if (
    !Array.isArray(roleCodes) ||
    !roleCodes.every((code: unknown): boolean => typeof code === 'string')
  )
    return null;
  const uniqueCodes: string[] = [...new Set(roleCodes as string[])];
  return uniqueCodes.length === roleCodes.length ? { roleCodes: uniqueCodes } : null;
}
function parseCreateUserInvitation(value: unknown): CreateUserInvitationBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const body: Record<string, unknown> = value as Record<string, unknown>;
  return typeof body.email === 'string' && typeof body.roleCode === 'string'
    ? { email: body.email, roleCode: body.roleCode }
    : null;
}
function parseCreateTenantUserInvitation(value: unknown): CreateTenantUserInvitationBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const body: Record<string, unknown> = value as Record<string, unknown>;
  return typeof body.email === 'string' && typeof body.roleId === 'string'
    ? { email: body.email, roleId: body.roleId }
    : null;
}
function parseAcceptUserInvitation(value: unknown): AcceptUserInvitationBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const body: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof body.displayName !== 'string' || body.displayName.trim().length === 0) return null;
  if (body.password !== undefined && typeof body.password !== 'string') return null;
  return {
    displayName: body.displayName.trim(),
    password:
      typeof body.password === 'string' && body.password.length > 0 ? body.password : undefined,
  };
}
function userUpdateResult(reply: FastifyReply, rowCount: number | null): FastifyReply {
  return rowCount === 1
    ? reply.code(204).send()
    : reply.code(404).send({ code: 'USER_NOT_FOUND', error: 'The user was not found.' });
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
async function userInvitationForToken(
  pool: Pool,
  token: string,
): Promise<{ invited_email: string } | null> {
  const result = await pool.query<{ invited_email: string }>(
    'SELECT invited_email FROM user_invitation WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()',
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}
async function authenticationSettings(pool: Pool): Promise<AuthenticationSettingsRow> {
  const result = await pool.query<AuthenticationSettingsRow>(
    'SELECT login_mode FROM instance_authentication_settings WHERE singleton = true',
  );
  return result.rows[0] ?? { login_mode: 'PASSWORD_OR_EMAIL_CODE' };
}
