/**
 * Crypto Service
 *
 * AES-256-GCM symmetric encryption for credential data at rest.
 * Envelope format: base64(nonce[12] || ciphertext || authTag[16]).
 *
 * Key source: OPENLINKER_CREDENTIALS_ENCRYPTION_KEY (base64, 32 bytes decoded).
 * In production the key is required; missing/invalid values throw on startup.
 * In development/test a deterministic fallback key is used with a warning so
 * local setups keep working without manual configuration.
 *
 * @module libs/shared/src/crypto
 */
import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { Logger } from '../logging/logger';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEV_KEY_SEED = 'openlinker-dev-credentials-key-do-not-use-in-production';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const raw = this.configService.get<string>('OPENLINKER_CREDENTIALS_ENCRYPTION_KEY');
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';

    if (!raw) {
      if (nodeEnv === 'development' || nodeEnv === 'test') {
        this.key = createHash('sha256').update(DEV_KEY_SEED).digest();
        this.logger.warn(
          'OPENLINKER_CREDENTIALS_ENCRYPTION_KEY not set — using deterministic dev fallback. ' +
            'Never use this in production.'
        );
        return;
      }
      throw new Error(
        'OPENLINKER_CREDENTIALS_ENCRYPTION_KEY is required. ' +
          'Set it to a base64-encoded 32-byte key.'
      );
    }

    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== KEY_BYTES) {
      throw new Error(
        `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}).`
      );
    }
    this.key = decoded;
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
  }

  decrypt(envelope: string): string {
    const buf = Buffer.from(envelope, 'base64');
    if (buf.length < NONCE_BYTES + TAG_BYTES) {
      throw new Error('Invalid ciphertext envelope: too short');
    }
    const nonce = buf.subarray(0, NONCE_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
