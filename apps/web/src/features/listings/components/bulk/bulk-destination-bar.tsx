/**
 * Bulk wizard destination context bar (#2227)
 *
 * Keeps the destination on screen for every wizard step after Config, so a
 * screenshot of Resolving / Review / Confirm says which integration the batch
 * is going to - previously those steps rendered identically for Allegro
 * production, Allegro sandbox, Erli and a WooCommerce shop.
 *
 * Only what an operator would act on stays visible: the connection, its
 * environment, a health badge when the connection is not active, and one chip
 * naming what was changed away from the step-1 defaults. The full config sits
 * behind the disclosure, together with `Change destination` - the one action
 * here that discards work, so it is kept away from the toggle.
 *
 * Presentational: the disclosure's open state is owned by the wizard, because
 * the wizard re-renders its body on every step change and the panel must not
 * snap shut.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useId, type ReactElement } from 'react';
import { KeyValueList, StatusBadge, shortenId, type StatusBadgeTone } from '../../../../shared/ui';
// The tooltip compound is not on the `shared/ui` barrel; the sibling
// `bulk-confirm-modal.tsx` imports it from the module directly for the same reason.
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { ConnectionDot } from '../../../orders';
import { resolvePlatformLabel } from '../../../mappings';
import { usePlatforms } from '../../../../shared/plugins';
import type { Connection, ConnectionStatus } from '../../../connections';
import type { BulkWizardConfig } from './bulk-wizard.types';
import {
  buildBulkConfigRows,
  collectBulkConfigChanges,
  readConnectionEnvironment,
} from './bulk-config-summary';

interface BulkDestinationBarProps {
  /** The destination the batch is going to, resolved by the wizard. */
  connection: Connection;
  /** Committed step-1 config; null before Config is left. */
  config: BulkWizardConfig | null;
  /** Disclosure state - owned by the wizard so it survives a step change. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Opens the wizard's confirm dialog; never navigates on its own. */
  onChangeDestination: () => void;
}

const STATUS_COPY: Record<Exclude<ConnectionStatus, 'active'>, { label: string; tone: StatusBadgeTone }> = {
  needs_reauth: { label: 'Needs re-auth', tone: 'error' },
  error: { label: 'Connection error', tone: 'error' },
  disabled: { label: 'Disabled', tone: 'neutral' },
};

export function BulkDestinationBar({
  connection,
  config,
  settingsOpen,
  onToggleSettings,
  onChangeDestination,
}: BulkDestinationBarProps): ReactElement {
  const platforms = usePlatforms();
  const panelId = useId();

  const environment = readConnectionEnvironment(connection.config);
  const health = connection.status === 'active' ? null : STATUS_COPY[connection.status];
  const changes = config ? collectBulkConfigChanges(config) : [];
  const platformLabel = resolvePlatformLabel(platforms, connection);

  const rows = config
    ? buildBulkConfigRows({
        config,
        platformLabel,
        platformType: connection.platformType,
        connectionIdLabel: shortenId(connection.id),
      })
    : [];

  return (
    <div
      className="bulk-destbar"
      data-environment={environment ?? undefined}
      data-testid="bulk-destination-bar"
    >
      <div className="bulk-destbar__main">
        <span className="bulk-destbar__id">
          {/* Larger than the 14 px default: here the disc is the identity
              anchor for the whole batch, not a marker beside other text.
              Hidden from assistive tech because the name it carries in its
              `sr-only` span is rendered visibly right beside it - without this
              the destination is announced twice. */}
          <span aria-hidden="true">
            <ConnectionDot name={connection.name} platformType={connection.platformType} size={26} />
          </span>
          <span className="bulk-destbar__name" title={connection.name}>
            {connection.name}
          </span>
        </span>

        <span className="bulk-destbar__badges">
          {environment !== null && (
            <StatusBadge tone={environment === 'sandbox' ? 'warning' : 'success'} withDot compact>
              {environment === 'sandbox' ? 'Sandbox' : 'Production'}
            </StatusBadge>
          )}
          {health !== null && (
            <StatusBadge tone={health.tone} withDot compact>
              {health.label}
            </StatusBadge>
          )}
          {changes.length === 1 && (
            <StatusBadge tone="review" compact>
              {changes[0].value}
            </StatusBadge>
          )}
          {changes.length > 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="bulk-destbar__changes">
                  <StatusBadge tone="review" compact>
                    {changes.length} settings changed
                  </StatusBadge>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {changes.map((change) => `${change.label}: ${change.value}`).join(' · ')}
              </TooltipContent>
            </Tooltip>
          )}
        </span>

        {config !== null && (
          <button
            type="button"
            className="bulk-destbar__toggle"
            aria-expanded={settingsOpen}
            aria-controls={panelId}
            onClick={onToggleSettings}
          >
            {settingsOpen ? 'Hide settings' : 'Show settings'}
          </button>
        )}
      </div>

      <div className="bulk-destbar__panel" id={panelId} hidden={!settingsOpen || config === null}>
        <KeyValueList items={rows} />
        <button type="button" className="bulk-destbar__change" onClick={onChangeDestination}>
          Change destination
        </button>
      </div>
    </div>
  );
}
