BEGIN;
CREATE TABLE public.eyeonads_discovery_reviews (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 agent_id text NOT NULL, agent_name text NOT NULL,
 status text NOT NULL CHECK(status IN ('running','complete','failed')),
 report text NOT NULL DEFAULT '', sources jsonb NOT NULL DEFAULT '[]',
 searched_at timestamptz NOT NULL DEFAULT now(), error text,
 run_id uuid NOT NULL DEFAULT gen_random_uuid(),
 PRIMARY KEY(owner_id,agent_id)
);
ALTER TABLE public.eyeonads_discovery_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY eyeonads_discovery_owner ON public.eyeonads_discovery_reviews FOR ALL TO authenticated USING(auth.uid()=owner_id) WITH CHECK(auth.uid()=owner_id);
GRANT SELECT,INSERT,UPDATE ON public.eyeonads_discovery_reviews TO authenticated;
GRANT ALL ON public.eyeonads_discovery_reviews TO service_role;
CREATE OR REPLACE FUNCTION public.eyeonads_claim_discovery(p_agent_id text,p_agent_name text,p_run_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
 INSERT INTO eyeonads_discovery_reviews(owner_id,agent_id,agent_name,status,run_id)
 VALUES(auth.uid(),p_agent_id,p_agent_name,'running',p_run_id)
 ON CONFLICT(owner_id,agent_id) DO UPDATE SET status='running',run_id=excluded.run_id,agent_name=excluded.agent_name,searched_at=now(),error=null
 WHERE eyeonads_discovery_reviews.status<>'running' OR eyeonads_discovery_reviews.searched_at<now()-interval '3 minutes';
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END;
$$;
REVOKE ALL ON FUNCTION public.eyeonads_claim_discovery(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eyeonads_claim_discovery(text,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
