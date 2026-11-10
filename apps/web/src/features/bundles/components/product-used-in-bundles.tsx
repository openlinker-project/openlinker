/**
 * "Used in bundles" (#3624): which bundles hold a product as a component and
 * whether as a gift, so an operator knows changing its stock changes theirs.
 * Renders nothing when the product is in no bundle - there is no "none"
 * reassurance, because a failed read looks identical to an empty one.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { useApiClient } from '../../../app/api/api-client-provider';
import { bundlesQueryKeys } from '../api/bundles.query-keys';
import type { BundleDetail } from '../api/bundles.types';
import { useBundleUsedInManyQuery } from '../hooks/use-bundle-queries';

interface BundleLimit {
  /** Whole sets the bundle can be assembled from, `null` when a component is unknown. */
  available: number | null;
  /** Variant of the component that limits the set, `null` when none does or it is unknown. */
  limitingVariantId: string | null;
  limitingName: string | null;
}

function readLimit(detail: BundleDetail | undefined): BundleLimit | null {
  if (!detail || detail.componentAvailability.length === 0) return null;
  let best: { sets: number; variantId: string; name: string } | null = null;
  for (const row of detail.componentAvailability) {
    if (row.availableToPromise === null)
      return { available: null, limitingVariantId: null, limitingName: null };
    const sets = Math.floor(row.availableToPromise / row.quantity);
    if (best === null || sets < best.sets) {
      best = {
        sets,
        variantId: row.variantId,
        name: row.summary.name ?? row.summary.sku ?? row.variantId,
      };
    }
  }
  if (best === null) return null;
  return detail.componentAvailability.length > 1
    ? { available: best.sets, limitingVariantId: best.variantId, limitingName: best.name }
    : { available: best.sets, limitingVariantId: null, limitingName: null };
}

export function ProductUsedInBundles({
  variantIds,
  card = false,
  action,
  title,
}: {
  /** Card mode: a button shown inside the limit note (make a bundle of this). */
  action?: ReactNode;
  /** Card mode: overrides the card title. */
  title?: string;
  variantIds: readonly string[];
  /** Render as a page card ("Bundles", mockup) instead of a peek section. */
  card?: boolean;
}): ReactElement | null {
  const copy = useMessages('bundles');
  const format = useFormat();
  const apiClient = useApiClient();
  const result = useBundleUsedInManyQuery(variantIds);
  const entries = result.data ?? [];
  // Card mode only: each bundle's own availability says whether THIS product is
  // what limits it, which is the question an operator opens the card to answer.
  const bundleIds = card ? [...new Set(entries.map((entry) => entry.bundleVariantId))] : [];
  const details = useQueries({
    queries: bundleIds.map((id) => ({
      queryKey: bundlesQueryKeys.detail(id),
      queryFn: (): Promise<BundleDetail> => apiClient.bundles.get(id),
      retry: false,
      staleTime: 30_000,
    })),
  });
  const limitByBundle = new Map<string, BundleLimit | null>(
    bundleIds.map((id, index) => [id, readLimit(details[index]?.data)])
  );
  if (entries.length === 0) {
    return null;
  }
  const list = (
    <ul className="cx-comp cx-comp--compact" data-testid="bundle-list-used-in">
      {entries.map((entry) => (
        <li
          key={`${entry.bundleVariantId}:${entry.componentVariantId ?? ''}`}
          data-testid={`bundle-list-used-in-${entry.bundle.sku ?? entry.bundleVariantId}`}
        >
          <span className="cx-mosaic" aria-hidden="true">
            <i className="t-a" />
            <i className="t-d" />
            <i className="t-b" />
            <i className="t-c" />
          </span>
          <span className="cx-comp__n">
            <Link to={`/products/bundles/${entry.bundleVariantId}`}>
              {entry.bundle.name ?? entry.bundle.sku ?? entry.bundleVariantId}
            </Link>
            <span className="cx-sub">
              <span className="mono">{entry.bundle.sku ?? ''}</span>
              {entry.bundle.price !== null
                ? ` · ${format.money(entry.bundle.price, entry.bundle.currency ?? undefined)}`
                : ''}
            </span>
          </span>
          <span className="cx-comp__q">
            <span className="mono tabular">×{entry.quantity}</span>
            {entry.giftSlot === true ? (
              <span className="cx-tag cx-tag--gift">{copy.view.gift}</span>
            ) : null}
            {card ? (
              <span className="cx-comp__s">
                {limitByBundle.get(entry.bundleVariantId)
                  ? interpolate(copy.view.bundleAvailable, {
                      n: limitByBundle.get(entry.bundleVariantId)?.available ?? '?',
                    })
                  : null}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
  if (card) {
    const limiting = bundleIds.flatMap((id) => {
      const limit = limitByBundle.get(id);
      const bundle = entries.find((e) => e.bundleVariantId === id)?.bundle;
      return limit?.limitingVariantId && limit.limitingName
        ? [{ id, bundleName: bundle?.name ?? bundle?.sku ?? id, ...limit }]
        : [];
    });
    const ours = new Set(variantIds);
    const limitedByUs = limiting.filter(
      (l) => l.limitingVariantId && ours.has(l.limitingVariantId)
    );
    const others = limiting.filter((l) => !limitedByUs.includes(l));
    const loaded = details.every((d) => d.isSuccess);
    let note: ReactNode = null;
    if (loaded && bundleIds.length > 0) {
      const lead = limitedByUs.length === 0 ? copy.view.limitsNothing : copy.view.limitsSome;
      const parts = (limitedByUs.length === 0 ? others : limitedByUs).map((l) =>
        limitedByUs.length === 0 ? (
          <span key={l.id}>
            {interpolate(copy.view.limitsIn, { bundle: l.bundleName })} <b>{l.limitingName}</b>
          </span>
        ) : (
          <b key={l.id}>{l.bundleName}</b>
        )
      );
      note = (
        <>
          {lead}
          {parts.length > 0 ? ' ' : null}
          {parts.map((part, index) => (
            <span key={index}>
              {index > 0 ? ', ' : null}
              {part}
            </span>
          ))}
          {parts.length > 0 ? '.' : null}
        </>
      );
    }
    return (
      <ComposerSection
        title={title ?? copy.list.usedInTitle}
        aside={String(entries.length)}
        riseIndex={3}
      >
        <p className="pm-help">{copy.list.usedInIntro}</p>
        {list}
        {note !== null ? (
          <div className="cx-note" data-testid="used-in-limit-note">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16v.5" />
            </svg>
            <p>{note}</p>
            {action ? <span className="cx-note__a">{action}</span> : null}
          </div>
        ) : null}
      </ComposerSection>
    );
  }
  return (
    <section className="peek-section">
      <h3 className="peek-section__title">{copy.list.usedInTitle}</h3>
      <p className="pm-help">{copy.list.usedInIntro}</p>
      {list}
    </section>
  );
}
