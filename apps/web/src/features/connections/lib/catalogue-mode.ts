/**
 * Catalogue mode (browser side, #4281)
 *
 * The browser cannot import `@openlinker/core` (#591), so the two literals and
 * the read rule of `config.catalogueMode` are restated here. They must stay
 * identical to `libs/core/src/identifier-mapping/domain/types/catalogue-mode.types.ts`
 * (`CatalogueModeValues`, `readCatalogueMode`): a missing key, an explicit `null`
 * (what this form writes for the default, #2016) and any unrecognised value read
 * as `linked`, so an existing connection behaves exactly as before.
 *
 * @module apps/web/src/features/connections/lib
 */
export const CatalogueModeValues = ['linked', 'none'] as const;

export type CatalogueMode = (typeof CatalogueModeValues)[number];

export function readCatalogueMode(config: Record<string, unknown> | null | undefined): CatalogueMode {
  return config?.catalogueMode === 'none' ? 'none' : 'linked';
}
