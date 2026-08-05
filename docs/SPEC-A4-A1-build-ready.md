# Spec build-ready — A4 (mock customer-service) + A1 (binding domain)

> Mang spec này sang Claude Code (nơi thấy repo thật) để thực thi. Mọi shape/position
> tham chiếu convention app-tu-phuc-vu: Drizzle schema, NestJS module 4-part, PortRegistry
> mock adapter, better-auth setup, contract test pattern (test/integration/*.spec.ts).
>
> **Revision 2** — patched sau security review: 🔴 resolve/bind oracle (session-scoped only),
> 🟠 lockout per-customerRef ceiling, 🟠 hint độc lập bí mật + disambiguation theo địa chỉ,
> 🟠 omnichannel bypass (cross-team flag). Chi tiết ở §0a Security Fixes.

---

## 0a. Security Fixes (revision 2 — áp dụng TRƯỚC khi build bất kỳ phần nào)

### 🔴 Fix 1: resolve/bind oracle → session-scoped only

**Vấn đề:** resolve nhận phone tùy ý từ client, bind nhận customerRef tùy ý. Kẻ có session hợp lệ → resolve phone nạn nhân → brute-force bind trên customerRef nạn nhân.

**Fix:** (giống code gốc 839443c, spec cũ đã regress)

1. **resolve KHÔNG nhận phone từ client.** Dùng `session.phoneNumber` (số đã OTP-verify). Không có endpoint POST /resolve/phone public — resolve là **nội bộ**, BFF tự đọc session.
2. **bind chỉ chấp nhận customerRef từ resolve của chính session đó.** Flow:
   ```
   POST /auth/bind-init  (không body — BFF dùng session.phoneNumber)
     → resolve → customerRef → lưu vào **signed short-lived token** (hoặc Redis keyed by sessionId, TTL 5 phút)
     → return { candidates: [{ customerRef, maskedHint }] } (cho N-match disambiguation)
   POST /auth/bind { customerRef: <từ init, KHÔNG free-form>, secretType, secretValue }
     → BFF verify customerRef thuộc về token/session này (nếu không → 400)
     → call verify(customerRef, secret) → bind
   ```
3. **Không bao giờ expose endpoint resolve/phone cho client.** Resolve là server-internal.

### 🟠 Fix 2: Lockout per-customerRef ceiling

**Vấn đề:** Lockout per-(userId, customerRef) cho phép kẻ tạo nhiều account → 3×N thử trên cùng nạn nhân.

**Fix:** Thêm **per-customerRef global counter** (table hoặc Redis):
```
fail_count:{customerRef} — đếm sai trên TOÀN HỆ, không phân biệt userId
Threshold: 10 sai trong 1h → lock customerRef đó cho MỌI userId trong 24h
```
Ghi vào audit. Alert nếu pattern mass-attempt phát hiện.

### 🟠 Fix 3: maskedHint độc lập với bí mật + disambiguation theo địa chỉ

**Vấn đề:** Hint "QN-***45" lộ 2 số cuối mã KH — nếu factor = mã KH, hint thu nhỏ không gian bí mật.

**Fix:**
1. **maskedHint chỉ dùng address (đường + quận):** `"12 Lê Lợi, Hải Châu"` vs `"5 Trần Phú, Sơn Trà"`. Khách nhận ra nhà mình; kẻ không dò được mã KH.
2. **Không bao giờ hint chứa:** mã KH, số hợp đồng, số tiền, bất kỳ thứ có thể là factor.
3. **Mask format:**
   - 1-match: `"Nguyễn V*** • [địa chỉ prefix]"` — đủ nhận diện, không đủ enumerate
   - N-match: candidates khác nhau theo địa chỉ: `"Lê M*** • Lê Lợi, Hải Châu"` vs `"Lê M*** • Trần Phú, Sơn Trà"`

### 🟠 Fix 4: Omnichannel auto-resolve bypass (cross-team flag)

**Vấn đề:** App siết binding trước data, nhưng omnichannel auto-resolve số đó → staff thấy full Customer 360 mà không cần binding proof. Kênh yếu (auto) thành đường vòng.

**Flag (không block A1, ghi vào part B/C):**
- Số chưa có binding verified → omnichannel resolve **KHÔNG auto-associate full data**. Chỉ hiện "unverified contact" (tên mask, không hóa đơn/hợp đồng).
- Binding verified (app) → publish event `CustomerBound(customerId, phone, verifiedAt)` → omnichannel nghe → nâng edge lên "verified" → mở full 360 cho staff.
- Đây là spec gửi team omnichannel, KHÔNG phải code A1.

---

## A4 — Mock Customer-Service Server

### Vị trí trong repo
`src/modules/account/clients/customer-service-mock.adapter.ts` (IPortAdapter mới, cùng kiểu
MockCustomerProfileAdapter). Không thay thế mock hiện có — là mock cho **wire thật**
(CUSTOMER_SERVICE_URL mode), mock hiện là mock cho **port convention** (PortRegistry).

### Cách hoạt động
Khi `CUSTOMER_SERVICE_URL=mock://customer-service`, BFF thay vì fetch HTTP, gọi trực tiếp
adapter này. Thêm check trong `resolveFromCustomerService`:
```ts
if (this.customerServiceUrl === 'mock://customer-service') {
  return this.mockCustomerService.resolve(phone);
}
```
Mock inject qua DI (ConfigService đọc URL → factory chọn HTTP fetch hoặc mock adapter).

### 4 Endpoint (method) — mock phải mô phỏng ĐÚNG hành vi an toàn

#### resolve/phone
```ts
interface ResolveResult {
  status: 'none' | 'one' | 'many';
  customerRef?: string;        // ref nội bộ (KHÔNG phải customerId thật, để tránh leak)
  maskedHint?: string;         // vd "Nguyễn V*** • HĐ #***45" — đủ để khách nhận ra, không đủ để enumerate
  candidates?: Array<{ customerRef: string; maskedHint: string }>;  // chỉ khi status='many'
}
```

**Mock data (seed) — address-based hints (Fix 3):**
```ts
const SEED_CUSTOMERS = [
  { customerRef: 'REF-001', fullName: 'Nguyễn Văn Nam', phone: '+84901234567', customerId: 'QN-0912345', lastInvoiceAmount: 247500, addressPrefix: '12 Lê Lợi, Hải Châu' },
  { customerRef: 'REF-002', fullName: 'Trần Thị Hoa', phone: '+84912345678', customerId: 'QN-0888891', lastInvoiceAmount: 189000, addressPrefix: '45 Trần Phú, Sơn Trà' },
  { customerRef: 'REF-003', fullName: 'Lê Minh', phone: '+84987654321', customerId: 'QN-0777123', lastInvoiceAmount: 312000, addressPrefix: 'Lê Lợi, Hải Châu' },
  { customerRef: 'REF-004', fullName: 'Lê Minh Khôi', phone: '+84987654321', customerId: 'QN-0666001', lastInvoiceAmount: 156000, addressPrefix: 'Trần Phú, Sơn Trà' },
  // REF-003 + REF-004 cùng phone → N-match scenario (khác theo địa chỉ, KHÔNG theo mã KH)
];
```

**Hành vi an toàn mock phải encode (Fix 1 + Fix 3 applied):**
- 0-match: `{ status: 'none' }` — response **identical** mọi lần, không透露 phone có trong hệ thống không
- 1-match: `{ status: 'one', customerRef: 'REF-001', maskedHint: 'Nguyễn V*** • 12 Lê Lợi, Hải Châu' }` — hint theo ĐỊA CHỈ (Fix 3), KHÔNG theo mã KH/số HĐ
- N-match: `{ status: 'many', candidates: [{ customerRef: 'REF-003', maskedHint: 'Lê M*** • Lê Lợi, Hải Châu' }, { customerRef: 'REF-004', maskedHint: 'Lê M*** • Trần Phú, Sơn Trà' }] }` — disambiguation theo địa chỉ
- **Không bao giờ** trả `customerId` thật, `fullName` đầy đủ, `phone`, `mã KH`, `số hợp đồng`, `số tiền` ở bước resolve (Fix 3: hint độc lập với mọi factor có thể làm bí mật)
- **Không bao giờ nhận phone từ client** (Fix 1): resolve dùng session.phoneNumber, endpoint là server-internal

#### verify
```ts
interface VerifyRequest { customerRef: string; secretType: 'last_invoice_amount' | 'ma_kh'; secretValue: string; }
interface VerifyResult { verified: boolean; }
```

**Mock data (secret stored server-side, never returned):**
```ts
const SEED_SECRETS: Record<string, { type: string; value: string }> = {
  'REF-001': { type: 'last_invoice_amount', value: '247500' },
  'REF-002': { type: 'last_invoice_amount', value: '189000' },
  'REF-003': { type: 'last_invoice_amount', value: '312000' },
  'REF-004': { type: 'last_invoice_amount', value: '156000' },
};
```

**Hành vi an toàn mock phải encode:**
- Correct secret → `{ verified: true }`
- Wrong secret → `{ verified: false }` — response **identical shape** (không khác biệt giữa "wrong value" và "customerRef not found")
- **Không bao giờ** trả giá trị thật (`247500`) trong response

#### profile (post-binding only)
```ts
// Chỉ gọi được khi caller có binding verified cho customerRef này
interface ProfileResult { customerId: string; fullName: string; classification: string; address: {...}; contactInfo: {...}; status: string; }
```
Mock trả full CustomerProfile (giống CustomerProfileResponse hiện có). BFF chỉ gọi khi binding verified.

#### resolve/channel (cho omnichannel future, stub trong mock)
```ts
// { channel: 'APP'|'ZALO', channelId: string } → ResolveResult (giống resolve/phone)
// Mock: chỉ APP channel có data, ZALO trả 'none'
```

### Contract test cho mock (test/integration/customer-service-mock-contract.spec.ts)
```
resolve phone unknown     → { status: 'none' } × 2 calls → response deep-equal (không enumerate)
resolve phone 1-match     → { status: 'one', customerRef, maskedHint } — hint theo ĐỊA CHỈ, no customerId/fullName/phone/mã KH
resolve phone N-match     → { status: 'many', candidates[2] } — candidates khác theo địa chỉ, no customerId
verify correct            → { verified: true }
verify wrong value        → { verified: false }
verify unknown customerRef → { verified: false } — identical to wrong value
profile without binding   → throw/deny (BFF layer, không phải mock)
**NOTE: resolve test dùng session.phone (server-side), KHÔNG phải client param (Fix 1)**
```

---

## A1 — Binding Domain

### Thứ tự build (deny-first)
```
1. Schema + migration (binding entity)
2. Session scoping (deny-by-default) ← TEST ĐẦU TIÊN
3. Challenge endpoint (factor pluggable)
4. Rate-limit + lockout
5. Audit log
6. Re-verify triggers
```

### A1.1 — Binding entity + migration

**Drizzle schema** (migration 0006):
```ts
// src/modules/auth/infrastructure/persistence/drizzle/schema/binding.schema.ts
export const customerBindingsTable = pgTable('customer_bindings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 256 }).not(),  // better-auth userId
  customerRef: varchar('customer_ref', { length: 128 }).not(),  // từ resolve (KHÔNG lưu customerId thật ở đây nếu chưa bind)
  customerId: varchar('customer_id', { length: 512 }),  // NULL cho đến khi verify pass → populate (ENCRYPTED via PiiEncryptionService — Fix 5b)
  status: varchar('status', { length: 20 }).not().default('pending'),  // pending | verified | revoked
  factorUsed: varchar('factor_used', { length: 50 }),  // 'last_invoice_amount' | 'ma_kh' | ...
  verifiedAt: timestamp('verified_at'),
  deviceInfo: varchar('device_info', { length: 512 }),
  boundAt: timestamp('bound_at'),
  revokedAt: timestamp('revoked_at'),
  revokedReason: varchar('revoked_reason', { length: 256 }),
  createdAt: timestamp('created_at').not().defaultNow(),
  updatedAt: timestamp('updated_at').not().defaultNow(),
});
```

**Indexes:**
- unique(userId, customerRef, status='verified') — 1 active binding per user+customer
- index(customerRef) — lookup by resolve result
- index(userId) — session scoping check

**Migration:** `drizzle/0006_customer_bindings.sql` (run via `scripts/migrate.js`).

### A1.2 — Session scoping (DENY-BY-DEFAULT — build + test đầu tiên)

**Test trước code (TDD):**
```ts
// test/integration/binding-deny-contract.spec.ts
describe('Binding deny-by-default', () => {
  it('should return 403 on every customer-data endpoint when identity has no verified binding', async () => {
    // user exists, has phone, NO binding record → call /billing/invoices, /meters, /contracts, /payments
    // expect 403 on ALL of them
  });

  it('should allow customer-data endpoints when binding is verified', async () => {
    // insert verified binding → same endpoints → expect 200
  });

  it('should deny when binding exists but status=pending (not yet verified)', async () => {
    // insert pending binding → expect 403
  });

  it('should deny when binding is revoked', async () => {
    // insert revoked binding → expect 403
  });
});
```

**Code — middleware hoặc guard:**
```
NestJS Guard: `BindingVerifiedGuard`
- Inject: DATABASE_WRITE_TOKEN (query bindings table)
- Logic: lấy userId từ request → query binding WHERE userId AND status='verified' → nếu không có → 403
- Áp dụng lên mọi controller có data khách (billing, usage, payment, report, service-request, notification)
- KHÔNG áp dụng lên: auth, support/chat (chat dùng userId, không cần customerId)
```

**Quan trọng:** Guard này thay thế `ProfileGate` (mobile-side) ở BFF-side. Hiện tại gate mobile kiểm tra `profile_status='complete'`. Sau W1, gate thật sự là `binding.status='verified'`. Tạm thời cả hai chạy song song.

### A1.3 — Challenge endpoint (Fix 1: session-scoped customerRef)

```
POST /auth/bind-init   (KHÔNG nhận body — BFF dùng session.phoneNumber)
  → resolve(session.phoneNumber) → customerRef
  → lưu customerRef + resolve result vào Redis keyed by sessionId, TTL 5 phút
  → return { status: 'none' | 'one' | 'many', candidates?: [{ customerRef, maskedHint }] }
    (cho N-match disambiguation — khách CHỌN từ danh sách BFF trả về)
  → nếu 'none' → client route tới form đăng ký

POST /auth/bind { customerRef: <chỉ chấp nhận ref từ bind-init của session này>, secretType, secretValue }
  Auth: better-auth session (userId)
  BFF VERIFY customerRef thuộc về Redis entry của session này (nếu không → 400 reject)
  Flow:
    1. Gọi customer-service verify({ customerRef, secretType, secretValue })
    2. verified=true → insert/update binding { userId, customerRef, customerId (encrypted), status:'verified', factorUsed, verifiedAt, deviceInfo }
    3. verified=false → increment failCount (per-userRef AND per-customerRef) → nếu > threshold → lockout
    4. Return { bound: boolean, customerId?: string } — KHÔNG trả secret value
```

**Fix 1 invariants:**
- `customerRef` KHÔNG bao giờ nhận free-form từ client — chỉ từ bind-init của chính session đó.
- bind-init KHÔNG nhận phone từ client — dùng session.phoneNumber.
- Nếu kẻ tấn công có session A, không thể bind customerRef của session B.

**Factor pluggable:** endpoint nhận `secretType` + `secretValue` từ client, forward tới customer-service. BFF **không biết** secret là gì — chỉ forward. Factor cụ thể chốt khi B5 có câu trả lời.

**Session update:** sau bind verified, session (hoặc Redis) ghi `userId → customerId`. Lần request sau, `BindingVerifiedGuard` đọc cache, không query DB mỗi lần.

### A1.4 — Rate-limit + lockout (Fix 2: dual ceiling)

```
DUAL ceiling (cả hai phải có):

Per-(userId, customerRef):
- 3 sai liên tiếp → lock user này ra khỏi customerRef này 15 phút

Per-customerRef GLOBAL (Fix 2):
- 10 sai từ MỌI userId trong 1h → lock customerRef đó cho MỘT MỌI userId trong 24h
- Đếm trong Redis: fail_count:{customerRef} (INCR + EXPIRE 1h; khi > 10 → SET lock 24h)
- Chống kẻ tạo nhiều account → 3×N thử trên cùng nạn nhân

Lock at BFF layer (đừng phụ thuộc customer-service)
Use existing rate-limit infra (better-auth rateLimit config) cho per-userId
Use Redis cho per-customerRef global counter
```

### A1.5 — Audit log

```
Table: binding_audit (migration 0007 hoặc cùng 0006)
Fields: { userId, customerRef, action: 'challenge_attempt'|'bind'|'unbind'|'reverify', success: boolean, ip, deviceInfo, timestamp }
Mọi mutation binding → 1 row audit.
```

### A1.6 — Re-verify triggers (sau core, có thể defer)

```
Conditions triggering step-up:
- Device fingerprint mismatch (deviceInfo stored at bind ≠ current)
- Binding older than 90 days + sensitive mutation (đổi TK ngân hàng)
Implementation: Guard kiểm tra deviceInfo + age → nếu mismatch → 403 với `requireReverify: true`
Mobile hiển thị challenge lại.
```

---

## A2 — JWT scope + Redis cache (sau A1)

### Service JWT
```
JwtSignerService mở rộng:
- pre-bind token: { scope: 'lookup', phone: '...' } — cho resolve/verify
- post-bind token: { scope: 'customerId', customerId: '...' } — cho profile
BFF gửi đúng scope khi gọi downstream. Customer-service verify scope.
```

### Redis cache
```
Key: bind:{userId}
Value: { customerId, customerRef, verifiedAt, deviceInfo }
TTL: 1h (sliding — refresh on access)
Invalidate: on unbind / revoke / reverify-required
BindingVerifiedGuard đọc Redis trước, DB fallback.
```

---

## Test matrix (assert ở mỗi commit — Fix 1/2/3 applied)

| Test | Khi nào | Invariant |
|---|---|---|
| Mock resolve 0/1/N + no-PII | Sau A4 | hint theo ĐỊA CHỈ (không mã KH); no customerId/fullName |
| Mock resolve response identical on 0-match repeat | Sau A4 | Không enumerate |
| Mock verify pass/fail/identical-error | Sau A4 | wrong value = unknown ref, identical response |
| **bind-init session-scoped** | Sau A1.3 | resolve dùng session.phone, KHÔNG nhận phone từ client |
| **bind rejects foreign customerRef** | Sau A1.3 | customerRef không thuộc bind-init của session → 400 (Fix 1) |
| **bind rejects without bind-init** | Sau A1.3 | POST /auth/bind mà chưa gọi bind-init → 400 |
| Deny unbound on ALL customer-data ports | Sau A1.2 | 403 without verified binding |
| Challenge pass → binding created (customerId encrypted) | Sau A1.3 | customerId populated + encrypted only after verify |
| Challenge fail × 3 → per-user lockout | Sau A1.4 | 429 after threshold per-(userId, customerRef) |
| **Global customerRef lock after 10 fails** | Sau A1.4 | Fix 2: any userId locked after 10 fails/1h |
| **maskedHint independent of factor** | Sau A4+chốt B5 | hint không chứa mã KH/amount/contract# |
| Audit row on every mutation | Sau A1.5 | bind/unbind/reverify logged |
| End-to-end: OTP → bind-init → challenge → bind → data opens | Sau A1 complete | Full flow on mock |

---

## Convention reminder (cho Claude Code)

- **Mock adapter pattern:** tham chiếu `MockCustomerProfileAdapter` (stateful Map, override execute)
- **Port + module:** 4-part (controller + service + dto + clients), PortRegistry register
- **Migration:** `scripts/migrate.js` (runtime migrator, not drizzle-kit)
- **Better-auth setup:** `src/modules/auth/infrastructure/better-auth/better-auth.setup.ts`
- **Contract test:** `test/integration/*.spec.ts`, direct instantiation, mock db chain
- **Secrets:** CCCD pattern (encrypt via PiiEncryptionService) — áp dụng tương tự cho customerId trong binding table (encrypt at rest)
- **DB isolation:** database `app_tu_phuc_vu` (không share)

---

## Revision log

- **Rev 1** (original): spec build-ready cho A4+A1.
- **Rev 2** (current): security patches sau review:
  - 🔴 Fix 1: resolve/bind oracle → session-scoped (resolve dùng session.phone, bind dùng bind-init token).
  - 🟠 Fix 2: lockout dual ceiling (per-userRef + per-customerRef global).
  - 🟠 Fix 3: maskedHint độc lập bí mật (address-based, không mã KH/amount).
  - 🟠 Fix 4: omnichannel bypass flag (cross-team, không block A1).
  - 🟡 Fix 5: customerId encrypted at rest (varchar 512 + PiiEncryptionService).
  - Test matrix + contract test updated cho tất cả fixes.
