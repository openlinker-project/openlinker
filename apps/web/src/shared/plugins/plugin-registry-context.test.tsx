/**
 * Plugin Registry Context Tests
 *
 * Smoke coverage for the registry contract — provider missing throws, lookups
 * hit/miss as expected. Specific plugin behavior is covered in feature-level
 * tests (`platform-picker.test.tsx`, `ConnectionActionsPanel.test.tsx`).
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PluginRegistryProvider } from './plugin-registry-context';
import { usePlatform } from './use-platform';
import { usePlatforms } from './use-platforms';
import type { OpenLinkerPlugin } from './plugin.types';

function PluginsCount(): ReactElement {
  const plugins = usePlatforms();
  return <span data-testid="count">{plugins.length}</span>;
}

function PluginByKey({ platformType }: { platformType: string }): ReactElement {
  const plugin = usePlatform(platformType);
  return <span data-testid="display">{plugin?.displayName ?? 'NONE'}</span>;
}

const fixturePlugins: OpenLinkerPlugin[] = [
  { id: 'foo', platformType: 'foo', platform: { displayName: 'Foo' } },
  { id: 'bar', platformType: 'bar', platform: { displayName: 'Bar' } },
];

describe('PluginRegistryContext', () => {
  it('exposes the plugin manifest via usePlatforms()', () => {
    const { getByTestId } = render(
      <PluginRegistryProvider plugins={fixturePlugins}>
        <PluginsCount />
      </PluginRegistryProvider>,
    );
    expect(getByTestId('count').textContent).toBe('2');
  });

  it('returns the matching plugin for a known platformType', () => {
    const { getByTestId } = render(
      <PluginRegistryProvider plugins={fixturePlugins}>
        <PluginByKey platformType="bar" />
      </PluginRegistryProvider>,
    );
    expect(getByTestId('display').textContent).toBe('Bar');
  });

  it('returns undefined for an unknown platformType', () => {
    const { getByTestId } = render(
      <PluginRegistryProvider plugins={fixturePlugins}>
        <PluginByKey platformType="shopify" />
      </PluginRegistryProvider>,
    );
    expect(getByTestId('display').textContent).toBe('NONE');
  });

  it('returns undefined when platformType is an empty string', () => {
    const { getByTestId } = render(
      <PluginRegistryProvider plugins={fixturePlugins}>
        <PluginByKey platformType="" />
      </PluginRegistryProvider>,
    );
    expect(getByTestId('display').textContent).toBe('NONE');
  });

  it('throws when usePlatforms() is used outside the provider', () => {
    const ConsumerSansProvider = (): ReactElement => <PluginsCount />;
    // React swallows render-phase errors and surfaces them via error boundary
    // or the global error handler. We assert by silencing console.error and
    // catching the thrown error from render().
    const originalError = console.error;
    console.error = (): void => {};
    try {
      expect(() => render(<ConsumerSansProvider />)).toThrow(
        /usePlatforms\(\) must be used inside <PluginRegistryProvider>/,
      );
    } finally {
      console.error = originalError;
    }
  });
});
