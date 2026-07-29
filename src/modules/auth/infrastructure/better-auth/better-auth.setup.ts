import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { phoneNumber } from 'better-auth/plugins';
import { genericOAuth } from 'better-auth/plugins';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { usersTable } from '../persistence/drizzle/schema/user.schema';
import { providerLinksTable } from '../persistence/drizzle/schema/provider-link.schema';
import { sessionsTable } from '../persistence/drizzle/schema/session.schema';
import { verificationTable } from '../persistence/drizzle/schema/verification.schema';
import { PiiEncryptionService } from '../persistence/encryption/pii-encryption.service';
import { PortRegistry } from '@shared/port';

/**
 * Create and configure the better-auth instance.
 *
 * better-auth handles:
 * - Phone/OTP authentication (via phoneNumber plugin)
 * - OAuth providers: Google, Facebook, Apple (built-in)
 * - Zalo OAuth (via genericOAuth plugin — not a built-in provider)
 * - Session management (cookie-based, 7-day refresh)
 *
 * This is the BFF↔Frontend session concern.
 * BFF→downstream JWT propagation uses jose (Story 1.4).
 *
 * CRITICAL: better-auth writes directly to the database via drizzleAdapter.
 * We intercept writes using databaseHooks to encrypt PII fields (phone, email)
 * and generate HMAC blind index hashes BEFORE data hits the database.
 * Without these hooks, better-auth would store plaintext in columns designed
 * for AES-256-GCM ciphertext, causing decrypt() to crash on read.
 */
/**
 * Read the phone number from a better-auth user record.
 *
 * The `phoneNumber` plugin stores the phone in `phoneNumber` (its own column),
 * while the BFF encryption layer targets the `phone` column. This helper reads
 * whichever is present so the hook can encrypt + blind-index the value regardless
 * of which better-auth code path populated the record.
 */
function readPhone(user: Record<string, unknown>): string | undefined {
  return (
    (user.phoneNumber as string | undefined) ??
    (user.phone as string | undefined) ??
    undefined
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBetterAuth(db: unknown, configService: ConfigService, portRegistry: PortRegistry): any {
  const logger = new Logger('BetterAuth');

  // Initialize PII encryption for database hooks
  const piiEncryption = new PiiEncryptionService(configService);

  // OTP delivery is delegated to the notification port (lean BFF — auth doesn't
  // send SMS directly). The ZaloOaClient (ZNS) will live in the notification live
  // adapter when the downstream notification service is wired.
  // Only enable social providers when credentials are configured
  const socialProviders: Record<string, unknown> = {};

  const googleClientId = configService.get('GOOGLE_CLIENT_ID', '');
  const googleClientSecret = configService.get('GOOGLE_CLIENT_SECRET', '');
  if (googleClientId && googleClientSecret && !googleClientId.startsWith('stub-')) {
    socialProviders.google = { clientId: googleClientId, clientSecret: googleClientSecret };
  }

  const facebookClientId = configService.get('FACEBOOK_CLIENT_ID', '');
  const facebookClientSecret = configService.get('FACEBOOK_CLIENT_SECRET', '');
  if (facebookClientId && facebookClientSecret && !facebookClientId.startsWith('stub-')) {
    socialProviders.facebook = { clientId: facebookClientId, clientSecret: facebookClientSecret };
  }

  const appleClientId = configService.get('APPLE_CLIENT_ID', '');
  const appleClientSecret = configService.get('APPLE_CLIENT_SECRET', '');
  if (appleClientId && appleClientSecret && !appleClientId.startsWith('stub-')) {
    socialProviders.apple = {
      clientId: appleClientId,
      clientSecret: appleClientSecret,
      mapProfileToUser: (profile: Record<string, unknown>) => ({
        email: (profile.email as string) ?? `${profile.sub}@apple.placeholder.local`,
      }),
    };
  }

  // Base URL — required by better-auth for callback/redirect URLs
  const baseURL = configService.get('BETTER_AUTH_URL', 'http://localhost:3000');

  // Additional trusted origins (e.g. a separate-origin Next.js frontend).
  // better-auth always trusts `baseURL`; this adds more origins for cross-origin
  // clients. Comma-separated via BETTER_AUTH_TRUSTED_ORIGINS env var.
  // In production, better-auth rejects requests whose Origin/Host isn't trusted,
  // so any FE served from a different port/host must be listed here.
  const trustedOrigins = (configService.get<string>('BETTER_AUTH_TRUSTED_ORIGINS', '') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return betterAuth({
    baseURL,
    ...(trustedOrigins.length ? { trustedOrigins } : {}),
    // Native-only client (Expo/RN). better-auth's origin/CSRF check rejects
    // requests that carry a session cookie but no `Origin` header — and RN fetch
    // never sends one (Origin is a browser concept). That blocks authenticated
    // /api/auth/* calls with "MISSING_OR_NULL_ORIGIN" whenever the persisted
    // session cookie is attached. CSRF-via-Origin protects BROWSER cookie auth
    // from cross-site forgery, which doesn't apply to a native app, so disabling
    // it is safe here. If a browser FE is ever added, remove this and rely on
    // trustedOrigins instead.
    advanced: { disableCSRFCheck: true },
    // Rate limit: demo is public — without this, anyone can spam send-otp.
    // 10 requests / 60s / IP across all better-auth endpoints (send-otp, verify,
    // sign-out, etc.). Memory storage (sufficient for single-instance demo).
    // Prod: tighten to ~3 OTP/hour + use database/Redis storage for multi-instance.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      storage: 'memory',
    },
    database: drizzleAdapter(db as Parameters<typeof drizzleAdapter>[0], {
      provider: 'pg',
      schema: {
        user: usersTable,
        session: sessionsTable,
        account: providerLinksTable, // Map provider links as better-auth "accounts"
        verification: verificationTable, // Required by phoneNumber plugin for OTP
      },
    }),
    /**
     * Database hooks — intercept better-auth writes to encrypt PII.
     *
     * better-auth doesn't know about our encryption layer. These hooks
     * ensure every write path (user create, user update) encrypts
     * phone/email and generates blind index hashes before data
     * reaches the database.
     *
     * Read paths (getSession, getUser) receive encrypted data — our
     * UserRepository decrypts on read using PiiEncryptionService.
     */
    databaseHooks: {
      user: {
        // Encrypt PII before creating a new user
        create: {
          before: async (user) => {
            const rawEmail = user.email as string | undefined;
            // better-auth phoneNumber plugin stores the phone in `phoneNumber`,
            // NOT `phone` — read it so the BFF `phone`/`phone_hash` columns get populated.
            const rawPhone = readPhone(user);

            return {
              data: {
                ...user,
                email: piiEncryption.encryptIfNeeded(rawEmail) ?? undefined,
                phone: piiEncryption.encryptIfNeeded(rawPhone) ?? undefined,
                emailHash: piiEncryption.hashIfNeeded(rawEmail),
                phoneHash: piiEncryption.hashIfNeeded(rawPhone),
              },
            };
          },
        },
        // Encrypt PII before updating a user
        update: {
          before: async (user) => {
            const rawEmail = user.email as string | undefined;
            const rawPhone = readPhone(user);

            const encrypted: Record<string, unknown> = { ...user };

            if (rawEmail !== undefined) {
              encrypted.email = piiEncryption.encryptIfNeeded(rawEmail) ?? undefined;
              encrypted.emailHash = piiEncryption.hashIfNeeded(rawEmail);
            }
            if (rawPhone !== undefined) {
              encrypted.phone = piiEncryption.encryptIfNeeded(rawPhone) ?? undefined;
              encrypted.phoneHash = piiEncryption.hashIfNeeded(rawPhone);
            }

            return { data: encrypted };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: false, // No username/password — FR1: only Phone/OTP, Zalo, Social
    },
    user: {
      // Declare the BFF-owned columns as additionalFields so better-auth's
      // data conversion layer (convertToDB) PERSISTS them. Without this, values
      // the databaseHooks set on these columns are silently stripped before the
      // drizzle INSERT (verified via SQL logging — they were bound as `default`).
      // `input: false`  → clients cannot set these (server-computed by hooks).
      // `returned: false` → omitted from API responses (never expose hashes).
      additionalFields: {
        emailHash: {
          type: 'string',
          required: false,
          input: false,
          returned: false,
        },
        phoneHash: {
          type: 'string',
          required: false,
          input: false,
          returned: false,
        },
        phone: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    plugins: [
      // Phone/OTP Authentication
      phoneNumber({
        sendOTP: async ({ phoneNumber: phone, code }) => {
          // Dev log so QA/dev can read the OTP from the backend log. Use console.log
          // (not the pino logger) so the line flushes to the terminal immediately —
          // pino's sonic-boom buffers ~16KB, which hides a single OTP line during
          // `npm run start:dev` (piped stdout). console.log flushes on the newline.
          if (process.env.NODE_ENV !== 'production') {
            console.log(
              `[BetterAuth] [DEV] OTP for ${phone.slice(-4).padStart(phone.length, '*')}: ${code}`,
            );
          }
          // Delegate delivery to the notification port (lean BFF — auth doesn't send SMS).
          try {
            await portRegistry.execute('notification', 'send-otp', { phoneNumber: phone, code });
          } catch (err) {
            logger.warn(`OTP delivery via notification failed: ${(err as Error).message}`);
          }
        },
        signUpOnVerification: {
          getTempEmail: (phone: string) => `${phone}@cskh.placeholder.local`,
          getTempName: (phone: string) => phone,
        },
        otpLength: 6,
        expiresIn: 300, // 5 minutes
        allowedAttempts: 3, // Brute-force protection
      }),
      // Zalo Custom OAuth Provider (not built-in)
      genericOAuth({
        config: [
          {
            providerId: 'zalo',
            clientId: configService.get('ZALO_APP_ID', ''),
            clientSecret: configService.get('ZALO_APP_SECRET', ''),
            authorizationUrl: 'https://oauth.zaloapp.com/v4/permission',
            tokenUrl: 'https://oauth.zaloapp.com/v4/access_token',
            userInfoUrl: 'https://graph.zalo.me/v2.0/me',
            scopes: ['id', 'name', 'picture'],
            getUserInfo: async (tokens) => {
              const res = await fetch(
                `https://graph.zalo.me/v2.0/me?access_token=${tokens.accessToken}`,
                { headers: { 'Content-Type': 'application/json' } },
              );
              const data = await res.json() as Record<string, unknown>;
              return {
                id: String(data.id),
                name: data.name as string,
                email: `${data.id}@zalo.placeholder.local`,
                emailVerified: false,
                image: (data.picture as { data: { url: string } } | undefined)?.data?.url,
              };
            },
            mapProfileToUser: (profile: Record<string, unknown>) => ({
              name: profile.name as string,
            }),
          },
        ],
      }),
    ],
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    session: {
      expiresIn: 7 * 24 * 60 * 60, // 7 days (NFR-S5)
      updateAge: 24 * 60 * 60, // Refresh session every 24h
      freshAge: 24 * 60 * 60, // Session "fresh" within 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min cookie cache
        strategy: 'compact',
      },
    },
  });
}

/**
 * Type for the better-auth instance.
 * Exported for use in controllers and the auth module.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BetterAuthInstance = ReturnType<typeof betterAuth>;
