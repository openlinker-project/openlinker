/**
 * Bundle Return Picker (#3933)
 *
 * Shown inside the dispose form while a bundle line is being restocked: which
 * components actually came back. Ticking all of them is the whole bundle;
 * ticking some restocks only those, and the price share each carries is
 * computed NOW from standalone prices by the server.
 *
 * **It refuses by stating the reason, not by hiding the choice.** When the set
 * price cannot be split (a component with neither a price nor a cost) the picker
 * says which component and blocks only the PARTIAL return; returning the whole
 * bundle needs no split and stays possible.
 *
 * Reports its state to the form through two callbacks rather than owning the
 * submit, so the form stays the one place a disposition is assembled.
 *
 * @module apps/web/src/features/returns/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useBundleReturnPreviewQuery } from '../hooks/use-bundle-return-preview-query';

interface BundleReturnPickerProps {
  returnId: string;
  lineId: string;
  /** Bundle units being disposed; the shown shares scale by it. */
  quantity: number;
  currency: string | null;
  /** `undefined` means the whole set; otherwise the component variants that came back. */
  onSelectionChange: (returnedVariantIds: string[] | undefined) => void;
  /** True while the chosen selection cannot be submitted. */
  onBlockedChange: (blocked: boolean) => void;
}

export function BundleReturnPicker({
  returnId,
  lineId,
  quantity,
  currency,
  onSelectionChange,
  onBlockedChange,
}: BundleReturnPickerProps): ReactElement | null {
  const copy = useMessages('bundle-returns').picker;
  const format = useFormat();
  const [selected, setSelected] = useState<string[] | null>(null);

  const safeQuantity = Number.isInteger(quantity) && quantity >= 1 ? quantity : 1;
  const preview = useBundleReturnPreviewQuery(returnId, lineId, {
    ...(selected === null ? {} : { returnedVariantIds: selected }),
    quantity: safeQuantity,
  });

  const allIds = useMemo(
    () => preview.data?.components.map((component) => component.variantId) ?? [],
    [preview.data]
  );
  const effective = selected ?? allIds;
  const isWhole = allIds.length > 0 && effective.length === allIds.length;
  const noneSelected = allIds.length > 0 && effective.length === 0;
  const refusal = !isWhole && !noneSelected ? (preview.data?.splitRefusal ?? null) : null;
  const isBundle = preview.data?.isBundle === true;
  // Until the preview answers we cannot tell a bundle from a plain product, and
  // a missing preview must never turn into a whole-set restock: block while it
  // is pending (or showing the previous selection's answer) and when it failed.
  const unanswered = preview.isPending || preview.isPlaceholderData || preview.isError;
  const blocked = unanswered || noneSelected || refusal !== null;

  useEffect(() => {
    onSelectionChange(isBundle && !isWhole ? effective : undefined);
    onBlockedChange(unanswered || (isBundle && blocked));
    // `effective` is derived from `selected` and `allIds`; both are listed through it.
  }, [isBundle, isWhole, blocked, unanswered, effective, onSelectionChange, onBlockedChange]);

  if (preview.isError) {
    return (
      <Alert tone="error" data-testid="return-component-preview-error">
        {copy.previewFailed}
      </Alert>
    );
  }
  if (!isBundle || preview.data === undefined) {
    return null;
  }
  const data = preview.data;

  const toggle = (variantId: string): void => {
    const base = selected ?? allIds;
    setSelected(
      base.includes(variantId) ? base.filter((id) => id !== variantId) : [...base, variantId]
    );
  };

  return (
    <div className="bundle-return-picker" data-testid="return-component-picker">
      <span className="form-field__label">{copy.title}</span>
      <p className="text-muted">{isWhole ? copy.wholeHint : copy.partialHint}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {data.components.map((component) => {
          const checked = effective.includes(component.variantId);
          const name = component.sku ?? component.variantId;
          return (
            <li key={component.variantId} data-testid={`return-component-line-${name}`}>
              <label>
                <input
                  checked={checked}
                  onChange={() => toggle(component.variantId)}
                  type="checkbox"
                />{' '}
                {interpolate(copy.componentLine, { name, n: component.perUnit * safeQuantity })}
              </label>{' '}
              <span className="text-muted" data-testid={`return-component-state-${name}`}>
                {checked ? copy.backInWarehouse : copy.staysWithCustomer}
              </span>
              {!isWhole && checked && component.shareGross !== null ? (
                <span className="text-muted tabular">
                  {' '}
                  {interpolate(copy.share, {
                    amount: format.money(component.shareGross * safeQuantity, currency ?? undefined),
                  })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!isWhole ? (
        <Button onClick={() => setSelected(null)} tone="secondary" type="button">
          {copy.whole}
        </Button>
      ) : null}
      {noneSelected ? <Alert tone="warning">{copy.noneSelected}</Alert> : null}
      {refusal !== null ? (
        <Alert tone="warning" title={copy.noSplitTitle}>
          <span data-testid="return-component-no-split-note">
            {refusal === 'bad-total'
              ? copy.noSplitTotal
              : interpolate(copy.noSplitSkus, {
                  skus: data.components
                    .filter((component) => data.splitRefusalVariantIds.includes(component.variantId))
                    .map((component) => component.sku ?? component.variantId)
                    .join(', '),
                })}
          </span>
        </Alert>
      ) : null}
    </div>
  );
}
