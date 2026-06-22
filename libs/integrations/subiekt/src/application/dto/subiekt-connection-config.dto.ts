/**
 * Subiekt Connection Config DTO (#753)
 *
 * class-validator schema for the Subiekt `Connection.config` blob. Plugin-private:
 * only `SubiektConnectionConfigShapeValidatorAdapter` reaches into it.
 *
 * `IsBridgeUrlSafeConstraint` wraps the decorator-free `isBridgeUrlSafe`
 * predicate IMPORTED FROM `infrastructure/http/subiekt-url-safety.ts`. The
 * predicate STAYS in that module (the transport reuses it for the runtime
 * redirect guard without pulling class-validator into its import graph); only
 * the constraint wrapper lives here. `@IsUrl({ require_protocol, require_tld:
 * false, protocols: ['http','https'] })` enforces structural validity; the IMDS
 * decision is enforced by the constraint.
 *
 * @module libs/integrations/subiekt/src/application/dto
 */
import type { ValidatorConstraintInterface } from 'class-validator';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import { isBridgeUrlSafe } from '../../infrastructure/http/subiekt-url-safety';

@ValidatorConstraint({ name: 'isBridgeUrlSafe', async: false })
export class IsBridgeUrlSafeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isBridgeUrlSafe(value);
  }

  defaultMessage(): string {
    return 'bridgeBaseUrl must not point to a cloud-metadata (IMDS) address';
  }
}

export class SubiektConnectionConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https'] })
  @Validate(IsBridgeUrlSafeConstraint)
  bridgeBaseUrl!: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}
