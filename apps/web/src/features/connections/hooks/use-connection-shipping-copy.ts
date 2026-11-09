/**
 * Connection shipping-card wording (#3958)
 *
 * A carrier's page says which delivery methods it ships; an order source's
 * page says how many of its delivery methods get a label from OpenLinker. The
 * route wording itself ("OpenLinker buys the label from InPost") belongs to
 * the mappings feature; this holds only the card text around it.
 *
 * The sentences live in the `connections` namespace of the locale files
 * (ADR-081); this module picks the plural form a count needs and fills the
 * names, so a component never builds a sentence out of English pieces.
 *
 * @module features/connections/hooks
 */
import { useMemo, type ReactNode } from 'react';
import {
  formatPlural,
  interpolate,
  messagesIn,
  renderRich,
  selectPluralForm,
  useActiveLocale,
  useMessages,
  type Messages,
  type ResolvedCopy,
  type SupportedLocale,
} from '../../../shared/i18n';

export type ConnectionShippingMessages = ResolvedCopy<Messages['connections']>['shipping'];

export interface ConnectionShippingCopy {
  readonly shipsForTitle: string;
  readonly shipsForEyebrow: string;
  readonly shipsForIntro: (carrier: string) => string;
  readonly shipsForEmpty: (carrier: string) => string;
  /** Method names that could not be read are counted, never shown as raw ids. */
  readonly shipsForUnnamed: (count: number) => string;
  readonly shipsForNoSources: string;
  readonly rowChange: string;
  readonly rowChoose: string;
  readonly rowLoading: string;
  readonly rowUnavailable: string;
  readonly createdTitle: (carrier: string) => string;
  readonly createdBody: (carrier: string) => string;
  readonly createdAction: string;
  readonly shippingTitle: string;
  readonly shippingEyebrow: string;
  /**
   * The coverage sentence on the source card. The count is the part an
   * operator scans for, so `emphasise` wraps it - inside one translated
   * sentence, because word order around a count differs per language.
   */
  readonly shippingCoverage: (
    labelled: number,
    total: number,
    emphasise: (chunk: string) => ReactNode
  ) => ReactNode;
  readonly shippingRestByShop: (rest: number) => string;
  readonly shippingAllLabelled: string;
  readonly shippingChange: string;
  readonly shippingUnlisted: string;
  readonly shippingNoMethods: string;
  readonly shippingLoading: string;
  readonly backToOmsSetup: string;
}

export function buildConnectionShippingCopy(
  m: ConnectionShippingMessages,
  locale: SupportedLocale
): ConnectionShippingCopy {
  return {
    shipsForTitle: m.shipsForTitle,
    shipsForEyebrow: m.shipsForEyebrow,
    shipsForIntro: (carrier) => interpolate(m.shipsForIntro, { carrier }),
    shipsForEmpty: (carrier) => interpolate(m.shipsForEmpty, { carrier }),
    shipsForUnnamed: (count) => formatPlural(count, m.shipsForUnnamed, locale),
    shipsForNoSources: m.shipsForNoSources,
    rowChange: m.rowChange,
    rowChoose: m.rowChoose,
    rowLoading: m.rowLoading,
    rowUnavailable: m.rowUnavailable,
    createdTitle: (carrier) => interpolate(m.createdTitle, { carrier }),
    createdBody: (carrier) => interpolate(m.createdBody, { carrier }),
    createdAction: m.createdAction,
    shippingTitle: m.shippingTitle,
    shippingEyebrow: m.shippingEyebrow,
    shippingCoverage: (labelled, total, emphasise) =>
      renderRich(
        selectPluralForm(total, m.shippingCoverage, locale),
        { count: emphasise },
        { labelled, n: total }
      ),
    shippingRestByShop: (rest) => formatPlural(rest, m.shippingRestByShop, locale),
    shippingAllLabelled: m.shippingAllLabelled,
    shippingChange: m.shippingChange,
    shippingUnlisted: m.shippingUnlisted,
    shippingNoMethods: m.shippingNoMethods,
    shippingLoading: m.shippingLoading,
    backToOmsSetup: m.backToOmsSetup,
  };
}

/** The same wording for an explicit language, outside React (tests). */
export function connectionShippingCopyIn(locale: SupportedLocale): ConnectionShippingCopy {
  return buildConnectionShippingCopy(messagesIn('connections', locale).shipping, locale);
}

export function useConnectionShippingCopy(): ConnectionShippingCopy {
  const messages = useMessages('connections').shipping;
  const locale = useActiveLocale();
  return useMemo(() => buildConnectionShippingCopy(messages, locale), [messages, locale]);
}
