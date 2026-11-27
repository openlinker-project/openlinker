/**
 * Preview of the settings on recent orders (#2729)
 *
 * Runs the DRAFT values from the form against the connection's most recent
 * orders and says which would get a label and which would be refused, before
 * anything is saved. It is driven by the parent's current form values, so what
 * is previewed is exactly what Save would write.
 *
 * Reports its own states rather than hiding them: a failed run, an unreadable
 * response (never rendered as "nothing to preview") and an empty result.
 *
 * @module apps/web/src/features/auto-dispatch/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type {
  AutoDispatchPreview,
  AutoDispatchPreviewItem,
} from '../api/auto-dispatch.types';
import { autoDispatchCopy } from '../lib/auto-dispatch.copy';

const COPY = autoDispatchCopy.preview;

function formatBox(item: AutoDispatchPreviewItem): string {
  return item.dimensions === null
    ? COPY.none
    : `${String(item.dimensions.length)} × ${String(item.dimensions.width)} × ${String(item.dimensions.height)}`;
}

export interface AutoDispatchPreviewPanelProps {
  readonly onRun: () => void;
  readonly running: boolean;
  /** Disabled while the form holds a value that cannot be previewed (it is invalid). */
  readonly disabled: boolean;
  readonly error: Error | null;
  /** `undefined` before the first run; `null` when the response could not be read. */
  readonly result: AutoDispatchPreview | null | undefined;
}

export function AutoDispatchPreviewPanel(props: AutoDispatchPreviewPanelProps): ReactElement {
  let body: ReactElement | null = null;

  if (props.error !== null) {
    body = (
      <Alert tone="error" title={COPY.failedTitle}>
        {props.error.message}
      </Alert>
    );
  } else if (props.result === null) {
    body = (
      <Alert tone="warning" title={COPY.failedTitle}>
        {COPY.unreadable}
      </Alert>
    );
  } else if (props.result !== undefined && props.result.items.length === 0) {
    body = <p className="auto-dispatch__help">{COPY.empty}</p>;
  } else if (props.result !== undefined) {
    const refused = props.result.items.filter((item) => item.refusal !== null).length;
    body = (
      <>
        <p className="auto-dispatch__bucket-title" data-testid="auto-dispatch-preview-summary">
          {COPY.summary(props.result.items.length - refused, refused)}
        </p>
        <ul className="auto-dispatch__list">
          {props.result.items.map((item) => (
            <li className="auto-dispatch__row" key={item.workId} data-testid="auto-dispatch-preview-row">
              <div className="auto-dispatch__row-main">
                <p className="auto-dispatch__row-reason">
                  <Link to={`/orders/${encodeURIComponent(item.orderId)}`}>{item.orderId}</Link>
                </p>
                <p className="auto-dispatch__row-meta">
                  {item.refusal === null
                    ? `${COPY.weight}: ${item.weightGrams === null ? COPY.none : `${String(item.weightGrams)} g`} · ${COPY.template}: ${item.template ?? COPY.none} · ${COPY.box}: ${formatBox(item)}`
                    : COPY.reasons[item.refusal]}
                </p>
              </div>
              <StatusBadge tone={item.refusal === null ? 'success' : 'warning'} compact withDot>
                {item.refusal === null ? COPY.wouldLabel : COPY.refused}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section className="auto-dispatch__block" data-testid="auto-dispatch-preview">
      <h3 className="auto-dispatch__block-title">{COPY.title}</h3>
      <p className="auto-dispatch__help">{COPY.help}</p>
      <div>
        <Button
          type="button"
          tone="secondary"
          data-testid="btn-auto-dispatch-preview"
          disabled={props.running || props.disabled}
          onClick={props.onRun}
        >
          {props.running ? COPY.running : COPY.run}
        </Button>
      </div>
      <div aria-live="polite">{body}</div>
    </section>
  );
}
