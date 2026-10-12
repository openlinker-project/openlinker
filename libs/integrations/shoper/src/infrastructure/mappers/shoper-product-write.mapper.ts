/**
 * Shoper Product Write Mapper (#3712)
 *
 * Pure projection of a neutral `PublishProductCommand` onto the body of
 * `POST /products` / `PUT /products/:id`, plus the list of command fields this
 * adapter does NOT publish. Nothing here does I/O or throws: refusing a command
 * is the adapter's job, so this stays testable as plain data.
 *
 * Only what the command actually carries is written. An update is a partial
 * `PUT`, so an absent field is left as the shop holds it - never sent as empty
 * or zero. The one exception is the visibility, which is always stated because
 * a publish names its target state.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { PublishProductCommand } from '@openlinker/core/listings';

import type {
  ShoperProductStockWrite,
  ShoperProductTranslationWrite,
  ShoperProductWriteBody,
} from '../../domain/types/shoper-product-write.types';

export interface ShoperProductWriteContext {
  /** Shop default language, e.g. `pl_PL`: the key of the `translations` object. */
  readonly language: string;
  /** Shop default currency, or null when the shop did not report one. */
  readonly currency: string | null;
  /** With the multi-warehouse module on, `stock.stock` is not the whole pool, so it is not written. */
  readonly warehousesEnabled: boolean;
}

export interface ShoperProductWriteProjection {
  readonly body: ShoperProductWriteBody;
  readonly warnings: string[];
}

/** The ids as numbers, or `null` when any is not a positive integer Shoper could use. */
export function parseShoperCategoryIds(ids: readonly string[]): number[] | null {
  const parsed = ids.map((id) => (/^\d+$/.test(id.trim()) ? Number(id.trim()) : Number.NaN));
  return parsed.every((n) => Number.isSafeInteger(n) && n > 0) ? [...new Set(parsed)] : null;
}

export function buildShoperProductBody(
  cmd: PublishProductCommand,
  ctx: ShoperProductWriteContext,
): ShoperProductWriteProjection {
  const warnings = collectUnsupportedWarnings(cmd, ctx);

  const translation: ShoperProductTranslationWrite = { active: cmd.status === 'published' ? 1 : 0 };
  const content = cmd.content;
  if (content?.title !== undefined && content.title.trim().length > 0) {
    translation.name = content.title;
  }
  if (typeof content?.description === 'string') {
    translation.description = content.description;
  }
  if (typeof content?.shortDescription === 'string') {
    translation.short_description = content.shortDescription;
  }
  if (content?.seo?.title !== undefined) {
    translation.seo_title = content.seo.title;
  }
  if (typeof content?.seo?.description === 'string') {
    translation.seo_description = content.seo.description;
  }
  if (content?.seo?.slug !== undefined) {
    translation.seo_url = content.seo.slug;
  }

  const stock: ShoperProductStockWrite = { price: cmd.price.amount };
  if (!ctx.warehousesEnabled) {
    stock.stock = cmd.stock;
  }
  if (cmd.sku !== undefined) {
    stock.code = cmd.sku;
  }
  if (cmd.barcode !== undefined) {
    stock.ean = cmd.barcode;
  }
  if (cmd.weight !== undefined) {
    stock.weight = cmd.weight;
  }

  const body: ShoperProductWriteBody = {
    translations: { [ctx.language]: translation },
    stock,
  };
  const categoryIds = parseShoperCategoryIds(cmd.destinationCategoryIds);
  if (categoryIds !== null && categoryIds.length > 0) {
    body.category_id = categoryIds[0];
    body.categories = categoryIds;
  }
  return { body, warnings };
}

/** Command fields this adapter does not publish. Reported, never silently dropped. */
export function collectUnsupportedWarnings(
  cmd: PublishProductCommand,
  ctx: ShoperProductWriteContext,
): string[] {
  const warnings: string[] = [];
  if (ctx.warehousesEnabled) {
    warnings.push('The shop runs the multi-warehouse module, so the stock quantity was not written.');
  }
  if ((cmd.content?.tags?.length ?? 0) > 0) {
    warnings.push('Tags are not published to Shoper yet.');
  }
  if ((cmd.parameters?.length ?? 0) > 0) {
    warnings.push('Product parameters are not published to Shoper yet.');
  }
  const commerce = cmd.commerce;
  if (commerce?.salePrice !== undefined) {
    warnings.push('The sale price is not published to Shoper yet.');
  }
  if (commerce?.dimensions !== undefined) {
    warnings.push('Product dimensions are not published to Shoper yet.');
  }
  if (commerce?.taxClass !== undefined || commerce?.taxStatus !== undefined) {
    warnings.push("The tax class is not published to Shoper; the shop's own tax rate applies.");
  }
  return warnings;
}

/** Most images one publish uploads: each is a request against a shop whose ceiling is unknown. */
export const SHOPER_MAX_IMAGES_PER_PUBLISH = 10;

export interface ShoperImagePlan {
  /** The URLs to send, in display order (the first becomes the main image). */
  readonly urls: string[];
  /** Why some were not sent, for the publish warnings. */
  readonly skipped: string[];
}

/**
 * Which of the command's image URLs are sent. Shoper fetches the image itself,
 * so only an absolute http(s) URL is worth sending; anything else is reported
 * rather than guessed at. Duplicates collapse and the count is capped.
 */
export function planShoperImageUploads(cmd: PublishProductCommand): ShoperImagePlan {
  const urls: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const raw of cmd.content?.imageUrls ?? []) {
    const url = raw.trim();
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    if (!/^https?:\/\/\S+$/i.test(url)) {
      skipped.push(`An image URL is not an absolute http(s) address and was not sent: ${url}`);
    } else if (urls.length >= SHOPER_MAX_IMAGES_PER_PUBLISH) {
      skipped.push(`Only the first ${SHOPER_MAX_IMAGES_PER_PUBLISH} images are sent; ${url} was not.`);
    } else {
      urls.push(url);
    }
  }
  return { urls, skipped };
}
