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
  it('renders the environment name with the release version below it', () => {
    render(<EnvironmentBadge appEnv="production" version="1.4.0" />);

    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('v1.4.0')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment Production, version 1.4.0')).toHaveClass(
      'context-chip--success',
    );
  });

  it('renders the compact short label with the version below it', () => {
    render(<EnvironmentBadge appEnv="production" compact version="1.4.0" />);

    expect(screen.getByText('Prod')).toBeInTheDocument();
    expect(screen.getByText('v1.4.0')).toBeInTheDocument();
  });

  it('omits the version line when no version is available', () => {
    render(<EnvironmentBadge appEnv="production" version="" />);

    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Environment Production')).toBeInTheDocument();
  });
});
