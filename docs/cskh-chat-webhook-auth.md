# CSKH Chat Webhook Auth — HMAC v1

Wire: **app-tu-phuc-vu** (customer BFF) → **omichannel_be** `POST /webhooks/app`,
`GET /webhooks/app/conversation`. Trước khi có HMAC, 2 endpoint này không auth +
reachable từ internet (`omnichannel-be-dev.dichvunuoc.vn`) — `userId` trong payload
là identity duy nhất → impersonation + thread disclosure (IDOR). Xem plan
`#3 cluster security gates` (2026-08-14).

## Scheme

**Canonical string** (byte-identical hai phía — signer:
`app-tu-phuc-vu/src/libs/shared/security/hmac-sign.util.ts`, verifier:
`omichannel_be/src/libs/shared/security/webhook-hmac.guard.ts`):

```
v1:{timestamp}:{METHOD}:{pathAndQuery}:{sha256Hex(bodyBytes | empty)}
```

| Phần | Caller (BFF) | Receiver (omichannel) |
|---|---|---|
| `timestamp` | `Math.floor(Date.now()/1000)` | parse `x-timestamp` |
| `METHOD` | `'POST'`/`'GET'` | `request.method` |
| `pathAndQuery` | pathname+search của URL đưa vào `fetch` | `request.raw.url` (giữ nguyên bytes, không re-encode) |
| `bodyHash` | sha256 hex chuỗi body gửi (`JSON.stringify(payload)`) | sha256 hex `request.rawBody` (POST thiếu rawBody → hash chuỗi rỗng) |

**Headers**: `x-timestamp: <epoch-sec>`, `x-signature: v1=<64-hex-lowercase>`.
MAC = `HMAC-SHA256(secret, canonical)`, hex. Prefix `v1=` để upgrade scheme sau
này (v2, dual-secret rotation) không break wire.

**Query nằm trong canonical** → `?userId=…` của GET tamper-proof — đây là phần
đóng IDOR thread-read ở tầng transport (không cần check receiver thêm).

## Verify (receiver, fail-closed, theo thứ tự)

1. `WEBHOOK_HMAC_SECRET` unset → **403** "Service configuration error" + ERROR log
   (config alarm — precedent `inter-service-api-key.guard.ts` của BFF).
2. Thiếu/malformed `x-timestamp`/`x-signature` → **401**.
3. `|now − ts| > 300s` → **401** (replay window ±5 phút; log timestamp delta để
   phát hiện clock skew giữa node).
4. Recompute MAC → `crypto.timingSafeEqual` → mismatch **401**.

Replay trong window 5 phút: POST bị trung hòa bởi idempotency key
`${channel}:${externalMessageId}` của receiver; GET chỉ re-read thread. Đủ ở tier
này; strict hơn (nonce cache Redis) = out of scope.

## Secrets

- Caller: `CSKH_WEBHOOK_HMAC_SECRET` (BFF). Receiver: `WEBHOOK_HMAC_SECRET`
  (omichannel). **Cùng giá trị**, ≥32 bytes (`openssl rand -hex 32`).
- K8s: BFF demo overlay commit trong `k8s/overlays/demo/secret.yaml` (convention
  demo-dummy của file đó); omnichannel **patch server-side** vào Secret
  `omnichannel-be-secret` cùng giá trị (Secret đó server-side theo comment trong
  `deploy/k8s/omnichannel-k8s.yaml`). KHÔNG để BFF secret chỉ ở server-side —
  `kubectl apply -k` sẽ wipe key, wire chết ngầm.
- **One secret per caller-pair**: service thứ 2 gọi /webhooks/* thì sinh secret
  riêng + guard verify theo danh sách secret (không share).

## Rotation

1. Gen secret mới → patch Secret omnichannel (server-side) + update BFF demo
   secret → apply BFF (receiver verify theo secret cũ trong window? — KHÔNG có
   dual-verify ở v1) → **deploy cả 2 trong cùng session** (giống rollout P1→P2):
   receiver trước với secret mới sẽ 401 caller cũ — chấp nhận gap ngắn ở dev;
   prod cần dual-secret (v2).
2. Smoke sau rotation: gửi chat thành công + thread đọc lại được.

## Curl verify (receiver)

```bash
SECRET=<shared-secret>; TS=$(date +%s)
BODY='{"userId":"u1","messageId":"m1","text":"hi"}'
HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $2}')
CANON="v1:${TS}:POST:/webhooks/app:${HASH}"
SIG=$(printf '%s' "$CANON" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST https://omnichannel-be-dev.dichvunuoc.vn/webhooks/app \
  -H "Content-Type: application/json" -H "x-timestamp: ${TS}" -H "x-signature: v1=${SIG}" \
  -d "$BODY"
# Unsigned cùng request → 401. Sai secret → 401. Secret thiếu trên receiver → 403.
```

## Failure semantics (caller)

- 401/403 → `{sent:false, reason:'unauthorized'}` (4xx không trip circuit breaker).
- URL set + secret thiếu → `{sent:false, reason:'config'}` + ERROR log lúc boot.
- 5xx/timeout/unreachable → adapter throw `PortDownstreamException`/
  `PortTimeoutException` (CB đếm infra failure) → service map
  `{sent:false, reason:'server-error'}` — FE vẫn thấy shape 200.
- `CSKH_WEBHOOK_URL` unset → mock mode (log, `{sent:true}`) — không đổi.

## Escape hatch receiver

`@SkipWebhookHmac()` (Reflector metadata) — cho phép route webhook provider
riêng (Zalo OA MAC, Facebook X-Hub-Signature) khi build kênh đó, thay vì HMAC
nội bộ. KHÔNG dùng cho /webhooks/app.
