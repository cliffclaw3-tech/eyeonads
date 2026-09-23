-- Preserve the entire brokerage roster while selecting the office used for discovery.
ALTER TABLE public.eyeonads_brokerage_setups ADD COLUMN IF NOT EXISTS discovery_agent_ids text[];
ALTER TABLE public.eyeonads_brokerage_setups ADD COLUMN IF NOT EXISTS discovery_location text;
NOTIFY pgrst, 'reload schema';
