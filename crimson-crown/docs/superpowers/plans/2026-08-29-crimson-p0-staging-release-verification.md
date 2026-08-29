# Crimson Crown P0 Staging and Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete P0 sequence and its operational rollback on a dedicated Crimson staging branch, then produce a production review dossier and stop before any production change.

**Architecture:** A persistent Supabase development branch created from Crimson production provides the real hosted schema without production rows. Vercel Preview/Development point only to that branch and use synthetic fixtures with all external side effects disabled. Every application/migration/Storage phase is exercised in order, measured before/after and reversed operationally before the final clean rehearsal.

**Tech Stack:** Supabase Branching/CLI 2.113.0, Vercel Preview, Next.js 16, Playwright, Node 24, PostgreSQL 17, PowerShell.

**Spec:** `docs/superpowers/specs/2026-08-29-crimson-crown-emergency-hardening-design.md`

## Global Constraints

- Staging belongs only to Crimson Crown production project `djfqozfaqkqdoqeoqbzt`.
- Never use El Perchero/Che Maracucho projects, data, credentials or environments.
- Obtain organization-specific branch cost and explicit confirmation before creation.
- A Supabase branch starts without production data; seed only synthetic `.example.test` users and fake business records.
- Preview/Development must not send email, cron, webhooks or commercial integrations.
- Production Vercel variables, production database, Auth, Storage and deployments remain unchanged.
- Stop after the production review dossier; the next command capable of production mutation requires a new manual approval.

---

## File map

- Create `scripts/staging/assert-crimson-staging.mjs` and `.test.mjs`: exact parent/ref/side-effect guard.
- Create `scripts/staging/seed-crimson-staging.mjs` and `.test.mjs`: idempotent synthetic seed/cleanup.
- Create `scripts/staging/snapshot-crimson-schema.sql`: catalog, grants, policies, buckets and count-only snapshot.
- Create `scripts/staging/run-p0-rehearsal.ps1` and `.test.mjs`: ordered staging-only orchestration.
- Create `playwright.staging.config.ts`: staging URL with side-effect guard and one worker.
- Create `e2e/staging/p0-smoke.spec.ts`: admin/catalog/checkout/profile/import/commission proof smoke.
- Create `docs/runbooks/crimson-staging.md`: creation, variables, seed, pause/delete and incident boundaries.
- Create `docs/releases/crimson-p0-production-review.md`: final reviewed artifacts and exact release order.
- Modify `package.json`: staging guard/seed/smoke commands.

### Task 1: Cost and dedicated Crimson branch checkpoint

**Files:**
- Create: `docs/runbooks/crimson-staging.md`

**Interfaces:**
- Produces: branch ref stored only in environment managers, never hardcoded as a foreign reusable target.

- [ ] **Step 1: Resolve the Supabase organization read-only**

Call `list_organizations`, identify the organization that owns project `djfqozfaqkqdoqeoqbzt`, and show its name/id to the user. Do not infer the organization from another project.

- [ ] **Step 2: Obtain the exact recurring branch cost**

Call `get_cost` with that organization ID and `type: branch`. Report amount and recurrence exactly as returned.

- [ ] **Step 3: Obtain cost confirmation**

Only after the user accepts the stated cost, call `confirm_cost` with the exact amount/recurrence. Keep the returned confirmation ID for one creation attempt.

- [ ] **Step 4: Create the branch**

Call `create_branch` with parent project `djfqozfaqkqdoqeoqbzt` and name `crimson-p0-staging`. Do not create a standalone project and do not branch El Perchero.

- [ ] **Step 5: Wait for healthy and record non-secret identity**

Poll branch state with backoff until healthy. Record parent project, branch ID/ref, region and creation date in the runbook. Do not record keys or database passwords.

- [ ] **Step 6: Commit the runbook checkpoint**

```bash
git add docs/runbooks/crimson-staging.md
git commit -m "docs: register dedicated crimson staging"
```

### Task 2: Staging identity and side-effect guard

**Files:**
- Create: `scripts/staging/assert-crimson-staging.mjs`
- Create: `scripts/staging/assert-crimson-staging.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `assertCrimsonStagingEnvironment(env) -> { projectRef, appOrigin }`.

- [ ] **Step 1: Write failing table-driven tests**

```js
assert.doesNotThrow(() => assertCrimsonStagingEnvironment({
  NEXT_PUBLIC_SUPABASE_URL: 'https://crimsonstage12345678.supabase.co',
  CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'crimsonstage12345678',
  NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'crimsonstage12345678',
  NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
  PLAYWRIGHT_BASE_URL: 'https://crimson-preview.vercel.app',
  DISABLE_EXTERNAL_SIDE_EFFECTS: 'true',
}))

for (const ref of ['djfqozfaqkqdoqeoqbzt','jzkxvgntwompkntimrao','tszglqwrklthnzhqdffn','shwqihiueeuqeumdoepn']) {
  assert.throws(() => assertCrimsonStagingEnvironment(stagingEnvFor(ref)))
}
```

Also reject any configured Resend, Mercado Pago, webhook or production base URL variable and assert errors do not echo values.

- [ ] **Step 2: Confirm RED**

Run `node --test scripts/staging/assert-crimson-staging.test.mjs`.

- [ ] **Step 3: Implement using the shared environment policy**

Require exact URL ref equality, `NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET=staging`, `DISABLE_EXTERNAL_SIDE_EFFECTS=true`, `.example.test` synthetic email domain, and non-production app origin. Export function and executable CLI mode.

- [ ] **Step 4: Verify and commit**

```bash
git add package.json scripts/staging/assert-crimson-staging.mjs scripts/staging/assert-crimson-staging.test.mjs
git commit -m "test: guard crimson staging side effects"
```

### Task 3: Idempotent synthetic staging seed

**Files:**
- Create: `scripts/staging/seed-crimson-staging.mjs`
- Create: `scripts/staging/seed-crimson-staging.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 guard and server-only staging service key.
- Produces: deterministic fixture IDs tagged `codex-staging-p0` and cleanup mode.

- [ ] **Step 1: Write failing seed-plan tests**

Test a pure `buildSeedPlan()`:

```js
const plan = buildSeedPlan()
assert.deepEqual(plan.users.map((user) => user.email), [
  'admin.crimson.staging@example.test',
  'buyer.crimson.staging@example.test',
  'operator.crimson.staging@example.test',
])
assert.ok(plan.rows.every((row) => row.fixture_key.startsWith('codex-staging-p0:')))
assert.equal(JSON.stringify(plan).includes('mjperchezabala@gmail.com'), false)
```

Assert repeat seed uses upsert by fixture key and cleanup targets only exact fixture IDs.

- [ ] **Step 2: Confirm RED**

Run `node --test scripts/staging/seed-crimson-staging.test.mjs`.

- [ ] **Step 3: Implement guarded seed/cleanup**

Before creating a client, call `assertCrimsonStagingEnvironment`. Create three Auth users, profiles, one active inventory, products, one stock order, one import order, one commission period/payment and small synthetic Storage objects. Use fixed UUIDs where schema permits and record generated bigint import ID in an ignored evidence file. `--cleanup` deletes only objects/rows/users whose exact fixture key/email matches the plan.

- [ ] **Step 4: Run dry plan locally, then seed staging once**

`--plan` prints entity types/counts only. After review, run seed against the branch. Run it twice and verify row/object counts do not increase.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/staging/seed-crimson-staging.mjs scripts/staging/seed-crimson-staging.test.mjs
git commit -m "test: add idempotent crimson staging fixtures"
```

### Task 4: Configure Vercel Preview and Development only

**Files:**
- Modify: `docs/runbooks/crimson-staging.md`

**Interfaces:**
- Consumes: staging ref, project URL, publishable/anon key, service key.
- Produces: Preview/Development deployment isolated from Production.

- [ ] **Step 1: Snapshot variable names/scopes without values**

Record whether each of these exists in Production, Preview and Development: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRIMSON_STAGING_SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET`, `DISABLE_EXTERNAL_SIDE_EFFECTS`, `NEXT_PUBLIC_BASE_URL`.

- [ ] **Step 2: Set only Preview/Development variables**

- URL/keys point to the new Crimson branch.
- server and public staging refs both equal the branch ref; the guard verifies their equality.
- target is `staging`.
- external side effects is `true`.
- base URL is the preview origin, never `crimsoncrownimports.com`.
- omit Resend, Mercado Pago and webhook secrets.

Do not edit Production scopes.

- [ ] **Step 3: Verify scopes read-only**

List variables again without values and assert the scope matrix. Run the deployment gate with the same non-secret identities.

- [ ] **Step 4: Commit runbook scope evidence**

```bash
git add docs/runbooks/crimson-staging.md
git commit -m "docs: isolate crimson preview variables"
```

### Task 5: Ordered migration and Storage rehearsal

**Files:**
- Create: `scripts/staging/snapshot-crimson-schema.sql`
- Create: `scripts/staging/run-p0-rehearsal.ps1`
- Create: `scripts/staging/run-p0-rehearsal.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: verified release projection and staging guard.
- Produces: before/after/rollback evidence with catalog and count-only snapshots.

- [ ] **Step 1: Write failing orchestration contract**

Assert the script order is exactly:

```js
assertOrdered(source, [
  'assert-crimson-staging.mjs',
  'snapshot-before',
  'db push --linked --dry-run',
  'db push --linked',
  'seed-crimson-staging.mjs',
  'test:privileged-surfaces',
  'test:local-storage',
  'snapshot-after',
  'rollback-verification',
])
```

The source must reject production/foreign refs and must not contain `migration repair`, `db reset` or destructive wildcard deletion.

- [ ] **Step 2: Implement count-only snapshot**

The SQL outputs migration versions, object signatures, `proconfig`, grants, policies, bucket public/limits/MIME and counts for affected tables/objects. It never selects emails, names, addresses, proof URLs/paths or object contents.

- [ ] **Step 3: Implement rehearsal wrapper**

The wrapper creates a temporary projection, links only that temp directory to the staging ref, runs dry-run, requires the expected pending set, then runs real `db push --linked` on staging only. It applies app/storage phases, seeds, verifies and captures snapshots. A typed `-ApplyToStaging` switch is mandatory; there is no production-ref override.

- [ ] **Step 4: Simulate operational rollback**

On staging only:

- restore previous public-read policy if proof resolver is unavailable;
- keep additive path columns and data;
- restore compatibility application version/config;
- do not drop columns, delete proof objects or revert migration history.

Verify old URL readers still work during the compatibility phase, then reapply the final code/policies and rerun the clean sequence.

- [ ] **Step 5: Run rehearsal and commit scripts/evidence schema**

Expected: all phases and rollback checks PASS; before/after counts differ only by synthetic fixtures and intentional schema objects.

```bash
git add package.json scripts/staging/snapshot-crimson-schema.sql scripts/staging/run-p0-rehearsal.ps1 scripts/staging/run-p0-rehearsal.test.mjs
git commit -m "test: rehearse crimson p0 release on staging"
```

### Task 6: Hosted Playwright smoke

**Files:**
- Create: `playwright.staging.config.ts`
- Create: `e2e/staging/p0-smoke.spec.ts`

**Interfaces:**
- Consumes: seeded staging and Preview URL.
- Produces: one-worker P0 hosted smoke with cleanup.

- [ ] **Step 1: Write the staging config**

Load a non-versioned `.env.staging.test`, call staging guard before exporting config, set `workers: 1`, `fullyParallel: false`, `retries: 0`, and never start a local web server.

- [ ] **Step 2: Write explicit smoke flows**

The test performs:

1. anonymous catalog/banner read and denied admin route;
2. buyer login and own profile/order visibility;
3. valid stock proof upload and verifying status;
4. own import proof upload; cross-user proof access denied;
5. admin product/banner upload, existing inventory preserved;
6. commission operator upload and owner/admin signed read;
7. direct Storage upload attempt denied;
8. signed proof URL expires contractually at five minutes and is never stored in row data.

Use only `@example.test` fixtures and clean transient objects/rows in `afterAll`.

- [ ] **Step 3: Run twice**

Run `playwright test --config playwright.staging.config.ts` twice. Expected: both PASS, proving idempotent fixtures and no leaked state.

- [ ] **Step 4: Commit**

```bash
git add playwright.staging.config.ts e2e/staging/p0-smoke.spec.ts
git commit -m "test: verify p0 flows on crimson staging"
```

### Task 7: Production review dossier and mandatory stop

**Files:**
- Create: `docs/releases/crimson-p0-production-review.md`
- Modify: `docs/crimson-crown-backlog.md`

**Interfaces:**
- Produces: human-reviewable release batch; executes no production command.

- [ ] **Step 1: Record immutable identities**

Document branch Git SHA, migration filenames/hashes, staging ref/preview deployment ID, Supabase CLI version, Node version and test result counts. Do not include keys or connection strings.

- [ ] **Step 2: Attach expected production changes**

List exact forward migrations, Storage policy/bucket changes, Vercel Production variable changes (if any), application commits and SQL verification queries. Include expected advisor delta and tables guaranteed unchanged.

- [ ] **Step 3: Add backup and rollback checklist**

Require a fresh recoverable production backup, current row/object counts, migration list, deployment rollback target and the compatibility-first Storage rollback. Do not execute backup, deploy or migration yet.

- [ ] **Step 4: Run final local/staging gate**

Run environment, manifest, privileged, Storage, financial, inventory, E2E, TypeScript, build and lint commands. Rerun hosted smoke once. Capture summaries.

- [ ] **Step 5: Verify clean worktree and stop**

`git status --short` must be empty after committing the dossier/backlog. Do not run `git push`, Vercel deploy/promote, Production env edits, Supabase production SQL, `db push` without `--dry-run`, or Storage changes.

```bash
git add docs/releases/crimson-p0-production-review.md docs/crimson-crown-backlog.md
git commit -m "docs: prepare crimson p0 production review"
```

## Plan completion gate

- Dedicated Crimson branch exists with accepted cost and no production rows.
- Preview/Development use only staging and all side effects are disabled.
- Migration, Postgres and Storage phases plus operational rollback pass in hosted staging.
- Hosted smoke passes twice using synthetic data.
- Production dossier is complete and the branch is clean.
- No production variable, database, Storage object/policy or deployment has changed.
