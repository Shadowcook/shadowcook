import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailTemplateDefinition } from '../../src/mail/templates.js';
import {
  emailTemplateDefinition,
  renderEmailTemplate,
  renderEmailBody,
  templatePlaceholdersAreValid,
} from '../../src/mail/templates.js';

test('email templates only accept placeholders defined for their message type', (): void => {
  const definition = emailTemplateDefinition('COOKBOOK_USER_INVITATION');
  assert.notEqual(definition, null);
  if (definition === null) throw new Error('Expected cookbook invitation email template.');
  assert.equal(
    templatePlaceholdersAreValid('{{inviter_name}} invited you to {{cookbook_name}}.', definition),
    true,
  );
  assert.equal(templatePlaceholdersAreValid('Hello {{recipient_name}}', definition), true);
  assert.equal(templatePlaceholdersAreValid('{{inviter_email}}', definition), false);
  assert.equal(templatePlaceholdersAreValid('{{code}}', definition), false);
  assert.equal(templatePlaceholdersAreValid('{{not_a_placeholder}}', definition), false);
  assert.equal(templatePlaceholdersAreValid('{{ }}', definition), false);
});

test('restriction email bodies always include the separate public reason, without interpreting its content', (): void => {
  const variables: Readonly<Record<string, string>> = {
    user_reason: 'Please remove {{private_note}}.\nThen request review.',
  };
  for (const key of [
    'RECIPE_RESTRICTED',
    'COOKBOOK_RESTRICTED',
    'RECIPE_RESTRICTION_LIFTED',
    'COOKBOOK_RESTRICTION_LIFTED',
    'RECIPE_DELETED',
    'COOKBOOK_DELETED',
  ] as const) {
    const definition: EmailTemplateDefinition | null = emailTemplateDefinition(key);
    assert.ok(definition);
    assert.equal(templatePlaceholdersAreValid('{{user_reason}}', definition), true);
    assert.equal(templatePlaceholdersAreValid('{{reason}}', definition), false);
    assert.ok(renderEmailBody(definition.body, key, variables).includes(variables.user_reason!));
    assert.equal(
      renderEmailBody('Reason: {{ user_reason }}', key, variables),
      `Reason: ${variables.user_reason}`,
    );
    assert.equal(
      renderEmailBody('Customized message', key, variables),
      `Customized message\n\n${variables.user_reason}`,
    );
  }
  assert.equal(renderEmailBody('Other message', 'LOGIN_CODE', variables), 'Other message');
});

test('registration templates allow pending profile names and greet by first name by default', (): void => {
  const registration: EmailTemplateDefinition | null = emailTemplateDefinition(
    'REGISTRATION_VERIFICATION',
  );
  const login: EmailTemplateDefinition | null = emailTemplateDefinition('LOGIN_CODE');
  assert.ok(registration);
  assert.ok(login);
  assert.ok(registration.body.startsWith('Hello {{first_name}},'));
  for (const placeholder of ['first_name', 'last_name', 'display_name']) {
    assert.equal(templatePlaceholdersAreValid(`{{${placeholder}}}`, registration), true);
    assert.equal(templatePlaceholdersAreValid(`{{${placeholder}}}`, login), false);
  }
});

test('email template rendering replaces recognized values without evaluating content', (): void => {
  assert.equal(
    renderEmailTemplate('Open {{action_url}}. {{unknown}}', {
      action_url: 'https://example.test/invite',
    }),
    'Open https://example.test/invite. ',
  );
});
