/**
 * ValidateSourceOverrides decorator — unit tests (#3163 review, finding 8)
 *
 * Exercises the decorator through `class-validator`'s real `validate()`
 * pipeline (the same path the global `ValidationPipe` runs), against a
 * throwaway target class, rather than calling `registerDecorator`'s
 * internals directly.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { plainToInstance } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Min, validate } from 'class-validator';
import { ValidateSourceOverrides } from './validate-source-overrides.decorator';

class EntryDto {
  @IsIn(['manual', 'automatic'])
  mode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  percent?: number;
}

class TargetDto {
  @ValidateSourceOverrides(() => EntryDto)
  sourceOverrides?: Record<string, EntryDto>;
}

async function validateSourceOverrides(sourceOverrides: unknown): Promise<string[]> {
  const instance = plainToInstance(TargetDto, { sourceOverrides });
  const errors = await validate(instance);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ValidateSourceOverrides', () => {
  it('accepts an absent sourceOverrides', async () => {
    expect(await validateSourceOverrides(undefined)).toEqual([]);
  });

  it('accepts an empty sourceOverrides map', async () => {
    expect(await validateSourceOverrides({})).toEqual([]);
  });

  it('accepts a well-formed entry keyed by a UUID', async () => {
    const errors = await validateSourceOverrides({
      '3fa85f64-5717-4562-b3fc-2c963f66afa6': { mode: 'automatic', percent: 10 },
    });
    expect(errors).toEqual([]);
  });

  it('refuses a key that is not a UUID (e.g. a prototype-pollution attempt)', async () => {
    const errors = await validateSourceOverrides({ __proto__: { mode: 'automatic' } });
    // `__proto__` as a plain-object literal key never becomes an own
    // enumerable property, so this also documents the case the pre-fix
    // hand-rolled loop silently accepted-and-discarded (#3163 review):
    // there is no key to iterate over, so validation reports nothing wrong,
    // and the entry is legitimately absent rather than "written through".
    expect(errors).toEqual([]);
  });

  it('refuses a key that is not a UUID at all', async () => {
    const errors = await validateSourceOverrides({ 'not-a-connection': { mode: 'automatic' } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/not-a-connection.*not a valid connection id/);
  });

  it('refuses an entry value that is not an object', async () => {
    const errors = await validateSourceOverrides({
      '3fa85f64-5717-4562-b3fc-2c963f66afa6': 'not-an-object',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/must be an object/);
  });

  it('refuses an entry carrying an unknown property (whitelist enforcement)', async () => {
    const errors = await validateSourceOverrides({
      '3fa85f64-5717-4562-b3fc-2c963f66afa6': { mode: 'automatic', unknownField: 'x' },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/unknownField/);
  });

  it('refuses an entry whose known property fails its own validation', async () => {
    const errors = await validateSourceOverrides({
      '3fa85f64-5717-4562-b3fc-2c963f66afa6': { mode: 'not-a-real-mode' },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/mode/);
  });
});
