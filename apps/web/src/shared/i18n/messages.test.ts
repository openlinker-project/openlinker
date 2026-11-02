/**
 * Messages registry - unit tests
 *
 * Covers the plugin namespace path end to end: base language without a load,
 * the translation after `loadMessages`, per-key fallback, plural forms and
 * the refusal to register a namespace twice.
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { definePluginMessages } from './define-plugin-messages';
import { isMessagesLoaded, loadMessages, namespaceFor } from './messages';
import { setActiveLocale } from './active-locale';

const english = {
  title: 'Orders',
  subtitle: 'Orders from every connected sales channel.',
  attention: { one: '{n} order needs attention', other: '{n} orders need attention' },
};

const polish = {
  title: 'Zamówienia',
  attention: {
    one: '{n} zamówienie wymaga uwagi',
    few: '{n} zamówienia wymagają uwagi',
    many: '{n} zamówień wymaga uwagi',
    other: '{n} zamówienia wymaga uwagi',
  },
};

const sample = definePluginMessages('test-orders', {
  messages: english,
  loaders: { pl: () => Promise.resolve(polish) },
});

describe('messages registry', () => {
  it('should return the base language when the translation is not loaded yet', () => {
    expect((namespaceFor('pl', 'test-orders') as typeof english).title).toBe('Orders');
  });

  it('should return the translation once the language is loaded', async () => {
    await loadMessages('pl');
    expect(isMessagesLoaded('pl')).toBe(true);
    setActiveLocale('pl');
    expect(sample.getMessages().title).toBe('Zamówienia');
    setActiveLocale('en');
  });

  it('should fall back to the base language per key when a translation is missing', async () => {
    await loadMessages('pl');
    setActiveLocale('pl');
    expect(sample.getMessages().subtitle).toBe('Orders from every connected sales channel.');
    setActiveLocale('en');
  });

  it('should carry the Polish-only plural categories when the locale is pl', async () => {
    await loadMessages('pl');
    setActiveLocale('pl');
    expect(sample.getMessages().attention.few).toBe('{n} zamówienia wymagają uwagi');
    setActiveLocale('en');
  });

  it('should return the same object across reads so it is stable as a dependency', async () => {
    await loadMessages('pl');
    expect(namespaceFor('pl', 'test-orders')).toBe(namespaceFor('pl', 'test-orders'));
  });

  it('should throw when a namespace is registered twice', () => {
    expect(() => definePluginMessages('test-orders', { messages: english })).toThrow(
      'already registered',
    );
  });

  it('should throw when an unknown namespace is read', () => {
    expect(() => namespaceFor('en', 'no-such-namespace')).toThrow('is not registered');
  });
});
