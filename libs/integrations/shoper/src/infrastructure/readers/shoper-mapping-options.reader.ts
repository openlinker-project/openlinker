/**
 * Shoper Mapping Options Reader
 *
 * The shop's own shipping methods, payment methods and statuses as mapping
 * options (`value` = the Shoper id, `label` = the shop's name for it). Shared by
 * the order processor (`DestinationOptionsReader`) and the order source
 * (`SourceOptionsReader`), so both sides of a mapping list the same rows.
 *
 * @module libs/integrations/shoper/src/infrastructure/readers
 */
import type { MappingOption } from '@openlinker/core/orders';

import type { ShoperOptionRow } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { fetchAllShoperRows } from '../http/shoper-pagination';
import { labelShoperOption } from '../mappers/shoper-order.mapper';

export type ShoperOptionTable = 'shippings' | 'payments' | 'statuses';

const TABLES: Readonly<Record<ShoperOptionTable, { readonly idKey: 'shipping_id' | 'payment_id' | 'status_id' }>> = {
  shippings: { idKey: 'shipping_id' },
  payments: { idKey: 'payment_id' },
  statuses: { idKey: 'status_id' },
};

export async function listShoperMappingOptions(
  client: ShoperHttpClient,
  table: ShoperOptionTable,
): Promise<MappingOption[]> {
  const { idKey } = TABLES[table];
  // Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper.
  const rows = await fetchAllShoperRows<ShoperOptionRow>(client, `/${table}`, { order: `${idKey} ASC` });
  const options: MappingOption[] = [];
  for (const row of rows) {
    const id = row[idKey];
    if (id !== undefined) {
      options.push({ value: String(id), label: labelShoperOption(row, String(id)) });
    }
  }
  return options;
}
