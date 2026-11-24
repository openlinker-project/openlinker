/**
 * AI Provider Table
 *
 * One row per supported provider (anthropic / openai / fake) with the
 * active marker, key-configuration status, and per-row actions: rotate
 * key, clear key (only when source=db), make active. The "make active"
 * button is disabled with a tooltip when the target provider has no key
 * configured (the BE rejects activation in that case with 422; gating in
 * the UI saves the round-trip and hints the operator at the fix).
 *
 * The fake provider is shown read-only - no key field, no clear, but
 * still activatable so operators can flip into deterministic mode for
 * diagnostic offline work.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { useState, type ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../shared/ui/tooltip';
import { useToast } from '../../../shared/ui/toast-provider';
import type {
  AiProvider,
  AiProviderKeySource,
  AiProviderRow,
  AiProviderSettingsView,
} from '../api/ai-provider-settings.types';
import { useClearAiProviderSettingsMutation } from '../hooks/use-clear-ai-provider-settings-mutation';
import { useSetActiveAiProviderMutation } from '../hooks/use-set-active-ai-provider-mutation';
import { AiProviderKeyDialog } from './ai-provider-key-dialog';

interface AiProviderTableProps {
  view: AiProviderSettingsView;
}

const PROVIDERS_REQUIRING_KEY = new Set<AiProvider>(['anthropic', 'openai']);

const SOURCE_TONE: Record<AiProviderKeySource, StatusBadgeTone> = {
  db: 'success',
  env: 'warning',
  none: 'neutral',
};

export function AiProviderTable({ view }: AiProviderTableProps): ReactElement {
  const copy = useMessages('ai-provider-settings').aiProviderTable;
  const providerLabel = (provider: AiProvider): string => copy.providers[provider].label;
  const { showToast } = useToast();
  const clearMutation = useClearAiProviderSettingsMutation();
  const setActiveMutation = useSetActiveAiProviderMutation();

  const [keyDialogProvider, setKeyDialogProvider] = useState<AiProvider | null>(null);
  const [clearProvider, setClearProvider] = useState<AiProvider | null>(null);
  const [activateProvider, setActivateProvider] = useState<AiProvider | null>(null);

  const handleClearConfirm = async (): Promise<void> => {
    if (clearProvider === null) return;
    try {
      await clearMutation.mutateAsync({ provider: clearProvider });
      showToast({
        tone: 'success',
        title: copy.clearedToastTitle,
        description: interpolate(copy.clearedToastDescription, {
          provider: providerLabel(clearProvider),
        }),
      });
      setClearProvider(null);
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.clearErrorTitle,
        description: describeApiError(error, 'ai-provider-settings'),
      });
    }
  };

  const handleActivateConfirm = async (): Promise<void> => {
    if (activateProvider === null) return;
    try {
      await setActiveMutation.mutateAsync({ provider: activateProvider });
      showToast({
        tone: 'success',
        title: copy.switchedToastTitle,
        description: interpolate(copy.switchedToastDescription, {
          provider: providerLabel(activateProvider),
        }),
      });
      setActivateProvider(null);
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.switchErrorTitle,
        description: describeApiError(error, 'ai-provider-settings'),
      });
    }
  };

  return (
    <TooltipProvider>
    <section
      className="ai-provider-table-section"
      aria-labelledby="ai-providers-heading"
    >
      <div className="ai-provider-table-section__head">
        <h2 id="ai-providers-heading" className="section-title">
          {copy.heading}
        </h2>
        <p className="ai-provider-table-section__caption">{copy.caption}</p>
      </div>

      <table className="ai-provider-table">
        <thead>
          <tr>
            <th scope="col">{copy.columns.provider}</th>
            <th scope="col">{copy.columns.active}</th>
            <th scope="col">{copy.columns.key}</th>
            <th scope="col">{copy.columns.source}</th>
            <th scope="col">{copy.columns.updated}</th>
            <th
              scope="col"
              className="ai-provider-table__th--actions"
              aria-label={copy.columns.actions}
            />
          </tr>
        </thead>
        <tbody>
          {view.providers.map((row) => (
            <ProviderRow
              key={row.provider}
              row={row}
              isActive={row.provider === view.activeProvider}
              activeUpdatedAt={row.provider === view.activeProvider ? view.activeUpdatedAt : null}
              activeUpdatedBy={row.provider === view.activeProvider ? view.activeUpdatedBy : null}
              onSetKey={() => setKeyDialogProvider(row.provider)}
              onClearKey={() => setClearProvider(row.provider)}
              onMakeActive={() => setActivateProvider(row.provider)}
            />
          ))}
        </tbody>
      </table>

      <AiProviderKeyDialog
        provider={keyDialogProvider}
        onClose={() => setKeyDialogProvider(null)}
      />

      <ConfirmDialog
        open={clearProvider !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setClearProvider(null);
        }}
        title={
          clearProvider
            ? interpolate(copy.clearConfirmTitle, { provider: providerLabel(clearProvider) })
            : copy.clearConfirmTitleGeneric
        }
        description={copy.clearConfirmDescription}
        confirmLabel={copy.clearConfirmLabel}
        cancelLabel={copy.cancel}
        tone="danger"
        isConfirming={clearMutation.isPending}
        onConfirm={() => {
          void handleClearConfirm();
        }}
      />

      <ConfirmDialog
        open={activateProvider !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setActivateProvider(null);
        }}
        title={
          activateProvider
            ? interpolate(copy.switchConfirmTitle, { provider: providerLabel(activateProvider) })
            : copy.switchConfirmTitleGeneric
        }
        description={
          activateProvider
            ? interpolate(copy.switchConfirmDescription, {
                provider: providerLabel(activateProvider),
                current: providerLabel(view.activeProvider),
              })
            : ''
        }
        confirmLabel={copy.switchConfirmLabel}
        cancelLabel={copy.cancel}
        isConfirming={setActiveMutation.isPending}
        onConfirm={() => {
          void handleActivateConfirm();
        }}
      />
    </section>
    </TooltipProvider>
  );
}

interface ProviderRowProps {
  row: AiProviderRow;
  isActive: boolean;
  activeUpdatedAt: string | null;
  activeUpdatedBy: string | null;
  onSetKey: () => void;
  onClearKey: () => void;
  onMakeActive: () => void;
}

function ProviderRow({
  row,
  isActive,
  activeUpdatedAt,
  activeUpdatedBy,
  onSetKey,
  onClearKey,
  onMakeActive,
}: ProviderRowProps): ReactElement {
  const copy = useMessages('ai-provider-settings').aiProviderTable;
  const format = useFormat();
  const requiresKey = PROVIDERS_REQUIRING_KEY.has(row.provider);
  const canActivate = !isActive && (!requiresKey || row.configured);
  const activateDisabledReason = !canActivate && !isActive ? copy.addKeyFirst : '';

  const trClass = ['ai-provider-table__row', isActive ? 'ai-provider-table__row--active' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={trClass}>
      <td>
        <div className="ai-provider-table__name">{copy.providers[row.provider].label}</div>
        <div className="ai-provider-table__hint mono-text">{copy.providers[row.provider].hint}</div>
      </td>
      <td>
        {isActive ? (
          <StatusBadge tone="success" withDot>
            {copy.activeBadge}
          </StatusBadge>
        ) : null}
      </td>
      <td>
        {requiresKey ? (
          row.configured ? (
            copy.yes
          ) : (
            <span className="text-muted">{copy.no}</span>
          )
        ) : (
          <span className="text-muted">{copy.notApplicable}</span>
        )}
      </td>
      <td>
        {requiresKey ? (
          <StatusBadge tone={SOURCE_TONE[row.source]} compact>
            {copy.sources[row.source]}
          </StatusBadge>
        ) : null}
      </td>
      <td className="mono-text">
        {isActive ? (
          <span
            title={
              activeUpdatedBy
                ? interpolate(copy.updatedBy, { user: activeUpdatedBy })
                : copy.serverFallback
            }
          >
            {activeUpdatedAt !== null && !Number.isNaN(Date.parse(activeUpdatedAt))
              ? format.relativeTime(activeUpdatedAt)
              : '—'}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="ai-provider-table__actions">
        {requiresKey ? (
          <Button tone="secondary" className="button--sm" onClick={onSetKey}>
            {row.configured ? copy.rotate : copy.setKey}
          </Button>
        ) : null}
        {requiresKey && row.source === 'db' ? (
          <Button tone="danger" className="button--sm" onClick={onClearKey}>
            {copy.clear}
          </Button>
        ) : null}
        {!isActive ? (
          activateDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button tone="primary" className="button--sm" disabled>
                    {copy.makeActive}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{activateDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <Button tone="primary" className="button--sm" onClick={onMakeActive}>
              {copy.makeActive}
            </Button>
          )
        ) : null}
      </td>
    </tr>
  );
}

