import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticatedThumbnail } from './authenticated-thumbnail';

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:thumb'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthenticatedThumbnail', () => {
  it('should render the placeholder initial while the picture is loading', () => {
    render(
      <AuthenticatedThumbnail
        src="/products/variants/v1/images/0"
        name="Biały"
        fetchImage={() => new Promise<Blob>(() => undefined)}
        testId="thumb"
      />
    );
    expect(screen.getByTestId('thumb').querySelector('img')).toBeNull();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('should render the fetched picture when the fetch succeeds', async () => {
    const fetchImage = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    render(
      <AuthenticatedThumbnail
        src="/products/variants/v1/images/0"
        name="Biały"
        fetchImage={fetchImage}
        testId="thumb"
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('thumb').querySelector('img')).toHaveAttribute('src', 'blob:thumb');
    });
    expect(fetchImage).toHaveBeenCalledWith('/products/variants/v1/images/0');
  });

  it('should fall back to the placeholder when the fetch fails', async () => {
    const fetchImage = vi.fn().mockRejectedValue(new Error('404'));
    render(
      <AuthenticatedThumbnail
        src="/products/variants/v1/images/0"
        name="Granat"
        fetchImage={fetchImage}
        testId="thumb"
      />
    );
    await waitFor(() => {
      expect(fetchImage).toHaveBeenCalled();
    });
    expect(screen.getByTestId('thumb').querySelector('img')).toBeNull();
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  it('should render the placeholder without fetching when there is no picture', () => {
    const fetchImage = vi.fn();
    render(<AuthenticatedThumbnail src={null} name="Szałwia" fetchImage={fetchImage} />);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('should dim the thumbnail when asked to', () => {
    render(
      <AuthenticatedThumbnail src={null} name="x" fetchImage={vi.fn()} dimmed testId="thumb" />
    );
    expect(screen.getByTestId('thumb')).toHaveClass('product-thumbnail--dimmed');
  });
});
