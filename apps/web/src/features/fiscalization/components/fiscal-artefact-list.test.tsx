/**
 * FiscalArtefactList Tests (#1909)
 *
 * Coverage per `medium`: which affordance renders (link/document/code) or
 * none (text/markup), the empty-list SUCCESS case (renders nothing, never an
 * empty/broken state per ADR-042 dec. 2), and the `document` download path.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { FiscalArtefact } from '../api/fiscalization.types';
import { FiscalArtefactList } from './fiscal-artefact-list';

afterEach(cleanup);

function makeArtefact(over: Partial<FiscalArtefact> = {}): FiscalArtefact {
  return {
    medium: 'link',
    disposition: 'display',
    content: 'https://ep.example/r/1',
    contentType: null,
    label: null,
    ...over,
  };
}

describe('FiscalArtefactList', () => {
  it('renders nothing for an empty list, as a SUCCESS state rather than an empty one', () => {
    const { container } = renderWithProviders(<FiscalArtefactList artefacts={[]} />);
    expect(container.querySelector('.artefact-list')).toBeNull();
  });

  it('renders a link artefact as an openable anchor', () => {
    renderWithProviders(<FiscalArtefactList artefacts={[makeArtefact({ medium: 'link' })]} />);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', 'https://ep.example/r/1');
  });

  it('renders a code artefact as a scannable image, no download/open action', () => {
    renderWithProviders(
      <FiscalArtefactList
        artefacts={[makeArtefact({ medium: 'code', content: 'QQ==', contentType: 'image/png' })]}
      />,
    );
    const image = screen.getByAltText('Scannable code for the receipt');
    expect(image).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,QQ=='));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
  });

  it('renders a text/markup artefact as internal-use-only, with no action', () => {
    renderWithProviders(
      <FiscalArtefactList artefacts={[makeArtefact({ medium: 'text' })]} />,
    );
    expect(screen.getByText('For internal use')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('triggers a download for a document artefact without navigating the page', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(
      <FiscalArtefactList
        artefacts={[
          makeArtefact({ medium: 'document', content: 'QQ==', contentType: 'application/pdf', label: 'receipt-1.pdf' }),
        ]}
      />,
    );

    screen.getByRole('button', { name: 'Download' }).click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
