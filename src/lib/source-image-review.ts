import { readPublicImage, type PublicImageCapture } from './public-image';
import type { PublicImageCandidate } from './public-page';
import { reviewAdImage, type ImageReview } from './image-review';

export type SourceImageReview = ImageReview & {capture?:Omit<PublicImageCapture,'data_url'>};
export async function reviewSourceImage(candidate:PublicImageCandidate|undefined,deadline:number):Promise<SourceImageReview> {
  if(!candidate)return {status:'not_requested',observations:null,notes:'No supported image was found on the matched source page. Ad imagery remains unchecked.'};
  if(deadline-Date.now()<25000)return {status:'unavailable',observations:null,notes:'Image review was not attempted within this search’s time limit. Open the original source to inspect its imagery.'};
  try {
    const {data_url,...capture}=await readPublicImage(candidate);
    const review=await reviewAdImage(data_url,`Image referenced by the matched public source ${capture.source_url}. Role: ${capture.role}; alternative text: ${capture.alt}. This may be a property photo or social preview, not the complete ad. Do not infer ownership merely from this reference.`);
    return {...review,capture};
  }catch{return {status:'unavailable',observations:null,notes:'The source image could not be retrieved safely. No missing disclosure was established.'};}
}
