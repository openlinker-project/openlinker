/**
 * Subiekt Regulatory-Status Mapper (#753, widened #3351)
 *
 * Maps the bridge's KSeF-native `BridgeRegulatoryStatus` onto the neutral core
 * `RegulatoryStatus`. Implemented as an EXHAUSTIVE `Record` so a future enum
 * addition on either side fails the build rather than silently defaulting.
 *
 *   none     -> not-applicable
 *   queued   -> pending-submission  (#3351: GT 1/2 — issued, NOT YET sent to KSeF)
 *   sent     -> submitted           (GT 3/4 — genuinely in flight / being processed)
 *   accepted -> accepted            (GT 5 — KSeF assigned a number; matches
 *                                     the shipped KSeF adapter's own mapping
 *                                     of its equivalent terminal state, see
 *                                     `ksef-clearance-status.mapper.ts`)
 *   rejected -> rejected            (GT 6/7)
 *   error    -> pending-submission  (#3351: GT 8, comms failure on a send
 *                                     attempt — KSeF received nothing, so
 *                                     this is a NOT-YET-TRANSMITTED state
 *                                     like `queued`, never a false `submitted`)
 *
 * Before #3351 `queued`/`error` did not exist on the bridge side — GT 1/2/8
 * were all folded into one `'pending'` value that this mapper read as
 * `'submitted'`, a false claim (KSeF had not received the document). Core
 * already shipped `'pending-submission'` (#1700) purpose-built for exactly
 * the not-yet-transmitted window; it was simply never reachable for Subiekt.
 *
 * (`'cleared'` is reserved/unused for Subiekt — KSeF's own registered state
 * maps to `'accepted'`, not `'cleared'`, matching the KSeF adapter.)
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
  queued: 'pending-submission',
  sent: 'submitted',
  accepted: 'accepted',
  rejected: 'rejected',
  error: 'pending-submission',
};

export function toNeutralRegulatoryStatus(bridge: BridgeRegulatoryStatus): RegulatoryStatus {
  return BRIDGE_TO_NEUTRAL_REGULATORY_STATUS[bridge];
}
