# OpenLinker Governance

This document covers who maintains OpenLinker, how decisions are made,
and how an external contributor can land a change. It complements
[`CONTRIBUTING.md`](./CONTRIBUTING.md) (the *how* of submitting a PR)
and [`SECURITY.md`](./SECURITY.md) (the *how* of disclosing a
vulnerability).

## Maintainers

The current maintainer set is small while the project gets off the
ground:

| Handle | Role | Scope |
| ------ | ---- | ----- |
| [@piotrswierzy](https://github.com/piotrswierzy) | Project lead | All packages |

Per-package code ownership is tracked in
[`.github/CODEOWNERS`](./.github/CODEOWNERS). Today every route resolves
to the project lead; the structure exists so per-package or per-team
ownership can be added without rewriting the file.

## Review SLA

We aim for these timelines on every pull request:

| Stage | Target |
| ----- | ------ |
| Initial acknowledgement (a comment, a question, or a first review) | within **2 business days** |
| Approve, request changes, or close on a well-scoped PR | within **5 business days** |
| Larger PRs (touching ≥ 5 files across multiple packages, or any architecture-direction doc) | longer — a holding comment within the SLA window confirms it's in flight |

Business days are weekdays (Monday–Friday) in Europe. These are
aspirational defaults, not contractual — but if a PR has been silent
past these windows, please tag the maintainer in a comment or open a
follow-up issue.

## Who can merge

Only maintainers (see above) can merge to `main`.

We use GitHub's branch protection to enforce this. The combination
recommended today, with a single maintainer, is:

- `Require a pull request before merging` — **on** (no direct pushes to
  `main`)
- `Require approvals` — **0** (the maintainer may merge their own PR
  via the GitHub UI; required-approvals would deadlock self-merge
  otherwise)
- `Require review from Code Owners` — **off** (will be turned on once a
  second maintainer exists — see `.github/CODEOWNERS` for the
  rationale)
- `Require status checks to pass before merging` — **on** for `lint`,
  `type-check`, `test`, and integration-test workflows once those
  workflows can run reliably on fork PRs (tracked in #662)

When a second maintainer is added, approvals go to `1` and code-owner
review can be enabled in the same PR that adds them.

## Adapter / plugin maintainership

OpenLinker's integration packages live under `libs/integrations/<x>/`.
**Adapter packages may be co-maintained or solely maintained by a
non-core contributor** with demonstrated commitment to that platform.
The intent is that a Shopify-shop operator who has built and is
running a Shopify adapter in production should be able to own review
of that package — they understand the platform's edge cases better
than the core team does.

Mechanically, per-adapter ownership lives in
[`.github/CODEOWNERS`](./.github/CODEOWNERS). When a non-core
maintainer steps up for an adapter, that adapter's CODEOWNERS route is
re-pointed to their handle (or a `core + plugin-author` pair). The
default until then is core-team review.

The plugin contract surface (`libs/plugin-sdk/`, `@openlinker/core/*`,
`@openlinker/shared/*`) is *not* in this category — those packages stay
under core-team review regardless of who maintains downstream adapters,
because changes there affect every plugin.

## Decision-making

- **Day-to-day decisions** — implementation choices inside a single
  package, bug fixes, dependency bumps, test additions — are made by
  single-maintainer review and approval on a PR.
- **Major architectural changes** — anything that modifies
  `docs/architecture-overview.md`, `docs/engineering-standards.md`, or
  `docs/frontend-architecture.md` — require a **proposal issue first**.
  Open an issue describing the change, motivation, and alternatives;
  discuss; then open the PR. This avoids the maintainer reading 600
  lines of code and only then disagreeing with the direction.
- **Adding or removing a maintainer** — by invitation from the current
  maintainer set, recorded in the Maintainers table above and in
  `.github/CODEOWNERS`.
- **Conflicts** — IP, contributor identity, and licensing decisions are
  governed by [`LICENSE`](./LICENSE) (Apache 2.0) and the DCO
  attestation in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Conduct
  decisions follow `CODE_OF_CONDUCT.md` when it lands (tracked in
  #659); until then, GitHub's default community standards apply.

## Becoming a maintainer

Today the path is intentionally lightweight, because the project has
one maintainer and "becoming a maintainer" effectively means impressing
that one person. The current criteria:

- Sustained contribution over multiple PRs (think weeks, not days).
- Review quality — leaving useful comments on other people's PRs that
  catch real issues.
- An invitation from the current maintainer set.

As the project grows past 2–3 maintainers, the bar will tighten —
expect explicit metrics (e.g., a minimum number of merged substantive
PRs over a defined window, sustained review activity, and consensus
from the existing maintainer set). This section will be updated to
reflect that.

## Removing a maintainer

A maintainer may be removed by mutual agreement, by a maintainer's own
request, or by consensus of the remaining maintainers in cases of:

- Sustained inactivity (no review or commit activity for 6 months).
- Violation of `CODE_OF_CONDUCT.md` (the CoC ships separately — tracked
  in [#659](https://github.com/openlinker-project/openlinker/issues/659);
  until it lands, GitHub's default community standards apply).

Removal is recorded in the Maintainers table above, in
`.github/CODEOWNERS`, and in any other places where the handle is
referenced.

## Changes to this document

`GOVERNANCE.md` is itself covered by the "architectural-direction docs"
rule above — propose changes as an issue first, then open the PR.
