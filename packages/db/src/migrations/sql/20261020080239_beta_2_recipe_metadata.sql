ALTER TABLE recipe_revision
  ADD COLUMN difficulty text CHECK (difficulty IN ('EASY', 'MEDIUM', 'DEMANDING')),
  ADD COLUMN total_minutes integer CHECK (total_minutes BETWEEN 0 AND 5256000),
  ADD COLUMN active_minutes integer CHECK (active_minutes BETWEEN 0 AND 5256000),
  ADD COLUMN kcal double precision CHECK (kcal BETWEEN 0 AND 1000000000),
  ADD COLUMN servings double precision CHECK (servings > 0 AND servings <= 1000000),
  ADD COLUMN utensils text CHECK (length(utensils) <= 4000 AND length(trim(utensils)) > 0),
  ADD COLUMN diet text CHECK (diet IN ('VEGAN', 'VEGETARIAN', 'OMNI')),
  ADD CONSTRAINT recipe_revision_duration_check CHECK (active_minutes <= total_minutes);

CREATE INDEX recipe_revision_diet_idx ON recipe_revision (diet) WHERE diet IS NOT NULL;
