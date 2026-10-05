ALTER TABLE recipe
  ADD COLUMN is_featured boolean NOT NULL DEFAULT false;

ALTER TABLE user_session
  ADD COLUMN frontpage_shuffle_seed uuid;
