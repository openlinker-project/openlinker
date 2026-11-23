/**
 * Bundle composition (#3520)
 *
 * What a bundle row is made of when it publishes as ONE offer with several
 * products: each component with its thumbnail, quantity, a gift marker and how
 * it enters the set (its own live offer, a catalogue card, a new product, or not
 * at all). Shared by the Review row's expansion and the edit modal's section, so
 * the two cannot describe the same set differently.
 *
 * A component the destination cannot list says why in its own words, with a link
 * to publish that component on its own; the category the destination requires
 * (that of the first component's card) is offered as a one-click fix when the
 * offer is under a different one.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

import { interpolate, usePlural, useMessages } from '../../../../shared/i18n';
import { StatusBadge, type StatusBadgeTone } from '../../../../shared/ui';
import { ENTRANCE_GROUP, ENTRANCE_ITEM } from '../../../../shared/ui/motion-presets';
import { packSizeOf } from './bundle-kind';
import { VariantThumbnail } from '../../../products';
import type { BundleComponentMode } from '../../api/listings.types';
import type { BundleOfferPreviewOk } from '../../hooks/use-bundle-offer-preview';

const MODE_COPY_KEY = {
  'own-offer': 'ownOffer',
  'catalog-card': 'catalogCard',
  'new-product': 'newProduct',
  missing: 'missing',
} as const satisfies Record<BundleComponentMode, string>;

const MODE_TONE: Record<BundleComponentMode, StatusBadgeTone> = {
  'own-offer': 'success',
  'catalog-card': 'info',
  'new-product': 'review',
  missing: 'error',
};

/** Wizard URL that publishes one component on its own. */
export function publishComponentUrl(productId: string, connectionId: string): string {
  return `/listings/bulk-create/wizard?${new URLSearchParams({ productIds: productId, connectionId }).toString()}`;
}

interface BundleCompositionProps {
  preview: BundleOfferPreviewOk;
  connectionId: string;
  /** Category the offer would be submitted under; null when none is set. */
  chosenCategoryId: string | null;
  /** One-click fix for a category that differs from the first component's card. */
  onUseSuggestedCategory?: () => void;
  /** Heading above the list; omitted where the surrounding section already has one. */
  heading?: string;
  /** Marketplace display name, for the multipack explanation. */
  destinationName?: string;
  /** The "no EAN of its own" note; omitted where the surrounding section says it already. */
  showEanNote?: boolean;
  /** Offer title as typed in the editor; kept for callers, the preview moved to BundleFinalTitle. */
  title?: string;
  /** Whole-offer price as typed (decimal text); enables the per-piece hint for packs. */
  priceAmount?: string;
}

/** Allegro's title ceiling; advisory only here, the row blocker lives in the plugin. */
const ALLEGRO_TITLE_LIMIT = 75;
/**
 * Allegro's documented cap on different products in one set. It comes from help
 * pages rather than the API, so the wizard only advises and never blocks on it.
 */
const ALLEGRO_SET_PRODUCT_ADVISORY_LIMIT = 10;

function parseDecimal(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function BundleComposition({
  preview,
  connectionId,
  chosenCategoryId,
  onUseSuggestedCategory,
  heading,
  destinationName = '',
  showEanNote = false,
  priceAmount,
}: BundleCompositionProps): ReactElement {
  const copy = useMessages('listings').bundleOffer;
  const plural = usePlural();
  const packSize = packSizeOf(preview);
  // The multipack rules below are Allegro's; another marketplace gets only the neutral line.
  const isAllegro = /allegro/i.test(destinationName);
  const limiting = preview.components.find(
    (component) => component.variantId === preview.limitingComponentVariantId,
  );
  const hasMissing = preview.components.some((component) => component.mode === 'missing');
  const mismatch =
    preview.suggestedCategoryId !== null &&
    chosenCategoryId !== null &&
    chosenCategoryId !== preview.suggestedCategoryId;

  // The card names no category and none was chosen: the row blocks on the same
  // sentence, so the panel and the row cannot disagree about what to fix.
  const cardWithoutCategory =
    preview.suggestedCategoryId === null &&
    !chosenCategoryId &&
    preview.components.some(
      (component) => component.mode === 'catalog-card' && !component.cardCategoryId,
    );

  const tooManyProducts =
    isAllegro && packSize === null && preview.components.length > ALLEGRO_SET_PRODUCT_ADVISORY_LIMIT;
  const price = parseDecimal(priceAmount);
  const perPiece = packSize !== null && price !== null ? (price / packSize).toFixed(2) : null;

  return (
    <div className="bundle-comp" data-testid="bundle-composition">
      {heading ? (
        <div className="cx-h">
          <h3>{heading}</h3>
          <span className="pm-hint">
            {packSize !== null
              ? interpolate(copy.packCompositionHint, { n: packSize })
              : plural(preview.components.length, copy.compositionHint)}
          </span>
        </div>
      ) : null}
      <p
        className={`bundle-comp__summary${preview.availableSets === 0 ? ' is-warn' : ''}`}
        data-testid="bundle-sets-summary"
        title={copy.setsSummaryTooltip}
      >
        <b>
          {preview.availableSets === null
            ? copy.setsSummaryUnknown
            : interpolate(copy.setsSummary, { n: preview.availableSets })}
        </b>
        {limiting ? (
          <span>{interpolate(copy.setsSummaryLimit, { name: limiting.name })}</span>
        ) : null}
      </p>
      {packSize !== null ? (
        <div className="bundle-comp__pack" data-testid="bundle-pack-hint">
          <p className="cx-sub">
            {interpolate(copy.packHint, { n: packSize, destination: destinationName })}
          </p>
          {isAllegro ? (
            <details className="bundle-comp__how" data-testid="bundle-pack-how">
              <summary>{copy.packHowOnAllegro}</summary>
              <p className="cx-sub">{interpolate(copy.packHintAllegro, { n: packSize })}</p>
            </details>
          ) : null}
          <p className="cx-sub" data-testid="bundle-price-scope">
            {interpolate(copy.priceWholePack, { n: packSize })}
          </p>
          {isAllegro ? (
            <p
              className="cx-sub bundle-comp__caveat"
              data-testid="bundle-pack-category-chip"
              style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start' }}
            >
              <span aria-hidden="true">&#9432;</span>
              <span>{copy.packCategoryChip}</span>
            </p>
          ) : null}
          {perPiece ? (
            <p className="cx-sub" data-testid="bundle-per-piece-price">
              {interpolate(copy.perPiecePrice, { price: perPiece })}
            </p>
          ) : null}
          {preview.components[0] ? (
            <p className="cx-sub bundle-comp__buyer" data-testid="bundle-pack-buyer">
              <b>
                {interpolate(copy.packBuyerPreview, {
                  name: preview.components[0].name,
                  n: packSize,
                })}
              </b>
            </p>
          ) : null}
        </div>
      ) : null}
      {packSize === null ? (
        <div className="bundle-comp__pack">
          <p className="cx-sub" data-testid="bundle-price-scope">
            {plural(preview.components.length, copy.priceWholeSet)}
          </p>
          {isAllegro && preview.components.length > 1 && preview.components[0] ? (
            <p className="cx-sub" data-testid="bundle-first-product-note">
              {interpolate(copy.firstProductNote, { name: preview.components[0].name })}
            </p>
          ) : null}
          {isAllegro && preview.components.length > 1 ? (
            <p className="cx-sub" data-testid="bundle-main-product-hint">
              {copy.mainProductHint}
            </p>
          ) : null}
          {tooManyProducts ? (
            <span className="cx-tag bundle-comp__advisory" data-testid="bundle-too-many-products">
              {interpolate(copy.tooManyProductsAdvisory, { n: preview.components.length })}
            </span>
          ) : null}
          {isAllegro && preview.components.length > 1 ? (
            <span className="cx-tag cx-tag--quiet" data-testid="bundle-gallery-advisory">
              {copy.galleryAdvisory}
            </span>
          ) : null}
        </div>
      ) : null}
      <motion.ul
        className="cx-comp cx-wcomp bundle-comp__list"
        variants={ENTRANCE_GROUP}
        initial="hidden"
        animate="show"
      >
        {preview.components.map((component) => {
          const modeLabel =
            component.mode === 'own-offer' && component.externalOfferId
              ? interpolate(copy.modes.ownOfferWithId, { id: component.externalOfferId })
              : copy.modes[MODE_COPY_KEY[component.mode]];
          const modeHint = copy.modeHints[MODE_COPY_KEY[component.mode]];
          const isLimit = preview.limitingComponentVariantId === component.variantId;
          return (
            <motion.li
              variants={ENTRANCE_ITEM}
              key={component.variantId}
              className={`bundle-comp__item${component.mode === 'missing' ? ' is-bad' : ''}`}
              data-component={component.variantId}
            >
              <VariantThumbnail src={component.imageUrl} name={component.name} size="sm" />
              <span className="cx-comp__n">
                <span className="cx-comp__t">
                  <b className="bundle-comp__name" title={component.name}>
                    {component.name}
                  </b>
                  <span className="mono tabular cx-comp__x">
                    {interpolate(copy.quantity, { n: component.quantity })}
                  </span>
                  {component.giftSlot ? (
                    <span className="cx-tag cx-tag--gift">{copy.gift}</span>
                  ) : null}
                </span>
                <span className="cx-sub mono bundle-comp__meta">{component.sku ?? ''}</span>
                {component.availableUnits !== undefined && component.availableUnits !== null ? (
                  <span
                    className={`cx-sub tabular bundle-comp__stock${isLimit ? ' is-limit' : ''}`}
                    data-testid="bundle-component-stock"
                  >
                    {interpolate(copy.stockLine, {
                      units: component.availableUnits,
                      sets: Math.floor(component.availableUnits / Math.max(1, component.quantity)),
                    })}
                    {isLimit ? ` · ${copy.limitsSet}` : ''}
                  </span>
                ) : null}
                {component.problems.map((problem) => (
                  <span key={problem.code} className="bundle-comp__problem">
                    {problem.message}
                  </span>
                ))}
              </span>
              <span className="cx-wm">
                <span className="bundle-comp__mode" title={modeHint} tabIndex={0}>
                  <StatusBadge
                    tone={MODE_TONE[component.mode]}
                    compact
                    withDot
                    data-testid="bundle-mode"
                  >
                    {modeLabel}
                  </StatusBadge>
                  <span className="sr-only">{modeHint}</span>
                </span>
                {component.mode === 'missing' ? (
                  <Link
                    className="button button--secondary button--sm"
                    to={publishComponentUrl(component.productId, connectionId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {copy.publishComponent}
                  </Link>
                ) : null}
              </span>
            </motion.li>
          );
        })}
      </motion.ul>
      {hasMissing ? (
        <p className="cx-sub bundle-comp__refresh" data-testid="bundle-missing-hint">
          {copy.missingHint}
        </p>
      ) : null}
      {showEanNote ? (
        <p className="cx-sub bundle-comp__ean">
          {packSize !== null ? copy.eanNotNeededPack : copy.eanNotNeeded}
        </p>
      ) : null}
      {cardWithoutCategory ? (
        <p className="cx-sub bundle-comp__category" data-testid="bundle-card-no-category">
          {copy.cardNoCategory}
        </p>
      ) : null}
      {mismatch && onUseSuggestedCategory ? (
        <div className="bundle-comp__category" data-testid="bundle-category-mismatch">
          <span>{copy.categoryMismatch}</span>
          <button type="button" className="bundle-comp__link" onClick={onUseSuggestedCategory}>
            {copy.useFirstComponentCategory}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface BundleFinalTitleProps {
  preview: BundleOfferPreviewOk;
  title: string;
  limit?: number;
}

/**
 * The title a multipack buyer actually sees (the marketplace appends the pack
 * label), shown directly under the Title input and red above the limit - the
 * counter on the input itself measures only what the operator typed.
 */
export function BundleFinalTitle({
  preview,
  title,
  limit = ALLEGRO_TITLE_LIMIT,
}: BundleFinalTitleProps): ReactElement | null {
  const copy = useMessages('listings').bundleOffer;
  const packSize = packSizeOf(preview);
  if (packSize === null || title.trim() === '') return null;
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  // A title that already states the quantity ("... x4", "4 szt.") must not get
  // the pack label appended a second time: it would state it twice and cost
  // ~16 of the 75 characters.
  const alreadyStatesQuantity = /(^|[\s(])[x×]\s?\d+\b|\b\d+\s?(szt|sztuk)\b/i.test(cleanTitle);
  const finalTitle = alreadyStatesQuantity
    ? cleanTitle
    : interpolate(copy.packFinalTitle, { title: cleanTitle, n: packSize });
  return (
    <p
      className={`cx-sub bundle-comp__title${finalTitle.length > limit ? ' is-warn' : ''}`}
      data-testid="bundle-pack-final-title"
    >
      <b>{finalTitle}</b>{' '}
      <span className="tabular">
        {interpolate(copy.titleCounter, { n: finalTitle.length, max: limit })}
      </span>
    </p>
  );
}
