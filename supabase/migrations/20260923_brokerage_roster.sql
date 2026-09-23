BEGIN;
CREATE TABLE public.eyeonads_brokerage_setups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
 expected_agents integer NOT NULL CHECK(expected_agents BETWEEN 1 AND 10000),
 scope text NOT NULL CHECK(scope IN ('both','brokerage','agents')),
 agents jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(agents)='array'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.eyeonads_brokerage_setups ENABLE ROW LEVEL SECURITY;
CREATE POLICY eyeonads_setup_owner ON public.eyeonads_brokerage_setups FOR ALL TO authenticated USING(auth.uid()=owner_id) WITH CHECK(auth.uid()=owner_id);
GRANT SELECT,INSERT,UPDATE ON public.eyeonads_brokerage_setups TO authenticated;
GRANT ALL ON public.eyeonads_brokerage_setups TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
