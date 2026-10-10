import type { Pool } from 'pg';
import { loadSmtpConfiguration } from '../admin/mail-routes.js';
import { createSmtpTransport, senderAddress } from './smtp.js';
import { emailTemplateDefinition, renderEmailTemplate } from './templates.js';
import type { EmailTemplateKey } from './templates.js';

export async function sendInstanceMail(
  pool: Pool,
  instanceSecretKey: Buffer | null,
  recipient: string,
  subject: string,
  text: string,
): Promise<boolean> {
  if (instanceSecretKey === null) return false;
  const configuration = await loadSmtpConfiguration(pool, instanceSecretKey);
  if (configuration === null) return false;
  const transport = createSmtpTransport(configuration);
  await transport.sendMail({ from: senderAddress(configuration), to: recipient, subject, text });
  return true;
}

export async function sendTemplatedInstanceMail(
  pool: Pool,
  instanceSecretKey: Buffer | null,
  recipient: string,
  templateKey: EmailTemplateKey,
  variables: Readonly<Record<string, string>>,
): Promise<boolean> {
  const definition = emailTemplateDefinition(templateKey);
  if (definition === null) throw new Error(`Unknown email template: ${templateKey}`);
  const result = await pool.query<{ subject_template: string; body_template: string }>(
    'SELECT subject_template, body_template FROM instance_email_template WHERE template_key = $1',
    [templateKey],
  );
  const template = result.rows[0] ?? {
    subject_template: definition.subject,
    body_template: definition.body,
  };
  const instance = await pool.query<{ site_name: string }>(
    'SELECT site_name FROM instance_frontpage_settings WHERE singleton = true',
  );
  const recipientAccount = await pool.query<{ display_name: string }>(
    'SELECT display_name FROM user_account WHERE email = $1 AND deleted_at IS NULL',
    [recipient],
  );
  const resolvedVariables: Record<string, string> = {
    instance_name: instance.rows[0]?.site_name ?? 'Shadowcook',
    recipient_name: recipientAccount.rows[0]?.display_name ?? recipient,
    ...variables,
    recipient_email: recipient,
  };
  return sendInstanceMail(
    pool,
    instanceSecretKey,
    recipient,
    renderEmailTemplate(template.subject_template, resolvedVariables),
    renderEmailTemplate(template.body_template, resolvedVariables),
  );
}
