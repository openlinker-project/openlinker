/**
 * Order Line Match Banner (#3933)
 *
 * When one offer sits on several lines of an order (typically one of them inside
 * an offer-bundle discount), the automatic resolution refuses to guess which
 * line a return belongs to. This banner shows the candidates, says what OpenLinker
 * would suggest and why, and waits: **nothing is applied until the operator
 * presses Confirm**, and the confirmation goes through the same fill-in-when-empty
 * claim as automatic resolution, so it can never overwrite an answer.
 *
 * Rendered only while a line is unresolved AND has at least two candidates; every
 * other state is silence, because the common case needs no banner.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  useConfirmOrderLineMutation,
  useOrderLineSuggestionQuery,
} from '../hooks/use-order-line-suggestion';
import type { ReturnLine } from '../api/returns.types';

interface OrderLineMatchBannerProps {
  returnId: string;
  line: ReturnLine;
  currency: string | null;
  canWrite: boolean;
}

export function OrderLineMatchBanner({
  returnId,
  line,
  currency,
  canWrite,
}: OrderLineMatchBannerProps): ReactElement | null {
  const copy = useMessages('bundle-returns').match;
  const format = useFormat();
  const { showToast } = useToast();
  const unresolved = line.resolvedOrderLineId === null;
  const suggestion = useOrderLineSuggestionQuery(returnId, line.id, unresolved);
  const confirm = useConfirmOrderLineMutation(returnId, line.id);
  const [picked, setPicked] = useState<string | null>(null);

  const data = suggestion.data;
  if (!unresolved || data === undefined || data.alreadyResolvedOrderLineId !== null) {
    return null;
  }
  if (data.candidates.length < 2) {
    return null;
  }

  const chosen = picked ?? data.suggestedOrderLineId ?? '';

  return (
    <Alert tone="warning" title={copy.title}>
      <div data-testid="return-component-match-banner">
        <p>{interpolate(copy.body, { n: data.candidates.length })}</p>
        <p className="text-muted">
          {data.basis === 'price-match'
            ? copy.basisPriceMatch
            : data.basis === 'highest-price'
              ? copy.basisHighestPrice
              : copy.noSuggestion}
        </p>
        <label>
          <span className="form-field__label">{copy.selectLabel}</span>
          <Select
            data-testid="return-component-match-select"
            onChange={(event) => setPicked(event.target.value)}
            value={chosen}
          >
            <option value="" disabled>
              {copy.selectLabel}
            </option>
            {data.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {`${candidate.sku ?? candidate.id}: ${interpolate(copy.option, {
                  price: format.money(candidate.price, currency ?? undefined),
                  qty: candidate.quantity,
                })}`}
              </option>
            ))}
          </Select>
        </label>
        <Button
          data-testid="return-component-match-confirm"
          disabled={!canWrite || chosen === '' || confirm.isPending}
          onClick={() =>
            confirm.mutate(chosen, {
              onSuccess: (result) =>
                showToast({
                  tone: result.claimed ? 'success' : 'warning',
                  description: result.claimed ? copy.confirmed : copy.alreadyResolved,
                }),
              onError: () => showToast({ tone: 'error', description: copy.failed }),
            })
          }
          type="button"
        >
          {copy.confirm}
        </Button>
      </div>
    </Alert>
  );
}
