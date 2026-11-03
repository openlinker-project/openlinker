/**
 * Confirm the product master (#3457, step 1)
 *
 * The one click that makes packing possible. It makes three kinds of write,
 * in order, each of which is safe to repeat — so a retry after a partial
 * failure converges instead of duplicating anything:
 *
 * 1. **The packing connection.** Reused when one exists (there is no
 *    server-side singleton guard, so a second create would make a second
 *    one), re-enabled when disabled, and given `FulfillmentExecutor` when it
 *    lacks it — without that capability the dispatch job never resolves an
 *    executor and nothing reaches the bench (#3476).
 * 2. **The warehouse.** `POST /inventory/locations/bootstrap` is idempotent;
 *    on a re-run `MAIN` comes back in `existingCodes` and is looked up. It is
 *    created only here, by the operator's click — never on mount (#2407: "an
 *    offer an operator takes, never a seed").
 * 3. **Every product master's stock override** (#3206), written on a freshly
 *    read config because `PATCH` replaces `config` whole. A master already
 *    pointing at `MAIN` is skipped; one pointing at another location is a
 *    conflict and is NOT overwritten (v1 is one warehouse).
 *
 * @module features/oms-onboarding/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import {
  CORE_CAPABILITY_VALUES,
  connectionsQueryKeys,
  type Connection,
  type CoreCapability,
} from '../../connections';
import { inventoryQueryKeys, type InventoryLocation } from '../../inventory';
import {
  readStockLocationOverride,
  STOCK_LOCATION_OVERRIDE_KEY,
  withConfigKey,
} from '../lib/config-merge';
import { omsOnboardingCopy } from '../lib/oms-onboarding.copy';
import { MAIN_LOCATION_CODE } from '../lib/oms-onboarding.constants';
import { OmsSetupError } from '../lib/oms-setup-error';
import { PACKING_EXECUTOR_CAPABILITY } from '../lib/onboarding-state';

export interface ConfirmProductMasterInput {
  readonly packingConnection: Connection | null;
  /** Resolved by the page (#3060 precedent) — never compared inside this feature. */
  readonly omsPlatformType: string;
  readonly masters: readonly Connection[];
}

export interface ConfirmProductMasterResult {
  readonly packingConnectionId: string;
  readonly mainLocation: InventoryLocation;
}

const CORE_CAPABILITIES: ReadonlySet<string> = new Set(CORE_CAPABILITY_VALUES);

function isCoreCapability(value: string): value is CoreCapability {
  return CORE_CAPABILITIES.has(value);
}

export function useConfirmProductMasterMutation(): UseMutationResult<
  ConfirmProductMasterResult,
  Error,
  ConfirmProductMasterInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  async function ensurePackingConnection(input: ConfirmProductMasterInput): Promise<string> {
    try {
      if (input.packingConnection === null) {
        const created = await apiClient.connections.create({
          name: omsOnboardingCopy.packingConnectionName,
          platformType: input.omsPlatformType,
          config: {},
          enabledCapabilities: [PACKING_EXECUTOR_CAPABILITY],
        });
        return created.id;
      }

      const fresh = await apiClient.connections.getById(input.packingConnection.id);
      const hasExecutor = fresh.enabledCapabilities.includes(PACKING_EXECUTOR_CAPABILITY);
      if (fresh.status === 'active' && hasExecutor) return fresh.id;

      const capabilities = fresh.enabledCapabilities.filter(isCoreCapability);
      await apiClient.connections.update(fresh.id, {
        status: 'active',
        enabledCapabilities: hasExecutor
          ? capabilities
          : [...capabilities, PACKING_EXECUTOR_CAPABILITY],
      });
      return fresh.id;
    } catch (error) {
      throw new OmsSetupError('connection', error);
    }
  }

  async function ensureMainLocation(): Promise<InventoryLocation> {
    let main: InventoryLocation | undefined;
    try {
      await apiClient.inventory.bootstrapLocations();
      // Read back rather than trust `created[0]`: the summary it returns is not
      // a full row, and on a re-run `MAIN` is only named in `existingCodes`.
      const page = await apiClient.inventory.listLocations(
        { codePrefix: MAIN_LOCATION_CODE },
        { limit: 50 }
      );
      main = page.items.find((location) => location.code === MAIN_LOCATION_CODE);
    } catch (error) {
      throw new OmsSetupError('location', error);
    }
    if (main === undefined) {
      throw new OmsSetupError('location', new Error('The warehouse was not found after creating it.'));
    }
    // An inactive MAIN would be refused as an override target, so say why
    // before the override write does it with a less useful message.
    if (main.status !== 'active') {
      throw new OmsSetupError('location-inactive', new Error('The warehouse is inactive.'));
    }
    return main;
  }

  async function pointStockAt(master: Connection, mainId: string): Promise<void> {
    try {
      const fresh = await apiClient.connections.getById(master.id);
      const override = readStockLocationOverride(fresh.config);
      if (override === mainId) return;
      if (override !== null) {
        throw new OmsSetupError('conflict', new Error('Stock already points elsewhere.'), fresh.name);
      }
      await apiClient.connections.update(fresh.id, {
        config: withConfigKey(fresh.config, STOCK_LOCATION_OVERRIDE_KEY, mainId),
      });
    } catch (error) {
      if (error instanceof OmsSetupError) throw error;
      throw new OmsSetupError('override', error, master.name);
    }
  }

  return useMutation({
    mutationFn: async (input) => {
      const packingConnectionId = await ensurePackingConnection(input);
      const mainLocation = await ensureMainLocation();
      // Sequential, not `Promise.all`: a failure names ONE master, and the
      // retry picks up exactly where this stopped.
      for (const master of input.masters) {
        await pointStockAt(master, mainLocation.id);
      }
      return { packingConnectionId, mainLocation };
    },
    // `onSettled`, not `onSuccess`: a partial failure has already written
    // something, and the page must re-read it to show the operator the truth.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all }),
      ]);
    },
  });
}
