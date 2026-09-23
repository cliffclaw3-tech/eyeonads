import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runMonthlyCanary, type CanaryConfig, type Checkpoint, type EngineDependencies, type MonthlyReport, type QueryInputs } from './engine';
import { deliveryAfterSend, resolveBrokerRecipient, type SendReceipt } from './delivery';
import { createCanaryDependencies, mailConfigurationError, sendMonthlyReport } from './adapters';

type ConfigRow = { owner_id: string; public_canary_url?: string; expected_target_id?: string; target_verified_at?: string; required_label?: string; expected_finding_codes?: string[]; next_run_at?: string; enabled?: boolean; pilot_recipient_override?: string; pilot_recipient_authorized_at?: string; pilot_recipient_authorized_by?: string };
type RunRow = { id: string; owner_id: string; period: string; lease_token: string; attempts: number; config_snapshot: ConfigRow; checkpoints?: Record<string, Checkpoint>; report?: MonthlyReport };
export function canaryConfig(row: ConfigRow, owner: string): CanaryConfig {
  if (row.owner_id !== owner) throw Error('Canary owner mismatch');
  return { ownerId: owner, publicCanaryUrl: row.public_canary_url || null, expectedTargetId: row.expected_target_id || null, targetVerifiedAt: row.target_verified_at || null, requiredLabel: row.required_label || 'COMPLIANCE TEST — FICTIONAL', expectedFindingCodes: Array.isArray(row.expected_finding_codes) ? row.expected_finding_codes : [] };
}
export function canaryQuery(setup: { name: string; discovery_location?: string; location?: string; agents?: { id: string; name: string }[]; discovery_agent_ids?: string[] | null }): QueryInputs {
  const location = setup.discovery_location || setup.location || '';
  return { brokerage: setup.name, office: location, agentNames: (setup.agents || []).filter(a => setup.discovery_agent_ids == null || setup.discovery_agent_ids.includes(a.id)).map(a => a.name), state: /tennessee|jonesborough|\bTN\b/i.test(location) ? 'TN' : /virginia|\bVA\b/i.test(location) ? 'VA' : /north carolina|\bNC\b/i.test(location) ? 'NC' : 'unknown' };
}
export function syntheticBroker(email: string | null, metadata: Record<string, unknown> = {}): boolean {
  return metadata.eyeonads_synthetic === true || !!email && /(^les\.review\.|^eyeonads-(qa|novice|canary)[.+_-]|@(example\.(com|org|net)|[^@]*\.invalid)$)/i.test(email);
}
type WorkerDependencies = { engine?: typeof runMonthlyCanary; providers?: EngineDependencies; send?: (recipient: string, report: MonthlyReport, nextDue: string | null) => Promise<SendReceipt>; emailConfigurationError?: () => string | null };
export async function processReliabilityRun(db: SupabaseClient, item: RunRow, deps: WorkerDependencies = {}) {
  try {
    const [owner, setup] = await Promise.all([db.auth.admin.getUserById(item.owner_id), db.from('eyeonads_brokerage_setups').select('name,location,discovery_location,agents,discovery_agent_ids').eq('owner_id', item.owner_id).maybeSingle()]);
    if (owner.error || !owner.data.user?.app_metadata?.eyeonads_pilot || setup.error || !setup.data?.name) throw Error('Pilot or saved brokerage unavailable');
    const checkpoints = { ...(item.checkpoints || {}) };
    const providers = deps.providers || createCanaryDependencies();
    const report = await (deps.engine || runMonthlyCanary)({ config: canaryConfig(item.config_snapshot, item.owner_id), period: item.period, queryInputs: canaryQuery(setup.data), now: new Date().toISOString() }, {
      ...providers,
      readCheckpoint: async key => checkpoints[key] || null,
      writeCheckpoint: async (key, checkpoint) => {
        const result = await db.rpc('eyeonads_checkpoint_reliability', { p_run: item.id, p_token: item.lease_token, p_key: key, p_checkpoint: checkpoint });
        if (result.error || result.data !== true) throw Error('Checkpoint lease expired');
        checkpoints[key] = checkpoint;
      },
    });
    // Retry operational failures within the SQL budget, preserving successful checkpoints.
    if (report.outcome === 'error' && item.attempts < 3) throw Error('A calibration stage had an operational error');
    const finished = await db.rpc('eyeonads_finish_reliability', { p_run: item.id, p_token: item.lease_token, p_report: report });
    if (finished.error || finished.data !== true) throw Error('Report lease expired');
    return { completed: true, runId: item.id };
  } catch {
    const failed = await db.rpc('eyeonads_fail_reliability', { p_run: item.id, p_token: item.lease_token, p_error: 'Monthly reliability check could not finish. Saved checkpoints are retained; retry is bounded to three attempts.' });
    if (failed.error) throw Error('Reliability failure could not be saved');
    return { completed: false, runId: item.id };
  }
}
async function markBlocked(db: SupabaseClient, runId: string, ownerId: string, error: string) {
  const result = await db.from('eyeonads_reliability_deliveries').update({ status: 'blocked', error, retry_safe: false, available_at: new Date(Date.now()+5*60_000).toISOString(), updated_at: new Date().toISOString() }).eq('run_id', runId).eq('owner_id', ownerId).in('status', ['queued', 'failed', 'blocked']);
  if (result.error) throw Error('Delivery block could not be saved');
}
export async function processReliabilityDelivery(db: SupabaseClient, deps: WorkerDependencies = {}) {
  // A worker that crashed during send may have reached the provider. Never re-send blindly.
  const expired = await db.from('eyeonads_reliability_deliveries').update({ status: 'uncertain', retry_safe: false, error: 'Send lease expired; provider acceptance is unknown. Reconcile before resending.', lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('status', 'sending').lte('lease_expires_at', new Date().toISOString());
  if (expired.error) throw Error('Delivery recovery unavailable');
  const pending = await db.from('eyeonads_reliability_deliveries').select('run_id,owner_id,status,attempts,retry_safe').or('status.eq.queued,and(status.eq.failed,retry_safe.eq.true),and(status.eq.blocked,attempts.eq.0)').lt('attempts', 3).lte('available_at', new Date().toISOString()).order('available_at').limit(10);
  if (pending.error) throw Error('Delivery queue unavailable');
  let blocked=false;
  for(const item of pending.data||[]){
  if(!(item.status==='queued'||item.status==='failed'&&item.retry_safe||item.status==='blocked'&&item.attempts===0))continue;
  const [ownerResult, configResult, runResult] = await Promise.all([
    db.auth.admin.getUserById(item.owner_id),
    db.from('eyeonads_reliability_configs').select('*').eq('owner_id', item.owner_id).maybeSingle(),
    db.from('eyeonads_reliability_runs').select('report,status,owner_id').eq('id', item.run_id).eq('owner_id', item.owner_id).maybeSingle(),
  ]);
  if (ownerResult.error || configResult.error || runResult.error) throw Error('Delivery context unavailable');
  const user = ownerResult.data.user, config = configResult.data as ConfigRow | null, report = runResult.data?.report as MonthlyReport | null;
  if (!user?.app_metadata?.eyeonads_pilot || runResult.data?.status !== 'complete' || !report || report.ownerId !== item.owner_id) { await markBlocked(db, item.run_id, item.owner_id, 'A completed report for an invited owner is required.'); blocked=true;continue; }
  const recipient = resolveBrokerRecipient({ id: user.id, email: user.email || null, emailConfirmedAt: user.email_confirmed_at || null, synthetic: syntheticBroker(user.email || null, user.app_metadata) }, { ownerId: item.owner_id, pilotOverride: config?.pilot_recipient_override ? { email: config.pilot_recipient_override, authorizedAt: config.pilot_recipient_authorized_at || '', authorizedBy: config.pilot_recipient_authorized_by || '' } : null });
  const configurationError = (deps.emailConfigurationError || mailConfigurationError)();
  if (recipient.status === 'blocked' || configurationError) { await markBlocked(db, item.run_id, item.owner_id, recipient.status === 'blocked' ? recipient.reason : configurationError!); blocked=true;continue; }
  if(item.status==='blocked'){
    // Only a proven pre-send block may re-enter the outbox. CAS prevents racing
    // workers from reviving a sending/accepted/uncertain or previously sent row.
    const requeued=await db.from('eyeonads_reliability_deliveries').update({status:'queued',error:null,retry_safe:false,updated_at:new Date().toISOString()}).eq('run_id',item.run_id).eq('owner_id',item.owner_id).eq('status','blocked').eq('attempts',0);
    if(requeued.error)throw Error('Pre-send delivery recovery unavailable');
  }
  const claim = await db.rpc('eyeonads_claim_reliability_delivery', { p_run: item.run_id, p_recipient: recipient.email, p_source: recipient.source });
  if (claim.error) throw Error('Delivery could not be claimed');
  const lease = claim.data?.[0];
  if (!lease) return { delivery: 'already_claimed' };
  let receipt: SendReceipt;
  try { receipt = await (deps.send || sendMonthlyReport)(recipient.email, report, config?.enabled ? config.next_run_at || null : null); }
  catch { receipt = { kind: 'unknown', reason: 'Provider acceptance is unknown; reconcile before resending.' }; }
  const state = deliveryAfterSend({ status: 'sending', attempts: lease.attempts, retrySafe: false }, receipt);
  const saved = await db.rpc('eyeonads_record_reliability_delivery', { p_run: item.run_id, p_token: lease.lease_token, p_status: state.status, p_message_id: state.providerMessageId || null, p_event_id: receipt.kind === 'delivered' ? receipt.verifiedDeliveryEventId : null, p_error: state.reason || null, p_retry_safe: state.retrySafe });
  if (saved.error || saved.data !== true) throw Error('Delivery receipt could not be saved; acceptance must be reconciled');
  return { delivery: state.status };
  }
  return {delivery:blocked?'blocked':'idle'};
}
export async function runReliabilityWorker(db: SupabaseClient, deps: WorkerDependencies = {}) {
  const due = await db.rpc('eyeonads_enqueue_due_reliability');
  if (due.error) throw Error('Monthly schedule unavailable');
  const claim = await db.rpc('eyeonads_claim_reliability');
  if (claim.error) throw Error('Monthly queue unavailable');
  const item = claim.data?.[0] as RunRow | undefined;
  const processed = item ? await processReliabilityRun(db, item, deps) : { completed: false, runId: null };
  return { ...processed, ...await processReliabilityDelivery(db, deps), idle: !item };
}
