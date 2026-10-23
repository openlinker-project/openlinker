/**
 * Product-master selection (#3457)
 *
 * Which connections can feed packing with products and stock. Decided by
 * CAPABILITY alone (D19): a connection qualifies when it is active and both
 * `ProductMaster` and `InventoryMaster` are advertised by its adapter AND
 * enabled on it. No platform is named here, so a new platform that declares
 * both (Subiekt GT, say) qualifies without a change to this wizard.
 *
 * `partial` is the other half of the answer: an active connection that has
 * one of the two, so the step can say WHICH capability is missing instead of
 * the connection silently not appearing.
 *
 * @module features/oms-onboarding/lib
 */
import type { Connection } from '../../connections';

export const PRODUCT_MASTER_CAPABILITIES = ['ProductMaster', 'InventoryMaster'] as const;
export type ProductMasterCapability = (typeof PRODUCT_MASTER_CAPABILITIES)[number];

/** v1 feeds one warehouse from one or two product masters (#3454 is v2). */
export const MAX_PRODUCT_MASTERS = 2;

export interface PartialProductMaster {
  readonly connection: Connection;
  readonly missing: readonly ProductMasterCapability[];
}

export interface ProductMasterSelection {
  readonly eligible: readonly Connection[];
  readonly partial: readonly PartialProductMaster[];
}

function hasCapability(connection: Connection, capability: ProductMasterCapability): boolean {
  return (
    connection.supportedCapabilities.includes(capability) &&
    connection.enabledCapabilities.includes(capability)
  );
}

export function selectProductMasters(connections: readonly Connection[]): ProductMasterSelection {
  const eligible: Connection[] = [];
  const partial: PartialProductMaster[] = [];

  for (const connection of connections) {
    if (connection.status !== 'active') continue;
    const missing = PRODUCT_MASTER_CAPABILITIES.filter((c) => !hasCapability(connection, c));
    if (missing.length === 0) {
      eligible.push(connection);
    } else if (missing.length < PRODUCT_MASTER_CAPABILITIES.length) {
      partial.push({ connection, missing });
    }
  }

  return { eligible, partial };
}
