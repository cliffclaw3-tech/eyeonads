export function validScanInput(body: unknown): body is { ad_copy: string; state: string; user_id?: string; image_base64?: string } {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.ad_copy === 'string' && b.ad_copy.trim().length > 0 && b.ad_copy.length <= 10000
    && typeof b.state === 'string' && ['TN', 'VA', 'NC'].includes(b.state)
    && (b.user_id === undefined || typeof b.user_id === 'string')
    && (b.image_base64 === undefined || (typeof b.image_base64 === 'string' && b.image_base64.length <= 2000000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.image_base64)));
}
export function validAnalysis(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['green', 'yellow', 'red'].includes(String(v.result)) && typeof v.summary === 'string'
    && Array.isArray(v.flags) && v.flags.length <= 50 && v.flags.every(f => f && typeof f === 'object'
      && ['green', 'yellow', 'red'].includes(f.severity)
      && ['rule', 'explanation', 'recommendation'].every(k => typeof f[k] === 'string'));
}
