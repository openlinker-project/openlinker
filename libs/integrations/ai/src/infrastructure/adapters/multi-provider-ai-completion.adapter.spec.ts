/**
 * Multi-Provider AI Completion Adapter — Unit Tests
 *
 * The router holds a static map of per-provider adapters and resolves the
 * active provider on every call through `IAiProviderActiveSettingsService`.
 * Tests cover: dispatch to each branch, propagation of input/output, and
 * the defensive "no adapter for provider" path.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import type { IAiProviderActiveSettingsService } from '@openlinker/core/ai/application/services/ai-provider-active-settings.service.interface';
import type {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from '@openlinker/core/ai/domain/types/ai-completion.types';
import type { AiCompletionPort } from '@openlinker/core/ai/domain/ports/ai-completion.port';
import { AiCompletionError } from '@openlinker/core/ai/domain/exceptions/ai-completion.exception';
import { MultiProviderAiCompletionAdapter } from './multi-provider-ai-completion.adapter';

const buildResult = (text: string): AiCompletionResult => ({
  text,
  usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
  modelUsed: 'm',
  latencyMs: 1,
});

const buildAdapterStub = (text: string): AiCompletionPort & { complete: jest.Mock } => ({
  complete: jest.fn().mockResolvedValue(buildResult(text)),
});

const buildActiveSettings = (
  provider: AiProvider,
): jest.Mocked<IAiProviderActiveSettingsService> => ({
  getActive: jest.fn().mockResolvedValue(provider),
  setActive: jest.fn(),
  getMultiProviderView: jest.fn(),
});

const sampleInput: AiCompletionInput = {
  systemPrompt: 's',
  userPrompt: 'u',
  requestId: 'req-1',
};

describe('MultiProviderAiCompletionAdapter', () => {
  it('routes to the anthropic adapter when active=anthropic', async () => {
    const anthropic = buildAdapterStub('A');
    const openai = buildAdapterStub('O');
    const fake = buildAdapterStub('F');
    const router = new MultiProviderAiCompletionAdapter(
      anthropic,
      openai,
      fake,
      buildActiveSettings('anthropic'),
    );

    const result = await router.complete(sampleInput);

    expect(result.text).toBe('A');
    expect(anthropic.complete).toHaveBeenCalledWith(sampleInput);
    expect(openai.complete).not.toHaveBeenCalled();
    expect(fake.complete).not.toHaveBeenCalled();
  });

  it('routes to the openai adapter when active=openai', async () => {
    const anthropic = buildAdapterStub('A');
    const openai = buildAdapterStub('O');
    const fake = buildAdapterStub('F');
    const router = new MultiProviderAiCompletionAdapter(
      anthropic,
      openai,
      fake,
      buildActiveSettings('openai'),
    );

    const result = await router.complete(sampleInput);

    expect(result.text).toBe('O');
    expect(openai.complete).toHaveBeenCalledWith(sampleInput);
  });

  it('routes to the fake adapter when active=fake', async () => {
    const anthropic = buildAdapterStub('A');
    const openai = buildAdapterStub('O');
    const fake = buildAdapterStub('F');
    const router = new MultiProviderAiCompletionAdapter(
      anthropic,
      openai,
      fake,
      buildActiveSettings('fake'),
    );

    const result = await router.complete(sampleInput);

    expect(result.text).toBe('F');
    expect(fake.complete).toHaveBeenCalledWith(sampleInput);
  });

  it('reads the active provider on every call (no cache)', async () => {
    const anthropic = buildAdapterStub('A');
    const openai = buildAdapterStub('O');
    const fake = buildAdapterStub('F');
    const activeSettings = buildActiveSettings('anthropic');
    const router = new MultiProviderAiCompletionAdapter(
      anthropic,
      openai,
      fake,
      activeSettings,
    );

    await router.complete(sampleInput);
    activeSettings.getActive.mockResolvedValueOnce('openai');
    await router.complete(sampleInput);

    expect(activeSettings.getActive).toHaveBeenCalledTimes(2);
    expect(anthropic.complete).toHaveBeenCalledTimes(1);
    expect(openai.complete).toHaveBeenCalledTimes(1);
  });

  it('throws AiCompletionError if the active-settings service returns an unknown provider', async () => {
    const anthropic = buildAdapterStub('A');
    const openai = buildAdapterStub('O');
    const fake = buildAdapterStub('F');
    const activeSettings = buildActiveSettings('anthropic');
    activeSettings.getActive.mockResolvedValueOnce('cohere' as AiProvider);
    const router = new MultiProviderAiCompletionAdapter(
      anthropic,
      openai,
      fake,
      activeSettings,
    );

    await expect(router.complete(sampleInput)).rejects.toBeInstanceOf(AiCompletionError);
  });
});
