CREATE TABLE account_email_change (
  user_account_id uuid PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
  new_email text NOT NULL CHECK (new_email = lower(trim(new_email)) AND length(new_email) BETWEEN 3 AND 254),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL,
  send_count integer NOT NULL CHECK (send_count > 0)
);

ALTER TABLE instance_email_template DROP CONSTRAINT instance_email_template_template_key_check;
ALTER TABLE instance_email_template ADD CONSTRAINT instance_email_template_template_key_check
  CHECK (template_key IN (
    'REGISTRATION_VERIFICATION', 'EMAIL_CHANGE_VERIFICATION', 'LOGIN_CODE',
    'PASSWORD_RESET', 'ADMIN_PASSWORD_RESET', 'INSTANCE_USER_INVITATION',
    'COOKBOOK_USER_INVITATION', 'COOKBOOK_OWNER_INVITATION'
  ));
