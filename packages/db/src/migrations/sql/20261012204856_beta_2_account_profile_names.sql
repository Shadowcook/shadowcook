ALTER TABLE user_account
  ADD COLUMN first_name text CHECK (length(trim(first_name)) BETWEEN 1 AND 120),
  ADD COLUMN last_name text CHECK (length(trim(last_name)) BETWEEN 1 AND 120);

ALTER TABLE pending_registration
  ADD COLUMN first_name text CHECK (length(trim(first_name)) BETWEEN 1 AND 120),
  ADD COLUMN last_name text CHECK (length(trim(last_name)) BETWEEN 1 AND 120),
  ADD COLUMN display_name text CHECK (length(trim(display_name)) BETWEEN 1 AND 120);
