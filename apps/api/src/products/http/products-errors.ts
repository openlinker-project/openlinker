/**
 * Products errors (#3865)
 *
 * The coded HTTP errors the product and product-cost controllers send. Each
 * carries a stable code and the values the frontend's copy needs (ADR-081);
 * `message` stays the English sentence the endpoint always sent.
 *
 * @module apps/api/src/products/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import { codedHttpError } from '../../common/errors/coded-http.exception';

export function productNotFound(productId: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', `Product not found: ${productId}`, {
    productId,
  });
}

export function productVariantNotFound(variantId: string, message: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'PRODUCT_VARIANT_NOT_FOUND', message, { variantId });
}

export function productImageNotFound(productId: string, index: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'PRODUCT_IMAGE_NOT_FOUND',
    `No image ${index} for product ${productId}`,
    { productId, index }
  );
}

export function productVariantImageNotFound(variantId: string, index: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
    `No image ${index} for variant ${variantId}`,
    { variantId, index }
  );
}
