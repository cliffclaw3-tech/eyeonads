"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
type Schedule = {cadence:'manual'|'daily'|'weekly';next_run_at:string|null};
type Job = {status:string;completed:number;total:number;error?:string};
export function ReportControls(){
 const router=useRouter();
 const [schedule,setSchedule]=useState<Schedule|null>(null);
 const [cadence,setCadence]=useState('manual');
 const [job,setJob]=useState<Job|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let alive=true;
  void Promise.all([fetch('/api/brokerage/report-schedule',{cache:'no-store'}),fetch('/api/discovery/jobs',{cache:'no-store'})]).then(async([a,b])=>{
   const [s,j]=await Promise.all([a.json(),b.json()]);
   if(!a.ok||!b.ok)throw Error(s.error||j.error||'Report controls could not be loaded.');
   if(alive){setSchedule(s.schedule);setCadence(s.schedule.cadence);setJob(j.job);setLoaded(true);}
  }).catch(err=>{if(alive)setError(err.message);});
  return()=>{alive=false;};
 },[]);
 useEffect(()=>{
  if(job?.status!=='running')return;
  let active=true,polling=false;
  const timer=setInterval(async()=>{
   if(polling)return;polling=true;
   try{const r=await fetch('/api/discovery/jobs',{cache:'no-store'});const b=await r.json();if(!r.ok)throw Error();if(active){setJob(b.job);router.refresh();}}
   catch{if(active)setError('Progress could not refresh. The server may still be working; reload to check.');}
   finally{polling=false;}
  },15000);
  return()=>{active=false;clearInterval(timer);};
 },[job?.status,router]);
 async function action(kind:'schedule'|'run'){
  if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   const r=await fetch(kind==='schedule'?'/api/brokerage/report-schedule':'/api/discovery/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='schedule'?{cadence}:{fresh:true})});
   const b=await r.json();if(!r.ok)throw Error(b.error||'Change could not be saved.');
   if(kind==='schedule'){setSchedule(b.schedule);setMessage(b.schedule.cadence==='manual'?'Scheduled checks are off. Any current batch may still finish.':'Schedule saved. The next start time is shown below; use Run fresh report for an immediate check.');}
   else{setJob(b.job);setMessage('Fresh checks queued. You can close the browser. This page will show saved findings as checks finish.');}
   router.refresh();
  }catch(err){setError(err instanceof Error?err.message:'Please retry.');}finally{setBusy(false);}
 }
 return <section className="space-y-3 rounded-xl border border-white/25 p-5 print:hidden">
  <h2 className="text-xl font-semibold">Run and schedule checks</h2>
  <p className="text-sm">Each run searches the selected agents and samples up to three public sources per agent for readable ad text. Large rosters can take several hours. Recurring checks use the same partial public-web coverage; they do not connect private accounts.</p>
  {!loaded&&!error&&<p role="status">Loading saved schedule and search progress…</p>}
  <button disabled={!loaded||busy||['running','paused'].includes(job?.status||'')} onClick={()=>void action('run')} className="min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold disabled:opacity-40">{busy?'Saving…':'Run fresh report'}</button>
  {job&&<p role="status">Latest batch: {job.status} · {job.completed} of {job.total} agent searches completed. {job.error}</p>}
  {['paused','failed','running'].includes(job?.status||'')&&<Link href="/broker/discovery" className="block underline">Manage or resume this batch</Link>}
  <div className="flex flex-wrap items-end gap-3"><div><label htmlFor="report-cadence" className="mb-2 block">How often?</label><select id="report-cadence" value={cadence} onChange={e=>setCadence(e.target.value)} disabled={!loaded||busy} className="min-h-11 rounded-lg border border-white/30 bg-[#12253a] px-3 py-2"><option value="manual">On demand only</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div><button disabled={!loaded||busy} onClick={()=>void action('schedule')} className="min-h-11 rounded-lg border border-white/30 px-4 py-2 disabled:opacity-40">Save schedule</button></div>
  {schedule&&<p className="text-sm">Saved frequency: {schedule.cadence==='manual'?'On demand':schedule.cadence}. {schedule.next_run_at?`Next scheduled start: ${new Date(schedule.next_run_at).toLocaleString()}. A paused or failed batch must be resumed before another scheduled run starts.`:''} Reports are available here; email delivery is not enabled.</p>}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error} <button className="underline" onClick={()=>window.location.reload()}>Reload controls</button></p>}
 </section>;
}
