/**
 * Prompt Templates List Page — Component Tests
 *
 * @module apps/web/src/pages/prompt-templates
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
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
    const rowLabel = await screen.findByText('offer.description.suggest');
    // Channel cell uses the registered plugin's `displayName` (#580). The
    // toolbar `<Select>` also lists "Allegro" as a filter option, so scope
    // the assertion to the data row.
    const rowEl = rowLabel.closest('tr') ?? rowLabel.closest('li');
    if (rowEl === null) throw new Error('row container not found');
    expect(within(rowEl as HTMLElement).getByText('Allegro')).toBeInTheDocument();
  });

  it('humanises an unknown channel string when no plugin is registered (#580)', async () => {
    const futureRow: PromptTemplateSummary = {
      ...sample,
      // 'shopify' is open-world per #580 — backend-registered but no FE
      // plugin manifest yet. The cell should fall back to a humanised label
      // ("Shopify") instead of leaving the badge blank or crashing.
      channel: 'shopify',
    };
    const client = createMockApiClient({
      promptTemplates: { list: vi.fn().mockResolvedValue([futureRow]) },
    });
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: adminAdapter,
    });
    const rowLabel = await screen.findByText('offer.description.suggest');
    const rowEl = rowLabel.closest('tr') ?? rowLabel.closest('li');
    if (rowEl === null) throw new Error('row container not found');
    expect(within(rowEl as HTMLElement).getByText('Shopify')).toBeInTheDocument();
  });

  it('renders the master sentinel as the "master" label (#580)', async () => {
    const masterRow: PromptTemplateSummary = {
      ...sample,
      key: 'offer.shared.suggest',
      channel: null,
    };
    const client = createMockApiClient({
      promptTemplates: { list: vi.fn().mockResolvedValue([masterRow]) },
    });
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: adminAdapter,
    });
    const rowLabel = await screen.findByText('offer.shared.suggest');
    const rowEl = rowLabel.closest('tr') ?? rowLabel.closest('li');
    if (rowEl === null) throw new Error('row container not found');
    // Toolbar select also has a "Master (generic)" option label; scope to row.
    expect(within(rowEl as HTMLElement).getByText('master')).toBeInTheDocument();
  });

  it('blocks non-admin sessions with an inline message', async () => {
    const client = createMockApiClient();
    renderWithProviders(<PromptTemplatesListPage />, {
      apiClient: client,
      sessionAdapter: viewerAdapter,
    });
    expect(await screen.findByText(/Admin role required/i)).toBeInTheDocument();
  });

  describe('New template button (#488)', () => {
    it('renders the New template button for admins', async () => {
      const client = createMockApiClient({
        promptTemplates: { list: vi.fn().mockResolvedValue([sample]) },
      });
      renderWithProviders(<PromptTemplatesListPage />, {
        apiClient: client,
        sessionAdapter: adminAdapter,
      });
      expect(await screen.findByRole('button', { name: /new template/i })).toBeInTheDocument();
    });

    it('opens the new-template dialog when clicked', async () => {
      const client = createMockApiClient({
        promptTemplates: { list: vi.fn().mockResolvedValue([sample]) },
      });
      renderWithProviders(<PromptTemplatesListPage />, {
        apiClient: client,
        sessionAdapter: adminAdapter,
      });
      fireEvent.click(await screen.findByRole('button', { name: /new template/i }));
      expect(
        await screen.findByRole('heading', { name: /new prompt template/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Status filter (#489)', () => {
    const fullyArchivedRow: PromptTemplateSummary = {
      key: 'product.experiment.suggest',
      channel: null,
      latestVersion: 1,
      latestId: 'tmpl-archived',
      latestState: 'archived',
      publishedVersion: null,
      publishedId: null,
      hasDraft: false,
      updatedAt: new Date('2026-04-19T10:00:00Z').toISOString(),
    };

    it('hides fully-archived rows by default (Active filter)', async () => {
      const client = createMockApiClient({
        promptTemplates: { list: vi.fn().mockResolvedValue([sample, fullyArchivedRow]) },
      });
      renderWithProviders(<PromptTemplatesListPage />, {
        apiClient: client,
        sessionAdapter: adminAdapter,
      });
      expect(await screen.findByText('offer.description.suggest')).toBeInTheDocument();
      expect(screen.queryByText('product.experiment.suggest')).not.toBeInTheDocument();
    });

    it('shows fully-archived rows when filter switches to Archived', async () => {
      const client = createMockApiClient({
        promptTemplates: { list: vi.fn().mockResolvedValue([sample, fullyArchivedRow]) },
      });
      renderWithProviders(<PromptTemplatesListPage />, {
        apiClient: client,
        sessionAdapter: adminAdapter,
      });
      // Wait for table render before flipping the filter.
      await screen.findByText('offer.description.suggest');
      const statusFilter = screen.getByLabelText(/status/i);
      fireEvent.change(statusFilter, { target: { value: 'archived' } });
      expect(await screen.findByText('product.experiment.suggest')).toBeInTheDocument();
      expect(screen.queryByText('offer.description.suggest')).not.toBeInTheDocument();
    });
  });

  describe('Archive button (#489)', () => {
    it('renders an Archive button for non-archived rows', async () => {
      const client = createMockApiClient({
        promptTemplates: { list: vi.fn().mockResolvedValue([sample]) },
      });
      renderWithProviders(<PromptTemplatesListPage />, {
        apiClient: client,
        sessionAdapter: adminAdapter,
      });
      const row = await screen.findByText('offer.description.suggest');
      const rowEl = row.closest('tr') ?? row.closest('li');
      if (rowEl === null) throw new Error('row container not found');
      expect(within(rowEl as HTMLElement).getByRole('button', { name: /archive/i })).toBeInTheDocument();
    });

    it('opens the archive dialog without navigating to detail when clicked', async () => {
      const client = createMockApiClient({
        promptTemplates: { list: vi.fn().mockResolvedValue([sample]) },
      });
      renderWithProviders(<PromptTemplatesListPage />, {
        apiClient: client,
        sessionAdapter: adminAdapter,
      });
      const archiveButton = await screen.findByRole('button', { name: /archive/i });
      fireEvent.click(archiveButton);
      // Dialog title contains "Archive vN".
      expect(await screen.findByRole('heading', { name: /archive v2/i })).toBeInTheDocument();
    });
  });
});
