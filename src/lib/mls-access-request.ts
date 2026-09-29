export const MLS_REQUEST_STATUSES = {
  not_started: 'Not yet submitted',
  requested: 'Submitted — awaiting MLS response',
  more_information: 'MLS requested more information',
  approved_reported: 'Approval received — connection not verified',
  declined: 'Request declined',
} as const;
export type MlsAccessRequest = { mls: string; offices: string; contact: string; reference: string; status: keyof typeof MLS_REQUEST_STATUSES };
export const EMPTY_MLS_REQUEST: MlsAccessRequest = { mls: '', offices: '', contact: '', reference: '', status: 'not_started' };
export function parseMlsAccessRequest(value: unknown): MlsAccessRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Enter the MLS request details.');
  const input = value as Record<string, unknown>;
  const limits = { mls: 120, offices: 200, contact: 120, reference: 120 };
  if (Object.keys(input).some(key => ![...Object.keys(limits), 'status'].includes(key))) throw Error('Only request tracking details are accepted. Do not include credentials.');
  const result = { ...EMPTY_MLS_REQUEST };
  for (const [key, max] of Object.entries(limits)) {
    const field = key as keyof typeof limits;
    const value = input[field];
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw Error(`Check the ${field} field (maximum ${max} characters).`);
    result[field] = value.trim();
  }
  if (!result.mls) throw Error('Enter the MLS name.');
  if (typeof input.status !== 'string' || !Object.hasOwn(MLS_REQUEST_STATUSES, input.status)) throw Error('Choose a request status.');
  result.status = input.status as MlsAccessRequest['status'];
  return result;
}
export function mlsRequestLetter(brokerage: string, request: MlsAccessRequest): string {
  return `Subject: MLS data access request for ${brokerage.trim() || '[Brokerage name]'} — EyeOnAds\n\nHello ${request.mls.trim() || '[MLS name]'} data services team,\n\n${brokerage.trim() || '[Brokerage name]'} requests information about approved API access for EyeOnAds, an internal brokerage advertising-review application.\n\nRequested office scope: ${request.offices.trim() || '[List the offices and their MLS office IDs]'}\nBroker contact: ${request.contact.trim() || '[Broker name and contact details]'}\n\nWe would like read-only access to our authorized brokerage/office roster, including member and office IDs, names, affiliation/status, and permitted business contact fields. Please confirm whether a complete roster is available independently of listing activity. If listing data is separately approved, it would be used only to match our brokerage's advertising to authorized property records.\n\nIntended users are the brokerage's authorized staff and EyeOnAds as its software provider. This request is for internal roster management and advertising review, not a public IDX listing display or unrestricted MLS-wide access. Please advise which license and API role (for example Broker Back Office/Private, if appropriate) permits this use, the approved fields and offices, refresh/retention requirements, vendor registration or agreements, and any fees. We will not treat an IDX approval as approval for additional uses.\n\nPlease provide the official application process, any required brokerage authorization and developer registration steps, and the approved secure method for provisioning credentials. Do not include API secrets in a reply to this draft.\n\nThis is a request for instructions and approval; it does not enroll us in a paid plan or accept terms.\n\nThank you,\n[Authorized broker name]`;
}
