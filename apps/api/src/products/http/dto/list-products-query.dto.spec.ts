import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListProductsQueryDto } from './list-products-query.dto';

async function parse(bundles: string): Promise<{ errors: number; bundles?: string }> {
  const dto = plainToInstance(ListProductsQueryDto, { bundles });
  const errors = await validate(dto);
  return { errors: errors.length, bundles: dto.bundles };
}

describe('ListProductsQueryDto bundles', () => {
  it.each([
    ['only', 'only'],
    ['exclude', 'exclude'],
    ['true', 'only'],
  ])('should accept %s as %s', async (input, expected) => {
    expect(await parse(input)).toEqual({ errors: 0, bundles: expected });
  });

  it('should treat false as no filter', async () => {
    expect(await parse('false')).toEqual({ errors: 0, bundles: undefined });
  });

  it('should reject an unknown value', async () => {
    expect((await parse('nope')).errors).toBe(1);
  });
});
