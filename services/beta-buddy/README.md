# Beta Buddy

Reusable beta-only report service plus an EyeOnAds adapter. No production repair path exists.

## Working locally

- Signed HTTP report ingestion, SQLite persistence, per-product/per-tenant/per-user reads.
- Consent, bounded explicit text, credential/contact/link redaction and diagnostic allowlists. Redaction is defense in depth, not a guarantee that arbitrary prose contains no personal data. Never upload contracts or screenshots.
- Duplicate reports within 24 hours return the existing ticket. Limit: ten new reports/hour/user.
- Feature suggestions and authorized operational-correction requests have distinct queues; neither enters the repair worker.
- Atomically leased repair jobs, a maximum of two claims, audit events, replay protection and bounded adapters. Expired leases stop for reconciliation rather than repeat an uncertain deployment.
- A signed trusted runner/deployer contract. Tests cover a simulated repair, passed checks, beta deployment, retry notification and health-failure rollback. External coding and deployment are NOT configured.
- EyeOnAds widget, server proxy, authenticated actor-derived tenancy/role, limited brokerage HTTP error events, in-app retry notices and unsent-message preservation. No form interception, recordings, full errors, DOM, cookies or browser storage capture.

## Isolation requirements

Run this service behind an operator-managed HTTPS reverse proxy. It binds loopback by default. Use a separate service identity/database, separate beta Supabase project, separate beta deployment project and separate beta deployment credentials. Do not reuse production keys. Restrict ingress to product backends, apply reverse-proxy body/connection/time limits, encrypt the host volume and run the service as an unprivileged account. Schedule `purge` daily for 30-day retention and manage encrypted backups to the same policy.

EyeOnAds requires all of these server-only settings:

```
BETA_BUDDY_ENV=beta
BETA_BUDDY_ISOLATED_DATA=1
BETA_BUDDY_APP_ORIGIN=https://<exact isolated beta app origin>
BETA_BUDDY_SERVICE_URL=https://<private report service>
BETA_BUDDY_PRODUCT_SECRET=<product-specific random signing secret>
VERCEL_ENV=preview
NEXT_PUBLIC_SUPABASE_URL=<separate beta project; production project is explicitly denied>
```

Only the Supabase public URL and anon key belong in browser configuration. Buddy signing, model, runner and deployment secrets never do. The UI and API fail closed for Vercel production, the known production domains and the known production database. Setting a feature flag on the live production app is insufficient and must not be used to enable it.

## Start and test

Copy `config.example.json` to an untracked operator config. Export the named product/runner secret environment variables through your secret manager. An empty runner/deployer URL intentionally saves reports as blocked. Do not replace blocked with a success message.

```
python -m unittest -v test_buddy
python buddy.py serve --config /secure/config.json --db /secure/buddy.sqlite3
python buddy.py work --config /secure/config.json --db /secure/buddy.sqlite3
python buddy.py purge --config /secure/config.json --db /secure/buddy.sqlite3
```

Schedule `work` in an isolated worker after configuring adapters. `events` and blocked/review queues need an operator dashboard/alert connector; there is currently no email or external paging connector. Testers get tenant-scoped in-app notifications when they return/poll; no email is sent.

## Trusted repair adapter

The service signs JSON requests with HMAC-SHA256 in `X-Buddy-Signature`. The adapter signs the exact response bytes with the same product-specific runner secret. Reply scope must echo `job_id`, `nonce`, `product`, and `tenant`. HTTPS redirects are denied. This secret belongs only in the trusted adapter, never in the coding/model sandbox.

The repair request contains a server-configured repository/base reference/path allowlist/check list and explicitly UNTRUSTED report text. The coding workflow produces only a unified patch proposal. `sandbox_runner.py` implements a reference verifier: disposable local clone pinned to a base commit, bounded path filtering, Docker image pinned by digest, no network, no capabilities, non-root user, readonly host mount, resource/time limits, independent tests in `/checks/`, and a candidate git bundle. It never pushes or deploys. Docker and the trusted prebuilt test image are not installed/configured here; that isolation path has not run end-to-end.

The operator's pinned test image must copy readonly `/workspace` into its writable temporary workspace where builds run. Independent behavior, tenant-isolation, production-denial and diff-security checks must be baked into `/checks/`, outside files the model can change. Never rely only on tests that a patch can edit. Both baseline behavior reproduction and post-fix behavior must be attested by the trusted runner. Before setting `sensitive_change=false`, the trusted diff-security review must inspect effects, not merely filenames. Access/authentication, privacy, payments, data/schema changes and transaction/contract correctness require human review.

The runner returns commit (40 hex), artifact_digest (64 hex), changed_paths, checks (every required check true), baseline_reproduced=true, isolated=true, sensitive_change=false. The reference baseline behavior check must exit 23 only for the specifically reproduced bug, 0 if the bug does not reproduce, and another code for infrastructure/unknown failures. Post-fix checks must exit 0. The service only then requests deploy to the one configured beta origin. Deployment must verify that exact artifact, have no production privileges, and return environment=beta, origin, commit, artifact_digest, healthy and deployment_id. On failed health the service requests rollback and confirms the configured beta origin; an unknown outcome stays under review. A production URL or failed check never produces a retry-ready notice.

## Product role contract

Never infer owner from admin, broker, pilot membership, email or a tester's text. Product adapters resolve roles and organization membership from authoritative server data. `capabilities.py` provides explicit role/capability and organization checks plus an override audit record. EyeOnAds currently uses account-owner-scoped data; it has no shared-organization owner/admin model. Its adapter maps its actual broker role only to marketing review and correction-request capabilities. It does not invent an owner role.

Operational corrections are human product actions, not software repairs. A broker/admin may confirm, mark unnecessary or dismiss only capabilities the product explicitly grants for that organization. Product mutations and audit insertion must occur in one transaction and store actor, role, organization, resource, reason, before/after hashes and timestamp. This library builds an audit record; the receiving product must persist it atomically with the mutation. The current Buddy exposes no endpoint that changes business data, bank accounts, funds, ownership, roles, credentials or contracts.

## Customer promotion

Verified beta artifacts are candidates only. Promote an exact reviewed commit through the product's normal human-controlled release process. Customer configuration disables Buddy; omit service/worker credentials and ensure `/api/beta-buddy` returns 404 and Buddy UI is absent. Never grant the beta deployment principal access to production.
### Durable hosted ingress (prepared, not deployed)

`app.py` is a WSGI serverless entrypoint. Deploy this service directory as a
separate Python project; it refuses local SQLite storage. Install `requirements.txt`.
Apply `postgres_schema.sql` manually ONLY in a new isolated Supabase project.
Tables have RLS and no anon/authenticated grants; no tester gets a database key.

Configure server-only secrets `BUDDY_STORE=postgres`, `BUDDY_ENVIRONMENT=beta`,
`BUDDY_ISOLATED_DATA=1`, `BUDDY_DATABASE_PROJECT=<new project ref>`,
`BUDDY_DATABASE_URL=<direct Postgres connection URI>` and `BUDDY_CONFIG_JSON`
(the operator-approved configuration serialized as JSON), plus each product's
signing secret. The URL must use `db.<new project ref>.supabase.co:5432/postgres`.
TLS is forced to verify-full with the bundled, SHA256-pinned public Supabase CA; arbitrary DSN options and
the known production project are rejected. Direct connections need IPv6.
For an IPv4 host, explicitly configure BUDDY_DATABASE_POOLER_HOST to the session
pooler host shown in the NEW project dashboard; the adapter requires username
postgres.<new project ref> and port 5432. Never silently switch database identity
or disable TLS. Alternatively supply BUDDY_DATABASE_PASSWORD (no URL encoding)
instead of BUDDY_DATABASE_URL; the other non-secret fields construct the target.

The SQL adapter serializes report dedup/rate checks and queue claims with a
transaction-scoped advisory lock. Status, audit event and notification writes
commit together. Never run schema bootstrap during tester requests. Worker
execution remains a separate operator process using the same durable database;
ingress does not start long coding jobs inside a browser request.

Local tests verify adapter SQL/target rules and WSGI ingestion with SQLite test
fixtures; they are NOT a successful live Postgres integration test. Before
enabling hosting, run parallel dedup/claim, tenant isolation, rollback and
restart-persistence checks against the newly provisioned project.

### Existing Codex sign-in proposal transport

`codex_proposal.proposal(executable, report, sources, allowed_paths)` invokes
the installed Codex CLI with the operator's existing sign-in, read-only sandbox,
ephemeral run, no user config/rules, shell/apps/plugins/hooks/browser/image tools
disabled, and JSON output schema. It receives only explicit bounded source
excerpts; cloud/model API keys are not inherited. Sensitive reports and feature
requests are rejected before a provider call. Credentials are not copied into
the test sandbox. Keep this process on the operator machine; do not upload the
operator's Codex authentication to cloud hosting.

The transport returns an UNVERIFIED patch. It cannot attest checks, apply a
patch or deploy. Use `sandbox_runner.py` for independent verification. One real
provider smoke check returned the expected unified diff for a synthetic reversed
loading-label defect on October 16. That is not a live EyeOnAds repair or hosted
autonomous loop. Local authentication will expire and operator availability is
required until a separately authorized hosted coding-provider identity exists.

The public CA was obtained from the certificate link in the isolated project Database Settings: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt . It is a public trust certificate, not a production credential or private key. Default system roots failed against the configured session pooler; the bundled CA and hostname verification passed a password-free TLS probe. Never weaken sslmode to work around certificate failures.
