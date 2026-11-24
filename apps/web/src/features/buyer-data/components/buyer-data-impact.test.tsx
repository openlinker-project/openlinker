/**
 * BuyerDataImpact tests (#4289)
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { BuyerDataPreview } from '../api/buyer-data.types';
import { BuyerDataImpact } from './buyer-data-impact';

afterEach(cleanup);

const preview: BuyerDataPreview = {
  toHide: 40,
  toErase: 10,
  total: 40,
  totalOrders: 100,
  skippedProtected: 0,
  samples: [],
};

describe('BuyerDataImpact', () => {
  it('should count what stays against every order on the list, not only the candidates', () => {
    renderWithProviders(
      <BuyerDataImpact
        rules={{ enabled: true, hideAfterDays: 90, eraseAfterDays: 0, mode: 'personal-data' }}
        preview={preview}
        isLoading={false}
        isError={false}
        isInvalid={false}
      />
    );
    expect(screen.getByText('60')).toBeInTheDocument();
  });
});
