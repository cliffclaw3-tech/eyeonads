Run only against a disposable, empty PostgreSQL database, never production:
1. Apply queue-fixtures.sql as database owner.
2. Apply ../../supabase/migrations/20260923_discovery_jobs.sql.
3. Apply queue-assertions.sql with ON_ERROR_STOP=1.
The fixture provides synthetic auth identities. Assertions exercise isolation, claims, retries, pause, lease expiry and completion.
