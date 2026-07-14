/**
 * Erli single-offer wizard schema
 *
 * Field schema for `ErliCreateOfferWizard`. Erli offers are products — no
 * seller/delivery policies — so the field set is smaller than Allegro's:
 * variant, title, category (Allegro-id reuse #985), price (PLN), stock,
 * description, and dispatch time. Images come from the master product (not
 * operator-entered).
 *
 * `parameters` (#1384) mirrors Allegro's `createOfferFieldsSchema` shape —
 * a dynamic per-category dict validated at step-advance time via
 * `buildParametersZodSchema`, not by this static resolver. It is only
 * populated when the connection has Allegro category access configured
 * (`connection.config.allegroCategoryAccessEnabled`); otherwise it stays
 * `{}` and is dropped from the submit payload.
 *
 * @module features/listings/components/erli
 */
import { z } from 'zod';

import { erliOfferFieldsSchema } from './erli-offer-fields.schema';

export const erliCreateOfferSchema = z
  .object({
    internalVariantId: z.string().regex(/^ol_variant_[a-f0-9]+$/, 'Pick a variant'),
    variantLabel: z.string().optional(),
    title: z
      .string()
      .min(1, 'Title is required')
      .max(120, 'Title must be 120 characters or fewer'),
    categoryId: z.string().optional(),
    priceAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a positive number with up to 2 decimal places'),
    stock: z
      .number({ message: 'Stock must be a number' })
      .int('Stock must be an integer')
      .min(0, 'Stock must be 0 or greater'),
    description: z.string().optional(),
    // Responsible-producer id (#1531). Optional at the form level so the wizard
    // never deadlocks when the Erli account has none; when set it rides to the
    // adapter on `overrides.platformParams.producer` and clears the created
    // product's missing-producer block.
    producer: z.string().optional(),
    // Delivery price list ("cennik dostawy") name (#1530). Optional at the form
    // level so the wizard never deadlocks when the Erli account has none; when
    // set it rides to the adapter on `overrides.platformParams.deliveryPriceList`
    // and makes the created offer buyable.
    deliveryPriceList: z.string().optional(),
    publishImmediately: z.boolean(),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .merge(erliOfferFieldsSchema);

// `.default({})` on `parameters` makes it optional on input (RHF form state,
// pre-submit) and required on output (post-resolver submit handler) — same
// split `createOfferFieldsSchema` uses for Allegro's wizard.
export type ErliCreateOfferValues = z.input<typeof erliCreateOfferSchema>;
export type ErliCreateOfferSubmission = z.output<typeof erliCreateOfferSchema>;
