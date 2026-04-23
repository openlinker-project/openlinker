/**
 * Content Panel — Unit Tests
 *
 * Covers the presentational rules that would otherwise be smoke-tested only
 * through the parent editor: button-enablement logic (Save/Discard/Publish),
 * the read-only gate for non-desktop viewports, and the conflict banner.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPanel, type ContentPanelProps } from './content-panel';

function renderPanel(overrides: Partial<ContentPanelProps> = {}): {
  onSave: ReturnType<typeof vi.fn>;
  onDiscard: ReturnType<typeof vi.fn>;
  onPublish: ReturnType<typeof vi.fn>;
} {
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  const onPublish = vi.fn();

  const base: ContentPanelProps = {
    title: 'Master description',
    baseValue: null,
    draftValue: null,
    hasConflict: false,
    updatedAt: null,
    updatedBy: null,
    isDesktop: true,
    busy: false,
    onSave,
    onDiscard,
    onPublish,
  };

  render(<ContentPanel {...base} {...overrides} />);
  return { onSave, onDiscard, onPublish };
}

describe('ContentPanel', () => {
  afterEach(cleanup);

  it('disables Save when the buffer matches the persisted value', () => {
    renderPanel({ baseValue: 'published', draftValue: null });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  it('enables Save after the user types a different value', async () => {
    renderPanel({ baseValue: 'published', draftValue: null });
    const textarea = screen.getByRole('textbox');
    const user = userEvent.setup();
    await user.type(textarea, ' edited');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('disables Publish when the draft is dirty (must Save first)', async () => {
    renderPanel({ baseValue: null, draftValue: 'draft' });
    const textarea = screen.getByRole('textbox');
    const user = userEvent.setup();
    await user.type(textarea, ' more');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('enables Publish when a clean draft exists and there is no conflict', () => {
    renderPanel({ baseValue: null, draftValue: 'clean draft' });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('disables Publish when a conflict is flagged', () => {
    renderPanel({ baseValue: 'base', draftValue: 'draft', hasConflict: true });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText(/An external update was detected/)).toBeInTheDocument();
  });

  it('shows the desktop-only banner and forces read-only below 1024 px', () => {
    const { onSave } = renderPanel({
      isDesktop: false,
      baseValue: 'base',
      draftValue: 'draft',
    });
    expect(screen.getByText(/Editing available on desktop only/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('invokes onSave with the current buffer content', async () => {
    const { onSave } = renderPanel({ baseValue: '', draftValue: null });
    const textarea = screen.getByRole('textbox');
    const user = userEvent.setup();
    await user.type(textarea, 'hello');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onSave).toHaveBeenCalledWith('hello');
  });

  it('invokes onPublish when Publish is clicked on a clean draft', async () => {
    const { onPublish } = renderPanel({ baseValue: null, draftValue: 'clean draft' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
