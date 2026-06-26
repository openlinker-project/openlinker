/**
 * InvoiceTimeline (#1240 A3)
 *
 * Vertical two-lane stepper visualising the dual lifecycle of an invoice:
 *
 *   Issuance lane:  Created → Pending → Issued  (left / primary)
 *   Clearance lane: Submitted → Accepted         (right / secondary, hidden when not-applicable)
 *
 * Node states: `done`, `active`, `error`, `pending` (future). Timestamps are
 * rendered via TimeDisplay when available. This is a pure presentational
 * component — all state derivation happens outside.
 *
 * Fiscal notes:
 *   - `issuing` maps to the Pending node but with an info tone (locked)
 *   - `failed+rejected` maps to Issued node with error tone + stop the lane there
 *   - `in-doubt` maps to Issued node with warning tone + stop there (no Retry shown)
 *   - Terminal clearance success is `accepted` — never render "Cleared" as success
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { deriveInvoiceDisplayStatus } from '../lib/derive-invoice-display';
import type { InvoiceRecord } from '../api/invoicing.types';

interface InvoiceTimelineProps {
  invoice: InvoiceRecord | null;
  className?: string;
}

type NodeState = 'done' | 'active' | 'error' | 'warning' | 'pending' | 'locked';

interface TlNode {
  label: string;
  subLabel?: string;
  timestamp?: string | null;
  state: NodeState;
}

/** Bullet marker rendered as a small inline-svg circle icon. */
function TlBullet({ state }: { state: NodeState }): ReactElement {
  const cls = `invoice-tl-bullet invoice-tl-bullet--${state}`;
  return (
    <svg
      className={cls}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {state === 'done' ? (
        <path
          fill="currentColor"
          d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.18 4.47L6.75 9.9 4.82 7.97a.75.75 0 1 0-1.06 1.06l2.47 2.47a.75.75 0 0 0 1.06 0l5-5a.75.75 0 0 0-1.06-1.06z"
        />
      ) : state === 'error' ? (
        <path
          fill="currentColor"
          d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 9.25a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75zM8 4.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4.5z"
        />
      ) : state === 'warning' ? (
        <path
          fill="currentColor"
          d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5a.905.905 0 0 1 .9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
        />
      ) : state === 'active' ? (
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
      ) : state === 'locked' ? (
        <>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <circle cx="8" cy="8" r="2.5" fill="currentColor" className="invoice-tl-bullet__pulse" />
        </>
      ) : (
        /* pending */
        <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="3 2" />
      )}
    </svg>
  );
}

function TlNodeRow({ node }: { node: TlNode }): ReactElement {
  return (
    <li className={`invoice-tl-node invoice-tl-node--${node.state}`}>
      <TlBullet state={node.state} />
      <div className="invoice-tl-node__content">
        <span className="invoice-tl-node__label">{node.label}</span>
        {node.subLabel ? (
          <span className="invoice-tl-node__sub">{node.subLabel}</span>
        ) : null}
        {node.timestamp ? (
          <TimeDisplay
            iso={node.timestamp}
            format="datetime"
            className="invoice-tl-node__ts"
          />
        ) : null}
      </div>
    </li>
  );
}

/**
 * Build the issuance lane nodes from an InvoiceRecord.
 * Created → Pending → Issued (or failed/in-doubt at the Issued step).
 */
function buildIssuanceLane(
  invoice: InvoiceRecord | null,
  t: (key: string, fallback: string) => string,
): TlNode[] {
  const displayStatus = deriveInvoiceDisplayStatus(invoice);

  const createdNode: TlNode = {
    label: t('invoice.tl.created', 'Created'),
    timestamp: invoice?.createdAt ?? null,
    state: 'done',
  };

  if (!invoice) {
    return [{ ...createdNode, state: 'pending' }];
  }

  switch (displayStatus) {
    case 'not-issued':
      return [{ ...createdNode, state: 'pending' }];

    case 'pending':
      return [
        createdNode,
        {
          label: t('invoice.tl.pending', 'Pending'),
          state: 'active',
        },
      ];

    case 'issuing':
      return [
        createdNode,
        {
          label: t('invoice.tl.issuing', 'Issuing'),
          subLabel: t('invoice.tl.issuingHint', 'In progress — locked'),
          state: 'locked',
        },
      ];

    case 'issued':
      return [
        createdNode,
        {
          label: t('invoice.tl.issued', 'Issued'),
          timestamp: invoice.issuedAt,
          state: 'done',
        },
      ];

    case 'failed':
      return [
        createdNode,
        {
          label: t('invoice.tl.failed', 'Failed'),
          subLabel: t('invoice.tl.failedHint', 'Rejected — safe to retry'),
          timestamp: invoice.updatedAt,
          state: 'error',
        },
      ];

    case 'in-doubt':
      return [
        createdNode,
        {
          label: t('invoice.tl.inDoubt', 'Uncertain'),
          subLabel: t('invoice.tl.inDoubtHint', 'Check provider before retrying'),
          timestamp: invoice.updatedAt,
          state: 'warning',
        },
      ];
  }
}

/**
 * Build the clearance lane. Hides the lane entirely when `not-applicable`.
 * Terminal clearance success label is `Accepted` — never `Cleared`.
 */
function buildClearanceLane(
  invoice: InvoiceRecord | null,
  t: (key: string, fallback: string) => string,
): TlNode[] | null {
  if (!invoice || invoice.regulatoryStatus === 'not-applicable') {
    return null;
  }

  const status = invoice.regulatoryStatus;

  if (status === 'submitted') {
    return [
      {
        label: t('invoice.tl.submitted', 'Submitted'),
        timestamp: invoice.updatedAt,
        state: 'done',
      },
      {
        label: t('invoice.tl.clearancePending', 'Awaiting acceptance'),
        state: 'active',
      },
    ];
  }

  if (status === 'accepted') {
    return [
      {
        label: t('invoice.tl.submitted', 'Submitted'),
        state: 'done',
      },
      {
        label: t('invoice.tl.accepted', 'Accepted'),
        timestamp: invoice.updatedAt,
        state: 'done',
      },
    ];
  }

  if (status === 'rejected') {
    return [
      {
        label: t('invoice.tl.submitted', 'Submitted'),
        state: 'done',
      },
      {
        label: t('invoice.tl.clearanceRejected', 'Rejected by authority'),
        timestamp: invoice.updatedAt,
        state: 'error',
      },
    ];
  }

  // cleared — reserved status, not rendered as terminal success
  return [
    {
      label: t('invoice.tl.submitted', 'Submitted'),
      timestamp: invoice.updatedAt,
      state: 'done',
    },
  ];
}

export function InvoiceTimeline({ invoice, className }: InvoiceTimelineProps): ReactElement {
  const { t } = useTranslation();

  const issuanceNodes = buildIssuanceLane(invoice, t);
  const clearanceNodes = buildClearanceLane(invoice, t);

  return (
    <div className={`invoice-timeline ${className ?? ''}`.trim()}>
      <div className="invoice-timeline__lane invoice-timeline__lane--issuance">
        <p className="invoice-timeline__lane-title">
          {t('invoice.tl.issuanceLane', 'Issuance')}
        </p>
        <ol className="invoice-tl-list" aria-label={t('invoice.tl.issuanceLane', 'Issuance')}>
          {issuanceNodes.map((node, i) => (
            <TlNodeRow key={i} node={node} />
          ))}
        </ol>
      </div>

      {clearanceNodes ? (
        <div className="invoice-timeline__lane invoice-timeline__lane--clearance">
          <p className="invoice-timeline__lane-title">
            {t('invoice.tl.clearanceLane', 'Regulatory clearance')}
          </p>
          <ol
            className="invoice-tl-list"
            aria-label={t('invoice.tl.clearanceLane', 'Regulatory clearance')}
          >
            {clearanceNodes.map((node, i) => (
              <TlNodeRow key={i} node={node} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
