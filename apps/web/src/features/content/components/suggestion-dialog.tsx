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
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { RichTextView } from '../../../shared/ui';
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
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { captureDemoEvent } from '../../demo';
import { useSuggestContentMutation } from '../hooks/use-content-mutations';
import type { PromptTemplateChannel } from '../api/content.types';
import { describeApiError } from '../../../shared/api/describe-api-error';

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
 * unseeded for the requested (key, channel) - most commonly the master tab's
 * `offer.description.suggest` row before the seed migration runs.
 */
function isMissingTemplateError(error: Error): boolean {
  return error instanceof ApiError && error.code === 'PROMPT_TEMPLATE_NOT_FOUND';
}

export function SuggestionDialog({
  productId,
  channel,
  disabled = false,
  onApply,
  scopeWarning,
}: SuggestionDialogProps): ReactElement | null {
  const copy = useMessages('content').suggestionDialog;
  const { number: formatNumber } = useFormat();
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
  const channelDisplay = channel === null ? copy.masterChannel : channel;

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
      <ReadOnlyLock
        active
        message={demoReadOnlyActionMessage()}
        onLockedClick={() => captureDemoEvent('demo_ai_suggest_attempted', { channel: channelLabel })}
      >
        <Button type="button" tone="ghost" disabled>
          {copy.trigger}
        </Button>
      </ReadOnlyLock>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" tone="ghost" disabled={disabled}>
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="content-suggestion__dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {renderRich(
            copy.description,
            { strong: (chunk) => <strong>{chunk}</strong> },
            { channel: channelDisplay },
          )}
        </DialogDescription>

        <div className="content-suggestion__body">
          {scopeWarning ? (
            <div className="content-suggestion__scope-warning" role="note">
              {scopeWarning}
            </div>
          ) : null}

          <FormField
            label={copy.tone.label}
            name="tone"
            description={interpolate(copy.tone.description, { max: formatNumber(MAX_TONE_LENGTH) })}
          >
            <Input
              value={tone}
              maxLength={MAX_TONE_LENGTH}
              placeholder={copy.tone.placeholder}
              onChange={(e) => {
                setTone(e.target.value);
              }}
            />
          </FormField>

          <FormField
            label={copy.extra.label}
            name="extra"
            description={interpolate(copy.extra.description, {
              max: formatNumber(MAX_EXTRA_LENGTH),
            })}
          >
            <Textarea
              value={extra}
              maxLength={MAX_EXTRA_LENGTH}
              rows={3}
              placeholder={copy.extra.placeholder}
              onChange={(e) => {
                setExtra(e.target.value);
              }}
            />
          </FormField>

          {mutation.error &&
            (isMissingTemplateError(mutation.error) ? (
              <Alert tone="error">
                {describeApiError(mutation.error, 'content')}{' '}
                <Link to="/ai/prompt-templates" className="content-suggestion__alert-link">
                  {copy.openPromptTemplates}
                </Link>
              </Alert>
            ) : (
              <Alert tone="error">{describeApiError(mutation.error, 'content')}</Alert>
            ))}

          {suggestion !== null && (
            <div className="content-suggestion__preview">
              <h4 className="content-suggestion__preview-title">{copy.preview.title}</h4>
              {/* #2200: the prompt is explicitly instructed to return semantic
                  HTML, so a <pre> showed the operator angle brackets to
                  proofread instead of the copy they are about to publish. */}
              <RichTextView
                html={suggestion}
                className="content-suggestion__preview-body"
                emptyLabel={copy.preview.empty}
              />
              {requestId && (
                <p className="content-suggestion__preview-meta">
                  {copy.preview.requestId} <span className="mono-text">{requestId}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="ghost">
              {copy.actions.cancel}
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
              {mutation.isPending ? copy.actions.generating : copy.actions.generate}
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
                {copy.actions.regenerate}
              </Button>
              <Button type="button" tone="primary" onClick={handleApply}>
                {copy.actions.apply}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
