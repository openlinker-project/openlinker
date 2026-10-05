import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { StepSalesDocuments, type StepSalesDocumentsProps } from '../components/step-sales-documents';

vi.mock('../../sales-documents', () => ({
  SalesDocumentsPanel: () => <div data-testid="sales-documents-panel" />,
  deriveSalesDocumentRows: () => [],
}));

function baseProps(overrides: Partial<StepSalesDocumentsProps> = {}): StepSalesDocumentsProps {
  return {
    connections: [],
    skipped: false,
    canWrite: true,
    demoReadOnly: false,
    saving: false,
    onBack: vi.fn(),
    onContinue: vi.fn(),
    onSetSkipped: vi.fn(),
    ...overrides,
  };
}

describe('StepSalesDocuments', () => {
  it('should offer "Not needed" and keep Continue disabled when nothing issues documents', () => {
    const onSetSkipped = vi.fn();
    renderWithProviders(<StepSalesDocuments {...baseProps({ onSetSkipped })} />);

    expect(screen.getByTestId('btn-continue-sales-documents')).toBeDisabled();
    fireEvent.click(screen.getByTestId('btn-step-salesDocuments-skip'));
    expect(onSetSkipped).toHaveBeenCalledWith(true);
  });

  it('should enable Continue once documents are declared not needed', () => {
    renderWithProviders(<StepSalesDocuments {...baseProps({ skipped: true })} />);

    expect(screen.getByTestId('btn-continue-sales-documents')).toBeEnabled();
    expect(screen.getByTestId('btn-step-salesDocuments-undo')).toBeInTheDocument();
  });
});
