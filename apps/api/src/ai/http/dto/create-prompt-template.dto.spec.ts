/**
 * CreatePromptTemplateDto — Validation Tests
 *
 * Pins the `channel` decorator stack under the open-world contract (#580):
 * accepts any non-empty plugin channel string, rejects empty / too-long
 * payloads. Channel is open-world (`= string`); the only boundary checks
 * are length + non-empty, matching the `platformType` precedent.
 *
 * @module apps/api/src/ai/http/dto
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePromptTemplateDto } from './create-prompt-template.dto';

const validBody = {
  key: 'offer.description.suggest',
  channel: 'allegro',
  systemPrompt: 'You are an assistant.',
  userPromptTemplate: 'Generate a description.',
  variables: [],
};

async function constraintErrors(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreatePromptTemplateDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('CreatePromptTemplateDto — channel validation (#580)', () => {
  it('accepts an arbitrary plugin channel string', async () => {
    // 'shopify' has no closed-set membership but should pass — the BE no
    // longer cross-checks against `PromptTemplateChannelValues`.
    expect(await constraintErrors({ ...validBody, channel: 'shopify' })).toEqual([]);
  });

  it('accepts a null/omitted channel (master template)', async () => {
    const withoutChannel = { ...validBody };
    delete (withoutChannel as Partial<typeof validBody>).channel;
    expect(await constraintErrors(withoutChannel)).toEqual([]);
  });

  it('rejects an empty channel string', async () => {
    const errors = await constraintErrors({ ...validBody, channel: '' });
    expect(errors).toContain('isNotEmpty');
  });

  it('rejects a channel string longer than 64 characters', async () => {
    const errors = await constraintErrors({ ...validBody, channel: 'a'.repeat(65) });
    expect(errors).toContain('maxLength');
  });

  it('accepts a channel string exactly 64 characters long', async () => {
    expect(
      await constraintErrors({ ...validBody, channel: 'a'.repeat(64) }),
    ).toEqual([]);
  });
});
