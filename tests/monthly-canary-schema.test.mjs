import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const enabled=process.env.EYEONADS_TEST_LOCAL_POSTGRES==='1';
test('disposable PostgreSQL proves monthly scheduling, RLS, claims, lease fencing and delivery semantics',{skip:!enabled},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyeonads-monthly-pg-'));
 const data=path.join(dir,'data');let started=false;
 const run=(bin,args,options={})=>{const r=spawnSync(bin,args,{encoding:'utf8',...options});assert.equal(r.status,0,`${bin}: ${r.stderr||r.stdout}`);return r.stdout.trim();};
 const sql=(text,expectFailure=false)=>{
  const r=spawnSync('psql',['-h',dir,'-p','55483','-U',os.userInfo().username,'-d','postgres','-XAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});
  if(expectFailure){assert.notEqual(r.status,0);return r.stderr;}assert.equal(r.status,0,r.stderr);return r.stdout.trim();
 };
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 try {
  run('initdb',['-D',data,'-A','trust','--no-locale']);
  run('pg_ctl',['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-k ${dir} -p 55483 -h ''`,'-w','start']);started=true;
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
   create table eyeonads_brokerage_setups(owner_id uuid primary key,agents jsonb);
   create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated,service_role;
   insert into auth.users values('${a}','broker@fixture.test',now(),'{"eyeonads_pilot":true}'),('${b}','synthetic@fixture.test',now(),'{"eyeonads_pilot":true,"eyeonads_synthetic":true}');`);
  sql(`insert into eyeonads_brokerage_setups values('${a}','[{"id":"fixture-agent"}]'),('${b}','[{"id":"fixture-agent"}]');`);
  sql(fs.readFileSync('supabase/migrations/20260923_monthly_reliability_canary.sql','utf8'));
  sql(`insert into eyeonads_reliability_configs(owner_id,enabled,next_run_at) values('${a}',true,now()-interval '2 months'),('${b}',true,now());`);
  assert.equal(sql('select eyeonads_enqueue_due_reliability();'),'2');
  assert.equal(sql('select eyeonads_enqueue_due_reliability();'),'0');
  assert.equal(sql("select count(*) from eyeonads_reliability_configs where next_run_at=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';"),'2');
  sql('update eyeonads_reliability_configs set next_run_at=now();');
  assert.equal(sql('select eyeonads_enqueue_due_reliability();'),'0');
  assert.equal(sql('select count(*) from eyeonads_reliability_runs;'),'2');
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${a}';select count(*) from eyeonads_start_reliability();`).split('\n').at(-1),'1');
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${a}';select enabled from eyeonads_set_reliability_schedule(false);`).split('\n').at(-1),'f');
  assert.equal(sql(`select enabled from eyeonads_reliability_configs where owner_id='${b}';`),'t');
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${a}';select enabled from eyeonads_set_reliability_schedule(true);`).split('\n').at(-1),'t');
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${a}';select count(*) from eyeonads_reliability_runs;`).split('\n').at(-1),'1');
  assert.match(sql(`set role authenticated;update eyeonads_reliability_configs set enabled=false;`,true),/permission denied/);
  assert.match(sql('set role authenticated;select eyeonads_claim_reliability();',true),/permission denied/);
  const competingClaim=()=>new Promise((resolve,reject)=>{
   const child=spawn('psql',['-h',dir,'-p','55483','-U',os.userInfo().username,'-d','postgres','-XAt','-v','ON_ERROR_STOP=1']);let output='',error='';
   child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);
   child.on('close',code=>code===0?resolve(JSON.parse(output.split('\n').find(line=>line.startsWith('{')))):reject(Error(error)));
   child.stdin.end('begin;select row_to_json(r) from eyeonads_claim_reliability() r;select pg_sleep(0.1);commit;');
  });
  let [first,other]=await Promise.all([competingClaim(),competingClaim()]);
  assert.notEqual(first.id,other.id);assert.equal(sql('select count(*) from eyeonads_claim_reliability();'),'0');
  const token=first.lease_token;
  assert.equal(sql(`select eyeonads_checkpoint_reliability('${first.id}','00000000-0000-4000-8000-000000000000','control','{"fingerprint":"a","value":1}');`),'f');
  assert.equal(sql(`select eyeonads_checkpoint_reliability('${first.id}','${token}','control','{"fingerprint":"a","value":1}');`),'t');
  sql(`update eyeonads_reliability_runs set lease_expires_at=now()-interval '1 minute' where id='${first.id}';`);
  first=JSON.parse(sql('select row_to_json(r) from eyeonads_claim_reliability() r;'));
  assert.equal(first.attempts,2);assert.notEqual(first.lease_token,token);assert.equal(first.checkpoints.control.value,1);
  assert.equal(sql(`select eyeonads_checkpoint_reliability('${first.id}','${token}','control','{"fingerprint":"b","value":2}');`),'f');
  const report={ownerId:first.owner_id,period:first.period,outcome:'blocked'};
  assert.equal(sql(`select eyeonads_finish_reliability('${first.id}','${first.lease_token}','${JSON.stringify({...report,ownerId:'wrong'})}');`),'f');
  assert.equal(sql(`select eyeonads_finish_reliability('${first.id}','${first.lease_token}','${JSON.stringify(report)}');`),'t');
  assert.equal(sql(`select eyeonads_finish_reliability('${first.id}','${first.lease_token}','${JSON.stringify(report)}');`),'f');
  assert.equal(sql(`select count(*) from eyeonads_reliability_deliveries where run_id='${first.id}';`),'1');
  // Complete the second tenant so both delivery paths can be exercised.
  assert.equal(sql(`select eyeonads_finish_reliability('${other.id}','${other.lease_token}','${JSON.stringify({ownerId:other.owner_id,period:other.period,outcome:'blocked'})}');`),'t');
  const runA=first.owner_id===a?first:other,runB=first.owner_id===b?first:other;
  assert.match(sql(`select eyeonads_claim_reliability_delivery('${runA.id}','attacker@fixture.test','verified_signup');`,true),/Recipient not authorized/);
  const send=JSON.parse(sql(`select row_to_json(d) from eyeonads_claim_reliability_delivery('${runA.id}','broker@fixture.test','verified_signup') d;`));
  assert.equal(send.attempts,1);assert.equal(sql(`select count(*) from eyeonads_claim_reliability_delivery('${runA.id}','broker@fixture.test','verified_signup');`),'0');
  assert.equal(sql(`select eyeonads_record_reliability_delivery('${runA.id}','${send.lease_token}','accepted','fixture-message');`),'t');
  assert.equal(sql(`select status from eyeonads_reliability_deliveries where run_id='${runA.id}';`),'accepted');
  assert.equal(sql(`select count(*) from eyeonads_claim_reliability_delivery('${runA.id}','broker@fixture.test','verified_signup');`),'0');
  assert.match(sql(`select eyeonads_claim_reliability_delivery('${runB.id}','synthetic@fixture.test','verified_signup');`,true),/Recipient not authorized/);
  sql(`update eyeonads_reliability_configs set pilot_recipient_override='theshieldsteam@gmail.com',pilot_recipient_authorized_at=now(),pilot_recipient_authorized_by='fixture-user-authorization' where owner_id='${b}';`);
  const pilot=JSON.parse(sql(`select row_to_json(d) from eyeonads_claim_reliability_delivery('${runB.id}','theshieldsteam@gmail.com','authorized_pilot_override') d;`));assert.equal(pilot.recipient_source,'authorized_pilot_override');
  sql(`update eyeonads_reliability_deliveries set lease_expires_at=now()-interval '1 minute' where run_id='${runB.id}';`);
  assert.equal(sql(`select count(*) from eyeonads_claim_reliability_delivery('${runB.id}','theshieldsteam@gmail.com','authorized_pilot_override');`),'0');
  assert.equal(sql(`select status from eyeonads_reliability_deliveries where run_id='${runB.id}';`),'uncertain');
  assert.equal(sql(`select eyeonads_record_reliability_delivery('${runB.id}','${pilot.lease_token}','accepted','late-receipt');`),'f');
  // A separate synthetic next-month run exhausts exactly three processing attempts.
  sql(`insert into eyeonads_reliability_runs(owner_id,period,config_snapshot) values('${a}','2099-01','{}');`);
  for(let n=1;n<=3;n++){
   const r=JSON.parse(sql('select row_to_json(r) from eyeonads_claim_reliability() r;'));assert.equal(r.attempts,n);
   assert.equal(sql(`select eyeonads_fail_reliability('${r.id}','${r.lease_token}','Fixture outage');`),'t');
   sql(`update eyeonads_reliability_runs set available_at=now() where id='${r.id}';`);
  }
  assert.equal(sql('select count(*) from eyeonads_claim_reliability();'),'0');
  assert.equal(sql("select status from eyeonads_reliability_runs where period='2099-01';"),'failed');
 } finally {
  if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
