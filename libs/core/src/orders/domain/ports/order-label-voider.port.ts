/**
 * Order Label Voider Port (#3540, case 4a)
 *
 * What the cancellation cleanup needs from the carrier side: void the shipping
 * labels OpenLinker bought for an order that the sales channel has cancelled.
 *
 * It is a port in `orders` because the implementation lives in `shipping`, and
 * `shipping` depends on `orders` - core orders cannot import it without a module
 * cycle. `OrderCancellationEffectsService` therefore resolves it lazily through
 * `ModuleRef` (the `InvoiceService` -> `IFiscalRegistrationService` precedent)
 * and treats an unbound port as "no labels to void in this process".
 *
 * @module libs/core/src/orders/domain/ports
 */

/** What happened to one label. */
export interface OrderLabelVoidOutcome {
  readonly shipmentId: string;
  readonly outcome: 'voided' | 'failed';
  /** The provider's reason when the void failed; never shown unfiltered to a buyer. */
  readonly detail?: string;
}

export interface OrderLabelVoiderPort {
  /**
   * Void every outbound label of the order that can still be voided (drafted or
   * generated, not yet with the carrier). Best-effort by contract: one label
   * failing is reported, never thrown, and does not stop the others.
   */
  voidLabelsForOrder(internalOrderId: string): Promise<readonly OrderLabelVoidOutcome[]>;
}
