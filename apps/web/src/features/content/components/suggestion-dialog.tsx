/**
 * Suggestion Dialog
 *
 * Modal that triggers an AI description suggestion for a product channel (or
 * master) and lets the operator apply or dismiss the result. Apply writes the
 * suggestion into the parent panel buffer but does NOT save — the operator
 * still reviews and saves the draft manually.
 *
 * @module apps/web/src/features/content/components
 */
import { useCallback, useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Textarea } from '../../../shared/ui/textarea';
import { useSuggestContentMutation } from '../hooks/use-content-mutations';
import type { PromptTemplateChannel } from '../api/content.types';

interface SuggestionDialogProps {
  productId: string;
  channel: PromptTemplateChannel | null;
  disabled?: boolean;
  onApply: (suggestion: string) => void;
}

const MAX_TONE_LENGTH = 64;
const MAX_EXTRA_LENGTH = 1024;

export function SuggestionDialog({
  productId,
  channel,
  disabled = false,
  onApply,
}: SuggestionDialogProps): ReactElement {
  const mutation = useSuggestContentMutation();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState('');
  const [extra, setExtra] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (tone.length > MAX_TONE_LENGTH || extra.length > MAX_EXTRA_LENGTH) return;
    try {
      const result = await mutation.mutateAsync({
        productId,
        input: {
          channel,
          tone: tone.trim() === '' ? undefined : tone.trim(),
          extraInstructions: extra.trim() === '' ? undefined : extra.trim(),
        },
      });
      setSuggestion(result.suggestion);
      setRequestId(result.requestId);
    } catch {
      /* surfaced via mutation.error */
    }
  }, [channel, extra, mutation, productId, tone]);

  const handleApply = useCallback(() => {
    if (suggestion === null) return;
    onApply(suggestion);
    setOpen(false);
    setSuggestion(null);
    setRequestId(null);
  }, [onApply, suggestion]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setSuggestion(null);
      setRequestId(null);
      mutation.reset();
    }
  }, [mutation]);

  const channelLabel = channel === null ? 'master' : channel;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" tone="ghost" disabled={disabled}>
          ✨ Suggest with AI
        </Button>
      </DialogTrigger>
      <DialogContent className="content-suggestion__dialog">
        <DialogTitle>Suggest description</DialogTitle>
        <DialogDescription>
          Generate a draft for the <strong>{channelLabel}</strong> description. Review before
          applying — the suggestion replaces the editor buffer but does not auto-save.
        </DialogDescription>

        <div className="content-suggestion__body">
          <FormField
            label="Tone"
            name="tone"
            description={`Optional. Max ${MAX_TONE_LENGTH} chars.`}
          >
            <Input
              value={tone}
              maxLength={MAX_TONE_LENGTH}
              placeholder="e.g. confident, concise"
              onChange={(e) => {
                setTone(e.target.value);
              }}
            />
          </FormField>

          <FormField
            label="Extra instructions"
            name="extra"
            description={`Optional. Max ${MAX_EXTRA_LENGTH} chars.`}
          >
            <Textarea
              value={extra}
              maxLength={MAX_EXTRA_LENGTH}
              rows={3}
              placeholder="e.g. highlight warranty, mention free shipping"
              onChange={(e) => {
                setExtra(e.target.value);
              }}
            />
          </FormField>

          {mutation.error && <Alert tone="error">{mutation.error.message}</Alert>}

          {suggestion !== null && (
            <div className="content-suggestion__preview">
              <h4 className="content-suggestion__preview-title">Suggested description</h4>
              <pre className="content-suggestion__preview-body">{suggestion}</pre>
              {requestId && (
                <p className="content-suggestion__preview-meta">
                  Request ID <span className="mono-text">{requestId}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="ghost">
              Cancel
            </Button>
          </DialogClose>
          {suggestion === null ? (
            <Button
              type="button"
              tone="primary"
              disabled={mutation.isPending}
              onClick={() => {
                void handleGenerate();
              }}
            >
              {mutation.isPending ? 'Generating…' : 'Generate'}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                tone="secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  void handleGenerate();
                }}
              >
                Regenerate
              </Button>
              <Button type="button" tone="primary" onClick={handleApply}>
                Apply to editor
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
