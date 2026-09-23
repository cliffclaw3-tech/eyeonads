import type { DiscoveredAd } from './discovered-ad-contract';
import type { AdReview } from './ad-review';
import type { SourceImageReview } from './source-image-review';
export type ReportCandidate = DiscoveredAd & {image_review?:SourceImageReview;review:AdReview|null;review_status:'reviewed'|'not_reviewed'|'failed'};
export function discoveryReport(candidates:ReportCandidate[]) {
  const assessed=candidates.filter(ad=>ad.review_status==='reviewed');
  const identityNote=`${assessed.length} source${assessed.length===1?'':'s'} had advertising text and agent/brokerage identity verified for assessment. Verify the original source and current context before acting on any finding.`;
  const coverageGaps=candidates.filter(ad=>ad.review_status!=='reviewed').map(ad=>`${ad.title}: ${ad.page_access==='blocked'?'The source page could not be retrieved.':ad.kind==='profile'?'Only profile information was found.':ad.review_status==='failed'?'The text assessment did not finish.':'Matched advertising text and a supported state could not be verified.'} No ad assessment is confirmed for this source.`);
  coverageGaps.push('Public searches sample up to six sources per agent. Private or unindexed posts, other advertisements, images, layout and linked disclosures may remain unchecked.');

  const sources=candidates.map(ad=>({url:ad.url,title:ad.title}));
  const lines=[`Identity\n${identityNote}`,'Public marketing found'];
  if(!candidates.length)lines.push('No verified marketing found. This is not compliance clearance.');
  for(const ad of candidates){
    lines.push(`${ad.title} — ${ad.review_status==='reviewed'?'Ad text assessed':'Ad text not assessed'}\n[Source](${ad.url})\n${ad.review_status==='reviewed'?ad.context:ad.page_access==='blocked'?'The search found this source, but its page could not be retrieved for assessment. Review the original source manually.':'This source did not supply verified, matched advertising text for assessment. Review the original source manually.'}`);
    if(ad.review){lines.push(`Text assessed\n${ad.ad_text}`,`Suggested assessment: ${ad.review.result.toUpperCase()} — ${ad.review.summary}`);for(const flag of ad.review.flags)lines.push(`${flag.rule}: ${flag.explanation} Next action: ${flag.recommendation}`);}
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
