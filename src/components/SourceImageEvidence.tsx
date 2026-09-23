import type { SourceImageReview } from '@/lib/source-image-review';
import { validSourceURL } from '@/lib/discovered-ad-contract';

export function SourceImageEvidence({review}:{review?:SourceImageReview}) {
  if(!review)return <p className="mt-2 text-sm">Image review not performed for this source.</p>;
  const observed=review.observations;
  const readable=(value:string)=>value.replaceAll('_',' ');
  return <div className="mt-3 space-y-2 rounded-lg border border-white/25 p-3 print:border-gray-400">
    <p className="font-semibold">Image review: {readable(review.status)}</p>
    <p>{review.notes}</p>
    {review.capture && <><p>{validSourceURL(review.capture.image_url)&&<a className="underline" href={review.capture.image_url} target="_blank" rel="noopener noreferrer">Open captured source image ↗</a>}</p><p className="text-sm">Captured {new Date(review.capture.retrieved_at).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern. Referenced by the source page; this alone does not prove ownership.</p><details><summary className="cursor-pointer underline">Image evidence details</summary><p className="break-all text-xs">SHA-256: {review.capture.sha256}</p><p className="break-all text-xs print:hidden">{review.capture.image_url}</p><p className="text-sm">The live image URL may change. The hash identifies the bytes inspected.</p></details></>}
    {observed&&<><p>Image type: {readable(observed.creative_kind)}. EHO logo/words: {readable(observed.eho)}. Brokerage identification: {readable(observed.brokerage)}. Contact details: {readable(observed.contact)}. License: {readable(observed.license)}.</p><p>{observed.notes}</p><p className="text-sm">Visibility observations are not determinations of a violation. Review the complete ad and applicable requirements.</p></>}
  </div>;
}
