# ADR-086: One Mirakl plugin, one operator profile per Mirakl marketplace

- **Status**: Accepted
- **Date**: 2026-11-23
- **Authors**: @jakubret

## Context

Empik Marketplace runs on Mirakl (SPIKE-4268, verified live: `marketplace.empik.com/api/version`
answers, and a staging shop key works against the Mirakl Seller API). Decathlon, Leroy Merlin,
MediaMarkt and Castorama run the same platform. Every Mirakl marketplace exposes the same Seller
API (OR11 orders, OF24 offers, STO01 stock, PRI01 prices, P41 products, RT returns), with the same
key-based auth and the same asynchronous imports. What differs is the host, the catalogue, and
which modules and fields the operator has enabled.

Base.com integrates the same way: each Mirakl marketplace is a separate integration for the
operator, but the settings and behaviour are visibly shared.

## Decision

1. **One package, `@openlinker/integrations-mirakl`**, holds the Mirakl client, the import
   tracker, the pagination helpers and every capability adapter.
2. **Each marketplace is a data-only `MiraklOperatorProfile`** (`src/operators/`): adapter key,
   platform type, display name, brand, version and the base URL per environment. Empik is
   `empik.mirakl.v1` / `empik`.
3. **A profile becomes its own adapter, platform type and connection type** through
   `createMiraklPlugin(profile)` and its own host module (`EmpikIntegrationModule`). Operators see
   "Empik Marketplace", never "Mirakl".
4. **The profile grows only with what an operator actually needs.** Order and offer rules (the
   buyer tax-id field code, the single tracking number, the offer state code, the variant-group
   attribute) are added by the issues that read them. The second operator reshapes the profile;
   nothing is guessed in advance.
5. **No base-URL override.** The host comes from the profile, picked by `config.environment`
   (`production` | `staging`), and the client re-checks every request against it. A connection
   cannot send its key to another host, so there is no SSRF surface to validate.
6. **No webhooks.** Mirakl webhooks are available to operators only; seller integrations poll.
7. **Stock and prices never go through OF24.** OF24 replaces the whole offer (verified on staging:
   a write without `quantity` set it to 0 and reset the description, lead time and logistic
   class). Stock goes through STO01 and prices through PRI01, which change only their own field.
8. **An import's `COMPLETE` status is not success.** Every Mirakl import can finish `COMPLETE` with
   error lines; callers read the error count and the error report.

## Alternatives considered

- **A dedicated `libs/integrations/empik` package**: rejected. The second Mirakl marketplace would
  copy the whole package, and the two copies would drift on the same API.
- **One generic "Mirakl" connection type with the marketplace chosen in config**: rejected.
  Operators think in marketplaces, capabilities differ per operator (one may lack returns or price
  imports), and a single platform type could not express that in the manifest.
- **A per-connection base URL, as in Erli**: rejected for decision 5.

## Consequences

- Adding a Mirakl marketplace is a profile, a host module, a web plugin card and a staging check,
  not a new integration.
- Each operator registers its own copy of the retry and auth-failure classifiers. They only
  recognise Mirakl exceptions, so the duplicates are harmless.
- The profile is shaped by one operator until a second one arrives; expect it to change then.
