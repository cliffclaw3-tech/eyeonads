ALTER TABLE public.eyeonads_brokerage_setups
ADD COLUMN IF NOT EXISTS offices jsonb NOT NULL DEFAULT '[]'::jsonb;
