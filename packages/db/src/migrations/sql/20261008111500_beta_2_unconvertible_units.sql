ALTER TABLE unit DROP CONSTRAINT unit_base_factor_check;
ALTER TABLE unit DROP CONSTRAINT unit_dimension_check;
ALTER TABLE unit DROP CONSTRAINT unit_check;

ALTER TABLE unit ALTER COLUMN dimension DROP NOT NULL;
ALTER TABLE unit ALTER COLUMN base_factor DROP NOT NULL;
ALTER TABLE unit ALTER COLUMN base_offset DROP NOT NULL;
ALTER TABLE unit ALTER COLUMN base_offset DROP DEFAULT;

ALTER TABLE unit ADD CONSTRAINT unit_dimension_check
  CHECK (dimension IS NULL OR dimension IN ('MASS', 'VOLUME', 'COUNT', 'TEMPERATURE'));
ALTER TABLE unit ADD CONSTRAINT unit_convertibility_check CHECK (
  (dimension IS NULL AND base_factor IS NULL AND base_offset IS NULL)
  OR
  (dimension IS NOT NULL AND base_factor IS NOT NULL AND base_factor > 0 AND base_offset IS NOT NULL
    AND (dimension = 'TEMPERATURE' OR base_offset = 0))
);
