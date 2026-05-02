/**
 * AllegroErrorList Tests (#486)
 *
 * @module apps/web/src/shared/ui
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllegroErrorList } from './allegro-error-list';
import type { AllegroLikeError } from '../lib/allegro-error-mapping';

describe('AllegroErrorList', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    writeText.mockClear();
  });

  it('returns null when errors are null', () => {
    const { container } = render(<AllegroErrorList errors={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when errors are an empty array', () => {
    const { container } = render(<AllegroErrorList errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('field-path breadcrumb', () => {
    it('splits dotted paths into trail + leaf, leaf is the visual anchor', () => {
      const errors: AllegroLikeError[] = [
        {
          field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
          code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
          message: 'Responsible producer is required for every product in the offer',
        },
      ];
      render(<AllegroErrorList errors={errors} />);

      // The leaf segment uses the special "leaf" class; the trail uses
      // separate spans. We verify the leaf segment is present as text and
      // that the trail segments render too.
      expect(screen.getByText('responsibleProducer')).toBeInTheDocument();
      expect(screen.getByText('offer')).toBeInTheDocument();
      expect(screen.getByText('productSafety')).toBeInTheDocument();
    });

    it('copies the full dotted path on click and surfaces a confirmation', async () => {
      const errors: AllegroLikeError[] = [
        { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
      ];
      render(<AllegroErrorList errors={errors} />);

      const button = screen.getByRole('button', { name: /Copy field path parameters\.EAN/i });
      fireEvent.click(button);

      expect(writeText).toHaveBeenCalledWith('parameters.EAN');
      await waitFor(() => {
        expect(screen.getByText(/copied/i)).toBeInTheDocument();
      });
    });

    it('treats Allegro\'s "null" sentinel field as no field', () => {
      const errors: AllegroLikeError[] = [
        {
          field: 'null',
          code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
          message: 'Offer Terms (for returns and complaints) are required for Business Accounts.',
        },
      ];
      render(<AllegroErrorList errors={errors} />);

      // No copy button — the sentinel is filtered out.
      expect(screen.queryByRole('button', { name: /Copy field path/i })).not.toBeInTheDocument();
      // Translated message still renders.
      expect(screen.getByText(/Set after-sales policies/i)).toBeInTheDocument();
    });

    it('renders single-segment paths without breadcrumb separators', () => {
      const errors: AllegroLikeError[] = [
        { field: 'name', code: 'TOO_LONG', message: 'Name is too long.' },
      ];
      render(<AllegroErrorList errors={errors} />);

      const button = screen.getByRole('button', { name: /Copy field path name/i });
      expect(button).toHaveTextContent('name');
      expect(button.querySelectorAll('.allegro-error-list__field-sep')).toHaveLength(0);
    });
  });

  describe('translation pipeline', () => {
    it('renders the friendly translation for mapped codes and keeps the raw message in <details>', () => {
      const errors: AllegroLikeError[] = [
        {
          code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
          message: 'Offer Terms (for returns and complaints) are required for Business Accounts.',
        },
      ];
      render(<AllegroErrorList errors={errors} />);

      expect(screen.getByText(/Set after-sales policies/i)).toBeInTheDocument();
      const details = screen.getByText(/Allegro's original message/i).closest('details');
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute('open');
      expect(
        screen.getByText('Offer Terms (for returns and complaints) are required for Business Accounts.'),
      ).toBeInTheDocument();
    });

    it('renders raw message verbatim with no <details> for unmapped codes', () => {
      const errors: AllegroLikeError[] = [
        { code: 'UNMAPPED_BRAND_NEW_CODE', message: 'Allegro raw message.' },
      ];
      render(<AllegroErrorList errors={errors} />);

      expect(screen.getByText('Allegro raw message.')).toBeInTheDocument();
      expect(screen.queryByText(/Allegro's original message/i)).toBeNull();
    });
  });

  it('renders the error code as a <code> chip with a full-text title', () => {
    const errors: AllegroLikeError[] = [
      { code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED', message: 'msg' },
    ];
    render(<AllegroErrorList errors={errors} />);

    // <code> not <kbd>: this is program-output, not keyboard input.
    const codeChip = screen.getByText('RESPONSIBLE_PRODUCER_NOT_SPECIFIED');
    expect(codeChip.tagName.toLowerCase()).toBe('code');
    expect(codeChip).toHaveAttribute('title', 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED');
  });
});
