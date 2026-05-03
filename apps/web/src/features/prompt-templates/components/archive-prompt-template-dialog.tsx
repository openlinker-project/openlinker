/**
 * Archive Prompt Template Dialog
 *
 * Confirms archiving a draft or published row (#489). Body copy adapts to
 * the row's `latestState`; archiving a published row also shows a `force`
 * checkbox that bypasses the BE safety guard. After a successful archive,
 * the toast surfaces a hint about whether the row will visually disappear
 * from the Active filter (Suggestion 4).
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
import { useToast } from '../../../shared/ui/toast-provider';
import { useArchivePromptTemplateMutation } from '../hooks/use-prompt-template-mutations';
import type { PromptTemplateSummary } from '../api/prompt-templates.types';

interface ArchivePromptTemplateDialogProps {
  row: PromptTemplateSummary | null;
  onOpenChange: (open: boolean) => void;
}

function channelLabel(channel: PromptTemplateSummary['channel']): string {
  return channel === null ? 'master' : channel;
}

export function ArchivePromptTemplateDialog({
  row,
  onOpenChange,
}: ArchivePromptTemplateDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useArchivePromptTemplateMutation();
  const { mutateAsync: archive, reset: resetMutation } = mutation;
  const [force, setForce] = useState(false);

  // Reset transient state every time the dialog opens onto a new row.
  useEffect(() => {
    setForce(false);
    resetMutation();
  }, [row, resetMutation]);

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="archive-prompt-template-dialog">
        <DialogTitle>
          Archive {row !== null ? `v${row.latestVersion}` : 'template'}
        </DialogTitle>
        <DialogDescription>
          {row === null ? null : (
            <>
              Archive <span className="mono-text">{row.key}</span> (
              {channelLabel(row.channel)}) v{row.latestVersion}? It will be hidden from the Active
              list but kept in history for audit and revert.
              {isPublishedTarget ? (
                <>
                  {' '}
                  This is the only published version for the pair — active suggestions will fail
                  until you publish a replacement.
                </>
              ) : null}
            </>
          )}
        </DialogDescription>

        {isPublishedTarget ? (
          <label className="archive-prompt-template-dialog__force">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
            />
            <span>I understand — archive the published row anyway (force)</span>
          </label>
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
            {mutation.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
