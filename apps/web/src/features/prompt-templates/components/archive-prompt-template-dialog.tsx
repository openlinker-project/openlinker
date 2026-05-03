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
import { formatRelativeTime } from '../../../shared/format/format-relative-time';
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
  return channel === null ? 'master' : channel;
}

function buildMetadataItems(row: PromptTemplateSummary): KeyValueItem[] {
  return [
    {
      id: 'key',
      label: 'Key',
      mono: true,
      value: row.key,
    },
    {
      id: 'channel',
      label: 'Channel',
      value: channelLabel(row.channel),
    },
    {
      id: 'version',
      label: 'Version',
      mono: true,
      value: `v${row.latestVersion}`,
    },
    {
      id: 'state',
      label: 'State',
      value: (
        <StatusBadge tone={STATE_TONE[row.latestState]} compact>
          {row.latestState}
        </StatusBadge>
      ),
    },
    {
      id: 'updated',
      label: 'Updated',
      value: formatRelativeTime(row.updatedAt),
    },
  ];
}

export function ArchivePromptTemplateDialog({
  row,
  onOpenChange,
}: ArchivePromptTemplateDialogProps): ReactElement {
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
        title: `Archived v${row.latestVersion}`,
        description: stillVisibleInActive
          ? `Published v${row.publishedVersion} is still active for ${row.key} (${channelLabel(
              row.channel,
            )}).`
          : `${row.key} (${channelLabel(row.channel)}) moved to Archived.`,
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
    if (mutation.isPending) return 'Archiving…';
    if (row === null) return 'Archive';
    if (isPublishedTarget) {
      return force ? `Archive published v${row.latestVersion} (force)` : `Archive published v${row.latestVersion}`;
    }
    return `Archive v${row.latestVersion}`;
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="archive-prompt-template-dialog">
        <DialogTitle>
          Archive {row !== null ? `v${row.latestVersion}` : 'template'}
        </DialogTitle>
        <DialogDescription>
          The row will be hidden from the Active list but kept in history for audit and revert.
        </DialogDescription>

        {row !== null ? (
          <div className="archive-prompt-template-dialog__metadata">
            <KeyValueList items={buildMetadataItems(row)} />
          </div>
        ) : null}

        {isPublishedTarget ? (
          <div className="archive-prompt-template-dialog__danger-zone">
            <p className="archive-prompt-template-dialog__danger-heading">
              Only published version
            </p>
            <p className="archive-prompt-template-dialog__danger-body">
              Active suggestions for this <span className="mono-text">(key, channel)</span> will
              fail until a replacement is published.
            </p>
            <label className="archive-prompt-template-dialog__force">
              <input
                type="checkbox"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              <span>Confirm: this is the only published version</span>
            </label>
          </div>
        ) : null}

        {mutation.error ? (
          <Alert tone="error">{mutation.error.message}</Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>
            Cancel
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
