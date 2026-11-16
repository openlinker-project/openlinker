import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../features/connections';
import { ShopifyConnectionActions } from './shopify-connection-actions';

vi.mock('../../../features/connections', () => ({
  useConfigureWebhooksMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../../../shared/ui/toast-provider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const CALLBACK = { openlinkerCallbackBaseUrl: 'https://ol.example.com' };

function connection(enabledCapabilities: string[], config: Record<string, unknown> = CALLBACK): Connection {
  return { id: 'c1', enabledCapabilities, config } as unknown as Connection;
}

describe('ShopifyConnectionActions', () => {
  it('should enable the button with a saved callback URL and Order source on', () => {
    render(<ShopifyConnectionActions connection={connection(['OrderSource'])} />);
    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeEnabled();
  });

  it('should disable the button until a callback URL is saved', () => {
    render(<ShopifyConnectionActions connection={connection(['OrderSource'], {})} />);
    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeDisabled();
    expect(screen.getByText(/Save an OpenLinker callback URL first/)).toBeTruthy();
  });

  it('should disable the button when neither Order source nor Product master is on', () => {
    render(<ShopifyConnectionActions connection={connection(['InventoryMaster'])} />);
    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeDisabled();
  });

  it('should offer configuring again when webhooks are already configured', () => {
    render(
      <ShopifyConnectionActions
        connection={connection(['ProductMaster'], { ...CALLBACK, webhooksConfigured: true })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Configure again' })).toBeEnabled();
  });
});
