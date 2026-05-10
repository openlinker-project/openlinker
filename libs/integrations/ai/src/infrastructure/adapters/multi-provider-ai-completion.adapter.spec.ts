/**
 * Multi-Provider AI Completion Adapter — Unit Tests
 *
 * After #570/#571 the router is empty on construction; per-provider adapters
 * are added via `register(provider, adapter)`, then `complete()` reads the
 * active provider on every call and dispatches to the matching registered
 * adapter. Tests cover: registration (happy + duplicate-fail), dispatch to
 * each branch, propagation of input/output, and the "no adapter for active
 * provider" defensive path.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import { AiCompletionError, DuplicateAiProviderError } from '@openlinker/core/ai';
import type {
  AiCompletionInput,
  AiCompletionPort,
  AiCompletionResult,
  AiProvider,
  IAiProviderActiveSettingsService,
} from '@openlinker/core/ai';
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

/**
 * Build a router pre-populated with anthropic/openai/fake adapters — the
 * standard module-wired shape. Returns the router and the underlying stubs
 * so dispatch assertions can probe each branch.
 */
function buildRouter(activeProvider: AiProvider): {
  router: MultiProviderAiCompletionAdapter;
  anthropic: AiCompletionPort & { complete: jest.Mock };
  openai: AiCompletionPort & { complete: jest.Mock };
  fake: AiCompletionPort & { complete: jest.Mock };
  activeSettings: jest.Mocked<IAiProviderActiveSettingsService>;
} {
  const anthropic = buildAdapterStub('A');
  const openai = buildAdapterStub('O');
  const fake = buildAdapterStub('F');
  const activeSettings = buildActiveSettings(activeProvider);
  const router = new MultiProviderAiCompletionAdapter(activeSettings);
  router.register('anthropic', anthropic);
  router.register('openai', openai);
  router.register('fake', fake);
  return { router, anthropic, openai, fake, activeSettings };
}

describe('MultiProviderAiCompletionAdapter', () => {
  describe('register', () => {
    it('accepts a per-provider adapter and dispatches to it on complete()', async () => {
      const adapter = buildAdapterStub('X');
      const activeSettings = buildActiveSettings('anthropic');
      const router = new MultiProviderAiCompletionAdapter(activeSettings);

      router.register('anthropic', adapter);
      const result = await router.complete(sampleInput);

      expect(result.text).toBe('X');
      expect(adapter.complete).toHaveBeenCalledWith(sampleInput);
    });

    it('throws DuplicateAiProviderError when the same provider is registered twice', () => {
      const router = new MultiProviderAiCompletionAdapter(buildActiveSettings('anthropic'));

      router.register('anthropic', buildAdapterStub('A1'));

      expect(() => router.register('anthropic', buildAdapterStub('A2'))).toThrow(
        DuplicateAiProviderError,
      );
    });

    it('allows registering different providers independently', () => {
      const router = new MultiProviderAiCompletionAdapter(buildActiveSettings('anthropic'));

      expect(() => {
        router.register('anthropic', buildAdapterStub('A'));
        router.register('openai', buildAdapterStub('O'));
        router.register('fake', buildAdapterStub('F'));
      }).not.toThrow();
    });
  });

  describe('complete', () => {
    it('routes to the anthropic adapter when active=anthropic', async () => {
      const { router, anthropic, openai, fake } = buildRouter('anthropic');

      const result = await router.complete(sampleInput);

      expect(result.text).toBe('A');
      expect(anthropic.complete).toHaveBeenCalledWith(sampleInput);
      expect(openai.complete).not.toHaveBeenCalled();
      expect(fake.complete).not.toHaveBeenCalled();
    });

    it('routes to the openai adapter when active=openai', async () => {
      const { router, openai } = buildRouter('openai');

      const result = await router.complete(sampleInput);

      expect(result.text).toBe('O');
      expect(openai.complete).toHaveBeenCalledWith(sampleInput);
    });

    it('routes to the fake adapter when active=fake', async () => {
      const { router, fake } = buildRouter('fake');

      const result = await router.complete(sampleInput);

      expect(result.text).toBe('F');
      expect(fake.complete).toHaveBeenCalledWith(sampleInput);
    });

    it('reads the active provider on every call (no cache)', async () => {
      const { router, anthropic, openai, activeSettings } = buildRouter('anthropic');

      await router.complete(sampleInput);
      activeSettings.getActive.mockResolvedValueOnce('openai');
      await router.complete(sampleInput);

      expect(activeSettings.getActive).toHaveBeenCalledTimes(2);
      expect(anthropic.complete).toHaveBeenCalledTimes(1);
      expect(openai.complete).toHaveBeenCalledTimes(1);
    });

    it('throws AiCompletionError if the active-settings service returns an unregistered provider', async () => {
      const { router, activeSettings } = buildRouter('anthropic');
      activeSettings.getActive.mockResolvedValueOnce('cohere' as AiProvider);

      await expect(router.complete(sampleInput)).rejects.toBeInstanceOf(AiCompletionError);
    });

    it('throws AiCompletionError if no providers are registered yet', async () => {
      const router = new MultiProviderAiCompletionAdapter(buildActiveSettings('anthropic'));

      await expect(router.complete(sampleInput)).rejects.toBeInstanceOf(AiCompletionError);
    });
  });
});
