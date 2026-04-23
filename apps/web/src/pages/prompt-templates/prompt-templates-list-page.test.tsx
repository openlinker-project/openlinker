/**
 * Prompt Templates List Page — Component Tests
 *
 * @module apps/web/src/pages/prompt-templates
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { PromptTemplatesListPage } from './prompt-templates-list-page';
import type { PromptTemplateSummary } from '../../features/prompt-templates/api/prompt-templates.types';

const adminAdapter = createAuthenticatedSessionAdapter({
  id: 'u1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: [],
});

const viewerAdapter = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
});

const sample: PromptTemplateSummary = {
  key: 'offer.description.suggest',
  channel: 'allegro',
  latestVersion: 2,
  latestId: 'tmpl-2',
  latestState: 'draft',
  publishedVersion: 1,
  publishedId: 'tmpl-1',
  hasDraft: true,
  updatedAt: new Date('2026-04-21T10:00:00Z').toISOString(),
};

describe('PromptTemplatesListPage', () => {
  it('renders loading state', () => {
    const client = createMockApiClient({
      promptTemplates: {
        list: vi.fn<() => Promise<PromptTemplateSummary[]>>(() => new Promise(() => {})),
      },
    });
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: adminAdapter,
    });
    expect(screen.getByText(/Loading prompt templates/i)).toBeInTheDocument();
  });

  it('renders empty state when no rows', async () => {
    const client = createMockApiClient({
      promptTemplates: { list: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: adminAdapter,
    });
    expect(await screen.findByText(/No prompt templates yet/i)).toBeInTheDocument();
  });

  it('renders error state with retry affordance', async () => {
    const client = createMockApiClient({
      promptTemplates: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: adminAdapter,
    });
    expect(await screen.findByText(/Unable to load prompt templates/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders the summary row when data loads', async () => {
    const client = createMockApiClient({
      promptTemplates: { list: vi.fn().mockResolvedValue([sample]) },
    });
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: adminAdapter,
    });
    expect(await screen.findByText('offer.description.suggest')).toBeInTheDocument();
    expect(screen.getByText('allegro')).toBeInTheDocument();
  });

  it('blocks non-admin sessions with an inline message', async () => {
    const client = createMockApiClient();
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: viewerAdapter,
    });
    expect(await screen.findByText(/Admin role required/i)).toBeInTheDocument();
  });
});
