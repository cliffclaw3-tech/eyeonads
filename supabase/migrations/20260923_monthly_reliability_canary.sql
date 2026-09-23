-- PROPOSED: root must review/apply and connect the existing authenticated worker.
-- Deliberately does not modify the daily monitoring schedule or create a second cron secret.
begin;
create table public.eyeonads_reliability_configs (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 next_run_at timestamptz,
 public_canary_url text,
 expected_target_id text,
 target_verified_at timestamptz,
 required_label text not null default 'COMPLIANCE TEST — FICTIONAL',
 expected_finding_codes jsonb not null default '[]' check(jsonb_typeof(expected_finding_codes)='array'),
 pilot_recipient_override text check(pilot_recipient_override is null or lower(pilot_recipient_override)='theshieldsteam@gmail.com'),
 pilot_recipient_authorized_at timestamptz,
 pilot_recipient_authorized_by text,
 updated_at timestamptz not null default now(),
 check(not enabled or next_run_at is not null),
 check(pilot_recipient_override is null or (pilot_recipient_authorized_at is not null and pilot_recipient_authorized_by is not null and length(trim(pilot_recipient_authorized_by))>0))
);
create table public.eyeonads_reliability_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 config_snapshot jsonb not null,
 status text not null default 'pending' check(status in ('pending','running','complete','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_expires_at timestamptz,
 checkpoints jsonb not null default '{}',
 report jsonb,
 error text,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(owner_id,period),
 check(status<>'complete' or report is not null)
);
create table public.eyeonads_reliability_deliveries (
 run_id uuid primary key references public.eyeonads_reliability_runs(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'queued' check(status in ('queued','sending','accepted','delivered','failed','uncertain','blocked')),
 recipient text,
 recipient_source text check(recipient_source in ('verified_signup','authorized_pilot_override')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 retry_safe boolean not null default false,
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_expires_at timestamptz,
 provider_message_id text,
 verified_delivery_event_id text,
 error text,
 accepted_at timestamptz,
 delivered_at timestamptz,
 updated_at timestamptz not null default now(),
 check(status not in ('accepted','delivered') or provider_message_id is not null),
 check(status<>'delivered' or verified_delivery_event_id is not null)
);
create index eyeonads_reliability_runs_claim on public.eyeonads_reliability_runs(available_at) where status in ('pending','running');
create index eyeonads_reliability_delivery_claim on public.eyeonads_reliability_deliveries(available_at) where status in ('queued','failed','sending');
alter table public.eyeonads_reliability_configs enable row level security;
alter table public.eyeonads_reliability_runs enable row level security;
alter table public.eyeonads_reliability_deliveries enable row level security;
create policy reliability_config_owner_read on public.eyeonads_reliability_configs for select to authenticated using(owner_id=auth.uid());
create policy reliability_run_owner_read on public.eyeonads_reliability_runs for select to authenticated using(owner_id=auth.uid());
create policy reliability_delivery_owner_read on public.eyeonads_reliability_deliveries for select to authenticated using(owner_id=auth.uid());
revoke all on public.eyeonads_reliability_configs,public.eyeonads_reliability_runs,public.eyeonads_reliability_deliveries from public,anon,authenticated;
grant select on public.eyeonads_reliability_configs,public.eyeonads_reliability_runs,public.eyeonads_reliability_deliveries to authenticated;
grant all on public.eyeonads_reliability_configs,public.eyeonads_reliability_runs,public.eyeonads_reliability_deliveries to service_role;

-- Service worker calls this independently of daily-discovery enqueueing. No canary config
-- is inserted automatically: an unconfigured test may still run and report BLOCKED.
create function public.eyeonads_enqueue_due_reliability() returns integer
language plpgsql security definer set search_path=public as $$
declare cfg record; inserted integer; total integer:=0; current_period text:=to_char(now() at time zone 'UTC','YYYY-MM');
begin
 for cfg in select c.* from eyeonads_reliability_configs c
  join auth.users u on u.id=c.owner_id
  where c.enabled and c.next_run_at<=now()
  and coalesce((u.raw_app_meta_data->>'eyeonads_pilot')::boolean,false)
  order by c.next_run_at for update of c skip locked limit 10
 loop
  insert into eyeonads_reliability_runs(owner_id,period,config_snapshot)
   values(cfg.owner_id,current_period,to_jsonb(cfg)) on conflict(owner_id,period) do nothing;
  get diagnostics inserted=row_count;
  total:=total+inserted;
  -- Calendar months, not 30-day drift. Missed months are not fabricated as completed checks.
  update eyeonads_reliability_configs set next_run_at=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC',updated_at=now() where owner_id=cfg.owner_id;
 end loop;
 return total;
end $$;
create function public.eyeonads_claim_reliability() returns setof public.eyeonads_reliability_runs
language plpgsql security definer set search_path=public as $$
declare chosen uuid;
begin
 update eyeonads_reliability_runs set status='failed',error='Retry budget exhausted after expired processing lease.',lease_token=null,lease_expires_at=null
 where status='running' and lease_expires_at<=now() and attempts>=3;
 select id into chosen from eyeonads_reliability_runs
 where attempts<3 and ((status='pending' and available_at<=now()) or (status='running' and lease_expires_at<=now()))
 order by available_at for update skip locked limit 1;
 if chosen is null then return; end if;
 return query update eyeonads_reliability_runs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',error=null where id=chosen returning *;
end $$;
create function public.eyeonads_checkpoint_reliability(p_run uuid,p_token uuid,p_key text,p_checkpoint jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_key is null or p_checkpoint is null or p_key !~ '^[a-zA-Z0-9_-]{1,80}$' or jsonb_typeof(p_checkpoint)<>'object' or not(p_checkpoint ? 'fingerprint') or not(p_checkpoint ? 'value') then raise exception 'Invalid checkpoint'; end if;
 update eyeonads_reliability_runs set checkpoints=jsonb_set(checkpoints,array[p_key],p_checkpoint,true)
 where id=p_run and status='running' and lease_token=p_token and lease_expires_at>now();
 return found;
end $$;
create function public.eyeonads_finish_reliability(p_run uuid,p_token uuid,p_report jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare finished_owner uuid;
begin
 if p_report is null or jsonb_typeof(p_report)<>'object' or coalesce(p_report->>'outcome','') not in ('pass','fail','blocked','error') then raise exception 'Invalid report'; end if;
 update eyeonads_reliability_runs set status='complete',report=p_report,completed_at=now(),lease_token=null,lease_expires_at=null
 where id=p_run and status='running' and lease_token=p_token and lease_expires_at>now()
 and p_report->>'ownerId'=owner_id::text and p_report->>'period'=period
 returning owner_id into finished_owner;
 if not found then return false; end if;
 insert into eyeonads_reliability_deliveries(run_id,owner_id) values(p_run,finished_owner) on conflict(run_id) do nothing;
 return true;
end $$;
create function public.eyeonads_fail_reliability(p_run uuid,p_token uuid,p_error text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update eyeonads_reliability_runs set status=case when attempts<3 then 'pending' else 'failed' end,
 available_at=now()+interval '5 minutes'*attempts,error=left(p_error,1000),lease_token=null,lease_expires_at=null
 where id=p_run and status='running' and lease_token=p_token and lease_expires_at>now();
 return found;
end $$;

-- Claim before initiating a network send; a crash after this claim is UNCERTAIN.
-- Recipient is resolved by the server from auth identity or service-owned pilot override.
create function public.eyeonads_claim_reliability_delivery(p_run uuid,p_recipient text,p_source text) returns setof public.eyeonads_reliability_deliveries
language plpgsql security definer set search_path=public as $$
begin
 if p_recipient is null or p_source is null or p_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_source not in ('verified_signup','authorized_pilot_override') then raise exception 'Invalid recipient'; end if;
 update eyeonads_reliability_deliveries set status='uncertain',retry_safe=false,error='Send lease expired; acceptance unknown. Reconcile before resending.',lease_token=null,lease_expires_at=null,updated_at=now()
 where run_id=p_run and status='sending' and lease_expires_at<=now();
 -- Defense in depth: no arbitrary destination supplied to the service RPC.
 if not exists(select 1 from eyeonads_reliability_deliveries d join auth.users u on u.id=d.owner_id
   left join eyeonads_reliability_configs c on c.owner_id=d.owner_id
   where d.run_id=p_run and (
    (p_source='verified_signup' and u.email_confirmed_at is not null and lower(u.email)=lower(p_recipient)
     and not coalesce((u.raw_app_meta_data->>'eyeonads_synthetic')::boolean,false)
     and u.email !~* '(^les\.review\.|^eyeonads-(qa|novice|canary)[.+_-]|@(example\.(com|org|net)|[^@]*\.invalid)$)')
    or (p_source='authorized_pilot_override' and lower(c.pilot_recipient_override)=lower(p_recipient)
     and c.pilot_recipient_authorized_at is not null and length(trim(c.pilot_recipient_authorized_by))>0)
   )) then raise exception 'Recipient not authorized'; end if;
 return query update eyeonads_reliability_deliveries set status='sending',recipient=p_recipient,recipient_source=p_source,attempts=attempts+1,retry_safe=false,
 lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now()
 where run_id=p_run and attempts<3 and available_at<=now() and (status='queued' or (status='failed' and retry_safe)) returning *;
end $$;
create function public.eyeonads_record_reliability_delivery(p_run uuid,p_token uuid,p_status text,p_message_id text default null,p_event_id text default null,p_error text default null,p_retry_safe boolean default false) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_status is null or p_status not in ('accepted','delivered','failed','uncertain','blocked') then raise exception 'Invalid delivery state'; end if;
 if p_status in ('accepted','delivered') and coalesce(length(trim(p_message_id)),0)=0 then raise exception 'Provider message ID required'; end if;
 if p_status='delivered' and coalesce(length(trim(p_event_id)),0)=0 then raise exception 'Verified delivery event required'; end if;
 update eyeonads_reliability_deliveries set status=p_status,provider_message_id=p_message_id,verified_delivery_event_id=p_event_id,error=left(p_error,1000),
 retry_safe=(p_status='failed' and p_retry_safe),available_at=now()+interval '10 minutes',lease_token=null,lease_expires_at=null,
 accepted_at=case when p_status in ('accepted','delivered') then now() else accepted_at end,delivered_at=case when p_status='delivered' then now() else delivered_at end,updated_at=now()
 where run_id=p_run and status='sending' and lease_token=p_token and lease_expires_at>now();
 return found;
end $$;
-- Authenticated callers may only toggle their own schedule or create their own monthly
-- run. Target verification and recipient overrides stay service-owned.
create function public.eyeonads_set_reliability_schedule(p_enabled boolean) returns setof public.eyeonads_reliability_configs
language plpgsql security definer set search_path=public as $$
declare owner uuid:=auth.uid();
begin
 if owner is null or p_enabled is null then raise exception 'Authentication and enabled state required'; end if;
 if not exists(select 1 from auth.users u where u.id=owner and coalesce((u.raw_app_meta_data->>'eyeonads_pilot')::boolean,false)) then raise exception 'Pilot access required'; end if;
 if not exists(select 1 from eyeonads_brokerage_setups b where b.owner_id=owner and jsonb_array_length(b.agents)>0) then raise exception 'Save a roster first'; end if;
 return query insert into eyeonads_reliability_configs(owner_id,enabled,next_run_at)
 values(owner,p_enabled,case when p_enabled then (date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC' else null end)
 on conflict(owner_id) do update set enabled=p_enabled,
 next_run_at=case when not p_enabled then null when eyeonads_reliability_configs.enabled and eyeonads_reliability_configs.next_run_at is not null then eyeonads_reliability_configs.next_run_at else excluded.next_run_at end,
 updated_at=now() returning *;
end $$;
create function public.eyeonads_start_reliability() returns setof public.eyeonads_reliability_runs
language plpgsql security definer set search_path=public as $$
declare owner uuid:=auth.uid(); cfg jsonb; current_period text:=to_char(now() at time zone 'UTC','YYYY-MM');
begin
 if owner is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from auth.users u where u.id=owner and coalesce((u.raw_app_meta_data->>'eyeonads_pilot')::boolean,false)) then raise exception 'Pilot access required'; end if;
 if not exists(select 1 from eyeonads_brokerage_setups b where b.owner_id=owner and jsonb_array_length(b.agents)>0) then raise exception 'Save a roster first'; end if;
 insert into eyeonads_reliability_configs(owner_id) values(owner) on conflict(owner_id) do nothing;
 select to_jsonb(c) into cfg from eyeonads_reliability_configs c where c.owner_id=owner;
 insert into eyeonads_reliability_runs(owner_id,period,config_snapshot) values(owner,current_period,cfg) on conflict(owner_id,period) do nothing;
 return query select r.* from eyeonads_reliability_runs r where r.owner_id=owner and r.period=current_period;
end $$;
revoke all on function public.eyeonads_set_reliability_schedule(boolean),public.eyeonads_start_reliability() from public,anon,authenticated;
grant execute on function public.eyeonads_set_reliability_schedule(boolean),public.eyeonads_start_reliability() to authenticated;
revoke all on function public.eyeonads_enqueue_due_reliability(),public.eyeonads_claim_reliability(),public.eyeonads_checkpoint_reliability(uuid,uuid,text,jsonb),public.eyeonads_finish_reliability(uuid,uuid,jsonb),public.eyeonads_fail_reliability(uuid,uuid,text),public.eyeonads_claim_reliability_delivery(uuid,text,text),public.eyeonads_record_reliability_delivery(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.eyeonads_enqueue_due_reliability(),public.eyeonads_claim_reliability(),public.eyeonads_checkpoint_reliability(uuid,uuid,text,jsonb),public.eyeonads_finish_reliability(uuid,uuid,jsonb),public.eyeonads_fail_reliability(uuid,uuid,text),public.eyeonads_claim_reliability_delivery(uuid,text,text),public.eyeonads_record_reliability_delivery(uuid,uuid,text,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
