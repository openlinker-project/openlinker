/**
 * Sourcing-rules test panel (#2954)
 *
 * "Where would this order go?" without committing anything. It calls the
 * dry-run endpoint, which runs the router's non-committing evaluation - the same
 * engine as real routing - and renders what comes back.
 *
 * ## The router's words are rendered verbatim
 *
 * An unfulfillable line's `reason` and each explanation step's `displayLabel`
 * are shown exactly as received. This component owns no reason or rule
 * vocabulary, so a new filter or reason needs no change here.
 *
 * ## A draft is an INPUT, not something this panel invents
 *
 * `draftRules` arrives from the caller. When it is supplied the panel can compare
 * it with the saved rules; when it is not, the compare control is simply absent.
 * Nothing on the rules page produces an unsaved ruleset today (every edit saves
 * at once), so the page does not pass one yet.
 *
 * ## A result never outlives its input
 *
 * Changing the order, the basket or the compare toggle clears the shown result:
 * "Every line can be sourced" under a different order would be a false claim.
 *
 * ## States
 *
 * `empty` (nothing chosen), `picking` (an order search is showing results),
 * `routable`, `unfulfillable`, `compare` and `error`. Each carries a
 * `data-testid="routing-test-state-<state>"` so a test can name the one on show.
 *
 * @module apps/web/src/features/oms/components
 */
import { useEffect, useState, type ReactElement } from 'react';

import { useOrdersQuery } from '../../orders';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type {
  DraftRule,
  RoutingDryRunRequest,
  RoutingDryRunResult,
  RoutingEvaluation,
} from '../api/routing-dry-run.types';
import { useRoutingDryRunMutation } from '../hooks/use-routing-dry-run-mutation';
import { ROUTING_DRY_RUN_COPY as COPY } from '../lib/routing-dry-run.copy';
import type { SourcingRuleLocationOption } from './sourcing-rule-dialog';

export interface SourcingRulesTestPanelProps {
  connectionId: string;
  locations: readonly SourcingRuleLocationOption[];
  /** An unsaved ruleset to compare against the saved one. Absent = no compare control. */
  draftRules?: readonly DraftRule[];
}

type Mode = 'order' | 'basket';

interface BasketLineState {
  productVariantId: string;
  quantity: string;
}

const EMPTY_LINE: BasketLineState = { productVariantId: '', quantity: '1' };

function describePlacement(
  evaluation: RoutingEvaluation,
  orderLineId: string,
  locationName: (id: string | null) => string
): string[] {
  const assigned = evaluation.candidates
    .filter((candidate) => candidate.orderLineId === orderLineId)
    .map((candidate) => `${locationName(candidate.locationId)} × ${candidate.quantity}`);
  return assigned;
}

export function SourcingRulesTestPanel({
  connectionId,
  locations,
  draftRules,
}: SourcingRulesTestPanelProps): ReactElement {
  const [mode, setMode] = useState<Mode>('order');
  const [search, setSearch] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [lines, setLines] = useState<BasketLineState[]>([{ ...EMPTY_LINE }]);
  const [country, setCountry] = useState('PL');
  const [postcode, setPostcode] = useState('');
  const [delivery, setDelivery] = useState('');
  const [compare, setCompare] = useState(false);
  const mutation = useRoutingDryRunMutation();

  // A result describes the input it was run for. Once the operator changes the
  // order, the basket or the compare toggle it would be an answer about
  // something else, so it is cleared rather than left standing under new input.
  const { reset: resetResult } = mutation;
  useEffect(() => {
    resetResult();
  }, [mode, orderId, lines, country, postcode, delivery, compare, resetResult]);

  const trimmedSearch = search.trim();
  const ordersQuery = useOrdersQuery(
    trimmedSearch.length >= 2 ? { search: trimmedSearch } : undefined,
    { page: 1, limit: 5 },
    { staleTime: 30_000 }
  );
  const picking = mode === 'order' && trimmedSearch.length >= 2;

  const locationName = (id: string | null): string => {
    if (id === null) return COPY.unplaced;
    return locations.find((location) => location.id === id)?.name ?? id;
  };

  const canRun =
    !mutation.isPending &&
    (mode === 'order'
      ? orderId !== null
      : country.trim().length === 2 &&
        lines.every(
          (line) => line.productVariantId.trim() !== '' && Number.parseInt(line.quantity, 10) >= 1
        ));

  const run = (): void => {
    const request: RoutingDryRunRequest =
      mode === 'order'
        ? { orderId: orderId ?? undefined }
        : {
            basket: {
              lines: lines.map((line) => ({
                productVariantId: line.productVariantId.trim(),
                quantity: Number.parseInt(line.quantity, 10),
              })),
              countryIso2: country.trim().toUpperCase(),
              ...(postcode.trim() !== '' && { postalCode: postcode.trim() }),
              ...(delivery.trim() !== '' && { deliveryMethod: delivery.trim() }),
            },
          };
    if (compare && draftRules !== undefined) {
      request.draftRules = draftRules.map((rule) => ({ ...rule }));
    }
    mutation.mutate({ connectionId, request });
  };

  const result = mutation.data;
  const state: string = mutation.isError
    ? 'error'
    : result === undefined
      ? picking
        ? 'picking'
        : 'empty'
      : result.draft !== undefined
        ? 'compare'
        : result.saved.unfulfillable.length > 0
          ? 'unfulfillable'
          : 'routable';

  return (
    <section className="sourcing-test" data-testid="routing-test-panel" aria-label={COPY.title}>
      <h2 className="sourcing-test__title">{COPY.title}</h2>
      <Alert tone="info" title={COPY.banner}>
        {COPY.bannerDetail}
      </Alert>

      <div role="group" aria-label={COPY.title} className="sourcing-test__modes">
        <Button
          tone={mode === 'order' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'order'}
          onClick={() => setMode('order')}
        >
          {COPY.modeOrder}
        </Button>
        <Button
          tone={mode === 'basket' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'basket'}
          onClick={() => setMode('basket')}
        >
          {COPY.modeBasket}
        </Button>
      </div>

      {mode === 'order' ? (
        <div data-testid="routing-test-order-picker">
          <FormField name="routing-test-order" label={COPY.orderSearchLabel} description={COPY.orderSearchHint}>
            <Input
              value={search}
              placeholder={COPY.orderSearchPlaceholder}
              onChange={(event) => {
                setSearch(event.target.value);
                setOrderId(null);
              }}
            />
          </FormField>
          {picking && ordersQuery.isError ? <Alert tone="error">{COPY.orderSearchError}</Alert> : null}
          {picking && !ordersQuery.isError && ordersQuery.data?.items.length === 0 ? (
            <p>{COPY.orderSearchEmpty}</p>
          ) : null}
          <ul className="sourcing-test__orders">
            {(picking ? (ordersQuery.data?.items ?? []) : []).map((order) => (
              <li key={order.internalOrderId}>
                <Button
                  tone={order.internalOrderId === orderId ? 'primary' : 'secondary'}
                  aria-pressed={order.internalOrderId === orderId}
                  onClick={() => setOrderId(order.internalOrderId)}
                >
                  {String(order.orderSnapshot['orderNumber'] ?? order.internalOrderId)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div data-testid="routing-test-basket">
          {lines.map((line, index) => (
            <div key={index} className="sourcing-test__basket-row">
              <FormField name={`routing-test-sku-${index}`} label={COPY.basketSku}>
                <Input
                  value={line.productVariantId}
                  onChange={(event) =>
                    setLines(lines.map((l, i) => (i === index ? { ...l, productVariantId: event.target.value } : l)))
                  }
                />
              </FormField>
              <FormField name={`routing-test-qty-${index}`} label={COPY.basketQuantity}>
                <Input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(event) =>
                    setLines(lines.map((l, i) => (i === index ? { ...l, quantity: event.target.value } : l)))
                  }
                />
              </FormField>
              {lines.length > 1 ? (
                <Button tone="secondary" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                  {COPY.basketRemoveLine}
                </Button>
              ) : null}
            </div>
          ))}
          <Button tone="secondary" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>
            {COPY.basketAddLine}
          </Button>
          <FormField name="routing-test-country" label={COPY.basketCountry}>
            <Input value={country} maxLength={2} onChange={(event) => setCountry(event.target.value)} />
          </FormField>
          <FormField name="routing-test-postcode" label={COPY.basketPostcode}>
            <Input value={postcode} onChange={(event) => setPostcode(event.target.value)} />
          </FormField>
          <FormField name="routing-test-delivery" label={COPY.basketDelivery}>
            <Input value={delivery} onChange={(event) => setDelivery(event.target.value)} />
          </FormField>
        </div>
      )}

      {draftRules !== undefined ? (
        <label>
          <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />{' '}
          {COPY.compareToggle}
        </label>
      ) : null}

      <Button disabled={!canRun} onClick={run}>
        {mutation.isPending ? COPY.running : COPY.runTest}
      </Button>

      <div data-testid={`routing-test-state-${state}`}>
        {mutation.isError ? (
          <Alert
            tone="error"
            title={COPY.errorTitle}
            action={
              <Button tone="secondary" onClick={run}>
                {COPY.errorRetry}
              </Button>
            }
          >
            {COPY.errorNothingChanged}
          </Alert>
        ) : result !== undefined ? (
          <DryRunResult result={result} locationName={locationName} />
        ) : null}
      </div>
    </section>
  );
}

function DryRunResult({
  result,
  locationName,
}: {
  result: RoutingDryRunResult;
  locationName: (id: string | null) => string;
}): ReactElement {
  const hasShortfall = result.saved.unfulfillable.length > 0;
  const split = result.input.lines.some(
    (line) => result.saved.candidates.filter((c) => c.orderLineId === line.orderLineId).length > 1
  );

  return (
    <div>
      <StatusBadge tone={hasShortfall ? 'warning' : 'success'}>
        {hasShortfall ? COPY.resultUnfulfillable : COPY.resultRoutable}
      </StatusBadge>
      {!hasShortfall && split ? <p>{COPY.resultRoutableSplit}</p> : null}
      {hasShortfall ? <p>{COPY.resultUnfulfillableNote}</p> : null}

      <h3>{COPY.resultInputHeading}</h3>
      <p>{COPY.resultInputNote}</p>
      <p>
        {result.input.shipTo.countryIso2}
        {result.input.shipTo.postalCode ? ` ${result.input.shipTo.postalCode}` : ''}
        {result.input.requestedDeliveryMethod ? ` · ${result.input.requestedDeliveryMethod}` : ''}
      </p>

      <h3>{COPY.resultLinesHeading}</h3>
      <ul data-testid="routing-test-lines">
        {result.input.lines.map((line) => {
          const placement = describePlacement(result.saved, line.orderLineId, locationName);
          const short = result.saved.unfulfillable.filter((u) => u.orderLineId === line.orderLineId);
          return (
            <li key={line.orderLineId}>
              <strong>{line.productVariantId}</strong> × {line.quantity}: {placement.join(', ')}
              {short.map((u) => (
                <span key={`${u.orderLineId}-${u.resolution}`} data-testid="routing-test-unfulfillable">
                  {' '}
                  {u.quantity} × {u.resolution} - {u.reason}
                </span>
              ))}
            </li>
          );
        })}
      </ul>

      <h3>{COPY.explanationHeading}</h3>
      {result.saved.explanation.length === 0 ? (
        <p>{COPY.explanationEmpty}</p>
      ) : (
        <ol data-testid="routing-test-explanation">
          {result.saved.explanation.map((step, index) => (
            <li key={`${step.rule.ruleId}-${index}`}>
              {step.rule.displayLabel}
              {step.eliminated.length > 0 ? ` (${COPY.explanationRemoved(step.eliminated.length)})` : ''}
              {step.detail ? ` - ${step.detail}` : ''}
            </li>
          ))}
        </ol>
      )}

      {result.draft !== undefined ? (
        <div data-testid="routing-test-compare">
          <h3>{COPY.compareHeading}</h3>
          {(result.changedLines ?? []).length === 0 ? (
            <p>{COPY.compareNoChange}</p>
          ) : (
            <>
              <p>{COPY.compareChanged((result.changedLines ?? []).length)}</p>
              <ul>
                {(result.changedLines ?? []).map((change) => (
                  <li key={change.orderLineId}>
                    {change.orderLineId}: {COPY.compareSaved} {change.saved.join(', ')} → {COPY.compareDraft}{' '}
                    {change.draft.join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
