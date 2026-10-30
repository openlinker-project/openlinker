/**
 * Delivery on documents - public surface (#3908)
 *
 * Only the panel the connection mappings page mounts is public; the mirror
 * (`lib/delivery-line.ts`) is guarded by `check-delivery-line-mirror.mjs`.
 */
export { DeliveryOnDocumentsPanel } from './components/delivery-on-documents-panel';
