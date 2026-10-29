CREATE TABLE recipe_import_source (
  recipe_id uuid PRIMARY KEY REFERENCES recipe(id) ON DELETE CASCADE,
  instance_url text NOT NULL,
  tenant_public_id uuid NOT NULL,
  remote_recipe_public_id uuid NOT NULL,
  remote_revision_public_id uuid
);

CREATE TABLE recipe_import_ingredient_source (
  recipe_id uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  instance_url text NOT NULL,
  remote_tenant_public_id uuid NOT NULL,
  remote_ingredient_public_id uuid NOT NULL,
  ingredient_id uuid NOT NULL REFERENCES ingredient(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, instance_url, remote_tenant_public_id, remote_ingredient_public_id)
);

CREATE TABLE recipe_import_unit_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  instance_url text NOT NULL,
  remote_tenant_public_id uuid,
  remote_unit_public_id uuid NOT NULL,
  unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (recipe_id, instance_url, remote_tenant_public_id, remote_unit_public_id)
);
