/**
 * Subiekt Regulatory-Status Mapper (#753)
 *
 * Maps the bridge's KSeF-native `BridgeRegulatoryStatus` onto the neutral core
 * `RegulatoryStatus`. Implemented as an EXHAUSTIVE `Record` so a future enum
 * addition on either side fails the build rather than silently defaulting.
 *
 *   none     -> not-applicable
 *   pending  -> submitted
 *   sent     -> submitted
 *   accepted -> accepted
 *   rejected -> rejected
 *
 * (`'cleared'` is reserved/unused for Subiekt.)
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { RegulatoryStatus } from '@openlinker/core/invoicing';
import type { BridgeRegulatoryStatus } from '../../bridge/subiekt-bridge.types';

/**
 * EXHAUSTIVE bridge -> neutral map. Keyed by every `BridgeRegulatoryStatus`
 * member, so adding a value on either side fails the build rather than
 * silently defaulting. (`'cleared'` is reserved/unused for Subiekt.)
 */
const BRIDGE_TO_NEUTRAL_REGULATORY_STATUS: Readonly<
  Record<BridgeRegulatoryStatus, RegulatoryStatus>
> = {
  none: 'not-applicable',
  pending: 'submitted',
  sent: 'submitted',
  accepted: 'accepted',
  rejected: 'rejected',
};

export function toNeutralRegulatoryStatus(bridge: BridgeRegulatoryStatus): RegulatoryStatus {
  return BRIDGE_TO_NEUTRAL_REGULATORY_STATUS[bridge];
}
