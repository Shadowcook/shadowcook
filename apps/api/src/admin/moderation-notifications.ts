import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type {
  CookbookNotificationRecipient,
  RecipeNotificationRecipient,
} from './content-notification-recipients.js';
import { sendTemplatedInstanceMail } from '../mail/service.js';
import type { EmailTemplateKey } from '../mail/templates.js';

export async function notifyModerationRestriction(
  pool: Pool,
  key: Buffer | null,
  origin: string,
  cookbookId: string,
  recipeId: string | undefined,
  notification: CookbookNotificationRecipient | RecipeNotificationRecipient | null,
  userReason: string,
  blocked: boolean,
  request: FastifyRequest,
): Promise<void> {
  let sent: boolean = false;
  const templateKey: EmailTemplateKey = recipeId
    ? blocked
      ? 'RECIPE_RESTRICTED'
      : 'RECIPE_RESTRICTION_LIFTED'
    : blocked
      ? 'COOKBOOK_RESTRICTED'
      : 'COOKBOOK_RESTRICTION_LIFTED';
  if (notification) {
    const variables: Record<string, string> = {
      cookbook_name: notification.cookbookName,
      user_reason: userReason,
      cookbook_id: cookbookId,
      cookbook_url: `${origin}/${notification.cookbookSlug}`,
    };
    if (recipeId && 'recipeName' in notification) {
      variables.recipe_name = notification.recipeName;
      variables.recipe_id = recipeId;
      variables.recipe_url = `${origin}/${notification.cookbookSlug}/recipes/${notification.recipeSlug}`;
    }
    try {
      sent = await sendTemplatedInstanceMail(pool, key, notification.email, templateKey, variables);
    } catch {
      /* The restriction and its audit have committed. Never log private transport details. */
    }
  }
  request.log[sent ? 'info' : 'warn'](
    {
      requestId: request.id,
      cookbookPublicId: cookbookId,
      blocked,
      ...(recipeId ? { recipePublicId: recipeId } : {}),
      outcome: sent ? 'SENT' : notification ? 'FAILED' : 'NO_RECIPIENT',
    },
    recipeId ? 'Recipe restriction notification' : 'Cookbook restriction notification',
  );
}
