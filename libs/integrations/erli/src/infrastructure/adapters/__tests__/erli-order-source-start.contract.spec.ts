/**
 * Erli order source - order-sync-start contract (#4265)
 *
 * An in-memory seller inbox: `GET /inbox` lists the unread events and
 * `POST /inbox/mark-read { lastMessageId }` removes everything up to that id,
 * which is how the real inbox behaves and why Erli's head is "the newest unread
 * message". Erli has no date start and no window read, so only the head cases
 * apply.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import { ErliOrderSourceAdapter } from '../erli-order-source.adapter';
import { erliAdapterManifest } from '../../../erli-plugin';
import type { IErliHttpClient } from '../../http/erli-http-client.interface';

interface Message {
  id: string;
  type: string;
  created: string;
  payload: { id: string };
}

function buildSubject(): OrderSourceStartSubject {
  let unread: Message[] = [];
  let down = false;
  let seq = 0;
  const add = (): string => {
    seq += 1;
    // Erli ids are 24-char, time-ordered and sortable as plain strings.
    const id = String(seq).padStart(24, '0');
    const orderId = `erli-order-${seq}`;
    unread.push({
      id,
      type: 'orderCreated',
      created: '2025-01-01T10:00:00Z',
      payload: { id: orderId },
    });
    return orderId;
  };

  const client = {
    get: () => {
      if (down) return Promise.reject(new Error('socket hang up'));
      return Promise.resolve({ status: 200, data: [...unread], headers: {} });
    },
    post: (_path: string, body?: { lastMessageId?: string }) => {
      if (down) return Promise.reject(new Error('socket hang up'));
      const upTo = body?.lastMessageId ?? '';
      unread = unread.filter((m) => m.id > upTo);
      return Promise.resolve({ status: 200, data: {}, headers: {} });
    },
  } as unknown as IErliHttpClient;

  return {
    adapter: new ErliOrderSourceAdapter('conn-erli-1', client),
    manifest: erliAdapterManifest,
    scenario: {
      emptyShop: () => {
        unread = [];
      },
      shopWithOrders: () => {
        unread = [];
        return Promise.resolve({ existingIds: [add(), add()] });
      },
      placeNewerOrder: () => Promise.resolve(add()),
      breakTransport: () => {
        down = true;
      },
      fixTransport: () => {
        down = false;
      },
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'ErliOrderSourceAdapter' });
