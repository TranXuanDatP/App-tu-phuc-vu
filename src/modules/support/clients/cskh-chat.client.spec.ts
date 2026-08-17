/**
 * CskhChatAdapter — HMAC wire auth contract tests.
 *
 * Khóa 3 lớp: (1) signing đúng canonical v1 (POST body hash + GET query hash —
 * recompute bằng node:crypto trực tiếp trong test, không phụ thuộc util), (2)
 * failure semantics (401→reason unauthorized KHÔNG throw; infra→typed exception
 * cho circuit breaker; secret thiếu→config; mock mode giữ nguyên), (3) wire
 * integration thật: http.createServer verify signature server-side.
 */
import { createHash, createHmac } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { CskhChatAdapter } from './cskh-chat.client';
import {
  PortDownstreamException,
  PortTimeoutException,
} from '@shared/port/port-exceptions';

const SECRET = 'test-hmac-secret-0123456789abcdef0123456789abcdef';
const BASE = 'http://cskh.test';

function makeAdapter(env: Record<string, string | undefined>): CskhChatAdapter {
  return new CskhChatAdapter({ get: (k: string) => env[k] } as any);
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function expectedSignature(
  ts: string,
  method: string,
  pathAndQuery: string,
  body?: string,
): string {
  const canonical = `v1:${ts}:${method}:${pathAndQuery}:${sha256Hex(body ?? '')}`;
  return `v1=${createHmac('sha256', SECRET).update(canonical).digest('hex')}`;
}

describe('CskhChatAdapter — HMAC wire auth', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ── Mock mode (CSKH_WEBHOOK_URL unset) — regression guard ──────────────────

  describe('mock mode', () => {
    it('sendMessage returns {sent:true} and never calls fetch when URL unset', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      const adapter = makeAdapter({});
      const r = await adapter.execute('send-message', { userId: 'u1', text: 'hi' });
      expect(r).toEqual({ sent: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('getConversation returns empty thread when URL unset', async () => {
      const adapter = makeAdapter({});
      const r = await adapter.execute('get-conversation', { userId: 'u1' });
      expect(r).toEqual({ conversationId: null, messages: [] });
    });
  });

  // ── Config guard ────────────────────────────────────────────────────────────

  it('URL set + secret unset → {sent:false, reason:"config"}, no HTTP call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE });
    const r = (await adapter.execute('send-message', {
      userId: 'u1',
      text: 'hi',
    })) as any;
    expect(r).toEqual({ sent: false, reason: 'config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Signing contract (recomputed independently in-test) ────────────────────

  describe('POST /webhooks/app signature', () => {
    it('sends x-timestamp + x-signature over the exact body (v1 canonical)', async () => {
      let captured: { headers: Record<string, string>; body: string } | undefined;
      global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
        captured = { headers: init.headers as Record<string, string>, body: init.body as string };
        return { ok: true, status: 200, json: async () => ({ data: { ok: true, conversationId: 'c1' } }) } as any;
      }) as any;

      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      await adapter.execute('send-message', { userId: 'usr-1', text: 'xin chào' });

      expect(captured).toBeDefined();
      const ts = captured!.headers['x-timestamp'];
      // Timestamp hiện tại (±120s) và numeric
      expect(Math.abs(Number(ts) - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(120);
      // Signature = HMAC-SHA256(secret, v1:{ts}:POST:/webhooks/app:{sha256(body)})
      // recompute từ CHUỖI BODY THẬT gửi đi — pin format, không phụ thuộc util.
      expect(captured!.headers['x-signature']).toBe(expectedSignature(ts, 'POST', '/webhooks/app', captured!.body));
      expect(captured!.headers['Content-Type']).toBe('application/json');
      // Payload identity giữ nguyên contract
      const payload = JSON.parse(captured!.body);
      expect(payload.userId).toBe('usr-1');
      expect(payload.text).toBe('xin chào');
      expect(typeof payload.messageId).toBe('string');
    });

    it('messageId là uuid riêng biệt mỗi call (không còn app-<userId>-<ts>)', async () => {
      const bodies: string[] = [];
      global.fetch = jest.fn(async (_u: string, init: RequestInit) => {
        bodies.push(init.body as string);
        return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) } as any;
      }) as any;

      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      await adapter.execute('send-message', { userId: 'u1', text: 'a' });
      await adapter.execute('send-message', { userId: 'u1', text: 'b' });

      const [m1, m2] = bodies.map((b) => JSON.parse(b).messageId);
      expect(m1).not.toBe(m2);
      expect(m1).not.toMatch(/^app-u1-\d+$/);
    });
  });

  describe('GET /webhooks/app/conversation signature', () => {
    it('signs method+query string (userId tamper-proof) with empty-body hash', async () => {
      let capturedUrl: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;
      global.fetch = jest.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init.headers as Record<string, string>;
        return { ok: true, status: 200, json: async () => ({ data: { conversationId: 'c1', messages: [] } }) } as any;
      }) as any;

      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      await adapter.execute('get-conversation', { userId: 'usr 1' }); // space → %20

      expect(capturedUrl).toBe(`${BASE}/webhooks/app/conversation?userId=${encodeURIComponent('usr 1')}`);
      const ts = capturedHeaders!['x-timestamp'];
      // Canonical gồm cả query string — đây là phần đóng IDOR GET ở tầng transport
      expect(capturedHeaders!['x-signature']).toBe(
        expectedSignature(ts, 'GET', `/webhooks/app/conversation?userId=${encodeURIComponent('usr 1')}`),
      );
    });
  });

  // ── Failure semantics ───────────────────────────────────────────────────────

  describe('failure semantics', () => {
    it('401 → {sent:false, reason:"unauthorized"} — KHÔNG throw (4xx không trip CB)', async () => {
      global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any;
      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      const r = (await adapter.execute('send-message', { userId: 'u1', text: 'x' })) as any;
      expect(r).toEqual({ sent: false, reason: 'unauthorized' });
    });

    it('500 → throw PortDownstreamException(statusCode=500) cho circuit breaker', async () => {
      global.fetch = jest.fn(async () => ({ ok: false, status: 500, statusText: 'ISE', json: async () => ({}) })) as any;
      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      await expect(
        adapter.execute('send-message', { userId: 'u1', text: 'x' }),
      ).rejects.toThrow(PortDownstreamException);
    });

    it('timeout (AbortError/TimeoutError) → throw PortTimeoutException', async () => {
      const timeoutError = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      global.fetch = jest.fn(async () => {
        throw timeoutError;
      }) as any;
      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      await expect(
        adapter.execute('send-message', { userId: 'u1', text: 'x' }),
      ).rejects.toThrow(PortTimeoutException);
    });

    it('network reject → throw PortDownstreamException (unreachable = infra)', async () => {
      global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
      }) as any;
      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      await expect(
        adapter.execute('send-message', { userId: 'u1', text: 'x' }),
      ).rejects.toThrow(PortDownstreamException);
    });

    it('GET 401 → empty thread soft-fail (read degrade, không throw)', async () => {
      global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any;
      const adapter = makeAdapter({ CSKH_WEBHOOK_URL: BASE, CSKH_WEBHOOK_HMAC_SECRET: SECRET });
      const r = await adapter.execute('get-conversation', { userId: 'u1' });
      expect(r).toEqual({ conversationId: null, messages: [] });
    });
  });

  // ── Wire integration: signing path E2E với http server thật ────────────────

  describe('wire integration (real HTTP server verifies the signature)', () => {
    it('server-side verify: canonical reconstruct từ raw url + raw body → match → 200', async () => {
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const ts = (req.headers['x-timestamp'] as string) ?? '';
          const sig = (req.headers['x-signature'] as string) ?? '';
          // Receiver-side verify (giống WebhookHmacGuard của omnichannel_be):
          // canonical = v1:{ts}:{METHOD}:{req.url — exact bytes}:{sha256(rawBody)}
          const canonical = `v1:${ts}:${req.method}:${req.url}:${sha256Hex(rawBody)}`;
          const expected = `v1=${createHmac('sha256', SECRET).update(canonical).digest('hex')}`;
          if (expected === sig) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: { ok: true, conversationId: 'conv-e2e', messageId: 'm-e2e' } }));
          } else {
            res.statusCode = 401;
            res.end(JSON.stringify({ message: 'invalid signature' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const adapter = makeAdapter({
          CSKH_WEBHOOK_URL: `http://127.0.0.1:${port}`,
          CSKH_WEBHOOK_HMAC_SECRET: SECRET,
        });
        const r = (await adapter.execute('send-message', {
          userId: 'usr-e2e',
          text: 'hello over the wire',
        })) as any;
        // Full round-trip: signed POST → server verify → sent:true + conversationId
        expect(r).toEqual({ sent: true, conversationId: 'conv-e2e', messageId: 'm-e2e' });
      } finally {
        server.close();
      }
    });
  });
});
