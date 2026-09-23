ALTER TABLE public.compliance_scans ADD COLUMN IF NOT EXISTS analysis_source text;
ALTER TABLE public.eyeonads_brokerage_setups ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '';
ALTER TABLE public.eyeonads_brokerage_setups ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';
NOTIFY pgrst, 'reload schema';
