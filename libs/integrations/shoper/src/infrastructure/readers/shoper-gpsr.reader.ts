/**
 * Shoper GPSR Reader
 *
 * Turns a product's `safety_information` (id references) into the neutral
 * `ProductGpsr` by reading the four GPSR registries - `product-safety-producers`,
 * `-responsibles`, `-importers` and `-certificates` - and handing them to the
 * pure `buildShoperGpsr`.
 *
 * Request budget (Shoper allows about 10 requests a second per shop, shared by
 * every integration on it):
 *   - A registry is read only when a product actually references it, so a
 *     catalogue that never filled in GPSR costs nothing at all.
 *   - Each registry is read at most ONCE per reader instance, whole (they are
 *     small merchant-maintained lists), and every product after the first is
 *     answered from memory. An instance lives for one adapter resolution - a
 *     single product sync or one batched page.
 *   - A FAILED registry read is memoised too, unlike the tax table: retrying per
 *     product would turn one outage into a request per product of the page.
 *     The next adapter resolution retries.
 *
 * Failure never fails a product sync. A registry that cannot be read, or a
 * reference that names nothing readable, answers `undefined` - "not reported" -
 * which the repository leaves unwritten, so a stored declaration survives. A
 * warning names the product and the reason, since an operator otherwise sees
 * only that an offer fell back to its connection defaults.
 *
 * @module libs/integrations/shoper/src/infrastructure/readers
 */
import type { ProductGpsr } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

import type {
  ShoperSafetyCertificateRecord,
  ShoperSafetyPartyRecord,
} from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { fetchAllShoperRows } from '../http/shoper-pagination';
import {
  buildShoperGpsr,
  readShoperGpsrReferences,
  shoperGpsrId,
  type ShoperGpsrTables,
} from '../mappers/shoper-gpsr.mapper';

/** One GPSR registry: where it lives and which field is its id. */
interface RegistryDefinition {
  readonly path: string;
  readonly idField: string;
}

const REGISTRIES = {
  producers: { path: '/product-safety-producers', idField: 'gpsr_producer_id' },
  responsibles: { path: '/product-safety-responsibles', idField: 'gpsr_responsible_id' },
  importers: { path: '/product-safety-importers', idField: 'gpsr_importer_id' },
  certificates: { path: '/product-safety-certificates', idField: 'gpsr_certificate_id' },
} as const satisfies Record<keyof ShoperGpsrTables, RegistryDefinition>;

type RegistryName = keyof typeof REGISTRIES;

type RegistryRow = ShoperSafetyPartyRecord | ShoperSafetyCertificateRecord;

export class ShoperGpsrReader {
  private readonly logger = new Logger(ShoperGpsrReader.name);
  private readonly registries = new Map<RegistryName, Promise<ReadonlyMap<string, RegistryRow>>>();

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly connectionId: string,
  ) {}

  /**
   * The product's GPSR data: an object when the shop states some, `null` when
   * it states the product carries none, `undefined` when it cannot be known on
   * this read (no `safety_information` in the payload, or a reference that
   * could not be resolved). Never throws.
   */
  async resolve(safetyInformation: unknown, externalProductId: string): Promise<ProductGpsr | null | undefined> {
    const refs = readShoperGpsrReferences(safetyInformation);
    if (refs === undefined || refs === null) {
      return refs;
    }

    const needed: RegistryName[] = [];
    if (refs.producerId !== null) needed.push('producers');
    if (refs.responsibleId !== null) needed.push('responsibles');
    if (refs.importerId !== null) needed.push('importers');
    if (refs.certificateIds.length > 0) needed.push('certificates');

    let tables: ShoperGpsrTables;
    try {
      // Sequential on purpose: the HTTP client paces requests per shop, and a
      // burst of four parallel list reads buys nothing a registry of a few
      // rows would notice.
      const loaded: Record<string, ReadonlyMap<string, RegistryRow>> = {};
      for (const name of needed) {
        loaded[name] = await this.registry(name);
      }
      tables = loaded as ShoperGpsrTables;
    } catch (error) {
      this.logger.warn(
        `Shoper product ${externalProductId}: GPSR registry read failed, product GPSR left unknown ` +
          `(connection: ${this.connectionId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }

    const outcome = buildShoperGpsr(refs, tables);
    if (outcome.kind === 'unresolvable') {
      this.logger.warn(
        `Shoper product ${externalProductId}: GPSR reference cannot be resolved (${outcome.detail}); ` +
          `product GPSR left unknown (connection: ${this.connectionId})`,
      );
      return undefined;
    }
    return outcome.gpsr;
  }

  private registry(name: RegistryName): Promise<ReadonlyMap<string, RegistryRow>> {
    let pending = this.registries.get(name);
    if (pending === undefined) {
      pending = this.load(REGISTRIES[name]);
      this.registries.set(name, pending);
    }
    return pending;
  }

  private async load(definition: RegistryDefinition): Promise<ReadonlyMap<string, RegistryRow>> {
    const rows = await fetchAllShoperRows<RegistryRow & Record<string, unknown>>(
      this.client,
      definition.path,
      // Explicit direction, like every other read in the plugin: a bare
      // `order=<field>` sorts descending, and an unordered paged read is not stable.
      { order: `${definition.idField} ASC` },
    );
    const table = new Map<string, RegistryRow>();
    for (const row of rows) {
      const id = shoperGpsrId(row[definition.idField]);
      if (id !== null) table.set(id, row);
    }
    return table;
  }
}
