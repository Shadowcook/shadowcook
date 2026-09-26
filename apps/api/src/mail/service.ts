import type { Pool } from 'pg';
import { loadSmtpConfiguration } from '../admin/mail-routes.js';
import { createSmtpTransport, senderAddress } from './smtp.js';

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
