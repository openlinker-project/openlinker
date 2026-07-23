/**
 * Delivery Rider Service Interface
 *
 * Application contract for the delivery-rider hint (#1792, epic #1776): given a
 * defaulted order's raw source delivery method, decide which actionable hint to
 * surface (`unmapped` / `not-connected` / `none`) by mapping the method to a
 * candidate carrier and reading connection/registry state through the
 * integrations service — never a concrete carrier adapter.
 *
 * @module libs/core/src/mappings/application/interfaces
 */
import type {
  DeliveryRiderInput,
  DeliveryRiderResolution,
} from '../../domain/types/delivery-rider.types';

export interface IDeliveryRiderService {
  /**
   * Resolve the rider for a single order. Returns `none` when the resolution is
   * not `default`, when no delivery method is present, or when the method maps
   * to no supported/connected carrier.
   */
  resolve(input: DeliveryRiderInput): Promise<DeliveryRiderResolution>;

  /**
   * Batched counterpart to {@link resolve}: resolves many orders in one pass,
   * reading the carrier connection/registry state once for the whole batch
   * (it is order-independent) rather than per order. Returns resolutions
   * positionally aligned with `inputs`.
   */
  resolveBatch(inputs: DeliveryRiderInput[]): Promise<DeliveryRiderResolution[]>;
}
