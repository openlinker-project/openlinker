/**
 * Composition of one bundle (#3624, restyled #3520): the peek of a bundle row.
 * The big availability card first (how many sets, what limits them), then the
 * components with their stock, then the note about open orders that still ship
 * with an older composition. Loaded only when mounted (a row opened, a page
 * visited), never for the whole list.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { formatPlural, interpolate, useLocale, useMessages } from '../../../shared/i18n';
import { computeBundleAvailability } from '../lib/bundle-availability';
import { useBundleQuery } from '../hooks/use-bundle-queries';
import { BundleComponentList } from './bundle-component-list';

export function BundleComposition({
  variantId,
  testId,
}: {
  variantId: string;
  testId: string;
}): ReactElement {
  const copy = useMessages('bundles');
  const { locale } = useLocale();
  const query = useBundleQuery(variantId);

  if (query.isLoading) {
    return (
      <section aria-label={copy.list.compositionHeading} data-testid={testId}>
        <p className="text-muted">{copy.list.compositionLoading}</p>
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section aria-label={copy.list.compositionHeading} data-testid={testId}>
        <p role="alert">{copy.list.compositionFailed}</p>
      </section>
    );
  }

  const bundle = query.data;
  const availability = computeBundleAvailability(
    bundle.componentAvailability.map((row) => ({
      name: row.summary.name ?? row.summary.sku ?? row.variantId,
      quantity: row.quantity,
      availableToPromise: row.availableToPromise,
    })),
  );
  const tone =
    availability.kind === 'known' ? (availability.bundles === 0 ? 'is-zero' : 'is-warn') : 'is-unk';

  return (
    <section aria-label={copy.list.compositionHeading} data-testid={testId} className="peek-section">
      <div className={`cx-avail ${tone}`} style={{ alignItems: 'flex-end' }}>
        {availability.kind === 'known' ? (
          <>
            <span className="cx-big mono tabular">
              {availability.bundles} <small>{copy.view.bundlesWord}</small>
            </span>
            <span style={{ paddingBottom: 2 }}>
              {availability.limitedBy === null
                ? interpolate(copy.view.canAssembleOk, { n: availability.bundles })
                : interpolate(copy.view.canAssemble, { n: availability.bundles, name: availability.limitedBy })}
            </span>
          </>
        ) : (
          <span>{copy.view.availableLineUnknown}</span>
        )}
      </div>
      <h3 className="peek-section__title">{copy.list.compositionHeading}</h3>
      <BundleComponentList
        compact
        components={bundle.componentAvailability}
        bundlesAvailable={availability.kind === 'known' ? availability.bundles : null}
        testIdPrefix={testId}
      />
      {bundle.openOrdersOnOlderComposition > 0 ? (
        <div className="cx-note">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16v.5" />
          </svg>
          <p>{formatPlural(bundle.openOrdersOnOlderComposition, copy.form.openOrdersNote, locale)}</p>
        </div>
      ) : null}
    </section>
  );
}
