ALTER TABLE pending_registration
  ALTER COLUMN tenant_name DROP NOT NULL,
  DROP CONSTRAINT pending_registration_tenant_name_check;

ALTER TABLE pending_registration
  ADD CONSTRAINT pending_registration_tenant_name_check
  CHECK (tenant_name IS NULL OR length(trim(tenant_name)) BETWEEN 1 AND 120);
