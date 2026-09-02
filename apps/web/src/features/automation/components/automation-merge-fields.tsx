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
import { AUTOMATION_COMPOSER_COPY } from '../lib/automation.copy';
import { AUTOMATION_MERGE_FIELDS } from '../api/automation.types';

interface AutomationMergeFieldsProps {
  onInsert: (token: string) => void;
}

export function AutomationMergeFields({ onInsert }: AutomationMergeFieldsProps): ReactElement {
  return (
    <div className="automation-merge-fields">
      <p className="eyebrow">{AUTOMATION_COMPOSER_COPY.mergeFieldsTitle}</p>
      <div className="automation-merge-fields__chips">
        {AUTOMATION_MERGE_FIELDS.map((field) => (
          <Button
            key={field.token}
            tone="secondary"
            className="button--xs"
            title={field.renders}
            onClick={() => onInsert(field.token)}
          >
            <span className="mono-text">{field.token}</span>
          </Button>
        ))}
      </div>
      <p className="muted-text">{AUTOMATION_COMPOSER_COPY.mergeFieldsHint}</p>
    </div>
  );
}
