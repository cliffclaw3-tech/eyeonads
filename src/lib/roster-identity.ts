type RosterIdentity = {id?: string; name: string; email: string};
const nameKey = (name: string) => name.replaceAll(',', ' ').trim().replace(/\s+/g, ' ').toLowerCase();
/** A matching display name cannot override a distinct email identity. Ambiguity needs correction. */
export function matchSavedAgent<T extends RosterIdentity>(draft: RosterIdentity, saved: T[]): T | undefined {
 const email = draft.email.trim().toLowerCase();
 const emails = email ? saved.filter(agent => agent.email.trim().toLowerCase() === email) : [];
 if (emails.length === 1) return emails[0];
 if (emails.length > 1) throw Error('An email matches multiple saved agents. Correct the roster before saving.');
 const names = saved.filter(agent => nameKey(agent.name) === nameKey(draft.name));
 if (names.length > 1) throw Error('This name matches multiple saved agents. Supply the matching saved email to identify the correct person.');
 if (names[0]?.email.trim() && names[0].email.trim().toLowerCase() !== email) throw Error("This name has a different saved email. Restore the saved email before editing its social profiles; identity changes require a separate roster review.");
 return names[0];
}
