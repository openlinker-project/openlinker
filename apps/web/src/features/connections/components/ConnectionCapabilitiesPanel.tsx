/**
 * Connection Capabilities Panel
 *
 * Renders the adapter's supported capabilities as togglable checkboxes.
 * Checked = enabled on this connection, unchecked = supported but disabled.
 * Toggling fires the update-connection mutation with the new set.
 *
 * @module apps/web/src/features/connections/components
 */
import { useState, type ReactElement } from 'react';
import type { Connection, CoreCapability } from '../api/connections.types';
import { CORE_CAPABILITY_VALUES } from '../api/connections.types';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';

interface ConnectionCapabilitiesPanelProps {
  connection: Connection;
}

const CAPABILITY_HELP: Record<CoreCapability, string> = {
  ProductMaster: 'Read the product catalog (variants, attributes, categories) from this connection.',
  InventoryMaster: 'Read stock levels from this connection as the inventory source of truth.',
  OrderProcessorManager: 'Create and manage orders in this connection (typically the destination shop).',
  OrderSource: 'Fetch new orders from this connection (e.g. a marketplace).',
  OfferManager: 'Manage offers and listings on this marketplace connection.',
  ProductPublisher: 'Publish and manage shop listings owned by this connection (cross-platform listing).',
  CategoryProvisioner: 'Create or resolve destination categories when publishing listings to this connection.',
  Invoicing: 'Issue and manage fiscal documents (invoices) through this connection.',
};

const CORE_CAPABILITY_SET = new Set<string>(CORE_CAPABILITY_VALUES);

function isCoreCapability(value: string): value is CoreCapability {
  return CORE_CAPABILITY_SET.has(value);
}

export function ConnectionCapabilitiesPanel({
  connection,
}: ConnectionCapabilitiesPanelProps): ReactElement {
  const updateMutation = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const [pending, setPending] = useState<CoreCapability | null>(null);

  // Today the panel only renders the well-known core capabilities (the full
  // 8-member CoreCapabilityValues set, mirrored here as CORE_CAPABILITY_VALUES).
  // Plugin-registered capabilities beyond that set (#576) are valid on the
  // connection entity but not editable from this UI yet — the backend's request
  // DTO is strict on CoreCapabilityValues (see plan §3.1). When the
  // runtime-aware DTO validator follow-up lands, this narrow can be removed.
  const supported = connection.supportedCapabilities.filter(isCoreCapability);
  const enabled = new Set(connection.enabledCapabilities.filter(isCoreCapability));

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
        <span className="panel__meta">
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
            return (
              <li key={capability} className="capability-list__item">
                <label htmlFor={id} className="capability-list__label">
                  <input
                    id={id}
                    type="checkbox"
                    checked={isChecked}
                    disabled={pending === capability || updateMutation.isPending}
                    onChange={(e) => void handleToggle(capability, e.target.checked)}
                  />
                  <span className="capability-list__name mono-text">{capability}</span>
                </label>
                <p className="capability-list__help muted-text">
                  {CAPABILITY_HELP[capability]}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {enabled.size === 0 && supported.length > 0 ? (
        <Alert tone="warning" title="No capabilities enabled">
          This connection is inactive for every capability. No sync jobs will use it.
        </Alert>
      ) : null}
    </div>
  );
}
