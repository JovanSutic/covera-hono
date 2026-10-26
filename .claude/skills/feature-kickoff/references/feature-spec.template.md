# <Feature>

Status: DRAFT · APPROVED · SHIPPED

## Intent

In the operator's words. What this does and why. No implementation detail.

## Behaviour

| # | Method | Path | Guards | Success | Failure modes |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |

## Data changes

Schema, migration, backfill — or `none`. If `none`, say so explicitly.

## Invariants this must not break

- The error envelope is built only in `renderError` (`errorHandle.md` §3)
- Guards and handlers throw; they do not return error JSON (§4.2)
- Every `code` comes from `ERROR_REGISTRY`
- Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids (§8)
- Driver text goes to `meta.driver` only, and is absent in production
- Every route declares every status it can actually produce (see `*.decisions.md`)

## Out of scope

Explicitly not part of this change. The executor must not infer these.

## Open questions

**Must be empty before the plan is written.** Move every entry to `<feature>.decisions.md` as a
numbered decision with a recommendation.
