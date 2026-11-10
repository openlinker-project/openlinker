import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BundleReturnPreviewQueryDto } from './return-custody.dto';

describe('BundleReturnPreviewQueryDto (#3520)', () => {
  const check = (quantity: unknown) =>
    validate(plainToInstance(BundleReturnPreviewQueryDto, { quantity }));

  it('should accept a positive whole quantity sent as a query string', async () => {
    const dto = plainToInstance(BundleReturnPreviewQueryDto, { quantity: '3' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.quantity).toBe(3);
  });

  it.each(['0', '-2', '1.5', 'abc'])('should reject quantity %s', async (value) => {
    expect((await check(value)).length).toBeGreaterThan(0);
  });
});
