# Crimson release projection: linked dry-run gate

This runbook is a fail-closed review gate for the Crimson production Supabase project `djfqozfaqkqdoqeoqbzt`. It never applies migrations. The wrapper creates a disposable projection, links only that projection, prints `migration list --linked` and `db push --linked --dry-run`, and then removes its exact temporary root.

## Prerequisites

- Use a clean, reviewed Git commit. Untracked or modified files block the wrapper.
- Keep `scripts/release/migration-manifest.json` complete and hash-valid. Every `remote_applied` equivalence must be `verified`.
- Complete and review Task 6 equivalence evidence before invoking the real linked wrapper. Until then, the checked-in candidate manifest intentionally blocks projection creation.
- Use the repository-local Supabase CLI. `npm run release:dry-run` resolves `node_modules/.bin/supabase.cmd`; `-SupabaseCli` exists only for an explicit executable file, including the offline test double.

Run only after the prerequisites are satisfied:

```powershell
npm run release:dry-run
```

The only acceptable Supabase operation sequence is:

```text
supabase --workdir <temporary-projection> link --project-ref djfqozfaqkqdoqeoqbzt
supabase --workdir <temporary-projection> migration list --linked
supabase --workdir <temporary-projection> db push --linked --dry-run
```

There is no live-push mode or switch. A real apply requires a separate, explicitly reviewed procedure outside this gate.

## Blocking outcomes

Stop and preserve the reviewed inputs when any of these occurs:

- `LegacyDbPushMissingLocalError`;
- any `candidate` equivalence;
- a missing or foreign isolated linked ref;
- a dirty Git worktree;
- a changed or unreadable migration hash;
- a pending migration not present in the reviewed manifest;
- `up to date` while the manifest still contains a non-empty `forward_pending` set;
- a non-zero CLI exit or any command/ordering mismatch.

Do not repair migration history, retry with a live push, edit the temporary projection, or weaken the manifest to get past a blocker. Reconcile the manifest/evidence in a new reviewed commit and rerun the gate.

## Review evidence

Evidence may record only:

- the exact command form (with the temporary path normalized or omitted);
- Supabase CLI version;
- Git SHA;
- reviewed local/remote migration names and versions;
- pass/fail conclusion for each blocking condition.

Never place passwords, tokens, environment dumps, credential-bearing URLs, SQL contents, database rows, or raw remote responses in committed evidence. Raw read-only evidence belongs only under ignored `local-artifacts/release-evidence/` and must be sanitized before any summary is committed.
