INSERT INTO tenant_role_permission (tenant_role_id, permission_code)
SELECT tenant_role.id, permission.code
FROM tenant_role
CROSS JOIN permission
WHERE tenant_role.name = 'Owner'
  AND permission.code NOT LIKE 'instance:%'
  AND permission.code <> 'tenant:create'
ON CONFLICT DO NOTHING;
