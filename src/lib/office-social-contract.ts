import type { MetaAdCard } from './meta-ad-cards';
import type { AdReview } from './ad-review';
import type { SourceImageReview } from './source-image-review';
export const OFFICE_SOCIAL_ID='__office_public_social__';
export type OfficeSocialAd = MetaAdCard & {
  relevance:'roster_name_match'|'office_reference'|'brokerage_reference_unverified';
  relevance_note:string;
  matched_agent_ids:string[];
  ad_text:string;
  text_review:AdReview|null;
  reassessed_at?:string;
  text_review_status:'reviewed'|'not_reviewed'|'unavailable';
  image_review:SourceImageReview;
  image_data_url?:string;
};
export type OfficeSocialEvidence = {
  version:1;kind:'office_public_social';query:string;source_url:string;retrieved_at:string;
  acquisition_status:'available'|'partial'|'unavailable';
  acquisition_note:string;rendered_cards:number;excluded_cards:number;
  ads:OfficeSocialAd[];coverage_gaps:string[];
};
export type OfficeSocialRecord={status:'running'|'complete'|'failed';searched_at:string;error:string|null;evidence:OfficeSocialEvidence|null};
