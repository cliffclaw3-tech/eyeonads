import Link from 'next/link';
import { SourceImageEvidence } from '@/components/SourceImageEvidence';
import { discoveryReport, type ReportCandidate } from '@/lib/discovery-report';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PrintReport } from '@/components/PrintReport';
import { ReportControls } from '@/components/ReportControls';
import { validSourceURL } from '@/lib/discovered-ad-contract';

type Evidence = { candidates: ReportCandidate[]; coverage_gaps: string[]; identity_note: string };
export default async function ReportPage() {
  const db = await createClient();
  const {data:{user}} = await db.auth.getUser();
  if (!user) redirect('/login');
  const [setupResult,reviewsResult] = await Promise.all([
    db.from('eyeonads_brokerage_setups').select('*').eq('owner_id',user.id).maybeSingle(),
    db.from('eyeonads_discovery_reviews').select('agent_id,status,searched_at,evidence').eq('owner_id',user.id),
  ]);
  const setup=setupResult.data;
  const savedAgents=(setup?.agents || []) as {id:string;name:string}[];
  const agents=savedAgents.filter(agent=>setup?.discovery_agent_ids==null||setup.discovery_agent_ids.includes(agent.id));
  const rows=agents.map(agent=>{
    const saved=reviewsResult.data?.find(review=>review.agent_id===agent.id);
    const evidence=saved?.evidence as Evidence | null;
    const current=saved?.status==='complete';
    const candidates=current ? evidence?.candidates || [] : [];
    const reviewed=candidates.filter(ad=>ad.review_status==='reviewed' && ad.review);
    const issues=reviewed.filter(ad=>ad.review!.result!=='green');
    const presentation=discoveryReport(candidates);
    return {agent,saved,evidence: evidence?{...evidence,coverage_gaps:presentation.coverage_gaps}:null,current,candidates,reviewed,issues};
  });
  const checked=rows.filter(row=>row.reviewed.length>0).length;
  const flagged=rows.filter(row=>row.issues.length>0);
  const gaps=rows.filter(row=>!row.current || !row.reviewed.length || row.candidates.some(ad=>ad.review_status!=='reviewed'));
  const imageCount=rows.flatMap(row=>row.candidates).filter(ad=>ad.image_review?.observations).length;
  const missing=setup?.discovery_agent_ids==null?Math.max(0,(setup?.expected_agents||0)-agents.length):0;
  return <main className="min-h-screen bg-[#0d1b2a] px-4 py-8 text-white sm:px-8 print:bg-white print:text-black">
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="flex flex-wrap gap-4 text-sm print:hidden"><Link href="/broker" className="underline">Brokerage setup</Link><Link href="/broker/discovery" className="underline">Run checks / view progress</Link><PrintReport /></nav>
      <header><h1 className="text-3xl font-bold">Broker marketing report</h1><p className="mt-2">{setup?.name || 'Your brokerage'}{setup?.discovery_location ? ` · ${setup.discovery_location}` : ''} · Latest saved findings</p></header>
      {(setupResult.error||reviewsResult.error) ? <p role="alert">Report data could not be loaded. Refresh to retry; no coverage counts are confirmed.</p> : <>
        <section className="rounded-xl border border-white/25 p-5 print:border-gray-400">
          <h2 className="text-xl font-semibold">At a glance</h2>
          <p className="mt-3">{agents.length} agents in report scope · {checked} with ad text assessed.</p>
          <div className="mt-3 flex flex-wrap gap-3 print:hidden"><a href="#possible-issues" className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold">Review possible issues ({flagged.length})</a><a href="#coverage-gaps" className="inline-flex min-h-11 items-center underline">See coverage gaps ({gaps.length})</a></div>
          <p className="mt-3 text-sm">{imageCount} source images have saved visibility observations. This screens sampled public ad text and available source images. Findings need human review and do not certify compliance.</p>
          <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-2">Scope and limits</summary><p>{savedAgents.length} agents remain in the full saved roster. {missing>0 ? `${missing} are missing compared with your full estimate of ${setup?.expected_agents}. ` : ''}Knoxville is intentionally outside this office pilot and requires a separate MLS/Spark connection.</p><p className="mt-2">Images, layout, private posts, unindexed ads, and one-click social disclosures may remain unchecked. Read the dates below: these are latest saved results, not a guarantee of current advertising.</p></details>
        </section>
        <ReportControls />
        <section id="possible-issues" className="scroll-mt-4"><h2 className="text-2xl font-semibold">Possible issues to review ({flagged.length} agents)</h2>
          {!flagged.length && <p className="mt-3">No possible issues are recorded in the completed text assessments. Check the coverage gaps below before drawing any conclusion.</p>}
          {flagged.map(row=><article key={row.agent.id} className="mt-4 space-y-3 rounded-xl border border-amber-400/50 p-5 print:break-inside-avoid"><h3 className="text-xl font-semibold">{row.agent.name}</h3><p className="text-sm">Checked {new Date(row.saved!.searched_at).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern</p>{row.issues.map((ad,index)=><div key={index} className="space-y-2"><p className="font-semibold">{ad.review!.result.toUpperCase()} · {ad.title}</p>{validSourceURL(ad.url)&&<a href={ad.url} target="_blank" rel="noopener noreferrer" className="break-all underline">Open original source ↗</a>}<p>{ad.review!.summary}</p><ul className="list-disc space-y-2 pl-5">{ad.review!.flags.map((flag,i)=><li key={i}><strong>{flag.rule}:</strong> {flag.explanation} <span className="block">Next action: {flag.recommendation}</span></li>)}</ul><details><summary className="cursor-pointer underline">Text and context assessed</summary><p className="mt-2 whitespace-pre-wrap break-words">{ad.ad_text}</p><p className="mt-2">{ad.context}</p></details></div>)}</article>)}
        </section>
        <section id="coverage-gaps" className="scroll-mt-4"><h2 className="text-2xl font-semibold">Coverage gaps ({gaps.length} agents)</h2><p className="mt-2">A profile match or search snippet is not a reviewed ad.</p><ul className="mt-4 space-y-3">{gaps.map(row=><li key={row.agent.id} className="rounded-lg border border-white/20 p-4 print:border-gray-400"><strong>{row.agent.name}</strong> — {!row.saved?'Not searched yet.':row.saved.status==='failed'?'Search failed; retry required.':row.saved.status==='running'?'Search in progress.':!row.evidence?'Older search report; rerun for evidence-based ad assessment.':!row.reviewed.length?'No accessible matched ad text was assessed.':'Some discovered content was not assessed.'}{row.evidence?.coverage_gaps?.length ? <p className="mt-2 text-sm">{row.evidence.coverage_gaps.join(' ')}</p>:null}</li>)}</ul></section>
        <section><h2 className="text-2xl font-semibold">All agents</h2><ul className="mt-3 space-y-2">{rows.map(row=><li key={row.agent.id}><strong>{row.agent.name}</strong> — {row.reviewed.length} ad text assessment{row.reviewed.length===1?'':'s'}; {row.issues.length} needing review{row.saved?.searched_at?`; last search ${new Date(row.saved.searched_at).toLocaleDateString('en-US',{timeZone:'America/New_York'})}`:''}.{row.reviewed.length>0&&<details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 underline">Source text and image evidence for {row.agent.name}</summary>{row.reviewed.map((ad,index)=><div key={index} className="my-3 space-y-2"><p className="font-semibold">{ad.title}</p>{validSourceURL(ad.url)&&<a href={ad.url} target="_blank" rel="noopener noreferrer" className="break-all underline">Open original source ↗</a>}<p className="whitespace-pre-wrap break-words">{ad.ad_text}</p><p>{ad.context}</p><SourceImageEvidence review={ad.image_review}/></div>)}</details>}</li>)}</ul></section>
        {!agents.length && <Link href="/broker" className="inline-block rounded-lg bg-blue-600 px-4 py-3">Add your brokerage roster</Link>}
      </>}
    </div>
  </main>;
}
