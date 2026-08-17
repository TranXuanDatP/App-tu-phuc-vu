import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * PII Encryption Service
 *
 * Two-tier encryption for PII fields (phone, email):
 *
 * 1. **AES-256-GCM (random IV)**: For storing the actual encrypted value.
 *    Every encryption produces a unique ciphertext. This is the ONLY
 *    safe way to use AES-GCM — IV must NEVER be reused.
 *
 * 2. **HMAC-SHA256 Blind Index**: For searchable lookups.
 *    Stored in a separate `_hash` column. Deterministic (same input → same hash)
 *    but one-way — cannot be reversed to recover the plaintext.
 *    Query: `WHERE phone_hash = hmac_sha256(phone_input, secret_salt)`
 *
 * This pattern (Blind Index) is the industry standard for searchable encryption
 * and avoids the critical vulnerability of using AES-GCM with a static IV.
 *
 * Complies with NFR-S1 (AES-256 at rest) and Nghị định 13/2023/NĐ-CP.
 */
@Injectable()
export class PiiEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;
  private readonly logger = new Logger(PiiEncryptionService.name);

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.getOrThrow<string>('PII_ENCRYPTION_KEY');
    this.key = Buffer.from(secret, 'hex'); // Must be 32 bytes (64 hex chars)

    if (this.key.length !== 32) {
      throw new Error(
        `PII_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${this.key.length} bytes`,
      );
    }

    // Derive a separate HMAC key from the encryption key for blind index
    // Using a different context string ensures key separation
    this.hmacKey = createHmac('sha256', this.key)
      .update('blind-index-hmac-key-v1')
      .digest();
  }

  // =========================================================================
  // AES-256-GCM Encryption (random IV — for storage)
  // =========================================================================

  /**
   * Encrypt plaintext using AES-256-GCM with random IV.
   * Every call produces a unique ciphertext — safe for storage.
   * NOT searchable — use hashForLookup() for blind index queries.
   * @returns iv:authTag:encrypted (all hex-encoded)
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt ciphertext produced by encrypt().
   * @param ciphertext iv:authTag:encrypted format
   */
  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // =========================================================================
  // HMAC-SHA256 Blind Index (for searchable lookups)
  // =========================================================================

  /**
   * Compute HMAC-SHA256 blind index for a PII value.
   * Deterministic: same input always produces the same hash.
   * One-way: hash cannot be reversed to recover the plaintext.
   *
   * Store the result in a `_hash` column alongside the encrypted value.
   * Use for DB queries: WHERE phone_hash = hashForLookup(phoneInput)
   */
  hashForLookup(plaintext: string): string {
    return createHmac('sha256', this.hmacKey)
      .update(plaintext)
      .digest('hex');
  }

  /**
   * Short deterministic hash cho LOG lines (raw userId/customerId không bao giờ
   * vào log). 8 hex chars (32 bit) của blind-index HMAC — cùng derived key như
   * hashForLookup, không secret mới. Correlation-grade (đủ match trong 1 trace/
   * window), KHÔNG collision-proof — widen slice sau nếu forensics cần unique.
   * Convention call-site: `user=${pii.hashForLog(userId)}` → "user=a1b2c3d4".
   */
  hashForLog(plaintext: string): string {
    return this.hashForLookup(plaintext).slice(0, 8);
  }

  // =========================================================================
  // Convenience Methods
  // =========================================================================

  /**
   * Encrypt for storage if value is not null/undefined/empty.
   * Returns null if input is falsy.
   */
  encryptIfNeeded(value: string | null | undefined): string | null {
    if (!value) return null;
    return this.encrypt(value);
  }

  /**
   * Decrypt if value is not null/undefined/empty.
   * Returns null if input is falsy.
   */
  decryptIfNeeded(value: string | null | undefined): string | null {
    if (!value) return null;
    return this.decrypt(value);
  }

  /**
   * Compute blind index hash if value is not null/undefined/empty.
   * Returns null if input is falsy.
   */
  hashIfNeeded(value: string | null | undefined): string | null {
    if (!value) return null;
    return this.hashForLookup(value);
  }
}
