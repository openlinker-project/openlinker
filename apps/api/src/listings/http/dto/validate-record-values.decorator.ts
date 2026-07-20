/**
 * ValidateRecordValues custom validation decorator (#1741)
 *
 * class-validator's `@ValidateNested()` recurses into arrays and object
 * properties but NOT into the *values* of a `Record<string, T>` map. The bulk
 * offer-create request carries two such maps (`perProductOverrides`,
 * `perVariantOverrides`); without this decorator the global `whitelist` /
 * `forbidNonWhitelisted` pipe never reaches their values, so a malformed
 * override (over-long title, non-URL image, non-positive price, malformed EAN)
 * would sail through the boundary.
 *
 * `@ValidateRecordValues(() => SomeDto)` transforms + validates every own
 * enumerable value of the decorated map against `SomeDto`, failing the whole
 * property if any value has a constraint violation. Iterates with `Object.keys`
 * (own enumerable keys only), so it never walks the prototype chain.
 *
 * @module apps/api/src/listings/http/dto
 */
import { plainToInstance } from 'class-transformer';
import {
  registerDecorator,
  validate,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

type ClassConstructor = new () => object;

export function ValidateRecordValues(
  typeFactory: () => ClassConstructor,
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'validateRecordValues',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [typeFactory],
      options: validationOptions,
      validator: {
        async validate(value: unknown, args: ValidationArguments): Promise<boolean> {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const [factory] = args.constraints as [() => ClassConstructor];
          const cls = factory();
          for (const key of Object.keys(value as Record<string, unknown>)) {
            const entry = (value as Record<string, unknown>)[key];
            const instance = plainToInstance(cls, entry);
            const errors = await validate(instance, { whitelist: true });
            if (errors.length > 0) return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} contains an invalid override value`;
        },
      },
    });
  };
}
