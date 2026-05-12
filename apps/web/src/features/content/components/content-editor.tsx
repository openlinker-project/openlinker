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
import { usePlugins } from '../../../shared/plugins';
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
import { resolveSuggestChannel } from '../api/content.utils';
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

function formatMutationError(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export function ContentEditor({ productId }: ContentEditorProps): ReactElement {
  const query = useContentQuery(productId);
  const saveMutation = useSaveContentDraftMutation();
  const discardMutation = useDiscardContentDraftMutation();
  const publishMutation = usePublishContentMutation();
  const platformPlugins = usePlugins();

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
        showToast({ tone: 'success', description: 'Draft saved' });
      } catch {
        /* surfaced via saveMutation.error */
      }
    },
    [productId, saveDraft, showToast],
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
        showToast({ tone: 'success', description: 'Draft discarded' });
      } catch {
        /* surfaced via discardMutation.error */
      }
    },
    [discardDraft, productId, showToast],
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
      showToast({ tone: 'success', description: 'Published' });
    } catch {
      /* surfaced via publishMutation.error */
    }
  }, [pendingPublish, productId, publishDraft, showToast]);

  if (query.isLoading) {
    return <LoadingState title="Loading content" message="Fetching descriptions…" />;
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load content"
        message={query.error.message}
        action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
      />
    );
  }

  if (!query.data) {
    return <ErrorState title="Unable to load content" message="Unexpected empty response" />;
  }

  const master: ContentMasterState = query.data.master;
  const busy = saveMutation.isPending || discardMutation.isPending || publishMutation.isPending;
  const mutationError =
    formatMutationError(saveMutation.error) ||
    formatMutationError(discardMutation.error) ||
    formatMutationError(publishMutation.error);
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
        <TabsList aria-label="Content targets">
          <TabsTrigger value="master">
            Master
            {master.hasConflict && (
              <StatusBadge tone="warning" compact className="content-editor__conflict-pill">
                !
              </StatusBadge>
            )}
            {master.draftValue !== null && !master.hasConflict && (
              <StatusBadge tone="review" compact className="content-editor__conflict-pill">
                draft
              </StatusBadge>
            )}
          </TabsTrigger>
          {channels.map((channel) => (
            <TabsTrigger key={channel.connectionId} value={channel.connectionId}>
              {channel.connectionName}
              {channel.hasConflict && (
                <StatusBadge tone="warning" compact className="content-editor__conflict-pill">
                  !
                </StatusBadge>
              )}
              {channel.draftValue !== null && !channel.hasConflict && (
                <StatusBadge tone="review" compact className="content-editor__conflict-pill">
                  draft
                </StatusBadge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="master">
          <ContentPanel
            title="Master description"
            subtitle="Canonical description. Publishing updates the product master and clears the draft."
            baseValue={master.baseValue}
            draftValue={master.draftValue}
            hasConflict={master.hasConflict}
            updatedAt={master.updatedAt}
            updatedBy={master.updatedBy}
            isDesktop={isDesktop}
            busy={busy}
            error={mutationError}
            errors={publishStructuredErrors}
            suggestSlot={
              <SuggestionDialog
                productId={productId}
                channel={null}
                disabled={busy || !isDesktop}
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
              setPendingPublish({ kind: 'master' });
            }}
          />
        </TabsContent>

        {channels.map((channel) => {
          const target: ActiveTarget = { kind: 'channel', connectionId: channel.connectionId };
          const promptChannel = resolveSuggestChannel(channel.platformType);
          const disabledReason =
            channel.connectionStatus !== 'active'
              ? `Connection is ${channel.connectionStatus}. Re-activate to enable editing.`
              : null;
          return (
            <TabsContent key={channel.connectionId} value={channel.connectionId}>
              <ContentPanel
                title={channel.connectionName}
                subtitle={
                  <>
                    {channel.platformType} · {channel.linkedOfferCount.toLocaleString()} linked
                    offer{channel.linkedOfferCount === 1 ? '' : 's'}
                  </>
                }
                statusSlot={
                  channel.connectionStatus === 'active' ? (
                    <StatusBadge tone="success" withDot>
                      active
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="warning" withDot>
                      {channel.connectionStatus}
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
          title="No eligible channels"
          message="Channels appear here when an active connection with the OfferFieldUpdater capability has at least one linked offer for this product."
        />
      )}

      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPublish(null);
        }}
        title="Publish description?"
        description={
          pendingPublish?.kind === 'master'
            ? 'This will send the draft to the product master and clear the draft. External systems may reconcile.'
            : 'This will push the draft to every linked offer on the selected channel and clear the draft.'
        }
        confirmLabel="Publish"
        isConfirming={publishMutation.isPending}
        onConfirm={() => {
          void handlePublishConfirm();
        }}
      />

    </div>
  );
}
