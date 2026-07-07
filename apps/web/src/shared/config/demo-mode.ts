/**
 * Demo-mode copy constants
 *
 * Single source of truth for the operator-facing messages shown when a
 * control is disabled because the deployment runs in demo mode
 * (`OL_DEMO_MODE=true`, surfaced to the FE as `SystemConfig.demoMode`).
 * Kept in `shared/config` so both feature slices (content, listings) and the
 * app shell can import the same strings without cross-feature coupling.
 *
 * @module shared/config
 */

/** Tooltip on every disabled AI-generation control (Suggest with AI, bulk toggle). */
export const AI_GENERATION_DEMO_DISABLED_MESSAGE = 'AI generation is disabled in demo mode.';

/** Tooltip on nav groups shown as "visible but locked" in demo mode. */
export const NAV_DEMO_RESTRICTED_MESSAGE = 'Not available in demo mode.';
