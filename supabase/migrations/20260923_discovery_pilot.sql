REVOKE ALL ON public.eyeonads_discovery_jobs,public.eyeonads_discovery_job_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.eyeonads_discovery_jobs,public.eyeonads_discovery_job_items TO authenticated;
CREATE OR REPLACE FUNCTION public.eyeonads_start_discovery_job() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner uuid:=auth.uid(); job uuid; saved jsonb;
BEGIN
 IF owner IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT coalesce((auth.jwt()->'app_metadata'->>'eyeonads_pilot')::boolean,false) THEN RAISE EXCEPTION 'Pilot access required'; END IF;
 SELECT to_jsonb(s) INTO saved FROM eyeonads_brokerage_setups s WHERE s.owner_id=owner;
 IF saved IS NULL OR jsonb_array_length(saved->'agents')=0 THEN RAISE EXCEPTION 'Save a roster first'; END IF;
 INSERT INTO eyeonads_discovery_jobs(owner_id) VALUES(owner) ON CONFLICT(owner_id) DO NOTHING;
 SELECT id INTO job FROM eyeonads_discovery_jobs WHERE owner_id=owner FOR UPDATE;
 INSERT INTO eyeonads_discovery_job_items(job_id,owner_id,agent_id,agent,setup)
 SELECT job,owner,a->>'id',a,saved FROM jsonb_array_elements(saved->'agents') a
 WHERE a->>'id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM eyeonads_discovery_reviews r WHERE r.owner_id=owner AND r.agent_id=a->>'id' AND r.status='complete')
 ON CONFLICT(job_id,agent_id) DO NOTHING;
 UPDATE eyeonads_discovery_job_items SET status='pending',error=null,updated_at=now() WHERE job_id=job AND status='failed';
 UPDATE eyeonads_discovery_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM eyeonads_discovery_job_items WHERE job_id=job AND status IN ('pending','running')) THEN 'running' ELSE 'complete' END,failure_count=0,error=null,updated_at=now() WHERE id=job;
 RETURN job;
END $$;

REVOKE ALL ON FUNCTION public.eyeonads_start_discovery_job() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.eyeonads_start_discovery_job() TO authenticated;
NOTIFY pgrst,'reload schema';
