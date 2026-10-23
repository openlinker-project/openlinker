/**
 * Worklist query DTO — the `active` alias (#3096)
 *
 * A query string carries text, so `?active=true` arrives as the string
 * "true". These specs pin the two literal spellings to booleans and prove
 * anything else is REJECTED rather than silently read as false — a board that
 * typo'd the alias must fail loudly, not quietly show closed work again.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ListFulfillmentWorksQueryDto } from './list-fulfillment-works-query.dto';

async function parse(
  query: Record<string, unknown>
): Promise<{ dto: ListFulfillmentWorksQueryDto; errors: string[] }> {
  const dto = plainToInstance(ListFulfillmentWorksQueryDto, query);
  const errors = await validate(dto);
  return { dto, errors: errors.map((error) => error.property) };
}

describe('ListFulfillmentWorksQueryDto — active', () => {
  it('should read the string "true" as true when the board asks for active work', async () => {
    const { dto, errors } = await parse({ active: 'true' });

    expect(errors).toEqual([]);
    expect(dto.active).toBe(true);
  });

  it('should read the string "false" as false, never as a truthy string', async () => {
    const { dto, errors } = await parse({ active: 'false' });

    expect(errors).toEqual([]);
    expect(dto.active).toBe(false);
  });

  it('should leave active undefined when the param is absent', async () => {
    const { dto, errors } = await parse({});

    expect(errors).toEqual([]);
    expect(dto.active).toBeUndefined();
  });

  it('should reject any other spelling rather than guess', async () => {
    const { errors } = await parse({ active: 'yes' });

    expect(errors).toContain('active');
  });
});
