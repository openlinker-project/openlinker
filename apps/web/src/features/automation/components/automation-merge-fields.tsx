/**
 * The nine merge fields (#2365, spec §5.3b)
 *
 * A CLOSED list, rendered as insertable chips. An open templating surface is a
 * scripting language, which §6 refuses.
 *
 * The hint states the rule that matters most: an unrecognised `{…}` is sent
 * VERBATIM, never blanked. Blanking silently produces an email that reads as
 * broken; a visible `{ordr.reference}` is a typo the operator can see and fix.
 *
 * **`onInsert` appends to the end of the body, not at the caret** — a deliberate
 * v1 limit rather than an oversight. Caret-aware insertion needs a ref into the
 * textarea and selection bookkeeping RHF does not carry; appending is honest
 * about what it does and the operator can move the token.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useMessages } from '../../../shared/i18n';
import { AUTOMATION_MERGE_FIELDS } from '../api/automation.types';

/** `{order.placedAt}` -> `orderPlacedAt`, the key its description lives under. */
function describeToken(token: string, tokenCopy: Record<string, string>): string {
  const key = token
    .slice(1, -1)
    .replace(/\.([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return tokenCopy[key] ?? token;
}

interface AutomationMergeFieldsProps {
  onInsert: (token: string) => void;
}

export function AutomationMergeFields({ onInsert }: AutomationMergeFieldsProps): ReactElement {
  const messages = useMessages('automation');
  const copy = messages.composer;
  const tokenCopy = messages.mergeFields.tokens as Record<string, string>;
  return (
    <div className="automation-merge-fields">
      <p className="eyebrow">{copy.mergeFieldsTitle}</p>
      <div className="automation-merge-fields__chips">
        {AUTOMATION_MERGE_FIELDS.map((field) => (
          <Button
            key={field.token}
            tone="secondary"
            className="button--xs"
            title={describeToken(field.token, tokenCopy)}
            onClick={() => onInsert(field.token)}
          >
            <span className="mono-text">{field.token}</span>
          </Button>
        ))}
      </div>
      <p className="muted-text">{copy.mergeFieldsHint}</p>
    </div>
  );
}
