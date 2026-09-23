import type { RetrievedAd } from './retrieve-ad';
import type { AdReview } from './ad-review';
import type { SourceImageReview } from './source-image-review';
export type ReportCandidate = RetrievedAd & {reassessed_at?:string;image_review?:SourceImageReview;review:AdReview|null;review_status:'reviewed'|'not_reviewed'|'failed'};
export function coverageGap(ad:ReportCandidate):string {
  if(ad.review_status==='failed')return 'The text assessment did not finish. Retry the assessment or review the captured source manually.';
  if(ad.kind==='profile'||ad.retrieval_status==='profile_only')return 'Only profile information was found. Supply an actual advertisement or property page.';
  const cause=ad.retrieval_failure?.cause||ad.retrieval_status;
  if(ad.attribution?.role==='buyer_agent')return 'The agent appears as a buyer representative, not the listing advertiser. Do not assign this advertisement to that agent.';
  const messages:Record<string,string>={
    forbidden:'The publisher refused automated access (HTTP 403). Open the original source manually or use another public source.',
    unauthorized:'The publisher requires access permission. Open the source with your authorized account.',
    challenge:'The publisher presented a security challenge. Open the original source manually or use another public source.',
    rate_limited:'The publisher limited requests (HTTP 429). Retry later or inspect the original source.',
    not_found:'The source is no longer available (HTTP 404 or 410). Look for a current advertisement.',
    timeout:'The source timed out. Retry later or open it manually.',
    deadline:'The check reached its time limit. Retry this source or inspect it manually.',
    network:'The source could not be reached. Retry later or inspect it manually.',
    no_promotional_content:'The page did not contain assessable advertising text. An old search result may no longer represent a live advertisement.',
    identity_unverified:'The listing advertiser and brokerage could not be verified together on this source. Confirm attribution before assigning responsibility.',
    unsupported_state:'The property state could not be verified as TN, VA or NC. Confirm its jurisdiction before assessment.',
    invalid_block_ids:'Source text selection failed validation. Retry extraction or inspect the page manually.',
    invalid_selection:'Source text selection failed validation. Retry extraction or inspect the page manually.',
    provider_temporary:'The extraction provider was temporarily unavailable. Retry later.',
    provider_error:'The extraction provider did not return usable evidence. Retry or inspect the page manually.',
  };
  if(cause&&messages[cause])return messages[cause];
  if(ad.page_access==='blocked')return 'The source page could not be retrieved. The saved result does not identify the cause; retry or inspect the original source manually.';
  return 'Matched advertising text and a supported state could not be verified. Inspect the source and its listing attribution manually.';
}
export function discoveryReport(candidates:ReportCandidate[]) {
  const assessed=candidates.filter(ad=>ad.review_status==='reviewed');
  const identityNote=`${assessed.length} source${assessed.length===1?'':'s'} had advertising text and agent/brokerage identity verified for assessment. Verify the original source and current context before acting on any finding.`;
  const coverageGaps=candidates.filter(ad=>ad.review_status!=='reviewed').map(ad=>`${ad.title}: ${coverageGap(ad)} No ad assessment is confirmed for this source.`);
  coverageGaps.push('Public searches sample up to nine sources per agent, including a bounded alternative search when needed. Private or unindexed posts, other advertisements, images, layout and linked disclosures may remain unchecked.');

  const sources=candidates.map(ad=>({url:ad.url,title:ad.title}));
  const lines=[`Identity\n${identityNote}`,'Public marketing found'];
  if(!candidates.length)lines.push('No verified marketing found. This is not compliance clearance.');
  for(const ad of candidates){
    lines.push(`${ad.title} — ${ad.review_status==='reviewed'?'Ad text assessed':'Ad text not assessed'}\n[Source](${ad.url})\n${ad.review_status==='reviewed'?ad.context:ad.page_access==='blocked'?'The search found this source, but its page could not be retrieved for assessment. Review the original source manually.':'This source did not supply verified, matched advertising text for assessment. Review the original source manually.'}`);
    if(ad.review){if(ad.reassessed_at)lines.push(`Saved text reassessed ${ad.reassessed_at}; original source capture was not refreshed.`);if(ad.review.coverage_notes?.length)lines.push(`Assessment coverage: ${ad.review.coverage_notes.join(' ')}`);lines.push(`Text assessed\n${ad.ad_text}`,`Suggested assessment: ${ad.review.result.toUpperCase()} — ${ad.review.summary}`);for(const flag of ad.review.flags)lines.push(`${flag.rule}: ${flag.explanation} Next action: ${flag.recommendation}`);}
    else lines.push(ad.review_status==='failed'?'Compliance engine unavailable. This content was not assessed; retry or review manually.':'No ad assessment: matched advertising text and a supported state were not established from an accessible page.');
    const image=ad.image_review;
    if(image){
      lines.push(`Image review: ${image.status}. ${image.notes}`);
      if(image.capture)lines.push(`[Captured source image](${image.capture.image_url})\nImage captured ${image.capture.retrieved_at}; SHA-256 ${image.capture.sha256}. This source URL can change; the hash identifies the bytes inspected.`);
      if(image.observations){const o=image.observations;lines.push(`Image type: ${o.creative_kind.replaceAll('_',' ')}. EHO logo/words: ${o.eho.replaceAll('_',' ')}; brokerage identification: ${o.brokerage.replaceAll('_',' ')}; contact details: ${o.contact.replaceAll('_',' ')}; license: ${o.license.replaceAll('_',' ')}. ${o.notes} These visibility observations are not determinations of a violation.`);}
    }else lines.push('Image review not performed for this source.');

  }
  lines.push('Coverage gaps',...coverageGaps,'A completed search is not compliance clearance. Verify source identity, context and all suggested findings.');
  return {identity_note:identityNote,coverage_gaps:coverageGaps,sources,report:lines.join('\n\n')};
}
