# Crimson production migration equivalence evidence — 2026-08-29

## Decision

**Blocked.** The five stored production migration statements match the paired local files after the permitted normalization, but current production catalog signatures do not prove three of the five remote pairs and do not prove fourteen of the sixteen `baseline_present` entries. The release manifest therefore remains fail-closed with every remote pair at `equivalence: "candidate"`.

The real linked dry-run was not invoked. Running it would violate the Task 6 prerequisite that every pair and baseline exclusion be proven before the wrapper links a projection to production.

## Scope and safety boundary

- Production project: `djfqozfaqkqdoqeoqbzt` only.
- Remote access: `SELECT` only against `supabase_migrations`, `pg_catalog`, and `information_schema`.
- No business-row contents were queried. No row-count query was needed for the conclusions below.
- No migration history, schema, Storage object, Vercel setting, or deployment was changed.
- Full connector responses and statement text are stored only under ignored `local-artifacts/release-evidence/`.
- This document contains normalized hashes and catalog signatures only; it does not contain remote SQL bodies, credentials, URLs, environment values, or business data.

Statement normalization converts CRLF/CR to LF, removes trailing horizontal whitespace per line, trims outer whitespace, and removes trailing statement terminators. No internal SQL whitespace, token, identifier, or literal is changed.

## Evidence anchors

The anchors below hash canonical JSON with recursively sorted object keys and deterministically sorted catalog rows.

The independently auditable [per-object evidence matrix](./crimson-migration-object-matrix-2026-08-29.json) records 160 object decisions underpinning all five remote pairs and all sixteen `baseline_present` results. Each row carries explicit expected and observed presence, an exact ordered signature, the ordered fields asserted by that decision, mismatched fields, and reciprocal source links. The matrix documents its canonical field and array ordering; it uses SHA-256 instead of plaintext for bodies, expressions, defaults, comments, and constraint definitions. Expressions, defaults, and constraint definitions are hashed after line-ending normalization and outer trim only; internal whitespace, case, qualification, casts, grouping, parentheses, and literal text are preserved. The matrix contains 66 PASS and 94 FAIL object decisions. Its committed byte-level SHA-256 is `5d504fa96958ac335cd890a59772318045af3f3b9224797e9978191647508ef4`.

| Evidence set | Rows | SHA-256 |
| --- | ---: | --- |
| Five normalized statement comparisons | 5 | `3e528e1841ad4c34e5881766eeab4f446e9669e66347b1b3faa965f7084e3cb7` |
| Function signatures, `proconfig`, effective ACL, and normalized body hashes | 34 | `c9a0c503fcc3b84429e813d46f4468f42f6eea681f90772d2c10aa6b69c4e1a9` |
| Relations | 26 | `cd7097ba148d423dad5ffa5daf0e79ec436eafab530199e4d09a7466e8a9f1f3` |
| Columns | 261 | `f0f5d77ee6deff6ea19d2c797b36bd23ab1d764a1f2bff0d012a113d5126d88f` |
| Constraints | 59 | `9be9c59f4356049e232f756b0c61c9c631951051f91d6ebca97d0e274fd9785e` |
| Indexes | 13 | `570b671994ae66944c65d8dc6e33ca28d9f4a5aa586d8d8d1f0161986617e818` |
| Policies | 75 | `f1d5019898ee8201a5f08edb19497d9be472e8a6f12ea0ad59f8292134df64d0` |
| Extensions | 1 | `bf387146aa867ee432e60c456c6521fc6dcd6ca285cb48f3dc391b2fc053e2bf` |
| Triggers | 1 | `069918837a4b437633dc6eed102fb7a395f660742e2e9e603867321b56b28680` |
| Backup-table schema comparisons | 5 | `f7fbc07fc91ef1ecccb057a95e109dc297ebe359be6a65521ef145614aca264b` |

## Remote/local pair results

### 20260826210617

- Remote name: `production_runtime_functions`
- Local file: `20260826120000_production_runtime_functions.sql`
- Normalized statement SHA-256, remote and local: `ecfc3c881489f7c29fa063609f0c527a740253080a5c51def643b6284cbf5062`
- Statement comparison: **PASS**.
- Current object comparison: **FAIL**. Normalized current production body hashes differ from the latest local definitions for `approve_buylist_transaction`, `decrement_stock`, `manage_credits`, `submit_order_payment_proof`, `transfer_credits`, `update_profile_details`, and `user_accept_buylist_offer`. The later `place_order_atomic` and `release_expired_orders_atomic` definitions also fail their final-pair comparison below.
- Manifest decision: remain `candidate`.

### 20260826210725

- Remote name: `revoke_is_admin_anon`
- Local file: `20260826121500_revoke_is_admin_anon.sql`
- Normalized statement SHA-256, remote and local: `60fa8097804a049b9442cd513cae2415c50785fc35009e00cb3cf94c24fbc9dd`
- Statement comparison: **PASS**.
- Current object comparison: **PASS at pair level**. `is_admin()` has no effective `PUBLIC` or `anon` execute grant; execute remains for `authenticated`, `service_role`, and the owner. Its normalized body matches the local final definition.
- Manifest decision: remain `candidate` as the global fail-closed latch because baseline exclusions are not represented by a verifiable state in manifest schema version 1.

### 20260827051550

- Remote name: `create_multi_inventory_system`
- Local file: `20260827020755_create_multi_inventory_system.sql`
- Normalized statement SHA-256, remote and local: `57756338624838ea95522141caef6d29597a6adc06d0f23edf4ad80a7bad8fec`
- Statement comparison: **PASS**.
- Current object comparison: **FAIL**. Both relations, every expected column name, all seven named indexes, the trigger, table grants, and all six function bodies are present. Exact-text signatures nevertheless differ for the `inventories.kind` default, three indexes (`inventories_active_name_idx`, `inventories_one_primary_idx`, and `inventory_stock_movements_inventory_idx`), the two present inventory policies, and six present constraint definitions. Policy `Admins read inventory movements` is absent. Five expected named foreign-key/check constraints and `inventory_stock_movements_idempotency_unique` are also absent; an alternate unique constraint named `inventory_stock_movements_idempotency` is present and recorded as a distinct catalog signature rather than treated as equivalent.
- Manifest decision: remain `candidate`.

### 20260827051604

- Remote name: `multi_inventory_runtime_functions`
- Local file: `20260827020830_multi_inventory_runtime_functions.sql`
- Normalized statement SHA-256, remote and local: `fa1a11a4eb0d9cff38c26189e40735048df900788cfdfdee8dbfa6d5f9b0bfab`
- Statement comparison: **PASS**.
- Current object comparison: **FAIL**. Function grants remain restricted to the expected API roles, and `restore_stock` plus `get_inventory_metrics` match. Normalized bodies differ for `place_order_atomic`, `restore_order_inventory_atomic`, `cancel_order_atomic`, `refund_order_atomic`, `remove_order_item_atomic`, and `release_expired_orders_atomic`.
- Manifest decision: remain `candidate`.

### 20260827051615

- Remote name: `add_external_prices_name_search_index`
- Local file: `20260827024000_add_external_prices_name_search_index.sql`
- Normalized statement SHA-256, remote and local: `3c74158e185d773504c3d436b85a5cab89aa41ab7a59ca4f8cf12e8737e5645d`
- Statement comparison: **PASS**.
- Current object comparison: **PASS at pair level**. `pg_trgm` is installed and `external_prices_name_trgm_idx` is valid, ready, non-unique, and uses GIN over `name gin_trgm_ops`.
- Manifest decision: remain `candidate` as the global fail-closed latch because baseline exclusions are not represented by a verifiable state in manifest schema version 1.

## `baseline_present` results

The catalog check is deliberately signature-sensitive. Mere name presence is not treated as proof when a type, default, function body, policy, grant, `proconfig`, or constraint differs.

| Local migration | Result | Catalog evidence |
| --- | --- | --- |
| `20231218_add_tcg_columns.sql` | **FAIL** | All four column names exist, but `products.tcg` does not have the local default signature. |
| `20240701000000_search_functions.sql` | **FAIL** | Extension `unaccent` and functions `normalize_text`, `search_orders_v2`, and `search_imports_v2` are absent. |
| `202606100001_commission_start_guard.sql` | **FAIL** | All five named backup relations and `commission_periods_start_period_chk` are absent. No historical delete/copy effect was inferred or queried. |
| `202606100002_add_external_prices_catalog_support.sql` | **FAIL** | All column and index names exist, but at least `external_prices.color_identity` has a different type/default signature from the local definition. |
| `20260615000300_add_admin_manual_buylist_quotes.sql` | **FAIL** | Both columns and exact comments are present, but the exact authored FK clause and current `pg_get_constraintdef` text hash differently. No syntax normalization is used to infer semantic equivalence. |
| `20260823043500_production_compatibility_baseline.sql` | **FAIL** | Later definitions supersede this file and current `decrement_stock` does not match the final local definition, so supersession cannot be proven safe as a set. |
| `20260823043637_local_security_baseline.sql` | **FAIL** | Expected policies are absent; several function `proconfig`/ACL signatures remain open or unset, and `admin_users` still exposes effective API-role privileges. |
| `20260823044210_fix_merge_duplicate_products_lint.sql` | **FAIL** | `merge_duplicate_products` body and execute ACL differ from the local definition. |
| `20260823044710_restrict_decrement_stock_rpc.sql` | **FAIL** | Current `decrement_stock` body hash differs from the final local definition. |
| `20260823044936_restrict_user_credit_adjustments.sql` | **FAIL** | Current `manage_credits` body hash differs from the final local definition. |
| `20260823050711_local_write_surface_hardening.sql` | **FAIL** | The expected external-price policy and table/function revocations are not present in effective ACLs. |
| `20260823051113_preserve_production_admin_allowlist.sql` | **PASS** | Final `is_admin()` body, fixed `search_path`, and restricted execute ACL match. |
| `20260823140924_append_import_order_user_note.sql` | **PASS** | Final function body, fixed `search_path`, security mode, and execute ACL match. |
| `20260823142117_normalize_import_admin_policies.sql` | **FAIL** | Both named import-admin policies are absent. |
| `20260823173257_create_place_order_atomic.sql` | **FAIL** | The function was superseded, but its final multi-inventory definition also differs from production. |
| `20260823183638_create_release_expired_orders_atomic.sql` | **FAIL** | The function was superseded, but its final multi-inventory definition also differs from production. |

Summary: 2 baseline entries pass and 14 fail.

## Forward-only remediation

Do not use `migration repair`, rename historical files, replay baseline SQL, or weaken the projection gate.

1. Extend the manifest format so every `baseline_present` entry has an explicit verification state and evidence anchor. A failed or missing baseline proof must block projection creation independently of remote-pair status.
2. Produce reviewed forward-only migrations for the runtime-function drift. Each migration must state the intended body hash, security mode, fixed `search_path`, and exact execute ACL; do not overwrite production functions until their consumers are tested.
3. Add the missing inventory-movement policy in a focused forward migration and reconcile the idempotency-constraint signature without dropping a working constraint or touching inventory rows.
4. Restore the search extension/functions, import/security policies, table/function revocations, and other missing hardening effects in domain-scoped forward migrations.
5. Treat the commission guard separately: do not replay the historical backup/delete statements. Design a reviewed, non-destructive forward guard and an explicit data-retention procedure.
6. Resolve column-signature drift explicitly rather than relying on `ADD COLUMN IF NOT EXISTS`; any type/default conversion requires its own compatibility and data-safety plan.

After those forward migrations exist and are verified in an exclusive Crimson staging project, repeat the same read-only catalog proof. Only then may all five manifest entries become `verified`, a clean evidence commit be created, and the exact linked dry-run wrapper be invoked from that commit.
