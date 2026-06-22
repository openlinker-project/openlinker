# Product Spec — RBAC depth: how far to deepen the roles/permissions model

**Issue:** #1123
**Status:** phase E complete — Gate D: YES (engineering committed)
**Author:** Product refinement (/refine-product)
**Created:** 2026-06-22

---

## 1. Problem

> **Phase A loop (2026-06-22):** initial framing was "the shop that grew past one person." During Gate A the maintainer introduced a concrete, immediate driver — a **public hosted demo** — that reframes the primary problem. Both drivers are kept below; **D1 (demo) is the primary, concrete driver; D2 (team delegation) is the secondary, analogy-based one.**

OpenLinker today is **effectively single-admin**. There is a shipped two-role seam (`admin` + `viewer`, `RolesGuard`, `@Roles('admin')` on ~50 endpoints), but it is **inert and too coarse to expose to untrusted users**:

- **No user-management API/UI** — users exist only via DB seed/migration.
- **The `viewer` role is read-only but still sees everything** — there is no field/secret redaction, so a read-only user can read connection credentials/config, AI provider settings, and webhook secrets. Write-gating is endpoint-level only; there is no row- or field-level filtering.

### D1 — Public hosted demo (primary, concrete)

The maintainers want to stand up a **publicly accessible OpenLinker instance** with multiple sandbox shops connected, so prospective adopters can log in and explore how it works without installing anything. Untrusted public visitors logging into a live instance must **not** be able to:

- mutate anything (create/delete connections, push to marketplaces, bulk offer create/delete, reconfigure webhooks), or
- read secrets (connection credentials, AI provider keys, webhook HMAC secrets, raw config).

The current model can't deliver this safely: `admin` is all-powerful, and `viewer` — the only alternative — **exposes secrets**. So today a demo is either unsafe (shared admin / secret-leaking viewer) or impossible. The demo is essentially a **multi-user deployment with hostile users**, which is the textbook trigger for real read-only hardening.

### D2 — Real adopter team delegation (secondary, analogy-based)

Separately, a self-hosting shop that grows past one person wants staff to *operate* but not *administer* — warehouse (process orders, print labels), customer service (view orders), accountant (read-only numbers), outsourced VA (manage listings). Today they share the admin login (full blast radius) or don't delegate. This is the same usability gap (no user-mgmt) plus a need for a **write-capable, scoped** role — but the evidence is competitor-analogy, not a stated OL request.

### What the two drivers share vs. where they diverge

- **Shared:** the role system must become *usable* (user-management) and there must be a genuine read-only tier.
- **Diverge:** D1 *requires* **secret/credential redaction for untrusted readers** (a new capability the current model lacks) but needs **no write-capable role**. D2 needs a **write-capable operator** role but, since staff are trusted, treats secret-redaction as nice-to-have.

The open question for refinement: **how far to invest now** — the smallest cut that ships a safe public demo, versus a broader team-delegation RBAC — given OpenLinker is Stage 1, single-deployment, with a still-churning API surface.

## 2. Affected persona

Two personas, matching the two drivers:

| Axis | D1 — Demo | D2 — Team delegation |
|---|---|---|
| **Who** | OpenLinker **maintainers** (want a safe public demo) + **prospective adopters** (log in to evaluate) | A self-hosting shop that **grew past one person** + its lower-trust staff |
| **Trust level** | **Untrusted / hostile** public visitors | **Trusted** internal staff |
| **Access needed** | Browse-only across many connected sandbox shops; **never** secrets or mutations | Operate (orders/listings/labels) but not administer (credentials/config/users) |
| **Sophistication** | Anyone — non-technical evaluators | Technical-ish owner + non-technical staff (warehouse, CS, accountant, VA) |
| **Geography** | Global (demo is a shop-window) | PL-first (Allegro + PrestaShop) |

Neither persona is the solo merchant running everything alone — they're fine with one admin login. The forcing function is **untrusted readers (D1)** and **team members who should operate-not-administer (D2)**.

## 3. Evidence & user research

Three research streams (run 2026-06-22) plus the first-party demo signal.

### 3.1 First-party signal (decisive)

- **The public hosted demo is a maintainer-stated, committed initiative** (this refinement's trigger). It is concrete OL-internal demand, not analogy — it outranks all competitor evidence below. It is what makes secret-redaction-for-untrusted-readers a hard requirement rather than a nice-to-have.
- **No external OL adopter requests for team RBAC (D2) surfaced** in research. D2 rests on competitor analogy and is labelled an assumption-to-validate.

### 3.2 Current-state codebase (what already exists / what's missing)

Grounded map (file:line):

- **Two roles shipped**: `admin` + `viewer` as-const union — `libs/core/src/users/domain/types/role.types.ts`. Derived `ROLE_PERMISSIONS` map (7 permission strings, computed from role, **not stored per-user**).
- **Enforcement shipped**: global `JwtAuthGuard` + `RolesGuard` (`APP_GUARD`, `apps/api/src/auth/auth.module.ts`); `@Roles('admin')` on ~50 endpoints across 21 controllers; JWT carries `role`; access + refresh-token infra present.
- **FE**: `requiresRole` nav filtering, `useSession()`; `SessionUser.permissions[]` exists but is **never populated** (stub).
- **Gaps that block this spec**:
  - **No user-management API/UI** — users are seed/migration-only. (Blocks any second user, demo or staff.)
  - **No registration/approval flow** at all.
  - **`viewer` exposes everything** — read-only is endpoint-write-gated only; **no field/secret redaction**, so a read-only user can read connection credentials, AI provider keys, webhook secrets. (Directly blocks a safe public demo.)
  - No per-resource scoping, no custom roles, no multi-tenancy (all connections/products globally shared).
- **Verdict:** the *enforcement seam* exists (cheap part done); the *usability* (user-mgmt/registration) and *untrusted-reader safety* (redaction) are absent. Gap to the v1 we need is **moderate**, and concentrated in exactly two places.

### 3.3 Competitor RBAC (e-commerce orchestration peers)

Sources: [ChannelEngine roles](https://support.channelengine.com/hc/en-us/articles/4409512346909-ChannelEngine-users-roles-and-permissions), [Linnworks user mgmt](https://help.linnworks.com/support/solutions/articles/7000058962-user-management-and-permissions), [Channable roles](https://helpcenter.channable.com/account-billing/manage-your-account-and-settings/manage-user-roles-in-a-channable-account), [Sellercloud permissions](https://sellercloud.com/help/omnichannel-ecommerce/employee-permissions-and-roles/), [Sellbrite permissions](https://support.sellbrite.com/en/articles/3367203-how-to-add-users-set-permissions), [BaseLinker/Base employee accounts](https://base.com/pl-PL/pomoc/wiedza/konta-pracownikow/).

- **Every peer has multi-user roles.** Canonical shape: one un-editable owner (owns billing + user management) → module-aligned preset roles (Orders / Listings / Inventory) → a **read-only variant** → [mature tools] View/Edit/Create/Delete matrix → [enterprise] resource scoping (per-warehouse / per-channel / per-brand). BaseLinker adds per-order-status restriction + per-user audit log.
- **Most-protected actions everywhere**: credentials/connection config, billing, user management, bulk/destructive actions, pricing/refunds. → OL analogs: connection credentials, AI provider keys, bulk offer create/delete, webhook config. **These should be the admin-gated / redacted set.**
- **Read-only is a first-class, recurring role** (accountant/analyst/exec) — validates D1's and D2's read-only tier.
- Granularity is a **positioning choice, not a settled best practice**: coarse module on/off (Sellbrite/Channable-Standard) and fine verb-matrix + scoping (Sellercloud/Linnworks) both ship successfully.

### 3.4 OSS self-hosted peers + product-timing

Sources: [n8n RBAC docs](https://docs.n8n.io/user-management/rbac/role-types/) + [community demand](https://community.n8n.io/t/allow-multiple-admins-on-self-hosted-community/181156), [Directus access control](https://directus.io/features/rule-based-access-control), [Strapi custom roles free](https://strapi.io/blog/custom-roles-and-permissions-available-for-free-in-strapi-v4-8), [Medusa RBAC discussion](https://github.com/medusajs/medusa/discussions/5059), [Saleor permissions](https://docs.saleor.io/developer/permissions), [Ghost staff](https://docs.ghost.org/staff), [Grafana RBAC](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/access-control/), [PropelAuth RBAC guide](https://www.propelauth.com/post/guide-to-rbac-for-b2b-saas), [Auth0 B2B RBAC](https://auth0.com/blog/role-management-auth0-organizations-b2b-saas/).

- **Pattern: coarse roles = table-stakes & free; fine-grained RBAC = the open-core paywall line** (n8n, Grafana, Metabase, Cal.com paywall granular/custom roles; Directus/Strapi/Saleor ship rich RBAC free because it *is* the product). Ghost ships a serious product on a **fixed 3–5 role ladder with no custom roles** — proof a small fixed ladder is enough.
- **Timing reconciliation:** Auth0/Authzed say "establish the enforcement *seam* early (retrofit is a 3–4y trap)"; PropelAuth/WorkOS say "keep the *policy* minimal until demand is articulated." Actionable synthesis: **seam early (already done in OL), policy minimal (don't model per-resource ACLs / custom roles yet).**
- **Strongest demand in the closest analog (n8n self-hosted)** is mundane: "a second admin" / "user A views, user B edits, user C views executions only" — i.e. a **small role ladder + read-only**, not fine-grained ACLs. Matches both D1 and D2.

### 3.5 What the evidence supports

- ✅ A small **fixed role ladder** (admin / operator / read-only-demo) is table-stakes and the right altitude — **not** custom roles / per-resource ACLs (defer; that's the paywall/over-engineering tier).
- ✅ **Read-only with secret redaction** is both the demo's hard requirement and a generally-useful capability — clear build.
- ✅ **User-management + registration/approval** is the actual usability blocker — clear build.
- ⚠️ **D2 (team delegation / write-capable operator)** is analogy-only; the operator role is justified by the demo's *contrast* need (something between admin and read-only) but its specific write-scope should stay minimal until a real adopter asks.
- ⛔ Multi-tenancy, custom-role engine, per-connection ACLs, field/row data sandboxing — **not supported by current evidence; defer.**

## 4. Solution exploration

All shapes assume the confirmed constraints: in-tree (no fork), registration + admin approval, secret redaction for read-only. They vary in **how much role depth** ships in v1.

| # | Shape | What the user gets | Drivers | Effort | Excludes |
|---|---|---|---|---|---|
| **A** | **Safe demo, minimal** | Hardened **read-only** role with secret redaction; registration→admin-approval→assign read-only; demo via env flag + seed script | D1 only | ~M | operator role, any write delegation (D2 deferred) |
| **B** | **Demo + operator ladder** ⭐ | Fixed **3-rung ladder** — `admin` / `operator` (write: orders, listings, labels; **not** credentials/users/config) / `read-only` (redacted); full user-mgmt UI (register, approve, assign, deactivate); demo via flag + seed | D1 + D2 | ~L | custom roles, per-connection scoping, per-resource ACLs |
| **C** | **Permission-driven presets** | Same UX as B, but roles are **named bundles of permission-strings** (wire the existing stubbed `permissions[]` end-to-end); 4th role later = data, not code | D1 + D2 | ~L/XL | custom-role *builder* UI; per-connection scoping |
| **D** | **Full RBAC** | Custom-role builder + **per-connection grants** ("this VA → Allegro only") + field-level | D1 + D2 + future | ~XL | nothing (this is the ceiling) |
| **E** | **Do nothing / fork** | Gate the demo behind a shared read-only login or a demo fork | — (fails D1) | ~S up front, high ongoing | **everything — and it doesn't actually work (see below)** |

### Comparison

- **Problem fit:** A solves D1 only. **B** solves both at the right altitude. C solves both but front-loads policy machinery the evidence says to defer. D massively over-shoots. **E can't safely deliver the demo at all** — today `viewer` exposes secrets, so even a shared read-only login leaks connection credentials / AI keys; a fork rots and stops demoing the real product.
- **Persona fit:** B's 3-rung ladder maps cleanly — read-only = demo visitor + accountant; operator = warehouse/CS/VA; admin = owner. Matches the n8n "second admin + read-only" demand and the competitor "owner → preset roles → read-only" canon.
- **Strategic fit (OSS positioning + monetization seam):** B keeps coarse roles free (table-stakes) and leaves the documented paywall line (custom roles / per-resource ACLs / SSO / audit) cleanly deferrable to a future Enterprise tier. C/D start spending on the paid-tier mechanics before there's a buyer.
- **Risk:** A risks shipping the demo then having to retrofit write-delegation (but the seam makes that cheap). B's main risk is scope (user-mgmt UI + redaction + operator gating is real work). C/D risk over-engineering a policy layer nobody has asked to be granular yet (the PropelAuth "harder to simplify than extend" trap). E risks a permanent secret-leak and a rotting fork.

### Recommendation

**Shape B**, with one element borrowed from C: **populate the existing `permissions[]` end-to-end so FE read/write affordances are permission-driven — but keep roles as fixed code-defined presets** (no bundle-editor). That gets B's clean 3-rung UX and makes a future 4th role cheap, without paying for C's custom-role machinery now. Defer C's builder and D entirely until a real adopter asks for granularity (the open-core paid line).

**Sub-decision for Phase D — demo approval at scale:** manual admin approval (the confirmed model) is a bottleneck for high-volume *public* demo traffic. Options to settle in the spec: (a) keep manual approval everywhere = gated "request demo access" (controls abuse, doesn't scale); (b) `OL_DEMO_MODE` **auto-approves into read-only** while normal installs keep manual approval. Recommend (b) — it preserves the confirmed manual-approval model for real installs while making the public demo self-serve.

### Success direction (qualitative — full Definition of Done in Phase D)

- A stranger can register → get approved → log into the public demo → browse multiple sandbox shops → and **provably cannot** see any secret or mutate anything.
- An admin manages users entirely from the UI (approve, assign role, deactivate) — no DB access.
- A shop owner can hand staff an **operator** login that processes orders/listings/labels but cannot touch credentials, config, webhooks, or other users.

### Do-nothing cost

No safe public demo ships (the decisive driver), OR it ships unsafely and leaks marketplace credentials of the connected sandbox shops. Team delegation stays blocked on shared admin logins. The honest framing: **"do nothing" is not viable for D1** because the current read-only role is secret-leaking — the demo *requires* at least Shape A.

## 5. Product specification

**Committed shape (Gate C):** Shape B — a fixed 3-rung role ladder (`admin` / `operator` / `read-only`) + self-service registration with admin approval + secret redaction for all non-admin views, shipped **in OL core**; demo posture via `OL_DEMO_MODE` flag + seed script. The stubbed `permissions[]` is wired end-to-end (roles stay fixed code presets — no custom-role builder).

**Roles (v1, fixed):**
- **admin** — everything (today's admin): credentials, config, webhooks, AI keys, user management, all writes.
- **operator** — operational writes: view/process orders, edit/publish listings, print labels, adjust inventory. **Cannot** touch connection credentials/config, webhooks, AI provider settings, or user management. Sees connections as names/status only (secrets redacted).
- **read-only** — view catalogs, orders, inventory, listings, statuses. **No writes. No secrets.** This is the demo-visitor and accountant role.

### User stories & acceptance criteria

**US-1 — Safe public demo (D1).** *As an OL maintainer, I want untrusted visitors to browse a live demo with multiple connected sandbox shops, so prospects can evaluate OL without installing — with zero risk of exposure or change.*
- AC: a logged-in demo (read-only) user can open dashboard, orders, products, inventory, listings, and connection *list* pages and see real sandbox data.
- AC: every credential / API key / webhook secret / raw config value is **absent or masked** in both the UI and the underlying API responses for that session.
- AC: every create/edit/delete/sync/publish action is unavailable (hidden or disabled) and rejected if called directly.

**US-2 — Self-serve demo entry (D1).** *As a demo visitor, I want to register and get in without waiting, so I can explore immediately.*
- AC: when `OL_DEMO_MODE` is on, registration auto-approves the new account into **read-only** and lands the user in the app.
- AC: the demo UI shows a persistent, unobtrusive "Demo — read-only" indicator.

**US-3 — Gated registration on real installs (D1/D2).** *As an admin, I want to approve registrations and assign a role, so only intended people get access.*
- AC: when `OL_DEMO_MODE` is off, a new registration lands in a **pending** state with no access until an admin acts.
- AC: the admin sees a pending-registrations queue and can approve (choosing a role) or reject.
- AC: registration can be disabled entirely per install.

**US-4 — User management from the UI (D2).** *As an admin, I want to manage users in the product, so I never need DB access.*
- AC: admin can list users with their role and status, change a user's role, and deactivate/reactivate a user — all from the UI.
- AC: a deactivated user can no longer log in; role changes take effect on the user's next session.

**US-5 — Delegated operations (D2).** *As a shop owner, I want to give staff an operator login, so I can delegate operations without handing over the keys.*
- AC: an operator can process an order and edit/publish a listing.
- AC: the operator is blocked — in the UI and the API — from connection credentials/config, webhook setup, AI provider settings, and user management.

**US-6 — Read-only review (D1/D2).** *As an accountant/analyst (or demo visitor), I want to see operational data but never secrets or controls, so I can review safely.*
- AC: read-only behaves as the redacted, no-write role across every screen (same enforcement as US-1).

## 6. Out of scope

Capped to what someone will actually ask about:
1. **Custom-role builder** — roles are fixed presets in v1; defining your own role is deferred (the open-core paid-tier line).
2. **Per-connection / per-marketplace scoping** ("this VA → Allegro only") — the known future wedge; cheap to add later onto the `Connection` entity, but not v1.
3. **Multi-tenancy / multiple orgs per install** — one install = one company; the "Default organization" label stays cosmetic.
4. **SSO / SAML / LDAP** — enterprise auth, deferred.
5. **Audit log ("who did what")** — adjacent and the natural *next* step (shares the actor seam), but a separate spec.
6. **Row-scoped data** beyond secret redaction (e.g. "operator sees only their own orders") — operator sees all operational data; only secrets/admin controls are gated.

## 7. Definition of done

Stage-1 qualitative — what the maintainer needs to see before calling v1 done:
- The public demo runs against untrusted traffic for **≥30 days with no secret-exposure or unwanted-mutation incident**.
- A non-admin session is **manually verified** to redact every credential/secret/config field across UI *and* API (deny-by-default spot-check, not a single happy path).
- An admin completes the full user lifecycle (approve → assign role → deactivate) **without touching the database**.
- An operator login is confirmed to process an order + edit a listing while being **blocked from credentials/users/webhooks/config** in both UI and API.
- The maintainer is comfortable making the demo URL the primary "try it" path in the README / landing.

## 8. Risks

Product-direction risks only (engineering risks → implementation plans):
- **R1 — Redaction is security-critical and partial failure leaks real secrets publicly.** A single missed field exposes a connected sandbox shop's marketplace credentials on a public URL — reputational, not just a bug. Direction implication: redaction must be **deny-by-default** (allow-list what non-admins see), and this is the gating risk for the demo go-live. *(Detailed enforcement point = /plan.)*
- **R2 — Operator role is analogy-validated, not adopter-validated (D2).** Risk of building operator affordances no real team uses. Mitigated by: operator is low marginal cost on top of the demo work, and write-scope is kept minimal; if it proves unused, it's cheap and harmless.
- **R3 — Approval friction on real installs.** Manual approval may annoy small self-hosters; mitigated by the per-install registration toggle + `OL_DEMO_MODE` auto-approve.
- **R4 — Scope sprawl.** B is ~L (redaction + registration/approval + user-mgmt UI + operator gating + demo seeding). Risk it balloons; mitigated by Phase E splitting into independently shippable slices with the demo-critical redaction + read-only path shippable first.

**Effort:** ~L (rough OOM ~5–7 weeks), splittable across the Phase E issues.

---

## Decision log

- **2026-06-22** — Refinement opened from #1123. Framed not as "add roles from zero" (a minimal `admin`/`viewer` seam already ships) but as "how far to deepen, given the system is currently unusable for delegation (no user-mgmt UI) and shallow."
- **2026-06-22 (Gate A loop)** — Maintainer introduced the **public hosted demo** as a concrete driver (D1), reframing it as primary over the analogy-based team-delegation driver (D2). Key consequence: D1 *requires* secret/credential redaction for untrusted read-only users — a capability the current `viewer` role lacks (it sees everything). This answers the open ambiguity #5 (real OL signal exists: the demo).
- **2026-06-22 (Gate A confirmed)** — Maintainer decisions:
  1. **Both D1 (demo) and D2 (team delegation) are in scope for v1** — not demo-only.
  2. **Secret/credential redaction for untrusted readers is in scope** (confirmed new capability).
  3. **Access model: self-service registration + admin approval.** Visitors/staff register; new accounts land in a **pending** state with no access; an admin approves (or rejects) and **assigns a role on approval**. One mechanism covers both drivers. (Open trade-off for Phase C: manual approval doesn't scale to high-volume anonymous demo traffic — acceptable if the demo is a gated "request access" model; revisit if open-firehose demo is wanted.)
  4. **In-tree vs fork — CONFIRMED in-tree.** Durable RBAC capabilities (registration+approval, hardened read-only/demo role with secret redaction, operator role) ship in OL **core**; "demo-ness" is expressed via deployment config + a seed script + an env flag, **not a code fork**. Rationale: the demo's hard parts are features every self-hoster + D2 wants, so forking them wastes their value and guarantees drift; demo-only concerns (seed data, reset, banner, rate-limit) are ops/config, not source. Detailed mechanism is Tier-2 `/plan`.
- **2026-06-22 (Gate C)** — Committed **Shape B** + borrow from C (wire `permissions[]` end-to-end, roles stay fixed presets) + `OL_DEMO_MODE` auto-approve sub-decision. Defer custom-role builder, per-connection scoping, full RBAC.
- **2026-06-22 (Gate D: YES)** — Engineering committed. Phase E spawned 4 implementation issues:
  - #1124 — Read-only role hardening: secret redaction + role-driven read gating (demo-critical, first; blocks #1126/#1127)
  - #1125 — Self-service registration + admin approval + user-management UI (blocks #1127)
  - #1126 — Operator role — write-scoped delegation (blocked by #1124, #1125)
  - #1127 — Demo posture: `OL_DEMO_MODE` flag, sandbox seed script, demo UX (blocked by #1124, #1125)

  Parent #1123 closed as `completed` (refinement process done; impl tracked on children). Per-issue next step: `/plan` (non-trivial: #1124 redaction enforcement point, #1125 user-status migration) or `/work` (trivial: #1126).
- **2026-06-22 (post-Phase E)** — UI-bearing children that introduce **new screens** (#1125 registration / approval-queue / user-management; #1127 demo banner + demo entry) carry a **design-first gate**: low-fidelity UI mockups must be created, shared, and approved **before** implementation, stored under `docs/plans/mockups/` and linked on the issue (produced at `/plan` time; per `docs/frontend-ui-style-guide.md`). #1124 / #1126 are exempt — they gate affordances on *existing* screens, not new design.
