# Allegro Integration Setup Guide

This guide walks you through setting up the Allegro integration in OpenLinker, including OAuth configuration, environment setup, and connection creation.

## Prerequisites

- OpenLinker API server running
- PostgreSQL database configured
- Redis configured
- Allegro Developer Account (sandbox or production)

## 1. Allegro OAuth Application Setup

### Sandbox Environment

1. Go to [Allegro Developers Portal (Sandbox)](https://developer.allegro.pl/)
2. Create a new application or use an existing one
3. Note your **Client ID** and **Client Secret**
4. Configure **Redirect URI**:
   - Example: `https://api.openlinker.com/integrations/allegro/oauth/callback`
   - Must match exactly what you'll use in the OAuth flow
   - Can be `http://localhost:3000/integrations/allegro/oauth/callback` for local development

### Production Environment

1. Go to [Allegro Developers Portal (Production)](https://developer.allegro.pl/)
2. Create a production application
3. Note your **Client ID** and **Client Secret**
4. Configure **Redirect URI** (must be HTTPS in production)

## 2. Environment Variables

No specific environment variables are required for the Allegro integration. The integration uses the database-backed credential store, which stores OAuth tokens securely in the `integration_credentials` table.

### Optional: Database Connection

Ensure your database connection is configured in your application's environment:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/openlinker
```

### Optional: Redis Connection

Redis is used for OAuth state management during the OAuth flow:

```bash
REDIS_URL=redis://localhost:6379
```

## 3. Credential Store Setup

The Allegro integration uses a **database-backed credential store** to securely store OAuth tokens. Credentials are stored in the `integration_credentials` table with the following structure:

- **ref**: Unique reference (format: `allegro_{environment}_{timestamp}_{uuid}`)
- **platformType**: `allegro`
- **credentialsJson**: JSON object containing `accessToken`, `refreshToken`, and `expiresAt`
- **encrypted**: Boolean flag (currently `false` for MVP, encryption can be added later)

The credential store is automatically set up when you run database migrations. No manual setup is required.

## 4. Sandbox vs Production Configuration

### Sandbox Environment

- **API Base URL**: `https://allegro.pl.allegrosandbox.pl`
- **OAuth Endpoint**: `https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize`
- **Use Case**: Testing and development
- **Data**: Test data only

### Production Environment

- **API Base URL**: `https://allegro.pl`
- **OAuth Endpoint**: `https://allegro.pl/auth/oauth/authorize`
- **Use Case**: Live production use
- **Data**: Real customer orders and inventory

**Important**: Always test in sandbox first before moving to production.

## 5. Connection Creation Steps

### Step 1: Initiate OAuth Flow

Make a POST request to `/integrations/allegro/oauth/connect`:

```bash
curl -X POST http://localhost:3000/integrations/allegro/oauth/connect \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "redirectUri": "https://api.openlinker.com/integrations/allegro/oauth/callback",
    "environment": "sandbox",
    "connectionName": "My Allegro Store"
  }'
```

**Response**:
```json
{
  "authorizationUrl": "https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize?client_id=...&response_type=code&redirect_uri=...&state=...",
  "state": "random-state-string"
}
```

### Step 2: Authorize Application

1. Open the `authorizationUrl` from the response in your browser
2. Log in to your Allegro account (sandbox or production)
3. Grant permissions to the application
4. You'll be redirected to your `redirectUri` with a `code` parameter

### Step 3: Complete OAuth Callback

The OAuth callback is automatically handled by the API endpoint `/integrations/allegro/oauth/callback`. When Allegro redirects to your callback URL, the API will:

1. Validate the OAuth state parameter (CSRF protection)
2. Exchange the authorization code for access and refresh tokens
3. Store credentials in the database (`integration_credentials` table)
4. Create a `Connection` entity with:
   - `platformType`: `allegro`
   - `adapterKey`: `allegro.publicapi.v1`
   - `credentialsRef`: `db:{credential-ref}` (points to stored credentials)
   - `config`: `{ environment: 'sandbox' | 'production' }`
   - `status`: `active`

**Response**:
```json
{
  "message": "OAuth callback processed successfully. Connection created.",
  "connectionId": "123e4567-e89b-12d3-a456-426614174000",
  "connectionName": "My Allegro Store"
}
```

### Step 4: Validate Connection

Verify your connection is working:

```bash
curl http://localhost:3000/integrations/allegro/connections/{connectionId}/validate
```

**Response**:
```json
{
  "valid": true,
  "errors": []
}
```

## 6. Connection Configuration

Each Allegro connection stores configuration in the `Connection.config` field:

```json
{
  "environment": "sandbox"
}
```

or

```json
{
  "environment": "production"
}
```

The environment determines which Allegro API endpoints are used.

## 7. Next Steps

After creating a connection:

1. **Set up Offer↔Product Mappings**: Map Allegro offers to your internal products
   - See [Runbook: Offer Mappings](./runbook.md#offer-mappings)

2. **Start Order Sync**: Orders will be automatically synced via polling jobs
   - See [Runbook: Order Sync](./runbook.md#order-sync)

3. **Configure Inventory Sync**: Set up inventory propagation to Allegro
   - See [Runbook: Inventory Sync](./runbook.md#inventory-sync)

## Troubleshooting

### OAuth Flow Issues

- **"Invalid redirect_uri"**: Ensure the redirect URI in your Allegro app configuration matches exactly what you're using in the OAuth request
- **"Invalid state parameter"**: The OAuth state expires after 10 minutes. Restart the OAuth flow if it takes too long
- **"Authentication failed"**: Verify your client ID and client secret are correct

### Connection Validation Issues

- **"Connection not found"**: Verify the connection ID is correct
- **"Credentials not found"**: The credentials may have been deleted. Re-run the OAuth flow to create a new connection

### Database Issues

- **"Credential store not available"**: Ensure the `integration_credentials` table exists (run migrations)
- **"Connection creation failed"**: Check database connectivity and permissions

## Security Considerations

- **Credentials Storage**: OAuth tokens are stored in the database. For production, consider enabling encryption (future enhancement)
- **Client Secret**: The client secret is temporarily stored in Redis during OAuth flow, then discarded after credentials are stored in the database
- **HTTPS**: Always use HTTPS in production for OAuth callbacks
- **State Parameter**: The OAuth state parameter provides CSRF protection. Never skip state validation

## API Reference

- **POST** `/integrations/allegro/oauth/connect` - Initiate OAuth flow
- **GET** `/integrations/allegro/oauth/callback` - Handle OAuth callback
- **GET** `/integrations/allegro/connections/:id/validate` - Validate connection
- **GET** `/integrations/allegro/connections/:id/cursors` - Get connection cursors
- **GET** `/integrations/allegro/connections/:id/commands` - Get quantity commands

For full API documentation, see the Swagger UI at `/api/docs` (if enabled).

## Additional Resources

- [Manual Testing Guide](./manual-testing-guide.md) - Step-by-step manual testing procedures
- [Runbook](./runbook.md) - Operational troubleshooting guide
- [Allegro API Documentation](https://developer.allegro.pl/documentation/)
- [OpenLinker Architecture Overview](../../../../docs/architecture-overview.md)

 