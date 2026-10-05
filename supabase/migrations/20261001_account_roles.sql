-- Keep the role selected at account creation separate from editable profile data.
BEGIN;
CREATE TABLE IF NOT EXISTS public.eyeonads_account_roles (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('agent','broker')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.eyeonads_account_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY eyeonads_account_role_read ON public.eyeonads_account_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.eyeonads_account_roles TO authenticated;
GRANT ALL ON public.eyeonads_account_roles TO service_role;

INSERT INTO public.eyeonads_account_roles (user_id,role)
SELECT users.id, CASE WHEN users.raw_app_meta_data->>'eyeonads_pilot' = 'true' OR EXISTS (SELECT 1 FROM public.eyeonads_brokerage_setups AS setup WHERE setup.owner_id = users.id) THEN 'broker' ELSE 'agent' END
FROM auth.users AS users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.eyeonads_capture_account_role() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 INSERT INTO public.eyeonads_account_roles (user_id,role)
 VALUES (NEW.id, CASE WHEN NEW.raw_user_meta_data->>'role' = 'broker' THEN 'broker' ELSE 'agent' END)
 ON CONFLICT (user_id) DO NOTHING;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS eyeonads_capture_account_role ON auth.users;
CREATE TRIGGER eyeonads_capture_account_role AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.eyeonads_capture_account_role();

CREATE OR REPLACE FUNCTION public.eyeonads_current_broker() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM public.eyeonads_account_roles WHERE user_id = auth.uid() AND role = 'broker');
$$;
REVOKE ALL ON FUNCTION public.eyeonads_current_broker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eyeonads_current_broker() TO authenticated;

DROP POLICY IF EXISTS eyeonads_setup_owner ON public.eyeonads_brokerage_setups;
CREATE POLICY eyeonads_setup_owner ON public.eyeonads_brokerage_setups FOR ALL TO authenticated USING (auth.uid() = owner_id AND public.eyeonads_current_broker()) WITH CHECK (auth.uid() = owner_id AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS eyeonads_discovery_owner ON public.eyeonads_discovery_reviews;
CREATE POLICY eyeonads_discovery_owner ON public.eyeonads_discovery_reviews FOR ALL TO authenticated USING (auth.uid() = owner_id AND public.eyeonads_current_broker()) WITH CHECK (auth.uid() = owner_id AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS report_schedule_owner ON public.eyeonads_report_schedules;
CREATE POLICY report_schedule_owner ON public.eyeonads_report_schedules FOR ALL TO authenticated USING (auth.uid() = owner_id AND public.eyeonads_current_broker()) WITH CHECK (auth.uid() = owner_id AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS discovery_jobs_owner_read ON public.eyeonads_discovery_jobs;
CREATE POLICY discovery_jobs_owner_read ON public.eyeonads_discovery_jobs FOR SELECT TO authenticated USING (owner_id = auth.uid() AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS discovery_items_owner_read ON public.eyeonads_discovery_job_items;
CREATE POLICY discovery_items_owner_read ON public.eyeonads_discovery_job_items FOR SELECT TO authenticated USING (owner_id = auth.uid() AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS reliability_config_owner_read ON public.eyeonads_reliability_configs;
CREATE POLICY reliability_config_owner_read ON public.eyeonads_reliability_configs FOR SELECT TO authenticated USING (owner_id = auth.uid() AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS reliability_run_owner_read ON public.eyeonads_reliability_runs;
CREATE POLICY reliability_run_owner_read ON public.eyeonads_reliability_runs FOR SELECT TO authenticated USING (owner_id = auth.uid() AND public.eyeonads_current_broker());
DROP POLICY IF EXISTS reliability_delivery_owner_read ON public.eyeonads_reliability_deliveries;
CREATE POLICY reliability_delivery_owner_read ON public.eyeonads_reliability_deliveries FOR SELECT TO authenticated USING (owner_id = auth.uid() AND public.eyeonads_current_broker());
NOTIFY pgrst, 'reload schema';
COMMIT;
