import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Alert } from './alert';

afterEach(cleanup);

describe('Alert', () => {
  it('should add the compact modifier when density is compact', () => {
    render(
      <Alert tone="warning" density="compact" title="Stock shortfall">
        0 of 1 available
      </Alert>
    );

    expect(screen.getByRole('status')).toHaveClass('alert', 'alert--warning', 'alert--compact');
  });

  it('should render the default chrome when no density is given', () => {
    render(<Alert tone="info">Note</Alert>);
    expect(screen.getByRole('status')).not.toHaveClass('alert--compact');
  });

  it('should use the alert role for the error tone when rendered', () => {
    render(<Alert tone="error">Failed</Alert>);
    expect(screen.getByRole('alert')).toHaveClass('alert--error');
  });
});
