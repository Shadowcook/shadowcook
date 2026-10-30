ALTER TABLE tenant ADD COLUMN recipe_retention_days integer NOT NULL DEFAULT 30
  CHECK (recipe_retention_days BETWEEN 1 AND 36500);
ALTER TABLE recipe
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deletion_retention_days integer CHECK (deletion_retention_days BETWEEN 1 AND 36500),
  ADD CONSTRAINT recipe_deletion_state CHECK ((deleted_at IS NULL) = (deletion_retention_days IS NULL));
CREATE INDEX recipe_trash_expiration ON recipe (deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE TABLE recipe_media_deletion_queue (
  storage_key text PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
