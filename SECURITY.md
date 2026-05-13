# Security Policy

OpenLinker handles OAuth tokens, marketplace API credentials, and customer
PII. We take security reports seriously and appreciate responsible
disclosure from the security research community.

## Supported Versions

Until the first tagged release, only the `main` branch receives security
fixes.

| Version | Supported |
| ------- | --------- |
| `main`  | ✅        |

Once the project ships tagged releases, this table will be updated to
reflect the supported release lines.

## Reporting a Vulnerability

**Please do not file public GitHub issues or pull requests for security
vulnerabilities.** Public disclosure before a fix is available puts every
OpenLinker operator at risk.

> **Dual-purpose channel:** GitHub Security Advisories is also the interim
> reporting channel for community-conduct violations — see
> [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). For conduct reports, prefix the
> advisory title with `[Conduct]` so the maintainers route it to the right
> reviewer. The dual-use ends once `conduct@openlinker.io` lands (#642).

**Preferred channel — GitHub Security Advisories:**

1. Navigate to the [Security tab](https://github.com/SilkSoftwareHouse/openlinker/security)
   on this repository.
2. Click **Report a vulnerability**.
3. Fill in the advisory form. The report stays private to the maintainers
   and yourself until a fix is published.

GitHub Security Advisories give you a private, auditable thread with the
maintainers and an automatic CVE issuance path once a fix lands.

> **TODO (depends on [#642](https://github.com/SilkSoftwareHouse/openlinker/issues/642)):**
> once the `openlinker.io` domain is operational, a `security@openlinker.io`
> email alias will be added as a secondary channel. GitHub Security
> Advisories will remain the primary channel.

> **TODO (depends on [#641](https://github.com/SilkSoftwareHouse/openlinker/issues/641)):**
> the Security-tab URL above resolves to the canonical repo URL today. Once
> the org transfer completes, update the link (and any other references in
> this doc) to the post-transfer URL. Tracked alongside the broader URL
> convergence work in
> [#664](https://github.com/SilkSoftwareHouse/openlinker/issues/664).

When reporting, please include:

- A description of the vulnerability and its impact.
- Reproduction steps, proof-of-concept, or a minimal failing test case.
- Affected versions / commits.
- Any suggested mitigation, if you have one.

## Response SLA

We aim to meet the following timelines:

| Stage                          | Target                  |
| ------------------------------ | ----------------------- |
| Initial acknowledgement        | within 72 hours         |
| Triage + severity assessment   | within 7 days           |
| Fix for critical vulnerability | within 14 days          |
| Fix for non-critical           | within 30 days          |
| Coordinated public disclosure  | after fix is published  |

Severity follows [CVSS v3.1](https://www.first.org/cvss/) — anything rated
**Critical** or **High** is treated as critical for SLA purposes.

If the timelines above slip, we will keep you updated on the advisory
thread with reasons and a revised target.

## Scope

**In scope** — every package maintained in this repository:

- `apps/api` — the NestJS HTTP API.
- `apps/worker` — the background job worker.
- `apps/web` — the operator admin SPA.
- `libs/core` — domain logic and ports (`@openlinker/core/*`).
- `libs/shared` — cross-cutting utilities (`@openlinker/shared/*`).
- `libs/plugin-sdk` — the plugin contract surface (`@openlinker/plugin-sdk`).
- `libs/integrations/*` — the bundled adapters (Allegro, PrestaShop, AI).

**Out of scope:**

- Third-party plugins not maintained in this repository — please contact
  the plugin author directly.
- Vulnerabilities in upstream services (Allegro, PrestaShop, etc.) —
  please report those to the upstream vendor directly. We are happy to
  coordinate disclosure if the vulnerability has cross-impact.
- Vulnerabilities in third-party dependencies — first check whether a fix
  has been published upstream. If yes, an upgrade PR is welcome via the
  normal contribution flow. If no, report to the upstream project; we will
  pick up the fix when available.

## Safe Harbor

We support security research conducted in good faith. As long as you:

- Make a good-faith effort to avoid privacy violations, destruction of
  data, and degradation of our services.
- Only test against your own data / accounts, or against test accounts
  you've created yourself.
- Give us reasonable time to investigate and remediate before any public
  disclosure.
- Do not exploit a vulnerability beyond what is necessary to demonstrate
  it.

…we consider your research authorized, will not initiate legal action
against you, and will work with you on coordinated disclosure.

This safe harbor does not extend to attacks against OpenLinker operators
(production instances run by third parties) — please research against your
own local installation only.

## Acknowledgements

We will publicly credit reporters on the published advisory unless you
prefer to remain anonymous. Please indicate your preference in the
report.
