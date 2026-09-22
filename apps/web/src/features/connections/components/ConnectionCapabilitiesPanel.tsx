/**
 * Connection Capabilities Panel
 *
 * Renders the adapter's supported capabilities as togglable checkboxes.
 * Checked = enabled on this connection, unchecked = supported but disabled.
 * Toggling fires the update-connection mutation with the new set.
 *
 * Carries the sales-document routing note (#3192) - see
 * `SALES_DOCUMENT_CAPABILITIES` below for why it lives in this shared panel
 * rather than in a provider plugin.
 *
 * @module apps/web/src/features/connections/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Connection, CoreCapability } from '../api/connections.types';
import { CORE_CAPABILITY_VALUES } from '../api/connections.types';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import {
  CAPABILITY_HELP,
  capabilityConflictMessage,
  getCapabilityConflict,
} from '../lib/capability-metadata';
import { MCP_CONNECTION_CHANGE_HINT, MCP_TOOL_CAPABILITIES } from '../../mcp-tokens';
import { AccessGate } from '../../../shared/ui/access-gate';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';

interface ConnectionCapabilitiesPanelProps {
  connection: Connection;
}

const CORE_CAPABILITY_SET = new Set<string>(CORE_CAPABILITY_VALUES);

function isCoreCapability(value: string): value is CoreCapability {
  return CORE_CAPABILITY_SET.has(value);
}

/**
 * The two capabilities that make a connection a candidate to produce a sales
 * document (ADR-041). The routing note below is keyed on them and on nothing
 * else - it is a statement about how routing works, true of ANY connection
 * holding one of these, so it belongs in this shared panel rather than in a
 * provider plugin's own surface.
 */
const SALES_DOCUMENT_CAPABILITIES = ['Invoicing', 'Fiscalization'] as const;

/**
 * The stable test hook for one toggle: the capability name lowercased, so a
 * spec derives it from the wire value with no per-capability table to keep in
 * step (`Invoicing` -> `capability-toggle-invoicing`). Deliberately not
 * kebab-cased: a transform that has to guess word boundaries inside
 * `OrderProcessorManager` is a second rule nobody would be able to predict.
 */
export function capabilityToggleTestId(capability: string): string {
  return `capability-toggle-${capability.toLowerCase()}`;
}

/**
 * The stable test hook for one capability ROW — the mockup's own
 * `capability-invoicing` / `capability-fiscalization`
 * (`docs/plans/mockups/sales-document-eparagony-invoicing.html`), which is how
 * a spec asserts that ONE connection carries BOTH sales-document lanes
 * (ADR-073 decision 3, #3192) rather than only that a checkbox exists.
 *
 * Derived from the wire value by the same lowercase rule as the toggle above,
 * for the same reason: one transform, no per-capability table to keep in step.
 */
export function capabilityRowTestId(capability: string): string {
  return `capability-${capability.toLowerCase()}`;
}

/**
 * What this connection would become eligible to produce. Named from what the
 * adapter SUPPORTS rather than from a fixed word, because "issue invoices" is
 * plainly false on a connection that only registers receipts, and half true
 * on one that does both.
 */
function salesDocumentNoun(
  supportsInvoicing: boolean,
  supportsFiscalization: boolean,
): string {
  if (supportsInvoicing && supportsFiscalization) return 'sales documents';
  return supportsInvoicing ? 'invoices' : 'fiscal receipts';
}

export function ConnectionCapabilitiesPanel({
  connection,
}: ConnectionCapabilitiesPanelProps): ReactElement {
  const updateMutation = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const [pending, setPending] = useState<CoreCapability | null>(null);

  // Today the panel only renders the well-known core capabilities (the
  // CoreCapabilityValues set, mirrored here as CORE_CAPABILITY_VALUES).
  // Plugin-registered capabilities beyond that set (#576) are valid on the
  // connection entity but not editable from this UI yet — the backend's request
  // DTO is strict on CoreCapabilityValues (see plan §3.1). When the
  // runtime-aware DTO validator follow-up lands, this narrow can be removed.
  //
  // Hazard: handleToggle below saves `enabledCapabilities` as exactly this
  // filtered `enabled` set, so toggling any checkbox here on a connection that
  // also has a non-core capability enabled (e.g. a plugin-registered
  // ShippingProviderManager) silently drops that capability from the saved
  // list. Tracked under the same #576 follow-up.
  const supported = connection.supportedCapabilities.filter(isCoreCapability);
  const enabled = new Set(connection.enabledCapabilities.filter(isCoreCapability));

  // Deliberately keyed on SUPPORTED, not ENABLED (#1949). MCP tool registration
  // reads `enabledCapabilities`, so gating the hint on that would make it vanish
  // the instant an operator toggles a capability off — exactly the moment it is
  // needed, since that toggle is what just staled the client's tool list.
  // `supportedCapabilities` is stable across the toggle and answers the question
  // the hint actually depends on: could this connection ever back an MCP tool?
  //
  // Iterated MCP-side-first on purpose: `supported.includes(capability)` type-checks
  // only while every MCP_TOOL_CAPABILITIES member is a CoreCapability, so the
  // hand-maintained mirror of the backend's McpToolCapabilityValues fails to COMPILE
  // if it ever drifts to a non-core capability. The reverse iteration would need a
  // `readonly string[]` cast and would silently accept the same drift.
  const backsMcpTools = MCP_TOOL_CAPABILITIES.some((capability) =>
    supported.includes(capability),
  );

  // Keyed on SUPPORTED, not ENABLED, for the same reason the MCP hint above
  // is: the note explains what enabling a role does and does NOT do, so it has
  // to be readable BEFORE the operator enables one. Gating it on `enabled`
  // would hide it at exactly the moment it answers the question being asked.
  const supportsInvoicing = supported.includes('Invoicing');
  const supportsFiscalization = supported.includes('Fiscalization');
  const supportsSalesDocument = SALES_DOCUMENT_CAPABILITIES.some((capability) =>
    supported.includes(capability),
  );

  async function handleToggle(capability: CoreCapability, checked: boolean): Promise<void> {
    const next = new Set(enabled);
    if (checked) {
      next.add(capability);
    } else {
      next.delete(capability);
    }
    setPending(capability);
    try {
      await updateMutation.mutateAsync({
        connectionId: connection.id,
        input: { enabledCapabilities: Array.from(next) },
      });
      showToast({
        tone: 'success',
        title: 'Capabilities updated',
        description: `${capability} ${checked ? 'enabled' : 'disabled'}.`,
      });
    } catch {
      // mutation.error renders via Alert below
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Capabilities</p>
          <h3 className="section-title">Enabled roles</h3>
        </div>
        <span className="panel__meta" data-testid="capability-count">
          {/* Counter reflects the well-known core caps only — both sides
           * were narrowed via `isCoreCapability` above. If a connection
           * ever stores plugin-registered capabilities, those are
           * excluded from both numerator and denominator until this
           * panel grows a separate plugin-cap surface. */}
          {enabled.size} of {supported.length} enabled
        </span>
      </div>

      {updateMutation.error ? (
        <Alert tone="error" title="Unable to update capabilities">
          {updateMutation.error.message}
        </Alert>
      ) : null}

      {/* The hint describes what happens when capabilities CHANGE, so it is
       * only actionable for a session that can change them. A read-only
       * session (a public-demo viewer holds `connections:read` alone) would
       * otherwise be told to reconnect an agent it cannot have, over a control
       * it cannot operate — hence a content gate, not a `ReadOnlyLock`. */}
      {backsMcpTools ? (
        <AccessGate require="connections:write">
          <Alert tone="info">{MCP_CONNECTION_CHANGE_HINT}</Alert>
        </AccessGate>
      ) : null}

      {supported.length > 0 ? (
        <div className="capability-list__pills" aria-label="Supported capabilities">
          {supported.map((capability) => (
            <StatusBadge
              key={`pill-${capability}`}
              tone={enabled.has(capability) ? 'success' : 'neutral'}
              withDot
              compact
            >
              {capability}
            </StatusBadge>
          ))}
        </div>
      ) : null}

      {supported.length === 0 ? (
        <p className="muted-text">This connection has no capabilities available to toggle here.</p>
      ) : (
        <ul className="capability-list">
          {supported.map((capability) => {
            const id = `cap-${connection.id}-${capability}`;
            const isChecked = enabled.has(capability);
            // Mutual-exclusion guard: the backend rejects the conflicting
            // pair with a 400, so keep the invalid state unreachable here.
            const conflict = getCapabilityConflict(enabled, capability);
            const isBlocked = conflict !== null && !isChecked;
            return (
              <li
                key={capability}
                className="capability-list__item"
                data-testid={capabilityRowTestId(capability)}
              >
                <label htmlFor={id} className="capability-list__label">
                  <input
                    id={id}
                    type="checkbox"
                    data-testid={capabilityToggleTestId(capability)}
                    checked={isChecked}
                    disabled={isBlocked || pending === capability || updateMutation.isPending}
                    onChange={(e) => void handleToggle(capability, e.target.checked)}
                  />
                  <span className="capability-list__name mono-text">{capability}</span>
                </label>
                <p className="capability-list__help muted-text">
                  {isBlocked && conflict
                    ? capabilityConflictMessage(conflict)
                    : CAPABILITY_HELP[capability]}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* #3192 - the consequence an operator otherwise discovers by waiting:
       * a role makes the connection ELIGIBLE, it routes nothing to it. Not
       * gated on a permission, unlike the MCP hint above: that one instructs
       * the reader to go and reconnect an agent, whereas this states how the
       * system decides, which is as true for a viewer as for an admin. */}
      {supportsSalesDocument ? (
        <Alert
          tone="info"
          data-testid="capability-routing-note"
          title="Enabling a role does not route anything to it"
        >
          This connection becomes <em>eligible</em> to issue{' '}
          {salesDocumentNoun(supportsInvoicing, supportsFiscalization)}. Which orders
          actually get one is decided under{' '}
          <Link to="/settings/sales-documents">Sales documents</Link>, per country.
        </Alert>
      ) : null}

      {enabled.size === 0 && supported.length > 0 ? (
        <Alert tone="warning" title="No capabilities enabled">
          This connection is inactive for every capability. No sync jobs will use it.
        </Alert>
      ) : null}
    </div>
  );
}
