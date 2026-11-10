/**
 * Gift documents - public surface (#3941)
 *
 * The gift form on documents: an OpenLinker-wide default (Settings > Sales
 * documents), a per-connection override (Connection > Mappings > Gifts on
 * documents), and the label every surface uses to say where a gift's form came
 * from. The presenter in `lib/gift-lines.ts` is a mirror guarded by
 * `scripts/check-gift-lines-mirror.mjs`.
 */
export { GiftDocumentsDefaultPanel } from './components/gift-documents-default-panel';
export { GiftsOnDocumentsPanel } from './components/gifts-on-documents-panel';
export { useGiftFormLabels, type GiftFormLabels } from './lib/use-gift-form-labels';
export { resolveGiftDocumentForm, type GiftFormSource, type ResolvedGiftForm } from './lib/gift-lines';
export { GiftDocumentFormField } from './components/gift-document-form-field';
export {
  GiftDocumentFormChoiceValues,
  GiftFormPickerValues,
  isGiftLineForm,
  type GiftDocumentFormChoice,
  type GiftLineForm,
} from './lib/gift-lines';
export { useGiftDocumentSettingsQuery } from './hooks/use-gift-documents-queries';
export { readGiftConnectionOverride } from './lib/gift-on-documents-config';
