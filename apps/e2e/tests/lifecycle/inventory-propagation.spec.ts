/**
 * Order lifecycle: cross-channel stock propagation + oversell safety
 *
 * Part of #1574. A single master stock change must fan out to every mapped
 * marketplace offer (Allegro, Erli) and shop-published product (WooCommerce,
 * #1508) in one `inventory.propagateToMarketplaces` pass
 * (`InventoryPropagateToMarketplacesHandler`,
 * docs/architecture-overview.md § Inventory). Propagation writes an ABSOLUTE
 * quantity from master (never a per-channel relative decrement), which is
 * exactly what makes overselling impossible: once master reads 0, every
 * mapped channel converges to 0 — none can be left stranded at a stale
 * positive value another channel already sold into.
 *
 * This spec drives that fan-out twice against a REAL existing product whose
 * EAN variant already carries a marketplace offer mapping (reuses whatever
 * golden-path/operator-setup runs already created — no bulk-offer-wizard UI
 * driving here, to avoid duplicating that large surface; the fixture must be
 * SINGLE-VARIANT, because the PrestaShop stock write this spec drives can only
 * reach the product-level aggregate row - see `findChannelMappedProduct` - and a
 * stack with no such offers yet SKIPS both tests rather than running them
 * channel-less):
 *   1. Master stock -1 (via a real PrestaShop stock write + a real master
 *      inventory sync) -> assert every live channel converges to the SAME new
 *      quantity.
 *   2. Master stock -> 0 (the oversell-safety proof: an out-of-stock variant
 *      lists as 0 on EVERY channel, not left non-zero on a channel that
 *      hasn't "seen" the second sale) -> assert every live channel converges
 *      to exactly 0.
 * PrestaShop stock is restored to its original value in `afterAll`, and the
 * master sync + cross-channel fan-out are RE-RUN off that baseline, so the spec
 * is non-destructive on a shared stack. Restoring PrestaShop alone is not
 * enough: the second scenario drives master to 0 and 0 propagates, so without
 * the re-sync every mapped channel offer would be left parked at quantity 0.
 *
 * Self-configuring: skips when there's no PrestaShop connection/webservice
 * key (needed to move real stock) or no PrestaShop-mastered product whose EAN
 * variant is already mapped to a marketplace channel.
 *
 * What is HARD vs SOFT per channel. Hard: OL enqueued and ran the fan-out
 * `marketplace.offerQuantity.update` job for that channel, carrying exactly the
 * post-sync master quantity. Soft (annotated): the channel offer's own quantity
 * converging, because Allegro applies a quantity change asynchronously over
 * minutes (cf #1520), and the WooCommerce leg, whose stock write-back is
 * default-OFF (per S9 in full-flow.spec.ts). The split matters: with only the
 * soft half, the handler could stop writing to a channel entirely and this file
 * stayed green.
 *
 * @module tests/lifecycle
 */
import type { TestInfo } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import { PlatformType, type World } from '../../src/world/world';
import type { ApiClient } from '../../src/api/api-client';
import { ApiError } from '../../src/api/api-error';
import type {
  Connection,
  MarketplaceOffer,
  Product,
  ProductVariant,
  SyncJob,
} from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { waitForAvailabilityValue } from '../../src/support/stock';
import type { SyncJobs } from '../../src/support/jobs';
import { PollTimeoutError, pollFailureCause, type Poller } from '../../src/support/poller';

// `mode: 'serial'` only. The per-test timeout override is GONE: it justified
// itself against "the project's default 90s per-test budget", but the config
// default is `timeout: 600_000` (`playwright.config.ts`), so the 300s override
// HALVED the budget for two of the slowest specs in the suite - the opposite of
// what the comment claimed it was doing. The default backstop already sits above
// every internal wait these tests chain (a real PrestaShop stock write + a
// worker master-sync job + a cross-channel propagation job + a per-channel
// convergence poll), and each of those waits is individually bounded, so a
// genuinely stuck run still fails at the responsible poll rather than at a bare
// test timeout.
test.describe.configure({ mode: 'serial' });

test.describe('lifecycle: cross-channel stock propagation + oversell safety (#1574)', () => {
  let prestashop: Connection | undefined;
  let ps: PrestashopWebserviceClient | null = null;
  let product: Product | undefined;
  let variant: ProductVariant | undefined;
  let psExternalId: string | undefined;
  let originalPsStock: number | null = null;

  test.beforeAll(async ({ api, world }) => {
    prestashop = world.connectionFor(PlatformType.prestashop);
    ps = buildPrestashopClient(world);
    if (!prestashop || !ps) return;

    // The fan-out assertion needs a PrestaShop-mastered product whose variant
    // (a) carries an EAN and (b) is mapped to at least one marketplace channel
    // (Allegro/Erli) — so there is a real channel quantity to observe converge.
    // Multi-variant products are EXCLUDED, not merely un-required: this spec's
    // PrestaShop stock write can only reach the product-level aggregate row, so
    // on a multi-variant product it would move nothing and then fail pointing at
    // propagation. See `findChannelMappedProduct` for the full mechanism.
    const found = await findChannelMappedProduct(api, world, prestashop.id);
    if (!found) return;

    product = found.product;
    variant = found.variant;
    psExternalId = found.psExternalId;
    originalPsStock = await ps.getStockForProduct(found.psExternalId);
  });

  test.afterAll(async ({ api, jobs }) => {
    if (!ps || !psExternalId || originalPsStock === null || !prestashop || !product || !variant) {
      return;
    }
    // Writing PrestaShop back is only ONE THIRD of the restore. The second test
    // deliberately drives master stock to 0, and 0 propagates: without re-running
    // the master sync and the fan-out here, the run ends with OL availability at
    // 0 and every mapped Allegro/Erli offer parked at 0 quantity on a SHARED
    // stack - which then fails the next `stale-variant-pruning` run and, worse,
    // silently de-lists real sandbox offers. So: push the baseline back to
    // PrestaShop, re-sync master off it, then fan that value out again.
    //
    // Every step is best-effort and independently caught. A teardown must not
    // turn a passing run red nor bury a real failure, and a partial restore
    // (stock back, propagation not) is still strictly better than none - but it
    // is reported, because a channel left at 0 is exactly the damage this hook
    // exists to prevent.
    try {
      await ps.setStock(psExternalId, originalPsStock);
      await jobs.triggerAndWait({
        connectionId: prestashop.id,
        jobType: 'master.inventory.syncByExternalId',
        payload: { externalId: psExternalId, objectType: 'Product' },
      });
      await jobs.triggerAndWait({
        connectionId: prestashop.id,
        jobType: 'inventory.propagateToMarketplaces',
        payload: {
          productId: product.id,
          variantId: variant.id,
          inventoryUpdatedAt: new Date().toISOString(),
        },
      });
      // Cheap confirmation that OL's own projection actually came back, so the
      // warning below fires on a silently-failed restore too, not only on a throw.
      await waitForAvailabilityValue(api, variant.id, originalPsStock, 120_000);
    } catch (error) {
      console.warn(
        `[e2e] MANUAL FOLLOW-UP: could not fully restore stock for product ${product.id} / variant ` +
          `${variant.id} to ${originalPsStock} (${String(error)}). This spec drives master stock to 0, ` +
          'so the mapped marketplace offers may be left at quantity 0 on a shared stack. Re-run the ' +
          'master inventory sync + cross-channel propagation for that product.',
      );
    }
  });

  test('one master stock change fans out to every mapped channel', async ({ api, world, jobs, poll }, testInfo) => {
    test.skip(!prestashop || !ps, 'no PrestaShop connection/webservice key on this stack');
    test.skip(!product || !variant || !psExternalId, 'no SINGLE-VARIANT PrestaShop-mastered product whose EAN variant is mapped to a marketplace channel (run golden-path/operator-setup first). Multi-variant products are deliberately excluded - see findChannelMappedProduct');
    expect(originalPsStock, 'baseline PrestaShop stock was captured').not.toBeNull();

    const targets = await requireChannelTargets(api, world, variant!.id);

    // The new value MUST differ from the baseline. `Math.max(baseline - 2, 1)`
    // equals the baseline whenever PS stock is exactly 1: the write becomes a
    // no-op, `waitForAvailabilityValue(..., 1, ...)` is satisfied by the
    // pre-existing state on its FIRST probe, and the whole scenario passes in
    // ~2s with propagation entirely broken. Step up instead when stepping down
    // cannot move, then assert the choice is genuinely a change.
    const steppedDown = originalPsStock! > 2 ? originalPsStock! - 2 : originalPsStock! + 3;
    expect(
      steppedDown,
      'the test stock value must DIFFER from the baseline, or every downstream wait is satisfied ' +
        'by the pre-work state and proves nothing',
    ).not.toBe(originalPsStock);
    await syncMasterStock(ps!, jobs, prestashop!.id, psExternalId!, steppedDown);
    await waitForAvailabilityValue(api, variant!.id, steppedDown, 120_000);
    await propagateAndAssertChannels(api, jobs, poll, prestashop!.id, product!.id, variant!.id, targets, steppedDown, testInfo);
  });

  test('driving master to 0 drives EVERY mapped channel to 0 (oversell safety)', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    test.skip(!prestashop || !ps, 'no PrestaShop connection/webservice key on this stack');
    test.skip(!product || !variant || !psExternalId, 'no SINGLE-VARIANT PrestaShop-mastered product whose EAN variant is mapped to a marketplace channel (run golden-path/operator-setup first). Multi-variant products are deliberately excluded - see findChannelMappedProduct');

    const targets = await requireChannelTargets(api, world, variant!.id);

    await syncMasterStock(ps!, jobs, prestashop!.id, psExternalId!, 0);
    await waitForAvailabilityValue(api, variant!.id, 0, 120_000);
    // Master is authoritative INCLUDING 0 (#824) — every channel must converge
    // to exactly 0, never be left stranded at a stale positive quantity.
    await propagateAndAssertChannels(api, jobs, poll, prestashop!.id, product!.id, variant!.id, targets, 0, testInfo);
  });
});

// ── local helpers ───────────────────────────────────────────────────────────

interface ChannelMappedProduct {
  product: Product;
  variant: ProductVariant;
  psExternalId: string;
}

/**
 * Find the first SINGLE-VARIANT PrestaShop-mastered product whose EAN-carrying
 * variant has a live offer mapping on at least one marketplace channel — the
 * minimal fixture the fan-out scenario needs. Returns the first qualifying
 * product/variant, or null when none exists (both tests then skip).
 *
 * MULTI-VARIANT PRODUCTS ARE UNREACHABLE FROM THIS FIXTURE, by construction of
 * the two PrestaShop helpers it drives:
 *
 *   - `setStock` writes ONLY the `id_product_attribute = 0` aggregate row
 *     (`prestashop-webservice.ts` hardcodes `writeStockRow(productId, '0', …)`).
 *   - `getStockForProduct` PREFERS the combination rows and falls back to the
 *     aggregate only when there are none.
 *
 * On a multi-variant product that mismatch is silently destructive: the baseline
 * read is the combination SUM, the write lands on an aggregate PrestaShop
 * derives from the combinations (so per-combination quantities never move, and
 * OL's variant-keyed availability never moves either), the availability wait
 * burns its full budget and fails pointing at PROPAGATION rather than at the
 * fixture, and the teardown then writes the combination sum back into the
 * aggregate row - corrupting it if that write does land.
 *
 * Gating here is the conservative fix. Reaching multi-variant products properly
 * needs a variant-aware `setStock` overload (`writeStockRow` already takes an
 * `attributeId`) plus an OL-variant -> PS-combination-id resolution; the
 * per-variant fan-out itself is already covered by the golden path.
 */
async function findChannelMappedProduct(
  api: ApiClient,
  world: World,
  prestashopConnectionId: string,
): Promise<ChannelMappedProduct | null> {
  const products = await world.listProducts(50);
  for (const summary of products) {
    const detail = await api.products.getById(summary.id);
    const psExternalId = externalIdFor(detail.externalIds, prestashopConnectionId);
    if (!psExternalId) continue;
    const variants = await world.variantsOf(detail.id);
    if (variants.length > 1) continue;
    for (const candidate of variants) {
      if (!(candidate.ean ?? candidate.gtin)) continue;
      const targets = await resolveChannelTargets(api, world, candidate.id);
      if (targets.length > 0) {
        return { product: detail, variant: candidate, psExternalId };
      }
    }
  }
  return null;
}

interface ChannelTarget {
  platformType: string;
  connectionId: string;
  mappingId: string;
}

/**
 * Resolve the channel targets, failing when there are none.
 *
 * NOT an annotation: `beforeAll` selects the fixture product BY the existence of
 * at least one channel mapping, so an empty list here means a mapping vanished
 * mid-run - an anomaly, not a stack that hasn't been set up. Tolerating it (the
 * previous behaviour) meant the oversell-safety test could run its whole body
 * with zero channels and still report green, which is precisely the claim it
 * exists to make.
 */
async function requireChannelTargets(
  api: ApiClient,
  world: World,
  variantId: string,
): Promise<ChannelTarget[]> {
  const targets = await resolveChannelTargets(api, world, variantId);
  expect(
    targets.length,
    `variant ${variantId} must still carry at least one marketplace offer mapping - beforeAll ` +
      'picked this product because it had one, so an empty list means the mapping disappeared ' +
      'mid-run and there is no channel left for the fan-out assertion to prove anything about',
  ).toBeGreaterThan(0);
  return targets;
}

/** Resolve the variant's offer mapping on every marketplace connection that has one. */
async function resolveChannelTargets(
  api: ApiClient,
  world: World,
  variantId: string,
): Promise<ChannelTarget[]> {
  const targets: ChannelTarget[] = [];
  for (const platformType of [PlatformType.allegro, PlatformType.erli]) {
    const connection = world.connectionFor(platformType);
    if (!connection) continue;
    const page = await api.listings.list({ connectionId: connection.id, internalId: variantId, limit: 5 });
    const mapping = page.items.find((m) => m.internalId === variantId);
    if (mapping) targets.push({ platformType, connectionId: connection.id, mappingId: mapping.id });
  }
  return targets;
}

/** Push a new PrestaShop stock value, then run the targeted master inventory sync. */
async function syncMasterStock(
  ps: PrestashopWebserviceClient,
  jobs: SyncJobs,
  prestashopConnectionId: string,
  psExternalId: string,
  newStock: number,
): Promise<void> {
  await ps.setStock(psExternalId, newStock);
  await jobs.triggerAndWait(
    {
      connectionId: prestashopConnectionId,
      jobType: 'master.inventory.syncByExternalId',
      payload: { externalId: psExternalId, objectType: 'Product' },
    },
    // 120s (not 60s): the single-threaded worker can have a couple of
    // long-running jobs (e.g. a KSeF reconcile) ahead of this one, leaving the
    // queued inventory sync waiting a while before it's picked up. The job
    // itself completes quickly once started, so the shared default budget
    // (`DEFAULT_JOB_WAIT_MS`, sized to the stack's observed queue latency)
    // applies rather than a local, smaller one.
  );
}

/**
 * The per-target job the propagation handler fans out to
 * (`InventoryPropagateToMarketplacesHandler.enqueueQuantityUpdate`). Mirrored
 * here for the same reason `JobType` mirrors the core job-type strings.
 */
const OFFER_QUANTITY_UPDATE_JOB_TYPE = 'marketplace.offerQuantity.update';

/** Trigger cross-channel propagation and assert every resolved channel converges to `expectedQty`. */
async function propagateAndAssertChannels(
  api: ApiClient,
  jobs: SyncJobs,
  poll: Poller,
  anchorConnectionId: string,
  productId: string,
  variantId: string,
  targets: ChannelTarget[],
  expectedQty: number,
  testInfo: TestInfo,
): Promise<void> {
  // The handler stamps this value verbatim into each fan-out child's
  // idempotency key (its "write event token"), which is what lets the
  // per-channel assertion below find THIS run's children and no others.
  const writeEventToken = new Date().toISOString();
  await jobs.triggerAndWait(
    {
      connectionId: anchorConnectionId,
      jobType: 'inventory.propagateToMarketplaces',
      payload: { productId, variantId, inventoryUpdatedAt: writeEventToken },
    },
  );

  for (const target of targets) {
    // HARD, latency-free proof that the fan-out reached THIS channel with the
    // right number.
    //
    // Everything below this used to be soft, so `InventoryPropagateToMarketplaces
    // Handler` could stop writing to Allegro entirely and both tests in this file
    // stayed green - including the one titled "oversell safety". The channel's
    // own quantity genuinely cannot be hard-asserted (see the soft poll below),
    // but the OL-side write can: the handler enqueues one
    // `marketplace.offerQuantity.update` job per offer mapping, on the mapping's
    // OWN connection, carrying the submitted quantity inside its idempotency key.
    // No enqueue -> no such job -> this fails, which is exactly the regression
    // the soft path could not catch.
    const child = await waitForFanOutJob(api, poll, {
      connectionId: target.connectionId,
      variantId,
      writeEventToken,
      label: target.platformType,
    });
    expect(
      child.status,
      `${target.platformType}: the fan-out quantity-update job ${child.id} must succeed` +
        `${child.lastError ? ` (lastError: ${child.lastError})` : ''}`,
    ).toBe('succeeded');
    expect(
      child.outcome,
      `${target.platformType}: the fan-out quantity-update job must not be a business failure`,
    ).not.toBe('business_failure');
    expect(
      submittedQuantityOf(child.idempotencyKey!, writeEventToken),
      `${target.platformType}: OL submitted the post-sync master quantity to the channel ` +
        '(master is authoritative INCLUDING 0, #824)',
    ).toBe(expectedQty);

    const offer = await readLiveOfferOrNull(api, target.mappingId);
    if (offer === null) {
      testInfo.annotations.push({
        type: 'propagation-degrade',
        description: `${target.platformType}: no OfferReader (mapping-level only) — verify quantity ${expectedQty} manually`,
      });
      continue;
    }
    // The channel offer's OWN quantity converging is SOFT: Allegro applies a
    // quantity change through an async draft -> under-the-hood accept ->
    // re-publish lifecycle that can take many minutes (the same delayed-
    // activation behaviour as #1520), well beyond a practical e2e budget, and
    // its `offer-quantity-change-commands` stay `pending` against the sandbox in
    // the meantime. So a non-convergence is annotated as that known
    // marketplace-apply latency - but ONLY a timeout is. A bare `catch` also
    // absorbed every 4xx/5xx the probe raised and the exact-value mismatch
    // below, which is what made the whole channel branch unfalsifiable.
    //
    // 60s (was 120s): the hard proof above no longer depends on this poll, so
    // there is nothing to gain from waiting out a latency we have already
    // documented as unbounded.
    let settled: MarketplaceOffer | null = null;
    try {
      settled = await poll.until(
        () => api.listings.getOffer(target.mappingId),
        (o) => o.availableQuantity === expectedQty,
        {
          message: `${target.platformType} offer quantity to converge to ${expectedQty}`,
          timeoutMs: 60_000,
        },
      );
    } catch (error) {
      if (!(error instanceof PollTimeoutError)) throw error;
      // A probe that kept erroring is a broken read, not apply latency.
      const cause = pollFailureCause(error);
      if (cause instanceof ApiError) throw error;
      settled = null;
    }
    if (settled) {
      expect(settled.availableQuantity, `${target.platformType} offer quantity`).toBe(expectedQty);
    } else {
      testInfo.annotations.push({
        type: 'propagation-degrade',
        description:
          `${target.platformType}: OL submitted quantity ${expectedQty} to the channel (asserted above via` +
          ` the fan-out job), but the live offer had not converged within the poll budget - Allegro applies a` +
          ` quantity change via an async draft/accept/re-publish cycle (minutes; cf #1520), so this is annotated` +
          ` as marketplace-apply latency, not a propagation defect`,
      });
    }
  }

  // WooCommerce: only a real fan-out target when stock write-back is enabled
  // for the connection (OfferManager on a non-inventory-master WC connection,
  // #1498) — off by default, so a stale value here is an annotated known gap,
  // never a hard failure (mirrors full-flow.spec.ts S9).
  testInfo.annotations.push({
    type: 'propagation-wc',
    description:
      'WooCommerce fan-out requires stock write-back enabled (OfferManager on the WC connection, ' +
      'off by default) — not asserted here; see full-flow.spec.ts S9 for the same documented gap',
  });
}

/**
 * Wait for the fan-out `marketplace.offerQuantity.update` job this propagation
 * enqueued for one channel connection, and return it once terminal.
 *
 * Matched on the idempotency key the handler builds:
 *
 *   inventory:{connectionId}:{productId}:{variantId|base}:{quantity}:{writeEventToken}
 *
 * The token is the `inventoryUpdatedAt` the caller passed, unique per run, so
 * the suffix match cannot pick up an ambient propagation for another product -
 * and matching on suffix + variant id rather than reconstructing the whole key
 * means the assertion does not have to predict the quantity segment (which is
 * the very thing it then reads out of the key).
 */
async function waitForFanOutJob(
  api: ApiClient,
  poll: Poller,
  input: { connectionId: string; variantId: string; writeEventToken: string; label: string },
): Promise<SyncJob> {
  const job = await poll.until<SyncJob | undefined>(
    async () => {
      const page = await api.syncJobs.list({
        connectionId: input.connectionId,
        jobType: OFFER_QUANTITY_UPDATE_JOB_TYPE,
        limit: 50,
      });
      return page.items.find(
        (candidate) =>
          !!candidate.idempotencyKey &&
          candidate.idempotencyKey.endsWith(`:${input.writeEventToken}`) &&
          candidate.idempotencyKey.includes(`:${input.variantId}:`),
      );
    },
    (candidate) => candidate !== undefined && candidate.status !== 'queued' && candidate.status !== 'running',
    {
      message:
        `${input.label}: the propagation fan-out to enqueue a ${OFFER_QUANTITY_UPDATE_JOB_TYPE} job for ` +
        `variant ${input.variantId} (write-event token ${input.writeEventToken}) and run it to a terminal ` +
        'status. Nothing found means the handler did not write to this channel at all; if the handler DID ' +
        'run, check that its idempotency-key format still matches the mirror in this file',
      timeoutMs: 120_000,
      intervalMs: 2_000,
    },
  );
  return job!;
}

/** The quantity segment OL stamped into a fan-out job's idempotency key. */
function submittedQuantityOf(idempotencyKey: string, writeEventToken: string): number {
  // Split-on-':' is not an option: the token is an ISO timestamp and carries
  // colons of its own. Strip the known suffix, then take the last segment.
  const head = idempotencyKey.slice(0, idempotencyKey.length - writeEventToken.length - 1);
  return Number(head.slice(head.lastIndexOf(':') + 1));
}

/**
 * Live-offer read guarded by capability: `GET /listings/:id/offer` 422s when
 * the connection's adapter ships no `OfferReader` (Erli today).
 */
async function readLiveOfferOrNull(api: ApiClient, mappingId: string): Promise<MarketplaceOffer | null> {
  try {
    return await api.listings.getOffer(mappingId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return null;
    throw error;
  }
}

function externalIdFor(externalIds: Product['externalIds'], connectionId: string): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

function buildPrestashopClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl = process.env.OL_PS_ADMIN_URL?.trim() || readConfigString(connection?.config, 'baseUrl');
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
