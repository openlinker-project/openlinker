/**
 * KSeF numbering — connection Actions row (#1577)
 *
 * Contributed to `ConnectionActionsPanel` via the KSeF plugin's
 * `ConnectionActions` slot (the same seam PrestaShop uses for "Configure
 * webhooks"). Because only the KSeF plugin registers this slot, the row is
 * KSeF-only by construction — the capability gate is the plugin boundary, not
 * a platformType literal. The row's description carries the numbering status
 * inline (the rendered next number, or "not set up yet"); the primary button
 * opens the dedicated numbering page.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  renderInvoiceNumber,
  useNumberingAssignmentQuery,
  useNumberingSeriesQuery,
} from '../../../features/invoicing';
import type { Connection } from '../../../features/connections';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';

interface KsefNumberingActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

export function KsefNumberingActions({
  connection,
  readOnly = false,
}: KsefNumberingActionsProps): ReactElement {
  const assignmentQuery = useNumberingAssignmentQuery(connection.id);
  const assignment = assignmentQuery.data ?? null;
  const mainSeriesQuery = useNumberingSeriesQuery(assignment?.mainSeriesId ?? null);

  const configured = Boolean(assignment);
  const to = `/connections/${connection.id}/numbering`;

  const nextPreview =
    mainSeriesQuery.data !== undefined
      ? renderInvoiceNumber(mainSeriesQuery.data.pattern, {
          seq: mainSeriesQuery.data.nextSeq,
          seqPadding: mainSeriesQuery.data.seqPadding,
          issueDate: new Date(),
        })
      : null;

  return (
    <div className="action-list__item">
      <div>
        <strong>Invoice numbering</strong>
        <p className="muted-text">
          Sequential number OpenLinker stamps on every KSeF invoice.{' '}
          {assignmentQuery.isLoading ? null : configured ? (
            nextPreview ? (
              <>
                Next: <span className="mono-text tabular">{nextPreview}</span>
              </>
            ) : null
          ) : (
            <span className="numbering-status-warning">not set up yet</span>
          )}
        </p>
      </div>
      {readOnly ? (
        <ReadOnlyLock active message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button tone={configured ? 'secondary' : 'primary'} disabled>
            {configured ? 'Configure…' : 'Set up…'}
          </Button>
        </ReadOnlyLock>
      ) : (
        <Link className={`button button--${configured ? 'secondary' : 'primary'}`} to={to}>
          {configured ? 'Configure…' : 'Set up…'}
        </Link>
      )}
    </div>
  );
}
