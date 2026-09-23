CREATE OR REPLACE FUNCTION public.eyeonads_claim_discovery_owned(p_owner_id uuid,p_agent_id text,p_agent_name text,p_run_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
 IF auth.role()<>'service_role' AND (auth.uid() IS NULL OR p_owner_id<>auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 INSERT INTO eyeonads_discovery_reviews(owner_id,agent_id,agent_name,status,run_id)
 VALUES(p_owner_id,p_agent_id,p_agent_name,'running',p_run_id)
 ON CONFLICT(owner_id,agent_id) DO UPDATE SET status='running',run_id=excluded.run_id,agent_name=excluded.agent_name,searched_at=now(),error=null
 WHERE eyeonads_discovery_reviews.status<>'running' OR eyeonads_discovery_reviews.searched_at<now()-interval '3 minutes';
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END;
$$;
REVOKE ALL ON FUNCTION public.eyeonads_claim_discovery_owned(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eyeonads_claim_discovery_owned(uuid,text,text,uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
