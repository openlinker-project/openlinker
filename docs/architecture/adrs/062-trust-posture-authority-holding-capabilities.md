# ADR-062: Trust posture for authority-holding capabilities

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

[ADR-003](./003-plugin-sdk-trust-model.md) states that plugins are trusted in-tree code — no
sandbox, no runtime capability allow-list — and that when third-party community plugins arrive,
"the *trust* policy will need its own ADR." The OMS design is that arrival in contract form: its
ports are built so a third-party OMS/3PL can implement them. Authority-holding capabilities are
also the most powerful plugin class yet — an `AvailabilityAuthority` returning `0` zeroes a
seller's whole catalogue in one answer, an inflated answer oversells everything, and
`FulfillmentRouterPort.route()` is handed buyer shipping addresses to filter on. The repo already
has a discipline for handing data to an outside party: the MCP tools' explicit-allowlist
projections.

## Decision

**(1) In v1, third-party is the *contract* target, not the *trust* target.** The OMS ports are
implemented only by first-party in-tree code (the OL-OMS plugin, in-tree vendor adapters reviewed
like any other integration). Out-of-tree distribution of authority-holding plugins is deferred and
re-opens this ADR — stating this removes most of the threat surface honestly instead of
pretending a sandbox exists. **(2) `RoutingInput` carries PII as an explicit allowlist
projection** (`shipTo` limited to the fields routing can use: country, postcode, city — never
name/email/phone), `OL_STORE_PII`-aware with a degraded hash-only shape, per the MCP-tools
precedent. **(3) A plausibility envelope guards the availability path**: an authority answer that
moves a scope's published ATP by more than a configured factor (or floors a previously-positive
scope catalogue-wide) resolves provenance `'unknown'` — suppress-and-alert
([ADR-061](./061-advisory-reservations-and-availability-authority.md)) — rather than publishing.
The envelope is a safety net against bugs as much as malice, and it reuses machinery the design
already carries. **(4) `HostServices` is not widened for OMS plugins**, and the existing grants
(`identifierMapping`, `credentialsResolver`) are noted as the pre-existing exposure an eventual
third-party trust ADR must address — not silently inherited as acceptable.

### Scope: this ADR is about what crosses to a PLUGIN

Every decision above is about a boundary OpenLinker hands data ACROSS, to code
it does not own: `RoutingInput` into a router, `HostServices` into a plugin,
an authority's answer back. Decision (2)'s allowlist is the rule for that
boundary.

It is **not** a rule about what OpenLinker's own HTTP surfaces disclose to a
signed-in operator. Those are a different question - the viewer is
authenticated, their role is known, and the disclosure is bounded by a
`@Roles` decorator and a hand-written projection rather than by a plugin
contract - and they are governed by
`apps/api/src/auth/packer-exclusion.spec.ts`, which enumerates every route a
packer can reach and what each one carries.

Stating this is a correction rather than a clarification. Three places in the
pack-bench stack cited this ADR as the authority for an operator-facing
projection, and one of them (`packer-exclusion.spec.ts`, since fixed) used
that citation to assert "no total, no price" about a projection that had
carried both since #3409. A borrowed authority is worse than none: it reads as
settled and it was describing the wrong boundary.

**The one deliberate widening, recorded here because it is the case that
prompted the question.** The bench's parcel projection carries the buyer's
NAME, and the assign board carries it MASKED. Both are disclosures a plugin
boundary would refuse under decision (2), and both are correct here: the name
is printed on the label the packer is about to stick on the box, and the
masked form on the board is what lets a supervisor tell two parcels apart
without handing a temp the customer register. The masking is server-side and
the full name is never resolved in the DTO mapper, so the un-masked value does
not exist on that path to be leaked by a later change.

## Alternatives considered

- **A runtime sandbox / capability enforcement now**: out of proportion to a first-party-only v1;
  ADR-003's own reasoning (host-process code can do anything) still holds.
- **No envelope ("trust the authority — it is the authority")**: rejected — the authority is
  authoritative about *availability*, not about being bug-free; a wrong answer's blast radius is
  the whole catalogue, and `'unknown'` already exists as the honest degraded state.
- **Per-capability manifest privilege tiers**: deferred with third-party distribution; adds a
  vocabulary nothing enforces yet.

## Consequences

**Scope, restated where a reader skimming the consequences will meet it:** the PII allowlist above bounds what reaches a PLUGIN. It is not the rule for OpenLinker's own operator-facing routes, whose disclosures are enumerated in `apps/api/src/auth/packer-exclusion.spec.ts` - see the scope note under Decision.


**Pros:** the ADR-003 question is answered instead of dodged; PII exposure through the routing
port is bounded by construction; a buggy authority degrades to alert-and-hold instead of a
zeroed or oversold catalogue.
**Cons:** a legitimate mass stock change (warehouse onboarding) can trip the envelope — the
operator clears it from the authority-status surface; envelope factor tuning is operational work.

*Reversal gate (prose-only):* a request to distribute an authority-holding plugin out-of-tree re-opens this
ADR — its own decision text already routes that pressure here.

## References

- Related ADRs: [ADR-003](./003-plugin-sdk-trust-model.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md), [ADR-061](./061-advisory-reservations-and-availability-authority.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §9
- Review record: [REVIEW-oms-authority-model](../../plans/analysis/REVIEW-oms-authority-model.md)
