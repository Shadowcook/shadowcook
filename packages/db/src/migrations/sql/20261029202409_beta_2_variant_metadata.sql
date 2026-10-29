ALTER TABLE recipe_variant
  ADD COLUMN difficulty text CHECK (difficulty IN ('EASY', 'MEDIUM', 'DEMANDING')),
  ADD COLUMN total_minutes integer CHECK (total_minutes BETWEEN 0 AND 5256000),
  ADD COLUMN active_minutes integer CHECK (active_minutes BETWEEN 0 AND 5256000),
  ADD COLUMN kcal double precision CHECK (kcal BETWEEN 0 AND 1000000000),
  ADD COLUMN servings double precision CHECK (servings > 0 AND servings <= 1000000),
  ADD COLUMN utensils text CHECK (length(utensils) <= 4000 AND length(trim(utensils)) > 0),
  ADD COLUMN diet text CHECK (diet IN ('VEGAN', 'VEGETARIAN', 'OMNI')),
  ADD CONSTRAINT recipe_variant_duration_check CHECK (active_minutes <= total_minutes);

CREATE INDEX recipe_variant_diet_idx ON recipe_variant (diet) WHERE diet IS NOT NULL;

UPDATE recipe_variant AS variant SET
  difficulty = revision.difficulty,
  total_minutes = revision.total_minutes,
  active_minutes = revision.active_minutes,
  kcal = revision.kcal,
  servings = revision.servings,
  utensils = revision.utensils,
  diet = revision.diet
FROM recipe_revision AS revision WHERE revision.id = variant.recipe_revision_id;

ALTER TABLE recipe_revision
  DROP COLUMN difficulty,
  DROP COLUMN total_minutes,
  DROP COLUMN active_minutes,
  DROP COLUMN kcal,
  DROP COLUMN servings,
  DROP COLUMN utensils,
  DROP COLUMN diet;
