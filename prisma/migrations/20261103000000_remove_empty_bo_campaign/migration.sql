-- The user explicitly rejected the standalone BO campaign. Remove only an
-- empty BO entry; preserve similarly named campaigns and any production history.
DO $$
DECLARE
  target_id TEXT;
  dependency RECORD;
  linked_count INTEGER;
BEGIN
  SELECT "id" INTO target_id FROM "Campaign"
  WHERE "campaignName" = 'BO' AND "normalizedName" = 'BO';
  IF target_id IS NULL THEN RETURN; END IF;

  FOR dependency IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('campaignId', 'opsviewCampaignId', 'oldCampaignId', 'newCampaignId')
      AND NOT (table_name = 'UserCampaign' AND column_name = 'campaignId')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1',
      current_schema(), dependency.table_name, dependency.column_name)
      INTO linked_count USING target_id;
    IF linked_count > 0 THEN
      RAISE EXCEPTION 'BO has linked records in %.%; review before removal',
        dependency.table_name, dependency.column_name;
    END IF;
  END LOOP;

  DELETE FROM "UserCampaign" WHERE "campaignId" = target_id;
  DELETE FROM "Campaign" WHERE "id" = target_id;
END $$;
