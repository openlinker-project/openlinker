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
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import { ApiError } from '../../../shared/api/api-error';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { useSuggestContentMutation } from '../hooks/use-content-mutations';
import type { PromptTemplateChannel } from '../api/content.types';

interface SuggestionDialogProps {
  productId: string;
  channel: PromptTemplateChannel | null;
  disabled?: boolean;
  onApply: (suggestion: string) => void;
  /**
   * Optional banner rendered at the top of the dialog body. Used by the
   * offer-edit drawer (#485) to remind operators that the suggestion is
   * sourced from the product's master content — saving still writes only
   * to the single offer the drawer is editing.
   */
  scopeWarning?: ReactNode;
}

const MAX_TONE_LENGTH = 64;
const MAX_EXTRA_LENGTH = 1024;

/**
 * #490: detect the structured 404 the API returns when a prompt template is
 * unseeded for the requested (key, channel) — most commonly the master tab's
 * `offer.description.suggest` row before the seed migration runs. Stepping
 * stone: the back-end could emit a typed error code, but the message-prefix
 * match is good enough until the unified error-shape work picks it up.
 */
function isMissingTemplateError(error: Error): boolean {
  return (
    error instanceof ApiError &&
    error.isNotFound() &&
    error.message.startsWith('Prompt template not found')
  );
}

export function SuggestionDialog({
  productId,
  channel,
  disabled = false,
  onApply,
  scopeWarning,
}: SuggestionDialogProps): ReactElement | null {
  const mutation = useSuggestContentMutation();
  const demoMode = useDemoMode();
  const write = useWriteAccess('ai:suggest', demoMode);
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState('');
  const [extra, setExtra] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  // #478: depend on the destructured stable methods, not the wrapping
  // `mutation` object — `useMutation` returns a fresh wrapper each render,
  // which churns these callback identities.
  const { mutateAsync: generateSuggestion, reset: resetMutation } = mutation;

  const handleGenerate = useCallback(async () => {
    if (tone.length > MAX_TONE_LENGTH || extra.length > MAX_EXTRA_LENGTH) return;
    try {
      const result = await generateSuggestion({
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
  }, [channel, extra, generateSuggestion, productId, tone]);

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
      resetMutation();
    }
  }, [resetMutation]);

  const channelLabel = channel === null ? 'master' : channel;

  // `ai:suggest` is admin-only in every environment — invoking the endpoint
  // triggers a real LLM completion, so it's treated as a direct-write-adjacent
  // action (like Test-connection/Disable-connection, #1615), not an
  // open-a-form action (#1668). A demo viewer sees the trigger rendered but
  // disabled with a read-only tooltip, so the demo advertises the capability
  // exists; a genuinely unauthorized non-demo session doesn't see the
  // affordance at all (`write.visible` false).
  if (!write.visible) {
    return null;
  }

  if (write.demoReadOnly) {
    return (
      <ReadOnlyLock active message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button type="button" tone="ghost" disabled>
          ✨ Suggest with AI
        </Button>
      </ReadOnlyLock>
    );
  }

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
          {scopeWarning ? (
            <div className="content-suggestion__scope-warning" role="note">
              {scopeWarning}
            </div>
          ) : null}

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

          {mutation.error &&
            (isMissingTemplateError(mutation.error) ? (
              <Alert tone="error">
                {mutation.error.message}{' '}
                <Link to="/ai/prompt-templates" className="content-suggestion__alert-link">
                  Open prompt templates →
                </Link>
              </Alert>
            ) : (
              <Alert tone="error">{mutation.error.message}</Alert>
            ))}

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
