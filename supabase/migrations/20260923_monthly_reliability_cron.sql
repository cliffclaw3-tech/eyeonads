-- Separate monthly queue tick. No HTTP call when no monthly work is due.
-- Apply only after /api/reliability/worker is deployed and authenticated checks pass.
select cron.schedule('eyeonads-monthly-reliability-worker','* * * * *',$job$
select net.http_post(
 url:='https://eyeonads.com/api/reliability/worker',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='eyeonads_worker_20260923')),
 body:='{}'::jsonb,timeout_milliseconds:=120000)
where exists(select 1 from public.eyeonads_reliability_configs c join auth.users u on u.id=c.owner_id where c.enabled and c.next_run_at<=now() and coalesce((u.raw_app_meta_data->>'eyeonads_pilot')::boolean,false))
or exists(select 1 from public.eyeonads_reliability_runs where (status='pending' and attempts<3 and available_at<=now()) or (status='running' and lease_expires_at<=now()))
or exists(select 1 from public.eyeonads_reliability_deliveries where ((status='queued' or (status='failed' and retry_safe) or (status='blocked' and attempts=0 and (exists(select 1 from auth.users u where u.id=eyeonads_reliability_deliveries.owner_id and not coalesce((u.raw_app_meta_data->>'eyeonads_synthetic')::boolean,false)) or exists(select 1 from public.eyeonads_reliability_configs c where c.owner_id=eyeonads_reliability_deliveries.owner_id and c.pilot_recipient_override is not null)))) and attempts<3 and available_at<=now()) or (status='sending' and lease_expires_at<=now()));
$job$);
select jobid,jobname,schedule,active from cron.job where jobname like 'eyeonads%';
