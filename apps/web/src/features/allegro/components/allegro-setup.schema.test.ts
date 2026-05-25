/**
 * allegro-setup.schema — toStartOAuthInput tests (#819)
 *
 * Pins the re-auth wiring: an existing connectionId threads through to the
 * OAuth start payload so the callback re-authenticates that connection in
 * place instead of minting a new one.
 */
import { describe, expect, it } from 'vitest';
import { toStartOAuthInput, type AllegroSetupFormSubmission } from './allegro-setup.schema';

const baseValues: AllegroSetupFormSubmission = {
  name: 'Allegro sandbox',
  environment: 'sandbox',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  masterCatalogConnectionId: undefined,
};

const REDIRECT_URI = 'https://app.example.com/integrations/allegro/connect/callback';

describe('toStartOAuthInput', () => {
  it('includes connectionId when a re-auth connection id is provided', () => {
    const input = toStartOAuthInput(baseValues, REDIRECT_URI, 'conn-existing');

    expect(input.connectionId).toBe('conn-existing');
    expect(input).toMatchObject({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: REDIRECT_URI,
      environment: 'sandbox',
      connectionName: 'Allegro sandbox',
    });
  });

  it('omits connectionId when no re-auth connection id is provided', () => {
    const input = toStartOAuthInput(baseValues, REDIRECT_URI);

    expect(input.connectionId).toBeUndefined();
    expect('connectionId' in input).toBe(false);
  });

  it('still threads masterCatalogConnectionId independently of the re-auth id', () => {
    const input = toStartOAuthInput(
      { ...baseValues, masterCatalogConnectionId: 'cat-1' },
      REDIRECT_URI,
      'conn-existing',
    );

    expect(input.masterCatalogConnectionId).toBe('cat-1');
    expect(input.connectionId).toBe('conn-existing');
  });
});
