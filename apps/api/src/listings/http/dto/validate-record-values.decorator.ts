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
 * Validation runs with `whitelist` + `forbidNonWhitelisted`, so an entry
 * carrying an unknown property (`{ stock: 1, junk: "…" }`) is rejected at the
 * boundary rather than flowing through to `mergeOverrides` and the adapter.
 * Each entry must itself be a plain object — `null`, arrays, and primitives are
 * rejected up front (`plainToInstance(cls, null)` would otherwise yield an
 * all-optional empty instance that passes). The failing key + child constraint
 * are surfaced in the 400 message so the rejection is debuggable (#1741 review #5).
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

function isPlainObjectEntry(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry);
}

export function ValidateRecordValues(
  typeFactory: () => ClassConstructor,
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    // Per-property closure holding the most recent failure detail so
    // `defaultMessage` can name the offending key/field/constraint. A shared
    // literal across concurrent requests can only ever mislabel the advisory
    // message (never the pass/fail verdict), which is an acceptable trade for a
    // debuggable 400.
    let failureDetail: string | null = null;

    registerDecorator({
      name: 'validateRecordValues',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [typeFactory],
      options: validationOptions,
      validator: {
        async validate(value: unknown, args: ValidationArguments): Promise<boolean> {
          failureDetail = null;
          if (value === undefined || value === null) return true;
          if (!isPlainObjectEntry(value)) return false;
          const [factory] = args.constraints as [() => ClassConstructor];
          const cls = factory();
          for (const key of Object.keys(value)) {
            const entry = value[key];
            if (!isPlainObjectEntry(entry)) {
              failureDetail = `["${key}"] must be an object`;
              return false;
            }
            const instance = plainToInstance(cls, entry);
            const errors = await validate(instance, {
              whitelist: true,
              forbidNonWhitelisted: true,
            });
            if (errors.length > 0) {
              const first = errors[0];
              const constraint = first.constraints
                ? Object.values(first.constraints)[0]
                : 'invalid value';
              failureDetail = `["${key}"].${first.property}: ${constraint}`;
              return false;
            }
          }
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          return failureDetail !== null
            ? `${args.property}${failureDetail}`
            : `${args.property} contains an invalid override value`;
        },
      },
    });
  };
}
