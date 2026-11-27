import 'reflect-metadata';
import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min, ValidateNested } from 'class-validator';
import { CodedValidationPipe, createValidationPipe } from './coded-validation.pipe';

class ItemDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}

class BodyDto {
  @IsNotEmpty()
  name!: string;

  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items!: ItemDto[];
}

const metadata: ArgumentMetadata = { type: 'body', metatype: BodyDto };

async function rejectionOf(value: unknown): Promise<BadRequestException> {
  try {
    await createValidationPipe().transform(value, metadata);
  } catch (error) {
    if (error instanceof BadRequestException) return error;
    throw error;
  }
  throw new Error('expected the pipe to reject');
}

describe('CodedValidationPipe', () => {
  it('should be the pipe createValidationPipe returns', () => {
    expect(createValidationPipe()).toBeInstanceOf(CodedValidationPipe);
  });

  it("should keep Nest's message and error and add the code and fields", async () => {
    const exception = await rejectionOf({ name: '', items: [{ quantity: 0 }] });

    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({
      statusCode: 400,
      message: ['name should not be empty', 'items.0.quantity must not be less than 1'],
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      fields: [
        { path: 'name', code: 'isNotEmpty' },
        { path: 'items.0.quantity', code: 'min', params: { min: 1 } },
      ],
    });
  });

  it('should still refuse an unknown property', async () => {
    const exception = await rejectionOf({ name: 'A', items: [], extra: true });

    expect(exception.getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ path: 'extra', code: 'whitelistValidation' }],
    });
  });

  it('should pass a valid body through, transformed', async () => {
    const value: unknown = await createValidationPipe().transform(
      { name: 'A', items: [{ quantity: 2 }] },
      metadata
    );

    expect(value).toBeInstanceOf(BodyDto);
  });
});
