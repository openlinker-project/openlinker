/**
 * Bundles - public surface (#3624)
 *
 * The bundle form and the small pieces other features render: the "used in"
 * list, the order's bundle line rows and the multipack hold banner.
 */
export { BundleForm, type BundleFormProps } from './components/bundle-form';
export { MultipackHoldBanner } from './components/multipack-hold-banner';
export { ProductUsedInBundles } from './components/product-used-in-bundles';
export { BundleComposition } from './components/bundle-composition';
export { splitBundlePrice } from './lib/bundle-price-split';
export { bundlesQueryKeys } from './api/bundles.query-keys';
export { BundleProductPicker } from './components/bundle-product-picker';
export type { BundleProductChoice } from './lib/bundle-choice';
export { useBundleUsedInManyQuery } from './hooks/use-bundle-queries';
