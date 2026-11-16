import type { Pool } from 'pg';
import type { FastifyRequest } from 'fastify';
import { sendTemplatedInstanceMail } from '../mail/service.js';
import type { OwnershipTransfer } from './ownership-service.js';
export interface OwnershipNotification {
  recipient: 'OLD_OWNER' | 'NEW_OWNER';
  status: 'SENT' | 'FAILED';
}
export async function notifyOwnershipTransfer(
  pool: Pool,
  key: Buffer | null,
  origin: string,
  transfer: OwnershipTransfer,
  request: FastifyRequest,
): Promise<OwnershipNotification[]> {
  const outcomes: OwnershipNotification[] = [];
  for (const notification of transfer.notifications) {
    let sent: boolean = false;
    try {
      sent = await sendTemplatedInstanceMail(
        pool,
        key,
        notification.email,
        'COOKBOOK_OWNERSHIP_TRANSFERRED',
        {
          cookbook_name: transfer.cookbookName,
          cookbook_url: `${origin}/${transfer.cookbookSlug}`,
          old_owner_id: transfer.oldOwnerPublicId ?? '',
          new_owner_id: transfer.newOwnerPublicId,
        },
      );
    } catch {
      /* Delivery is independent of the committed ownership and audit transaction. */
    }
    outcomes.push({ recipient: notification.recipient, status: sent ? 'SENT' : 'FAILED' });
    if (!sent)
      request.log.warn(
        {
          requestId: request.id,
          cookbookPublicId: transfer.cookbookPublicId,
          recipient: notification.recipient,
          outcome: 'FAILED',
        },
        'Ownership notification failed',
      );
  }
  return outcomes;
}
