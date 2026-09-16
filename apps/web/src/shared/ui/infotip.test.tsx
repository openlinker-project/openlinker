import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Infotip, type InfotipDefinition } from './infotip';

const DEFINITIONS: InfotipDefinition[] = [
  { term: 'What this is', text: 'A slot on your own device.' },
  {
    term: 'Why it is risky',
    text: 'A wrong slot registers a wrong rate.',
    caveat: 'A receipt cannot be recalled.',
  },
  {
    term: 'The formula',
    text: 'Net divided by the rate fraction.',
    formula: 'gross / (1 + rate)',
  },
];

describe('Infotip', () => {
  afterEach(cleanup);

  it('should render only the trigger before it is opened', () => {
    render(<Infotip ariaLabel="What this does" definitions={DEFINITIONS} />);
    expect(screen.getByRole('button', { name: 'What this does' })).toBeInTheDocument();
    expect(screen.queryByText('A slot on your own device.')).not.toBeInTheDocument();
  });

  it('should open the popover on click and render every definition', async () => {
    const user = userEvent.setup();
    render(<Infotip ariaLabel="What this does" definitions={DEFINITIONS} />);

    await user.click(screen.getByRole('button', { name: 'What this does' }));

    expect(screen.getByText('What this is')).toBeInTheDocument();
    expect(screen.getByText('A slot on your own device.')).toBeInTheDocument();
    expect(screen.getByText('Why it is risky')).toBeInTheDocument();
    expect(screen.getByText('A wrong slot registers a wrong rate.')).toBeInTheDocument();
    expect(screen.getByText('A receipt cannot be recalled.')).toBeInTheDocument();
    expect(screen.getByText('gross / (1 + rate)')).toBeInTheDocument();
  });

  it('should not render an absent formula or caveat', async () => {
    const user = userEvent.setup();
    render(<Infotip ariaLabel="What this does" definitions={DEFINITIONS} />);

    await user.click(screen.getByRole('button', { name: 'What this does' }));

    // The first definition carries neither — nothing should render for it.
    const firstDef = screen.getByText('A slot on your own device.').closest('.infotip-def');
    expect(firstDef?.querySelector('.infotip-def__formula')).toBeNull();
    expect(firstDef?.querySelector('.infotip-def__caveat')).toBeNull();
  });

  it('should name the popover with the same label as the trigger', async () => {
    // Radix renders `role="dialog"` on the content; an unnamed dialog is an
    // axe `aria-dialog-name` failure. One `ariaLabel` names both, because the
    // trigger's label already says what the panel contains.
    const user = userEvent.setup();
    render(<Infotip ariaLabel="What this does" definitions={DEFINITIONS} />);

    await user.click(screen.getByRole('button', { name: 'What this does' }));

    expect(screen.getByRole('dialog', { name: 'What this does' })).toBeInTheDocument();
  });
});
