ALTER TABLE tenant
  ADD COLUMN frontpage_heading text
    CHECK (frontpage_heading IS NULL OR length(trim(frontpage_heading)) BETWEEN 1 AND 80);
