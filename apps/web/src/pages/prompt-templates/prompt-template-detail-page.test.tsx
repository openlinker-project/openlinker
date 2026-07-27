/**
 * Prompt Template Detail Page — Component Tests
 *
 * @module apps/web/src/pages/prompt-templates
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { PromptTemplateDetailPage } from './prompt-template-detail-page';
import type { PromptTemplate } from '../../features/prompt-templates/api/prompt-templates.types';

const adminAdapter = createAuthenticatedSessionAdapter({
  id: 'u1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: [],
  analyticsConsent: true,
});

const viewerAdapter = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
  analyticsConsent: true,
});

function template(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: 'tmpl-1',
    key: 'offer.description.suggest',
    channel: 'allegro',
    version: 1,
    systemPrompt: 'System {{product.name}}',
    userPromptTemplate: 'User {{product.name}}',
    variables: [{ name: 'product.name', type: 'string', required: true }],
    state: 'draft',
    publishedAt: null,
    createdBy: 'admin',
    createdAt: new Date('2026-04-22T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-04-22T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function renderPage(
  apiOverrides: Parameters<typeof createMockApiClient>[0] = {},
  sessionAdapter = adminAdapter,
): ReturnType<typeof renderWithProviders> {
  const apiClient = createMockApiClient(apiOverrides);
  return renderWithProviders(
    <Routes>
      <Route path="/ai/prompt-templates/:id" element={<PromptTemplateDetailPage />} />
    </Routes>,
    {
      apiClient,
      route: '/ai/prompt-templates/tmpl-1',
      sessionAdapter,
    },
  );
}

describe('PromptTemplateDetailPage', () => {
  it('renders loading state', () => {
    renderPage({
      promptTemplates: {
        get: vi.fn<() => Promise<PromptTemplate>>(() => new Promise(() => {})),
      },
    });
    expect(screen.getByText(/Loading prompt template/i)).toBeInTheDocument();
  });

  it('renders error state with retry button', async () => {
    renderPage({
      promptTemplates: { get: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    expect(await screen.findByText(/Unable to load prompt template/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows the state-appropriate actions for a draft', async () => {
    renderPage({
      promptTemplates: {
        get: vi.fn().mockResolvedValue(template()),
        getVersions: vi.fn().mockResolvedValue([template()]),
      },
    });
    expect(await screen.findByRole('button', { name: /Publish v1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Discard draft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save draft/i })).toBeInTheDocument();
  });

  it('shows "New draft from this version" for a published row', async () => {
    renderPage({
      promptTemplates: {
        get: vi.fn().mockResolvedValue(template({ state: 'published' })),
        getVersions: vi.fn().mockResolvedValue([template({ state: 'published' })]),
      },
    });
    expect(
      await screen.findByRole('button', { name: /New draft from this version/i }),
    ).toBeInTheDocument();
  });

  it('blocks viewer sessions with an inline error', async () => {
    renderPage(
      {
        promptTemplates: {
          get: vi.fn().mockResolvedValue(template()),
          getVersions: vi.fn().mockResolvedValue([]),
        },
      },
      viewerAdapter,
    );
    expect(await screen.findByText(/Admin role required/i)).toBeInTheDocument();
  });

  it('opens the confirmation dialog when publish is clicked', async () => {
    renderPage({
      promptTemplates: {
        get: vi.fn().mockResolvedValue(template()),
        getVersions: vi.fn().mockResolvedValue([template()]),
      },
    });

    const user = userEvent.setup();
    const publishBtn = await screen.findByRole('button', { name: /Publish v1/i });
    await user.click(publishBtn);

    // Dialog opens with its heading; the dialog question mark differentiates it
    // from the action-cluster button label.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Publish v1\?/i })).toBeInTheDocument();
    });
  });
});
