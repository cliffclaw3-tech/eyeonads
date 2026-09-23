-- Add only EyeOnAds tables; preserve all shared auth triggers and other products.
BEGIN;
CREATE TABLE IF NOT EXISTS public.user_profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL, full_name text, role text NOT NULL DEFAULT 'agent' CHECK (role IN ('agent','broker')),
 brokerage_id uuid, state text NOT NULL DEFAULT 'TN' CHECK (state IN ('TN','VA','NC')),
 license_number text, stripe_customer_id text, stripe_subscription_id text,
 subscription_tier text DEFAULT 'free' CHECK (subscription_tier IN ('free','agent','broker')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.compliance_scans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 ad_id text, ad_copy text NOT NULL, state text NOT NULL DEFAULT 'TN',
 result text NOT NULL CHECK (result IN ('green','yellow','red')), flags jsonb NOT NULL DEFAULT '[]',
 ai_explanation text, scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_scans_user_date ON public.compliance_scans(user_id,scanned_at DESC);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY eyeonads_profile_select ON public.user_profiles FOR SELECT TO authenticated USING (auth.uid()=id);
CREATE POLICY eyeonads_profile_insert ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()=id);
CREATE POLICY eyeonads_profile_update ON public.user_profiles FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
CREATE POLICY eyeonads_scan_owner ON public.compliance_scans FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
GRANT SELECT,INSERT,UPDATE ON public.user_profiles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.compliance_scans TO authenticated;
GRANT ALL ON public.user_profiles,public.compliance_scans TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
