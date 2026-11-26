/**
 * PrestaShop order source - order-sync-start contract (#4265)
 *
 * Runs the shared kit against an in-memory webservice: a table of orders that
 * answers `listResources('orders', filters, limit, offset)` the way PrestaShop
 * does for the filters this adapter sends.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import { PrestashopOrderSourceAdapter } from '../prestashop-order-source.adapter';
import { DEFAULT_INSTALL_ORDER_STATES } from '../../../__tests__/fixtures/prestashop-order-states.fixture';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopOrderMapper } from '../../mappers/prestashop-order.mapper';
import { prestashopAdapterManifest } from '../../../prestashop-plugin';
import type { PrestashopOrder } from '../../mappers/prestashop.mapper.interface';
import type { PrestashopOrderCurrencyResolver } from '../../provisioners/prestashop-order-currency.resolver';

interface Filters {
  sort?: string[];
  updatedAfter?: string;
  idAfter?: number;
  idBefore?: number;
  dateAddBetween?: { from?: string; to?: string };
}

function buildSubject(): OrderSourceStartSubject {
  let rows: PrestashopOrder[] = [];
  let down = false;
  let nextId = 0;
  const add = (dateAdd: string, dateUpd = dateAdd): string => {
    nextId += 1;
    rows.push({ id: String(nextId), date_add: dateAdd, date_upd: dateUpd });
    return String(nextId);
  };

  const client = createMockHttpClient();
  client.listResources = jest.fn(
    (resource: string, filters: Filters = {}, limit = 50, offset = 0) => {
      if (down) return Promise.reject(new Error('connect ECONNREFUSED'));
      if (resource === 'order_states') return Promise.resolve([...DEFAULT_INSTALL_ORDER_STATES]);
      if (resource !== 'orders') return Promise.resolve([]);
      const id = (r: PrestashopOrder): number => Number(r.id);
      let out = rows.filter(
        (r) =>
          (filters.updatedAfter === undefined || String(r.date_upd) > filters.updatedAfter) &&
          (filters.idAfter === undefined || id(r) > filters.idAfter) &&
          (filters.idBefore === undefined || id(r) < filters.idBefore) &&
          (filters.dateAddBetween?.from === undefined ||
            String(r.date_add) >= filters.dateAddBetween.from) &&
          (filters.dateAddBetween?.to === undefined ||
            String(r.date_add) <= filters.dateAddBetween.to)
      );
      const key = (filters.sort ?? ['id_ASC']).join(',');
      out = [...out].sort((a, b) => {
        if (key.startsWith('date_upd')) {
          const byDate = String(a.date_upd).localeCompare(String(b.date_upd));
          return (
            (key.startsWith('date_upd_DESC') ? -byDate : byDate) ||
            (key.endsWith('id_DESC') ? id(b) - id(a) : id(a) - id(b))
          );
        }
        return key === 'id_DESC' ? id(b) - id(a) : id(a) - id(b);
      });
      return Promise.resolve(out.slice(offset, offset + limit));
    }
  ) as unknown as typeof client.listResources;

  const adapter = new PrestashopOrderSourceAdapter(
    client,
    new PrestashopOrderMapper(),
    createTestConnection(),
    {
      resolveOrderCurrencyIso: jest.fn().mockResolvedValue('PLN'),
    } as unknown as PrestashopOrderCurrencyResolver
  );

  return {
    adapter,
    manifest: prestashopAdapterManifest,
    scenario: {
      emptyShop: () => {
        rows = [];
      },
      shopWithOrders: () => {
        rows = [];
        return Promise.resolve({
          existingIds: [add('2025-01-01 10:00:00'), add('2025-01-02 10:00:00')],
        });
      },
      placeNewerOrder: () => Promise.resolve(add('2025-02-01 10:00:00')),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
      dateBetween: () => {
        rows = [];
        const olderIds = [add('2025-01-01 10:00:00'), add('2025-01-02 10:00:00')];
        const newerIds = [add('2025-03-01 10:00:00'), add('2025-03-02 10:00:00')];
        return Promise.resolve({ date: '2025-02-01', olderIds, newerIds });
      },
      windowOrders: () => {
        rows = [];
        const ids = [1, 2, 3, 4, 5].map((d) => add(`2025-04-0${d} 10:00:00`));
        return Promise.resolve({ from: '2025-04-01', to: '2025-04-30', ids });
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'PrestashopOrderSourceAdapter' });
