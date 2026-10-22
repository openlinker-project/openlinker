import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../features/connections';
import { ShoperConnectionActions } from './shoper-connection-actions';

vi.mock('../../../features/connections', () => ({
  useConfigureWebhooksMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../../shared/ui/toast-provider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

function connection(enabledCapabilities: string[], config: Record<string, unknown> = {}): Connection {
  return { id: 'c1', enabledCapabilities, config } as unknown as Connection;
}

describe('ShoperConnectionActions', () => {
  it('should disable the button when Order source is not enabled', () => {
    render(<ShoperConnectionActions connection={connection(['ProductMaster'])} />);
    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeDisabled();
  });

  it('should enable the button when Order source is enabled', () => {
    render(<ShoperConnectionActions connection={connection(['OrderSource'])} />);
    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeEnabled();
  });

  it('should offer re-configuring when webhooks are already configured', () => {
    render(
      <ShoperConnectionActions
        connection={connection(['OrderSource'], { webhooksConfigured: true })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Re-configure webhooks' })).toBeEnabled();
  });
});
