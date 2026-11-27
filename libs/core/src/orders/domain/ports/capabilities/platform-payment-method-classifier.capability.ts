/**
 * Platform Payment Method Classifier Capability
 *
 * Optional, GUARD-ONLY sub-capability of `OrderSourcePort` (#3774). An order
 * source declares it by implementing `classifyPlatformPaymentMethod`: the
 * answer its OWN platform gives for one native payment identifier - the
 * PrestaShop modules and WooCommerce gateways whose meaning the platform fixes
 * (`ps_cashondelivery`, `cod`, ...) - and `unknown` for everything else.
 *
 * It exists so core can tell, without knowing a single module name, which
 * identifiers an operator may map (the platform says `unknown`) and which are
 * not the operator's to redefine (the platform answers). The discovery read
 * uses it; ingestion reaches the same function through the adapter's own
 * order mapping, so what the endpoint reports and what is written cannot drift.
 *
 * Deliberately absent from every manifest and from `CoreCapabilityValues`
 * (the `ModifiedProductLister` precedent): a connection's `enabledCapabilities`
 * is stamped at create and never retro-filled, so GATING on a new name would
 * exempt every connection that already exists. It is narrowed off the
 * dispatched `OrderSource` adapter by a method probe, never resolved through
 * `getCapabilityAdapter(connectionId, 'PlatformPaymentMethodClassifier')`.
 *
 * Synchronous and pure: no I/O, so the discovery read can classify any number
 * of observed identifiers after building the adapter once.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderSourcePort} for the base port
 */
import type { PaymentMethod } from '../../types/payment-method.types';
import type { OrderSourcePort } from '../order-source.port';

export interface PlatformPaymentMethodClassifier {
  /**
   * The neutral method this platform itself assigns to a native payment
   * identifier, or `unknown` when the platform does not define it.
   */
  classifyPlatformPaymentMethod(sourcePaymentMethod: string): PaymentMethod;
}

export function isPlatformPaymentMethodClassifier(
  adapter: OrderSourcePort
): adapter is OrderSourcePort & PlatformPaymentMethodClassifier {
  return (
    typeof (adapter as Partial<PlatformPaymentMethodClassifier>).classifyPlatformPaymentMethod ===
    'function'
  );
}
