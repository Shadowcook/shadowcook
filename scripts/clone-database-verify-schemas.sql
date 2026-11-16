-- Validate the protected objects after the cascade and import, before commit.
DO $$
DECLARE
  removed_object text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM clone_protected_schema protected
    WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE oid = protected.oid)
  ) THEN
    RAISE EXCEPTION 'Replacing public would remove another schema; refusing to publish the copy.';
  END IF;
  SELECT protected.description INTO removed_object
  FROM clone_protected_dependency protected
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_depend current_dependency
    WHERE current_dependency.classid = protected.classid
      AND current_dependency.objid = protected.objid
      AND current_dependency.objsubid = protected.objsubid
      AND current_dependency.refclassid = protected.refclassid
      AND current_dependency.refobjid = protected.refobjid
      AND current_dependency.refobjsubid = protected.refobjsubid
      AND current_dependency.deptype = protected.deptype
  )
  LIMIT 1;
  IF removed_object IS NOT NULL THEN
    RAISE EXCEPTION 'Replacing public would damage an object in another schema: %. Refusing to publish the copy.', removed_object;
  END IF;
END;
$$;
