/**
 * Crypto Service
 *
 * NestJS-injectable façade over the pure `crypto-primitives` module
 * (`encryptWithKey` / `decryptWithKey` / `loadEncryptionKey`). The primitives
 * are shared with the `1789000000000-encrypt-integration-credentials`
 * migration (#709) so runtime + migration paths cannot drift on algorithm
 * or key-loading semantics.
 *
 * Envelope format: base64(nonce[12] || ciphertext || authTag[16]).
 * Key source: `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` (base64, 32 bytes).
 *
 * @module libs/shared/src/crypto
 */
import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '../logging/logger';
import { decryptWithKey, encryptWithKey, loadEncryptionKey } from './crypto-primitives';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // `ConfigService.get` mirrors process.env semantics — wrap it in a
    // ProcessEnv-shaped record so the primitive sees a plain map.
    const env: NodeJS.ProcessEnv = {
      OPENLINKER_CREDENTIALS_ENCRYPTION_KEY: this.configService.get<string>(
        'OPENLINKER_CREDENTIALS_ENCRYPTION_KEY',
      ),
      NODE_ENV: this.configService.get<string>('NODE_ENV') ?? 'development',
    };
    const { key, usedDevFallback } = loadEncryptionKey(env);
    this.key = key;
    if (usedDevFallback) {
      this.logger.warn(
        'OPENLINKER_CREDENTIALS_ENCRYPTION_KEY not set — using deterministic dev fallback. ' +
          'Never use this in production.',
      );
    }
  }

  encrypt(plaintext: string): string {
    return encryptWithKey(this.key, plaintext);
  }

  decrypt(envelope: string): string {
    return decryptWithKey(this.key, envelope);
  }
}
