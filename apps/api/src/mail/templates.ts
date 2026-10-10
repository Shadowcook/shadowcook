export const emailTemplateKeys = [
  'REGISTRATION_VERIFICATION',
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
    key: 'REGISTRATION_VERIFICATION',
    subject: 'Verify your {{instance_name}} email address',
    body: 'Hello {{recipient_name}},\n\nVerify your email address to create your {{instance_name}} account: {{action_url}}\n\nThis link expires in {{expires_in}}.',
    placeholders: [...commonPlaceholders, 'cookbook_name'],
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
