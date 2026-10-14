CREATE TABLE password_login_failure (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_ip inet NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX password_login_failure_client_time_idx
  ON password_login_failure (client_ip, created_at);

CREATE INDEX password_login_failure_created_at_idx
  ON password_login_failure (created_at);
