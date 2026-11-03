/**
 * Validation field errors (#3861)
 *
 * Turns class-validator's error tree into the `fields` of an API error
 * envelope: one entry per failed constraint, with a dotted `path`
 * (`items.0.quantity`), the constraint key as `code` (`isNotEmpty`, `min` ...)
 * and the constraint's arguments as `params`, so the frontend can say "at
 * least 1" in the operator's language instead of showing class-validator's
 * English sentence.
 *
 * Params are read from the decorator metadata, never from the message. Only
 * primitive arguments are copied: an object or a function argument (a nested
 * DTO class, a custom validator's options) is not something copy can show.
 *
 * @module apps/api/src/common/validation
 */
import { getMetadataStorage, type ValidationError } from 'class-validator';
import type { ApiErrorField, ApiErrorParams } from '@openlinker/shared/errors';

type ConstraintArg = string | number | boolean;

interface ConstraintMetadata {
  name?: string;
  type: string;
  propertyName: string;
  constraints?: unknown[];
  constraintCls?: new (...args: unknown[]) => unknown;
}

/** Named params for the constraints copy most often needs to quote. */
const NAMED_PARAMS: Record<string, readonly string[]> = {
  min: ['min'],
  max: ['max'],
  minLength: ['min'],
  maxLength: ['max'],
  isLength: ['min', 'max'],
  arrayMinSize: ['min'],
  arrayMaxSize: ['max'],
  minDate: ['min'],
  maxDate: ['max'],
};

/** Constraints whose first argument is a set of allowed values. */
const VALUE_SET_CONSTRAINTS = new Set(['isIn', 'isNotIn', 'isEnum']);

export function toValidationFieldErrors(
  errors: readonly ValidationError[],
  parentPath = ''
): ApiErrorField[] {
  const fields: ApiErrorField[] = [];
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    for (const code of Object.keys(error.constraints ?? {})) {
      const params = paramsFor(error, code);
      fields.push(params ? { path, code, params } : { path, code });
    }
    if (error.children && error.children.length > 0) {
      fields.push(...toValidationFieldErrors(error.children, path));
    }
  }
  return fields;
}

function paramsFor(error: ValidationError, code: string): ApiErrorParams | undefined {
  const args = constraintArgs(error, code);
  if (args === undefined || args.length === 0) return undefined;

  if (VALUE_SET_CONSTRAINTS.has(code)) {
    const values = valueSet(args[0]);
    return values ? { values } : undefined;
  }

  const names = NAMED_PARAMS[code];
  const params: ApiErrorParams = {};
  args.forEach((arg, index) => {
    const value = toParam(arg);
    if (value === undefined) return;
    params[names?.[index] ?? `arg${index}`] = value;
  });
  return Object.keys(params).length > 0 ? params : undefined;
}

function constraintArgs(error: ValidationError, code: string): unknown[] | undefined {
  const target: unknown = error.target;
  if (typeof target !== 'object' || target === null) return undefined;
  const storage = getMetadataStorage();
  const metadatas = storage.getTargetValidationMetadatas(
    target.constructor,
    '',
    true,
    false
  ) as unknown as ConstraintMetadata[];
  const match = metadatas.find(
    (meta) => meta.propertyName === error.property && constraintName(meta) === code
  );
  return match?.constraints;
}

/** A built-in decorator names itself; a `@Validate(Class)` takes its class's registered name. */
function constraintName(meta: ConstraintMetadata): string | undefined {
  if (meta.name) return meta.name;
  if (!meta.constraintCls) return undefined;
  const [registered] = getMetadataStorage().getTargetValidatorConstraints(meta.constraintCls);
  return registered?.name;
}

function toParam(value: unknown): ConstraintArg | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function valueSet(raw: unknown): string | undefined {
  // `@IsIn` takes an array; `@IsEnum` takes an enum object.
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? Object.values(raw as Record<string, unknown>)
      : undefined;
  if (!values) return undefined;
  const primitives = values.map(toParam).filter((v): v is ConstraintArg => v !== undefined);
  const unique = [...new Set(primitives.map(String))];
  return unique.length > 0 ? unique.join(', ') : undefined;
}
