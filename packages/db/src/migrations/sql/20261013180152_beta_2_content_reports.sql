CREATE TABLE instance_report_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  recipient_email text CHECK (recipient_email IS NULL OR length(trim(recipient_email)) BETWEEN 3 AND 254),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT
);
INSERT INTO instance_report_settings (singleton) VALUES (true);

CREATE TABLE content_report (
  public_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('RECIPE', 'USER', 'COOKBOOK')),
  target_public_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ILLEGAL_CONTENT', 'IMPROPER_NAME', 'HARASSMENT', 'SPAM', 'OTHER')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_INVESTIGATION', 'CLOSED')),
  result text CHECK (result IN ('BLOCKED', 'UNFOUNDED', 'USER_DELETED', 'COOKBOOK_DELETED', 'RECIPE_DELETED', 'OTHER')),
  result_note text NOT NULL DEFAULT '' CHECK (length(result_note) <= 5000),
  assigned_admin_user_id uuid REFERENCES user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'CLOSED') = (result IS NOT NULL))
);
CREATE INDEX content_report_status_created_idx ON content_report(status, created_at DESC);
CREATE INDEX content_report_reporter_created_idx ON content_report(reporter_user_id, created_at DESC);

CREATE TABLE content_report_notification (
  report_public_id uuid PRIMARY KEY REFERENCES content_report(public_id) ON DELETE CASCADE,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_report_notification_pending_idx ON content_report_notification(next_attempt_at) WHERE sent_at IS NULL;

ALTER TABLE instance_email_template DROP CONSTRAINT instance_email_template_template_key_check;
ALTER TABLE instance_email_template ADD CONSTRAINT instance_email_template_template_key_check
  CHECK (template_key IN ('CONTENT_REPORT', 'REGISTRATION_VERIFICATION', 'EMAIL_CHANGE_VERIFICATION', 'LOGIN_CODE',
    'PASSWORD_RESET', 'ADMIN_PASSWORD_RESET', 'INSTANCE_USER_INVITATION', 'COOKBOOK_USER_INVITATION', 'COOKBOOK_OWNER_INVITATION'));
