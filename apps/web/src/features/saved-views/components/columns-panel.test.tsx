import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { testRegistry, type TestRow } from '../lib/saved-views.fixtures';
import { renderWithProviders } from '../../../test/test-utils';
import { ColumnsPanel, type ColumnsPanelProps } from './columns-panel';

function props(overrides: Partial<ColumnsPanelProps<TestRow>> = {}): ColumnsPanelProps<TestRow> {
  return {
    columns: testRegistry.columns,
    locked: testRegistry.locked,
    visibleIds: ['customer', 'total'],
    parts: {},
    sort: { key: 'created', dir: 'desc' },
    sortOptions: testRegistry.sorts,
    sortFallbackLabel: 'created, descending',
    showSavedForYouHint: false,
    onSortChange: vi.fn(),
    onColumnsChange: vi.fn(),
    onPartsChange: vi.fn(),
    onRestoreDefaults: vi.fn(),
    ...overrides,
  };
}

async function open(overrides: Partial<ColumnsPanelProps<TestRow>> = {}): Promise<ColumnsPanelProps<TestRow>> {
  const p = props(overrides);
  renderWithProviders(<ColumnsPanel {...p} />);
  await userEvent.click(screen.getByRole('button', { name: /Columns & sort/ }));
  await screen.findByRole('dialog');
  return p;
}

describe('ColumnsPanel', () => {
  it('should show the locked column, the visible ones and the hidden ones', async () => {
    await open();
    expect(screen.getByText('Always')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Stock/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Customer/ })).toBeChecked();
  });

  it('should move focus into the panel when it opens', async () => {
    await open();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('should hide a column when its checkbox is unticked', async () => {
    const p = await open();
    await userEvent.click(screen.getByRole('checkbox', { name: /Customer/ }));
    expect(p.onColumnsChange).toHaveBeenCalledWith(['total']);
  });

  it('should show a hidden column at the end when it is ticked', async () => {
    const p = await open();
    await userEvent.click(screen.getByRole('checkbox', { name: /Stock/ }));
    expect(p.onColumnsChange).toHaveBeenCalledWith(['customer', 'total', 'stock']);
  });

  describe('reordering', () => {
    it('should move a column down with its button', async () => {
      const p = await open();
      await userEvent.click(screen.getByRole('button', { name: 'Move Customer down' }));
      expect(p.onColumnsChange).toHaveBeenCalledWith(['total', 'customer']);
    });

    it('should move a column up with its button', async () => {
      const p = await open();
      await userEvent.click(screen.getByRole('button', { name: 'Move Total, payment, dates up' }));
      expect(p.onColumnsChange).toHaveBeenCalledWith(['total', 'customer']);
    });

    it('should disable up on the first column and down on the last', async () => {
      await open();
      expect(screen.getByRole('button', { name: 'Move Customer up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Total, payment, dates down' })).toBeDisabled();
    });

    it('should move a column with Arrow Down on its grip', async () => {
      const p = await open();
      screen.getByRole('button', { name: /Move Customer\. Drag/ }).focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(p.onColumnsChange).toHaveBeenCalledWith(['total', 'customer']);
    });

    it('should move a column with Arrow Up on its grip', async () => {
      const p = await open();
      screen.getByRole('button', { name: /Move Total, payment, dates\. Drag/ }).focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(p.onColumnsChange).toHaveBeenCalledWith(['total', 'customer']);
    });

    it('should ignore Arrow Up on the first column', async () => {
      const p = await open();
      screen.getByRole('button', { name: /Move Customer\. Drag/ }).focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(p.onColumnsChange).not.toHaveBeenCalled();
    });

    it('should announce a keyboard move, counting the locked column as the first', async () => {
      await open();
      screen.getByRole('button', { name: /Move Customer\. Drag/ }).focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('status')).toHaveTextContent('Customer moved to position 3 of 3.');
    });

    it('should reorder on a native drop', async () => {
      const p = await open();
      const rows = document.querySelectorAll('.sv-colgrp');
      const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.dragStart(rows[0], { dataTransfer });
      fireEvent.dragOver(rows[1], { dataTransfer });
      fireEvent.drop(rows[1], { dataTransfer });
      expect(p.onColumnsChange).toHaveBeenCalledWith(['total', 'customer']);
    });
  });

  describe('fields of a stacked column', () => {
    async function openFields(overrides: Partial<ColumnsPanelProps<TestRow>> = {}): Promise<{ p: ColumnsPanelProps<TestRow>; group: HTMLElement }> {
      const p = await open(overrides);
      await userEvent.click(screen.getByRole('button', { name: 'Fields of Total, payment, dates' }));
      return { p, group: screen.getByRole('group', { name: 'Fields in Total, payment, dates' }) };
    }

    it('should only offer the disclosure on a stacked column', async () => {
      await open();
      expect(screen.getAllByRole('button', { name: /^Fields of/ })).toHaveLength(1);
    });

    it('should reveal the fields on disclosure and collapse them again', async () => {
      const { group } = await openFields();
      expect(within(group).getByRole('checkbox', { name: /Payment/ })).toBeChecked();
      await userEvent.click(screen.getByRole('button', { name: 'Fields of Total, payment, dates' }));
      expect(screen.queryByRole('group', { name: 'Fields in Total, payment, dates' })).toBeNull();
    });

    it('should hide a field', async () => {
      const { p, group } = await openFields();
      await userEvent.click(within(group).getByRole('checkbox', { name: /Payment/ }));
      expect(p.onPartsChange).toHaveBeenCalledWith('total', ['amount', 'created']);
    });

    it('should reorder fields with the buttons', async () => {
      const { p, group } = await openFields();
      await userEvent.click(within(group).getByRole('button', { name: 'Move Total down' }));
      expect(p.onPartsChange).toHaveBeenCalledWith('total', ['payment', 'amount', 'created']);
    });

    it('should reorder fields with the keyboard on the field grip', async () => {
      const { p, group } = await openFields();
      within(group).getByRole('button', { name: /Move Payment\. Drag/ }).focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(p.onPartsChange).toHaveBeenCalledWith('total', ['amount', 'created', 'payment']);
    });

    it('should keep at least one field', async () => {
      const { group } = await openFields({ parts: { total: ['amount'] } });
      expect(within(group).getByRole('checkbox', { name: /Total/ })).toBeDisabled();
      expect(within(group).getByText(/keeps at least one field/)).toBeInTheDocument();
    });

    it('should offer a hidden field again', async () => {
      const { p, group } = await openFields({ parts: { total: ['amount'] } });
      await userEvent.click(within(group).getByRole('checkbox', { name: /Created/ }));
      expect(p.onPartsChange).toHaveBeenCalledWith('total', ['amount', 'created']);
    });
  });

  it('should change the sort from the select', async () => {
    const p = await open();
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'total:desc');
    expect(p.onSortChange).toHaveBeenCalledWith({ key: 'total', dir: 'desc' });
  });

  it('should keep showing a sort chosen from a header that is not among the options', async () => {
    await open({ sort: { key: 'carrier', dir: 'asc' }, sortFallbackLabel: 'carrier, ascending' });
    expect(screen.getByRole('option', { name: 'carrier, ascending' })).toBeInTheDocument();
  });

  it('should restore the defaults', async () => {
    const p = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(p.onRestoreDefaults).toHaveBeenCalled();
  });

  it('should say the choices are saved for you on a list without custom views', async () => {
    await open({ showSavedForYouHint: true });
    expect(screen.getByText(/This list has no custom views/)).toBeInTheDocument();
  });

  it('should close with Escape and give the trigger back its focus', async () => {
    await open();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: /Columns & sort/ })).toHaveFocus());
  });
});
