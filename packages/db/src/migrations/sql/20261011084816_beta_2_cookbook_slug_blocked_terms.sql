CREATE TABLE instance_cookbook_slug_blocked_term (
  term text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_principal_id uuid REFERENCES principal(id) ON DELETE SET NULL,
  CONSTRAINT instance_cookbook_slug_blocked_term_format
    CHECK (term ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
