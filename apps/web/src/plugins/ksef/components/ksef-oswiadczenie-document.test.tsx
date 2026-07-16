/**
 * KsefOswiadczenieDocument tests
 *
 * Covers the printable oświadczenie sheet: it renders the seller header, the
 * skipped number / series identity / reason, opens the browser print dialog via
 * the toolbar, and copies the plain-text form to the clipboard. Also covers the
 * seller-missing fallback.
 *
 * @module plugins/ksef/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { KsefOswiadczenieDocument } from './ksef-oswiadczenie-document';
import type { KsefOswiadczenieContent } from '../lib/ksef-oswiadczenie';

const content: KsefOswiadczenieContent = {
  seller: {
    nip: '1234567890',
    name: 'Sklep ABC Sp. z o.o.',
    addressLine1: 'ul. Przykładowa 1',
    addressLine2: '',
    city: 'Warszawa',
    postalCode: '00-001',
    countryIso2: 'PL',
  },
  seriesName: 'Faktury sprzedaży',
  seriesPattern: 'FV/{seq}/{MM}/{YYYY}',
  skippedNumber: 'FV/42/07/2026',
  reason: 'Szkic porzucony przed wysyłką; numer nigdy nie został wystawiony.',
  issuedAt: new Date('2026-07-16T10:00:00.000Z'),
};

describe('KsefOswiadczenieDocument', () => {
  afterEach(cleanup);

  it('renders the seller header, title, skipped number, series identity and reason', () => {
    renderWithProviders(<KsefOswiadczenieDocument content={content} onClose={vi.fn()} />);

    expect(screen.getByText('Oświadczenie o pominięciu numeru faktury')).toBeInTheDocument();
    expect(screen.getByText('Sklep ABC Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('ul. Przykładowa 1')).toBeInTheDocument();
    expect(screen.getByText('00-001 Warszawa')).toBeInTheDocument();
    expect(screen.getByText('NIP: 1234567890')).toBeInTheDocument();
    // Skipped number appears in the body sentence and the series box.
    expect(screen.getAllByText(/FV\/42\/07\/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText('Faktury sprzedaży')).toBeInTheDocument();
    expect(screen.getByText('FV/{seq}/{MM}/{YYYY}')).toBeInTheDocument();
    expect(
      screen.getByText(/Szkic porzucony przed wysyłką/),
    ).toBeInTheDocument();
    expect(screen.getByText('(podpis osoby upoważnionej)')).toBeInTheDocument();
  });

  it('triggers window.print when the print action is clicked', () => {
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, writable: true, configurable: true });
    renderWithProviders(<KsefOswiadczenieDocument content={content} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Drukuj / Zapisz jako PDF' }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('copies the plain-text document to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    renderWithProviders(<KsefOswiadczenieDocument content={content} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj tekst' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Oświadczenie o pominięciu numeru faktury');
    expect(copied).toContain('FV/42/07/2026');
    expect(copied).toContain('Przyczyna pominięcia:');
  });

  it('shows a seller-missing hint when the profile carries no name or NIP', () => {
    const withoutSeller: KsefOswiadczenieContent = {
      ...content,
      seller: { nip: '', name: '', addressLine1: '', addressLine2: '', city: '', postalCode: '', countryIso2: '' },
    };
    renderWithProviders(<KsefOswiadczenieDocument content={withoutSeller} onClose={vi.fn()} />);

    expect(screen.getByText(/Uzupełnij profil sprzedawcy/)).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(<KsefOswiadczenieDocument content={content} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
