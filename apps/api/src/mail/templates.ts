export const emailTemplateKeys = [
  'RECIPE_DELETED',
  'COOKBOOK_DELETED',
  'COOKBOOK_RESTRICTION_LIFTED',
  'RECIPE_RESTRICTION_LIFTED',
  'COOKBOOK_RESTRICTED',
  'RECIPE_RESTRICTED',
  'COOKBOOK_OWNERSHIP_TRANSFERRED',
  'REPORT_DECISION_NOTICE',
  'ADMIN_EMAIL_RECOVERY_PROOF',
  'ADMIN_EMAIL_RECOVERED',
  'CONTENT_REPORT',
  'REGISTRATION_VERIFICATION',
  'EMAIL_CHANGE_VERIFICATION',
  'LOGIN_CODE',
  'PASSWORD_RESET',
  'ADMIN_PASSWORD_RESET',
  'INSTANCE_USER_INVITATION',
  'COOKBOOK_USER_INVITATION',
  'COOKBOOK_OWNER_INVITATION',
] as const;

export type EmailTemplateKey = (typeof emailTemplateKeys)[number];

export interface EmailTemplateDefinition {
  key: EmailTemplateKey;
  subject: string;
  body: string;
  placeholders: readonly string[];
}

const commonPlaceholders: readonly string[] = [
  'instance_name',
  'recipient_name',
  'recipient_email',
  'action_url',
  'expires_in',
];

export const emailTemplateDefinitions: readonly EmailTemplateDefinition[] = [
  {
    key: 'RECIPE_DELETED',
    subject: 'Recipe permanently deleted: {{recipe_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator has permanently deleted the recipe "{{recipe_name}}" from your cookbook "{{cookbook_name}}" on {{instance_name}}.\n\nThe recipe and its history have been removed from the application. This was a permanent deletion, not a move to trash, and the recipe cannot be restored from the application trash. Your cookbook and its memberships remain.\n\nRecipe ID: {{recipe_id}}\nCookbook ID: {{cookbook_id}}\n\n{{user_reason}}\n\nIf you have questions, contact your platform administrator and include the reference above.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'recipe_name',
      'recipe_id',
      'cookbook_name',
      'cookbook_id',
      'user_reason',
    ],
  },
  {
    key: 'COOKBOOK_DELETED',
    subject: 'Cookbook permanently deleted: {{cookbook_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator has permanently deleted your cookbook "{{cookbook_name}}" on {{instance_name}}.\n\nThe cookbook, its recipes, history, shares and memberships have been removed from the application. This was a permanent deletion, not a move to trash, and the cookbook cannot be restored from the application trash. User accounts remain.\n\nCookbook ID: {{cookbook_id}}\n\n{{user_reason}}\n\nIf you have questions, contact your platform administrator and include the reference above.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'cookbook_name',
      'cookbook_id',
      'user_reason',
    ],
  },
  {
    key: 'COOKBOOK_RESTRICTION_LIFTED',
    subject: 'Cookbook restriction lifted: {{cookbook_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator has lifted the administrative access restriction on your cookbook "{{cookbook_name}}" on {{instance_name}}.\n\nExisting memberships and content are preserved. Access still depends on ordinary permissions, visibility and any remaining cookbook identity reset or individual recipe restrictions. Lifting this restriction does not publish or restore recipes.\n\nCookbook: {{cookbook_url}}\nCookbook ID: {{cookbook_id}}\n\n{{user_reason}}\n\nIf you have questions, contact your platform administrator.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'user_reason',
      'cookbook_name',
      'cookbook_url',
      'cookbook_id',
    ],
  },
  {
    key: 'RECIPE_RESTRICTION_LIFTED',
    subject: 'Recipe restriction lifted: {{recipe_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator has lifted the administrative access restriction on the recipe "{{recipe_name}}" in your cookbook "{{cookbook_name}}" on {{instance_name}}.\n\nThe recipe retains its previous publication, visibility and trash state. Access still depends on ordinary permissions and any remaining cookbook restrictions or identity reset. Lifting this restriction does not publish or restore the recipe.\n\nRecipe: {{recipe_url}}\nRecipe ID: {{recipe_id}}\n\n{{user_reason}}\n\nIf you have questions, contact your platform administrator.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'user_reason',
      'cookbook_name',
      'recipe_name',
      'recipe_url',
      'recipe_id',
    ],
  },
  {
    key: 'COOKBOOK_RESTRICTED',
    subject: 'Cookbook restricted: {{cookbook_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator has restricted access to your cookbook "{{cookbook_name}}" on {{instance_name}}.\n\nThe cookbook and its recipes are currently unavailable through ordinary access, including to cookbook owners and editors. Content, history and memberships have been preserved.\n\nCookbook reference (unavailable while restricted): {{cookbook_url}}\nCookbook ID: {{cookbook_id}}\n\nReason given to you:\n{{user_reason}}\n\nIf you have questions or would like to request a review, contact your platform administrator.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'user_reason',
      'cookbook_name',
      'cookbook_url',
      'cookbook_id',
    ],
  },
  {
    key: 'RECIPE_RESTRICTED',
    subject: 'Recipe restricted: {{recipe_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator has restricted access to the recipe "{{recipe_name}}" in your cookbook "{{cookbook_name}}" on {{instance_name}}.\n\nThe recipe is currently unavailable through ordinary access, including to cookbook owners and editors. Its content and history have been preserved.\n\nRecipe reference (unavailable while restricted): {{recipe_url}}\nRecipe ID: {{recipe_id}}\n\nReason given to you:\n{{user_reason}}\n\nIf you have questions or would like to request a review, contact your platform administrator.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'user_reason',
      'cookbook_name',
      'recipe_name',
      'recipe_url',
      'recipe_id',
    ],
  },
  {
    key: 'REPORT_DECISION_NOTICE',
    subject: 'Review notice from {{instance_name}}',
    body: 'Hello {{recipient_name}},\n\n{{notice_message}}\n\nHow to request a review:\n{{review_instructions}}\n\nReference: {{report_id}} / {{notice_id}}',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'report_id',
      'notice_id',
      'notice_message',
      'review_instructions',
    ],
  },
  {
    key: 'ADMIN_EMAIL_RECOVERY_PROOF',
    subject: 'Verify your account recovery email',
    body: 'An administrator requested an account email correction. Confirm your new email address by opening this link within one hour:\n\n{{action_url}}\n\nYour current address remains unchanged until you confirm. Ignore this message if you did not request recovery.',
    placeholders: commonPlaceholders,
  },
  {
    key: 'ADMIN_EMAIL_RECOVERED',
    subject: 'Account email corrected',
    body: 'An administrator corrected your account email address after verification. Existing sessions and recovery credentials were revoked. Contact your platform administrator if you did not request this.',
    placeholders: ['recipient_name', 'recipient_email', 'instance_name'],
  },
  {
    key: 'COOKBOOK_OWNERSHIP_TRANSFERRED',
    subject: 'Ownership changed: {{cookbook_name}}',
    body: 'Hello {{recipient_name}},\n\nA platform administrator transferred ownership of {{cookbook_name}}.\nPrevious owner account: {{old_owner_id}}\nNew owner account: {{new_owner_id}}\nCookbook: {{cookbook_url}}\n\nIf you need a review, contact your platform administrator.',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'cookbook_name',
      'cookbook_url',
      'old_owner_id',
      'new_owner_id',
    ],
  },
  {
    key: 'CONTENT_REPORT',
    subject: 'New {{instance_name}} report: {{reason}}',
    body: 'A new content report was submitted.\n\nTicket: {{report_id}}\nTarget: {{target_type}} {{target_id}}\nReason: {{reason}}\n\n{{description}}\n\nReview: {{action_url}}',
    placeholders: [
      'instance_name',
      'recipient_name',
      'recipient_email',
      'action_url',
      'report_id',
      'target_type',
      'target_id',
      'reason',
      'description',
    ],
  },
  {
    key: 'EMAIL_CHANGE_VERIFICATION',
    subject: 'Confirm your new {{instance_name}} email address',
    body: 'Hello {{recipient_name}},\n\nConfirm this email address for your {{instance_name}} account: {{action_url}}\n\nYour current address remains unchanged until you confirm. This link expires in {{expires_in}}. If you did not request this change, ignore this email.',
    placeholders: commonPlaceholders,
  },
  {
    key: 'REGISTRATION_VERIFICATION',
    subject: 'Verify your {{instance_name}} email address',
    body: 'Hello {{first_name}},\n\nVerify your email address to create your {{instance_name}} account: {{action_url}}\n\nThis link expires in {{expires_in}}.',
    placeholders: [
      ...commonPlaceholders,
      'cookbook_name',
      'first_name',
      'last_name',
      'display_name',
    ],
  },
  {
    key: 'LOGIN_CODE',
    subject: 'Your {{instance_name}} sign-in code',
    body: 'Hello {{recipient_name}},\n\nYour {{instance_name}} sign-in code is {{code}}. It expires in {{expires_in}}.',
    placeholders: ['instance_name', 'recipient_name', 'recipient_email', 'code', 'expires_in'],
  },
  {
    key: 'PASSWORD_RESET',
    subject: 'Reset your {{instance_name}} password',
    body: 'Hello {{recipient_name}},\n\nUse this link to reset your {{instance_name}} password: {{action_url}}\n\nThis link expires in {{expires_in}}.',
    placeholders: commonPlaceholders,
  },
  {
    key: 'ADMIN_PASSWORD_RESET',
    subject: 'Reset your {{instance_name}} password',
    body: 'Hello {{recipient_name}},\n\n{{inviter_name}} requires you to reset your {{instance_name}} password. Use this link: {{action_url}}\n\nThis link expires in {{expires_in}}.',
    placeholders: [...commonPlaceholders, 'inviter_name'],
  },
  {
    key: 'INSTANCE_USER_INVITATION',
    subject: 'You are invited to {{instance_name}}',
    body: 'Hello {{recipient_name}},\n\n{{inviter_name}} invited you to {{instance_name}}. Open {{action_url}} to create your account.\n\nThis link expires in {{expires_in}}.',
    placeholders: [...commonPlaceholders, 'inviter_name'],
  },
  {
    key: 'COOKBOOK_USER_INVITATION',
    subject: 'You are invited to {{cookbook_name}}',
    body: 'Hello {{recipient_name}},\n\n{{inviter_name}} invited you to the {{cookbook_name}} cookbook. Open {{action_url}} to join it.\n\nCookbook: {{cookbook_url}}\nThis link expires in {{expires_in}}.',
    placeholders: [...commonPlaceholders, 'inviter_name', 'cookbook_name', 'cookbook_url'],
  },
  {
    key: 'COOKBOOK_OWNER_INVITATION',
    subject: 'You are invited to {{cookbook_name}}',
    body: 'Hello {{recipient_name}},\n\n{{inviter_name}} invited you to own the {{cookbook_name}} cookbook. Open {{action_url}} and enter this code: {{code}}.\n\nCookbook: {{cookbook_url}}\nThe code expires in {{expires_in}}.',
    placeholders: [...commonPlaceholders, 'inviter_name', 'cookbook_name', 'cookbook_url', 'code'],
  },
];

export function emailTemplateDefinition(key: string): EmailTemplateDefinition | null {
  return (
    emailTemplateDefinitions.find(
      (definition: EmailTemplateDefinition): boolean => definition.key === key,
    ) ?? null
  );
}

export function templatePlaceholdersAreValid(
  value: string,
  definition: EmailTemplateDefinition,
): boolean {
  const matches: RegExpMatchArray[] = [...value.matchAll(/{{\s*([^{}\s]+)\s*}}/g)];
  if (
    !matches.every((match: RegExpMatchArray): boolean =>
      definition.placeholders.includes(match[1]!),
    )
  )
    return false;
  const remaining: string = value.replace(/{{\s*([^{}\s]+)\s*}}/g, '');
  return !remaining.includes('{{') && !remaining.includes('}}');
}

export function renderEmailTemplate(
  value: string,
  variables: Readonly<Record<string, string>>,
): string {
  return value.replace(
    /{{\s*([^{}\s]+)\s*}}/g,
    (_match: string, name: string): string => variables[name] ?? '',
  );
}

export function renderEmailBody(
  value: string,
  key: EmailTemplateKey,
  variables: Readonly<Record<string, string>>,
): string {
  const rendered: string = renderEmailTemplate(value, variables);
  if (
    (key === 'RECIPE_RESTRICTED' ||
      key === 'RECIPE_DELETED' ||
      key === 'COOKBOOK_DELETED' ||
      key === 'COOKBOOK_RESTRICTED' ||
      key === 'RECIPE_RESTRICTION_LIFTED' ||
      key === 'COOKBOOK_RESTRICTION_LIFTED') &&
    !/{{\s*user_reason\s*}}/.test(value) &&
    variables.user_reason
  )
    return `${rendered}\n\n${variables.user_reason}`;
  return rendered;
}
