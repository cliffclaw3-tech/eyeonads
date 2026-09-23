// Some compatible gateways return a JSON string despite a successful HTTP
// response. Decode JSON only, then require the normal completion shape.
export function completionText(raw: unknown): string {
  const value = typeof raw === 'string' && raw.length <= 200000 ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object') throw Error('Invalid completion envelope');
  const first = (value as {choices?:{finish_reason?:string;message?:{content?:unknown}}[]}).choices?.[0];
  if (first?.finish_reason !== 'stop' || typeof first.message?.content !== 'string') throw Error('Incomplete completion');
  return first.message.content;
}
export function verifiedIdentitySpan(page: string, span: unknown, expected: string): boolean {
  if (typeof span !== 'string' || !span.trim() || span.length > 500 || !page.includes(span)) return false;
  const normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const actual=` ${normalize(span)} `;
  const words=normalize(expected).split(' ').filter(word=>word.length>1);
  return words.length>0 && words.every(word=>actual.includes(` ${word} `));
}
