CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE FUNCTION normalize_search_text(source_text text)
RETURNS text
LANGUAGE sql
STABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT btrim(regexp_replace(lower(unaccent(source_text)), '[^a-z0-9]+', ' ', 'g'));
$$;

CREATE FUNCTION recipe_search_match_rank(title text, summary text, search_text text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH normalized AS (
    SELECT normalize_search_text(title) AS normalized_title,
      normalize_search_text(COALESCE(summary, '')) AS normalized_summary,
      normalize_search_text(search_text) AS normalized_search
  )
  SELECT CASE
    WHEN normalized_search = '' OR normalized_title = normalized_search THEN 0
    WHEN (' ' || normalized_title || ' ') LIKE '% ' || normalized_search || ' %' THEN 1
    WHEN NOT EXISTS (
      SELECT 1
      FROM regexp_split_to_table(normalized_search, ' ') AS search_token
      WHERE (' ' || normalized_title) NOT LIKE '% ' || search_token || '%'
    ) THEN 2
    WHEN (' ' || normalized_summary || ' ') LIKE '% ' || normalized_search || ' %' THEN 3
    WHEN NOT EXISTS (
      SELECT 1
      FROM regexp_split_to_table(normalized_search, ' ') AS search_token
      WHERE (' ' || normalized_summary) NOT LIKE '% ' || search_token || '%'
    ) THEN 4
    ELSE 5
  END
  FROM normalized;
$$;
