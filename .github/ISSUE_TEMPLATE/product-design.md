---
name: Product Design (maintainer)
about: Formal product refinement for a feature or initiative. Used by maintainers to lock down what/who/why before engineering time is committed.
title: '[PRODUCT-DESIGN] '
labels: ['product-design']
assignees: ''
---

> **For maintainers.** This issue type kicks off the [two-tier refinement workflow](../../docs/contributors/refinement-workflow.md). If you're a contributor with a feature idea, please file a [Feature Request](?template=feature_request.md) instead — maintainers will convert it to a Product Design issue when it's prioritized.

## Initial problem hypothesis

[A concrete description of what's painful, for whom, and why now. Refined further during Phase A of `/refine-product`.]

## Affected persona (hypothesis)

- **Who:** [e.g. PL agency operator running 50+ SKU shops on PrestaShop+Allegro]
- **Volume / scale:** [e.g. 50–500 SKUs per shop, 10–100 orders/day]
- **Sophistication:** [e.g. technical but not developer, comfortable with operator UI]

## Current workarounds

[What do affected users do today? BaseLinker? Manual? Excel + macro?]

## Strategic alignment

- [ ] **Wedge-relevant** — supports the PL Allegro+PrestaShop+InPost wedge
- [ ] **Differentiator** — gives us a feature BaseLinker doesn't have or charges too much for
- [ ] **Foundational** — unblocks other features (specify which)
- [ ] **Tech-debt-driven** — reduces friction across many features
- [ ] **External requirement** — compliance, regulatory, marketplace API change

## Out of scope (initial)

- [What this Product Design issue is explicitly NOT trying to design — top 3-5 items, not exhaustive]

## Open questions for refinement

- [ ] [Question that the `/refine-product` workflow should resolve]
- [ ] [Question that requires user research]
- [ ] [Question that requires competitor analysis]

> **Stage 1 calibration**: OpenLinker is pre-paying-customer. The refinement workflow produces a lightweight conviction spec — no success-metric theatre (no "80% adoption in 7 days" promises we can't measure), no anti-metrics, no exhaustive risk catalogs. See [`docs/contributors/refinement-workflow.md`](../../docs/contributors/refinement-workflow.md#project-stage-calibration) for what sections are required vs skipped at this stage.

## Linked source

- Originating feature request: #N (if any)
- Related issues: #N, #N
- Related plans: `docs/plans/...` (if any)

## Definition of "refinement complete"

- [ ] Product spec at `docs/specs/product-spec-{N}-{slug}.md` merged
- [ ] Build/no-build decision recorded (Gate D output)
- [ ] If "build": implementation issues spawned and linked here
- [ ] **This Product Design issue is closed** when all of the above are done:
  - On Gate D = YES → `state_reason: completed`
  - On Gate D = NO → `state_reason: not_planned` with reasoning recorded
  - On DEFER → leave open with status note in body until defer condition changes
- [ ] Impl children track impl progress independently; **closing this PD does NOT depend on impl shipping**
