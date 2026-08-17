/**
 * HMAC request signing for service-to-service webhooks (v1 scheme).
 *
 * Canonical string — identical construction on BOTH sides (the receiver's
 * WebhookHmacGuard mirrors this byte-for-byte; see docs/cskh-chat-webhook-auth.md):
 *
 *   v1:{timestamp}:{METHOD}:{pathAndQuery}:{sha256Hex(bodyBytes | empty)}
 *
 * - pathAndQuery = URL pathname + search EXACTLY as sent (the receiver uses
 *   request.raw.url — never re-encode). Signing the query makes GET identity
 *   params (?userId=…) tamper-proof in transit.
 * - bodyHash = sha256 of the exact body string handed to fetch (or the empty
 *   string for GET / bodyless requests).
 *
 * Headers produced: `x-timestamp` (epoch seconds) + `x-signature` (`v1=<64-hex>`).
 * The `v1=` prefix keeps the scheme upgradable (v2 / dual-secret rotation)
 * without a breaking wire change. Pure functions, node:crypto only — no deps.
 */
import { createHash, createHmac } from 'crypto';

export interface WebhookSignatureHeaders {
  'x-timestamp': string;
  'x-signature': string;
}

/** Build the canonical string that both signer and verifier HMAC. */
export function buildCanonicalString(
  timestamp: string,
  method: string,
  pathAndQuery: string,
  body?: string | Buffer,
): string {
  const bodyHash = createHash('sha256').update(body ?? '').digest('hex');
  return `v1:${timestamp}:${method.toUpperCase()}:${pathAndQuery}:${bodyHash}`;
}

/**
 * Sign a webhook request. `url` is the exact URL handed to fetch — its
 * pathname+search becomes part of the signed canonical string.
 * `timestampSeconds` is injectable for deterministic tests.
 */
export function signWebhook(
  secret: string,
  method: string,
  url: string,
  body?: string | Buffer,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): WebhookSignatureHeaders {
  const ts = String(timestampSeconds);
  const { pathname, search } = new URL(url);
  const canonical = buildCanonicalString(ts, method, pathname + search, body);
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  return { 'x-timestamp': ts, 'x-signature': `v1=${signature}` };
}
