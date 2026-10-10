ALTER TABLE tenant ADD COLUMN owner_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT;

UPDATE tenant
SET owner_principal_id = (
  SELECT tenant_membership_role.principal_id
  FROM tenant_membership_role
  INNER JOIN tenant_role ON tenant_role.id = tenant_membership_role.tenant_role_id
  INNER JOIN tenant_membership
    ON tenant_membership.tenant_id = tenant_membership_role.tenant_id
    AND tenant_membership.principal_id = tenant_membership_role.principal_id
  WHERE tenant_membership_role.tenant_id = tenant.id AND tenant_role.name = 'Owner'
  ORDER BY tenant_membership.joined_at, tenant_membership_role.principal_id
  LIMIT 1
);

DELETE FROM tenant_membership_role
USING tenant_role, tenant
WHERE tenant_role.id = tenant_membership_role.tenant_role_id
  AND tenant_role.name = 'Owner'
  AND tenant.id = tenant_membership_role.tenant_id
  AND tenant.owner_principal_id IS DISTINCT FROM tenant_membership_role.principal_id;

ALTER TABLE tenant
  ADD CONSTRAINT tenant_owner_membership_fk
  FOREIGN KEY (id, owner_principal_id) REFERENCES tenant_membership(tenant_id, principal_id) ON DELETE RESTRICT;

ALTER TABLE instance_registration_settings
  ADD COLUMN max_cookbooks_per_owner integer NOT NULL DEFAULT 1
  CHECK (max_cookbooks_per_owner BETWEEN 1 AND 100);
