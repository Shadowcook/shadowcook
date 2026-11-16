import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { sendTemplatedInstanceMail } from '../mail/service.js';
import type {
  CookbookNotificationRecipient,
  RecipeNotificationRecipient,
} from './content-notification-recipients.js';

export interface DeletionNotification {
  recipient: CookbookNotificationRecipient | RecipeNotificationRecipient | null;
  userReason: string;
}

export async function notifyAdministrativeDeletion(
  pool: Pool,
  key: Buffer | null,
  cookbookId: string,
  recipeId: string | undefined,
  notification: DeletionNotification,
  request: FastifyRequest,
): Promise<void> {
  const recipient: CookbookNotificationRecipient | RecipeNotificationRecipient | null =
    notification.recipient;
  let sent: boolean = false;
  if (recipient) {
    const variables: Record<string, string> = {
      cookbook_name: recipient.cookbookName,
      cookbook_id: cookbookId,
      user_reason: notification.userReason,
    };
    if (recipeId && 'recipeName' in recipient) {
      variables.recipe_name = recipient.recipeName;
      variables.recipe_id = recipeId;
    }
    try {
      sent = await sendTemplatedInstanceMail(
        pool,
        key,
        recipient.email,
        recipeId ? 'RECIPE_DELETED' : 'COOKBOOK_DELETED',
        variables,
      );
    } catch {
      /* Deletion has committed. Do not log addresses, authored text or transport errors. */
    }
  }
  request.log[sent ? 'info' : 'warn'](
    {
      requestId: request.id,
      cookbookPublicId: cookbookId,
      ...(recipeId ? { recipePublicId: recipeId } : {}),
      outcome: sent ? 'SENT' : recipient ? 'FAILED' : 'NO_RECIPIENT',
    },
    'Administrative deletion notification',
  );
}
