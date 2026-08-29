# Crimson release projection: linked dry-run gate

This runbook is a fail-closed review gate for the Crimson production Supabase project `djfqozfaqkqdoqeoqbzt`. It never applies migrations. The wrapper creates a disposable projection, links only that projection, validates `migration list --linked` and `db push --linked --dry-run` against the materialized snapshot, prints only normalized reviewed outcomes, and then removes its exact temporary root.

## Prerequisites

- Use a clean, reviewed Git commit. Untracked or modified files block the wrapper.
- Keep `scripts/release/migration-manifest.json` complete and hash-valid. Every excluded `remote_applied` and `baseline_present` entry must have an independently reviewed schema-v2 `releaseProof`: either `verified_present` with a safe committed evidence anchor, or `forward_reconciled` with a safe anchor and reviewed newer `forward_pending` remediation versions.
- Complete and review the independent proof for every historical exclusion before invoking the real linked wrapper. Until then, the checked-in manifest intentionally keeps all historical proofs at `candidate` and blocks projection creation.
- Use the repository-local Supabase CLI pinned exactly to `2.113.0`. `npm run release:dry-run` resolves `node_modules/.bin/supabase.cmd` as a literal file; `-SupabaseCli` exists only for an explicit executable file, including the offline test double, and never bypasses the exact version check.

Run only after the prerequisites are satisfied:

```powershell
npm run release:dry-run
```

The only acceptable Supabase operation sequence is:

```text
supabase --version
supabase --workdir <temporary-projection> link --project-ref djfqozfaqkqdoqeoqbzt
supabase --workdir <temporary-projection> migration list --linked
supabase --workdir <temporary-projection> db push --linked --dry-run
```

The version output must be exactly one normalized line containing `2.113.0`, before `link`. The migration-list table must prove every projected remote marker is present on both sides and every approved forward is local-only, with no additional, duplicate, malformed, missing or reordered row. The dry-run output must then list the exact approved forward filenames once each in the same order. With zero approved forwards, both commands must instead prove no pending migration and the dry-run must explicitly report that the remote database is up to date.

There is no live-push mode or switch. A real apply requires a separate, explicitly reviewed procedure outside this gate.

## Blocking outcomes

Stop and preserve the reviewed inputs when any of these occurs:

- `LegacyDbPushMissingLocalError`;
- any historical `releaseProof.status: "candidate"`;
- a missing or foreign isolated linked ref;
- a dirty Git worktree;
- a changed or unreadable migration hash;
- a pending migration not present in the reviewed manifest;
- any missing, additional, duplicate, malformed or reordered migration-list row or dry-run filename;
- `up to date` while the manifest contains a non-empty `forward_pending` set, or a pending row/file while it contains none;
- a CLI version result other than the single normalized line `2.113.0`;
- a non-zero CLI exit or any command/ordering mismatch.

Do not repair migration history, retry with a live push, edit the temporary projection, or weaken the manifest to get past a blocker. Reconcile the manifest/evidence in a new reviewed commit and rerun the gate.

## Review evidence

The wrapper prints only normalized evidence. Evidence may record only:

- the exact command form (with the temporary path normalized or omitted);
- Supabase CLI version;
- Git SHA;
- reviewed local/remote migration names and versions;
- pass/fail conclusion for each blocking condition.

Never place passwords, tokens, environment dumps, credential-bearing URLs, SQL contents, database rows, or raw remote responses in committed evidence. Raw read-only evidence belongs only under ignored `local-artifacts/release-evidence/` and must be sanitized before any summary is committed.
