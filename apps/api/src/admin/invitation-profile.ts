import type { FastifyReply } from 'fastify';
import type { Pool, QueryResult } from 'pg';

export async function invitationAccountExists(pool: Pool, email: string): Promise<boolean> {
  const result: QueryResult<{ exists: boolean }> = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM user_account WHERE email = $1 AND deleted_at IS NULL) AS exists',
    [email],
  );
  return result.rows[0]?.exists === true;
}

export function invalidInvitationProfile(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({
    code: 'INVALID_ACCOUNT_PROFILE',
    error: 'First name, last name, and display name must contain 1 to 120 characters each.',
  });
}
