import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateBrokerage } from '@/lib/brokerage';
export async function GET() {
 const db=await createClient(); const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Sign in to manage your brokerage.'},{status:401});
 const {data,error}=await db.from('eyeonads_brokerage_setups').select('*').eq('owner_id',user.id).maybeSingle();
 if(error)return NextResponse.json({error:'Your brokerage setup could not be loaded. Please retry.'},{status:503});
 return NextResponse.json({brokerage:data?{id:data.id,name:data.name,expected_agents:data.expected_agents,scope:data.scope,website:data.website,location:data.location}:null,agents:data?.agents??[]},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:NextRequest) {
 const origin=request.headers.get('origin'); const host=request.headers.get('x-forwarded-host')||request.headers.get('host');
 if(origin&&new URL(origin).host!==host)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 const db=await createClient(); const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Sign in to manage your brokerage.'},{status:401});
 const body=await request.json().catch(()=>null);const validation=validateBrokerage(body);
 if(validation)return NextResponse.json({error:validation},{status:400});
 const agents=body.agents.map((a:{id?:string,name:string,email:string,social_url?:string})=>({id:a.id?.trim()||a.email.trim().toLowerCase()||a.name.trim().toLowerCase(),name:a.name.trim(),email:a.email.trim().toLowerCase(),social_url:a.social_url?.trim()||''}));
 const {data,error}=await db.from('eyeonads_brokerage_setups').upsert({owner_id:user.id,name:body.name.trim(),expected_agents:body.expected_agents,scope:body.scope,website:body.website?.trim()||'',location:body.location?.trim()||'',agents,updated_at:new Date().toISOString()},{onConflict:'owner_id'}).select('*').single();
 if(error)return NextResponse.json({error:'Setup could not be saved. Your previous roster is unchanged; please retry.'},{status:503});
 return NextResponse.json({brokerage:{id:data.id,name:data.name,expected_agents:data.expected_agents,scope:data.scope,website:data.website,location:data.location},agents:data.agents},{headers:{'Cache-Control':'no-store'}});
}
