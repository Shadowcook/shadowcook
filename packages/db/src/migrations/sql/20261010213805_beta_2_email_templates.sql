CREATE TABLE instance_email_template (
  template_key text PRIMARY KEY CHECK (template_key IN (
    'REGISTRATION_VERIFICATION', 'LOGIN_CODE', 'PASSWORD_RESET', 'ADMIN_PASSWORD_RESET',
    'INSTANCE_USER_INVITATION', 'COOKBOOK_USER_INVITATION', 'COOKBOOK_OWNER_INVITATION'
  )),
  subject_template text NOT NULL CHECK (length(trim(subject_template)) BETWEEN 1 AND 300),
  body_template text NOT NULL CHECK (length(trim(body_template)) BETWEEN 1 AND 20000),
  updated_by_principal_id uuid REFERENCES principal(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
