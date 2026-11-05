import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailTemplateDefinition } from '../../src/mail/templates.js';
import {
  emailTemplateDefinition,
  renderEmailTemplate,
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
