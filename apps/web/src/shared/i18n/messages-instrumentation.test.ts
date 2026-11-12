/**
 * Messages registry with the inspector's instrumentation (#4017) - unit tests
 *
 * In its own file because installing instrumentation changes the registry's
 * module state for every later test in the same file.
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { definePluginMessages } from './define-plugin-messages';
import { installMessagesInstrumentation, loadMessages, namespaceFor } from './messages';
import { markerIdsIn, stripMarkers } from './missing-inspector/markers';
import { createReadTracker } from './missing-inspector/read-tracker';
import { createFallbackRegistry } from './missing-inspector/registry';

definePluginMessages('test-instrumented', {
  messages: { title: 'Orders', subtitle: 'Every channel' },
  loaders: { pl: () => Promise.resolve({ title: 'Zamówienia' }) },
});
definePluginMessages('test-untranslated', { messages: { title: 'Returns' } });

describe('messages instrumentation', () => {
  it('should tag fallbacks, including namespaces without a translation, and record reads', async () => {
    const registry = createFallbackRegistry();
    const tracker = createReadTracker();
    installMessagesInstrumentation({ tagger: registry, wrap: tracker.wrap });
    await loadMessages('pl');

    const translated = namespaceFor('pl', 'test-instrumented') as { title: string; subtitle: string };
    expect(translated.title).toBe('Zamówienia');
    expect(stripMarkers(translated.subtitle)).toBe('Every channel');
    const [id] = markerIdsIn(translated.subtitle);
    expect(registry.get(id ?? -1)?.keyPath).toBe('subtitle');
    expect(tracker.reads.has(id ?? -1)).toBe(true);

    const untranslated = namespaceFor('pl', 'test-untranslated') as { title: string };
    expect(markerIdsIn(untranslated.title)).toHaveLength(1);
  });

  it('should never tag English', () => {
    const english = namespaceFor('en', 'test-instrumented') as { subtitle: string };
    expect(english.subtitle).toBe('Every channel');
  });
});
