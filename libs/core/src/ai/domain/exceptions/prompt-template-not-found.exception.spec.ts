/**
 * Prompt Template Not Found Exception — unit tests
 *
 * Locks in the message-format contract the FE suggestion dialog matches
 * against (#490). Master-channel lookups gain an operator-actionable hint;
 * other lookup shapes preserve their pre-existing terse format.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import { PromptTemplateNotFoundException } from './prompt-template-not-found.exception';

describe('PromptTemplateNotFoundException', () => {
  it('appends an operator hint when channel is null (master) and key is present', () => {
    const err = new PromptTemplateNotFoundException({
      key: 'offer.description.suggest',
      channel: null,
      version: 1,
    });

    expect(err.message).toBe(
      'Prompt template not found: key=offer.description.suggest, channel=master, version=1. ' +
        'Seed a template with channel=null for this key, or use a channel-specific template.',
    );
    expect(err.key).toBe('offer.description.suggest');
    expect(err.channel).toBeNull();
  });

  it('does not append the hint for channel-specific lookups', () => {
    const err = new PromptTemplateNotFoundException({
      key: 'offer.description.suggest',
      channel: 'allegro',
      version: 1,
    });

    expect(err.message).toBe(
      'Prompt template not found: key=offer.description.suggest, channel=allegro, version=1',
    );
    expect(err.message).not.toContain('Seed a template');
  });

  it('does not append the hint for id-only lookups', () => {
    const err = new PromptTemplateNotFoundException({ templateId: 'tpl_abc' });

    expect(err.message).toBe('Prompt template not found: id=tpl_abc');
    expect(err.message).not.toContain('Seed a template');
  });

  it('does not append the hint when channel is null but no key is present (id-based lookup)', () => {
    // Edge case: channel passed as null without a key. None of the current
    // call sites do this, but locking it down means future refactors that
    // pair channel with templateId won't accidentally trigger the hint.
    const err = new PromptTemplateNotFoundException({
      templateId: 'tpl_abc',
      channel: null,
    });

    expect(err.message).toBe('Prompt template not found: id=tpl_abc, channel=master');
    expect(err.message).not.toContain('Seed a template');
  });
});
