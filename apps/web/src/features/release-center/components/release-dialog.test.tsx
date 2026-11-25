import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseStepRow } from '../lib/release-dialog-content';
import { ReleaseDialog } from './release-dialog';

const row: ReleaseStepRow = {
  key: 'packing-owner:c1',
  step: {
    id: 'packing-owner',
    scope: 'connection',
    introducedIn: '0.20.0',
    importance: () => 'optional',
    requires: 'connections:write',
    routePattern: 'connections/:connectionId/edit',
    routeParams: () => ({}),
    target: 'pack-check',
    appliesWhen: () => true,
    completeOn: { mutationKey: ['x'], when: () => true },
  },
  connection: { id: 'c1', name: 'Shop A' },
  itemKey: 'packing-owner:c1',
  importance: 'optional',
  done: false,
};

function Harness({ canWriteSteps }: { canWriteSteps: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <ReleaseDialog
        open={open}
        version="0.20.0"
        date={null}
        highlights={[{ scope: 'web', text: 'A change', refs: [], commits: [] }]}
        overflow={3}
        rows={[row]}
        canWriteSteps={canWriteSteps}
        onClose={() => setOpen(false)}
        onFullChangelog={vi.fn()}
        onStartGuide={vi.fn()}
      />
    </>
  );
}

describe('ReleaseDialog', () => {
  it('should restore focus to the opener when closed', async () => {
    const user = userEvent.setup();
    render(<Harness canWriteSteps />);
    const opener = screen.getByText('opener');
    await user.click(opener);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('should keep focus inside the dialog when tabbing', async () => {
    const user = userEvent.setup();
    render(<Harness canWriteSteps />);
    await user.click(screen.getByText('opener'));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('should show the skip option only on the changelog step', async () => {
    const user = userEvent.setup();
    render(<Harness canWriteSteps />);
    await user.click(screen.getByText('opener'));
    expect(await screen.findByLabelText("Don't show the changes dialog after future updates")).toBeInTheDocument();
    await user.click(screen.getByText('Go to the guide'));
    expect(screen.queryByLabelText("Don't show the changes dialog after future updates")).toBeNull();
  });

  describe('size between steps', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      MotionGlobalConfig.skipAnimations = false;
    });

    it('should resize the body to the visible pane when the step changes', async () => {
      // Skipping the spring makes the settled height what is asserted.
      MotionGlobalConfig.skipAnimations = true;
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement
      ) {
        if (!this.classList.contains('release-dialog__pane')) return 0;
        return this.querySelector('.release-dialog__steplist') ? 480 : 300;
      });
      const user = userEvent.setup();
      render(<Harness canWriteSteps />);
      await user.click(screen.getByText('opener'));
      const dialog = await screen.findByRole('dialog');
      const body = dialog.querySelector<HTMLElement>('.release-dialog__body');
      await waitFor(() => expect(body?.style.height).toBe('300px'), { timeout: 3000 });
      await user.click(screen.getByText('Go to the guide'));
      await waitFor(() => expect(body?.style.height).toBe('480px'), { timeout: 3000 });
      await user.click(screen.getByLabelText('Back'));
      await waitFor(() => expect(body?.style.height).toBe('300px'), { timeout: 3000 });
    });
  });

  it('should say an administrator is needed and offer no write wording to a non-admin', async () => {
    const user = userEvent.setup();
    render(<Harness canWriteSteps={false} />);
    await user.click(screen.getByText('opener'));
    await user.click(await screen.findByText('Go to the guide'));
    expect(screen.getByText('Needs an administrator')).toBeInTheDocument();
    expect(screen.getByText('Show me where')).toBeInTheDocument();
    expect(screen.queryByText('Start guide')).toBeNull();
  });
});
