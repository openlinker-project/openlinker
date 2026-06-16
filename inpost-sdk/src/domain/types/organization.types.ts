/**
 * Organization wire types. An organization is the billing/sending entity that
 * owns shipments; its id scopes most ShipX write endpoints.
 *
 * @module domain/types
 */

import type { Address } from './common.types.ts';

export interface Organization {
  readonly href: string;
  readonly id: number;
  readonly owner_id: number;
  readonly name: string;
  readonly tax_id: string | null;
  readonly bank_account_number: string | null;
  /** Enabled carriers, e.g. `inpost_locker`, `inpost_letter`. */
  readonly carriers: ReadonlyArray<string>;
  /** Enabled services, e.g. `inpost_locker_standard`. */
  readonly services: ReadonlyArray<string>;
  readonly address: Address;
  readonly invoice_address: Address;
  readonly created_at: string;
  readonly updated_at: string;
  readonly [extra: string]: unknown;
}
