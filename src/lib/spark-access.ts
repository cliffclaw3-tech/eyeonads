type PilotUser = { id: string; email?: string; app_metadata?: unknown };

// The legacy Greater Impact connection is provisioned as a project secret, not a
// user-supplied IDX key. Keep its use limited to the existing invited pilot.
export function sparkPilotAvailable(user: PilotUser, brokerageName: string): boolean {
  const configured = !!process.env.SPARK_API_ENDPOINT && !!process.env.SPARK_API_TOKEN;
  const pilot = typeof user.app_metadata === 'object' && user.app_metadata !== null
    && 'eyeonads_pilot' in user.app_metadata && user.app_metadata.eyeonads_pilot === true;
  const owner = !!process.env.EYEONADS_SPARK_OWNER_ID && user.id === process.env.EYEONADS_SPARK_OWNER_ID;
  const legacyWes = user.email?.toLowerCase() === 'theshieldsteam@gmail.com';
  return configured && pilot && (owner || legacyWes) && brokerageName.trim().toLowerCase() === 'greater impact realty';
}
