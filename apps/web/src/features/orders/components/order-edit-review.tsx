/**
 * Order Edit Review (#3544, mockup M1 `edit-review`)
 *
 * What the order will look like after the edit, rendered from the server's dry
 * run and nothing else. The columns are the two figures every surface shows:
 * what the channel has (the buyer paid) and the order after the edit. No figure
 * is computed here.
 *
 * **A discount states its money consequence (D10).** By the order's payment
 * branch: the amount still to collect on an unpaid or cash-on-delivery order, or
 * the refund the seller makes on the channel plus the document correction on a
 * paid one, with the refund-ceiling verdict. OpenLinker moves no money, so the
 * paid branch never says "refund" as something OpenLinker does.
 *
 * **A quantity edit and a discount are never previewed together.** Each dry run
 * is computed against the order as it is saved today, so a discount previewed
 * beside new quantities would print money that is not what gets saved. The
 * dialog drops the discount from that review (`discountDeferred`) and says to
 * save the quantities first; a money figure here is always the server's figure
 * for what is about to be saved.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { describeCombinedDiscount } from '../lib/combined-discount';
import { formatAmount } from '../../../shared/format/format-amount';
import type {
  OrderDiscountResult,
  OrderEditAddress,
  OrderEditsView,
} from '../api/order-edit.types';
import {
  DISCOUNT_BRANCH_LABELS,
  DISCOUNT_CORRECTION_UNAVAILABLE_COPY,
  describeCeilingVerdict,
  formatDecimalAmount,
  type OrderEditSection,
} from '../lib/order-edit';
import type { EditOrderOutput } from '../hooks/use-edit-order-mutation';
import type { OrderEditLineMeta } from './order-edit-dialog.schema';

export interface OrderEditDryRun {
  section: OrderEditSection;
  output: EditOrderOutput;
}

export interface OrderEditReviewProps {
  dryRuns: readonly OrderEditDryRun[];
  lineMeta: readonly OrderEditLineMeta[];
  /** Display name of the source connection. */
  channelName: string | null;
  /**
   * The discount was filled in alongside a quantity change. It is NOT previewed:
   * a dry run reads the order as saved today, so its money would not be what is
   * saved after the quantities. The operator saves the quantities first.
   */
  discountDeferred?: boolean;
}

function isDiscountResult(output: EditOrderOutput): output is OrderDiscountResult {
  return 'paymentBranch' in output;
}

function addressText(address: OrderEditAddress | null): string {
  if (address === null) return '-';
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ');
  const street = [address.address1, address.address2].filter(Boolean).join(', ');
  const place = [address.postalCode, address.city].filter(Boolean).join(' ');
  return [name, address.company, street, place, address.country].filter(Boolean).join(' · ');
}

function methodText(method: { id: string | null; name: string | null }): string {
  return method.name ?? method.id ?? '-';
}

/** The money of one dry run's view, when it restated any. */
function totalsOf(output: EditOrderOutput): OrderEditsView['totals'] | null {
  const totals = output.view.totals;
  return totals === null || totals === undefined ? null : totals;
}

export function OrderEditReview({
  dryRuns,
  lineMeta,
  channelName,
  discountDeferred = false,
}: OrderEditReviewProps): ReactElement {
  const channel = channelName ?? 'the sales channel';
  const bySection = new Map(dryRuns.map((run) => [run.section, run.output] as const));
  const addressView = bySection.get('address')?.view.address ?? null;
  const deliveryView = bySection.get('delivery')?.view.deliveryMethod ?? null;
  const linesOutput = bySection.get('lines');
  const discountOutput = (() => {
    const output = bySection.get('discount');
    return output !== undefined && isDiscountResult(output) ? output : null;
  })();
  const metaById = new Map(lineMeta.map((meta) => [meta.orderLineId, meta] as const));

  const shownTotals =
    (linesOutput ? totalsOf(linesOutput) : null) ??
    (discountOutput ? totalsOf(discountOutput) : null);

  const combinedDiscountText =
    shownTotals && discountOutput?.discount
      ? describeCombinedDiscount(shownTotals, Number(discountOutput.discount.amount), channelName)
      : null;

  return (
    <div className="order-edit-review" data-testid="order-edit-review">
      <div className="dialog-section">
        <p className="dialog-section__head">Changes</p>
        <div className="data-table__container">
          <table className="data-table order-edit-diff" data-testid="order-edit-diff">
            <thead>
              <tr>
                <th>What</th>
                <th>{`${channel} has`}</th>
                <th>After the edit</th>
              </tr>
            </thead>
            <tbody>
              {addressView ? (
                <tr data-testid="order-edit-diff-address">
                  <td>Shipping address</td>
                  <td>
                    <del>{addressText(addressView.original)}</del>
                  </td>
                  <td>
                    <ins>{addressText(addressView.current)}</ins>
                  </td>
                </tr>
              ) : null}
              {deliveryView ? (
                <tr data-testid="order-edit-diff-delivery">
                  <td>Delivery method</td>
                  <td>
                    <del>{methodText(deliveryView.original)}</del>
                  </td>
                  <td>
                    <ins>{methodText(deliveryView.current)}</ins>
                  </td>
                </tr>
              ) : null}
              {linesOutput
                ? linesOutput.view.lines.map((line) => {
                    const meta = metaById.get(line.orderLineId);
                    return (
                      <tr key={line.orderLineId} data-testid="order-edit-diff-line">
                        <td>
                          <span className="order-line-item__product-info">
                            <span className="order-line-item__name">
                              {meta?.name ?? meta?.sku ?? line.orderLineId}
                            </span>
                            {meta?.sku ? (
                              <span className="order-line-item__sku mono-text">{meta.sku}</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="mono-text">
                          <del>{line.channelQuantity}</del>
                        </td>
                        <td className="mono-text">
                          <ins>{line.quantity}</ins>
                        </td>
                      </tr>
                    );
                  })
                : null}
              {discountOutput ? (
                <tr data-testid="order-edit-diff-discount">
                  <td>Discount</td>
                  <td>
                    <del>none</del>
                  </td>
                  <td>
                    <ins className="mono-text">
                      {discountOutput.discount
                        ? `−${formatDecimalAmount(discountOutput.discount.amount, discountOutput.discount.currency)}`
                        : 'removed'}
                    </ins>
                    {combinedDiscountText ? (
                      <span className="text-muted" data-testid="order-edit-combined-discount">
                        {' '}
                        {combinedDiscountText}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ) : null}
              {shownTotals ? (
                <tr data-testid="order-edit-diff-total">
                  <td>Order total</td>
                  <td className="mono-text">
                    <del>{formatAmount(shownTotals.channelTotal, shownTotals.currency)}</del>
                  </td>
                  <td className="mono-text">
                    <ins>{formatAmount(shownTotals.total, shownTotals.currency)}</ins>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {discountDeferred ? (
        <Alert
          tone="info"
          title="The discount is reviewed separately"
          data-testid="order-edit-discount-deferred"
        >
          Save the quantity change first, then apply the discount. The discount stays filled in, so
          you can review it right after.
        </Alert>
      ) : null}

      <div className="dialog-section">
        <p className="dialog-section__head">Where this change is used</p>
        <ul className="order-cancel-impact" data-testid="order-edit-impact">
          <li className="order-cancel-impact__row">
            <span className="order-cancel-impact__head">
              <span className="order-cancel-impact__what">Shipping label, invoice and pack bench</span>
              <StatusBadge tone="success" compact>
                Use the change
              </StatusBadge>
            </span>
            <span className="order-cancel-impact__how">
              They read the edited order from now on. A label or invoice that already exists keeps
              what it was issued with.
            </span>
          </li>
          <li className="order-cancel-impact__row">
            <span className="order-cancel-impact__head">
              <span className="order-cancel-impact__what">{channelName ?? 'Sales channel'}</span>
              <StatusBadge tone="neutral" compact>
                Not sent
              </StatusBadge>
            </span>
            <span className="order-cancel-impact__how">
              {`${channel} keeps the order as the buyer placed it. Nothing is sent back.`}
            </span>
          </li>
        </ul>
      </div>

      {discountOutput ? <DiscountMoney result={discountOutput} channel={channel} /> : null}
    </div>
  );
}

function DiscountMoney({
  result,
  channel,
}: {
  result: OrderDiscountResult;
  channel: string;
}): ReactElement {
  const branch = DISCOUNT_BRANCH_LABELS[result.paymentBranch];

  if (result.paymentBranch === 'paid') {
    const refund = result.refundIntent;
    const verdict = refund ? describeCeilingVerdict(refund.ceiling) : null;
    return (
      <Alert
        tone="warning"
        title={
          refund
            ? `Refund ${formatDecimalAmount(refund.amount, refund.currency)} on ${channel}`
            : 'Nothing to refund'
        }
        data-testid="order-edit-money"
      >
        <p>{`${branch}. OpenLinker doesn’t move money. After you refund on ${channel}, confirm the refund on this order so the documents and what the buyer paid agree.`}</p>
        {verdict ? (
          <p data-testid="order-edit-ceiling">
            <StatusBadge tone={verdict.tone} compact>
              {verdict.tone === 'warning' ? 'Check' : 'Within the limit'}
            </StatusBadge>{' '}
            {verdict.text}
          </p>
        ) : null}
        <p data-testid="order-edit-correction">
          {result.correctionProposal
            ? `A correction for ${result.correctionProposal.documentNumber ?? 'the issued invoice'} will be drafted for you to review. Nothing is issued until you confirm it.`
            : result.correctionUnavailableReason
              ? DISCOUNT_CORRECTION_UNAVAILABLE_COPY[result.correctionUnavailableReason]
              : 'No document has been issued, so there is nothing to correct. The invoice will be issued from the discounted order.'}
        </p>
      </Alert>
    );
  }

  if (result.paymentBranch === 'cod' || result.paymentBranch === 'unpaid') {
    return (
      <Alert tone="info" title="Amount to collect" data-testid="order-edit-money">
        <p>
          {result.amountToCollect
            ? `${branch}. The buyer now pays ${formatDecimalAmount(result.amountToCollect.amount, result.amountToCollect.currency)}.`
            : `${branch}.`}
        </p>
        <p data-testid="order-edit-correction">
          {result.correctionProposal
            ? `A correction for ${result.correctionProposal.documentNumber ?? 'the issued invoice'} will be drafted for you to review.`
            : result.correctionUnavailableReason
              ? DISCOUNT_CORRECTION_UNAVAILABLE_COPY[result.correctionUnavailableReason]
              : 'The invoice will be issued from the discounted order.'}
        </p>
      </Alert>
    );
  }

  return (
    <Alert tone="warning" title="OpenLinker can’t tell if this order is paid" data-testid="order-edit-money">
      The discount lowers the order total. Check on {channel} whether the buyer paid, then refund the
      difference there if they did.
    </Alert>
  );
}
