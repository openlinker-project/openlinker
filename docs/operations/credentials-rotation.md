# Credentials Rotation

Per-environment runbook for the AES-256-GCM credentials-at-rest envelope
introduced in #709. The same envelope protects every row in the
`integration_credentials` table — OAuth tokens, webhook secrets, AI provider
keys, and platform API keys all share the same key.

## Encryption key

The key is a 32-byte hex string supplied via:

```
OPENLINKER_CREDENTIALS_ENCRYPTION_KEY=<64 hex chars>
```

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Production gate

Under `NODE_ENV=production` the encryption key is **mandatory**.
`loadEncryptionKey` throws at boot (and inside the migration) if it is
unset, so a misconfigured deploy fails fast rather than silently falling
back to a deterministic dev fallback.

The plaintext env-var credentials backend (`getFromEnvironment`) is also
disabled in production for the same reason — see
`CredentialsResolverService.getFromEnvironment`.

### Dev/test fallback

In `NODE_ENV !== 'production'` (i.e. local dev, CI), `loadEncryptionKey`
falls back to a deterministic key when the env var is unset, so
`pnpm test` / `pnpm test:integration` work zero-config. The fallback is
**not safe** for any environment that handles real credentials.

## Rotation procedure

Rotating the encryption key today is a manual two-step:

1. **Stop every API + worker process.** Both keys cannot be live in the
   same process; if rotation runs while a process is still serving
   traffic, half the rows end up keyed under the old envelope and half
   under the new envelope and the only recovery is a backup restore.
2. **Decrypt-all** under the *old* key (write plaintext snapshots to a
   protected, ephemeral location).
3. **Re-encrypt-all** under the *new* key, then start the processes back
   up with `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` pointing at the new
   value.

There is no in-tree CLI for this yet. The recommended path while one
doesn't exist:

```ts
import { CryptoService } from '@openlinker/shared';
import { IntegrationCredentialRepository } from '@openlinker/core/integrations';

// Read every row with the old key, write every row with the new key.
// CryptoService reads OPENLINKER_CREDENTIALS_ENCRYPTION_KEY once at
// instantiation — run a dedicated one-shot script with the old env,
// then a second one-shot with the new env. Never flip the env on a
// long-running process.
```

A `pnpm rotate-credentials-key` CLI is tracked as a follow-up to #709.

## Compromise response

If the encryption key is suspected compromised:

1. Issue a fresh key (`OPENLINKER_CREDENTIALS_ENCRYPTION_KEY`).
2. Run the rotation procedure above.
3. **Independently** rotate each upstream credential — OAuth refresh
   tokens, PrestaShop webservice API keys, Allegro client secrets,
   Anthropic/OpenAI API keys. The envelope only protects rest; if a key
   leaked, the plaintext it was wrapping must be assumed compromised too.

## Migration safety

The #709 data migration (`1795000000000-encrypt-integration-credentials`)
backfills the new `credentialsCiphertext` column from the legacy
`credentialsJson` + `encrypted` columns, then drops them. `down()`
restores the schema only — the plaintext is *not* recoverable from
ciphertext during a revert. **Always take a fresh database backup before
running this migration in any environment you cannot afford to lose.**

## Threat model

The envelope mitigates:

- DB dump leakage (logical backup, replica snapshot, exfiltration).
- Read-only DBA / support access without the encryption key.

It does **not** mitigate:

- App-server compromise (the app must hold the key in process memory).
- Key + DB joint leakage (encryption is moot at that point — independent
  rotation of upstream credentials is the only remediation).
- Plaintext leakage through logs, metrics, error responses. Adapters and
  services that handle decrypted values must not log them.
