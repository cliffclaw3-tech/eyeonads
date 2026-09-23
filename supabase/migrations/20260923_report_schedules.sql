begin;
create table public.eyeonads_report_schedules (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 cadence text not null check(cadence in ('manual','daily','weekly')),
 next_run_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.eyeonads_report_schedules enable row level security;
create policy report_schedule_owner on public.eyeonads_report_schedules for all to authenticated
 using(owner_id=auth.uid()) with check(owner_id=auth.uid() and coalesce((auth.jwt()->'app_metadata'->>'eyeonads_pilot')::boolean,false));
revoke all on public.eyeonads_report_schedules from public,anon,authenticated;
grant select,insert,update on public.eyeonads_report_schedules to authenticated;
grant all on public.eyeonads_report_schedules to service_role;

-- Remaining-only starts honor the same scope, without replacing an active batch.
create or replace function public.eyeonads_start_discovery_job() returns uuid
language plpgsql security definer set search_path=public as $$
declare owner uuid:=auth.uid(); saved jsonb; job uuid; state text;
begin
 if owner is null then raise exception 'Authentication required'; end if;
 if not coalesce((auth.jwt()->'app_metadata'->>'eyeonads_pilot')::boolean,false) then raise exception 'Pilot access required'; end if;
 select to_jsonb(s) into saved from eyeonads_brokerage_setups s where s.owner_id=owner;
 if saved is null or jsonb_array_length(saved->'agents')=0 then raise exception 'Save a roster first'; end if;
 if not exists(select 1 from jsonb_array_elements(saved->'agents') a where a->>'id' is not null and ((saved->'discovery_agent_ids') is null or (saved->'discovery_agent_ids')='null'::jsonb or (saved->'discovery_agent_ids') ? (a->>'id'))) then raise exception 'No agents selected for reports'; end if;
 -- Inspect an existing job before insertion: newly inserted jobs default to running.
 select id,status into job,state from eyeonads_discovery_jobs where owner_id=owner for update;
 if job is null then
  insert into eyeonads_discovery_jobs(owner_id,status) values(owner,'complete') on conflict(owner_id) do nothing;
  select id,status into job,state from eyeonads_discovery_jobs where owner_id=owner for update;
 end if;
 if state in ('running','paused') then
  update eyeonads_discovery_jobs set status='running',updated_at=now() where id=job;
  return job;
 end if;
 delete from eyeonads_discovery_job_items where job_id=job;
 insert into eyeonads_discovery_job_items(job_id,owner_id,agent_id,agent,setup)
 select job,owner,a->>'id',a,saved from jsonb_array_elements(saved->'agents') a
 where a->>'id' is not null
 and ((saved->'discovery_agent_ids') is null or (saved->'discovery_agent_ids')='null'::jsonb or (saved->'discovery_agent_ids') ? (a->>'id'))
 and not exists(select 1 from eyeonads_discovery_reviews r where r.owner_id=owner and r.agent_id=a->>'id' and r.status='complete')
 on conflict(job_id,agent_id) do nothing;
 update eyeonads_discovery_jobs set status=case when exists(select 1 from eyeonads_discovery_job_items where job_id=job) then 'running' else 'complete' end,failure_count=0,error=null,created_at=now(),updated_at=now() where id=job;
 return job;
end $$;

create function public.eyeonads_enqueue_fresh_report(p_owner uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare saved jsonb; job uuid; state text;
begin
 select to_jsonb(s) into saved from eyeonads_brokerage_setups s where owner_id=p_owner;
 if saved is null or jsonb_array_length(saved->'agents')=0 then raise exception 'Save a roster first'; end if;
 insert into eyeonads_discovery_jobs(owner_id) values(p_owner) on conflict(owner_id) do nothing;
 select id,status into job,state from eyeonads_discovery_jobs where owner_id=p_owner for update;
 if exists(select 1 from eyeonads_discovery_job_items where job_id=job and status in ('running','pending')) then
   raise exception 'A batch is already in progress; resume or finish it first';
 end if;
 delete from eyeonads_discovery_job_items where job_id=job;
 insert into eyeonads_discovery_job_items(job_id,owner_id,agent_id,agent,setup)
 select job,p_owner,a->>'id',a,saved from jsonb_array_elements(saved->'agents') a where a->>'id' is not null and ((saved->'discovery_agent_ids') is null or (saved->'discovery_agent_ids')='null'::jsonb or (saved->'discovery_agent_ids') ? (a->>'id'));
 if not found then raise exception 'No agents selected for reports'; end if;
 update eyeonads_discovery_jobs set status='running',failure_count=0,error=null,created_at=now(),updated_at=now() where id=job;
 return job;
end $$;
create function public.eyeonads_start_fresh_report() returns uuid
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce((auth.jwt()->'app_metadata'->>'eyeonads_pilot')::boolean,false) then raise exception 'Pilot access required'; end if;
 return eyeonads_enqueue_fresh_report(auth.uid());
end $$;
create function public.eyeonads_enqueue_due_reports() returns integer
language plpgsql security definer set search_path=public as $$
declare s record; count_started integer:=0;
begin
 for s in select r.* from eyeonads_report_schedules r
  join auth.users u on u.id=r.owner_id
  where r.cadence in ('daily','weekly') and r.next_run_at<=now()
  and coalesce((u.raw_app_meta_data->>'eyeonads_pilot')::boolean,false)
  and exists(select 1 from eyeonads_brokerage_setups b cross join lateral jsonb_array_elements(b.agents) a
   where b.owner_id=r.owner_id and a->>'id' is not null
   and (b.discovery_agent_ids is null or a->>'id'=any(b.discovery_agent_ids)))
  and not exists(select 1 from eyeonads_discovery_jobs j where j.owner_id=r.owner_id and j.status in ('running','paused','failed'))
  order by r.next_run_at for update of r skip locked limit 5
 loop
  perform eyeonads_enqueue_fresh_report(s.owner_id);
  update eyeonads_report_schedules set next_run_at=now()+case when s.cadence='daily' then interval '1 day' else interval '7 days' end,updated_at=now() where owner_id=s.owner_id;
  count_started:=count_started+1;
 end loop;
 return count_started;
end $$;
revoke all on function public.eyeonads_enqueue_fresh_report(uuid),public.eyeonads_start_fresh_report(),public.eyeonads_enqueue_due_reports() from public,anon,authenticated;
grant execute on function public.eyeonads_start_fresh_report() to authenticated;
grant execute on function public.eyeonads_enqueue_fresh_report(uuid),public.eyeonads_enqueue_due_reports() to service_role;
notify pgrst,'reload schema';
commit;
