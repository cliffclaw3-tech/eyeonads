alter table public.eyeonads_discovery_reviews add column if not exists evidence jsonb;
notify pgrst, 'reload schema';
