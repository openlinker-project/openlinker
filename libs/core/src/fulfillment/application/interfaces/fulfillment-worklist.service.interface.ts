/**
 * Fulfillment Worklist Service — interface (#2406, `W3a-19`, DESIGN §5.2)
 *
 * The operator-facing read model: works with their lines, their active holds,
 * a server-derived `supportedActions[]` and the optimistic token that makes
 * those actions safe to act on.
 *
 * ## Not to be confused with `IFulfillmentWorkQueryService`
 *
 * That one lives in this same folder over this same aggregate and answers a
 * different question: it is the CROSS-CONTEXT seam (#2402) asking *"what work
 * covers this order?"*, consumed by `ShippingModule` to link a shipment, and its
 * whole surface is `resolveLinkForOrder`. This one is the OPERATOR SURFACE —
 * paged reads and guarded writes, consumed by `apps/api` and the desktop
 * worklist (#2410 / #2411). Injecting the wrong token compiles and silently
 * gets a shipment linker; the split is stated here so that cannot happen
 * quietly.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */
import type { FulfillmentWorkListFilter } from '../../domain/types/fulfillment-worklist-page.types';
import type {
  ApplyFulfillmentWorkActionInput,
  FulfillmentWorkPageView,
  FulfillmentWorkView,
} from '../types/fulfillment-work-view.types';

export interface IFulfillmentWorklistService {
  /** One filtered, bounded page of the worklist. */
  list(filter: FulfillmentWorkListFilter): Promise<FulfillmentWorkPageView>;

  /**
   * One work object.
   *
   * @throws {FulfillmentWorkNotFoundError} when no such work exists.
   */
  get(workId: string): Promise<FulfillmentWorkView>;

  /**
   * Apply an operator action, guarded by the optimistic token.
   *
   * @throws {UnsupportedFulfillmentWorkActionError} the action is not one this surface executes.
   * @throws {FulfillmentWorkNotFoundError} no such work.
   * @throws {FulfillmentWorkVersionConflictError} somebody else moved it first — 409 with a refreshed set.
   * @throws {FulfillmentWorkActionNotLegalError} the token matched but the action is not legal now.
   */
  applyAction(input: ApplyFulfillmentWorkActionInput): Promise<FulfillmentWorkView>;
}
