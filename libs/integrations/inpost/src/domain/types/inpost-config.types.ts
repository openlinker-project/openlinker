/**
 * InPost Connection Config Types
 *
 * Non-secret per-connection configuration: the ShipX environment, the
 * organization id (a URL path parameter on every shipment endpoint), and the
 * sender contact used as the ShipX shipment `sender`. Validated at the
 * boundary by the connection-config shape validator (`class-validator` DTO);
 * `psModuleChoice` is intentionally NOT here in v1 — it's a #767/#771 concern
 * and this adapter never reads it.
 *
 * @module libs/integrations/inpost/src/domain/types
 */
import type { ShipmentAddress } from '@openlinker/core/shipping';

export const InpostEnvironmentValues = ['sandbox', 'production'] as const;
export type InpostEnvironment = (typeof InpostEnvironmentValues)[number];

/** Sender contact — maps to a ShipX `sender` Peer (with address). */
export interface InpostSenderContact {
  name?: string;
  email: string;
  phone: string;
  address: ShipmentAddress;
}

export interface InpostConnectionConfig {
  environment: InpostEnvironment;
  /** ShipX organization id — URL path param on shipment endpoints. */
  organizationId: string;
  /** Sender — populates the ShipX `sender` Peer on every shipment. */
  senderAddress: InpostSenderContact;
}
