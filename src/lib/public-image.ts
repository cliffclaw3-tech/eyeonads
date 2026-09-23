import { createHash } from 'node:crypto';
import { Agent, fetch } from 'undici';
import { publicLookup, publicURL, type PublicImageCandidate } from './public-page';

export const MAX_PUBLIC_IMAGE_BYTES=2_000_000;
export type PublicImageCapture={source_url:string;requested_image_url:string;image_url:string;retrieved_at:string;sha256:string;mime:string;bytes:number;data_url:string;role:PublicImageCandidate['role'];alt:string};
export function verifiedImageMime(bytes:Uint8Array,declared:string):string {
  const mime=declared.split(';')[0].trim().toLowerCase();
  const b=Buffer.from(bytes);
  const actual=b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':
    b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!actual||actual!==mime)throw Error('Unsupported image content');
  return actual;
}
export async function readPublicImage(candidate:PublicImageCandidate):Promise<PublicImageCapture> {
  const source=publicURL(candidate.source_url).href;
  let url=publicURL(candidate.url);
  const requested=url.href;
  const dispatcher=new Agent({connect:{lookup:publicLookup}});
  const signal=AbortSignal.timeout(8000);
  try {
    for(let redirects=0;redirects<=3;redirects++) {
      const response=await fetch(url,{dispatcher,redirect:'manual',signal,headers:{'User-Agent':'EyeOnAds/1.0 public marketing review','Accept':'image/jpeg,image/png,image/webp','Accept-Encoding':'identity'}});
      if([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location=response.headers.get('location');
        if(!location||redirects===3)throw Error('Image redirect limit');
        url=publicURL(new URL(location,url).href);continue;
      }
      const mime=response.headers.get('content-type')||'';
      if(!response.ok||!/^image\/(jpeg|png|webp)(;|$)/i.test(mime)||Number(response.headers.get('content-length'))>MAX_PUBLIC_IMAGE_BYTES) {
        await response.body?.cancel();throw Error('Image unavailable');
      }
      const reader=response.body?.getReader();if(!reader)throw Error('No image content');
      const chunks:Uint8Array[]=[];let bytes=0;
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>MAX_PUBLIC_IMAGE_BYTES){await reader.cancel();throw Error('Image too large');}chunks.push(part.value);}
      const buffer=Buffer.concat(chunks),verifiedMime=verifiedImageMime(buffer,mime);
      return {source_url:source,requested_image_url:requested,image_url:url.href,retrieved_at:new Date().toISOString(),sha256:createHash('sha256').update(buffer).digest('hex'),mime:verifiedMime,bytes,data_url:`data:${verifiedMime};base64,${buffer.toString('base64')}`,role:candidate.role,alt:candidate.alt};
    }
    throw Error('Image unavailable');
  }finally{await dispatcher.destroy();}
}
