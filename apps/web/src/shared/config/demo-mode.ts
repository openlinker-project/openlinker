/**
 * Access-control copy constants for demo-mode UI affordances
 *
 * The AI-suggest trigger and the bulk wizard's AI-generate-description toggle
 * (`ai:suggest` / `listings:write`) invoke a real backend call (an LLM
 * completion), so they're treated as direct-write-adjacent actions — same
 * `useWriteAccess` + `ReadOnlyLock` pattern as Test-connection /
 * Disable-connection (#1615/#1668): a demo viewer sees the control rendered
 * but disabled with `DEMO_READ_ONLY_ACTION_MESSAGE`, while a genuinely
 * unauthorized non-demo session doesn't see it at all.
 *
 * `NAV_DEMO_RESTRICTED_MESSAGE` remains demo-mode-specific — it's the
 * "visible but locked" tooltip for admin-only nav groups shown to non-admins
 * only when the deployment is a public demo (a discoverability UX affordance,
 * not an access-control signal — the route itself stays backend-protected).
 *
 * @module shared/config
 */

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
