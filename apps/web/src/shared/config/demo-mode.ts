/**
 * Access-control copy constants for AI-generation and demo-mode UI affordances
 *
 * `AI_SUGGEST_REQUIRES_ADMIN_MESSAGE` / `BULK_AI_TOGGLE_REQUIRES_WRITE_MESSAGE`
 * are shown when an AI-generation control is disabled because the current
 * session lacks the required permission (`ai:suggest` / `listings:write`).
 * This holds in every environment, not just demo — the underlying
 * `@Roles('admin')` / `@Roles('admin', 'operator')` guards on the backend are
 * permanent. Gating on permission (not `demoMode`) also fixes the pre-existing
 * bug where a non-permitted session saw an enabled control that then 403'd,
 * in both demo and production alike (#1379 re-scope).
 *
 * `NAV_DEMO_RESTRICTED_MESSAGE` remains demo-mode-specific — it's the
 * "visible but locked" tooltip for admin-only nav groups shown to non-admins
 * only when the deployment is a public demo (a discoverability UX affordance,
 * not an access-control signal — the route itself stays backend-protected).
 *
 * @module shared/config
 */

/** Tooltip on the "Suggest with AI" trigger when the session lacks `ai:suggest` (admin-only). */
export const AI_SUGGEST_REQUIRES_ADMIN_MESSAGE =
  'AI suggestions require an administrator role.';

/** Tooltip on the bulk "Generate AI descriptions" toggle when the session lacks `listings:write`. */
export const BULK_AI_TOGGLE_REQUIRES_WRITE_MESSAGE =
  'Generating AI descriptions requires listings write access.';

/**
 * Tooltip on nav groups shown as "visible but locked" in demo mode. Names the
 * actual reason (admin-only) alongside the demo-mode context, since a viewer
 * seeing this is always missing the same thing: the `admin` role.
 */
export const NAV_DEMO_RESTRICTED_MESSAGE =
  'Requires an administrator role.';

/**
 * Tooltip on a write action a demo read-only viewer sees rendered-but-disabled.
 * The action stays visible so the demo advertises the capability exists; the
 * final write submit is locked because the deployment is read-only in demo
 * mode. Only shown to demo viewers — genuinely unauthorized non-demo sessions
 * keep the existing hide-when-missing behaviour (see `useWriteAccess`).
 */
export const DEMO_READ_ONLY_ACTION_MESSAGE = 'Read-only in demo mode.';
