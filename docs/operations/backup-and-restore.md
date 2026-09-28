# Backup and Restore

Runbook for the OMS MVP pilot (#3508 / D36). Covers what to back up, the
automated nightly service that does it (#3618), the manual fallback, the
restore procedure, and — the part a `pg_dump` alone does not solve — what is
**not** recoverable from a database dump.

## What to back up

**Postgres is the primary source of truth.** Every durable OpenLinker record
lives there: orders, products, connections, jobs, the fiscal/invoicing
ledgers, everything. A Postgres backup is the backup.

**Redis is durability spine ONLY for two remaining consumers, and otherwise
recoverable state.** Per [ADR-049](../architecture/adrs/049-durability-spine-and-domain-event-contract.md),
the webhook ingestion path (#2280) commits its work row straight to Postgres
and no longer transits Redis at all. The two consumer groups that still read
a Redis Pending Entries List — `master-deletion-offer-pause` and
`job-intake` — are documented as a known, gated gap in #2301; nothing in
this runbook backs up Redis, and losing it loses at most: the in-flight
rate-limit/dedup state for those two streams (self-healing — see
[docs/operations/redis-stream-retention.md](./redis-stream-retention.md)),
active JWT/session state (sessions re-establish on next login), and any
cache entries (rebuilt on next read). None of this is data an operator would
otherwise consider "lost" in the sense a missing order or a missing
connection would be.

**MySQL (PrestaShop/WooCommerce, dev-stack only) is out of scope here.**
Those are the *destination shops themselves* in local/demo compose
configurations — a real pilot install points at the operator's own
production shop, whose backups are that shop's own responsibility, not
OpenLinker's.

## What is NOT recoverable from a Postgres dump alone

Two secrets are encrypted-at-rest keys that live **outside** the database.
A `pg_dump` of `openlinker` captures the *ciphertext* these protect, never
the keys themselves — restoring the database without also having these two
values means every encrypted row is permanently unreadable, even though the
restore itself "succeeds":

- **`OPENLINKER_CREDENTIALS_ENCRYPTION_KEY`** — the AES-256-GCM key backing
  every row in `integration_credentials` (OAuth tokens, webhook secrets, AI
  provider keys, platform API keys — see
  [docs/operations/credentials-rotation.md](./credentials-rotation.md)).
  Lose this and every configured connection needs its credentials
  re-entered from scratch; nothing in the database can recover them.
- **`OL_PII_HASH_SALT`** — the salt used to hash customer PII at order
  ingestion. Losing it does not corrupt existing hashed rows, but it means
  a restored deployment can no longer be trusted to produce the SAME hash
  for the SAME customer as it did before the loss — silently breaking
  customer-identity matching across the restore boundary (see
  `docs/architecture-overview.md` § Customer Identity Resolution).

**Back these up alongside the database, in your secrets manager — never in
the database dump itself and never in git.** The nightly backup service
(below) deliberately does not attempt to capture them: a dump that carried
plaintext secrets would turn a lost dump file into a second, worse incident.
If your deployment method is a `.env` file (the docker-compose path), back
up that `.env` file through your normal secrets/config management, with the
same access controls as the values themselves.

## Automated nightly backup service (default, #3618, D36)

The `backup` service in `docker-compose.yml` runs a `pg_dump` against the
`postgres` service every night (default 03:00 UTC, configurable) and
retains **7 daily + 4 weekly** dumps in the `postgres-backups` named Docker
volume. It ships enabled by default in the base stack and in `pnpm
demo:up`.

```yaml
# docker-compose.yml
backup:
  image: postgres:17-alpine
  entrypoint: ['/bin/bash', '/scripts/backup-scheduler.sh']
  volumes:
    - postgres-backups:/backups
    - ./scripts/backup:/scripts:ro
```

**Configuration** (all optional, set in `.env` — see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `OL_BACKUP_TIME` | `03:00` | HH:MM, UTC, when the nightly dump runs |
| `OL_BACKUP_DAILY_RETENTION` | `7` | how many daily dumps to keep |
| `OL_BACKUP_WEEKLY_RETENTION` | `4` | how many weekly dumps to keep |
| `OL_BACKUP_WEEKLY_DAY` | `7` (Sunday) | which day's daily dump is also kept as that week's weekly dump (`date(1)` `%u`: 1=Monday..7=Sunday) |

**Credentials.** The service reads `POSTGRES_PASSWORD` — the same variable
the `api`/`worker`/`migrate` services already read from `.env`. Nothing is
read from a committed file, and the dump itself carries no credentials (it
is a schema+data dump of the `openlinker` database, produced with
`--no-owner --no-privileges` — see `scripts/backup/pg-backup-once.sh`).

**A failed dump is visible, not silent.** Each run logs to the service's
own stdout (`docker compose logs backup`); a failed `pg_dump` propagates a
non-zero exit and is logged as `BACKUP RUN FAILED`, but the SCHEDULER keeps
running so tomorrow's attempt is not lost to a crashed container — a
missed night is recoverable by watching the logs and re-running manually
(below); a container that gave up entirely would produce zero future
backups from that point on, which is worse.

**Where the dumps land.** Inside the `postgres-backups` Docker volume, at
`/backups/daily/openlinker-<UTC timestamp>.dump` and, on the configured
weekly day, additionally at `/backups/weekly/openlinker-<UTC timestamp>.dump`.
To copy dumps out to the host (e.g. for off-site storage — see "Out of
scope" below):

```bash
docker compose cp backup:/backups ./local-backups
```

## Manual backup (fallback)

If the automated service is not running, or you need an on-demand dump
before a risky operation (a migration, a credentials rotation), run the
exact same script the service runs:

```bash
docker compose exec -e OL_BACKUP_DIR=/backups backup bash /scripts/pg-backup-once.sh
```

Or, without the compose service, a plain `pg_dump` against any reachable
Postgres:

```bash
PGPASSWORD=<POSTGRES_PASSWORD> pg_dump \
  -h <host> -p <port> -U postgres -d openlinker \
  -Fc --no-owner --no-privileges \
  -f openlinker-manual-$(date -u +%Y%m%d-%H%M%S).dump
```

`-Fc` (custom format) is required for `pg_restore` below — a plain-text
(`-Fp`) dump restores with `psql` instead and is not what this runbook or
the CI restore check (below) exercises.

## Restore procedure

1. **Stop the api and worker processes** (or point the restore at a
   database the application is not currently using — never restore over a
   live database while it is serving traffic).
2. **Restore into a target database that already exists** (the restore
   script does not create it):
   ```bash
   # Via the backup service's own script (recommended — the SAME script
   # both the nightly service and CI use, see scripts/backup/pg-restore.sh):
   docker compose exec backup psql -U postgres -c 'CREATE DATABASE openlinker_restored;'
   docker compose exec -e PGHOST=postgres -e PGUSER=postgres -e PGPASSWORD=<POSTGRES_PASSWORD> \
     backup bash /scripts/pg-restore.sh /backups/daily/<chosen-dump>.dump openlinker_restored

   # Or plain pg_restore against any reachable Postgres:
   createdb -h <host> -U postgres openlinker_restored
   PGPASSWORD=<POSTGRES_PASSWORD> pg_restore \
     -h <host> -p <port> -U postgres -d openlinker_restored \
     --clean --if-exists --no-owner --no-privileges \
     openlinker-manual-<timestamp>.dump
   ```
3. **Verify before cutting over.** Point `DB_DATABASE` at the restored
   database and run:
   ```bash
   pnpm --filter @openlinker/api migration:show
   ```
   This must report **0 pending migrations** — see
   [docs/migrations.md](../migrations.md). If it reports pending migrations,
   the dump predates a schema change that has since shipped; run
   `pnpm --filter @openlinker/api migration:run` against the restored
   database before pointing the application at it.

   > `migration:show`'s own exit code is always `0` regardless of what it
   > finds (a TypeORM CLI quirk — see
   > `apps/api/scripts/assert-no-pending-migrations.ts`'s docblock) — read
   > its *printed* lines for a `[ ]` marker, or use
   > `pnpm --filter @openlinker/api migration:assert-clean`, which exits
   > non-zero on a genuinely pending migration and is what CI asserts on
   > (below).
4. **Restore to a genuinely EMPTY database also works with no extra step.**
   The dump contains its own `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`
   statement (`pg_dump` captures the source database's extensions), so
   restoring onto a fresh Postgres instance does not additionally need the
   [#2684](../migrations.md#empty-database-prerequisite-2684) bootstrap
   step — `pg_restore` replays it as part of the dump.
5. **Rotate in the two secrets from "What is NOT recoverable" above** on the
   restored environment before starting the api/worker — a restore with the
   WRONG `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` boots successfully and
   fails only when a credential is first decrypted, which is a worse time
   to discover the mismatch than right now.
6. **Point the application at the restored database and start it.**

## Proven in CI, not assumed

`.github/workflows/ci.yml`'s `backup-restore` job runs this whole loop on
every relevant change: seeds a genuinely empty Postgres through the real
migration chain (proving #2684's from-empty fix), inserts a marker row,
produces a dump with the SAME script the nightly service runs, restores it
into a second, genuinely empty database, and asserts both `migration:show`
reports 0 pending AND the marker row survived. A restore that only "looks"
documented is not what a pilot with real orders can rely on — this job is
what makes the claim checked rather than assumed.

## Out of scope for this runbook

**Off-site copies and point-in-time recovery** (`pg_basebackup` / WAL
archiving) are not covered — the nightly `pg_dump` service is a
correctness-of-restore guarantee, not a disaster-recovery-from-total-volume-
loss one. If the `postgres-backups` volume and the primary `postgres-data`
volume live on the same disk, a full disk failure loses both; copying the
volume's dumps to off-site storage on your own schedule (`docker compose cp
backup:/backups ...`, above) closes that gap and is an operator decision,
not something this service does for you.
