# Crimson Crown Safe Schema Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish enforceable local safety guards, acquire the Crimson Crown production schema or backup without remote writes, and produce the exact schema/data-classification inputs for the sanitized local replica.

**Architecture:** The repository remains unlinked from production. Source access is limited to an existing backup artifact or a temporary PostgreSQL connection used only by dump tooling; all raw artifacts live outside the workspace. A local guard rejects production refs and hosts before the application or Playwright can start.

**Tech Stack:** PowerShell 7/Windows PowerShell, Node.js 20+, Supabase CLI 2.113.0, Docker 29.3.1, PostgreSQL 17 tools, Next.js 16, Playwright 1.58.

## Global Constraints

- Do not create commits or push any branch.
- Do not run `supabase link`, `supabase db push`, `supabase db reset --linked`, `supabase migration up --linked`, remote SQL, seeds, or migrations.
- Production project ref is exactly `djfqozfaqkqdoqeoqbzt` and must be rejected by all test/runtime guards.
- Production web host is exactly `www.crimsoncrownimports.com` and must never be a Playwright target.
- Raw backups, dumps, PII, credentials, and generated customer data must remain outside both the workspace `D:\crimson-crown-tcg\crimson-crown` and the actual Git worktree `D:\crimson-crown-tcg`.
- The persistent development replica must be sanitized before the application can connect to it.
- Application email, payments, and third-party mutations must be disabled in local/E2E environments.
- Every task ends with a read-only verification checkpoint instead of a commit.

---

### Task 1: Add production-host safety guards

**Files:**
- Create: `src/lib/environment/production-guards.ts`
- Create: `src/lib/environment/production-guards.test.ts`
- Create: `scripts/assert-safe-test-environment.mjs`
- Create: `scripts/assert-safe-test-environment.test.mjs`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `assertNonProductionUrl(rawUrl: string, purpose: string): URL`
- Produces: `assertSafeTestEnvironment(env: NodeJS.ProcessEnv): void`
- Rejects: project ref `djfqozfaqkqdoqeoqbzt`, Supabase production hosts containing that ref, and `crimsoncrownimports.com`.

- [x] **Step 1: Write failing unit tests**

Cover exact rejection of:

```ts
[
  'https://djfqozfaqkqdoqeoqbzt.supabase.co',
  'postgresql://user:secret@db.djfqozfaqkqdoqeoqbzt.supabase.co:5432/postgres',
  'https://www.crimsoncrownimports.com',
  'https://crimsoncrownimports.com/catalog',
]
```

Cover acceptance of:

```ts
[
  'http://127.0.0.1:54621',
  'http://localhost:3000',
]
```

- [x] **Step 2: Run the tests and confirm they fail**

Run:

```powershell
$node='C:\Users\mjper\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node --test --experimental-strip-types src/lib/environment/production-guards.test.ts
```

Expected: failure because `production-guards.ts` does not exist.

- [x] **Step 3: Implement the guard**

Use URL parsing, normalized lowercase host comparison, and an explicit constant set. Never log usernames, passwords, query parameters, or full database URLs.

- [x] **Step 4: Write failing tests for loading the test environment**

Use a temporary directory containing controlled `.env.test.local`, `.env`, `.env.local` and `.env.staging` fixtures. Prove that local values override inherited values, production secrets are detected without being printed, missing `.env.test.local` fails, and no source file is modified.

- [x] **Step 5: Add the executable preflight**

`scripts/assert-safe-test-environment.mjs` must validate:

- `NEXT_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54621` or `http://localhost:54621`;
- `PLAYWRIGHT_BASE_URL` is loopback;
- `SUPABASE_SERVICE_ROLE_KEY` is not equal to any value loaded from `.env`, `.env.local`, or `.env.staging`;
- `RESEND_API_KEY`, payment credentials, and provider mutation credentials are absent in E2E.

Only print variable names and safe hostnames.

- [x] **Step 6: Wire Playwright and package scripts**

Load `.env.test.local` explicitly before evaluating `playwright.config.ts`, copy the validated values into `process.env`, and pass them through `webServer.env`; `next dev` must never fall back to the productive `.env.local`. Add the executable preflight before `test:e2e`. Do not retain `reuseExistingServer: true` in CI or local destructive suites.

- [x] **Step 7: Verify the guard**

Run the unit test, then intentionally provide each prohibited host and verify exit code `1`; provide loopback values and verify exit code `0`.

- [x] **Step 8: Review checkpoint**

Run `git diff --check` and inspect `git diff -- src/lib/environment scripts/assert-safe-test-environment.mjs playwright.config.ts package.json`. Do not stage or commit.

### Task 2: Initialize the local Supabase control plane

**Files:**
- Create: `supabase/config.toml` via `supabase init`
- Create: `supabase/.gitignore`
- Create: `.env.test.local.example`
- Create: `scripts/local-db/install-local-firewall-rules.ps1`
- Create: `scripts/local-db/assert-local-network-isolation.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: local API `http://127.0.0.1:54621`
- Produces: local PostgreSQL `postgresql://postgres:postgres@127.0.0.1:54622/postgres`
- Produces: local Studio on loopback only.

- [x] **Step 1: Confirm the repository is not linked**

Run `supabase projects list --output json` and verify every project reports `linked: false`. Abort if Crimson Crown is linked.

- [x] **Step 2: Initialize locally**

Run `supabase init` from the repository root. Inspect the generated config before starting Docker.

- [x] **Step 3: Add local-only exclusions**

Ignore `supabase/.temp/`, `.env.test.local`, local exports, SQL dumps, archives, CSV/JSON inventories, and `*.backup`. Add a comment stating that production-derived artifacts are prohibited inside the repository even when ignored.

- [x] **Step 4: Create the test environment template**

The example must contain only loopback URLs and empty key assignments. Add an adjacent instruction to populate `.env.test.local` from the local values emitted by `supabase status --output env`; no key may be copied into the example file.

- [x] **Step 5: Start and inspect the local stack**

Create the dedicated bridge `crimson-crown-local-loopback` with Docker's `com.docker.network.bridge.host_binding_ipv4=127.0.0.1` option and start with `supabase start --network-id crimson-crown-local-loopback`. On Windows, Supabase CLI 2.113.0 still publishes the selected ports on every host interface, so run `scripts/local-db/install-local-firewall-rules.ps1` manually from an Administrator PowerShell. The installer includes program-scoped rules for `com.docker.backend.exe`; port-only rules are retained for defense in depth but do not filter Docker Desktop's proxy path. Then run `scripts/local-db/assert-local-network-isolation.mjs`: every service must respond through `127.0.0.1`, the dedicated bridge must retain its loopback binding and IPv6-disabled option, and all four firewall rules must be enabled inbound TCP blocks for `54620-54629` with the expected non-loopback address ranges. A container-to-host probe is intentionally not treated as an external-firewall proof because Docker Desktop can route that path outside Windows Firewall's host-facing filter. Stop only project `crimson-crown`, preserving its volumes, whenever this assertion fails. No production-derived data may be restored before it passes.

- [x] **Step 6: Review checkpoint**

Run `supabase status`, `docker ps --filter name=supabase`, `git diff --check`, and `git status --short`. Confirm no dump or secret file is under the workspace.

### Task 3: Prepare the external artifact directory

**Files:**
- Create outside workspace: `C:\Users\mjper\AppData\Local\CrimsonCrown\supabase-mirror\`
- Create outside workspace: `raw\`, `sanitized\`, `manifests\`
- Create: `scripts/local-db/verify-artifact-location.mjs`
- Create: `scripts/local-db/prepare-artifact-location.mjs`

**Interfaces:**
- Consumes: optional environment variable `CRIMSON_LOCAL_ARTIFACT_ROOT`
- Produces: a validated absolute directory outside every Git worktree.

- [x] **Step 1: Write the location validation script**

Resolve the candidate with `path.win32.resolve()` and discover the Git worktree using `git rev-parse --show-toplevel`. Reject empty paths, the workspace, the Git worktree, descendants of either, `.git`, `C:\`, user home, and any relative path. Create the root first, resolve its physical path, and validate it again before creating children so a junction cannot redirect writes into Git.

- [x] **Step 2: Test rejected targets**

Verify rejection of the repository root, `supabase/`, `.git/`, `C:\`, an empty value, and a relative directory.

- [x] **Step 3: Create the approved directory tree**

Use `C:\Users\mjper\AppData\Local\CrimsonCrown\supabase-mirror` by default and create only `raw`, `sanitized`, and `manifests` after validation.

- [x] **Step 4: Restrict access and record capacity**

Restrict the directory to the current Windows user, SYSTEM, and the local Administrators group. The verified free capacity on 2026-08-14 is 617.86 GiB; still require at least twice the actual source backup size before restore.

- [x] **Step 5: Review checkpoint**

Confirm the resolved mirror root is outside the repo, the repository contains no backup extensions, and `git status --short` contains only intentional source/config changes.

### Task 4: Acquire the source without linking or writing

**Files:**
- External input option A: existing Supabase backup file supplied through `CRIMSON_BACKUP_PATH`
- External input option B: temporary connection supplied through process environment `CRIMSON_SOURCE_DB_URL`
- Create: `scripts/local-db/acquire-source.ps1`
- External output: `%CRIMSON_MIRROR_ROOT%\source\source.sha256`

**Interfaces:**
- Consumes exactly one of `CRIMSON_BACKUP_PATH` or `CRIMSON_SOURCE_DB_URL`.
- Produces immutable source artifacts and SHA-256 manifests outside the repository.

- [ ] **Step 1: Implement mutually exclusive source selection**

Abort when neither or both inputs are present. Never print either value. Validate that a DB URL host equals `db.djfqozfaqkqdoqeoqbzt.supabase.co` or its documented pooler host; validate that a backup is an existing regular file.

- [ ] **Step 2A: Use an existing backup when available**

Copy the backup to the external `source` directory, calculate SHA-256 before and after copy, and require hashes to match. Do not open the production database.

- [ ] **Step 2B: Use a logical dump only when no backup exists**

Run `supabase db dump --dry-run --db-url` first and inspect that the generated command is `pg_dump` only. Then create separate roles, schema, and data artifacts using `--role-only`, the default schema dump, and `--data-only --use-copy`. Schedule this read load outside the traffic peak.

- [ ] **Step 3: Verify artifacts**

Require non-zero files, stable SHA-256 hashes, and successful format inspection using `pg_restore --list` for custom backups or safe header inspection for SQL files. Do not print data rows.

- [ ] **Step 4: Confirm remote non-mutation evidence**

Record command names, start/end timestamps, source project ref, artifact hashes, and exit codes. The log must redact URLs and credentials and must contain no SQL mutation command.

- [ ] **Step 5: Review checkpoint**

Search the workspace for `*.sql`, `*.dump`, `*.backup`, `*.tar`, and production customer exports created during the task. The result must be empty outside pre-existing migration files.

### Task 5: Restore into an isolated raw local database

**Files:**
- External database: local raw restore inside Docker volumes
- Create: `scripts/local-db/restore-raw.ps1`

**Interfaces:**
- Consumes: verified source artifacts and hashes.
- Produces: a local-only database named `crimson_raw` that the application cannot access.

- [ ] **Step 1: Validate all endpoints before restore**

Require destination host `127.0.0.1`, destination port `54622`, database name `crimson_raw`, and absence of every production hostname/ref in destination variables.

- [ ] **Step 2: Restore atomically**

For SQL artifacts, use `psql --single-transaction --variable ON_ERROR_STOP=1`. For a physical Supabase backup, follow the CLI's matching Postgres image workflow and verify the image version before startup.

- [ ] **Step 3: Deny application access**

Do not put the `crimson_raw` connection in any `.env` file. Keep it available only to sanitization and inventory scripts.

- [ ] **Step 4: Verify structural integrity**

Compare counts of schemas, tables, views, routines, policies, constraints and non-system extensions against the source artifact inventory. Verify all foreign keys are valid.

- [ ] **Step 5: Review checkpoint**

Confirm Docker exposes database/API ports only on loopback and that the Next.js process is not running with production or raw database credentials.

### Task 6: Generate the schema and data-classification inventory

**Files:**
- Create: `scripts/local-db/inventory-schema.sql`
- Create: `scripts/local-db/export-inventory.ps1`
- External outputs: `%CRIMSON_MIRROR_ROOT%\inventory\schema-inventory.json`
- External outputs: `%CRIMSON_MIRROR_ROOT%\inventory\row-counts.json`
- External outputs: `%CRIMSON_MIRROR_ROOT%\inventory\classification-input.json`

**Interfaces:**
- Consumes: local `crimson_raw` only.
- Produces: names/types/constraints/policies/grants/functions and row counts, never row values.

- [ ] **Step 1: Inventory schema objects**

Query PostgreSQL catalogs for schemas, relations, columns, constraints, indexes, triggers, policies, functions, owners, grants and extensions. Include function definitions because authorization depends on their bodies.

- [ ] **Step 2: Inventory Supabase-specific objects**

Record Auth-related triggers/policies, Storage buckets and policies, Realtime publications, cron jobs and migration history without exporting secrets or object contents.

- [ ] **Step 3: Collect exact row counts locally**

Run count queries only against `crimson_raw`. Store table names and counts, not rows.

- [ ] **Step 4: Classify columns by name and type**

Mark candidates for `email`, `phone`, `address`, `name`, `notes`, `token`, `secret`, `password`, `document`, `proof`, `payment`, OAuth identity and provider IDs. Mark UUID/FK columns as preserve-by-default.

- [ ] **Step 5: Verify inventory safety**

Scan outputs for email-address, phone-number, JWT, API-key and URL patterns. Any match outside schema identifiers fails the task.

- [ ] **Step 6: Review checkpoint and next-plan gate**

Review the inventory and write the follow-up sanitization plan with exact tables and columns. Do not write or execute generic sanitization against unknown columns.

### Task 7: Final safety verification for acquisition phase

**Files:**
- Read-only verification of all files from Tasks 1-6.

**Interfaces:**
- Produces: evidence that the next sanitization phase can begin without production access.

- [ ] **Step 1: Verify Git and workspace boundaries**

Run `git status --short`, `git diff --check`, and a recursive backup/dump extension scan. Confirm no file is staged and no raw artifact is inside the workspace.

- [ ] **Step 2: Verify project linkage**

Run `supabase projects list --output json` and confirm Crimson Crown remains `linked: false`.

- [ ] **Step 3: Verify environment separation**

Run the production-host guard against `.env`, `.env.local`, `.env.staging`, and `.env.test.local`. Production envs must be identified as prohibited for tests; the test env must pass as local.

- [ ] **Step 4: Verify no remote mutation command ran**

Inspect the redacted acquisition log. Allowed source operations are project listing, backup file copy, `pg_dump`, and read-only metadata queries. Any push, reset, migration, seed, SQL mutation, deploy or remote test fails the phase.

- [ ] **Step 5: Handoff**

Produce the exact table/column sanitization plan, admin-local creation plan and integrity assertions based on the inventory. Do not commit or push.
