CREATE TABLE oauth_client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_name text NOT NULL CHECK (length(trim(client_name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_client_redirect_uri (
  oauth_client_id uuid NOT NULL REFERENCES oauth_client(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  PRIMARY KEY (oauth_client_id, redirect_uri)
);

CREATE TABLE oauth_authorization_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash bytea NOT NULL UNIQUE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE oauth_access_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  client_id text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE oauth_refresh_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  client_id text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX oauth_access_token_active_lookup_idx
  ON oauth_access_token(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX oauth_refresh_token_active_lookup_idx
  ON oauth_refresh_token(token_hash)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;
