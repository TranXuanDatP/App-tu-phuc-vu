import { PiiEncryptionService } from './pii-encryption.service';
import { ConfigService } from '@nestjs/config';

describe('PiiEncryptionService', () => {
  let service: PiiEncryptionService;
  let configService: ConfigService;

  const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn().mockReturnValue(TEST_KEY),
    } as unknown as ConfigService;
    service = new PiiEncryptionService(configService);
  });

  // =========================================================================
  // AES-256-GCM Random-IV Encryption
  // =========================================================================
  describe('encrypt/decrypt (random IV)', () => {
    it('should encrypt and decrypt a phone number correctly', () => {
      const phone = '0901234567';
      const encrypted = service.encrypt(phone);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(phone);
    });

    it('should produce DIFFERENT ciphertexts for the same plaintext', () => {
      const phone = '0901234567';
      const encrypted1 = service.encrypt(phone);
      const encrypted2 = service.encrypt(phone);

      // Random IV → different ciphertexts every time
      expect(encrypted1).not.toBe(encrypted2);

      // Both decrypt correctly
      expect(service.decrypt(encrypted1)).toBe(phone);
      expect(service.decrypt(encrypted2)).toBe(phone);
    });

    it('should produce ciphertext in iv:authTag:encrypted format', () => {
      const encrypted = service.encrypt('test');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toHaveLength(32); // IV: 16 bytes = 32 hex
      expect(parts[1]).toHaveLength(32); // AuthTag: 16 bytes = 32 hex
      expect(parts[2]).toBeTruthy();
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = service.encrypt('0901234567');
      const parts = encrypted.split(':');
      const tampered = parts[0] + ':' + parts[1] + ':' + 'deadbeef';

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = service.encrypt('0901234567');
      const parts = encrypted.split(':');
      const tampered = parts[0] + ':' + 'aabbccdd' + parts[1].slice(8) + ':' + parts[2];

      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  // =========================================================================
  // HMAC-SHA256 Blind Index
  // =========================================================================
  describe('hashForLookup (HMAC blind index)', () => {
    it('should produce the SAME hash for the same phone number', () => {
      const hash1 = service.hashForLookup('0901234567');
      const hash2 = service.hashForLookup('0901234567');

      // Deterministic — enables DB lookups
      expect(hash1).toBe(hash2);
    });

    it('should produce DIFFERENT hashes for different phone numbers', () => {
      const hash1 = service.hashForLookup('0901234567');
      const hash2 = service.hashForLookup('0912345678');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce a 64-char hex string (SHA-256)', () => {
      const hash = service.hashForLookup('0901234567');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should be deterministic across multiple calls', () => {
      const hashes = Array.from({ length: 10 }, () =>
        service.hashForLookup('0901234567'),
      );

      // All 10 hashes must be identical
      expect(new Set(hashes).size).toBe(1);
    });

    it('should produce different hashes with different keys', () => {
      const key2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      const configService2 = {
        getOrThrow: jest.fn().mockReturnValue(key2),
      } as unknown as ConfigService;
      const service2 = new PiiEncryptionService(configService2);

      const hash1 = service.hashForLookup('0901234567');
      const hash2 = service2.hashForLookup('0901234567');

      expect(hash1).not.toBe(hash2);
    });
  });

  // =========================================================================
  // Blind Index Lookup Simulation (core use case)
  // =========================================================================
  describe('lookup simulation', () => {
    it('should find matching user via HMAC blind index', () => {
      // Simulate: user registers with phone
      const storedHash = service.hashForLookup('0901234567');

      // Simulate: later lookup by phone
      const lookupHash = service.hashForLookup('0901234567');

      // These MUST match for DB query to work
      expect(storedHash).toBe(lookupHash);
    });

    it('should NOT match different phone numbers', () => {
      const storedHash = service.hashForLookup('0901234567');
      const lookupHash = service.hashForLookup('0912345678');

      expect(storedHash).not.toBe(lookupHash);
    });

    it('encrypted value and hash should be completely different', () => {
      const phone = '0901234567';
      const encrypted = service.encrypt(phone);
      const hash = service.hashForLookup(phone);

      // Hash is NOT the encrypted value — they serve different purposes
      expect(hash).not.toBe(encrypted);
      // Hash is much shorter (64 hex) vs encrypted (iv:authTag:encrypted = 32:32:variable)
      expect(hash).toHaveLength(64);
    });
  });

  // =========================================================================
  // Convenience Methods
  // =========================================================================
  describe('encryptIfNeeded/decryptIfNeeded/hashIfNeeded', () => {
    it('should encrypt non-null values', () => {
      const encrypted = service.encryptIfNeeded('0901234567');
      expect(encrypted).not.toBe('0901234567');
      expect(service.decryptIfNeeded(encrypted!)).toBe('0901234567');
    });

    it('should return null for null input', () => {
      expect(service.encryptIfNeeded(null)).toBeNull();
      expect(service.decryptIfNeeded(null)).toBeNull();
      expect(service.hashIfNeeded(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(service.encryptIfNeeded(undefined)).toBeNull();
      expect(service.decryptIfNeeded(undefined)).toBeNull();
      expect(service.hashIfNeeded(undefined)).toBeNull();
    });

    it('should return null for empty string input', () => {
      expect(service.encryptIfNeeded('')).toBeNull();
      expect(service.decryptIfNeeded('')).toBeNull();
      expect(service.hashIfNeeded('')).toBeNull();
    });
  });

  // =========================================================================
  // Validation
  // =========================================================================
  describe('validation', () => {
    it('should throw if PII_ENCRYPTION_KEY is wrong length', () => {
      const badConfigService = {
        getOrThrow: jest.fn().mockReturnValue('tooshort'),
      } as unknown as ConfigService;

      expect(() => new PiiEncryptionService(badConfigService)).toThrow(
        'PII_ENCRYPTION_KEY must be 32 bytes',
      );
    });
  });

  // =========================================================================
  // Key Rotation
  // =========================================================================
  describe('key rotation', () => {
    it('should produce different encrypted values with different keys', () => {
      const key2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      const configService2 = {
        getOrThrow: jest.fn().mockReturnValue(key2),
      } as unknown as ConfigService;
      const service2 = new PiiEncryptionService(configService2);

      const phone = '0901234567';
      const encrypted1 = service.encrypt(phone);
      const encrypted2 = service2.encrypt(phone);

      // Different keys → different ciphertexts
      expect(encrypted1).not.toBe(encrypted2);

      // Cross-decryption should fail
      expect(() => service.decrypt(encrypted2)).toThrow();
      expect(() => service2.decrypt(encrypted1)).toThrow();
    });
  });

  describe('hashForLog (PII log remediation — 8 hex chars)', () => {
    it('deterministic + đúng 8 ký tự hex thường', () => {
      const a = service.hashForLog('user-abc');
      const b = service.hashForLog('user-abc');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}$/);
    });

    it('khác nhau theo input + là prefix của hashForLookup (cùng derived key)', () => {
      const a = service.hashForLog('user-abc');
      const c = service.hashForLog('user-xyz');
      expect(a).not.toBe(c);
      expect(service.hashForLookup('user-abc').startsWith(a)).toBe(true);
    });
  });

});
