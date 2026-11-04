/**
 * Archive Prompt Template Dialog
 *
 * Confirms archiving a draft or published row (#489). Body surfaces the
 * row's operational metadata via `KeyValueList` (cockpit pattern: scan-
 * able status, not prose). Archiving a published row also shows a
 * danger-zone force checkbox that bypasses the BE safety guard. Confirm
 * button copy adapts to the row's state and the force flag so the
 * operator can re-read the action right before clicking.
 *
 * @module apps/web/src/features/prompt-templates/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  getMessages,
  interpolate,
  renderRich,
  useFormat,
  useMessages,
} from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';
import { useArchivePromptTemplateMutation } from '../hooks/use-prompt-template-mutations';
import type {
  PromptTemplateState,
  PromptTemplateSummary,
} from '../api/prompt-templates.types';

interface ArchivePromptTemplateDialogProps {
  row: PromptTemplateSummary | null;
  onOpenChange: (open: boolean) => void;
}

const STATE_TONE: Record<PromptTemplateState, StatusBadgeTone> = {
  draft: 'review',
  published: 'success',
  archived: 'neutral',
};

function channelLabel(channel: PromptTemplateSummary['channel']): string {
  return channel === null ? getMessages('prompt-templates').common.master : channel;
}

function buildMetadataItems(
  row: PromptTemplateSummary,
  relativeTime: (iso: string) => string,
): KeyValueItem[] {
  const messages = getMessages('prompt-templates');
  const copy = messages.archivePromptTemplateDialog.metadata;
  return [
    {
      id: 'key',
      label: copy.key,
      mono: true,
      value: row.key,
    },
    {
      id: 'channel',
      label: copy.channel,
      value: channelLabel(row.channel),
    },
    {
      id: 'version',
      label: copy.version,
      mono: true,
      value: interpolate(messages.common.versionTag, { version: row.latestVersion }),
    },
    {
      id: 'state',
      label: copy.state,
      value: (
        <StatusBadge tone={STATE_TONE[row.latestState]} compact>
          {messages.common.states[row.latestState] ?? row.latestState}
        </StatusBadge>
      ),
    },
    {
      id: 'updated',
      label: copy.updated,
      value: relativeTime(row.updatedAt),
    },
  ];
}

export function ArchivePromptTemplateDialog({
  row,
  onOpenChange,
}: ArchivePromptTemplateDialogProps): ReactElement {
  const messages = useMessages('prompt-templates');
  const copy = messages.archivePromptTemplateDialog;
  const format = useFormat();
  const { showToast } = useToast();
  const mutation = useArchivePromptTemplateMutation();
  const { mutateAsync: archive, reset: resetMutation } = mutation;
  const [force, setForce] = useState(false);

  // Reset transient state every time the dialog opens onto a *different*
  // row. Keying on `row?.latestId` (not the object reference) avoids
  // spurious resets when the parent's list query refetches and rebuilds
  // the row object — same logical row, new reference.
  const targetId = row?.latestId ?? null;
  useEffect(() => {
    setForce(false);
    resetMutation();
  }, [targetId, resetMutation]);

  const open = row !== null;

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      onOpenChange(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (row === null) return;
    try {
      await archive({ id: row.latestId, force: force ? true : undefined });
      const stillVisibleInActive = row.publishedVersion !== null;
      showToast({
        tone: 'success',
        title: interpolate(copy.archivedToastTitle, { version: row.latestVersion }),
        description: stillVisibleInActive
          ? interpolate(copy.stillActiveDescription, {
              published: row.publishedVersion ?? '',
              key: row.key,
              channel: channelLabel(row.channel),
            })
          : interpolate(copy.movedDescription, {
              key: row.key,
              channel: channelLabel(row.channel),
            }),
      });
      onOpenChange(false);
    } catch {
      // surfaced inline via mutation.error
    }
  };

  const isPublishedTarget = row?.latestState === 'published';

  // Confirm-button copy adapts to the path: cockpit pattern is "verb +
  // explicit object", so the operator re-reads what they're committing
  // to immediately before clicking.
  const confirmLabel = ((): string => {
    if (mutation.isPending) return copy.archiving;
    if (row === null) return copy.archive;
    const params = { version: row.latestVersion };
    if (isPublishedTarget) {
      return interpolate(force ? copy.archivePublishedForce : copy.archivePublished, params);
    }
    return interpolate(copy.archiveVersion, params);
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="archive-prompt-template-dialog">
        <DialogTitle>
          {row !== null
            ? interpolate(copy.archiveVersion, { version: row.latestVersion })
            : copy.titleGeneric}
        </DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {row !== null ? (
          <div className="archive-prompt-template-dialog__metadata">
            <KeyValueList items={buildMetadataItems(row, format.relativeTime)} />
          </div>
        ) : null}

        {isPublishedTarget ? (
          <div className="archive-prompt-template-dialog__danger-zone">
            <p className="archive-prompt-template-dialog__danger-heading">
              {copy.dangerHeading}
            </p>
            <p className="archive-prompt-template-dialog__danger-body">
              {renderRich(copy.dangerBody, {
                code: (text) => <span className="mono-text">{text}</span>,
              })}
            </p>
            <label className="archive-prompt-template-dialog__force">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              <span>{copy.forceLabel}</span>
            </label>
          </div>
        ) : null}

        {mutation.error ? (
          <Alert tone="error">{mutation.error.message}</Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>
            {messages.common.cancel}
          </Button>
          <Button
            type="button"
            tone="danger"
            disabled={mutation.isPending || (isPublishedTarget && !force)}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
