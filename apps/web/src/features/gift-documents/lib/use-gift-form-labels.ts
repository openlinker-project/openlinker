/**
 * useGiftFormLabels (#3941)
 *
 * The operator-facing name of each gift form, and the line saying where a
 * gift's form came from (the gift's rule, the channel, or the OpenLinker
 * default). Exported through the feature barrel so every surface that shows a
 * gift's form reads one copy.
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import { interpolate, useMessages } from '../../../shared/i18n';
import type { GiftDocumentFormChoice, GiftFormSource, GiftLineForm } from './gift-lines';

export interface GiftFormLabels {
  label: (form: GiftDocumentFormChoice) => string;
  short: (form: GiftDocumentFormChoice) => string;
  description: (form: GiftDocumentFormChoice) => string;
  /** `internal-record` is not offered in this UI; it reads as its own words. */
  anyShort: (form: GiftLineForm) => string;
  /** "from the rule" / "from {channel} settings" / "OpenLinker default". */
  source: (source: GiftFormSource, channelName?: string) => string;
}

export function useGiftFormLabels(): GiftFormLabels {
  const copy = useMessages('gift-documents');
  const key = {
    'technical-cent': 'technicalCent',
    'priced-in': 'pricedIn',
    'show-zero': 'showZero',
    omit: 'omit',
  } as const;
  const short = (form: GiftDocumentFormChoice): string => copy.forms[key[form]].short;
  return {
    label: (form) => copy.forms[key[form]].label,
    short,
    description: (form) => copy.forms[key[form]].description,
    anyShort: (form) => (form === 'internal-record' ? form : short(form)),
    source: (source, channelName) =>
      source === 'rule'
        ? copy.source.rule
        : source === 'connection'
          ? interpolate(copy.source.channel, { name: channelName ?? '' })
          : copy.source.default,
  };
}
