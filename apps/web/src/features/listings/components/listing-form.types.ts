/**
 * Listing form types
 *
 * The validation copy each listings form schema is built with, in one place so
 * the schema files hold only the schemas and the schemas do not depend on one
 * another for a type.
 *
 * @module apps/web/src/features/listings/components
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The `listings.parametersZodSchema` copy. */
export type ParametersZodSchemaCopy = ResolvedCopy<Messages['listings']>['parametersZodSchema'];

/** The `listings.editOfferDrawer.validation` copy, in the language the form renders in. */
export type EditOfferFieldsValidationCopy =
  ResolvedCopy<Messages['listings']>['editOfferDrawer']['validation'];

/** The `listings.erliOfferFields.validation` copy, in the language the form renders in. */
export type ErliOfferFieldsValidationCopy = ResolvedCopy<
  Messages['listings']
>['erliOfferFields']['validation'];

/** The `listings.woocommercePublishWizard.validation` copy, in the language the form renders in. */
export type WoocommercePublishWizardValidationCopy = ResolvedCopy<
  Messages['listings']
>['woocommercePublishWizard']['validation'];
