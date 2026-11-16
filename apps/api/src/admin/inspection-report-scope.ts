export const inspectionReportScope: string = `(c.target_type = 'COOKBOOK' AND c.target_public_id = t.public_id) OR
  (c.target_type = 'RECIPE' AND EXISTS (SELECT 1 FROM recipe r WHERE r.tenant_id = t.id AND r.public_id = c.target_public_id))`;
