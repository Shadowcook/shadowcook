ALTER TABLE tenant
  ADD COLUMN frontpage_recipe_count integer NOT NULL DEFAULT 4
    CHECK (frontpage_recipe_count BETWEEN 1 AND 100);
