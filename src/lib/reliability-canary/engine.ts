import { createHash } from 'node:crypto';

export type StageStatus = 'pass' | 'fail' | 'blocked' | 'error';
export type Stage = { status: StageStatus; reason: string; evidence?: Record<string, unknown> };
export type QueryInputs = { brokerage: string; office: string; agentNames: string[]; state: string };
export type CanaryConfig = {
  ownerId: string;
  publicCanaryUrl: string | null;
  expectedTargetId: string | null;
  targetVerifiedAt: string | null;
  /** Exact conspicuous label required on the public post, e.g. COMPLIANCE TEST — FICTIONAL. */
  requiredLabel: string;
  expectedFindingCodes: string[];
};
export type DiscoveryResult = { urls: string[]; notes: string[]; complete: boolean };
export type RetrievedCanary = {
  status: 'retrieved' | 'blocked' | 'not_found' | 'unpublished' | 'error';
  canonicalUrl?: string;
  targetId?: string;
  postBound?: boolean;
  public: boolean;
  text?: string;
  capturedAt?: string;
  contentHash?: string;
  imageEvidence?: string[];
  reason: string;
};
export type AssessmentInput = { text: string; state: string; imageEvidence: string[] };
export type AssessmentResult = { findingCodes: string[]; summary: string; complete: boolean };
export type Checkpoint = { fingerprint: string; value: unknown };
export type EngineDependencies = {
  discover: (input: QueryInputs, options?: { signal: AbortSignal }) => Promise<DiscoveryResult>;
  retrieve: (url: string, options?: { signal: AbortSignal }) => Promise<RetrievedCanary>;
  assess: (input: AssessmentInput, options?: { signal: AbortSignal }) => Promise<AssessmentResult>;
  /** Scope storage to the leased run; callback must reject writes after lease expiry. */
  readCheckpoint?: (key: string) => Promise<Checkpoint | null>;
  writeCheckpoint?: (key: string, checkpoint: Checkpoint) => Promise<void>;
};
export type MonthlyReport = {
  version: 1; ownerId: string; period: string; completedAt: string;
  outcome: StageStatus; discovery: Stage; retrieval: Stage; assessment: Stage;
  controls: { id: string; kind: 'known_defect' | 'clean'; text?: string; stage: Stage }[];
  canaryAssessment: Stage;
  metrics: {
    configuredTargets: number; verifiedPublicTargets: number; knownPublicTargets: number; targetsFoundBlind: number; recall: number | null;
    controlsRun: number; controlsPassed: number; discoveryCandidates: number;
  };
  limitations: string[];
};

type Control = { id: string; kind: 'known_defect' | 'clean'; text: string; expected: string[] };
const examples = [
  ['Harbor', '100 Fictional Lane', 'Families with children are not allowed to rent this home.'],
  ['Meadow', '200 Imaginary Drive', 'Only applicants of the preferred race may apply for this rental.'],
  ['Cedar', '300 Example Court', 'Applicants with disabilities will not be considered for this rental.'],
];
export function monthlyControls(period: string): Control[] {
  const index = monthIndex(period) % examples.length;
  const [name, address, defect] = examples[index];
  const base = `COMPLIANCE TEST — FICTIONAL. This is a synthetic calibration example, not an actual property or offer. ${name} Example Realty, a fictional licensed Tennessee real estate firm. Firm phone: 202-555-0100. Fictional agent: Alex Example, 202-555-0101. Fictional property: ${address}, Example Town, Tennessee. Two bedrooms, one bathroom. Rent $1,500 per month. Equal Housing Opportunity. `;
  return [
    { id: `defect-v1-${index}`, kind: 'known_defect', text: base + defect, expected: ['housing_discrimination'] },
    { id: `clean-v1-${index}`, kind: 'clean', text: base + 'All applicants are welcome. Contact the firm for property details and application criteria.', expected: [] },
  ];
}
function monthIndex(period: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('A YYYY-MM UTC period is required');
  return Number(period.slice(0, 4)) * 12 + Number(period.slice(5)) - 1;
}
/** Stable identity comparison: ignore tracking parameters, but retain Facebook's object ID. */
export function publicPostIdentity(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^(www|m|mbasic)\./, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.port || host !== 'facebook.com') return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const story = u.searchParams.get('story_fbid');
    if (story) return `facebook:post:${story}`;
    const post = path.match(/\/(?:posts|videos)\/([^/]+)$/)?.[1];
    if (post) return `facebook:post:${post}`;
    const libraryId = path === '/ads/library' ? u.searchParams.get('id') : null;
    if (libraryId) return `facebook:ad:${libraryId}`;
    const photo = path === '/photo.php' || path === '/photo' ? u.searchParams.get('fbid') : null;
    if (photo) return `facebook:photo:${photo}`;
    return null; // Profiles, search URLs and share redirects are not verified post identities.
  } catch { return null; }
}
function fingerprint(input: unknown): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
function stage(status: StageStatus, reason: string, evidence?: Record<string, unknown>): Stage { return { status, reason, ...(evidence ? { evidence } : {}) }; }
function aggregate(stages: Stage[]): StageStatus {
  return stages.some(s => s.status === 'error') ? 'error' : stages.some(s => s.status === 'fail') ? 'fail' : stages.some(s => s.status === 'blocked') ? 'blocked' : 'pass';
}
function exactFindings(actual: AssessmentResult, expected: string[]): Stage {
  if (!actual || !Array.isArray(actual.findingCodes) || actual.findingCodes.some(code => typeof code !== 'string') || typeof actual.complete !== 'boolean') throw new Error('Malformed assessment result');
  if (!actual.complete) return stage('error', 'Assessment did not finish; no calibration pass.', { assessment: actual });
  const got = [...new Set(actual.findingCodes)].sort();
  const wanted = [...new Set(expected)].sort();
  const missing = wanted.filter(v => !got.includes(v));
  const unexpected = got.filter(v => !wanted.includes(v));
  return stage(missing.length || unexpected.length ? 'fail' : 'pass', missing.length || unexpected.length ? 'Expected findings and observed findings differ.' : 'Expected findings matched; this is a calibration result, not legal approval.', { expected: wanted, observed: got, missing, unexpected, summary: actual.summary });
}

export async function runMonthlyCanary(args: { config: CanaryConfig; period: string; queryInputs: QueryInputs; now: string }, deps: EngineDependencies): Promise<MonthlyReport> {
  monthIndex(args.period);
  if (!args.config.ownerId || !Number.isFinite(Date.parse(args.now))) throw new Error('Owner and valid timestamp required');
  const { config, period, queryInputs } = args;
  async function bounded<T>(milliseconds: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Stage deadline exceeded')); }, milliseconds); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function cached<T>(key: string, input: unknown, task: () => Promise<T>, cacheable: (value: T) => boolean = () => true): Promise<T> {
    const hash = fingerprint({ version: 1, ownerId: config.ownerId, period, input });
    const saved = await deps.readCheckpoint?.(key);
    if (saved?.fingerprint === hash && cacheable(saved.value as T)) return saved.value as T;
    const value = await task();
    if (cacheable(value)) await deps.writeCheckpoint?.(key, { fingerprint: hash, value });
    return value;
  }
  // Construct explicitly: spreading config here would leak the answer to discovery.
  const discoveryInput: QueryInputs = { brokerage: queryInputs.brokerage, office: queryInputs.office, agentNames: [...queryInputs.agentNames], state: queryInputs.state };
  let found: DiscoveryResult | undefined;
  let discovery = stage('blocked', 'Public test is not configured and verified.');
  let retrieval = stage('blocked', 'Public test is not configured and verified.');
  let canaryAssessment = stage('blocked', 'No verified public test content was available for assessment.');
  let verifiedPublic = false;
  const targetIdentity = config.publicCanaryUrl ? publicPostIdentity(config.publicCanaryUrl) : null;
  const configured = targetIdentity && config.expectedTargetId && config.targetVerifiedAt && Number.isFinite(Date.parse(config.targetVerifiedAt)) && Date.parse(config.targetVerifiedAt) <= Date.parse(args.now) && config.requiredLabel.trim().length >= 12;
  if (configured) {
    try {
      found = await cached('blind-discovery', discoveryInput, () => bounded(30_000, signal => deps.discover(discoveryInput, { signal })), value => value?.complete === true);
      if (!found || !Array.isArray(found.urls) || found.urls.some(url => typeof url !== 'string') || typeof found.complete !== 'boolean') throw new Error('Malformed discovery result');
      discovery = stage(!found.complete ? 'error' : found.urls.some(url => publicPostIdentity(url) === targetIdentity) ? 'pass' : 'fail', 'Blind discovery checked for the known public test independently of its saved URL.', { candidateUrls: found.urls, notes: found.notes, searchComplete: found.complete });
    } catch { found = undefined; discovery = stage('error', 'Blind discovery failed; no pass inferred.'); }
    try {
      // This deliberate direct retrieval is diagnostic. It never counts as discovery.
      const captured = await cached('canary-retrieval', { url: config.publicCanaryUrl, target: config.expectedTargetId, label: config.requiredLabel }, () => bounded(20_000, signal => deps.retrieve(config.publicCanaryUrl!, { signal })), value => value?.status === 'retrieved');
      verifiedPublic = captured.status === 'retrieved' && captured.public && captured.postBound === true && captured.targetId === config.expectedTargetId && publicPostIdentity(captured.canonicalUrl || '') === targetIdentity && !!captured.text?.includes(config.requiredLabel) && !!captured.contentHash && !!captured.capturedAt && Number.isFinite(Date.parse(captured.capturedAt)) && Date.parse(captured.capturedAt) >= Date.parse(`${period}-01T00:00:00Z`) && Date.parse(captured.capturedAt) <= Date.parse(args.now) + 300_000;
      retrieval = stage(verifiedPublic ? 'pass' : captured.status === 'error' ? 'error' : 'blocked', verifiedPublic ? 'The labeled public test was retrieved from the verified target.' : 'Test unavailable, unpublished, unlabeled, or identity/evidence verification failed; no pass.', { ...captured });
      if (verifiedPublic) {
        const input = { text: captured.text!, state: queryInputs.state, imageEvidence: captured.imageEvidence || [] };
        try { canaryAssessment = exactFindings(await cached('canary-assessment', { input, expected: config.expectedFindingCodes }, () => bounded(22_000, signal => deps.assess(input, { signal })), value => value?.complete === true), config.expectedFindingCodes); }
        catch { canaryAssessment = stage('error', 'Public test assessment failed.'); }
      } else if (discovery.status === 'pass') {
        discovery = stage('blocked', 'A URL was found, but a currently available labeled public test could not be verified.', discovery.evidence);
      }
    } catch { retrieval = stage('error', 'Public test retrieval failed.'); if (discovery.status === 'pass') discovery = stage('blocked', 'A URL was found but public test availability could not be verified.', discovery.evidence); }
  }
  const controls: MonthlyReport['controls'] = await Promise.all(monthlyControls(period).map(async control => {
    let result: Stage;
    // Expected results and clean/defect metadata are deliberately omitted from assessment inputs.
    const input = { text: control.text, state: 'TN', imageEvidence: [] };
    try { result = exactFindings(await cached(`control-${control.id}`, input, () => bounded(22_000, signal => deps.assess(input, { signal })), value => value?.complete === true), control.expected); }
    catch { result = stage('error', 'Calibration control assessment failed.'); }
    return { id: control.id, kind: control.kind, text: control.text, stage: result };
  }));
  const assessment = stage(aggregate([canaryAssessment, ...controls.map(c => c.stage)]), 'Public test and separate rotating defect/clean controls are scored independently.');
  const foundBlind = verifiedPublic && discovery.status === 'pass' ? 1 : 0;
  return { version: 1, ownerId: config.ownerId, period, completedAt: args.now, outcome: aggregate([discovery, retrieval, assessment]), discovery, retrieval, assessment, controls, canaryAssessment,
    metrics: { configuredTargets: config.publicCanaryUrl ? 1 : 0, verifiedPublicTargets: verifiedPublic ? 1 : 0, knownPublicTargets: verifiedPublic ? 1 : 0, targetsFoundBlind: foundBlind, recall: verifiedPublic ? foundBlind : null, controlsRun: controls.filter(c => !['blocked', 'error'].includes(c.stage.status)).length, controlsPassed: controls.filter(c => c.stage.status === 'pass').length, discoveryCandidates: found?.urls.length || 0 },
    limitations: ['This single-target calibration does not measure recall across all brokerage ads.', 'Private posts, targeting, platform restrictions, deleted content and undiscovered publishers remain blind spots.', 'Controls are fictional diagnostic examples. Passing is not legal approval or proof of regulatory compliance.', 'Direct known-URL retrieval is diagnostic and never counted as blind discovery.'] };
}
