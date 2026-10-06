/**
 * Shoper Order Status Types
 *
 * What the shop says about one order status: its coarse lifecycle `type`
 * (1 new, 2 processing, 3 shipped, 4 terminal) and every per-language label it
 * carries. Type 4 covers cancelled, rejected AND returned, so the labels are what
 * tells a refund from a cancellation.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
export interface ShoperOrderStatusInfo {
  readonly type: number;
  readonly labels: readonly string[];
}
