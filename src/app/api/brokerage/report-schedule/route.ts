import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/discovery-jobs';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,write:boolean){
 if(write&&!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return reply({error:'Sign in to manage reports.'},401);
 if(!user.app_metadata?.eyeonads_pilot)return reply({error:'Brokerage reports are enabled for invited pilots.'},403);
 if(write){
  const body=await request.json().catch(()=>null);
  if(!['manual','daily','weekly'].includes(body?.cadence))return reply({error:'Choose on demand, daily, or weekly.'},400);
  if(body.cadence!=='manual'){
   if(process.env.EYEONADS_PAID_ANALYSIS_ENABLED!=='1'||!process.env.OPENAI_API_KEY||!process.env.EYEONADS_WORKER_SECRET)return reply({error:'Scheduled checks are not configured.'},503);
   const {data:setup,error}=await db.from('eyeonads_brokerage_setups').select('agents,discovery_agent_ids').eq('owner_id',user.id).maybeSingle();
   if(error)return reply({error:'Roster could not be verified.'},503);
   if(!setup?.agents?.some((agent:{id:string})=>setup.discovery_agent_ids==null||setup.discovery_agent_ids.includes(agent.id)))return reply({error:'Save your agent roster before scheduling checks.'},400);
  }
  const saved=await db.from('eyeonads_report_schedules').upsert({owner_id:user.id,cadence:body.cadence,next_run_at:body.cadence==='manual'?null:new Date(Date.now()+(body.cadence==='daily'?1:7)*86400000).toISOString(),updated_at:new Date().toISOString()});
  if(saved.error)return reply({error:'Schedule could not be saved. Please retry.'},503);
 }
 const result=await db.from('eyeonads_report_schedules').select('cadence,next_run_at').eq('owner_id',user.id).maybeSingle();
 if(result.error)return reply({error:'Schedule could not be loaded. Please retry.'},503);
 return reply({schedule:result.data||{cadence:'manual',next_run_at:null}});
}
export async function GET(request:Request){return handle(request,false);}
export async function POST(request:Request){return handle(request,true);}
