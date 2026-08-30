# Crimson production reconciliation evidence — 2026-08-30

## Decision

The historical exclusions are approved for the unchanged linked dry-run gate. Five remote ledger entries are proven directly, two baseline effects are proven directly, and the remaining fourteen baseline effects are reconciled by reviewed forward-only migrations. This decision authorizes projection and dry-run review only; production application still requires a fresh backup, unchanged aggregate snapshots, staging PASS, and exact project identity.

## Scope and safety

- Production project: `djfqozfaqkqdoqeoqbzt`
- Production status during capture: `ACTIVE_HEALTHY`
- Capture date: `2026-08-30` (`America/Buenos_Aires` release session)
- Remote access used for this evidence: migration ledger, `pg_catalog`, `information_schema`, policies, and aggregate hashes only.
- No email, address, proof path, object name, credential, URL, function body, or business-row payload is stored in this document.
- No DDL, DML, migration-history change, Storage change, or Vercel change was executed while capturing production evidence.
- Reconciliation source SHA-256: `feff9a68c4bd35d7eb04e30c85b980b7e7b5863e0706570651a1ca8647e511de`
- Preflight SQL SHA-256: `c7cb7b48784f84de6b2e88127a80fcbf478925ef3dfc37e22a7f0f38ecc0cfc1`
- Production preflight snapshot SHA-256: `f382221be974901c926c2647dd9c1f9bcc6d7c0b50b4b7c26988af729139edd0`
- Final Storage source SHA-256: `6bb0c423b230c3eb6bfb27de3d57e73a784676d76f3e070d7106d2ae0fe0189a`
- Production ledger count before release: `5`
- Production ledger SHA-256 before release: `56f92391ced767f31df5deb3f2e466ccd3bed1d27bd25fc369925c7696d1ca8d`
- Production catalog SHA-256 before release: `e3fad7886527c2bed4ba19938a1b62d549c77bae78858ff1d5fcbd10af78f19e`
- Retained pre-start commission periods: `9`
- Exposed legacy search RPC count: `0`
- Staging final ledger: `19` entries; exact transactional rehearsal `20260830043020 / reconcile_legacy_schema_safely_transactional / ba28412950740ca5ae53020f46fd2d4310d9db4857e1ce35a13ff90077aa3f4a`.
- Staging verify-only result: three identical snapshots and `remoteMutations: 0` after the transactional rehearsal.
- Independent read-only re-audit: release GO, no P0/P1/P2 findings, 32/32 migration hashes matched.
- Final local gates: release `136` PASS + `1` host-capability skip; environment `50/50`; serialized database contracts `37/37`; seven transactional matrices PASS; Storage `27` direct-write denials with `0` residual objects; Next.js production build and TypeScript PASS across `44` routes.

The final reconciliation source contains explicit `BEGIN/COMMIT`. Its local contract executed that exact source against the production mirror and proved identical full-row aggregate hashes before and after. The same Supabase migration endpoint used for release was given a failing transaction in staging; both its test relation and migration-ledger entry remained absent, proving rollback. The exact final source was then applied idempotently to staging. The contract also proved that the commission guard remains unvalidated, the nine historical periods remain present, `external_prices.color_identity` remains JSONB, and the retired search RPCs remain absent.

| Protected aggregate | Count | SHA-256 before release |
| --- | ---: | --- |
| Orders | 63 | `daa7d266442a9ef4a292a9fb2d073c8fe71ff8911390cfa9683d1b7417b44a1f` |
| Profiles | 81 | `517022d541e346534174dd835bcb2f0b2111513be12978aa783ccad5be601183` |
| Products | 1954 | `b47ebf2706f9e9d8cd77c7645d1565269f1c7b6af246ba1d354ea9853a46b0a0` |
| Inventory movements | 2 | `0058705a5bcc1ee52eaad2af2639249560d86281a0ca4a16e247a77408bcd23f` |

The reproducible preflight returned 15 runtime signatures (`6c575fe7acdeb54f6dbfb51b31d33fb5e86527ae20e74e9e8d821d409694f92c`), 11 inventory constraints (`132f33485ef6f2fb0c50571f5b808f3adf08a31da0fc96bfa58edef945ac70fc`), 7 valid/ready inventory indexes (`636c0cbba2d7ce07bb282e43a8b13c3463687b9bac11633a7807776cbe303e15`), 3 inventory policies (`376b3b7f955733d57d17dc30d2987ddd2e782792c0536694f695d5ff44a0df33`), and the inventory defaults hash `9f90e8a5df6cf8172208ae1214ee1289b362d4af9574ce08b2568c10dac295f2`. Its invariant counts are one primary inventory and zero null product inventory IDs, blank variant keys, null order-item inventory IDs, duplicate movement reference keys, and legacy search RPCs.

## remote-20260826210617

**PASS**

The production ledger contains `production_runtime_functions`, and its stored statement matched `20260826120000_production_runtime_functions.sql` under the previously reviewed normalization. The reproducible current-runtime catalog proof is included in the 15-signature hash `6c575fe7acdeb54f6dbfb51b31d33fb5e86527ae20e74e9e8d821d409694f92c`; it covers body hash, security mode, `proconfig`, and effective API-role execution for every signature without exposing function bodies. Current runtime authorization and concurrency behavior passed the local security, financial, checkout, and authenticated-definer matrices. The reconciliation forward reasserts fixed search paths and least-privilege grants without replacing current function bodies.

## remote-20260826210725

**PASS**

The production ledger contains `revoke_is_admin_anon`. Current catalog evidence confirms `is_admin()` has a fixed search path and no effective `PUBLIC` or `anon` execution path; the authenticated standard/admin matrix proves the authorization boundary.

## remote-20260827051550

**PASS**

The production ledger contains `create_multi_inventory_system`. The reproducible preflight proves 11 current constraints, 7 expected valid/ready indexes, 3 policies and their exact section hashes recorded above. It also proves one primary inventory, no null product/order inventory snapshots, no blank variant keys, and no duplicate movement reference keys. This fresh capture supersedes the strict-text FAIL recorded on 2026-08-29: semantic constraints and the named admin movement policy are now present and independently hashed.

## remote-20260827051604

**PASS**

The production ledger contains `multi_inventory_runtime_functions`. Its current signatures are part of the 15-function catalog proof hash `6c575fe7acdeb54f6dbfb51b31d33fb5e86527ae20e74e9e8d821d409694f92c`. The complete multi-inventory runtime matrix proves hybrid checkout, primary priority, exact source restoration, manual pricing by selected inventory, and partial-line restoration. Current bodies remain in place; the reconciliation forward changes only search paths and grants.

## remote-20260827051615

**PASS**

The production ledger contains `add_external_prices_name_search_index`. `pg_trgm` and the valid GIN `external_prices_name_trgm_idx` remain present in the fresh catalog snapshot.

## baseline-20231218

**PASS**

The historical columns exist. Forward `20260829235800` restores the nullable-free `products.tcg` default to `Magic` without updating existing products and preserves current metadata, image, and etched-price columns.

## baseline-20240701000000

**PASS**

Repository and database searches prove no consumer for the legacy search RPCs. Their old import return shape is incompatible with the current bigint import-order schema. Forward `20260829235800` explicitly keeps all three RPCs retired, avoiding an obsolete authenticated Data API surface and any extension installation.

## baseline-202606100001

**PASS**

Production contains nine commission periods before June 2026. Forward `20260829235800` deliberately preserves them and adds `commission_periods_start_period_chk` as `NOT VALID`: historical rows remain untouched while future inserts and updates must satisfy the start boundary. No backup/delete replay is performed.

## baseline-202606100002

**PASS**

All catalog-support columns and indexes are present. JSONB is the application-compatible canonical type for `external_prices.color_identity`; forward `20260829235800` fails closed unless that type is JSONB, records the canonical contract, and never converts or rewrites the column.

## baseline-20260615000300

**PASS**

The validated `created_by_admin_id` foreign key is semantically present. Forward `20260829235800` adds only the missing nullable `manual_quote_notes` text column, with no default and no table-row rewrite.

## baseline-20260823043500

**PASS**

Current production runtime functions satisfy the authorization and atomicity behavior asserted by the local matrices. Forward `20260829235800` reasserts fixed search paths and exact Data API execution roles without replacing bodies or executing business operations.

## baseline-20260823043637

**PASS**

Forward `20260829183155` closes the privileged view/function search-path and execution surfaces. Forward `20260829235800` closes the remaining external-price, price-history, backup-table, and import-policy gaps. The 50-test environment gate plus the 18-test privileged-surface gate prove the resulting boundary.

## baseline-20260823044210

**PASS**

Forward `20260829183155` fixes `merge_duplicate_products(integer)` to a fixed search path and service-role-only execution. Its operational body is not invoked by either migration.

## baseline-20260823044710

**PASS**

Forward `20260829235800` reasserts the fixed search path and authenticated/service-role grants for `decrement_stock(integer,uuid)`. The financial matrix proves the admin/service guard and nonnegative atomic stock behavior without changing production rows during migration.

## baseline-20260823044936

**PASS**

Forward `20260829235800` reasserts the fixed search path and authenticated/service-role grants for `manage_credits(uuid,numeric,text,text,uuid)`. The financial and checkout matrices prove no overdraft and full rollback on failure.

## baseline-20260823050711

**PASS**

Forward `20260829183155` restricts trigger-only and privileged helper execution. Forward `20260829235800` removes the unrestricted external-price policy, browser price-history writes, backup-table access, and legacy import-admin policies while retaining public catalog reads and authenticated admin workflows.

## baseline-20260823051113

**PASS**

Fresh catalog evidence and the authenticated admin matrix prove the production administrator allowlist, fixed search path, and restricted execution behavior remain present.

## baseline-20260823140924

**PASS**

Fresh catalog evidence and the import authorization matrix prove the append-note RPC remains owner-scoped, fixed-search-path, and restricted to the intended authenticated/service roles.

## baseline-20260823142117

**PASS**

Forward `20260829235800` replaces both legacy public-role import admin policies with `authenticated` policies that delegate to the central allowlist-aware `is_admin()` helper. Owner read/create policies remain unchanged.

## baseline-20260823173257

**PASS**

The current multi-inventory `place_order_atomic` behavior passed rollback, credits, stock-source, invalid-item, anonymous-denial, and successful-credit-checkout matrices. Forward `20260829235800` reasserts its fixed search path and authenticated/service-role grant without replacing the body.

## baseline-20260823183638

**PASS**

The current `release_expired_orders_atomic` behavior passed idempotent cancellation, exact stock restoration, and anonymous-denial matrices. Forward `20260829235800` reasserts its fixed search path and authenticated/service-role grant without invoking the function.

## Release order

The approved production projection contains the existing nine pre-Storage forwards, then `20260829235800_reconcile_legacy_schema_safely.sql`, and finally `20260829235900_harden_storage_buckets_and_policies.sql`. Storage remains the last mutation and is applied only after the compatible Vercel deployment is READY.
