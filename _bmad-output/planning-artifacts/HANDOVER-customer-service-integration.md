# HANDOVER — Customer-Service Integration (Bind contract + B5)

- **Từ:** team app-tu-phuc-vu (customer BFF)
- **Tới:** team customer-service
- **Ngày:** 2026-08-11
- **Mục đích:** chốt contract `resolve / verify / profile / create` + câu hỏi **B5 (verify factor)** để thay `MockCustomerServiceClient` bằng service thật → mở đường binding real → go-live app khách hàng.
- **Trạng thái:** BFF đã build đầy đủ binding flow (mock-first, 648 test xanh, 8 curl assertion pass live). Đây là long-pole duy nhất còn lại cho go-live thật.

---

## 1. Context

`app-tu-phuc-vu` là customer BFF (Back-End-for-Frontend) cho app khách hàng `app-tu-phuc-vu-mobile` (Expo — kênh khách hàng duy nhất). Khách hàng báo cáo sự cố / tra cứu / thanh toán qua app; BFF gate mọi customer-data bằng **binding-verified** (bill-secret proof), tách biệt với OTP authentication:

> **OTP (authentication) ≠ binding (bill-secret proof).** User vừa OTP xong nhưng chưa bind → **403 BINDING_REQUIRED** trên mọi customer-data port. Binding là bước chứng minh user sở hữu hồ sơ khách hàng.

Hiện binding dùng `MockCustomerServiceClient` (in-process, seed data). Cần service thật của team customer-service implement contract dưới đây. BFF đã trừu tượng qua interface `CustomerServiceClient` (`src/modules/account/clients/customer-service.client.ts`) → **swap mock → real = 0-churn binding flow** (chỉ đổi 1 provider).

---

## 2. 🔴 B5 — Câu hỏi then chốt (cần trả lời để lock)

**Verify hỗ trợ factor nào?** Mock default `last_invoice_amount` (số tiền hoá đơn gần nhất). Candidate:
- `last_invoice_amount` — số tiền hoá đơn gần nhất (numeric)
- `ma_kh` — mã khách hàng (text)
- số hợp đồng / combination / khác?

**Lý do cần chốt:** BFF trả `challenge` descriptor (`{type, label, inputMode}`) cho mobile render 1 input đúng factor. Mobile **không hardcode enum** — đổi factor = 1 dòng BE (`challengeFor()`), không rebuild app. Nhưng descriptor chỉ đúng khi `verify` thật sự chấp nhận factor đó. Nếu team trả lời "số hợp đồng" → BFF đổi descriptor + `verify` phải chấp nhận `secretType: 'contract_number'`.

**Yêu cầu phụ (ràng buộc spec, đã chốt):** `maskedHint` (gợi ý nhận diện hồ sơ) **phải rời khỏi giá trị secret** — hint dùng tiền tố địa chỉ ("Nguyễn V*** • 12 Lê Lợi"), KHÔNG chứa chữ số mã KH/contract/amount. Ràng buộc sống sót qua câu trả lời B5: nếu factor = mã KH/contract, kiểm tra hint vẫn không hé lộ phần giá trị đó. Xem `domain-decision-mobile-tracking-rating-2026-08-10.md` + comment `ResolveResult` trong `customer-service.client.ts`.

---

## 3. Contract (4 methods)

Nguỗi chân lý: `src/modules/account/clients/customer-service.client.ts` (TypeScript interface). Service cần implement đủ 4 method. Tất cả `customerRef` là **opaque token** (KHÔNG phải real customerId) — service tự sinh, ổn định per customer.

### 3.1 `resolve(phone)` → `ResolveResult`

```
POST /api/v1/customers/resolve?phone=<phone>     (hoặc gRPC tương đương)
```

```ts
interface ResolveResult {
  status: "none" | "one" | "many";
  customerRef?: string;          // present khi one (opaque, NOT real customerId)
  maskedHint?: string;           // "Nguyễn V*** • 12 Lê Lợi" — address-based, nhận diện không enumerate
  challenge?: ChallengeDescriptor;// BE-chosen factor (mô tả input cho mobile render)
  candidates?: Array<{ customerRef: string; maskedHint: string; challenge: ChallengeDescriptor }>;
                                 // N ≤ 3 matches — disambiguate by ADDRESS
  capped?: boolean;              // N > 3 → { status: "many", capped: true }, KHÔNG candidates
}
interface ChallengeDescriptor {
  type: SecretType;              // "last_invoice_amount" | "ma_kh" | (B5 answer)
  label: string;                 // VI label, vd "Số tiền hoá đơn gần nhất"
  inputMode: "numeric" | "text";
}
```

**Bảo mật (must):**
- **Không trả PII**: `customerId` thật / fullName / phone / mã KH / contract # / amount → KHÔNG bao giờ trong response. Chỉ `customerRef` (opaque) + `maskedHint` (address-based).
- **0-match identic mỗi lần** — không tín hiệu enumeration (thời gian / lỗi khác nhau).
- **N > 3 → `capped: true`, KHÔNG candidates**: số dùng chung/cũ/lỗi dữ liệu → mobile route tổng đài, không liệt kê.
- **`phone` luôn là OTP-verified session phone** (BFF đọc server-side, KHÔNG nhận từ client).

### 3.2 `verify({customerRef, secretType, secretValue})` → `{verified}`

```
POST /api/v1/customers/verify     (body JSON)
```

```ts
interface VerifyRequest { customerRef: string; secretType: SecretType; secretValue: string; }
interface VerifyResult { verified: boolean; }
```

**Bảo mật (must):**
- **Oracle-free**: unknown `customerRef` và wrong `secretValue` trả **cùng shape** `{verified:false}` — attacker không phân biệt "ref không tồn tại" vs "sai secret".
- **Never echo** real secret value trong response/log.
- Service **không tự rate-limit** nếu không sync với BFF — BFF đã có `BindingRateLimiter` 3-tier (xem §5). Nếu service có own throttle, coordinate để không lock nhầm.

### 3.3 `profile(customerRef)` → `CustomerProfileResponse`  (POST-VERIFY only)

```
GET /api/v1/customers/profile?customerRef=<ref>
```

BFF chỉ gọi SAU khi `verify` thành công (binding đã chứng minh). Trả **real `customerId`** (BFF encrypt at rest vào binding row — không cache plaintext).

```ts
interface CustomerProfileResponse {
  customerId: string;            // REAL Customer 360 id
  fullName: string;
  classification: "sinh_hoat" | "san_xuat" | "hanh_chinh";
  address: { street; ward; district; city; fullAddress };
  contactInfo: { phone; email; contactAddress };
  status: "active" | ...;
}
```

### 3.4 `create(phone, profile)` → `{customerId, customerRef}`  (new-customer branch)

```
POST /api/v1/customers           (body JSON)
```

```ts
interface CreateCustomerRequest {
  fullName: string;
  classification: "sinh_hoat" | "san_xuat" | "hanh_chinh";
  address: { street; ward; district; city };
  email?: string | null;
}
interface CreateCustomerResult { customerId: string; customerRef: string; }
```

**Bảo mật (must):** **Atomic phone-uniqueness** — nếu customer cho `phone` đã tồn tại (race tail: xuất hiện giữa `resolve` và `create`), throw **409 Conflict** (`code: CUSTOMER_PHONE_EXISTS`). BFF reroute sang bind (challenge), **KHÔNG auto-bind**. `phone` = OTP-verified session phone (server-side).

---

## 4. Wire / transport (cần chốt)

Hiện mock in-process. Cần wire thật — team chốt 1 trong:
- **gRPC** (+ `.proto`): nhất quán với notification-be-rs (BFF đã có gRPC client pattern, vd `notification-grpc.client.ts`).
- **HTTP/JSON**: đơn giản hơn, BFF port abstraction đã sẵn sàng.

BFF interface (`CustomerServiceClient`) ổn định — implement real provider (HTTP/gRPC) rồi bind vào DI token `CUSTOMER_SERVICE_CLIENT`. **0 dòng binding-flow đổi.** Gotchas BE đã gặp (nếu gRPC): URL không có `http://` prefix cho grpc-js; proto-loader `keepCase: true`.

---

## 5. BFF owns (không cần customer-service làm)

- **Rate-limit / lockout** 3-tier: `user_ref` (3 fails/(user,ref)/15m), `customer_ref` global (10 fails/ref/1h → 24h), `session` (5 fails/user across refs/15m — chặn 3×N). `LockoutException` pass-through 429 + `{reason, retryAfterSec}`.
- **PII encryption at rest**: `customerId` cipher (AES-256-GCM) trong `customer_bindings` row + cache ciphertext-only.
- **N-cap (>3)**: BFF check sau `resolve` (nếu service chưa làm).
- **`auth/me.linked`**: BFF gate, mobile consume.

---

## 6. Definition of done (integration)

1. Team customer-service trả lời **B5** (factor) → BFF lock `challengeFor()` descriptor + enum.
2. Service implement 4 method theo contract §3 (+ bảo mật §3 asserts).
3. Wire (gRPC/HTTP) — BFF swap `MockCustomerServiceClient` → real provider.
4. Smoke test trên dev: OTP → bind-init real → challenge → verify real → bound → customer-data mở (kết thúc vòng lặp go-live red).

---

## 7. Tham chiếu
- Contract source (BFF): `app-tu-phuc-vu/src/modules/account/clients/customer-service.client.ts`
- Mock impl (mẫu hành vi bảo mật): `app-tu-phuc-vu/src/modules/account/clients/customer-service-mock.client.ts`
- Bind flow + lockout: `app-tu-phuc-vu/src/modules/binding/binding.service.ts`, `binding-rate-limiter.service.ts`
- Domain decisions (C1/C3 incident tracking/rating — riêng bind không dính): `domain-decision-mobile-tracking-rating-2026-08-10.md`
- Kiến trúc BFF: `architecture.md`, `replan-app-architecture.md`

## 8. Hỏi lại team customer-service
1. **B5**: verify support factor nào? (last_invoice_amount / ma_kh / contract / khác)
2. Transport chốt: **gRPC (.proto)** hay **HTTP/JSON**? Nếu gRPC, gửi `.proto`.
3. `customerRef` scheme: opaque token service tự sinh, hay map từ field có sẵn (vd mã KH hash)?
4. Service có own rate-limit không? (để sync với BFF 3-tier, tránh lock nhầm)
5. `maskedHint` — service tự generate (address prefix + name mask) hay BFF build từ field thô?
