CREATE UNIQUE INDEX recipe_revision_one_cover_image
  ON recipe_revision_media (recipe_revision_id)
  WHERE usage_kind = 'COVER';
