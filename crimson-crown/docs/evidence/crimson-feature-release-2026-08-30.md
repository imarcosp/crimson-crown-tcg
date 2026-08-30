# Crimson feature release — 2026-08-30

- Production project: `djfqozfaqkqdoqeoqbzt`
- Release source SHA: `da9beb08f494c79770f30f53b85a4ce42dc2049d`
- Vercel deployment: `dpl_4FX9QT6AErd7Sn3rfPs9w3kEPdb2`
- Production state: `READY`
- Physical backup: `COMPLETED` at `2026-08-30T11:52:20.192Z`
- Exact linked batch: `20260830133000`, `20260830170000`, `20260830203000`
- Post-apply migration dry-run: `upToDate=true`, zero pending migrations, seeds or roles
- Operational counts before and after: products `1954`, stock units `2287`, orders `63`, profiles `81`, inventories `1`, inventory movements `2`
- Initial active deck snapshots: EDHREC Commander `8/800`; MTGTop8 Modern `8/242`
- Snapshot states: active `2`, staging `0`, failed `0`
- Public smoke: home, catalog, login, admin redirect, deck overview, Commander/Modern list, search and detail all PASS

## remote-20260830133000

**PASS**

The production ledger contains `add_magic_legalities_to_external_prices`. The `public.external_prices.legalities` column exists, the operational counts remained unchanged, and the post-apply linked dry-run reported zero pending migrations.

## remote-20260830170000

**PASS**

The production ledger contains `create_home_quick_links`. The new table existed empty immediately after migration, the operational counts remained unchanged, and the deployed home route returned HTTP 200.

## remote-20260830203000

**PASS**

The production ledger contains `create_deck_builder_foundation`. The three isolated tables existed empty immediately after migration. After deployment, two snapshots were promoted atomically with 16 decks and 1,042 card rows while every operational count remained unchanged.
