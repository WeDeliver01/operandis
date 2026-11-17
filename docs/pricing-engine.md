# Pricing engine

Code: `lib/domain/src/pricing/{rules,engine}.ts` · Tests: `lib/domain/test/pricing.test.ts` · Admin: Console → Pricing rules.

## Principles

- **Deterministic**: the same answers and the same rule version always produce the same result. No AI, no randomness, no I/O.
- **Configurable**: every coefficient lives in a versioned JSON document (`pricing_rule_versions.rules`), validated by `pricingRulesSchema`. Nothing is hard-coded in the UI.
- **Indicative**: every result carries a non-binding statement; estimates are snapshotted with the rule version id that produced them.
- **Server-authoritative**: the browser receives labels only (`GET /configurator/schema` never exposes coefficients) and the server recalculates on submission.

## Formula

```
solutions      = most expensive selected solution base
               + Σ other selected solution bases × additionalSolutionBps
subtotal       = solutions
               + Σ selected features
               + Σ integrations (+ unknownApiSurchargeBps when the vendor API is unknown/absent)
               + Σ platforms + user/role bands + branding readiness + migration level
complexity     = subtotal × tier.multiplierBps      (tier chosen by summed complexity points)
urgency        = (subtotal + complexity) × urgency.multiplierBps
total          = max(minimumProjectMinor, subtotal + complexity + urgency), rounded to roundingStepMinor
low / high     = total × range.lowBps / range.highBps[confidence], rounded
tax            = total × tax.rateBps  (only when tax is enabled AND confirmed by the owner)
deposit        = (total + tax) × deposit.percentBps
milestones     = (total + tax) allocated by milestoneSchedule percentages (sum exactly to the contract value)
timeline       = base solution weeks + feature/integration/platform weeks + points × weeksPerComplexityPoint
                 (urgency compresses ~20 %)
discovery fee  = shown separately when the recommendation is paid discovery
```

All arithmetic is integer minor units with half-up rounding via BigInt (`applyBps`, `roundToStep`, `allocateByBps`).

## Confidence

Starts high; concerns add weight: unpriced/"Not sure" solution (+3), mixed with priced (+1), contradictory features (+1), integrations without a confirmed API (+0.5/+1), "other" integrations (+0.5), too many integrations (+1), unknown migration source (+1), short problem description (+0.5), >2 solution types (+0.5). ≥2.5 → low, ≥1 → medium.

## Manual-review triggers (spec §6.4)

Raised as `flags` (stable codes) and `requiresManualReview: true`:

| Code | Trigger |
| --- | --- |
| `unclear_solution` | only/also "Not sure yet" |
| `contradictory_requirements` | a feature isn't offered for any selected solution |
| `many_integrations` / `many_platforms` | above `maxIntegrationsBeforeReview` / `maxPlatformsBeforeReview` |
| `native_mobile`, `offline_mode`, `sensitive_data`, `regulated_workflow`, `large_migration` | from feature/platform/migration `flags` in the rules |
| `unknown_source_system` | migration with unknown data ownership |
| `budget_below_estimate` | budget band maximum < low estimate |
| `timeline_conflict` | target launch weeks < minimum delivery weeks |
| `above_auto_threshold` | total > `maxAutoEstimateMinor` |
| `low_confidence` | confidence low |
| `unpriced_items` | free-text "other" integrations |

## Recommendation

1. Single priced solution, no flags, matches a `packageMappings` entry (total and feature-count limits) → **package** (links to that package).
2. Otherwise, if a discovery package is configured and (flags or total ≥ `discovery.recommendAboveMinor`) → **paid discovery**.
3. Otherwise → **intro call**.

## Validation

`validateAnswersAgainstRules` rejects unknown keys and unmet feature dependencies (`requires`) with `422`. The configurator UI auto-adds required features and removes dependents, but the server is the enforcement point.

## Versioning workflow

1. Console → Pricing rules → **New draft version** (copies the active rules).
2. Edit the JSON; **Validate** runs the same Zod schema as the server; **Preview** runs sample answers through the engine locally.
3. Save the draft (optimistic locking via `rowVersion`; concurrent edits get `409 version_conflict`).
4. **Approve & activate**: owner-only for real rate cards (`pricing.approve`); demo versions can be activated by admins. Activation retires the previous version atomically. Active/retired versions are immutable; every change is audited.
5. Existing estimates keep their snapshot; staff can **Re-estimate** a brief with the current version (old estimates are kept as `superseded`).

## Demo rules

`lib/domain/src/pricing/demo-rules.ts` contains **placeholder** coefficients so the platform is testable. They are not an approved Operandis rate card. `seed:demo` activates them with `is_demo = true`, and the public configurator shows a "Demonstration pricing" notice while a demo version is active. Production seeding (`pnpm db:seed`) leaves them as a draft.
