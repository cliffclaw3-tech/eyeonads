import type { OfficeSocialRecord, OfficeSocialAd } from '@/lib/office-social-contract';
import { OfficeSocialControls } from './OfficeSocialControls';

function safeURL(value: string | undefined) {
  try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : `${parsed.toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern`;
}
const readable = (value: string) => value.replaceAll('_', ' ');

function SocialAd({ ad }: { ad: OfficeSocialAd }) {
  const source = safeURL(ad.source_url);
  const publisher = safeURL(ad.advertiser?.url);
  const image = ad.image_data_url && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(ad.image_data_url) ? ad.image_data_url : null;
  const observations = ['reviewed', 'partial'].includes(ad.image_review.status) ? ad.image_review.observations : null;
  const assessment = ad.text_review_status === 'reviewed' ? ad.text_review : null;
  return <article className="min-w-0 space-y-4 rounded-xl border border-white/25 p-4 sm:p-5">
    <header className="space-y-2">
      <h3 className="text-lg font-semibold">{ad.advertiser?.name || 'Publisher identity unavailable'}</h3>
      <p className="text-sm">Publisher shown on the ad card{publisher && <> · <a href={publisher} target="_blank" rel="noopener noreferrer" className="underline">Open publisher ↗</a></>}</p>
      <p className="break-words">Meta Library ID: {ad.library_id} · {ad.active === 'unknown' ? 'Activity status unavailable' : readable(ad.active)} · Started: {ad.started_running || 'Not shown'}</p>
      {source && <a href={source} target="_blank" rel="noopener noreferrer" className="inline-block underline">Open original Meta ad ↗</a>}
      <p className="text-sm">Captured {date(ad.captured_at)}</p>
    </header>
    <div className="rounded-lg border border-amber-300/40 p-3">
      <p className="font-semibold">{ad.relevance === 'roster_name_match' ? 'Roster name appears in this ad' : ad.relevance === 'office_reference' ? 'Office reference found' : 'Brokerage reference — affiliation unverified'}</p>
      <p>{ad.relevance_note}</p><p>{ad.attribution_note}</p>
      {ad.current_page_advertiser && ad.current_page_advertiser !== ad.advertiser?.name && <p>Current advertiser page: {ad.current_page_advertiser}. This differs from the ad publisher shown above.</p>}
      <p className="text-sm">A name or brokerage reference does not establish current affiliation, ownership, or responsibility for the ad.</p>
    </div>
    <div><h4 className="font-semibold">Ad copy captured</h4><p className="mt-2 whitespace-pre-wrap break-words">{ad.ad_text || 'No readable ad copy captured. Text remains unchecked.'}</p>{ad.truncated && <p className="text-sm">Only part of the visible text was saved. Open the original ad for the remaining context.</p>}</div>
    <div><h4 className="font-semibold">Automated text assessment</h4>{assessment ? <>
      <p className="mt-2 font-semibold">{assessment.result === 'green' ? 'No text issues detected — not approval' : assessment.result === 'red' ? 'Potential serious issue — human review needed' : 'Review needed'}</p>
      <p>{assessment.summary}</p>
      {assessment.flags.map((flag, index) => <div className="mt-3 border-l-2 border-amber-300 pl-3" key={index}><p className="font-semibold">{flag.rule}</p><p>{flag.explanation}</p><p>Next action: {flag.recommendation}</p></div>)}
    </> : <p>Text assessment unavailable. The captured copy has not received a completed automated review.</p>}</div>
    <div className="space-y-3"><h4 className="font-semibold">Saved image evidence</h4>
      {image ? <figure>{/* Preserved image bytes must remain recognizable without a live third-party URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={`Saved ${ad.media_scope === 'video_poster_only' ? 'video poster' : 'ad image'} for Meta ad ${ad.library_id}`} className="max-h-[32rem] w-full rounded-lg bg-white object-contain" />
        <figcaption className="mt-2 text-sm">Image preserved with this result. Capturing an image does not by itself mean it was reviewed.</figcaption>
      </figure> : <p>No preserved image is available to view. Open the original ad to inspect its imagery.</p>}
      {ad.media_scope === 'video_poster_only' && <p className="font-semibold">Video poster only. Video frames, audio, and motion were not reviewed.</p>}
      {ad.media_scope === 'multiple_assets_partial' && <p className="font-semibold">Partial creative coverage. Other carousel images or video content remain unchecked.</p>}
      {observations ? <><p className="font-semibold">{ad.image_review.status === 'partial' ? 'Partial image review' : 'Saved image reviewed'}</p><p>{ad.image_review.notes}</p><p>Image type: {readable(observations.creative_kind)}. EHO logo or words: {readable(observations.eho)}. Brokerage identification: {readable(observations.brokerage)}. Contact details: {readable(observations.contact)}. License disclosure: {readable(observations.license)}.</p><p>{observations.notes}</p></> : <><p className="font-semibold">Image not reviewed</p><p>{ad.image_review.notes}</p></>}
      <p className="text-sm">Not visible means absent from the inspected image only. An unseen EHO logo, license number, or disclosure does not automatically establish a violation. Complete ad context and linked disclosures require human review.</p>
    </div>
  </article>;
}

export function OfficeSocialReport({ record }: { record: OfficeSocialRecord | null }) {
  const evidence = record?.evidence;
  const startedAt = record ? new Date(record.searched_at).getTime() : NaN;
  // This server component evaluates the persisted lease on each fresh request.
  // eslint-disable-next-line react-hooks/purity
  const stale = record?.status === 'running' && (!Number.isFinite(startedAt) || Date.now() - startedAt >= 180000);
  const source = safeURL(evidence?.source_url);
  return <section aria-labelledby="office-social-heading" className="my-8 min-w-0 space-y-4 rounded-2xl border border-white/25 p-4 sm:p-6">
    <h2 id="office-social-heading" className="text-2xl font-semibold">Office public social ads</h2>
    <p>A separate sample of public Meta ads mentioning your office or roster. These ads are not additional agents and do not change the agent search counts above.</p>
    <p className="text-sm">Daily or weekly checks use the same schedule as this broker report. Coverage is incomplete: private posts, unrendered ads, other images, video, and linked disclosures may remain unchecked. Findings need human review and do not certify compliance.</p>
    {record ? <div role="status"><p className="font-semibold">{record.status === 'running' ? stale ? 'Previous public social check may have been interrupted' : 'Public social check running' : record.status === 'failed' ? 'Public social check did not finish' : 'Latest public social check saved'}</p><p>Last check {record.status === 'running' ? 'started' : 'recorded'}: {date(record.searched_at)}</p>{stale && <p>No completion was saved within three minutes. Start a new public social check to retry.</p>}{record.status === 'failed' && <p>Try the check again. Any earlier saved evidence below remains available.</p>}{record.status !== 'complete' && evidence && <p>The evidence below is from an earlier saved check.</p>}</div> : <p>No public social check saved yet. Check public social ads to capture a sample.</p>}
    <OfficeSocialControls running={record?.status === 'running' && !stale} />
    {evidence && <><div className="space-y-2"><p>Evidence saved: {date(evidence.retrieved_at)}</p><p className="break-words">Search: {evidence.query}</p>{source && <a href={source} target="_blank" rel="noopener noreferrer" className="inline-block underline">Open public Meta search ↗</a>}<p>{evidence.acquisition_note}</p>{evidence.acquisition_status !== 'available' && <p className="font-semibold">{evidence.acquisition_status === 'unavailable' ? 'Public ad evidence unavailable for this check.' : 'Only partial public ad evidence was captured.'}</p>}</div>
      {evidence.ads.length ? <div className="space-y-5">{evidence.ads.slice(0, 3).map(ad => <SocialAd ad={ad} key={ad.library_id} />)}</div> : <p>No matching ad evidence was saved in this sample. This does not mean no public ads exist or that marketing is compliant.</p>}
      {evidence.coverage_gaps.length > 0 && <div><h3 className="font-semibold">What remains unchecked</h3><ul className="mt-2 list-disc space-y-2 pl-5">{evidence.coverage_gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
    </>}
  </section>;
}
