import { NextRequest, NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/discovery-runner';
import { createClient } from '@/lib/supabase/server';
export const maxDuration=120;
export async function GET(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Sign in to discover public marketing.'},{status:401});
 if(!user.app_metadata?.eyeonads_pilot)return NextResponse.json({error:'Public discovery is enabled for invited brokerage pilots only.'},{status:403});
 const [setup,reviews]=await Promise.all([db.from('eyeonads_brokerage_setups').select('*').eq('owner_id',user.id).maybeSingle(),db.from('eyeonads_discovery_reviews').select('agent_id,agent_name,status,report,sources,searched_at,error').eq('owner_id',user.id)]);
 if(setup.error||reviews.error)return NextResponse.json({error:'Search history could not be loaded. Please retry.'},{status:503});
 return NextResponse.json({brokerage:setup.data?{name:setup.data.name,expected_agents:setup.data.expected_agents,website:setup.data.website,location:setup.data.location}:null,agents:(setup.data?.agents??[]).filter((agent:{id:string})=>setup.data?.discovery_agent_ids==null||setup.data.discovery_agent_ids.includes(agent.id)),reviews:reviews.data??[]},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:NextRequest){
 const origin=request.headers.get('origin');const host=request.headers.get('x-forwarded-host')||request.headers.get('host');
 if(origin&&new URL(origin).host!==host)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Sign in to discover public marketing.'},{status:401});
 if(!user.app_metadata?.eyeonads_pilot)return NextResponse.json({error:'Public discovery is enabled for invited brokerage pilots only.'},{status:403});
 const body=await request.json().catch(()=>null);
 if(typeof body?.agent_id!=='string'||body.agent_id.length>300)return NextResponse.json({error:'Choose an agent from your saved roster.'},{status:400});
 const {data:setup,error}=await db.from('eyeonads_brokerage_setups').select('*').eq('owner_id',user.id).maybeSingle();
 if(error)return NextResponse.json({error:'Your roster could not be loaded.'},{status:503});
 const agent=setup?.agents.find((a:{id:string})=>a.id===body.agent_id && (setup.discovery_agent_ids==null||setup.discovery_agent_ids.includes(a.id)));
 if(!agent)return NextResponse.json({error:'Save this agent in brokerage setup first.'},{status:400});
 if(process.env.EYEONADS_PAID_ANALYSIS_ENABLED!=='1'||!process.env.OPENAI_API_KEY)return NextResponse.json({error:'Public search is not configured. You can still scan ad copy manually.'},{status:503});
 try {const review=await runDiscovery(db,user.id,setup,agent);return NextResponse.json({review},{headers:{'Cache-Control':'no-store'}});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Search did not finish. Retry this agent.'},{status:503});}
}
