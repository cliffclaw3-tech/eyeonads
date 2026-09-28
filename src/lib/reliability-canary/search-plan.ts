type Identities = { brokerage: string; office: string; state: string };

// Queries are built only from normal organization identity, never a saved post,
// publisher, calibration label or expected finding. This is a brokerage sample,
// not a substitute for the separate per-agent daily discovery workflow.
function phrase(value: string): string {
  const clean = value.normalize('NFKC').replace(/["\\\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 200 || /https?:\/\//i.test(clean)) throw Error('Invalid search identity');
  return `"${clean}"`;
}

export function publicPostSearchPlan(input: Identities): string[] {
  const base = `site:facebook.com ${phrase(input.brokerage)}`;
  return [...new Set([...(input.office.trim() ? [`${base} ${phrase(input.office)}`] : []), base, ...(input.state.trim() ? [`${base} ${phrase(input.state)}`] : [])])];
}

export function searchPlanExecuted(planned: string[], response: unknown): boolean {
  const output = (response as { output?: unknown[] })?.output;
  if (!Array.isArray(output) || !planned.length) return false;
  const normalize = (query: string) => query.trim().replace(/\s+/g, ' ').toLowerCase();
  const observed: string[] = [];
  for (const item of output) {
    const call = item as { type?: string; status?: string; action?: { type?: string; query?: unknown; queries?: unknown[] } };
    if (call?.type !== 'web_search_call') continue;
    if (call.status !== 'completed' || call.action?.type !== 'search') return false;
    const queries = Array.isArray(call.action.queries) ? call.action.queries : [call.action.query];
    if (!queries.length || queries.some(query => typeof query !== 'string' || !query.trim())) return false;
    for (const query of queries) observed.push(normalize(query as string));
  }
  return observed.length === planned.length && observed.length <= 3 &&
    [...observed].sort().every((query, index) => query === planned.map(normalize).sort()[index]);
}
