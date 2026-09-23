/** Metadata only. Callers supply stable IDs; this module never guesses URL equivalence. */
export type DiscoveryObservation = { id: string; url: string; title: string; content_hash?: string | null };
export type DiscoveryInventoryItem = DiscoveryObservation & {
  /** Last actual observation. Re-selection or failed retrieval does not advance this. */
  last_seen_at: string;
  /** Last successful assessment, never merely a search or attempted assessment. */
  last_assessed_at: string | null;
  /** Actual retrieval/assessment attempt, distinct from successful assessment. */
  last_attempted_at?: string | null;
  /** Hash of the content successfully assessed, if a hash was available. */
  assessed_content_hash: string | null;
  /** Persists a detected change across deferred batches until successful assessment. */
  content_changed_since_assessment: boolean;
};
export type RotationCandidate = DiscoveryInventoryItem & {
  observed_this_run: boolean;
  priority: 'never_assessed' | 'changed_content' | 'oldest_assessment';
};
export type DiscoveryRotation = {
  inventory: DiscoveryInventoryItem[];
  selected: RotationCandidate[];
  deferred: RotationCandidate[];
  /** Known metadata omitted only because inventoryLimit was exceeded, never silently. */
  evicted: DiscoveryInventoryItem[];
  counts: { observed: number; retained: number; eligible: number; selected: number; deferred: number; ineligible: number; evicted: number; previously_assessed: number; never_assessed: number; changed_content: number };
};
function validTime(value: string, label: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`Invalid ${label}`);
  return time;
}
function text(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}
function hash(value: string | null | undefined): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function observation(item: DiscoveryObservation): DiscoveryObservation {
  // Never spread source input: image bytes and arbitrary provider fields must not persist.
  return { id: text(item.id, 'source id'), url: text(item.url, 'source URL'), title: typeof item.title === 'string' ? item.title : '', ...(hash(item.content_hash) ? { content_hash: hash(item.content_hash)! } : {}) };
}
function snapshot(item: DiscoveryInventoryItem): DiscoveryInventoryItem {
  validTime(item.last_seen_at, 'last_seen_at');
  if (item.last_assessed_at) validTime(item.last_assessed_at, 'last_assessed_at');
  if (item.last_attempted_at) validTime(item.last_attempted_at, 'last_attempted_at');
  return { ...observation(item), last_seen_at: item.last_seen_at, last_assessed_at: item.last_assessed_at || null, last_attempted_at: item.last_attempted_at || null, assessed_content_hash: hash(item.assessed_content_hash), content_changed_since_assessment: !!item.last_assessed_at && !!item.content_changed_since_assessment };
}
function lexical(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function key(item: DiscoveryObservation): string { return JSON.stringify([item.url, item.title, item.content_hash || '']); }
function priority(item: DiscoveryInventoryItem): RotationCandidate['priority'] {
  return !item.last_assessed_at ? 'never_assessed' : item.content_changed_since_assessment ? 'changed_content' : 'oldest_assessment';
}
function compare(a: DiscoveryInventoryItem, b: DiscoveryInventoryItem): number {
  const ranks = { never_assessed: 0, changed_content: 1, oldest_assessment: 2 };
  const rotationTime = (item: DiscoveryInventoryItem) => priority(item) === 'oldest_assessment' ? Date.parse(item.last_assessed_at!) : item.last_attempted_at ? Date.parse(item.last_attempted_at) : 0;
  return ranks[priority(a)] - ranks[priority(b)] || rotationTime(a) - rotationTime(b) || lexical(a.id, b.id);
}

/**
 * Preserve known sources within the explicit inventory bound and rotate a bounded batch.
 * `observed` means actually seen now; historical inventory is retained without refreshing
 * its last_seen_at. Default selection includes all known sources. For a source that can
 * only assess currently rendered cards, supply their IDs in eligibleIds instead.
 *
 * Never-assessed sources rank first, then detected content changes, then oldest successful
 * assessment. Within never-assessed/changed groups, the oldest actual attempt rotates blocked sources; stable caller IDs break remaining ties. Current observations win metadata conflicts;
 * duplicate observations with the same ID choose the lexical URL/title/hash tuple, making
 * results independent of input order. Different IDs are never merged, even with equal URLs.
 *
 * When capacity is exceeded, keep highest-priority eligible candidates first, then other
 * current observations, then most recently observed history. Every eviction is returned.
 * Selection itself never marks an assessment successful. Use the explicit helper below
 * only after actual assessment of the selected evidence.
 */
export function rotateDiscoverySources(args: {
  observed: DiscoveryObservation[];
  previous: DiscoveryInventoryItem[];
  now: string;
  batchLimit: number;
  inventoryLimit: number;
  eligibleIds?: Iterable<string>;
}): DiscoveryRotation {
  const now = validTime(args.now, 'observation timestamp');
  if (!Number.isInteger(args.batchLimit) || args.batchLimit < 0 || !Number.isInteger(args.inventoryLimit) || args.inventoryLimit < 1 || args.batchLimit > args.inventoryLimit) throw new Error('Limits must be integers with 0 <= batchLimit <= inventoryLimit and inventoryLimit >= 1');
  const known = new Map<string, DiscoveryInventoryItem>();
  for (const raw of args.previous) {
    const item = snapshot(raw), prior = known.get(item.id);
    if (Date.parse(item.last_seen_at) > now || (item.last_assessed_at && Date.parse(item.last_assessed_at) > now)) throw new Error('Inventory timestamps cannot be newer than this observation');
    if (!prior) { known.set(item.id, item); continue; }
    // Preserve the newest observation and newest assessment independently when deduping.
    const latest = Date.parse(item.last_seen_at) > Date.parse(prior.last_seen_at) || (Date.parse(item.last_seen_at) === Date.parse(prior.last_seen_at) && lexical(key(item), key(prior)) < 0) ? item : prior;
    const assessed = ((item.last_assessed_at ? Date.parse(item.last_assessed_at) : 0) - (prior.last_assessed_at ? Date.parse(prior.last_assessed_at) : 0) || -lexical(JSON.stringify([item.assessed_content_hash, key(item)]), JSON.stringify([prior.assessed_content_hash, key(prior)]))) > 0 ? item : prior;
    known.set(item.id, { ...latest, last_assessed_at: assessed.last_assessed_at, assessed_content_hash: assessed.assessed_content_hash, content_changed_since_assessment: !!assessed.last_assessed_at && (hash(latest.content_hash) && assessed.assessed_content_hash ? hash(latest.content_hash) !== assessed.assessed_content_hash : latest.content_changed_since_assessment) });
  }
  const seen = new Map<string, DiscoveryObservation>();
  for (const raw of args.observed) {
    const item = observation(raw), prior = seen.get(item.id);
    if (!prior || lexical(key(item), key(prior)) < 0) seen.set(item.id, item);
  }
  for (const item of seen.values()) {
    const prior = known.get(item.id);
    const observedHash = hash(item.content_hash), priorHash = hash(prior?.content_hash);
    const latestHash = observedHash || priorHash;
    const changed = !!prior?.last_assessed_at && (observedHash && prior.assessed_content_hash ? observedHash !== prior.assessed_content_hash : !!prior.content_changed_since_assessment || !!(observedHash && priorHash && observedHash !== priorHash));
    known.set(item.id, { ...item, ...(latestHash ? { content_hash: latestHash } : {}), last_seen_at: args.now, last_assessed_at: prior?.last_assessed_at || null, last_attempted_at: prior?.last_attempted_at || null, assessed_content_hash: prior?.assessed_content_hash || null, content_changed_since_assessment: changed });
  }
  const eligible = args.eligibleIds === undefined ? null : new Set(args.eligibleIds);
  const isEligible = (item: DiscoveryInventoryItem) => !eligible || eligible.has(item.id);
  const all = [...known.values()];
  // Preserve the priority queue under a tight cap, while exposing every dropped item.
  const retained = all.sort((a, b) => Number(isEligible(b)) - Number(isEligible(a)) || (isEligible(a) ? compare(a, b) : Number(seen.has(b.id)) - Number(seen.has(a.id)) || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at) || lexical(a.id, b.id)));
  const inventory = retained.slice(0, args.inventoryLimit).sort((a, b) => lexical(a.id, b.id));
  const evicted = retained.slice(args.inventoryLimit).sort((a, b) => lexical(a.id, b.id));
  const candidates = inventory.filter(isEligible).sort(compare).map(item => ({ ...item, observed_this_run: seen.has(item.id), priority: priority(item) }));
  const selected = candidates.slice(0, args.batchLimit), deferred = candidates.slice(args.batchLimit);
  return { inventory, selected, deferred, evicted, counts: { observed: seen.size, retained: inventory.length, eligible: candidates.length, selected: selected.length, deferred: deferred.length, ineligible: inventory.length - candidates.length, evicted: evicted.length, previously_assessed: inventory.filter(item => item.last_assessed_at).length, never_assessed: inventory.filter(item => !item.last_assessed_at).length, changed_content: inventory.filter(item => item.content_changed_since_assessment).length } };
}

/**
 * Record only successful assessments of these inventory items' observed content.
 * Failed or attempted items must not be supplied. This never updates last_seen_at.
 * If retrieval yielded newer content, first merge that actual observation (and hash)
 * through rotateDiscoverySources, then mark the successfully assessed IDs.
 */
export function markDiscoverySourcesAssessed(inventory: DiscoveryInventoryItem[], successfulIds: Iterable<string>, assessedAt: string): DiscoveryInventoryItem[] {
  const assessed = validTime(assessedAt, 'assessment timestamp');
  const successes = new Set(successfulIds), knownIds = new Set(inventory.map(item => item.id));
  for (const id of successes) if (!knownIds.has(id)) throw new Error(`Cannot mark unknown source assessed: ${id}`);
  return inventory.map(raw => {
    const item = snapshot(raw);
    if (!successes.has(item.id)) return item;
    if (assessed < Date.parse(item.last_seen_at) || (item.last_assessed_at && assessed < Date.parse(item.last_assessed_at))) throw new Error('Assessment cannot precede its observed content or previous assessment');
    return { ...item, last_assessed_at: assessedAt, last_attempted_at: assessedAt, assessed_content_hash: hash(item.content_hash), content_changed_since_assessment: false };
  });
}

/** Record an actual attempt, including blocked retrieval, without claiming assessment. */
export function markDiscoverySourcesAttempted(inventory: DiscoveryInventoryItem[], attemptedIds: Iterable<string>, attemptedAt: string): DiscoveryInventoryItem[] {
  const time = validTime(attemptedAt, 'attempt timestamp'), ids = new Set(attemptedIds);
  for (const id of ids) if (!inventory.some(item => item.id === id)) throw new Error(`Cannot mark unknown source attempted: ${id}`);
  return inventory.map(raw => {
    const item = snapshot(raw);
    if (!ids.has(item.id)) return item;
    if (time < Date.parse(item.last_seen_at) || (item.last_attempted_at && time < Date.parse(item.last_attempted_at))) throw new Error('Attempt cannot precede its observed source or previous attempt');
    return { ...item, last_attempted_at: attemptedAt };
  });
}
