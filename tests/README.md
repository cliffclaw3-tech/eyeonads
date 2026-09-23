# EyeOnAds verification

- `npm test`: isolated validation, auth recovery, mocked route persistence/authorization, dictation lifecycle. These do not prove live service quality.
- `npm run lint` and `npm run build`: static and production build checks.
- `RECOVERY_TEST_URL=http://127.0.0.1:3198 node tests/beta-http.mjs` and `tests/password-recovery-http.mjs`: local HTTP contract checks without email delivery.
- `tests/sql`: disposable PostgreSQL queue state-machine and isolation checks.
- Release browser evidence: `/Users/wes/Documents/Codex/eyeonads-release-20260923/`. The local `browser-check.cjs`, `discovery-check.cjs`, and `image-check.cjs` run real browser journeys with separately provisioned QA credentials kept outside the repository. No passwords, session cookies, or MLS tokens are committed.

The private brokerage pilot includes public-web discovery. Search completion does not prove compliance, exhaustive advertising coverage, or company roster completeness. The Spark import currently exposes 149 active visible Greater Impact agents in four offices; Knoxville is not represented by this feed. No paid-human-test certificate is implied.
