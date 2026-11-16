-- Run in the same transaction as the restore. PostgreSQL itself resolves the
-- cascade; do not try to approximate its deletion rules with a dependency walk.
SET search_path = pg_catalog;
SET timezone = 'UTC';
SET lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtext('shadowcook-clone-public'));

CREATE TEMP TABLE clone_protected_schema ON COMMIT DROP AS
SELECT oid FROM pg_namespace
WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_';

-- Namespace members also own objects without a namespace of their own: view
-- rules, defaults, constraints, triggers, indexes, and extension members. Follow
-- ownership dependencies only, never normal references into public. Match whole
-- object IDs so dependencies of individual columns are protected as well.
CREATE TEMP TABLE clone_protected_dependency ON COMMIT DROP AS
WITH RECURSIVE protected_object (classid, objid) AS (
  SELECT 'pg_namespace'::regclass::oid, oid FROM clone_protected_schema
  UNION
  SELECT dependency.classid, dependency.objid
  FROM pg_depend dependency
  JOIN protected_object parent
    ON parent.classid = dependency.refclassid AND parent.objid = dependency.refobjid
  WHERE parent.classid = 'pg_namespace'::regclass
    OR dependency.deptype IN ('a', 'i', 'e', 'P', 'S')
)
SELECT dependency.*,
  pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid) AS description
FROM pg_depend dependency
JOIN protected_object protected
  ON protected.classid = dependency.classid AND protected.objid = dependency.objid;

DROP SCHEMA public CASCADE;

CREATE SCHEMA public;
