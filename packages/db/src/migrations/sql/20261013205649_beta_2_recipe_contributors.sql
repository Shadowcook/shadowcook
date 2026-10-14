CREATE TABLE recipe_revision_contributor (
  recipe_revision_id uuid NOT NULL REFERENCES recipe_revision(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  PRIMARY KEY (recipe_revision_id, principal_id)
);

CREATE INDEX recipe_revision_contributor_principal_idx
  ON recipe_revision_contributor (principal_id);

INSERT INTO recipe_revision_contributor (recipe_revision_id, principal_id)
SELECT id, created_by_principal_id
FROM recipe_revision
WHERE created_by_principal_id IS NOT NULL;
