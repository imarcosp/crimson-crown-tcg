# Crimson Crown production dependency audit — 2026-08-29

## Versions

| Package | Before | After | Scope |
| --- | ---: | ---: | --- |
| `next` | `16.0.7` | `16.3.3` | direct, exact |
| `eslint-config-next` | `16.0.7` | `16.3.3` | development, exact match for Next |
| `axios` | `1.13.2` | `1.20.0` | direct, exact |
| `puppeteer` | `24.43.1` | `25.9.0` | direct, exact |
| `resend` | `6.6.0` | `6.25.0` | direct, exact |
| `undici` | `7.16.0` | `7.29.0` | transitive through `cheerio@1.1.2`, exact lock |
| `mercadopago` | `2.12.0` | `2.12.0` | direct, exact pending-exception pin |
| `mercadopago > uuid` | `9.0.1` | `9.0.1` | transitive pending exception |

## Production-only audit counts

Audit command: `npm@11.6.2 audit --omit=dev --json`, Node `24.19.0`.

| Snapshot | Critical | High | Moderate | Low | Total vulnerable packages |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before | 0 | 13 | 5 | 0 | 18 |
| After | 0 | 0 | 2 | 0 | 2 |

## Advisory IDs and links

| Dependency chain | Advisory |
| --- | --- |
| Axios | [GHSA-43fc-jf86-j433](https://github.com/advisories/GHSA-43fc-jf86-j433), [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf), [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh) |
| Next | [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24), [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj), [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) |
| Puppeteer > extract-zip | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) |
| Cheerio > undici | [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) |
| Mercado Pago > uuid | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |

## Compatibility and release test summary

| Check | Result |
| --- | --- |
| Dependency contract RED | Expected failures observed for unsafe/unpinned dependency versions and for the unverified default build path |
| Dependency contract GREEN | 9/9 passed: exact resolution, exact guarded Webpack build path, Next response runtime, Axios GET/client/params/headers/status/error contracts, Puppeteer launch/PDF, Resend client/send, Mercado Pago v2 payment search |
| Release safety | 116/116 passed |
| Environment safety | 49/49 passed |
| Deployment safety | 7/7 passed |
| TypeScript | passed |
| Exact package build | `npm run build` passed with the deployment guard, Next `16.3.3`, and Webpack; 44 static/dynamic routes generated |
| Changed-file lint | passed |
| Full-tree lint | 496 errors and 183 warnings in pre-existing, unchanged application files |
| Lockfile dry-run | passed; lockfile diff hash unchanged |
| Production-only audit | 0 critical, 0 high, 2 moderate |

## Mercado Pago decision

`mercadopago@2.12.0` declares `uuid@^9.0.0`; `uuid@11.1.1` is outside that supported range. The available audited remediation is `mercadopago@3.6.0`, a major SDK change. The cart offering is owner-deferred, but Mercado Pago is not disabled: the legacy public `/test-payment` route and checkout verification v2 surfaces remain. Their API behavior is unchanged, the SDK is pinned exactly to `2.12.0`, and the two remaining moderate audit entries are limited to the single `mercadopago@2.12.0 > uuid@9.0.1` chain identified by [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

This evidence does not record explicit owner acceptance of that security exception. Release remains gated until the owner explicitly accepts this exact moderate chain for the release or authorizes a separate Mercado Pago v3/removal remediation.
