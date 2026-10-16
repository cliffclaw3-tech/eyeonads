-- Apply only to a NEW isolated beta project. Never the EyeOnAds production DB.
BEGIN;
CREATE TABLE public.reports (
 id text PRIMARY KEY, product text NOT NULL, tenant text NOT NULL,
 "user" text NOT NULL, kind text NOT NULL, description text NOT NULL,
 page text NOT NULL, diagnostics text NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 lease text, leased_at bigint, created bigint NOT NULL, updated bigint NOT NULL,
 release text
);
CREATE INDEX report_queue ON public.reports(status, updated);
CREATE INDEX report_dedup ON public.reports(product, tenant, "user", fingerprint, created);
CREATE TABLE public.nonces(product text, nonce text, created bigint, PRIMARY KEY(product, nonce));
CREATE TABLE public.events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, report text NOT NULL, event text NOT NULL, created bigint NOT NULL);
CREATE TABLE public.notifications(id text PRIMARY KEY, report text NOT NULL, product text NOT NULL, tenant text NOT NULL, "user" text NOT NULL, message text NOT NULL, created bigint NOT NULL, UNIQUE(report,message));
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reports, public.nonces, public.events, public.notifications FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.events_id_seq FROM anon, authenticated;
COMMIT;
