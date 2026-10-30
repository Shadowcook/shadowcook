CREATE TABLE instance_media_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_published_recipe_images integer NOT NULL DEFAULT 5 CHECK (max_published_recipe_images >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_principal_id uuid REFERENCES principal(id) ON DELETE RESTRICT
);

INSERT INTO instance_media_settings (singleton) VALUES (true);
