/**
 * Packing onboarding constants (#3457)
 *
 * @module features/oms-onboarding/lib
 */

/**
 * The code of the warehouse the Confirm click creates through
 * `POST /inventory/locations/bootstrap` (#2407). The bootstrap names it
 * "Main warehouse"; the wizard never shows or asks for the name.
 */
export const MAIN_LOCATION_CODE = 'MAIN';

/** Step 1's stock progress re-reads this often while it is still filling in. */
export const STOCK_PROGRESS_POLL_MS = 15_000;

/** The waiting view looks for the first routed order this often. */
export const FIRST_ORDER_POLL_MS = 10_000;

/** The status page refreshes its Fulfilment count this often. */
export const STATUS_POLL_MS = 60_000;
