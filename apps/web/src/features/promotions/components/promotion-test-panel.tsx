/**
 * PromotionTestPanel (#3935, mockups "Test na zamówieniu")
 *
 * "Test on an order": the operator names an order, optionally a customer, and
 * sees what would happen to it: whether this promotion adds its gift, what the
 * customer limit says for that customer, and why the others would not. Nothing
 * is written. The unsaved form is tested as it stands, so a promotion can be
 * checked before it is turned on.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useId, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { CustomerProjection } from '../../customers';
import type {
  PromotionDryRunResult,
  PromotionDryRunVerdict,
  PromotionWriteInput,
} from '../api/promotions.types';
import { useEvaluatePromotionsMutation } from '../hooks/use-promotions';

export interface PromotionTestPanelProps {
  /** The promotion being edited, when it is saved. */
  promotionId: string | null;
  /** The form as a write body, or `null` while it is not complete enough to test. */
  draft: PromotionWriteInput | null;
  /** False while the form is incomplete: the check is answered with the hint, not sent. */
  ready: boolean;
}

const REASON_KEYS = {
  'paused-unit-cap': 'limit',
  'unit-cap-reached': 'limit',
  'below-per-unit-threshold': 'belowThreshold',
  'gift-already-in-order': 'alreadyInOrder',
  'customer-limit-reached': 'customerLimit',
  'customer-unknown': 'customerUnknown',
  'gift-out-of-stock': 'outOfStock',
  'gift-stock-unknown': 'stockUnknown',
  'superseded-by-earlier-rule': 'superseded',
  'rule-not-matching': 'notMatching',
} as const;

function customerLabel(customer: CustomerProjection): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  return name !== '' ? name : (customer.normalizedEmail ?? customer.internalCustomerId);
}

interface Row {
  key: string;
  title: ReactElement | string;
  sub: ReactElement | string;
  tone: StatusBadgeTone;
  badge: string;
}

export function PromotionTestPanel({ promotionId, draft, ready }: PromotionTestPanelProps): ReactElement {
  const copy = useMessages('promotions').test;
  const apiClient = useApiClient();
  const listId = useId();
  const [orderId, setOrderId] = useState('');
  const [customerText, setCustomerText] = useState('');
  const [customer, setCustomer] = useState<CustomerProjection | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<PromotionDryRunResult | null>(null);
  const evaluate = useEvaluatePromotionsMutation();
  const search = useDebouncedValue(customerText.trim(), 250);

  const found = useQuery({
    queryKey: ['promotions', 'customer-search', search],
    queryFn: () => apiClient.customers.listRows({ search }, { limit: 6, offset: 0 }),
    enabled: customer === null && search.length >= 2,
  });

  const run = (): void => {
    if (!ready) {
      setShown(null);
      return;
    }
    evaluate.mutate(
      {
        orderId: orderId.trim(),
        ...(customer !== null && { customerId: customer.internalCustomerId }),
        ...(draft !== null ? { promotion: draft } : promotionId !== null ? { promotionId } : {}),
      },
      { onSuccess: setShown },
    );
  };

  const rows = (): Row[] => {
    if (!ready) {
      return [{ key: 'not-ready', title: copy.thisPromotion, sub: copy.notReady, tone: 'neutral', badge: copy.notReadyBadge }];
    }
    if (shown === null) return [];
    const verdicts = shown.verdicts.filter((v) => !(draft !== null && promotionId !== null && v.promotionId === promotionId));
    const subject = verdicts.find((v) => v.isSubject);
    const out: Row[] = [];
    const reasonOf = (v: PromotionDryRunVerdict): string => {
      const key = v.reason === null ? undefined : REASON_KEYS[v.reason as keyof typeof REASON_KEYS];
      return key === undefined ? (v.reason ?? '') : copy.reasons[key];
    };
    const verdictRow = (v: PromotionDryRunVerdict, title: string): Row => ({
      key: v.promotionId,
      title,
      sub: v.wouldApply ? copy.conditionsMet : reasonOf(v),
      tone: v.wouldApply ? 'success' : 'neutral',
      badge: v.wouldApply ? interpolate(copy.wouldAdd, { count: String(v.quantity) }) : copy.skipped,
    });
    if (subject !== undefined) {
      out.push(verdictRow(subject, copy.thisPromotion));
      const limit = subject.customerLimit;
      if (limit !== null) {
        if (limit.usedByCustomer === null) {
          out.push({
            key: 'limit',
            title: copy.customerLimit.title,
            sub: customer === null ? copy.customerLimit.notChecked : copy.customerLimit.unknown,
            tone: 'neutral',
            badge: copy.customerLimit.notCheckedBadge,
          });
        } else {
          out.push({
            key: 'limit',
            title: copy.customerLimit.title,
            sub: (
              <>
                {customer !== null ? <b>{customerLabel(customer)}</b> : null}
                {customer !== null ? ': ' : ''}
                {interpolate(copy.customerLimit.used, {
                  used: String(limit.usedByCustomer),
                  limit: String(limit.limit),
                  will: limit.wouldExceed ? copy.customerLimit.willNot : copy.customerLimit.willAdd,
                })}
              </>
            ),
            tone: limit.wouldExceed ? 'warning' : 'success',
            badge: limit.wouldExceed ? copy.customerLimit.over : copy.customerLimit.within,
          });
        }
      }
    }
    for (const v of verdicts) if (!v.isSubject) out.push(verdictRow(v, v.promotionName));
    return out;
  };
  const list = rows();

  return (
    <div className="pm-dry" data-testid="promotion-test">
      <p className="form-field__description">{copy.help}</p>
      <div className="form-field">
        <label className="form-field__label" htmlFor={`${listId}-order`}>
          {copy.order}
        </label>
        <Input
          id={`${listId}-order`}
          className="mono"
          placeholder={copy.orderPlaceholder}
          value={orderId}
          onChange={(event) => {
            setOrderId(event.target.value);
          }}
          data-testid="promotion-test-order"
        />
      </div>
      <div className="form-field pm-combo">
        <label className="form-field__label" htmlFor={`${listId}-customer`}>
          {copy.customer}
        </label>
        <span className="pm-combo__box">
          <Input
            id={`${listId}-customer`}
            className="pm-cust"
            placeholder={copy.customerPlaceholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            value={customerText}
            onFocus={() => {
              setOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setOpen(false);
              }, 120);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
              }
            }}
            onChange={(event) => {
              setCustomer(null);
              setCustomerText(event.target.value);
              setOpen(true);
            }}
            data-testid="promotion-test-customer"
          />
          <div id={listId} className={['dropdown-menu__content', 'pm-combo__list', open && customer === null && search.length >= 2 ? 'is-open' : ''].filter(Boolean).join(' ')} role="listbox">
            {found.isFetching ? <span className="pm-combo__opt text-muted">{copy.customerSearching}</span> : null}
            {!found.isFetching && (found.data?.items.length ?? 0) === 0 ? (
              <span className="pm-combo__opt text-muted">{copy.customerNone}</span>
            ) : null}
            {(found.data?.items ?? []).map((item) => (
              <button
                key={item.internalCustomerId}
                type="button"
                role="option"
                aria-selected={false}
                className="pm-combo__opt"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  setCustomer(item);
                  setCustomerText(`${customerLabel(item)}${item.normalizedEmail ? ` (${item.normalizedEmail})` : ''}`);
                  setOpen(false);
                }}
              >
                <b>{customerLabel(item)}</b>
                <span className="text-muted">{item.normalizedEmail ?? item.internalCustomerId}</span>
              </button>
            ))}
          </div>
        </span>
        <p className="form-field__description">{copy.customerHelp}</p>
      </div>
      <div>
        <Button
          tone="secondary"
          className="button--sm pm-dry-run"
          disabled={evaluate.isPending || (ready && orderId.trim() === '')}
          onClick={run}
          data-testid="promotion-test-run"
        >
          {evaluate.isPending ? copy.running : copy.run}
        </Button>
      </div>
      {evaluate.isError ? (
        <Alert tone="error" density="compact" data-testid="promotion-test-error">
          {evaluate.error.isNotFound() ? copy.orderNotFound : copy.failed}
        </Alert>
      ) : null}
      {list.length > 0 ? (
        <ul className="pm-test-res pm-dry-res" data-testid="promotion-test-result">
          {list.map((row) => (
            <li key={row.key}>
              <span>
                <b>{row.title}</b>
                <span className="text-muted">{row.sub}</span>
              </span>
              <StatusBadge tone={row.tone} withDot compact>
                {row.badge}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
