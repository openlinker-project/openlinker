/**
 * Buyer Tax Id DTO (#1119)
 *
 * Scheme-tagged tax identifier (EN 16931 BT-30 / ISO 6523). PRESENCE on the
 * issue request drives the B2B/B2C axis in the mapper (present => company,
 * absent => private) - there is NO NIP/VAT logic in the API layer beyond the
 * defensive checksum gate below; `scheme` is an open string the provider adapter
 * interprets.
 *
 * NIP checksum (#1595): when - and only when - the scheme tags the value as a
 * Polish NIP (`pl-nip`), the mod-11 check digit is validated so a
 * mistyped-but-well-formed NIP is rejected at the OL boundary instead of
 * round-tripping to a generic KSeF submission-time rejection. Any other scheme
 * (e.g. `eu-vat`) is left untouched - the API stays provider-agnostic and does
 * not reinterpret foreign identifiers as Polish NIPs.
 *
 * The mod-11 helper is a deliberate ~10-line local copy (not shared from
 * `@openlinker/shared` nor imported from the KSeF plugin): the invoicing API is
 * provider-agnostic and must not depend on a concrete provider package, and the
 * algorithm is fixed by Polish law and does not drift.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import { IsString, IsNotEmpty, Validate, ValidatorConstraint } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const PL_NIP_SCHEME = 'pl-nip';
const NIP_CHECKSUM_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

function isValidNipChecksum(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = value.split('').map((c) => Number(c));
  const sum = NIP_CHECKSUM_WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const checkDigit = sum % 11;
  if (checkDigit === 10) return false;
  return checkDigit === digits[9];
}

/**
 * Rejects a `value` that carries the `pl-nip` scheme but fails the mod-11 check
 * (or is not a 10-digit NIP once separators are stripped). Non-`pl-nip` schemes
 * pass unconditionally - the constraint is scheme-scoped by design.
 */
@ValidatorConstraint({ name: 'plNipChecksum', async: false })
class PlNipChecksumConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const scheme = (args.object as BuyerTaxIdDto).scheme;
    if (typeof scheme !== 'string' || scheme.trim().toLowerCase() !== PL_NIP_SCHEME) {
      return true; // not a Polish NIP - out of scope for the checksum gate
    }
    if (typeof value !== 'string') return true; // @IsString reports the type error
    return isValidNipChecksum(value.replace(/[\s-]/g, ''));
  }

  defaultMessage(): string {
    return 'value must be a checksum-valid 10-digit Polish NIP when scheme is pl-nip';
  }
}

export class BuyerTaxIdDto {
  @ApiProperty({ description: 'Open scheme tag interpreted by the adapter (e.g. pl-nip, eu-vat)' })
  @IsString()
  @IsNotEmpty()
  scheme!: string;

  @ApiProperty({ description: 'The identifier value' })
  @IsString()
  @IsNotEmpty()
  @Validate(PlNipChecksumConstraint)
  value!: string;
}
