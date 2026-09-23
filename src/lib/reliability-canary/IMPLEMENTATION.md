# Monthly reliability engine delivery — REL-20260923-MONTHLY

This module implements the diagnostic engine and proposed database scheduling/claim layer. The integration owner supplies public-source adapters, UI, worker routing, production migration application and real report delivery. This agent made no provider calls, sent no mail, published no post and changed no remote database.

## Engine integration

`runMonthlyCanary({config, period, queryInputs, now}, dependencies)` returns a versioned JSON report. Map database snake_case configuration to the exported `CanaryConfig`. `period` is UTC `YYYY-MM`; `now` is the run evaluation timestamp. Blind discovery receives only brokerage, office, agent names and state. It never receives the known URL, publisher identity, required label or expected findings. Direct known-URL retrieval happens separately and cannot repair a discovery miss.

`expectedTargetId` means the observed publisher's profile/page identity, not the post ID. Retrieval must provide a verified publisher identity, canonical post URL, publicly accessible text containing the explicit test label, capture time in the report month, and content hash. An unavailable, unlabeled, unpublished, stale or wrong-target post blocks the test even if discovery found a matching URL. `configuredTargets` and `verifiedPublicTargets` remain separate. Recall is null without a verified public denominator; one successful test never establishes brokerage-wide recall.

The two fictional assessment controls rotate monthly across three examples. Expected findings are withheld from `assess` input. Map substantive discriminatory housing content to `housing_discrimination`; retain other substantive findings as separate codes so unexpected findings also fail calibration. Common assessment context may say to evaluate the draft as though it were advertising; it must not identify which example is clean or defective.

Provider-stage bounds are 30 seconds discovery, 20 seconds retrieval, 22 seconds for the public assessment, and 22 seconds for two concurrent independent controls: at most 94 seconds plus database overhead. Adapters should honor the supplied abort signal. Checkpoints are owner/period/input fingerprinted. Persist checkpoints only through the token-fenced RPC. Provider errors become report stage errors, not fabricated passes: retry the run through the bounded SQL retry path while attempts remain, then persist the final error report.

## Database RPCs

The proposed migration adds separate monthly config, run and delivery tables. Daily schedules are untouched. Owners can read only their own records. Config target/recipient fields are service-owned. Two authenticated RPCs infer ownership from auth.uid(), require pilot access and a saved roster, and expose only safe actions:

- `eyeonads_set_reliability_schedule(p_enabled)` returns one config row; newly enabled schedules start the next UTC calendar month. Existing enabled due times are preserved.
- `eyeonads_start_reliability()` returns the unique current-month run and preserves the schedule. It is idempotent, including when a run is complete.

Service RPCs:

- `eyeonads_enqueue_due_reliability()` returns inserted count, maximum ten per call, unique owner/month; advances due time to next UTC calendar month without fabricating missed reports.
- `eyeonads_claim_reliability()` returns zero or one run with a five-minute lease and maximum three attempts.
- `eyeonads_checkpoint_reliability(p_run,p_token,p_key,p_checkpoint)` and `eyeonads_finish_reliability(p_run,p_token,p_report)` return a boolean; false means lost/expired lease. Report owner and period must match. Finish atomically creates one delivery outbox record.
- `eyeonads_fail_reliability(p_run,p_token,p_error)` returns a boolean, delays retry five minutes per attempt, and terminates at attempt three.
- `eyeonads_claim_reliability_delivery(p_run,p_recipient,p_source)` returns zero or one delivery with a two-minute send lease. The service must first resolve the verified signup identity or explicitly authorized pilot override. The RPC independently rejects arbitrary recipients and known fixture identities.
- `eyeonads_record_reliability_delivery(p_run,p_token,p_status,p_message_id,p_event_id,p_error,p_retry_safe)` records a send outcome. Provider acceptance is distinct from verified delivery. Only a known rejection before acceptance is safe to retry, with three total attempts. Unknown acceptance or expired send lease becomes uncertain and cannot auto-resend. A late receipt after losing the lease requires service reconciliation; it must not trigger a new send.

An unresolved recipient can be marked blocked by a conditional service update on a queued outbox record, without taking a sending lease. Report persistence is independent of delivery, so delivery failures remain visible without rerunning discovery.

## Validation evidence

Behavioral unit tests cover blind-input separation, direct retrieval versus discovery, unpublished/unavailable/wrong-target/stale evidence, clean false positives and defect misses, checkpoint reuse and tenant/period separation, deterministic rotation, and accepted/delivered/uncertain delivery semantics.

A disposable local PostgreSQL cluster executes the actual migration against synthetic auth/users/roster fixtures. It verifies owner RLS, owner-only schedule/start RPCs, owner/month uniqueness, calendar rollover, competing claims, checkpoint persistence, stale lease fencing, report/outbox idempotence, arbitrary-recipient rejection, signup versus authorized override, uncertain send duplicate prevention and three-attempt processing cap.

Reproduce:

```sh
node --experimental-strip-types --test tests/monthly-canary.test.mjs
EYEONADS_TEST_LOCAL_POSTGRES=1 node --experimental-strip-types --test tests/monthly-canary-schema.test.mjs
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2017 --module esnext --moduleResolution bundler src/lib/reliability-canary/engine.ts src/lib/reliability-canary/delivery.ts
```

The DB fixture creates a random temporary directory, runs `initdb -D <temp>/data -A trust --no-locale`, starts `pg_ctl -D <temp>/data -l <temp>/postgres.log -o "-k <temp> -p 55483 -h ''" -w start` using only its private Unix socket, applies the migration only there, then always runs `pg_ctl -D <temp>/data -m immediate -w stop` and removes the temporary directory. No TCP listener or production database is used.
