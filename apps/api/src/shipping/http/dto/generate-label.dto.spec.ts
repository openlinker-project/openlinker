/**
 * GenerateLabelDto validation spec
 *
 * Focused on the optional insured-value block (#1542): the field is absent-safe
 * and, when present, enforces a positive decimal amount + a non-empty currency
 * (mirroring the ShipmentCodDto decorators). Uses class-validator against a
 * plain-to-class instance, the same path Nest's ValidationPipe runs.
 *
 * @module apps/api/src/shipping/http/dto
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GenerateLabelDto } from './generate-label.dto';

function basePayload(): Record<string, unknown> {
  return {
    sourceConnectionId: 'a1111111-1111-4111-8111-111111111111',
    orderId: 'ol_order_abc',
    deliveryIntent: 'address',
    recipient: { email: 'buyer@example.com', phone: '+48123456789' },
    parcel: { weightGrams: 1000 },
  };
}

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(GenerateLabelDto, payload);
  const errors = await validate(dto, { whitelist: true });
  // Flatten every constraint key across the (possibly nested) error tree.
  const collect = (es: typeof errors): string[] =>
    es.flatMap((e) => [
      ...Object.keys(e.constraints ?? {}),
      ...collect(e.children ?? []),
    ]);
  return collect(errors);
}

describe('GenerateLabelDto — insuredValue validation (#1542)', () => {
  it('should accept a payload with no insuredValue (field is optional)', async () => {
    expect(await errorsFor(basePayload())).toHaveLength(0);
  });

  it('should accept a valid insured value (positive decimal amount + currency)', async () => {
    expect(
      await errorsFor({ ...basePayload(), insuredValue: { amount: '150.00', currency: 'PLN' } }),
    ).toHaveLength(0);
  });

  it('should reject a non-decimal insured amount', async () => {
    const errors = await errorsFor({
      ...basePayload(),
      insuredValue: { amount: 'abc', currency: 'PLN' },
    });
    expect(errors).toContain('matches');
  });

  it('should reject an insured value missing its currency', async () => {
    const errors = await errorsFor({
      ...basePayload(),
      insuredValue: { amount: '150.00' },
    });
    expect(errors).toContain('isNotEmpty');
  });
});

describe('GenerateLabelDto — required parcel / recipient (#1518)', () => {
  it('should reject a payload that omits parcel', async () => {
    const { parcel: _parcel, ...noParcel } = basePayload();
    expect(await errorsFor(noParcel)).toContain('isDefined');
  });

  it('should reject a payload that omits recipient', async () => {
    const { recipient: _recipient, ...noRecipient } = basePayload();
    expect(await errorsFor(noRecipient)).toContain('isDefined');
  });

  it('should accept a payload that supplies both parcel and recipient', async () => {
    expect(await errorsFor(basePayload())).toHaveLength(0);
  });
});
