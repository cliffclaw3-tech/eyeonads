BEGIN;
CREATE TABLE public.eyeonads_discovery_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','paused','complete','failed')),
 failure_count integer NOT NULL DEFAULT 0, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,owner_id)
);
CREATE TABLE public.eyeonads_discovery_job_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
 owner_id uuid NOT NULL, agent_id text NOT NULL, agent jsonb NOT NULL, setup jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','failed')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,owner_id) REFERENCES public.eyeonads_discovery_jobs(id,owner_id) ON DELETE CASCADE,
 UNIQUE(job_id,agent_id)
);
ALTER TABLE public.eyeonads_discovery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eyeonads_discovery_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_jobs_owner_read ON public.eyeonads_discovery_jobs FOR SELECT TO authenticated USING(owner_id=auth.uid());
CREATE POLICY discovery_items_owner_read ON public.eyeonads_discovery_job_items FOR SELECT TO authenticated USING(owner_id=auth.uid());
REVOKE ALL ON public.eyeonads_discovery_jobs,public.eyeonads_discovery_job_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.eyeonads_discovery_jobs,public.eyeonads_discovery_job_items TO authenticated;
GRANT ALL ON public.eyeonads_discovery_jobs,public.eyeonads_discovery_job_items TO service_role;
CREATE INDEX discovery_items_claim ON public.eyeonads_discovery_job_items(job_id,status,lease_until);

-- Owner identity comes only from the authenticated session. Concurrent starts serialize per owner.
CREATE FUNCTION public.eyeonads_start_discovery_job() RETURNS uuid
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
CREATE FUNCTION public.eyeonads_control_discovery_job(p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_action NOT IN ('pause','resume') THEN RAISE EXCEPTION 'Invalid action'; END IF;
 SELECT id INTO job FROM eyeonads_discovery_jobs WHERE owner_id=auth.uid() FOR UPDATE;
 IF p_action='pause' THEN
  UPDATE eyeonads_discovery_jobs SET status='paused',updated_at=now() WHERE id=job AND status='running';
 ELSE
  UPDATE eyeonads_discovery_job_items SET status='pending',error=null,updated_at=now() WHERE job_id=job AND status='failed';
  UPDATE eyeonads_discovery_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM eyeonads_discovery_job_items WHERE job_id=job AND status IN ('pending','running')) THEN 'running' ELSE 'complete' END,failure_count=0,error=null,updated_at=now() WHERE id=job;
 END IF;
END $$;

-- Only workers may claim. One outstanding lease per job prevents concurrent paid searches.
CREATE FUNCTION public.eyeonads_claim_discovery_job_item() RETURNS SETOF public.eyeonads_discovery_job_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job uuid; item uuid; failures integer;
BEGIN
 SELECT j.id INTO job FROM eyeonads_discovery_jobs j WHERE j.status='running'
 AND EXISTS(SELECT 1 FROM eyeonads_discovery_job_items i WHERE i.job_id=j.id AND (i.status='pending' OR (i.status='running' AND i.lease_until<now())))
 AND NOT EXISTS(SELECT 1 FROM eyeonads_discovery_job_items i WHERE i.job_id=j.id AND i.status='running' AND i.lease_until>=now())
 ORDER BY j.updated_at FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF job IS NULL THEN RETURN; END IF;
 -- An expired lease is a failed attempt too; repeated process crashes must not run forever.
 IF EXISTS(SELECT 1 FROM eyeonads_discovery_job_items WHERE job_id=job AND status='running' AND lease_until<now()) THEN
  UPDATE eyeonads_discovery_jobs SET failure_count=failure_count+1,error='A worker was interrupted. Resume after three failures to retry.',updated_at=now() WHERE id=job RETURNING failure_count INTO failures;
  UPDATE eyeonads_discovery_job_items SET status=CASE WHEN failures>=3 THEN 'failed' ELSE 'pending' END,lease_token=null,lease_until=null,error='The worker was interrupted.',updated_at=now() WHERE job_id=job AND status='running' AND lease_until<now();
  IF failures>=3 THEN UPDATE eyeonads_discovery_jobs SET status='failed' WHERE id=job; RETURN; END IF;
 END IF;
 SELECT id INTO item FROM eyeonads_discovery_job_items WHERE job_id=job AND (status='pending' OR (status='running' AND lease_until<now())) ORDER BY created_at,id LIMIT 1 FOR UPDATE;
 RETURN QUERY UPDATE eyeonads_discovery_job_items SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=item RETURNING *;
END $$;
CREATE FUNCTION public.eyeonads_finish_discovery_job_item(p_item uuid,p_token uuid,p_success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job uuid; failures integer;
BEGIN
 SELECT job_id INTO job FROM eyeonads_discovery_job_items WHERE id=p_item;
 PERFORM 1 FROM eyeonads_discovery_jobs WHERE id=job FOR UPDATE;
 PERFORM 1 FROM eyeonads_discovery_job_items WHERE id=p_item AND lease_token=p_token AND status='running' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT p_success THEN
  UPDATE eyeonads_discovery_jobs SET failure_count=failure_count+1,error='A public search failed. Processing stops after three failures; resume to retry.' WHERE id=job RETURNING failure_count INTO failures;
 END IF;
 UPDATE eyeonads_discovery_job_items SET status=CASE WHEN p_success THEN 'complete' WHEN failures>=3 THEN 'failed' ELSE 'pending' END,lease_token=null,lease_until=null,error=CASE WHEN p_success THEN null ELSE 'Public search did not finish. Retry is available.' END,updated_at=now() WHERE id=p_item;
 UPDATE eyeonads_discovery_jobs SET status=CASE WHEN failures>=3 THEN 'failed' WHEN NOT EXISTS(SELECT 1 FROM eyeonads_discovery_job_items WHERE job_id=job AND status<>'complete') THEN 'complete' ELSE status END,updated_at=now() WHERE id=job;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.eyeonads_start_discovery_job(),public.eyeonads_control_discovery_job(text),public.eyeonads_claim_discovery_job_item(),public.eyeonads_finish_discovery_job_item(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eyeonads_start_discovery_job(),public.eyeonads_control_discovery_job(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eyeonads_claim_discovery_job_item(),public.eyeonads_finish_discovery_job_item(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
