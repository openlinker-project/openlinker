/**
 * Access-control copy for demo-mode UI affordances
 *
 * The AI-suggest trigger and the bulk wizard's AI-generate-description toggle
 * (`ai:suggest` / `listings:write`) invoke a real backend call (an LLM
 * completion), so they're treated as direct-write-adjacent actions — same
 * `useWriteAccess` + `ReadOnlyLock` pattern as Test-connection /
 * Disable-connection (#1615/#1668): a demo viewer sees the control rendered
 * but disabled with `demoReadOnlyActionMessage()`, while a genuinely
 * unauthorized non-demo session doesn't see it at all.
 *
 * `navDemoRestrictedMessage()` remains demo-mode-specific — it's the
 * "visible but locked" tooltip for admin-only nav groups shown to non-admins
 * only when the deployment is a public demo (a discoverability UX affordance,
 * not an access-control signal — the route itself stays backend-protected).
 *
 * Both are functions, not constants, and read the `ui` namespace when called:
 * a module-level string would stay in the language the module first loaded in.
 * Call them while rendering.
 *
 * @module shared/config
 */
import { getMessages } from '../i18n';

/**
 * Tooltip on nav groups shown as "visible but locked" in demo mode. Names the
 * actual reason (admin-only) alongside the demo-mode context, since a viewer
 * seeing this is always missing the same thing: the `admin` role.
 */
export function navDemoRestrictedMessage(): string {
  return getMessages('ui').demo.navRestricted;
}

/**
 * Tooltip on a write action a demo read-only viewer sees rendered-but-disabled.
 * The action stays visible so the demo advertises the capability exists; the
 * final write submit is locked because the deployment is read-only in demo
 * mode. Only shown to demo viewers — genuinely unauthorized non-demo sessions
 * keep the existing hide-when-missing behaviour (see `useWriteAccess`).
 */
export function demoReadOnlyActionMessage(): string {
  return getMessages('ui').demo.readOnlyAction;
}
