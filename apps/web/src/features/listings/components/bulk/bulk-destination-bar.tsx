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
import { interpolate, useFormat, useMessages, usePlural } from '../../../../shared/i18n';
import { KeyValueList, StatusBadge, shortenId, type StatusBadgeTone } from '../../../../shared/ui';
// The tooltip compound is not on the `shared/ui` barrel; the sibling
// `bulk-confirm-modal.tsx` imports it from the module directly for the same reason.
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { ConnectionDot } from '../../../orders';
import { resolvePlatformLabel } from '../../../mappings';
import { usePlatforms } from '../../../../shared/plugins';
import {
  readConnectionEnvironment,
  type Connection,
  type ConnectionStatus,
} from '../../../connections';
import type { BulkWizardConfig } from './bulk-wizard.types';
import { buildBulkConfigRows, collectBulkConfigChanges } from './bulk-config-summary';

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

const STATUS_BADGE: Record<
  Exclude<ConnectionStatus, 'active'>,
  { copyKey: 'needsReauth' | 'error' | 'disabled' | 'archived'; tone: StatusBadgeTone }
> = {
  needs_reauth: { copyKey: 'needsReauth', tone: 'error' },
  error: { copyKey: 'error', tone: 'error' },
  disabled: { copyKey: 'disabled', tone: 'neutral' },
  archived: { copyKey: 'archived', tone: 'neutral' },
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
  const copy = useMessages('listings').bulkDestinationBar;
  const plural = usePlural();
  const format = useFormat();

  const environment = readConnectionEnvironment(connection.config);
  const health =
    connection.status === 'active'
      ? null
      : {
          label: copy.status[STATUS_BADGE[connection.status].copyKey],
          tone: STATUS_BADGE[connection.status].tone,
        };
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
        <span className="pm-hint bulk-destbar__label">{copy.label}</span>
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
              {environment === 'sandbox' ? copy.environment.sandbox : copy.environment.production}
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
                    {plural(changes.length, copy.settingsChanged)}
                  </StatusBadge>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {format.list(
                  changes.map((change) =>
                    interpolate(copy.changeEntry, { label: change.label, value: change.value }),
                  ),
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </span>

        <span className="bulk-destbar__actions">
          {config !== null && (
            <button
              type="button"
              className="button button--ghost button--sm bulk-destbar__toggle"
              aria-expanded={settingsOpen}
              aria-controls={panelId}
              onClick={onToggleSettings}
            >
              {settingsOpen ? copy.hideSettings : copy.showSettings}
            </button>
          )}
          <button
            type="button"
            className="button button--secondary button--sm bulk-destbar__change"
            onClick={onChangeDestination}
          >
            {copy.changeDestination}
          </button>
        </span>
      </div>

      <div className="bulk-destbar__panel" id={panelId} hidden={!settingsOpen || config === null}>
        <KeyValueList items={rows} />
      </div>
    </div>
  );
}
