import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnvironmentBadge, getEnvironmentMeta } from './environment-badge';

describe('getEnvironmentMeta', () => {
  it('normalizes common environment labels', () => {
    expect(getEnvironmentMeta('development')).toEqual({
      label: 'Development',
      shortLabel: 'Dev',
      tone: 'info',
    });

    expect(getEnvironmentMeta('production')).toEqual({
      label: 'Production',
      shortLabel: 'Prod',
      tone: 'success',
    });
  });

  it('humanizes custom environments', () => {
    expect(getEnvironmentMeta('integration_lab')).toEqual({
      label: 'Integration Lab',
      shortLabel: 'Inte',
      tone: 'neutral',
    });
  });
});

describe('EnvironmentBadge', () => {
  it('renders the release version instead of the environment name', () => {
    render(<EnvironmentBadge appEnv="production" version="1.4.0" />);

    expect(screen.getByText('v1.4.0')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment Production, version 1.4.0')).toHaveClass(
      'context-chip--success',
    );
  });
});
