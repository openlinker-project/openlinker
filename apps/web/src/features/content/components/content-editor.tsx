/**
 * Content Editor
 *
 * Tabbed editor for product descriptions — master tab + one tab per active
 * channel connection with linked offers on the current adapter. Wires query +
 * mutations from the content feature and delegates presentation to
 * `ContentPanel`. Handles publish confirmation, toast feedback, and quick
 * re-dispatch of the suggestion result into the active buffer.
 *
 * @module apps/web/src/features/content/components
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { MASTER_DESCRIPTION_FORMAT } from '../../../shared/ui';
import { ChannelContentPanel } from './channel-content-panel';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/tabs';
import { useToast } from '../../../shared/ui/toast-provider';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { ApiError } from '../../../shared/api/api-error';
import { Button } from '../../../shared/ui/button';
import { extractPlatformErrors } from '../lib/extract-platform-errors';
import { usePlatforms } from '../../../shared/plugins';
import { captureDemoEvent } from '../../demo';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { useContentQuery } from '../hooks/use-content-query';
import {
  useDiscardContentDraftMutation,
  usePublishContentMutation,
  useSaveContentDraftMutation,
} from '../hooks/use-content-mutations';
import type {
  ContentChannelState,
  ContentMasterState,
} from '../api/content.types';
import { ContentPanel } from './content-panel';
import { SuggestionDialog } from './suggestion-dialog';

interface ContentEditorProps {
  productId: string;
}

type ActiveTarget = { kind: 'master' } | { kind: 'channel'; connectionId: string };

const TAB_SEARCH_PARAM = 'tab';

function toTabValue(target: ActiveTarget): string {
  return target.kind === 'master' ? 'master' : target.connectionId;
}

function fromTabValue(value: string, channels: ContentChannelState[]): ActiveTarget {
  if (value === 'master') return { kind: 'master' };
  const found = channels.find((c) => c.connectionId === value);
  return found ? { kind: 'channel', connectionId: found.connectionId } : { kind: 'master' };
}

function formatMutationError(err: unknown, unknownError: string): string | null {
  if (err === null || err === undefined) return null;
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return unknownError;
}

export function ContentEditor({ productId }: ContentEditorProps): ReactElement {
  const copy = useMessages('content').contentEditor;
  const plural = usePlural();
  const query = useContentQuery(productId);
  const saveMutation = useSaveContentDraftMutation();
  const discardMutation = useDiscardContentDraftMutation();
  const publishMutation = usePublishContentMutation();
  const platformPlugins = usePlatforms();
  const demoMode = useDemoMode();
  // #1873: viewer-role sessions can read content state (backend GET is open
  // to every role) but must not be able to save/discard/publish drafts — the
  // panel renders read-only with an explanatory reason rather than firing a
  // save/publish request that the backend would 403 anyway.
  const write = useWriteAccess('content:write', demoMode);
  const writeLockedReason = write.canWrite
    ? null
    : copy.readOnlyAccess;

  // #478: depend on the destructured stable `mutateAsync` methods, not the
  // wrapping mutation objects — `useMutation` returns a fresh wrapper each
  // render, which churns these callback identities.
  const { mutateAsync: saveDraft } = saveMutation;
  const { mutateAsync: discardDraft } = discardMutation;
  const { mutateAsync: publishDraft } = publishMutation;
  const { showToast } = useToast();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingPublish, setPendingPublish] = useState<ActiveTarget | null>(null);

  const channels = useMemo<ContentChannelState[]>(
    () => query.data?.channels ?? [],
    [query.data?.channels],
  );

  const activeTab = searchParams.get(TAB_SEARCH_PARAM) ?? 'master';
  const active = fromTabValue(activeTab, channels);

  const setActive = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(TAB_SEARCH_PARAM, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleSave = useCallback(
    async (target: ActiveTarget, value: string): Promise<void> => {
      try {
        await saveDraft({
          productId,
          input: {
            connectionId: target.kind === 'master' ? null : target.connectionId,
            fieldKey: 'description',
            value,
          },
        });
        showToast({ tone: 'success', description: copy.toasts.draftSaved });
      } catch {
        /* surfaced via saveMutation.error */
      }
    },
    [copy.toasts.draftSaved, productId, saveDraft, showToast],
  );

  const handleDiscard = useCallback(
    async (target: ActiveTarget): Promise<void> => {
      try {
        await discardDraft({
          productId,
          input: {
            connectionId: target.kind === 'master' ? null : target.connectionId,
            fieldKey: 'description',
          },
        });
        showToast({ tone: 'success', description: copy.toasts.draftDiscarded });
      } catch {
        /* surfaced via discardMutation.error */
      }
    },
    [copy.toasts.draftDiscarded, discardDraft, productId, showToast],
  );

  const handlePublishConfirm = useCallback(async (): Promise<void> => {
    if (pendingPublish === null) return;
    const target = pendingPublish;
    setPendingPublish(null);
    try {
      await publishDraft({
        productId,
        input: {
          connectionId: target.kind === 'master' ? null : target.connectionId,
          fieldKey: 'description',
        },
      });
      showToast({ tone: 'success', description: copy.toasts.published });
    } catch {
      /* surfaced via publishMutation.error */
    }
  }, [copy.toasts.published, pendingPublish, productId, publishDraft, showToast]);

  const connectionStatusLabel = (status: string): string => {
    const labels: Record<string, string> = copy.channel.connectionStatus;
    return Object.prototype.hasOwnProperty.call(labels, status) ? labels[status] : status;
  };

  if (query.isLoading) {
    return <LoadingState title={copy.loading.title} message={copy.loading.message} />;
  }

  if (query.error) {
    return (
      <ErrorState
        title={copy.loadError.title}
        message={query.error.message}
        action={<Button onClick={() => { void query.refetch(); }}>{copy.loadError.retry}</Button>}
      />
    );
  }

  if (!query.data) {
    return <ErrorState title={copy.loadError.title} message={copy.loadError.emptyResponse} />;
  }

  const master: ContentMasterState = query.data.master;
  const busy = saveMutation.isPending || discardMutation.isPending || publishMutation.isPending;
  const mutationError =
    formatMutationError(saveMutation.error, copy.unknownError) ||
    formatMutationError(discardMutation.error, copy.unknownError) ||
    formatMutationError(publishMutation.error, copy.unknownError);
  // #486 / #613: when the publish failure is a structured platform error
  // (today: Allegro's `CHANNEL_PUBLISH_FAILED` 422), surface the per-field
  // errors instead of the bare "API error (422):" string. The dispatcher
  // iterates registered plugins and returns the first non-null match —
  // shape-based dispatch, no channel context needed. Save / discard never
  // produce this shape.
  const publishStructuredErrors = extractPlatformErrors(publishMutation.error, platformPlugins);

  return (
    <div className="content-editor">
      <Tabs value={toTabValue(active)} onValueChange={setActive}>
        <TabsList aria-label={copy.tabs.ariaLabel}>
          <TabsTrigger value="master">
            {copy.tabs.master}
            {master.hasConflict && (
              <StatusBadge tone="warning" compact className="content-editor__conflict-pill">
                {copy.tabs.conflictMarker}
              </StatusBadge>
            )}
            {master.draftValue !== null && !master.hasConflict && (
              <StatusBadge tone="review" compact className="content-editor__conflict-pill">
                {copy.tabs.draft}
              </StatusBadge>
            )}
          </TabsTrigger>
          {channels.map((channel) => (
            <TabsTrigger key={channel.connectionId} value={channel.connectionId}>
              {channel.connectionName}
              {channel.hasConflict && (
                <StatusBadge tone="warning" compact className="content-editor__conflict-pill">
                  {copy.tabs.conflictMarker}
                </StatusBadge>
              )}
              {channel.draftValue !== null && !channel.hasConflict && (
                <StatusBadge tone="review" compact className="content-editor__conflict-pill">
                  {copy.tabs.draft}
                </StatusBadge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="master">
          <ContentPanel
            title={copy.master.title}
            subtitle={copy.master.subtitle}
            format={MASTER_DESCRIPTION_FORMAT}
            baseValue={master.baseValue}
            draftValue={master.draftValue}
            hasConflict={master.hasConflict}
            updatedAt={master.updatedAt}
            updatedBy={master.updatedBy}
            disabledReason={writeLockedReason}
            isDesktop={isDesktop}
            busy={busy}
            error={mutationError}
            errors={publishStructuredErrors}
            suggestSlot={
              <SuggestionDialog
                productId={productId}
                channel={null}
                // `writeLockedReason` belongs here too: applying a suggestion
                // calls `handleSave`. Since #2200 this button sits INSIDE the
                // editor toolbar, where every sibling control is disabled for a
                // viewer - leaving this one live was the odd one out. The channel
                // branch below already gated it.
                disabled={busy || !isDesktop || writeLockedReason !== null}
                onApply={(text) => {
                  void handleSave({ kind: 'master' }, text);
                }}
              />
            }
            onSave={(value) => {
              void handleSave({ kind: 'master' }, value);
            }}
            onDiscard={() => {
              void handleDiscard({ kind: 'master' });
            }}
            onPublish={() => {
              captureDemoEvent('demo_content_publish_attempted', { channel: 'master' });
              setPendingPublish({ kind: 'master' });
            }}
          />
        </TabsContent>

        {channels.map((channel) => {
          const target: ActiveTarget = { kind: 'channel', connectionId: channel.connectionId };
          // Channel is the connection's platformType verbatim (#580). The
          // backend transparently falls back to the master template when no
          // channel-specific template is published.
          const promptChannel = channel.platformType;
          const disabledReason =
            channel.connectionStatus !== 'active'
              ? interpolate(copy.channel.inactiveReason, {
                  status: connectionStatusLabel(channel.connectionStatus),
                })
              : writeLockedReason;
          return (
            <TabsContent key={channel.connectionId} value={channel.connectionId}>
              <ChannelContentPanel
                connectionId={channel.connectionId}
                title={channel.connectionName}
                subtitle={plural(channel.linkedOfferCount, copy.channel.linkedOffers, {
                  platform: channel.platformType,
                })}
                statusSlot={
                  channel.connectionStatus === 'active' ? (
                    <StatusBadge tone="success" withDot>
                      {copy.channel.connectionStatus.active}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="warning" withDot>
                      {connectionStatusLabel(channel.connectionStatus)}
                    </StatusBadge>
                  )
                }
                baseValue={channel.baseValue}
                draftValue={channel.draftValue}
                hasConflict={channel.hasConflict}
                updatedAt={channel.updatedAt}
                updatedBy={channel.updatedBy}
                disabledReason={disabledReason}
                isDesktop={isDesktop}
                busy={busy}
                error={mutationError}
                suggestSlot={
                  <SuggestionDialog
                    productId={productId}
                    channel={promptChannel}
                    disabled={busy || !isDesktop || disabledReason !== null}
                    onApply={(text) => {
                      void handleSave(target, text);
                    }}
                  />
                }
                onSave={(value) => {
                  void handleSave(target, value);
                }}
                onDiscard={() => {
                  void handleDiscard(target);
                }}
                onPublish={() => {
                  captureDemoEvent('demo_content_publish_attempted', { channel: promptChannel });
                  setPendingPublish(target);
                }}
              />
            </TabsContent>
          );
        })}
      </Tabs>

      {channels.length === 0 && (
        <EmptyState
          liveRegion="off"
          title={copy.noChannels.title}
          message={copy.noChannels.message}
        />
      )}

      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPublish(null);
        }}
        title={copy.publishDialog.title}
        description={
          pendingPublish?.kind === 'master'
            ? copy.publishDialog.masterDescription
            : copy.publishDialog.channelDescription
        }
        confirmLabel={copy.publishDialog.confirm}
        isConfirming={publishMutation.isPending}
        onConfirm={() => {
          void handlePublishConfirm();
        }}
      />

    </div>
  );
}
