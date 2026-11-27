/**
 * AmazonConnectionActions tests (#4186)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../features/connections';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { AmazonConnectionActions } from './amazon-connection-actions';

const QUEUE = 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications';

function connectionWith(caps: string[], config: Record<string, unknown>): Connection {
  return { ...sampleConnection, platformType: 'amazon', enabledCapabilities: caps, config } as Connection;
}

afterEach(cleanup);

describe('AmazonConnectionActions', () => {
  it('should render nothing without Order source', () => {
    renderWithProviders(
      <AmazonConnectionActions connection={connectionWith(['OfferManager'], { notificationQueueUrl: QUEUE })} />,
    );
    expect(screen.queryByRole('button', { name: 'Register queue' })).toBeNull();
    expect(screen.queryByText('Order notifications')).toBeNull();
  });

  it('should ask for a saved queue URL before registering', () => {
    renderWithProviders(<AmazonConnectionActions connection={connectionWith(['OrderSource'], {})} />);

    expect(screen.getByRole('button', { name: 'Register queue' })).toBeDisabled();
    expect(screen.getByText(/Save an SQS queue URL first/)).toBeInTheDocument();
  });

  it('should register the saved queue', async () => {
    const installWebhooks = vi.fn().mockResolvedValue({ webhooksConfigured: true, testPingTriggered: false });
    const apiClient = createMockApiClient({ connections: { installWebhooks } });
    const connection = connectionWith(['OrderSource'], { notificationQueueUrl: QUEUE });
    renderWithProviders(<AmazonConnectionActions connection={connection} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Register queue' }));

    await waitFor(() => expect(installWebhooks).toHaveBeenCalledWith(connection.id));
    expect(await screen.findByText('Queue registered')).toBeInTheDocument();
  });

  it('should lock the action for a read-only viewer', () => {
    renderWithProviders(
      <AmazonConnectionActions connection={connectionWith(['OrderSource'], { notificationQueueUrl: QUEUE })} readOnly />,
    );
    expect(screen.getByRole('button', { name: 'Register queue' })).toBeDisabled();
  });
});
