import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  validateSync,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { toValidationFieldErrors } from './validation-field-errors';

@ValidatorConstraint({ name: 'isEvenAbove' })
class IsEvenAbove implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'number' && value % 2 === 0;
  }
}

class LineDto {
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @MaxLength(20)
  sku!: string;
}

class AddressDto {
  @IsIn(['PL', 'DE'])
  country!: string;
}

class OrderDto {
  @IsNotEmpty()
  name!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];

  @Validate(IsEvenAbove, [10])
  even!: number;
}

function errorsFor(plain: Record<string, unknown>): ReturnType<typeof validateSync> {
  return validateSync(plainToInstance(OrderDto, plain));
}

describe('toValidationFieldErrors', () => {
  const valid = {
    name: 'A',
    address: { country: 'PL' },
    lines: [{ quantity: 1, sku: 'S1' }],
    even: 12,
  };

  it('should return no fields for a valid body', () => {
    expect(toValidationFieldErrors(errorsFor(valid))).toEqual([]);
  });

  it('should name a top-level constraint by its key with no params', () => {
    expect(toValidationFieldErrors(errorsFor({ ...valid, name: '' }))).toEqual([
      { path: 'name', code: 'isNotEmpty' },
    ]);
  });

  it('should join a nested object path with dots and list allowed values', () => {
    expect(toValidationFieldErrors(errorsFor({ ...valid, address: { country: 'FR' } }))).toEqual([
      { path: 'address.country', code: 'isIn', params: { values: 'PL, DE' } },
    ]);
  });

  it('should put the array index in the path and name the bound', () => {
    const fields = toValidationFieldErrors(
      errorsFor({
        ...valid,
        lines: [
          { quantity: 1, sku: 'S1' },
          { quantity: 0, sku: 'S'.repeat(21) },
        ],
      })
    );

    expect(fields).toEqual([
      { path: 'lines.1.quantity', code: 'min', params: { min: 1 } },
      { path: 'lines.1.sku', code: 'maxLength', params: { max: 20 } },
    ]);
  });

  it('should report an array that is too short with its minimum', () => {
    expect(toValidationFieldErrors(errorsFor({ ...valid, lines: [] }))).toEqual([
      { path: 'lines', code: 'arrayMinSize', params: { min: 1 } },
    ]);
  });

  it('should name a custom validator by its registered name and pass its primitive args', () => {
    expect(toValidationFieldErrors(errorsFor({ ...valid, even: 3 }))).toEqual([
      { path: 'even', code: 'isEvenAbove', params: { arg0: 10 } },
    ]);
  });

  it('should list every failed constraint of one property', () => {
    const fields = toValidationFieldErrors(
      errorsFor({ ...valid, lines: [{ quantity: 'x', sku: 'S1' }] })
    );

    expect(fields.map((f) => f.code).sort()).toEqual(['isInt', 'min']);
    expect(fields.every((f) => f.path === 'lines.0.quantity')).toBe(true);
  });

  it('should report an unknown property under the whitelist key', () => {
    const errors = validateSync(plainToInstance(OrderDto, { ...valid, extra: 1 }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(toValidationFieldErrors(errors)).toEqual([
      { path: 'extra', code: 'whitelistValidation' },
    ]);
  });
});
