/**
 * Shoper Product Status Mapper
 *
 * Reads a published product's visibility back into the neutral
 * `ShopPublicationStatus`, as the exact inverse of how the publisher writes it
 * (`buildShoperProductBody`): `published` is written as
 * `translations.<lang>.active = 1` and `draft` as `0`. Shoper has no other
 * non-live state (verified live: the panel's "Aktywność" is that flag, and a
 * deleted product answers 404, handled by the adapter as `removed`).
 *
 * So an inactive product reads as `draft`, never `unpublished`. Shoper cannot
 * tell "never made visible" from "hidden afterwards", and `draft` is what
 * OpenLinker itself wrote for a `0`; reading it as `unpublished` would report a
 * product published as a draft as having been taken down by the shop.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import { SHOP_PUBLICATION_STATUS, type ShopPublicationStatus } from '@openlinker/core/listings';

import type { ShoperProductTranslation } from '../../domain/types/shoper-api.types';

function readActiveFlag(value: ShoperProductTranslation['active']): boolean | null {
  if (value === true || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 0 || value === '0') {
    return false;
  }
  return null;
}

/**
 * The publication status in `language` (the shop's default, the one the
 * publisher writes), or `null` when the product carries no readable flag there.
 * `null` is not guessed into either status: a product shown as live when it is
 * hidden, or the reverse, is a false statement the operator would act on.
 */
export function mapShoperProductPublicationStatus(
  // The wire is not trusted: a malformed answer may omit `translations` or send `null`.
  translations: Readonly<Record<string, ShoperProductTranslation>> | null | undefined,
  language: string,
): ShopPublicationStatus | null {
  if (language.length === 0 || translations === undefined || translations === null) {
    return null;
  }
  const active = readActiveFlag(translations[language]?.active);
  if (active === null) {
    return null;
  }
  return active ? SHOP_PUBLICATION_STATUS.Published : SHOP_PUBLICATION_STATUS.Draft;
}
