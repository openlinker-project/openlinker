/**
 * allegroPlugin smoke test
 *
 * Asserts the plugin's static surface (id, routes, apiNamespaces factory
 * shape). The behavior of `createAllegroApi` is covered by feature tests.
 *
 * @module plugins/allegro
 */
import { describe, expect, it, vi } from 'vitest';

import type { ApiRequest } from '../../app/api/api-client';

import { allegroPlugin } from './index';

describe('allegroPlugin', () => {
  it('has the stable kebab-case id', () => {
    expect(allegroPlugin.id).toBe('allegro');
  });

  it('contributes the OAuth callback and setup routes', () => {
    const paths = (allegroPlugin.routes ?? []).map((route) => route.path);
    expect(paths).toContain('integrations/allegro/connect/callback');
    expect(paths).toContain('connections/new/allegro');
  });

  it('contributes the `allegro` API namespace when its factory is called', () => {
    const stubRequest: ApiRequest = vi.fn();
    const namespaces = allegroPlugin.apiNamespaces?.(stubRequest);
    expect(namespaces).toBeDefined();
    expect(namespaces && 'allegro' in namespaces).toBe(true);
  });
});
