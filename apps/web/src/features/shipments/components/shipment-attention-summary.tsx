/**
 * ShipmentAttentionSummary (#4044)
 *
 * "Needs a look" beside the shipments status tabs:
 *
 *   Needs a look  4 to fix · 2 tracking not sent · 3 to send
 *
 * Every number comes from the summary endpoint (#4043), so it covers every
 * page, not the rows loaded. "to fix" also lists failures that share one cause
 * on one connection, with Settings and Show, the job the triage strips did
 * above the table; those groups carry carrier text, so a viewer does not see
 * them (#1826).
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages, usePlural } from '../../../shared/i18n';
import { AttentionSummary, type AttentionGroup } from '../../../shared/ui/attention-summary';
import { Button } from '../../../shared/ui/button';
import type { ShipmentStatus, ShipmentSummary } from '../api/shipments.types';

export interface ShipmentAttentionSummaryProps {
  summary: ShipmentSummary | undefined;
  status: ShipmentStatus | undefined;
  waybillRelayStuck: boolean;
  onStatusChange: (status: ShipmentStatus | null) => void;
  onRelayChange: (on: boolean) => void;
  /** Shows only failed shipments on one connection. */
  onShowCause: (connectionId: string) => void;
  connectionName: (connectionId: string) => string | null;
  /** `shipments:write`: the cause groups carry carrier text. */
  canSeeCauses: boolean;
  /** `connections:write`: the Settings link edits a connection. */
  canReviewConnection: boolean;
}

export function ShipmentAttentionSummary({
  summary,
  status,
  waybillRelayStuck,
  onStatusChange,
  onRelayChange,
  onShowCause,
  connectionName,
  canSeeCauses,
  canReviewConnection,
}: ShipmentAttentionSummaryProps): ReactElement {
  const copy = useMessages('shipments').shipmentsPage.attention;
  const plural = usePlural();
  const failed = summary?.byStatus.failed;
  const drafts = summary?.byStatus.draft;
  const ready = summary?.byStatus.generated;
  const causes = canSeeCauses ? (summary?.failedCauseGroups ?? []) : [];
  const toggleStatus = (next: ShipmentStatus) => (): void => {
    onStatusChange(status === next ? null : next);
  };

  const groups: AttentionGroup[] = [
    {
      id: 'fix',
      label: copy.fix.label,
      short: copy.fix.short,
      tone: 'error',
      total: failed,
      items: [
        {
          id: 'failed',
          label: copy.fix.itemTitle,
          desc: copy.fix.itemDesc,
          tone: 'error',
          on: status === 'failed',
          count: failed,
          toggle: toggleStatus('failed'),
        },
      ],
      after:
        causes.length > 0
          ? (close: () => void): ReactElement => (
              <>
                <div className="attention-pop__sub">{copy.fix.sameProblem}</div>
                {causes.map((cause) => (
                  <div key={`${cause.connectionId}::${cause.providerCode ?? cause.sampleReason}`} className="attention-cause">
                    <span className="attention-cause__text">
                      <strong>
                        {plural(cause.count, copy.fix.groupCount, {
                          connection: connectionName(cause.connectionId) ?? copy.fix.unknownConnection,
                        })}
                      </strong>
                      <span className="mono-text" title={cause.sampleReason}>
                        {cause.providerCode ?? cause.sampleReason}
                      </span>
                    </span>
                    <span className="button-group">
                      {canReviewConnection ? (
                        <Link
                          className="button button--ghost button--sm"
                          to={`/connections/${encodeURIComponent(cause.connectionId)}`}
                          onClick={close}
                        >
                          {copy.fix.settings}
                        </Link>
                      ) : null}
                      <Button
                        tone="secondary"
                        className="button--sm"
                        onClick={() => {
                          close();
                          onShowCause(cause.connectionId);
                        }}
                      >
                        {copy.fix.show}
                      </Button>
                    </span>
                  </div>
                ))}
              </>
            )
          : undefined,
    },
    {
      id: 'relay',
      label: copy.relay.label,
      short: copy.relay.short,
      tone: 'error',
      total: summary?.waybillRelayStuck,
      items: [
        {
          id: 'relay',
          label: copy.relay.itemTitle,
          desc: copy.relay.itemDesc,
          tone: 'error',
          on: waybillRelayStuck,
          count: summary?.waybillRelayStuck,
          toggle: (): void => {
            onRelayChange(!waybillRelayStuck);
          },
        },
      ],
    },
    {
      id: 'send',
      label: copy.send.label,
      short: copy.send.short,
      tone: null,
      total: summary?.toSend,
      items: [
        {
          id: 'draft',
          label: copy.send.draftTitle,
          desc: copy.send.draftDesc,
          on: status === 'draft',
          count: drafts,
          toggle: toggleStatus('draft'),
        },
        {
          id: 'generated',
          label: copy.send.readyTitle,
          desc: copy.send.readyDesc,
          on: status === 'generated',
          count: ready,
          toggle: toggleStatus('generated'),
        },
      ],
    },
  ];

  return <AttentionSummary groups={groups} label={copy.label} />;
}
