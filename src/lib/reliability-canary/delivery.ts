export type BrokerIdentity = { id: string; email: string | null; emailConfirmedAt: string | null; synthetic: boolean };
export type RecipientConfig = { ownerId: string; pilotOverride?: { email: string; authorizedAt: string; authorizedBy: string } | null };
export type RecipientResolution = { status: 'ready'; email: string; source: 'verified_signup' | 'authorized_pilot_override' } | { status: 'blocked'; reason: string };
/** Config must come from service-owned storage, never a request body. */
export function resolveBrokerRecipient(owner: BrokerIdentity, config: RecipientConfig): RecipientResolution {
  if (owner.id !== config.ownerId) return { status: 'blocked', reason: 'Recipient owner mismatch.' };
  const override = config.pilotOverride;
  const valid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/[\r\n]/.test(email);
  if (override) {
    if (override.email.toLowerCase() !== 'theshieldsteam@gmail.com' || !override.authorizedBy.trim() || !Number.isFinite(Date.parse(override.authorizedAt))) return { status: 'blocked', reason: 'Pilot override is not the explicitly authorized destination.' };
    return { status: 'ready', email: override.email.toLowerCase(), source: 'authorized_pilot_override' };
  }
  if (owner.synthetic || !owner.email || !valid(owner.email) || !owner.emailConfirmedAt || !Number.isFinite(Date.parse(owner.emailConfirmedAt))) return { status: 'blocked', reason: 'A verified real broker signup email is required.' };
  return { status: 'ready', email: owner.email, source: 'verified_signup' };
}
export type DeliveryStatus = 'queued' | 'sending' | 'accepted' | 'delivered' | 'failed' | 'uncertain' | 'blocked';
export type DeliveryRecord = { status: DeliveryStatus; attempts: number; providerMessageId?: string; reason?: string; retrySafe: boolean };
export type SendReceipt =
  | { kind: 'accepted'; providerMessageId: string }
  | { kind: 'delivered'; providerMessageId: string; verifiedDeliveryEventId: string }
  | { kind: 'rejected_before_acceptance'; reason: string }
  | { kind: 'unknown'; reason: string };
export function deliveryAfterSend(prior: DeliveryRecord, receipt: SendReceipt): DeliveryRecord {
  if (prior.status !== 'sending') throw new Error('Only a claimed sending delivery can record a send receipt');
  if (receipt.kind === 'accepted' || receipt.kind === 'delivered') {
    if (!receipt.providerMessageId.trim()) throw new Error('Provider message ID required');
    if (receipt.kind === 'delivered' && !receipt.verifiedDeliveryEventId.trim()) throw new Error('Verified delivery event required');
    return { ...prior, status: receipt.kind, providerMessageId: receipt.providerMessageId, retrySafe: false };
  }
  return { ...prior, status: receipt.kind === 'unknown' ? 'uncertain' : 'failed', reason: receipt.reason, retrySafe: receipt.kind === 'rejected_before_acceptance' };
}
export function mayAttemptDelivery(record: DeliveryRecord): boolean {
  return record.attempts < 3 && (record.status === 'queued' || (record.status === 'failed' && record.retrySafe));
}
/** An expired send lease can hide provider acceptance. It must be reconciled, not retried. */
export function expiredSendLease(record: DeliveryRecord): DeliveryRecord {
  if (record.status !== 'sending') return record;
  return { ...record, status: 'uncertain', retrySafe: false, reason: 'Send lease expired; provider acceptance is unknown. Reconcile before any resend.' };
}
