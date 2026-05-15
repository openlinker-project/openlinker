<!--
Thank you for contributing to OpenLinker!

Title: use Conventional Commits format — `feat(scope): subject`,
`fix(scope): subject`, `docs:`, `refactor:`, `test:`, `chore:`.
See CONTRIBUTING.md → Commits for the full type list.
-->

## Summary

<!-- 1–3 bullets: what changed and why. Focus on the why. -->

-

## Related issues

<!-- One `Closes #N` per issue this PR resolves. Issues are closed
     automatically when the PR merges — do not close them manually. -->

Closes #

## Test plan

<!-- How a reviewer verifies the change. Commands to run, paths to
     click through, edge cases to confirm. -->

-

## Quality gate

- [ ] `pnpm lint` passes (zero errors)
- [ ] `pnpm type-check` passes (zero errors)
- [ ] `pnpm test` passes (all unit tests green)
- [ ] *Optional, Docker required:* `pnpm test:integration` passes — needed
      only if you touched `apps/api/test/integration/**` or any plugin's
      `infrastructure/adapters/`.

## Migrations

- [ ] If this PR changes an ORM entity, a migration is included under
      `apps/api/src/migrations/` (or the plugin package), `pnpm --filter
      @openlinker/api migration:show` confirms it's listed, and both
      `up()` and `down()` were tested locally. See
      [`docs/migrations.md`](../docs/migrations.md). Tick this box for
      PRs that don't touch schemas too — it's trivially satisfied.

## ADR

- [ ] If this PR makes a non-trivial architectural decision (affects
      multiple contexts, the plugin contract, or has alternatives worth
      documenting), an ADR is included under
      `docs/architecture/adrs/` or referenced in the PR description.
      See [`docs/architecture/adrs/README.md`](../docs/architecture/adrs/README.md)
      for when to write one. Tick this box for PRs that don't make
      architectural decisions too — it's trivially satisfied.

## DCO sign-off

> Sign off every commit with `git commit -s`. OpenLinker uses the
> [Developer Certificate of Origin](https://developercertificate.org/)
> as its contributor attestation (see
> [CONTRIBUTING.md → Commits](../CONTRIBUTING.md#commits)). Automated
> enforcement is deferred until after the org transfer; sign off anyway
> so the history is consistent when enforcement starts.

<details>
<summary><strong>Adding a new integration adapter?</strong> (expand)</summary>

If this PR introduces a new package under `libs/integrations/<x>/`,
declare its status so reviewers know what bar to apply:

- [ ] **alpha** — experimental; API may change, no production traffic
      yet
- [ ] **beta** — stable contract, real-world use ongoing, breaking
      changes flagged in PR title
- [ ] **stable** — production-ready; breaking changes follow semver

See [`docs/architecture-overview.md`](../docs/architecture-overview.md)
for the adapter / capability contract and
[`GOVERNANCE.md`](../GOVERNANCE.md) for the policy on plugin authors
co-maintaining their own adapter.

</details>

<details>
<summary><strong>UI changes?</strong> Attach screenshots at three widths (expand)</summary>

Per [`docs/frontend-ui-style-guide.md` § Responsive](../docs/frontend-ui-style-guide.md#responsive),
mobile and tablet are first-class. Capture after-shots at all three
breakpoints:

- **Mobile** (360 × 812):
- **Tablet** (768 × 1024):
- **Desktop** (1440 × 900):

</details>

---

<sub>By submitting this pull request, I confirm that my contributions
are made under the terms of the [Apache License 2.0](../LICENSE), and I
certify the [Developer Certificate of Origin](https://developercertificate.org/)
by signing off my commits.</sub>
