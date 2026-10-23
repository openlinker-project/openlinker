/**
 * ValidateSourceOverrides custom validation decorator (#3163 review, finding 8)
 *
 * `UpdatePricingSyncDto.sourceOverrides` is a `Record<string, T>` keyed by
 * connection id — class-validator has no first-class nested decorator for a
 * map's VALUES (mirroring `@ValidateRecordValues`,
 * `apps/api/src/listings/http/dto/validate-record-values.decorator.ts`), and
 * has none at all for a map's KEYS. Before this decorator, the controller's
 * hand-rolled per-entry loop validated values with a bare `validate()` call
 * (no `whitelist`/`forbidNonWhitelisted`), so it silently bypassed the
 * global pipe's `whitelist: true, forbidNonWhitelisted: true`
 * (`main.ts`) — an unknown property inside a `rule` object survived straight
 * into the persisted `Connection.config` JSONB. The loop also never
 * validated the KEYS at all: a key that is not a real connection id (e.g.
 * `"__proto__"`, tested live — see the review comment) was accepted with a
 * 200 and then silently discarded, because assigning `result['__proto__'] =
 * value` sets `result`'s PROTOTYPE rather than adding an own property.
 *
 * This decorator closes both gaps in one declarative pass, reached through
 * the ordinary global `ValidationPipe` (so the controller no longer needs a
 * second, manual validation call at all): every key must be a UUID (Connection
 * ids are `@PrimaryGeneratedColumn('uuid')`), and every value is
 * `plainToInstance` + `validate()`d against the target class WITH
 * `whitelist: true, forbidNonWhitelisted: true` — an unknown property inside
 * an entry now fails the request rather than being silently written through.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { plainToInstance } from 'class-transformer';
import {
  isUUID,
  registerDecorator,
  validate,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

type ClassConstructor = new () => object;

function isPlainObjectEntry(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry);
}

export function ValidateSourceOverrides(
  typeFactory: () => ClassConstructor,
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    // Per-property closure holding the most recent failure detail so
    // `defaultMessage` can name the offending source connection id (the
    // `ValidateRecordValues` precedent).
    let failureDetail: string | null = null;

    registerDecorator({
      name: 'validateSourceOverrides',
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
            if (!isUUID(key)) {
              failureDetail = `["${key}"] is not a valid connection id`;
              return false;
            }
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
            : `${args.property} contains an invalid source override`;
        },
      },
    });
  };
}
