ALTER TABLE ingredient_usage
  ADD COLUMN ingredient_alias_id uuid REFERENCES ingredient_alias(id) ON DELETE SET NULL;

CREATE INDEX ingredient_usage_ingredient_alias_idx ON ingredient_usage(ingredient_alias_id);
