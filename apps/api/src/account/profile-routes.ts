import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { currentSessionUser, type AuthenticatedSessionUser } from '../auth/session.js';
import { parseAccountProfile, type AccountProfile } from './profile.js';

interface StoredAccountProfile {
  firstName: string | null;
  lastName: string | null;
  displayName: string;
}

export function registerAccountProfileRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/account/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
    if (user === null) return authenticationRequired(reply);
    const result: QueryResult<StoredAccountProfile> = await pool.query<StoredAccountProfile>(
      `SELECT first_name AS "firstName", last_name AS "lastName", display_name AS "displayName"
       FROM user_account WHERE id = $1`,
      [user.id],
    );
    return reply.send(result.rows[0]);
  });

  api.put('/account/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const user: AuthenticatedSessionUser | null = await currentSessionUser(pool, request);
    if (user === null) return authenticationRequired(reply);
    const profile: AccountProfile | null = parseAccountProfile(request.body);
    if (profile === null)
      return reply.code(400).send({
        code: 'INVALID_ACCOUNT_PROFILE',
        error: 'First name, last name, and display name must contain 1 to 120 characters each.',
      });
    await pool.query(
      `UPDATE user_account SET first_name = $1, last_name = $2, display_name = $3, updated_at = now()
       WHERE id = $4`,
      [profile.firstName, profile.lastName, profile.displayName, user.id],
    );
    return reply.send(profile);
  });
}

function authenticationRequired(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({
    code: 'AUTHENTICATION_REQUIRED',
    error: 'Authentication is required.',
  });
}
