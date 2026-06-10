/**
 * WooCommerce Orders Config DTO
 *
 * Validates the optional orders sub-section of WooCommerceConnectionConfig.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import type { ValidatorConstraintInterface } from 'class-validator';
import { IsOptional, IsString, Validate, ValidatorConstraint } from 'class-validator';

@ValidatorConstraint({ name: 'isValidDate', async: false })
export class IsValidDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && !isNaN(new Date(value).getTime());
  }

  defaultMessage(): string {
    return '$property must be a parseable date string (e.g. "2024-01-01" or "2024-01-01T00:00:00Z")';
  }
}

export class WooCommerceOrdersConfigDto {
  @IsOptional()
  @IsString()
  @Validate(IsValidDateConstraint)
  initialSyncFrom?: string;
}
