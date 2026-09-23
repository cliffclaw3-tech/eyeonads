export type SparkRosterAgent = { id: string; name: string; email: string; social_url: string };
export type SparkRosterPreview = {
  agents: SparkRosterAgent[]; offices: { name: string; count: number }[];
  total: number; source: string; complete_feed: boolean; warning: string; missing_offices: string[];
};
type Row = Record<string, unknown>;

/** Read-only, bounded import from the configured accessible feed. Never returns credentials or raw MLS records. */
export async function fetchSparkRoster(brokerageName: string): Promise<SparkRosterPreview> {
  const endpoint = process.env.SPARK_API_ENDPOINT;
  const token = process.env.SPARK_API_TOKEN;
  if (!endpoint || !token) throw new Error("Spark roster import is not configured. Your existing roster has not changed.");
  const base = new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Spark connection configuration needs administrator review.");
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const brokerage = normalize(brokerageName);
  // This token is authorized for the private Greater Impact Realty pilot only.
  if (brokerage !== "greater impact realty") throw new Error("This private Spark import is configured for Greater Impact Realty. Save that brokerage name before importing.");
  const deadline = Date.now() + 105_000;
  let pages = 0;
  let records = 0;
  let complete = true;
  const notes = new Set<string>();
  const agents = new Map<string, SparkRosterAgent>();
  const officeCounts: SparkRosterPreview["offices"] = [];

  async function collect(resource: "Office" | "Member", params: Record<string, string>): Promise<Row[]> {
    let next: URL | null = new URL(resource, base);
    for (const [key, value] of Object.entries(params)) next.searchParams.set(key, value);
    const visited = new Set<string>();
    const rows: Row[] = [];
    while (next) {
      if (pages >= 80 || records >= 20_000 || Date.now() >= deadline) {
        complete = false; notes.add("The import reached its time or page limit; additional feed records may be missing."); break;
      }
      if (next.origin !== base.origin || next.pathname !== `${base.pathname}${resource}` || next.username || next.password || visited.has(next.href)) {
        complete = false; notes.add("The feed returned an unexpected pagination link; import stopped before following it."); break;
      }
      visited.add(next.href);
      try {
        const response: Response = await fetch(next, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
          signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, deadline - Date.now()))),
        });
        if (!response.ok) throw new Error("Feed request failed");
        const payload: { value?: Row[]; "@odata.nextLink"?: string } = await response.json();
        if (!Array.isArray(payload.value)) throw new Error("Invalid feed response");
        const allowed = Math.max(0, 20_000 - records);
        rows.push(...payload.value.slice(0, allowed));
        records += payload.value.length; pages += 1;
        if (payload.value.length > allowed) { complete = false; notes.add("The feed record limit was reached."); break; }
        next = payload["@odata.nextLink"] ? new URL(payload["@odata.nextLink"], base) : null;
      } catch {
        complete = false; notes.add("Part of the Spark feed could not be read. Retry the import to check for additional agents."); break;
      }
    }
    return rows;
  }

  const officeRows = await collect("Office", { "$top": "1000", "$select": "OfficeKey,OfficeName,OfficeCity,OfficeStatus,Visible" });
  const matching = officeRows.filter((office) => {
    const name = normalize(String(office.OfficeName || ""));
    return (name === brokerage || name.startsWith(`${brokerage} `)) && office.OfficeStatus === "Active" && office.Visible === true;
  });
  for (const office of matching) {
    const key = String(office.OfficeKey || "");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) { complete = false; notes.add("An office had an unsupported identifier and was skipped."); continue; }
    const members = await collect("Member", {
      "$filter": `OfficeKey eq '${key}'`, "$top": "100",
      "$select": "MemberKey,MemberFullName,OfficeKey,MemberStatus,Visible",
    });
    let count = 0;
    for (const member of members) {
      if (member.OfficeKey !== key) { complete = false; notes.add("Unexpected office membership was excluded."); continue; }
      if (member.MemberStatus !== "Active" || member.Visible !== true) continue;
      const memberKey = String(member.MemberKey || "");
      const name = String(member.MemberFullName || "").trim();
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(memberKey) || !name || name.length > 150) { complete = false; notes.add("A member record could not be represented in the roster and was skipped."); continue; }
      if (agents.size >= 1000 && !agents.has(memberKey)) { complete = false; notes.add("The 1,000-agent beta roster limit was reached."); continue; }
      if (!agents.has(memberKey)) { agents.set(memberKey, { id: `spark:${memberKey}`, name, email: "", social_url: "" }); count += 1; }
    }
    officeCounts.push({ name: String(office.OfficeName), count });
  }
  if (!matching.length) notes.add("No matching active, visible offices were found in this accessible feed.");
  const missingOffices = matching.some((office) => /knoxville/i.test(`${office.OfficeName} ${office.OfficeCity}`)) ? [] : ["Knoxville"];
  if (missingOffices.length) notes.add("Knoxville is not present among matching offices in this accessible feed; add or import its roster before company-wide coverage can be confirmed.");
  notes.add("Only active, visible members of matching offices in this accessible Spark feed are included. Other MLS feeds, offices, inactive or hidden members may be absent; this is not confirmation of the entire company roster.");
  return { agents: [...agents.values()], offices: officeCounts, total: agents.size, source: "Spark accessible feed", complete_feed: complete, warning: [...notes].join(" "), missing_offices: missingOffices };
}
