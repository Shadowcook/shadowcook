import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';
import {
  emailTemplateDefinition,
  emailTemplateDefinitions,
  templatePlaceholdersAreValid,
} from '../mail/templates.js';

interface EmailTemplateRow {
  template_key: string;
  subject_template: string;
  body_template: string;
}
interface TemplateBody {
  subject: string;
  body: string;
}

export function registerAdminEmailTemplateRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/email-templates', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:mail-manage')) === null)
      return;
    const result = await pool.query<EmailTemplateRow>(
      'SELECT template_key, subject_template, body_template FROM instance_email_template',
    );
    const customTemplates: Map<string, EmailTemplateRow> = new Map(
      result.rows.map((row: EmailTemplateRow): [string, EmailTemplateRow] => [
        row.template_key,
        row,
      ]),
    );
    return reply.send({
      templates: emailTemplateDefinitions.map((definition) => {
        const custom: EmailTemplateRow | undefined = customTemplates.get(definition.key);
        return {
          key: definition.key,
          subject: custom?.subject_template ?? definition.subject,
          body: custom?.body_template ?? definition.body,
          placeholders: definition.placeholders,
          customized: custom !== undefined,
        };
      }),
    });
  });
  api.put('/admin/email-templates/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(
      pool,
      request,
      reply,
      'instance:mail-manage',
    );
    if (principalId === null) return;
    const definition = emailTemplateDefinition((request.params as { key: string }).key);
    const body: TemplateBody | null = parseTemplateBody(request.body);
    if (
      definition === null ||
      body === null ||
      !templatePlaceholdersAreValid(body.subject, definition) ||
      !templatePlaceholdersAreValid(body.body, definition)
    )
      return reply
        .code(400)
        .send({ code: 'INVALID_EMAIL_TEMPLATE', error: 'The email template is invalid.' });
    await pool.query(
      `INSERT INTO instance_email_template (template_key, subject_template, body_template, updated_by_principal_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (template_key) DO UPDATE SET subject_template = EXCLUDED.subject_template, body_template = EXCLUDED.body_template, updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = now()`,
      [definition.key, body.subject, body.body, principalId],
    );
    return reply.code(204).send();
  });
  api.delete(
    '/admin/email-templates/:key',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if ((await requireInstancePermission(pool, request, reply, 'instance:mail-manage')) === null)
        return;
      const definition = emailTemplateDefinition((request.params as { key: string }).key);
      if (definition === null)
        return reply
          .code(404)
          .send({ code: 'EMAIL_TEMPLATE_NOT_FOUND', error: 'The email template was not found.' });
      await pool.query('DELETE FROM instance_email_template WHERE template_key = $1', [
        definition.key,
      ]);
      return reply.code(204).send();
    },
  );
}

function parseTemplateBody(value: unknown): TemplateBody | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('subject' in value) ||
    !('body' in value) ||
    typeof value.subject !== 'string' ||
    typeof value.body !== 'string'
  )
    return null;
  const subject: string = value.subject.trim();
  const body: string = value.body.trim();
  return subject.length > 0 && subject.length <= 300 && body.length > 0 && body.length <= 20_000
    ? { subject, body }
    : null;
}
