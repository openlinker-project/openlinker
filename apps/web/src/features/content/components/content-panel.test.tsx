/** @vitest-environment jsdom */
/**
 * Content Panel — Unit Tests
 *
 * Covers the presentational rules that would otherwise be smoke-tested only
 * through the parent editor: button-enablement logic (Save/Discard/Publish),
 * the read-only gate for non-desktop viewports, and the conflict banner.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MASTER_DESCRIPTION_FORMAT } from '../../../shared/ui';
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
    // ADR-046: the panel now edits through `RichTextEditor`, which derives its
    // surface from the destination's contract. The master format is the right
    // default here - the panel's own tests are about save/discard/publish
    // gating, not about which controls a channel offers.
    format: MASTER_DESCRIPTION_FORMAT,
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

  // The two "after the user types" cases that used to live here are gone, not
  // relaxed. ProseMirror needs real browser input events, and `userEvent.type`
  // inserts NOTHING into it under either jsdom or happy-dom - probed directly:
  // typing five characters produced a single `<p></p>` from the selection change
  // and no text. A test that types and then asserts a gate would be asserting
  // the absence of typing. Both intents move to #2201's browser E2E, where a
  // real keystroke exists; what stays here is the half that is reachable and
  // still catches a regression in the gating logic itself.
  it('keeps Save disabled while the buffer matches what is persisted', () => {
    renderPanel({ baseValue: 'published', draftValue: null });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
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
    // The editor surface is a contenteditable, not a textarea, so read-only is
    // expressed as `contenteditable="false"` rather than a `readonly` attribute.
    expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('seeds the editor from the persisted draft rather than the base value', () => {
    // What the operator sees when they open a product with a pending draft. The
    // "Save sends the edited buffer" half is unreachable without typing and lives
    // in #2201's E2E - naming this test after what it actually proves rather than
    // after the flow it belongs to.
    renderPanel({ baseValue: '<p>published copy</p>', draftValue: '<p>pending copy</p>' });

    expect(screen.getByRole('textbox')).toHaveTextContent('pending copy');
    expect(screen.getByRole('textbox')).not.toHaveTextContent('published copy');
  });

  it('falls back to the base value when there is no draft', () => {
    renderPanel({ baseValue: '<p>published copy</p>', draftValue: null });

    expect(screen.getByRole('textbox')).toHaveTextContent('published copy');
  });

  it('invokes onPublish when Publish is clicked on a clean draft', async () => {
    const { onPublish } = renderPanel({ baseValue: null, draftValue: 'clean draft' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('should block Save when the draft exceeds the destination byte cap', async () => {
    // The byte counter used to be decorative: nothing gated on it, so an operator
    // could save and publish a description the platform then rejected with a 422.
    renderPanel({
      format: { ...MASTER_DESCRIPTION_FORMAT, maxBytes: 10 },
      baseValue: 'x'.repeat(50),
      draftValue: null,
    });

    expect(await screen.findByText(/longer than the destination accepts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});
