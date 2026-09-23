import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { sameOrigin } from '@/lib/discovery-jobs';
import { publicPostIdentity } from '@/lib/reliability-canary/engine';
import { createCanaryDependencies } from '@/lib/reliability-canary/adapters';

export const runtime = 'nodejs';
export const maxDuration = 30;
const LABEL = 'COMPLIANCE TEST — FICTIONAL';
const headers = { 'Cache-Control': 'no-store' };
function response(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers }); }
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function session() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { response: response({ error: 'Sign in to set up your public test.' }, 401) };
  if (!user.app_metadata?.eyeonads_pilot) return { response: response({ error: 'Public test setup is available to invited brokerage pilots.' }, 403) };
  const setup = await db.from('eyeonads_brokerage_setups').select('name,location,discovery_location').eq('owner_id', user.id).maybeSingle();
  if (setup.error) return { response: response({ error: 'Your saved brokerage could not be loaded. Retry shortly.' }, 503) };
  if (!setup.data?.name?.trim()) return { response: response({ error: 'Save your brokerage name and office first, then return to public test setup.', setup_required: true }, 400) };
  return { db, user, setup: { name: setup.data.name.trim(), office: (setup.data.discovery_location || setup.data.location || '').trim() } };
}
function template(name: string, office: string) {
  return `${LABEL}\nEyeOnAds public discovery test for ${name}${office ? ` — ${office}` : ''}.\n\nThis is a fictional software test, not a property advertisement, listing, rental, or offer. No property is available through this post. This labeled post checks whether public monitoring can find a test published by our office.`;
}
export async function GET() {
  try {
    const auth = await session(); if (auth.response) return auth.response;
    const config = await auth.db.from('eyeonads_reliability_configs').select('public_canary_url,target_verified_at,expected_target_id').eq('owner_id', auth.user.id).maybeSingle();
    if (config.error) return response({ error: 'Saved public test status could not be loaded. Retry shortly.' }, 503);
    return response({ brokerage: auth.setup.name, office: auth.setup.office, copy_template: template(auth.setup.name, auth.setup.office), required_label: LABEL, configured: !!config.data?.public_canary_url && !!config.data?.target_verified_at && !!config.data?.expected_target_id, public_url: config.data?.public_canary_url || null, verified_at: config.data?.target_verified_at || null, ownership: 'Account control is attested by you; public publisher metadata does not prove account ownership.', applies_to: 'Future checks. Saved monthly reports and emails are unchanged.' });
  } catch { return response({ error: 'Public test setup is temporarily unavailable. Retry shortly.' }, 503); }
}
export async function POST(request: Request) {
  if (!request.headers.get('origin') || !sameOrigin(request)) return response({ error: 'Open public test setup in EyeOnAds and retry from this page.', saved: false }, 403);
  try {
    const auth = await session(); if (auth.response) return auth.response;
    if (Number(request.headers.get('content-length') || 0) > 5000) return response({ error: 'Paste only the public Facebook post link and confirm authorization.', saved: false }, 400);
    let raw: unknown; try { raw = await request.json(); } catch { return response({ error: 'Enter a public Facebook post link and confirm authorization.', saved: false }, 400); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return response({ error: 'Enter a public Facebook post link and confirm authorization.', saved: false }, 400);
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some(key => !['url', 'authorized'].includes(key)) || typeof body.url !== 'string' || body.url.length > 3000 || body.authorized !== true) return response({ error: 'Confirm that you control this Facebook profile or Page and are authorized to publish its public test. Submit only its post link.', saved: false }, 400);
    const url = body.url.trim(), postId = publicPostIdentity(url);
    if (!postId || postId.startsWith('facebook:ad:')) return response({ error: 'Use the direct link to your unpaid public Facebook post, not a profile, ad-library link, shortened link, or other website. Open the post and copy its permalink.', saved: false }, 400);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response({ error: 'Saving public test setup is temporarily unavailable. Your saved configuration is unchanged; retry shortly.', saved: false }, 503);
    const startedAt = Date.now();
    const captured = await createCanaryDependencies().retrieve(url, { signal: AbortSignal.timeout(20000) });
    if (captured.status !== 'retrieved' || !captured.public) return response({ saved: false, state: 'unavailable', error: 'Not saved: EyeOnAds could not read this post publicly. Set its audience to Public, check it while signed out of Facebook, and retry with the direct post link. If Facebook still blocks access, this test cannot be verified yet.', next_action: 'Check public visibility and the direct post link, then retry. Existing setup is unchanged.' }, 422);
    // The adapter only emits targetId after validating the final fetched Facebook
    // URL, same-post canonical URL and exactly one observed publisher identity.
    if (captured.postBound !== true || publicPostIdentity(captured.canonicalUrl || '') !== postId || !captured.targetId || !/^facebook:publisher:[a-z0-9.]+$/i.test(captured.targetId)) return response({ saved: false, state: 'identity_unverified', error: 'Not saved: the exact post and a single publisher could not be verified from the public page. Open your original post and copy its direct permalink, confirm Public visibility, then retry. Account ownership is not inferred from a link.' }, 422);
    const captureTime = Date.parse(captured.capturedAt || '');
    if (!/^[a-f0-9]{64}$/i.test(captured.contentHash || '') || !Number.isFinite(captureTime) || captureTime < startedAt - 60000 || captureTime > Date.now() + 300000) return response({ saved: false, state: 'capture_unverified', error: 'Not saved: a fresh public capture could not be confirmed. Retry shortly; your existing setup is unchanged.' }, 422);
    const text = captured.text || '', labelAt = text.indexOf(LABEL);
    if (labelAt < 0) return response({ saved: false, state: 'label_missing', error: `Not saved: the public post must contain the exact label “${LABEL}”. Copy the provided test wording into your post, make it Public, then retry.` }, 422);
    const localText = ` ${normalize(text.slice(labelAt, labelAt + 1400))} `;
    if (!localText.includes(` ${normalize(auth.setup.name)} `) || auth.setup.office && !localText.includes(` ${normalize(auth.setup.office)} `)) return response({ saved: false, state: 'brokerage_mismatch', error: 'Not saved: the labeled post does not match your saved brokerage and office. Use the supplied wording for this brokerage, verify the correct post link, and retry.' }, 422);
    const verifiedAt = new Date().toISOString();
    const target = { public_canary_url: captured.canonicalUrl!, expected_target_id: captured.targetId, target_verified_at: verifiedAt, required_label: LABEL, expected_finding_codes: [], updated_at: verifiedAt };
    const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    // Update only target fields. Never upsert defaults over an existing monthly
    // schedule or server-authorized recipient override.
    let saved = await service.from('eyeonads_reliability_configs').update(target).eq('owner_id', auth.user.id).select('public_canary_url,target_verified_at').maybeSingle();
    if (saved.error) return response({ saved: false, error: 'Verification completed but saving was not confirmed. Refresh saved setup before retrying.' }, 503);
    if (!saved.data) {
      const inserted = await service.from('eyeonads_reliability_configs').insert({ owner_id: auth.user.id, ...target }).select('public_canary_url,target_verified_at').single();
      if (inserted.error?.code === '23505') saved = await service.from('eyeonads_reliability_configs').update(target).eq('owner_id', auth.user.id).select('public_canary_url,target_verified_at').maybeSingle();
      else saved = inserted;
    }
    if (saved.error || !saved.data) return response({ saved: false, error: 'Verification completed but saving was not confirmed. Refresh saved setup before retrying.' }, 503);
    return response({ saved: true, state: 'verified_public_source', public_url: saved.data.public_canary_url, verified_at: saved.data.target_verified_at, publisher_identity: captured.targetId, message: 'Public post and publisher metadata verified and saved for future checks. Your authorization is attested by you; this does not prove Facebook account ownership. Saved monthly reports, report emails, schedules, and recipients are unchanged.' });
  } catch { return response({ saved: false, error: 'Verification did not finish. Your existing setup is unchanged unless a save was already confirmed. Refresh saved setup, check public visibility, then retry.' }, 503); }
}
