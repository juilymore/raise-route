-- 0003: BYPASSRLS is a role ATTRIBUTE and is not inherited through membership, so the login role needs it itself.
-- (Every table has RLS on with no policies; without this app_service sees zero rows.) Grants are unchanged: it still has NO write privilege on vc_pipeline.
alter role app_service bypassrls;
