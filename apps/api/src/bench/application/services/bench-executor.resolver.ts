/**
 * Bench Executor Resolver (#2418, `W3b-5`, story D2)
 *
 * *Which connections are OpenLinker's own packing executor?* — asked by the work
 * list and by the parcel that opens from it, through **one implementation**.
 *
 * ## Why this is an extraction rather than a new idea
 *
 * D2 requires the refusal to use *"the same eligibility rule as the list, so the
 * two can never disagree"*. `bench-work-eligibility.ts` shares the two halves
 * that are pure — the selectable statuses, and the `packable | held | cancelled`
 * derivation. This is the third half, and it is the one that cannot be pure: it
 * reads the connection registry.
 *
 * #2416 had it as two private methods on `BenchWorkService`, carrying real
 * rules — `status === 'active'`, `enabledCapabilities` includes the packing
 * capability, and a registry-resolved `adapterKey` compared to the OMS
 * package's own exported constant, with a documented degrade-on-error. Opening
 * a parcel has to ask the identical question, and restating those three clauses
 * is exactly the "two implementations that agree today" the story forbids — one
 * level below where the pure extraction reaches.
 *
 * The reasoning behind each clause is unchanged from #2416 and is repeated here
 * rather than left behind, because this file is now where it lives.
 *
 * @module apps/api/src/bench/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import { OMS_ADAPTER_KEY } from '@openlinker/oms';
import { Logger } from '@openlinker/shared/logging';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';

/**
 * The capability a connection must have ENABLED to be a packing executor.
 *
 * Enabled, not merely advertised: `enabledCapabilities` is the operator's own
 * decision, and a connection whose adapter can execute fulfilment but which
 * nobody switched on is not carrying out anything.
 */
const PACKING_CAPABILITY = 'FulfillmentExecutor';

@Injectable()
export class BenchExecutorResolver {
  private readonly logger = new Logger(BenchExecutorResolver.name);

  constructor(
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService
  ) {}

  /**
   * Every active connection an operator has switched packing on for.
   *
   * A connection that is not `active` is excluded: routing cannot dispatch to
   * it, so listing its work at a bench would show parcels nothing will ever
   * hand over — and opening one would be opening a parcel that cannot be
   * handed over either.
   *
   * An EMPTY result is the "routing is not switched on" fact (story B3), which
   * both callers report in their own words rather than as an empty list.
   */
  async listPackingExecutors(): Promise<Connection[]> {
    const connections = await this.connections.list();
    const executors: Connection[] = [];

    for (const connection of connections) {
      if (connection.status !== 'active') continue;
      if (!connection.enabledCapabilities.includes(PACKING_CAPABILITY)) continue;
      if (await this.isOpenLinkerExecutor(connection)) executors.push(connection);
    }
    return executors;
  }

  /**
   * Is this connection OpenLinker's own packing executor?
   *
   * Through the REGISTRY, comparing the RESOLVED adapter key.
   * `Connection.adapterKey` is nullable and the connection create form omits it
   * — which is exactly why the OMS plugin's manifest carries `isDefault: true`
   * — so a real OMS row stores NULL and a bare `connection.adapterKey` compare
   * would match nothing on any install. `resolveAdapterMetadata` is
   * metadata-only: it constructs no adapter and resolves no credential, so a
   * read that must answer while the floor is busy never touches a secret.
   *
   * A connection whose adapter cannot be resolved is reported as "not the
   * executor" rather than failing the whole read: an unrelated plugin that is
   * unregistered in this process must not be able to blank a packer's screen or
   * refuse a parcel they are holding.
   */
  private async isOpenLinkerExecutor(connection: Connection): Promise<boolean> {
    try {
      const metadata = await this.integrations.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      return metadata.adapterKey === OMS_ADAPTER_KEY;
    } catch (error) {
      this.logger.warn(
        `Could not resolve adapter metadata for connection ${connection.id}; not treating it ` +
          `as a packing connection: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}
