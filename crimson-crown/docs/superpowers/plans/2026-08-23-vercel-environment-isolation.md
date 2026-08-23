# Vercel Environment Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Vercel Preview and Development deployments from using Crimson Crown's production Supabase project when the provider shares production credentials across environments.

**Architecture:** Add a runtime guard that allows a production Supabase URL only when `VERCEL_ENV=production`; all other runtimes must pass the existing non-production URL rules. Execute the guard in the request proxy before any Supabase client is created, returning a closed 503 response for unsafe Preview/Development configuration. Unit tests cover production, preview, local loopback, and missing environment metadata.

**Tech Stack:** Next.js proxy, TypeScript, Node test runner, Vercel environment metadata.

**Spec:** `docs/crimson-crown-backlog.md` production gates and the Vercel preflight findings recorded in this checkpoint.

## Global Constraints

- Never change Vercel variables, Supabase linkage, deployments, aliases, or remote data in this lot.
- Production Supabase is allowed only when `VERCEL_ENV=production`.
- Preview, Development, local development, and unknown deployment metadata must reject Crimson Crown's production Supabase URL.
- Local loopback Supabase remains valid in every non-production runtime.
- The guard must not print credentials, URLs containing secrets, or raw environment values.

---

### Task 1: Add failing guard tests

**Files:**
- Modify: `src/lib/environment/production-guards.test.ts`

**Interfaces:**
- Test function: `assertSafeRuntimeSupabaseUrl(rawUrl, env)`.

- [x] **Step 1: Add the production allow case**

Assert that the known production Supabase URL is accepted only with `{ VERCEL_ENV: 'production' }`.

- [x] **Step 2: Add the blocked non-production cases**

Assert that the same URL throws for `{ VERCEL_ENV: 'preview' }`, `{ VERCEL_ENV: 'development' }`, and no deployment metadata.

- [x] **Step 3: Add the loopback case**

Assert that `http://127.0.0.1:54621` remains accepted with Preview and Development metadata.

- [x] **Step 4: Run the focused test red**

Run the production guard test and expect failure because the new function is not implemented.

### Task 2: Implement fail-closed runtime protection

**Files:**
- Modify: `src/lib/environment/production-guards.ts`
- Modify: `src/proxy.ts`

**Interfaces:**
- `assertSafeRuntimeSupabaseUrl(rawUrl: string, env?: Environment): URL`.

- [x] **Step 1: Implement the runtime guard**

Parse the URL, allow production destinations only for `VERCEL_ENV.trim().toLowerCase() === 'production'`, and otherwise delegate to `assertNonProductionUrl`.

- [x] **Step 2: Guard the proxy before client construction**

Validate `NEXT_PUBLIC_SUPABASE_URL` before `createServerClient`. On `UnsafeEnvironmentError`, log only the safe error name and return HTTP 503 with `{ error: 'Entorno no disponible para este deployment.' }`; never include the URL or secret.

- [x] **Step 3: Preserve auth callback behavior**

Keep `/auth/callback` and `/auth/update-password` bypass behavior unchanged so a valid production deployment can complete auth redirects.

- [x] **Step 4: Run the focused tests green**

Run the production guard test and the proxy contract test. Verify local development still accepts loopback.

### Task 3: Verify the application boundary

**Files:**
- Create: `scripts/assert-vercel-environment-safety.test.mjs`
- Modify: `package.json`

- [x] **Step 1: Add the source contract**

Assert that `src/proxy.ts` imports and calls `assertSafeRuntimeSupabaseUrl` before the `createServerClient` call and returns the generic 503 message.

- [x] **Step 2: Add the package test entry**

Include the contract test in `test:environment-safety`.

- [x] **Step 3: Run the complete local gate**

Run environment tests, security/Storage/financial/atomic/release matrices, full Playwright, Supabase lint, and the loopback build. No Vercel or Supabase remote mutation is allowed.

### Task 4: Document and checkpoint

**Files:**
- Modify: `docs/crimson-crown-backlog.md`
- Modify: this plan

- [x] **Step 1: Record the Vercel finding**

Document the exact Vercel project ID, production domains, production deployment commit, and that Preview/Development currently share production Supabase variables.

- [x] **Step 2: Document the new gate**

State that Preview/Development are now expected to fail closed until a non-production Supabase project is configured; do not test those deployments against production.

- [ ] **Step 3: Stop before promotion**

Commit/push only the feature branch. A production promotion still requires migration sequencing, Storage audit, provider webhook design, and owner review of the exact release tuple.
