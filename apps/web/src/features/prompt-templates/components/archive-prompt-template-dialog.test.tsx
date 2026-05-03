/**
 * ArchivePromptTemplateDialog — Component Tests
 *
 * Covers state-aware rendering (draft vs published), force-checkbox gating,
 * archive call shape, 409 surface, and the conditional toast message
 * (Suggestion 4 from the plan tech-review).
 *
 * @module apps/web/src/features/prompt-templates/components
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createMockApiClient, findToastTitle, renderWithProviders } from '../../../test/test-utils';
import { ArchivePromptTemplateDialog } from './archive-prompt-template-dialog';
import type { PromptTemplateSummary } from '../api/prompt-templates.types';

function makeRow(overrides: Partial<PromptTemplateSummary> = {}): PromptTemplateSummary {
  return {
    key: overrides.key ?? 'offer.description.suggest',
    channel: overrides.channel !== undefined ? overrides.channel : 'allegro',
    latestVersion: overrides.latestVersion ?? 2,
    latestId: overrides.latestId ?? 'tmpl-2',
    latestState: overrides.latestState ?? 'draft',
    publishedVersion: overrides.publishedVersion ?? null,
    publishedId: overrides.publishedId ?? null,
    hasDraft: overrides.hasDraft ?? true,
    updatedAt: overrides.updatedAt ?? '2026-04-22T10:00:00.000Z',
  };
}

describe('ArchivePromptTemplateDialog', () => {
  it('does not render the force checkbox for a draft target', () => {
    const client = createMockApiClient();
    renderWithProviders(
      <ArchivePromptTemplateDialog row={makeRow({ latestState: 'draft' })} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );
    expect(
      screen.queryByRole('checkbox', { name: /this is the only published version/i }),
    ).not.toBeInTheDocument();
  });

  it('archives a draft without sending force', async () => {
    const archive = vi.fn().mockResolvedValue(makeRow({ latestState: 'archived' }));
    const onOpenChange = vi.fn();
    const client = createMockApiClient({ promptTemplates: { archive } });
    renderWithProviders(
      <ArchivePromptTemplateDialog
        row={makeRow({ latestId: 'tmpl-2', latestState: 'draft' })}
        onOpenChange={onOpenChange}
      />,
      { apiClient: client },
    );
    fireEvent.click(screen.getByRole('button', { name: /^archive(\s+published)?\s+v\d+(\s+\(force\))?$/i }));
    await waitFor(() => {
      expect(archive).toHaveBeenCalledWith('tmpl-2', undefined);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables the Archive button on a published target until force is checked', () => {
    const client = createMockApiClient();
    renderWithProviders(
      <ArchivePromptTemplateDialog
        row={makeRow({ latestState: 'published', publishedVersion: 2, publishedId: 'tmpl-2', hasDraft: false })}
        onOpenChange={vi.fn()}
      />,
      { apiClient: client },
    );
    const archiveButton = screen.getByRole('button', { name: /^archive(\s+published)?\s+v\d+(\s+\(force\))?$/i });
    expect(archiveButton).toBeDisabled();

    const forceCheckbox = screen.getByRole('checkbox', { name: /this is the only published version/i });
    fireEvent.click(forceCheckbox);
    expect(archiveButton).not.toBeDisabled();
  });

  it('archives a published target with force=true when the checkbox is on', async () => {
    const archive = vi.fn().mockResolvedValue(makeRow({ latestState: 'archived' }));
    const client = createMockApiClient({ promptTemplates: { archive } });
    renderWithProviders(
      <ArchivePromptTemplateDialog
        row={makeRow({
          latestId: 'tmpl-2',
          latestState: 'published',
          publishedVersion: 2,
          publishedId: 'tmpl-2',
          hasDraft: false,
        })}
        onOpenChange={vi.fn()}
      />,
      { apiClient: client },
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /this is the only published version/i }));
    fireEvent.click(screen.getByRole('button', { name: /^archive(\s+published)?\s+v\d+(\s+\(force\))?$/i }));
    await waitFor(() => {
      expect(archive).toHaveBeenCalledWith('tmpl-2', { force: true });
    });
  });

  it('shows an inline error and stays open when the API rejects with 409', async () => {
    const archive = vi
      .fn()
      .mockRejectedValue(new Error('Cannot archive published template — pass force.'));
    const onOpenChange = vi.fn();
    const client = createMockApiClient({ promptTemplates: { archive } });
    renderWithProviders(
      <ArchivePromptTemplateDialog
        row={makeRow({ latestState: 'draft' })}
        onOpenChange={onOpenChange}
      />,
      { apiClient: client },
    );
    fireEvent.click(screen.getByRole('button', { name: /^archive(\s+published)?\s+v\d+(\s+\(force\))?$/i }));
    expect(await screen.findByText(/cannot archive published template/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('hints about the still-active published version in the success toast (Suggestion 4)', async () => {
    const archive = vi.fn().mockResolvedValue(makeRow({ latestState: 'archived' }));
    const client = createMockApiClient({ promptTemplates: { archive } });
    renderWithProviders(
      <ArchivePromptTemplateDialog
        row={makeRow({
          latestId: 'tmpl-2',
          latestState: 'draft',
          publishedVersion: 1,
          publishedId: 'tmpl-1',
          hasDraft: true,
        })}
        onOpenChange={vi.fn()}
      />,
      { apiClient: client },
    );
    fireEvent.click(screen.getByRole('button', { name: /^archive(\s+published)?\s+v\d+(\s+\(force\))?$/i }));
    expect(await findToastTitle(/archived v2/i)).toBeInTheDocument();
    expect(screen.getByText(/published v1 is still active/i)).toBeInTheDocument();
  });
});
