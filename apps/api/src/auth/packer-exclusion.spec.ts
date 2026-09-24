/**
 * Packer-Exclusion Invariant (#2413, ADR-071, spec D12 / story A5)
 *
 * #2413 reviewed all 76 `@AnyRole()` routes against the new `packer` role and
 * narrowed 45 of them to `@Roles('admin', 'operator', 'viewer')` — the same
 * audience they had, named explicitly so the fourth role is excluded by
 * construction. The 31 that remain are listed below, one per line.
 *
 * ## Why an ALLOW-LIST and not a list of excluded controllers
 *
 * The first draft of this spec asserted "these controllers carry zero
 * `@AnyRole()`". That guards the controllers somebody thought of: a brand-new
 * buyer-PII controller under a new name is invisible to it, which is
 * structurally the hand-listed-array failure #2079's route-coverage spec went
 * to some trouble to remove.
 *
 * Inverted, it has no blind spot on that axis. `@AnyRole()` is the path of
 * least resistance for a new read — it is what #2079 applied to all 76 in the
 * first place, and the coverage spec accepts it as a valid declaration,
 * asserting only that *some* declaration exists and never what it says. So
 * every `@AnyRole()` site must appear here, and a new one fails the build
 * wherever it lands until somebody decides it against a bench session.
 *
 * ## There is a SECOND way to admit a packer, and it is guarded too
 *
 * `@Roles('admin', 'operator', 'viewer', 'packer')` admits one without ever
 * mentioning `@AnyRole()`. That is not hypothetical: #2416 and #2418 need
 * packer-reachable routes and will reach for exactly that spelling. So an
 * explicit grant must ALSO be listed — in its own array, because the two are
 * different acts. `@AnyRole()` on this list means "reviewed and left open";
 * an explicit grant means "deliberately given to the bench", which is the
 * stronger claim and deserves to be visible as such.
 *
 * **This list does not say the routes are correct — it says they were decided.**
 * The reasoning per group is in
 * `docs/plans/implementation-plan-bench-packer-role-idle-lock-handover.md`
 * § 2.3. Adding a line here is a decision to let a temporary packer on a shared
 * floor terminal call that route; removing one is free.
 *
 * ## Discovery is shared with the coverage spec, deliberately
 *
 * Both walk `*.controller.ts` and read Nest metadata, and both resolve the
 * handler as a UNIT the way `RolesGuard` does. A regex over source text would
 * not: it mis-reads a multi-line decorator, matches prose in a file header, and
 * cannot see a class-level declaration a handler overrides — all three were hit
 * while producing the inventory this list came from. Non-vacuity is asserted
 * below, because a walk that silently matched nothing would report green
 * forever.
 *
 * @module apps/api/src/auth
 */
import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ANY_ROLE_KEY } from './decorators/any-role.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';

const SRC_ROOT = resolve(__dirname, '..');

/**
 * Every route a `packer` may reach, as `Controller.handler`.
 *
 * Grouped by the reason each group survived the #2413 review.
 */
const PACKER_REACHABLE_ANY_ROLE_ROUTES: readonly string[] = [
  // Session self-service. `GET /auth/me` is what story A4 renders — the
  // signed-in name, visible without opening a menu. Excluding it breaks A4.
  'AuthController.getMe',
  'AuthController.updateAnalyticsConsent',

  // Item identity — what a packer scans against.
  'ProductsController.listProducts',
  'ProductsController.getProduct',
  'ProductsController.listVariantsByProduct',
  'ProductsController.getVariantSummary',
  'ProductsController.getTaxRateJournal',
  // The picture of the thing. A packer matches what is in their hand against
  // what is on the screen, and a catalogue photo is the fastest way to do
  // that - which is the whole reason the bench renders one. It discloses the
  // same product a packer may already read through `getProduct` beside it,
  // in a different encoding, so it is strictly narrower than the route it
  // accompanies rather than a new disclosure.
  'ProductsController.getProductImage',
  'VariantsController.searchVariants',

  // The `/count` siblings of the three LIST reads above (#2943). Each answers ONE
  // integer for the SAME filters as the list beside it, so it is a strictly
  // narrower disclosure than the route it accompanies: a packer who may see
  // the rows may certainly see how many there are. Listed rather than inferred
  // because this file's whole point is that `@AnyRole()` is decided per route,
  // and "it mirrors its sibling" is a decision somebody has to make.
  'ProductsController.countProducts',
  'ProductsController.countVariantsByProduct',
  'VariantsController.countSearchVariants',

  // The parcel's shipment and its label. The label goes ON the box and the
  // bench prints it (spec D14 / F1); `ShipmentResponseDto` carries no recipient.
  'ShipmentController.list',
  'ShipmentController.getActive',
  'ShipmentController.getById',
  'ShipmentController.downloadLabel',

  // Operational stock — distinct from the location REGISTER, which is
  // configuration and is excluded.
  'InventoryController.listInventory',
  'InventoryController.getAvailability',

  // Carrier reference data.
  'PickupPointController.search',
  'PickupPointController.getCached',

  // Returns — warehouse-adjacent, and the aggregate carries no buyer PII (the
  // controller allow-lists its projection and `rawPayload` is asserted absent).
  //
  // Two siblings were NARROWED out of this group by the #2905 review rather
  // than left here, because both are fiscal and both are WALKABLE from a route
  // this same session holds: `listReturnEvents` carries a refund amount and
  // currency keyed on an `internalOrderId` the bench work list hands out, and
  // `previewCorrectionProposal` carries an invoice id, its document number, a
  // currency and a per-line tax rate reachable from `listReturns` above. The
  // register principle is exclusion, not redaction.
  'ReturnsController.listReturns',
  'ReturnsController.getReturn',
  'ReturnsController.getIngestionAvailability',

  // Catalogue reads: no PII, no configuration, no money. Judged harmless rather
  // than needed — a packer has no route to them in the product.
  'ListingsController.listOfferMappings',
  'ListingsController.countOfferMappings',
  'ListingsController.getOfferMapping',
  'ListingsController.getMarketplaceOffer',
  'ListingsController.getOfferCreationStatus',
  'ShopPublishController.browseCategories',
  'ShopPublishController.listAttributes',
  'ShopPublishController.listAttributeTerms',
  'ShopPublishController.getRecord',
  'BulkListingController.getBatch',
  'BulkShopPublishController.getBatch',
];

/**
 * Routes that name `packer` EXPLICITLY — a deliberate grant to the bench, as
 * distinct from a route merely left open.
 *
 * Empty today: Surface A adds no packer-reachable route of its own (the bench
 * reads `GET /auth/me`, which is on the allow-list above). #2416/#2418 fill
 * this in with their work-scoped reads.
 */
const PACKER_GRANTED_ROUTES: readonly string[] = [
  // #2416, the first entry. The pack bench's own work list: parcels routed to
  // OpenLinker's packing executor and accepted there. Scoped to that work, no
  // query parameters a session could widen, no configuration, no write. It
  // discloses ONE buyer name per row, which is the name already going on the
  // label the same session is allowed to print (`ShipmentController.downloadLabel`
  // above), and nothing else from the order.
  'BenchWorkController.listBenchWork',

  // #2418, Surface D. ONE parcel, reached through the work rather than through
  // `/orders` — which #2413 closed because `orderSnapshot` carries the buyer's
  // name, email and BOTH un-redacted addresses under the default
  // `OL_STORE_PII=true`, a superset of the customer register. This projection is
  // an explicit allowlist: a reference, a buyer name, the lines' catalogue
  // identity and counts, and - since #3409 - the order total, its currency,
  // the carrier and the ship-by deadline. No address, no email, no phone.
  //
  // The four commercial fields are a DELIBERATE widening, not a leak: every
  // one of them is printed on the documents the packer is about to put in the
  // box, so withholding them from the screen while handing them over on paper
  // protected nothing and cost the packer the check that catches a wrong
  // parcel. The line that matters is unchanged - a packer still cannot reach
  // an address, a contact detail, or any order they are not packing.
  //
  // ADR-062 is NOT the authority for this list and must not be cited as one:
  // its subject is what crosses to a PLUGIN (`RoutingInput`, `HostServices`,
  // the router port), and it says nothing about what OpenLinker's own HTTP
  // surfaces show a signed-in operator. This spec is that authority.
  //
  // A parcel routed to any other executor answers 404.
  'BenchParcelController.getParcel',

  // #2418, Surface E. The two writes a bench makes. Both are scoped to a parcel
  // this bench may pack — the same eligibility rule the list applies — and
  // neither can reach an order, a customer or a document. There is deliberately
  // NO close route: the parcel closes on the last verification (D18).
  'BenchParcelController.verifyUnit',
  'BenchParcelController.reopenParcel',
  // #3405, mockup-parity epic #3401. A lighter correction than reopen: undo
  // the single most recent scan on an OPEN parcel, offered inline beside the
  // line a packer just scanned. Scoped the same way as the two writes above —
  // a parcel this bench may pack — and cannot reach a closed box, an order or
  // a document.
  'BenchParcelController.undoLastScan',
  // #3406, widened by #3415. An ephemeral Redis TTL presence heartbeat,
  // scoped exactly as `getParcel` scopes it. Discloses only another packer's
  // MASKED name ("A. Kowalska") — never a user id, never an unmasked
  // username — and only while that packer's own ping is fresh.
  'BenchParcelController.pingPresence',
  // #3411. A read: the verification ledger for one parcel, scoped exactly as
  // getParcel scopes it. Carries no buyer PII of its own beyond what
  // getParcel already discloses (a product name per entry).
  'BenchParcelController.getActivity',
  // #3412. A self-claim: can only ever assign the caller. Scoped exactly as
  // getParcel scopes it, plus the ADR-074 lock.
  'BenchParcelController.claimParcel',
  // #3412. Server-picked "whatever's next" over the same sorted, filtered
  // worklist listBenchWork returns; delegates to claimParcel for the actual
  // write and re-check.
  'BenchWorkController.claimNext',
  // pack-bench completion. Declare a parcel finished and off the bench — the completion act
  // after the last scan (label applied, invoice inside, box on the
  // trolley). Scoped exactly as getParcel scopes it, plus the ADR-074 lock a
  // scan already enforces; attributed to the verified token's own user, same
  // as verifyUnit.
  'BenchParcelController.completeParcel',
  // #3415. The way back from that completion, and the reason it needs one: the
  // only other route back was `reopenParcel` above, which UNPACKS the box, so a
  // packer who tapped the wrong row had to re-scan a parcel that was packed
  // correctly. It clears the completion and nothing else, is scoped exactly as
  // `completeParcel` is - the same eligibility rule, the same ADR-074 lock -
  // and is attributed to the verified token's own user.
  'BenchParcelController.undoCompletion',
  // #3413. Two reads, scoped exactly as listBenchWork scopes them.
  'BenchWorkController.listPackedToday',
  'BenchWorkController.getMetrics',

  // #2418, Surface F. The paper for THIS parcel, and the boxes that cannot go
  // out. `getDocuments` and `downloadInvoice` take a WORK id and no invoice id,
  // so neither can be walked into the invoicing register #2413 closed; the
  // carrier's own prose stays gated on `shipments:write` inside them, exactly as
  // `ShipmentResponseDto` gates it. `listUnlabelled` is read by the bench AND by
  // whoever runs dispatch, from one route so the two cannot disagree about a box
  // on a floor.
  'BenchDocumentsController.getDocuments',
  // The BYTES are the decision here, not the route shape. This streams the
  // rendered invoice, which carries the buyer's name, their billing address,
  // their tax id and the order's totals — everything the projection above is
  // an allow-list precisely to withhold. It is granted anyway because that
  // document is the sheet story F1 has the packer fold into this very box, so
  // a packer who may not read it is a packer who cannot do the job; it is
  // scoped to ONE work, creates nothing, and cannot be walked to anybody
  // else's paperwork. The asymmetry with `getParcel` is deliberate, not an
  // oversight.
  'BenchDocumentsController.downloadInvoice',
  'BenchDocumentsController.listUnlabelled',
  // #3415. The label, and it is granted for a NARROWER reason than the invoice
  // above: the sheet goes on the outside of the box and `ShipmentResponseDto`
  // carries no recipient, so the bytes disclose less than the invoice a packer
  // is already trusted with. The route exists at all because the stamp that
  // records the print used to live on the open `ShipmentController.downloadLabel`
  // route, which carries no role check - so ANY viewer fetching the PDF to look
  // at it marked the label printed, and that silenced the prompt warning a
  // packer they had not printed it. Reached through the work, like its invoice
  // sibling, so it cannot be walked to another parcel's label.
  'BenchDocumentsController.downloadLabel',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

interface InspectedRoute {
  readonly id: string;
  readonly declaresAnyRole: boolean;
  /** The route names `packer` in its own `@Roles(...)` list. */
  readonly grantsPacker: boolean;
}

/**
 * Known limitation, stated so it is a decision rather than an oversight:
 * `Object.getOwnPropertyNames(proto)` does not see a handler INHERITED from a
 * base controller class. No controller in `apps/api` extends another today,
 * and the route-coverage spec (#2079) shares the limitation.
 */
function inspect(): InspectedRoute[] {
  const routes: InspectedRoute[] = [];
  for (const file of walk(SRC_ROOT).sort()) {
    // Discovery is a filesystem walk, so the path is only known at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- runtime-discovered module path
    const mod = require(file) as Record<string, unknown>;
    for (const [name, cls] of Object.entries(mod)) {
      if (typeof cls !== 'function') continue;
      if (Reflect.getMetadata('path', cls) === undefined) continue;

      const classAnyRole = Reflect.getMetadata(ANY_ROLE_KEY, cls) === true;
      const proto = (cls as unknown as { prototype: Record<string, unknown> }).prototype;

      for (const handler of Object.getOwnPropertyNames(proto)) {
        if (handler === 'constructor' || typeof proto[handler] !== 'function') continue;
        const fn = proto[handler] as object;
        if (Reflect.getMetadata('method', fn) === undefined) continue;

        const handlerRoles = Reflect.getMetadata(ROLES_KEY, fn) as unknown[] | undefined;
        const handlerAnyRole = Reflect.getMetadata(ANY_ROLE_KEY, fn) === true;
        // Mirrors RolesGuard: the handler is resolved as a unit; the class is
        // consulted only when the handler declares neither.
        const handlerDeclares =
          (Array.isArray(handlerRoles) && handlerRoles.length > 0) || handlerAnyRole;

        const classRoles = Reflect.getMetadata(ROLES_KEY, cls) as unknown[] | undefined;
        const effectiveRoles = handlerDeclares ? handlerRoles : classRoles;

        routes.push({
          id: `${name}.${handler}`,
          declaresAnyRole: handlerDeclares ? handlerAnyRole : classAnyRole,
          grantsPacker: Array.isArray(effectiveRoles) && effectiveRoles.includes('packer'),
        });
      }
    }
  }
  return routes;
}

const allRoutes = inspect();
const anyRoleRoutes = allRoutes.filter((r) => r.declaresAnyRole).map((r) => r.id);
const packerGrantedRoutes = allRoutes.filter((r) => r.grantsPacker).map((r) => r.id);

describe('Packer exclusion (#2413)', () => {
  it('inspects a non-empty route set', () => {
    // Without this, every assertion below passes vacuously on a broken walk.
    expect(allRoutes.length).toBeGreaterThan(100);
  });

  it('finds @AnyRole() routes at all', () => {
    // The narrowing removed 45 of 76; if it ever removed all of them this list
    // would be an empty set nobody maintains, and the guard would be theatre.
    expect(anyRoleRoutes.length).toBeGreaterThan(0);
  });

  it('admits `packer` to no route outside the reviewed allow-list', () => {
    const allowed = new Set(PACKER_REACHABLE_ANY_ROLE_ROUTES);
    const unreviewed = anyRoleRoutes
      .filter((id) => !allowed.has(id))
      .map(
        (id) =>
          `${id} carries @AnyRole(), which admits the \`packer\` role (#2413) — a ` +
          'temporary packer on a shared floor terminal. Decide it: name the roles ' +
          "explicitly with @Roles('admin', 'operator', 'viewer') to exclude them, or " +
          'add the route to PACKER_REACHABLE_ANY_ROLE_ROUTES with the group it joins.'
      );
    expect(unreviewed).toEqual([]);
  });

  it('grants `packer` explicitly only where the grant is recorded', () => {
    // The second axis. Without this, `@Roles(..., 'packer')` on a new route
    // opens the bench role to it with nothing failing anywhere.
    const granted = new Set(PACKER_GRANTED_ROUTES);
    const unrecorded = packerGrantedRoutes
      .filter((id) => !granted.has(id))
      .map(
        (id) =>
          `${id} names 'packer' in its @Roles(...) — a deliberate grant to the ` +
          'pack bench. Record it in PACKER_GRANTED_ROUTES with the surface that ' +
          'needs it, so the set of routes a temporary packer can reach stays ' +
          'readable in one place.'
      );
    expect(unrecorded).toEqual([]);
  });

  it('records no explicit grant that has since been withdrawn', () => {
    const live = new Set(packerGrantedRoutes);
    expect(PACKER_GRANTED_ROUTES.filter((id) => !live.has(id))).toEqual([]);
  });

  it('lists no route that has since been narrowed or removed', () => {
    // The other direction. A stale entry is a standing licence for a route to
    // silently reopen — the failure #2791 recorded for the cross-context
    // import allow-list, one guard over.
    const live = new Set(anyRoleRoutes);
    const stale = PACKER_REACHABLE_ANY_ROLE_ROUTES.filter((id) => !live.has(id));
    expect(stale).toEqual([]);
  });
});
