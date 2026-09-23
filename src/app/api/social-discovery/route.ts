import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runOfficeSocial } from '@/lib/office-social-runner';
export const runtime='nodejs';
export const maxDuration=120;
export async function POST(request:NextRequest){
 const origin=request.headers.get('origin'),host=request.headers.get('x-forwarded-host')||request.headers.get('host');
 if(origin&&new URL(origin).host!==host)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Sign in to check public social ads.'},{status:401});
 if(!user.app_metadata?.eyeonads_pilot)return NextResponse.json({error:'Public social checks are enabled for invited brokerage pilots only.'},{status:403});
 const setup=await db.from('eyeonads_brokerage_setups').select('*').eq('owner_id',user.id).maybeSingle();
 if(setup.error)return NextResponse.json({error:'Your brokerage could not be loaded. Retry.'},{status:503});
 if(!setup.data?.name)return NextResponse.json({error:'Save your brokerage name before checking public social ads.'},{status:400});
 if(process.env.EYEONADS_PAID_ANALYSIS_ENABLED!=='1'||!process.env.OPENAI_API_KEY)return NextResponse.json({error:'Public social assessment is not configured.'},{status:503});
 try{const review=await runOfficeSocial(db,user.id,setup.data);return NextResponse.json({review,message:review?'Public social check saved.':'A public social check is already running. Refresh the report shortly.'},{headers:{'Cache-Control':'no-store'}});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Public social check did not finish. Retry.'},{status:503});}
}
