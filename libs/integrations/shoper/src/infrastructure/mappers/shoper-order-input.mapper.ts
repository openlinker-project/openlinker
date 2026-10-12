/**
 * Shoper Order Input Helpers
 *
 * Pure readers for the values `ShoperOrderProcessorAdapter` takes from the
 * neutral `OrderCreate` and the connection config: the retry marker, the buyer
 * email, and the `defaults.*` ids. No I/O.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { OrderCreate } from '@openlinker/core/orders';

import { ShoperOrderUnbuildableException } from '../../domain/exceptions/shoper-order-unbuildable.exception';
import type { ShoperOrderDefaults } from '../../domain/types/shoper-config.types';

/** RFC-5322-lite: enough to refuse an obviously unusable value. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function orderMarker(internalOrderId: string): string {
  return `OpenLinker order ${internalOrderId}`;
}

export function readBuyerEmail(order: OrderCreate): string | undefined {
  const raw = order.metadata?.buyerEmail;
  return typeof raw === 'string' && EMAIL_PATTERN.test(raw.trim()) ? raw.trim() : undefined;
}

export function readDefaults(connection: Connection): ShoperOrderDefaults {
  const raw = (connection.config ?? {}).defaults;
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const shippingId = toPositiveInt(record.shippingId);
  const paymentId = toPositiveInt(record.paymentId);
  const statusId = toPositiveInt(record.statusId);
  return {
    ...(shippingId !== null ? { shippingId } : {}),
    ...(paymentId !== null ? { paymentId } : {}),
    ...(statusId !== null ? { statusId } : {}),
  };
}

export function requireDefault(value: number | undefined, key: string, label: string, connectionId: string): number {
  if (value === undefined) {
    throw new ShoperOrderUnbuildableException(
      connectionId,
      `no ${label} could be resolved: add a mapping or set connection config "${key}" to the id of a ${label} in the shop`,
    );
  }
  return value;
}

export function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readId(data: unknown): string | null {
  if (typeof data === 'number' || (typeof data === 'string' && data.trim() !== '')) {
    return String(data);
  }
  return null;
}
