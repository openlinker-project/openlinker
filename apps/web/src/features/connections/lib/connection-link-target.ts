/**
 * Connection link-target resolver (#3670 review)
 *
 * The single place the rules every connection-identity surface shares are
 * decided - `ConnectionEntityLabel`, `ConnectionChip` and `ConnectionCell` all
 * render from it rather than each re-implementing them:
 *
 *  - the all-zero placeholder id (#2745) is not a connection: it reads `System`,
 *    explains itself in the tooltip, and never links (it has no page);
 *  - a connection the caller looked up and could not resolve reads `Unknown`,
 *    with the raw id kept in the tooltip so a support ticket can still quote it;
 *  - a link to the page the operator is already on is suppressed.
 *
 * Pure so the rules are pinned once by a unit test instead of three times by
 * component tests.
 *
 * @module features/connections/lib
 */
import { SYSTEM_CONNECTION_ID } from '../api/connections.types';

export interface ConnectionLinkTargetInput {
  connectionId: string;
  /** Caller-resolved name; `null` means the caller looked and it did not resolve. */
  name: string | null;
  /** The caller's lookup has not settled yet. */
  loading: boolean;
  /** Current route path, so a link to the page already shown is suppressed. */
  pathname: string;
  /** Caller opt-out of the link; the other rules still apply. Defaults to `true`. */
  linkToDetail?: boolean;
}

export interface ConnectionLinkTarget {
  /** The all-zero placeholder id: not a real connection, nothing to show or copy. */
  system: boolean;
  /** The connection's detail page. */
  targetPath: string;
  /** Whether the identity renders as a link to `targetPath`. */
  linked: boolean;
  /** Still waiting on the caller's lookup. Never true for System, which needs none. */
  loading: boolean;
  /** The lookup settled without a connection. */
  unknown: boolean;
  /** `System` or the resolved name; `null` while loading or when unknown. */
  displayName: string | null;
  /** Visible text for a surface that renders its own: `displayName`, `…` or `Unknown`. */
  text: string;
  /**
   * Tooltip a rule owns: System's explanation, or the raw id of an unresolved
   * connection. `undefined` leaves the surface's own default (usually the name).
   */
  title: string | undefined;
}

const SYSTEM_LABEL = 'System';
const SYSTEM_TITLE = 'Not tied to a specific connection';
const UNKNOWN_LABEL = 'Unknown';
const LOADING_TEXT = '…';

/**
 * Whether an id is the placeholder rather than a connection. Exported for the
 * decision a surface must take before any name exists - skipping the fetch
 * that would only ever 404 for it.
 */
export function isSystemConnectionId(connectionId: string): boolean {
  return connectionId === SYSTEM_CONNECTION_ID;
}

export function resolveConnectionLinkTarget({
  connectionId,
  name,
  loading,
  pathname,
  linkToDetail = true,
}: ConnectionLinkTargetInput): ConnectionLinkTarget {
  const targetPath = `/connections/${connectionId}`;

  if (isSystemConnectionId(connectionId)) {
    return {
      system: true,
      targetPath,
      linked: false,
      loading: false,
      unknown: false,
      displayName: SYSTEM_LABEL,
      text: SYSTEM_LABEL,
      title: SYSTEM_TITLE,
    };
  }

  const displayName = loading ? null : name;
  const unknown = !loading && name === null;

  return {
    system: false,
    targetPath,
    linked: linkToDetail && pathname !== targetPath,
    loading,
    unknown,
    displayName,
    text: loading ? LOADING_TEXT : (displayName ?? UNKNOWN_LABEL),
    title: unknown ? connectionId : undefined,
  };
}
