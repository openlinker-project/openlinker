/**
 * Buyer Identity Corrector Capability (DEF-09)
 *
 * Marks a `CorrectionIssuer` that actually puts `IssueCorrectionCommand.buyerOverride`
 * on the correcting document. Without the marker core could not tell a provider
 * that honours the override from one that silently ignores it - and core
 * persists the override into the correction's own snapshot either way, so
 * OpenLinker would show a buyer the provider's document does not carry.
 *
 * `InvoiceService` refuses an override for an adapter that does not declare
 * this, before anything is sent: a technical guard, since such a provider
 * cannot carry the change at all.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';

export interface BuyerIdentityCorrector {
  /** Discriminant flag, always `true`, read by {@link isBuyerIdentityCorrector}. */
  readonly honoursBuyerOverride: true;
}

export function isBuyerIdentityCorrector(
  adapter: InvoicingPort,
): adapter is InvoicingPort & BuyerIdentityCorrector {
  return (adapter as Partial<BuyerIdentityCorrector>).honoursBuyerOverride === true;
}
