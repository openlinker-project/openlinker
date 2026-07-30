/**
 * Order lifecycle: stale-variant offer pause (#1689)
 *
 * The sibling spec (`stale-variant-pruning.spec.ts`, #1495) proves that deleting
 * a variant at the master stales OL's availability, and that an EXPLICIT
 * `inventory.propagateToMarketplaces` trigger then pushes 0 to the channel. That
 * left the marketplace fail-open: nothing zeroed a live offer on its own, so a
 * buyer could keep buying a product that no longer exists at the master until an
 * operator noticed.
 *
 * #1689 closes it with three moving parts, one test each here:
 *
 *   1. TRIGGER — the master-deletion event (`events.master.deletion`) is consumed
 *      by `MasterDeletionToJobHandler`, which enqueues
 *      `marketplace.offer.pauseStale`; `StaleOfferPauseService` re-verifies each
 *      variant is still stale and zeroes its mapped offers. Asserted by driving
 *      ONLY the master sync and letting OL enqueue the pause itself — no
 *      client-side propagate trigger, which is exactly what distinguishes this
 *      from the #1495 spec.
 *   2. GUARANTEE — the hourly `marketplace.offer.pauseStaleSweep` re-asserts the
 *      pause straight from the persisted `isStale` flag, closing the at-most-once
 *      gap left by a lost event. Asserted by triggering the sweep explicitly
 *      (same handler the cron drives) and checking the offer stays at 0.
 *   3. HONESTY — a FULL master deletion terminates the sync job as
 *      `succeeded + outcome=business_failure + outcomeReason='master_deleted'`
 *      (ADR-007: a permanent condition must not be retried), and the jobs UI
 *      labels that row "source deleted" rather than a generic failure.
 *
 * DESTRUCTIVE. Tests 1-2 delete a real PrestaShop combination via the webservice
 * (`DELETE /api/combinations/:id`) with no undo, so they are gated behind
 * `E2E_ALLOW_DESTRUCTIVE_PRUNE=true` — same opt-in as the #1495 spec. Test 3 is
 * self-contained: it CREATES its own throwaway product and deletes that, so it
 * never touches the catalogue and needs no opt-in.
 *
 * @module tests/lifecycle
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { ApiError } from '../../src/api/api-error';
import type { Connection, Product, ProductVariant, SyncJob } from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { JobType } from '../../src/support/jobs';

/** Marketplaces whose offer mappings this spec checks for the pause. */
const CHANNEL_PLATFORMS = [PlatformType.allegro, PlatformType.erli] as const;

interface ChannelMapping {
  platformType: string;
  connectionId: string;
  mappingId: string;
}

/**
 * State handed from test 1 (which performs the irreversible deletion) to test 2
 * (which re-asserts the same offers via the sweep). Safe because the describe is
 * `mode: 'serial'` with `retries: 0` — and it avoids a second destructive
 * deletion just to give the sweep something to find.
 */
let pausedChannels: ChannelMapping[] = [];

// Serial: test 2 observes what test 1 paused. The 5-min budget covers the
// chained worker waits (two master syncs + the auto-enqueued pause job + the
// channel read); on a stack with a job backlog each individual wait is what
// bounds the run, not this ceiling. Mirrors inventory-propagation.spec.ts.
test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.describe('lifecycle: stale-variant offer pause (#1689)', () => {
  test('a variant deleted at the master pauses its mapped offers with no manual propagate trigger', async ({
    api,
    page,
    world,
    jobs,
    poll,
    env,
  }, testInfo) => {
    test.skip(
      !env.allowDestructivePrune,
      "destructive — set E2E_ALLOW_DESTRUCTIVE_PRUNE=true on a stack you don't mind losing a variant on",
    );
    const master = world.connectionWithCapability('ProductMaster', PlatformType.prestashop);
    test.skip(!master, 'no PrestaShop ProductMaster connection on this stack');
    const ps = buildPrestashopClient(master!);
    test.skip(!ps, 'no PrestaShop webservice key/base URL (OL_PS_WEBSERVICE_KEY / OL_PS_ADMIN_URL)');

    // Candidate selection is resolved against PRESTASHOP, not against OL's
    // variant count. `world.findMultiVariantProduct` counts OL rows, which
    // include variants already marked stale by an earlier run of this spec — so
    // "3 OL variants" can mean "1 live PrestaShop combination", and asserting on
    // OL's count alone makes the test fail on its own second run. The helper
    // below also PREFERS a candidate whose target variant carries a live offer
    // mapping, so the channel assertion further down actually exercises.
    const candidate = await findPausableCandidate(api, world, ps!, master!.id);
    test.skip(
      !candidate,
      'no PrestaShop-backed multi-combination product with an EAN-resolvable last combination',
    );
    const { product, psExternalId, toDelete, variant, channels } = candidate!;

    testInfo.annotations.push({
      type: 'candidate',
      description: `product ${product.id} (PS ${psExternalId}), target variant ${variant.id} (EAN ${toDelete.ean13}), offer mappings: ${channels.length > 0 ? channels.map((c) => c.platformType).join(', ') : 'none'}`,
    });

    // Baseline: a targeted master sync so every combination present at the master
    // has a live (non-stale) OL row before anything is deleted.
    await jobs.triggerAndWait(
      {
        connectionId: master!.id,
        jobType: JobType.masterProductSyncByExternalId,
        payload: { externalId: psExternalId, objectType: 'Product' },
      },
      { timeoutMs: 120_000 },
    );

    const before = await api.inventory.availability([variant.id]);
    expect(
      before.find((r) => r.productVariantId === variant.id)?.totalAvailable,
      'the variant has non-stale availability before deletion',
    ).toBeGreaterThan(0);

    testInfo.annotations.push({
      type: 'destructive-prune',
      description: `deleting PrestaShop combination ${toDelete.id} (EAN ${toDelete.ean13}) of product ${psExternalId} — irreversible`,
    });

    // Everything below this line is the assertion: the ONLY thing this spec
    // drives after the deletion is the master sync. The pause job must appear on
    // its own.
    const deletedAt = new Date();
    await ps!.deleteCombination(toDelete.id);

    await jobs.triggerAndWait(
      {
        connectionId: master!.id,
        jobType: JobType.masterProductSyncByExternalId,
        payload: { externalId: psExternalId, objectType: 'Product' },
      },
      { timeoutMs: 120_000 },
    );

    // NOTE deliberately NOT asserted here: OL master availability reaching 0.
    // That is the INVENTORY context's prune (`master.inventory.syncByExternalId`
    // -> `pruneStaleVariants`), which the #1495 spec already owns and which this
    // test never triggers. The products-context prune driven above is what
    // publishes `events.master.deletion`, and `StaleOfferPauseService`
    // re-verifies `isStale` itself before zeroing — so a paused offer proves the
    // staleness transitively, without borrowing the sibling spec's signal.

    // 1. OL enqueued the pause itself, off the master-deletion event.
    const pauseJob = await jobs.waitForAutoEnqueuedPauseStale(deletedAt, { timeoutMs: 120_000 });
    expect(
      pauseJob.status,
      `auto-enqueued ${JobType.marketplaceOfferPauseStale} job ${pauseJob.id} status`,
    ).toBe('succeeded');
    expect(pauseJob.outcome, `${pauseJob.id} outcome`).not.toBe('business_failure');

    // Operator-visible proof that OL reacted on its own: the pause job's own
    // detail page. Attached rather than asserted — the assertions above are the
    // contract; this is the artifact a reviewer can look at.
    await page.goto(`/jobs-logs/${pauseJob.id}`);
    await expect(page.getByText(JobType.marketplaceOfferPauseStale).first()).toBeVisible();
    await testInfo.attach('auto-enqueued-pause-stale-job', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // 2. The pause fanned out an absolute quantity-0 write per mapped offer.
    //    This — not the remote read below — is OL's contract: the pause is
    //    "OL pushes 0 to every mapped offer", and whether the marketplace has
    //    APPLIED it yet is the marketplace's business.
    if (channels.length === 0) {
      testInfo.annotations.push({
        type: 'pause-channel-skip',
        description: `variant ${variant.id} had no marketplace offer mapping — the pause job ran (asserted above) but no per-offer quantity write could be observed`,
      });
    }
    for (const channel of channels) {
      const writes = await jobs.waitForOfferQuantityUpdates(channel.connectionId, deletedAt, 1, {
        timeoutMs: 180_000,
      });
      expect(
        writes.length,
        `${channel.platformType}: quantity-write job(s) fanned out by the pause`,
      ).toBeGreaterThanOrEqual(1);
      for (const write of writes) {
        expect(write.status, `${channel.platformType} quantity write ${write.id} status`).toBe(
          'succeeded',
        );
      }
    }

    // 3. Best-effort, NEVER a hard failure: read the quantity back from the
    //    marketplace. On Allegro the write is an async
    //    `offer-quantity-change-command`; the SANDBOX routinely leaves such a
    //    command `pending` forever (OL logs "did not reach terminal status after
    //    5 polling attempts"), and an INACTIVE offer keeps reporting its old
    //    quantity. Asserting the remote read would therefore fail on a
    //    marketplace-side condition OL cannot influence — so a non-zero read is
    //    recorded as an annotation for the operator, not as a defect.
    for (const channel of channels) {
      try {
        const offer = await poll.until(
          () => api.listings.getOffer(channel.mappingId),
          (o) => o.availableQuantity === 0,
          {
            message: `${channel.platformType} offer quantity to read back as 0`,
            timeoutMs: 60_000,
          },
        );
        testInfo.annotations.push({
          type: 'pause-channel-confirmed',
          description: `${channel.platformType} offer ${offer.externalId} reads 0 at the marketplace`,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          testInfo.annotations.push({
            type: 'pause-channel-degrade',
            description: `${channel.platformType}: no OfferReader — verify quantity 0 manually`,
          });
          continue;
        }
        testInfo.annotations.push({
          type: 'pause-channel-not-applied-remotely',
          description: `${channel.platformType}: OL's quantity-0 write succeeded (asserted above) but the marketplace has not applied it yet — expected on the Allegro sandbox, where quantity-change commands stay pending`,
        });
      }
    }

    pausedChannels = channels;
  });

  test('the sweep re-asserts the pause for a still-stale variant (reconcile guarantee)', async ({
    api,
    world,
    jobs,
  }, testInfo) => {
    const offerManagers = world
      .connectionsWithCapability('OfferManager')
      .filter((c) => c.status === 'active');
    test.skip(offerManagers.length === 0, 'no active OfferManager connection on this stack');

    // The sweep reads the persisted `isStale` flag, so it is meaningful (and
    // idempotent) on any connection — but it can only be OBSERVED end to end
    // when something is actually stale, which test 1 arranges.
    const sweptAt = new Date();
    for (const connection of offerManagers) {
      const sweep = await jobs.pauseStaleSweep(connection.id, {
        limit: 50,
        timeoutMs: 120_000,
      });
      expect(
        sweep.status,
        `${JobType.marketplaceOfferPauseStaleSweep} on ${connection.platformType} (${connection.id})`,
      ).toBe('succeeded');
      expect(sweep.outcome, `sweep ${sweep.id} outcome`).not.toBe('business_failure');
    }

    if (pausedChannels.length === 0) {
      testInfo.annotations.push({
        type: 'sweep-observation-skipped',
        description:
          'test 1 did not run (destructive opt-in off, or no mapped offer) — the sweep ran but had no stale offer to re-assert',
      });
      return;
    }

    // The re-assert must be an absolute quantity-0 set, never a resurrection.
    // Asserted on OL's own write (same reasoning as test 1: the marketplace read
    // depends on an async command a sandbox may never apply) — and on the
    // ABSOLUTE-0 dedup key, which is what makes a repeated sweep against an
    // unchanged stale set cheap instead of duplicating work.
    for (const channel of pausedChannels) {
      const writes = await jobs.waitForOfferQuantityUpdates(channel.connectionId, sweptAt, 1, {
        timeoutMs: 180_000,
      });
      expect(
        writes.length,
        `${channel.platformType}: quantity-write job(s) re-asserted by the sweep`,
      ).toBeGreaterThanOrEqual(1);
      for (const write of writes) {
        expect(
          write.status,
          `${channel.platformType} sweep re-assert write ${write.id} status`,
        ).toBe('succeeded');
      }
      try {
        const offer = await api.listings.getOffer(channel.mappingId);
        testInfo.annotations.push({
          type: 'sweep-channel-read',
          description: `${channel.platformType} offer ${offer.externalId} reads availableQuantity=${offer.availableQuantity} after the sweep re-assert (0 once the marketplace applies OL's write)`,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          testInfo.annotations.push({
            type: 'pause-channel-degrade',
            description: `${channel.platformType}: no OfferReader — verify quantity 0 manually`,
          });
          continue;
        }
        throw error;
      }
    }
  });

  test('a product deleted at the master reports outcomeReason=master_deleted and the jobs UI labels it "source deleted"', async ({
    page,
    world,
    jobs,
  }, testInfo) => {
    const master = world.connectionWithCapability('ProductMaster', PlatformType.prestashop);
    test.skip(!master, 'no PrestaShop ProductMaster connection on this stack');
    const ps = buildPrestashopClient(master!);
    test.skip(!ps, 'no PrestaShop webservice key/base URL (OL_PS_WEBSERVICE_KEY / OL_PS_ADMIN_URL)');

    // Self-contained: this test creates the product it deletes, so it never
    // removes anything an operator (or another suite) put in the catalogue.
    const suffix = Date.now().toString().slice(-9);
    const created = await ps!.createProduct({
      name: `E2E stale-offer-pause ${suffix}`,
      reference: `E2E-1689-${suffix}`,
      ean13: buildEan13(suffix),
      price: '9.99',
      quantity: 5,
    });
    testInfo.annotations.push({
      type: 'throwaway-product',
      description: `created PrestaShop product ${created.id} (${created.reference}); deleted later in this test`,
    });

    // Sanity: a healthy product syncs with outcome 'ok' — so the business
    // failure asserted below is caused by the deletion, not by the fixture.
    const healthy = await jobs.triggerAndWait(
      {
        connectionId: master!.id,
        jobType: JobType.masterProductSyncByExternalId,
        payload: { externalId: created.id, objectType: 'Product' },
      },
      { timeoutMs: 120_000 },
    );
    expect(healthy.outcome, 'a healthy master product syncs with outcome ok').toBe('ok');
    expect(healthy.outcomeReason ?? null, 'no outcomeReason on the healthy path').toBeNull();

    await ps!.deleteProduct(created.id);

    // `expectSuccess: false` — a business failure is the EXPECTED result here.
    const deleted = await jobs.triggerAndWait(
      {
        connectionId: master!.id,
        jobType: JobType.masterProductSyncByExternalId,
        payload: { externalId: created.id, objectType: 'Product' },
      },
      { timeoutMs: 120_000, expectSuccess: false },
    );

    // ADR-007: orchestration succeeded, the business operation is terminally
    // rejected — so the runner must NOT have retried it to death.
    expect(deleted.status, 'a master deletion is a terminal business outcome, not a dead job').toBe(
      'succeeded',
    );
    expect(deleted.outcome, 'outcome for a product deleted at the master').toBe('business_failure');
    expect(deleted.outcomeReason, 'the deletion-specific outcome reason (#1689)').toBe(
      'master_deleted',
    );

    await assertJobsUiLabelsSourceDeleted(page, deleted, testInfo);
  });
});

// ── local helpers ───────────────────────────────────────────────────────────

/**
 * Assert the operator-facing half: the jobs list renders the deletion-specific
 * "source deleted" label for this job rather than the generic "business failure".
 * Screenshot attached either way, because the label is the reviewable evidence.
 */
async function assertJobsUiLabelsSourceDeleted(
  page: import('@playwright/test').Page,
  job: SyncJob,
  testInfo: import('@playwright/test').TestInfo,
): Promise<void> {
  await page.goto(`/jobs-logs/${job.id}`);
  const sourceDeleted = page.getByText('source deleted', { exact: false }).first();
  await expect(
    sourceDeleted,
    'the jobs UI labels a deletion-caused business failure "source deleted"',
  ).toBeVisible();
  await testInfo.attach('jobs-ui-source-deleted', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

interface PausableCandidate {
  product: Product;
  psExternalId: string;
  toDelete: { id: string; ean13: string | null };
  variant: ProductVariant;
  channels: ChannelMapping[];
}

/**
 * Pick a product this spec can safely prune one combination from.
 *
 * Requirements, all checked against the LIVE master rather than OL's mirror:
 *   - mapped to a PrestaShop external id on `masterConnectionId`,
 *   - at least 2 combinations still present at PrestaShop (so pruning one leaves
 *     a live product, i.e. a VARIANT-level deletion, not a full one),
 *   - the last combination's EAN resolves to an OL variant.
 *
 * A candidate whose target variant has a live offer mapping wins immediately;
 * otherwise the first structurally-valid candidate is kept as a fallback, so the
 * trigger chain is still exercised on a stack with no marketplace connection.
 */
async function findPausableCandidate(
  api: import('../../src/api/api-client').ApiClient,
  world: import('../../src/world/world').World,
  ps: PrestashopWebserviceClient,
  masterConnectionId: string,
): Promise<PausableCandidate | null> {
  // Bounded scan: each iteration costs a product read + a PS round-trip, and a
  // demo catalogue puts a usable candidate well inside this window.
  const products = await world.listProducts(30);
  let fallback: PausableCandidate | null = null;

  for (const summary of products) {
    const detail = await api.products.getById(summary.id);
    const psExternalId = externalIdFor(detail.externalIds, masterConnectionId);
    if (!psExternalId) continue;

    const variants = await world.variantsOf(summary.id);
    if (variants.length < 2) continue;

    let combinations;
    try {
      combinations = await ps.listCombinations(psExternalId);
    } catch {
      // A product deleted at the master (or otherwise unreadable) is simply not
      // a candidate — test 3 covers the full-deletion path deliberately.
      continue;
    }
    if (combinations.length < 2) continue;

    // Last combination, so this never collides with the golden path's primary
    // variant (same rationale as the #1495 pruning spec).
    const toDelete = combinations[combinations.length - 1];
    const variant = variants.find((v) => (v.ean ?? v.gtin) === toDelete.ean13);
    if (!variant) continue;

    const channels = await resolveChannelMappings(api, world, variant.id);
    const candidate: PausableCandidate = {
      product: { ...summary, variants },
      psExternalId,
      toDelete,
      variant,
      channels,
    };
    if (channels.length > 0) return candidate;
    fallback ??= candidate;
  }

  return fallback;
}

/** Offer mappings for one internal variant across every checked marketplace. */
async function resolveChannelMappings(
  api: import('../../src/api/api-client').ApiClient,
  world: import('../../src/world/world').World,
  variantId: string,
): Promise<ChannelMapping[]> {
  const mappings: ChannelMapping[] = [];
  for (const platformType of CHANNEL_PLATFORMS) {
    const connection = world.connectionFor(platformType);
    if (!connection) continue;
    const page = await api.listings.list({
      connectionId: connection.id,
      internalId: variantId,
      limit: 5,
    });
    const mapping = page.items.find((m) => m.internalId === variantId);
    if (mapping) {
      mappings.push({ platformType, connectionId: connection.id, mappingId: mapping.id });
    }
  }
  return mappings;
}

function externalIdFor(
  externalIds: Product['externalIds'],
  connectionId: string,
): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

function buildPrestashopClient(connection: Connection): PrestashopWebserviceClient | null {
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl = process.env.OL_PS_ADMIN_URL?.trim() || readConfigString(connection.config, 'baseUrl');
  if (!key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

function readConfigString(
  config: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A syntactically valid EAN-13 (12 digits + mod-10 check digit) derived from the
 * run suffix, so the throwaway product carries a barcode the master sync accepts
 * rather than dropping via `normalizeToEan13`.
 */
function buildEan13(suffix: string): string {
  const base = `20${suffix.padStart(10, '0')}`.slice(0, 12);
  const sum = base
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}
