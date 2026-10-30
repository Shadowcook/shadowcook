import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';

const maximumMarkdownLength: number = 50000;

interface LegalDocumentsRow {
  privacy_statement_markdown: string;
  imprint_markdown: string;
}

interface LegalDocumentsBody {
  privacyStatementMarkdown: string;
  imprintMarkdown: string;
}

export function registerLegalDocumentRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/legal-documents', async (_request: FastifyRequest, reply: FastifyReply) => {
    const documents: LegalDocumentsRow = await legalDocuments(pool);
    return reply.send(toResponse(documents));
  });

  api.get('/admin/legal-documents', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    return reply.send(toResponse(await legalDocuments(pool)));
  });

  api.put('/admin/legal-documents', async (request: FastifyRequest, reply: FastifyReply) => {
    const principalId: string | null = await requireInstancePermission(
      pool,
      request,
      reply,
      'instance:administer',
    );
    if (principalId === null) return;
    const body: LegalDocumentsBody | null = parseLegalDocuments(request.body);
    if (body === null)
      return reply.code(400).send({
        code: 'INVALID_LEGAL_DOCUMENTS',
        error: 'The legal document content is invalid.',
      });
    await pool.query(
      `INSERT INTO instance_legal_documents
        (singleton, privacy_statement_markdown, imprint_markdown, updated_by_principal_id)
       VALUES (true, $1, $2, $3)
       ON CONFLICT (singleton) DO UPDATE SET
         privacy_statement_markdown = EXCLUDED.privacy_statement_markdown,
         imprint_markdown = EXCLUDED.imprint_markdown,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id,
         updated_at = now()`,
      [body.privacyStatementMarkdown, body.imprintMarkdown, principalId],
    );
    return reply.code(204).send();
  });
}

async function legalDocuments(pool: Pool): Promise<LegalDocumentsRow> {
  const result = await pool.query<LegalDocumentsRow>(
    'SELECT privacy_statement_markdown, imprint_markdown FROM instance_legal_documents WHERE singleton = true',
  );
  return result.rows[0] ?? { privacy_statement_markdown: '', imprint_markdown: '' };
}

function toResponse(documents: LegalDocumentsRow): LegalDocumentsBody {
  return {
    privacyStatementMarkdown: documents.privacy_statement_markdown,
    imprintMarkdown: documents.imprint_markdown,
  };
}

function parseLegalDocuments(value: unknown): LegalDocumentsBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const body: Record<string, unknown> = value as Record<string, unknown>;
  const privacyStatementMarkdown: unknown = body.privacyStatementMarkdown;
  const imprintMarkdown: unknown = body.imprintMarkdown;
  if (!isMarkdown(privacyStatementMarkdown) || !isMarkdown(imprintMarkdown)) return null;
  return { privacyStatementMarkdown, imprintMarkdown };
}

function isMarkdown(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maximumMarkdownLength;
}
