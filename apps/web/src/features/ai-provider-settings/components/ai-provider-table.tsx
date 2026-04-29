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
 * The fake provider is shown read-only — no key field, no clear, but
 * still activatable so operators can flip into deterministic mode for
 * diagnostic offline work.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { useState, type ReactElement } from 'react';
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

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  fake: 'Fake (offline stub)',
};

const PROVIDER_HINT: Record<AiProvider, string> = {
  anthropic: 'Claude — Vercel AI SDK',
  openai: 'GPT — Vercel AI SDK',
  fake: 'Deterministic — no network',
};

const PROVIDERS_REQUIRING_KEY = new Set<AiProvider>(['anthropic', 'openai']);

const SOURCE_TONE: Record<AiProviderKeySource, StatusBadgeTone> = {
  db: 'success',
  env: 'warning',
  none: 'neutral',
};

const SOURCE_LABEL: Record<AiProviderKeySource, string> = {
  db: 'Stored encrypted',
  env: 'Env fallback',
  none: 'None',
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

export function AiProviderTable({ view }: AiProviderTableProps): ReactElement {
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
        title: 'API key cleared',
        description: `Server falls back to env or none for ${PROVIDER_LABEL[clearProvider]}.`,
      });
      setClearProvider(null);
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Could not clear the key',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleActivateConfirm = async (): Promise<void> => {
    if (activateProvider === null) return;
    try {
      await setActiveMutation.mutateAsync({ provider: activateProvider });
      showToast({
        tone: 'success',
        title: 'Active provider switched',
        description: `Subsequent AI requests route to ${PROVIDER_LABEL[activateProvider]}.`,
      });
      setActivateProvider(null);
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Could not switch provider',
        description: error instanceof Error ? error.message : 'Unknown error',
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
          Providers
        </h2>
        <p className="ai-provider-table-section__caption">
          Keys are stored encrypted at rest. The active provider is read on every request — switches
          take effect on the next AI call.
        </p>
      </div>

      <table className="ai-provider-table">
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">Active</th>
            <th scope="col">Key</th>
            <th scope="col">Source</th>
            <th scope="col">Updated</th>
            <th scope="col" className="ai-provider-table__th--actions" aria-label="Actions" />
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
            ? `Clear ${PROVIDER_LABEL[clearProvider]} API key?`
            : 'Clear API key?'
        }
        description="The server falls back to the env variable (if set) or reports no key configured. AI requests using this provider will fail until a new key is saved."
        confirmLabel="Clear key"
        cancelLabel="Cancel"
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
            ? `Switch active provider to ${PROVIDER_LABEL[activateProvider]}?`
            : 'Switch active provider?'
        }
        description={
          activateProvider
            ? `Future AI requests will route through ${PROVIDER_LABEL[activateProvider]}. In-flight requests already dispatched to ${PROVIDER_LABEL[view.activeProvider]} continue with that provider.`
            : ''
        }
        confirmLabel="Switch provider"
        cancelLabel="Cancel"
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
  const requiresKey = PROVIDERS_REQUIRING_KEY.has(row.provider);
  const canActivate = !isActive && (!requiresKey || row.configured);
  const activateDisabledReason = !canActivate && !isActive ? 'Add a key first' : '';

  const trClass = ['ai-provider-table__row', isActive ? 'ai-provider-table__row--active' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={trClass}>
      <td>
        <div className="ai-provider-table__name">{PROVIDER_LABEL[row.provider]}</div>
        <div className="ai-provider-table__hint mono-text">{PROVIDER_HINT[row.provider]}</div>
      </td>
      <td>
        {isActive ? (
          <StatusBadge tone="success" withDot>
            Active
          </StatusBadge>
        ) : null}
      </td>
      <td>
        {requiresKey ? (
          row.configured ? (
            'Yes'
          ) : (
            <span className="text-muted">No</span>
          )
        ) : (
          <span className="text-muted">n/a</span>
        )}
      </td>
      <td>
        {requiresKey ? (
          <StatusBadge tone={SOURCE_TONE[row.source]} compact>
            {SOURCE_LABEL[row.source]}
          </StatusBadge>
        ) : null}
      </td>
      <td className="mono-text">
        {isActive ? (
          <span title={activeUpdatedBy ? `by ${activeUpdatedBy}` : 'env fallback'}>
            {formatRelative(activeUpdatedAt)}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="ai-provider-table__actions">
        {requiresKey ? (
          <Button tone="secondary" className="button--sm" onClick={onSetKey}>
            {row.configured ? 'Rotate' : 'Set key'}
          </Button>
        ) : null}
        {requiresKey && row.source === 'db' ? (
          <Button tone="danger" className="button--sm" onClick={onClearKey}>
            Clear
          </Button>
        ) : null}
        {!isActive ? (
          activateDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button tone="primary" className="button--sm" disabled>
                    Make active
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{activateDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <Button tone="primary" className="button--sm" onClick={onMakeActive}>
              Make active
            </Button>
          )
        ) : null}
      </td>
    </tr>
  );
}
