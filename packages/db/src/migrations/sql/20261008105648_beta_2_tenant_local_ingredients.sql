CREATE TEMPORARY TABLE global_ingredient_tenant_map (
  source_ingredient_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  target_ingredient_id uuid NOT NULL,
  target_exists boolean NOT NULL,
  PRIMARY KEY (source_ingredient_id, tenant_id)
) ON COMMIT DROP;

INSERT INTO global_ingredient_tenant_map (
  source_ingredient_id,
  tenant_id,
  target_ingredient_id,
  target_exists
)
SELECT ingredient_tenant.source_ingredient_id,
  ingredient_tenant.tenant_id,
  COALESCE(existing_ingredient.id, gen_random_uuid()),
  existing_ingredient.id IS NOT NULL
FROM (
  SELECT DISTINCT ingredient_usage.ingredient_id AS source_ingredient_id,
    recipe.tenant_id
  FROM ingredient_usage
  INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
  INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
  INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
  WHERE ingredient_usage.ingredient_id IS NOT NULL
) AS ingredient_tenant
INNER JOIN ingredient ON ingredient.id = ingredient_tenant.source_ingredient_id
LEFT JOIN ingredient AS existing_ingredient
  ON existing_ingredient.owner_tenant_id = ingredient_tenant.tenant_id
  AND existing_ingredient.canonical_name = ingredient.canonical_name
WHERE ingredient.owner_tenant_id IS NULL;

INSERT INTO ingredient (id, owner_tenant_id, public_id, canonical_name, created_at)
SELECT global_ingredient_tenant_map.target_ingredient_id,
  global_ingredient_tenant_map.tenant_id,
  gen_random_uuid(),
  ingredient.canonical_name,
  ingredient.created_at
FROM global_ingredient_tenant_map
INNER JOIN ingredient ON ingredient.id = global_ingredient_tenant_map.source_ingredient_id
WHERE global_ingredient_tenant_map.target_exists = false;

CREATE TEMPORARY TABLE global_ingredient_alias_tenant_map (
  source_alias_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  target_alias_id uuid NOT NULL,
  target_exists boolean NOT NULL,
  PRIMARY KEY (source_alias_id, tenant_id)
) ON COMMIT DROP;

INSERT INTO global_ingredient_alias_tenant_map (
  source_alias_id,
  tenant_id,
  target_alias_id,
  target_exists
)
SELECT ingredient_alias.id,
  global_ingredient_tenant_map.tenant_id,
  COALESCE(existing_alias.id, gen_random_uuid()),
  existing_alias.id IS NOT NULL
FROM ingredient_alias
INNER JOIN global_ingredient_tenant_map
  ON global_ingredient_tenant_map.source_ingredient_id = ingredient_alias.ingredient_id
LEFT JOIN ingredient_alias AS existing_alias
  ON existing_alias.ingredient_id = global_ingredient_tenant_map.target_ingredient_id
  AND existing_alias.alias = ingredient_alias.alias;

INSERT INTO ingredient_alias (id, ingredient_id, public_id, alias)
SELECT global_ingredient_alias_tenant_map.target_alias_id,
  global_ingredient_tenant_map.target_ingredient_id,
  gen_random_uuid(),
  ingredient_alias.alias
FROM global_ingredient_alias_tenant_map
INNER JOIN ingredient_alias ON ingredient_alias.id = global_ingredient_alias_tenant_map.source_alias_id
INNER JOIN global_ingredient_tenant_map
  ON global_ingredient_tenant_map.source_ingredient_id = ingredient_alias.ingredient_id
  AND global_ingredient_tenant_map.tenant_id = global_ingredient_alias_tenant_map.tenant_id
WHERE global_ingredient_alias_tenant_map.target_exists = false;

UPDATE ingredient_usage
SET ingredient_alias_id = global_ingredient_alias_tenant_map.target_alias_id
FROM recipe_step
INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
INNER JOIN global_ingredient_alias_tenant_map
  ON global_ingredient_alias_tenant_map.tenant_id = recipe.tenant_id
WHERE ingredient_usage.recipe_step_id = recipe_step.id
  AND global_ingredient_alias_tenant_map.source_alias_id = ingredient_usage.ingredient_alias_id;

UPDATE ingredient_usage
SET ingredient_id = global_ingredient_tenant_map.target_ingredient_id
FROM recipe_step
INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
INNER JOIN recipe ON recipe.id = recipe_revision.recipe_id
INNER JOIN global_ingredient_tenant_map
  ON global_ingredient_tenant_map.tenant_id = recipe.tenant_id
WHERE ingredient_usage.recipe_step_id = recipe_step.id
  AND global_ingredient_tenant_map.source_ingredient_id = ingredient_usage.ingredient_id;

DELETE FROM ingredient WHERE owner_tenant_id IS NULL;

ALTER TABLE ingredient DROP CONSTRAINT ingredient_owner_tenant_id_canonical_name_key;
ALTER TABLE ingredient ALTER COLUMN owner_tenant_id SET NOT NULL;
ALTER TABLE ingredient ADD CONSTRAINT ingredient_owner_tenant_id_canonical_name_key
  UNIQUE (owner_tenant_id, canonical_name);
ALTER TABLE ingredient DROP COLUMN localization_key;
ALTER TABLE ingredient_alias DROP COLUMN localization_key;
