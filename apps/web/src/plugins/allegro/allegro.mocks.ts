/**
 * Allegro plugin — test-only mock defaults
 *
 * Mock factories that `createMockApiClient` folds into the test ApiClient when
 * a test doesn't override the `allegro` namespace. Co-located with the plugin
 * so plugin-owning teams (and third-party plugin authors following the same
 * convention) edit one folder, not the host's `test-utils.tsx`.
 *
 * Test-only by file naming (`*.mocks.ts`): not exported from `plugins/allegro/index.ts`
 * and never imported by production code. Vite's prod bundle never reaches this
 * file, keeping `vitest`'s `vi` out of the prod import graph.
 *
 * @module plugins/allegro
 */
import { vi } from 'vitest';

import type { PluginApiNamespaces } from '../../app/api/api-client';
import type { AllegroApi } from '../../features/allegro';

export function allegroMockApiNamespaces(): Partial<PluginApiNamespaces> {
  return {
    allegro: {
      startOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://example.com/oauth',
        state: 'state',
      }),
      handleCallback: vi.fn().mockResolvedValue({
        message: 'OAuth callback processed successfully. Connection created.',
        connectionId: 'conn_allegro_1',
        connectionName: 'Allegro sandbox',
      }),
      listResponsibleProducers: vi.fn().mockResolvedValue([]),
      uploadSafetyAttachment: vi.fn().mockResolvedValue({
        id: 'safety-attachment-1',
        fileName: 'safety.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0,
      }),
    } satisfies AllegroApi,
  };
}
