/**
 * Create-Offer DTO validation tests (#1071) — focused on the neutral
 * `overrides.parameters` field and its bounds (I1).
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateOfferOverridesDto } from './create-offer.dto';

async function errorsFor(overrides: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateOfferOverridesDto, overrides);
  const errors = await validate(dto, { whitelist: true });
  // Flatten nested constraint keys for easy assertion.
  const collect = (es: typeof errors): string[] =>
    es.flatMap((e) => [
      ...Object.keys(e.constraints ?? {}),
      ...(e.children ? collect(e.children) : []),
    ]);
  return collect(errors);
}

describe('CreateOfferOverridesDto.parameters (#1071)', () => {
  it('accepts a valid neutral parameter array', async () => {
    expect(
      await errorsFor({
        parameters: [
          { id: 'p1', valuesIds: ['a'], section: 'offer' },
          { id: 'p2', values: ['x'], section: 'product' },
          { id: 'p3', rangeValue: { from: '1', to: '5' }, section: 'offer' },
        ],
      }),
    ).toEqual([]);
  });

  it('rejects an unknown section', async () => {
    const errs = await errorsFor({ parameters: [{ id: 'p1', section: 'invalid' }] });
    expect(errs).toContain('isIn');
  });

  it('rejects a missing id', async () => {
    const errs = await errorsFor({ parameters: [{ section: 'offer' }] });
    expect(errs).toContain('isNotEmpty');
  });

  it('rejects a malformed rangeValue (missing to)', async () => {
    const errs = await errorsFor({
      parameters: [{ id: 'p1', section: 'offer', rangeValue: { from: '1' } }],
    });
    expect(errs).toContain('isString');
  });

  it('rejects an array exceeding the size cap', async () => {
    const parameters = Array.from({ length: 201 }, (_v, i) => ({
      id: `p${i}`,
      section: 'offer',
    }));
    const errs = await errorsFor({ parameters });
    expect(errs).toContain('arrayMaxSize');
  });

  it('rejects non-string values entries', async () => {
    const errs = await errorsFor({ parameters: [{ id: 'p1', section: 'offer', values: [1, 2] }] });
    expect(errs).toContain('isString');
  });
});
