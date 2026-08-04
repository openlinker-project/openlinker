/**
 * WooCommerce parity — scenario 1: WooCommerce as master catalogue
 *
 * Mirrors golden-path S1 (`tests/golden-path/operator-setup.spec.ts`), but for
 * a connection where WooCommerce — not PrestaShop — carries `ProductMaster` /
 * `InventoryMaster`. Resolves the connection BY CAPABILITY
 * (`world.connectionWithCapability`, #1571) rather than assuming a platform,
 * so the same spec works whichever platform the stack designates as master.
 *
 * Spec-owned topology (mirrors `order-destination.spec.ts`): the master
 * catalogue roles are MOVED onto WooCommerce in `beforeAll` and moved back in
 * `afterAll`, rather than expected to be pre-configured on the stack. They
 * cannot stay on the WooCommerce shop connection between runs — it declares
 * `config.masterCatalogConnectionId`, and a connection that both borrows a
 * catalogue and masters one re-imports every product published to it as a
 * SECOND OpenLinker product, which breaks real order creation on that shop
 * (see `tests/connection-topology.setup.ts` for the full account). The restore
 * is therefore unconditional: it also runs when the test fails, because the
 * next run's topology preflight — which runs in `setup`, before this file — is
 * what would otherwise fail.
 *
 * Self-configuring: skips with a clear reason when the stack has no
 * WooCommerce connection able to master a catalogue, no existing master to hand
 * the roles over from, or no WC REST credentials to cross-check against
 * (`OL_WC_CONSUMER_KEY` / `OL_WC_CONSUMER_SECRET`).
 *
 * @module tests/woocommerce-parity
 */
import { test, expect } from '../../src/fixtures/test';
import { buildWooCommerceClient } from '../../src/support/woocommerce-client';
import { externalIdFor } from '../../src/support/external-ids';
import type { ApiClient } from '../../src/api/api-client';
import type { World } from '../../src/world/world';
import type { Connection, Product } from '../../src/api/api.types';

/** Roles that make a connection the authoritative catalogue + stock source. */
const MASTER_ROLES = ['ProductMaster', 'InventoryMaster'] as const;

const MASTER_ROLE_SET: ReadonlySet<string> = new Set(MASTER_ROLES);

/**
 * A connection's capability set exactly as this spec found it, so the restore
 * replays the observed value instead of a reconstruction of what it "should"
 * have been.
 */
interface CapturedRoles {
  connectionId: string;
  name: string;
  enabledCapabilities: string[];
}

/**
 * WooCommerce reports NEGATIVE `stock_quantity` for a backordered product (a
 * long-lived test store reaches this after enough synthesized orders). The
 * adapter deliberately floors it at 0 (`parseStockQuantity`) — a backordered
 * product has no availability to publish onward — so the expectation must be
 * the floored value, not the raw one.
 */
function clampStock(wcStockQuantity: number | null): number {
  return Math.max(0, wcStockQuantity ?? 0);
}

test.describe('WooCommerce as master catalogue', () => {
  /**
   * The WooCommerce connection AFTER promotion — re-read from the PATCH
   * response, never the `world` snapshot. `world` is worker-scoped and built
   * once before any hook runs, so its copy still shows the pre-toggle
   * capability set; the sync triggers below only resolve an adapter because the
   * role is enabled (`IntegrationsService.getCapabilityAdapter` rejects a
   * capability the connection has disabled, even when its adapter supports it).
   */
  let wcMaster: Connection | null = null;
  let promotedWc: CapturedRoles | null = null;
  const demotedMasters: CapturedRoles[] = [];
  let skipReason: string | null = null;

  test.beforeAll(async ({ api, world }) => {
    const candidate = pickWooCommerceMasterCandidate(world);
    if (!candidate) {
      skipReason = 'no active WooCommerce connection whose adapter can master a catalogue';
      return;
    }

    const incumbents = world.connections.filter(
      (c) =>
        c.status === 'active' &&
        c.id !== candidate.id &&
        c.enabledCapabilities.some((role) => MASTER_ROLE_SET.has(role)),
    );
    if (incumbents.length === 0 && !holdsMasterRoles(candidate)) {
      skipReason =
        'no active connection currently holds ProductMaster / InventoryMaster — ' +
        'nothing to hand the master catalogue over from';
      return;
    }

    // Capture before mutating, so a PATCH that fails half-way still leaves
    // `afterAll` able to restore every connection it touched (replaying an
    // unchanged capture is a no-op).
    promotedWc = capture(candidate);
    wcMaster = await grantMasterRoles(api, candidate);
    for (const incumbent of incumbents) {
      demotedMasters.push(capture(incumbent));
      await revokeMasterRoles(api, incumbent);
    }
  });

  test.afterAll(async ({ api }) => {
    // Demote WooCommerce FIRST: promoting the incumbent first would leave two
    // catalogue masters — one of them self-contradicting — on the stack, which
    // is exactly the shape the topology preflight rejects.
    const failures: string[] = [];
    for (const captured of [...(promotedWc ? [promotedWc] : []), ...demotedMasters]) {
      try {
        await api.connections.update(captured.connectionId, {
          enabledCapabilities: captured.enabledCapabilities,
        });
      } catch (error) {
        failures.push(`${captured.name} (${captured.connectionId}): ${String(error)}`);
      }
    }
    promotedWc = null;
    demotedMasters.length = 0;
    if (failures.length > 0) {
      // Loud on purpose — a half-restored stack fails the next run's preflight,
      // and a silently swallowed restore makes that look unrelated to this file.
      throw new Error(`Failed to restore connection roles:\n- ${failures.join('\n- ')}`);
    }
  });

  test('simple + multi-variant products land in OL with per-variation stock and EANs', async ({
    api,
    jobs,
    world,
    poll,
  }) => {
    test.skip(!wcMaster, skipReason ?? 'WooCommerce cannot be made the master catalogue on this stack');

    const wc = buildWooCommerceClient(wcMaster ?? undefined);
    test.skip(!wc, 'OL_WC_CONSUMER_KEY / OL_WC_CONSUMER_SECRET not set — cannot cross-check against WC REST');

    const hasInventoryMaster = wcMaster!.enabledCapabilities.includes('InventoryMaster');

    await jobs.triggerAndWait(
      { connectionId: wcMaster!.id, jobType: 'master.product.syncAll' },
    );
    if (hasInventoryMaster) {
      await jobs.triggerAndWait(
        { connectionId: wcMaster!.id, jobType: 'master.inventory.syncAll' },
        );
    }

    // Find at least one product OL mapped to this WooCommerce connection —
    // the master sync may share the stack with other master connections
    // (e.g. PrestaShop), so filter by external-id presence rather than
    // assuming the first listed product came from WC.
    const products = await poll.until(
      () => api.products.list({ limit: 50 }),
      (page) => page.items.length > 0,
      { message: 'products to appear in OL after WooCommerce master sync', timeoutMs: 60_000 },
    );

    let wcProduct: Product | undefined;
    let wcExternalId: string | undefined;
    for (const summary of products.items) {
      const detail = await api.products.getById(summary.id);
      const externalId = externalIdFor(detail.externalIds, wcMaster!.id);
      if (externalId) {
        wcProduct = detail;
        wcExternalId = externalId;
        break;
      }
    }
    expect(wcProduct, 'at least one OL product mapped to the WooCommerce master connection').toBeTruthy();

    const wcView = await wc!.getProduct(wcExternalId!);
    expect(norm(wcView.name), 'product name matches WC').toBe(norm(wcProduct!.name));
    if (wcProduct!.sku && wcView.sku) {
      expect(norm(wcView.sku)).toBe(norm(wcProduct!.sku));
    }

    const variants = await world.variantsOf(wcProduct!.id);
    expect(variants.length).toBeGreaterThan(0);

    // Per-variant EAN + stock parity against WC (simple products expose a
    // single synthetic variant; variable products expose real WC variations).
    const availability = await api.inventory.availability(variants.map((v) => v.id));
    expect(availability.length).toBe(variants.length);

    if (wcView.type === 'variable') {
      const wcVariations = await wc!.getProductVariations(wcExternalId!);
      expect(wcVariations.length, 'WC variable product exposes variations').toBeGreaterThan(0);
      for (const variant of variants) {
        if (!variant.ean) continue; // some demo variants legitimately lack an EAN
        const match = wcVariations.find((v) => v.ean && norm(v.ean) === norm(variant.ean));
        expect(match, `OL variant EAN ${variant.ean} present on a WC variation`).toBeTruthy();
        if (match && hasInventoryMaster) {
          const expectedStock = clampStock(match.stockQuantity);
          // master.inventory.syncAll (like master.product.syncAll) returns
          // 'succeeded' as soon as it has fanned out per-variant sub-jobs, not
          // once they've all landed — poll until the number actually converges
          // rather than asserting a single-shot read right after the outer job.
          const olAvailable = await poll.until(
            async () => {
              const [entry] = await api.inventory.availability([variant.id]);
              return entry?.totalAvailable;
            },
            (value) => value === expectedStock,
            {
              message: `OL master stock for variant ${variant.id} to converge to WC stock_quantity ${String(expectedStock)}`,
              timeoutMs: 60_000,
            },
          );
          expect(
            olAvailable,
            `OL master stock for variant ${variant.id} matches WC stock_quantity`,
          ).toBe(expectedStock);
        }
      }
    } else if (hasInventoryMaster && wcView.stockQuantity !== null) {
      const expectedStock = clampStock(wcView.stockQuantity);
      const total = await poll.until(
        async () => {
          const avail = await api.inventory.availability(variants.map((v) => v.id));
          return avail.reduce((sum, a) => sum + a.totalAvailable, 0);
        },
        (value) => value === expectedStock,
        {
          message: `OL master total stock to converge to WC simple-product stock_quantity ${String(expectedStock)}`,
          timeoutMs: 60_000,
        },
      );
      expect(total, 'OL master total stock matches WC simple-product stock_quantity').toBe(
        expectedStock,
      );
    }
  });
});

function norm(value: string | null | undefined): string {
  return (value ?? '').trim();
}

// ── Spec-owned topology ─────────────────────────────────────────────────────

/**
 * The WooCommerce connection to make the master catalogue.
 *
 * Prefers one that ALREADY holds both roles, so a run that inherits the toggled
 * state from a hard-killed previous run adopts it instead of picking a second
 * WooCommerce connection and ending up with two masters. Only active
 * connections qualify — a disabled one (e.g. the order-destination spec's
 * released throwaway) is not part of the stack's live topology.
 */
function pickWooCommerceMasterCandidate(world: World): Connection | undefined {
  const candidates = world
    .connectionsWithCapability('ProductMaster')
    .filter((c) => c.platformType === 'woocommerce' && c.status === 'active');
  return candidates.find(holdsMasterRoles) ?? candidates[0];
}

function holdsMasterRoles(connection: Connection): boolean {
  return MASTER_ROLES.every((role) => connection.enabledCapabilities.includes(role));
}

function capture(connection: Connection): CapturedRoles {
  return {
    connectionId: connection.id,
    name: connection.name,
    enabledCapabilities: [...connection.enabledCapabilities],
  };
}

/** Add the master roles, keeping every other capability and never duplicating one. */
async function grantMasterRoles(api: ApiClient, connection: Connection): Promise<Connection> {
  const next = [
    ...connection.enabledCapabilities,
    ...MASTER_ROLES.filter((role) => !connection.enabledCapabilities.includes(role)),
  ];
  if (next.length === connection.enabledCapabilities.length) return connection;
  return api.connections.update(connection.id, { enabledCapabilities: next });
}

/** Drop the master roles, keeping every other capability. */
async function revokeMasterRoles(api: ApiClient, connection: Connection): Promise<Connection> {
  const next = connection.enabledCapabilities.filter((role) => !MASTER_ROLE_SET.has(role));
  if (next.length === connection.enabledCapabilities.length) return connection;
  return api.connections.update(connection.id, { enabledCapabilities: next });
}
