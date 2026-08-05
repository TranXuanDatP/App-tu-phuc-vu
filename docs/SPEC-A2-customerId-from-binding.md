# Spec build-ready — A2: customerId-from-binding (đóng IDOR ở tầng controller)

> Mang spec này sang Claude Code (nơi thấy repo thật) để thực thi. Tham chiếu convention
> app-tu-phuc-vu như `SPEC-A4-A1-build-ready.md`. Tiền đề: A4 + A1.1-A1.4 đã landed
> (commit `0d779ed`).
>
> **Đây là bước HOÀN THIỆN thuộc tính bảo mật mà A1 mới phác.** A1 đóng "chưa bind → không
> vào". A2 đóng "đã bind với khách A → không xem được khách B". Không phải hạng mục song
> song với audit (A1.5) hay mobile UI — hai cái kia trang trí một cổng chưa vá cho đến khi
> A2 xong.

---

## 0. Tại sao A2NGAY SAU A1 (không phải A1.5 / mobile)

Guard A1 kiểm "user có BẤT KỲ binding verified nào", không phải "bound tới ĐÚNG khách này".
Controller vẫn lấy `customerId` từ `userId` (mock-loose) hoặc từ client (`@Param`). Cổng
deny-by-default tồn tại, 12 controller gắn guard, 603 test xanh — nhưng cái bảo vệ thật
(bạn chỉ xem được data KHÁCH CỦA BẠN) **chưa tồn tại**. Hôm nay chưa exploit vì customer-data
port cũng mock (bỏ qua customerId), nhưng về tính chất, A1 = bộ xương cổng, A2 = cơ.

**IDOR mà A2 phải đóng có 2 tầng** (audit nhánh `feat/app-only-30ports-queue`):

### Layer 1 — customer-scoped (rộng): `userId` được truyền chỗ `customerId`
Handler lấy `@CurrentUser('id') userId` rồi pass vào service đang cần `customerId`. Bound
với bất kỳ ai → gọi endpoint → service lấy "customerId" = userId của bạn (mock-loose).
Bề mặt: `account` (getProfile/getTimeline/getRelatedAccounts/updateProfile), `usage`
(getMeters/getConsumptionHistory/getConsumptionComparison/getRealtimeConsumption),
`payment` (list/history/getOutstandingDebt/getDebtHistory), `billing` (tariff/invoices list).

### Layer 2 — record-scoped (sâu hơn): selector client-điều-khiển qua `@Param`
Handler nhận `@Param('contractId'|'invoiceId'|'meterId'|'dossierId'|'reportId')`. Dù Layer 1
đã giao đúng customerId, lấy invoice/meter/contract của người khác qua ID bị mạo → lộ nếu
port không kiểm ownership. `@Param` hiện có: `contractId`, `invoiceId`, `meterId`, `period`,
`dossierId`, `requestId`, `reportId`/`id`, `areaId`. Mock port hiện BỎ QUA customerId → trả
fixture bất kể owner → chưa exploit được, **nhưng contract port phải mang customerId để khi
live downstream enforce**.

> Lưu ý: vài route là bound-gated NHƯNG KHÔNG customer-scoped (incidents theo `area`,
> cutoff theo `areaId`). Những route đó cần GATE (đã có qua @RequiresBinding), KHÔNG cần
> inject customerId. Step 1 của A2 = xếp loại mỗi route: customer-scoped (cần @CustomerId) |
> record-scoped (cần ownership check) | bound-shared (gate-only).

---

## 1. Thiết kế

### D1 — Guard resolve binding + gắn `request.customerId`; `@CustomerId()` decorator
`BindingVerifiedGuard` (đã global APP_GUARD) mở rộng: khi route `@RequiresBinding` và user
đã auth, thay vì chỉ check tồn tại row verified → **resolve binding đó, decrypt
customerId, gắn `request.customer = { id, customerId, customerRef, verifiedAt, deviceInfo }`**.
Thêm param decorator `@CustomerId()` đọc `request.customer.customerId`.

- Vị trí: `src/modules/binding/guards/binding-verified.guard.ts` (mở rộng) +
  `src/modules/binding/decorators/current-customer.decorator.ts` (mới, mirror
  `current-user.decorator.ts`).
- Cache-first (xem D3). DB fallback: query 1 row
  `WHERE user_id=? AND status='verified' LIMIT 1` → `PiiEncryptionService.decryptIfNeeded(customerId)`.
- Nếu KHÔNG có row verified → 403 `BINDING_REQUIRED` (như cũ). Nếu có nhưng decrypt fail →
  500 + alert (data integrity).

### D2 — Rewrite handler customer-scoped → `@CustomerId()` (Layer 1 fix)
Mỗi handler customer-scoped: thay `@CurrentUser('id') userId: string` (pass-as-customerId)
bằng `@CustomerId() customerId: string`. Service nhận customerId ĐÚNG (bound, decrypted).
**customerId không bao giờ đến từ client.**

### D3 — Redis cache `bind:{userId}` (resolve + guard read) — CIPHERTEXT, decrypt per-request
```
key   bind:{userId}
value { customerIdCipher, customerRef, verifiedAt, deviceInfo }   // customerId CIPHERTEXT (chưa giải mã)
ttl   3600s (sliding — refresh mỗi khi guard hit)
```
- **CIPHERTEXT trong cache, KHÔNG plaintext.** Lý do: mã hoá customerId at-rest bằng
  AES-256-GCM trong Postgres chính là để khi datastore bị dump thì customerId không lộ.
  Cache plaintext trong Redis hoàn tác đúng cái đó — Redis thường ít hardening hơn DB chính
  (hay không encrypt at-rest, hay share/expose). Khóa cửa trước rất chắc để copy bản rõ trong
  ngăn kéo không khóa. Và không có lý do hiệu năng: AES-GCM decrypt = micro giây; cái Redis
  tiết kiệm là **binding lookup (DB query) — phần đắt**; decrypt là phần rẻ, làm sau cache
  hit vẫn không đáng kể. (Redline #1 — lật default so với nháp đầu.)
- Guard: đọc cache → nếu hit, `PiiEncryptionService.decryptIfNeeded(customerIdCipher)`
  **trong memory per-request** → gắn `request.customer`; KHÔGIẢI MÃ VÀO CACHE. Miss → query
  DB (status='verified') → decrypt + set cache (ciphertext) + gắn. Warm sau bind (D6).
- Invalidate khi: unbind/revoke (sau A1.5) hoặc binding status đổi. Keyed by userId →
  `cache.delete('bind:'+userId)`.

### D4 — Record-scoped ownership (Layer 2 fix)
Mỗi route record-scoped (`contractId`/`invoiceId`/`meterId`/`dossierId`/`reportId`):
1. Port call **phải mang `customerId`** (bound) cùng selector — không chỉ selector.
2. Ownership enforce: mock adapter update để **scope theo customerId** (return 404 khi
   record không thuộc customerId đó) → IDOR test pass ngay trong mock. Khi live: downstream
   customer-service/billing enforce ownership bằng customerId (scope `customerId` — D5).
3. BFF KHÔNG tự check ownership bằng data giả (không có nguồn owner thật pre-live) — contract
   là nguồn sự thật; mock mô phỏng đúng contract.

### D5 — JWT scope split (JwtSignerService)
`src/libs/shared/auth-propagation/jwt-signer.service.ts` mở rộng 2 scope:
- pre-bind: `{ scope: 'lookup', phone }` — cho resolve/verify (KHÔNG customerId).
- post-bind: `{ scope: 'customerId', customerId }` — cho profile + mọi customer-data port.
BFF sign scope đúng theo trạng thái binding của user. Downstream (customer-service thật)
verify scope khi live. **Mock không enforce downstream** — A2 wire cấu trúc đúng, enforce
khi wire live.

### D6 — Warm cache sau bind
`BindingService.bind()` (đã có): sau khi insert/update binding verified → set
`bind:{userId}` cache ngay (giải mã customerId) → request kế tiếp 0 DB hit. Đã có
`cache.delete(initKey)`; thêm `cache.set(bindKey, {...})`.

### D7 — Flip opt-in → opt-out (SAU A2 + catalogue)
Hiện guard opt-in (`@RequiresBinding`). Sau A2 (khi mọi route đã được xếp loại + customerId
đã được móc đúng), flip sang deny-by-default với `@SkipBindingVerified()` trên các route
không customer-data (auth, support, onboarding, webhooks, health). Quên gắn = AN TOÀN.
**Sequence: A2 xong → catalogue route → flip.** Không flip trước A2 (vì khi đó protection
vẫn thô bound-to-anyone, opt-out chỉ cho ảo giác an toàn).

---

## 2. Step thực thi (deny-first, TDD)

```
0. Audit route (sản xuất ownership map: customer-scoped | record-scoped | bound-shared)
1. TDD guard: resolve binding + gắn customerId + cache hit/miss (test trước)
2. @CustomerId() decorator + mở rộng guard
3. Rewrite handler customer-scoped (Layer 1) — mỗi commit vài controller, test xanh
4. Record-scoped: port call mang customerId + mock ownership (Layer 2) + IDOR test
5. Redis cache warm/invalidate (D6) + cache test
6. JWT scope split (D5) — structural, test sign đúng scope
7. (Sau) flip opt-in→opt-out (D7) khi catalogue xong
```

---

## 3. Contract test matrix (assert ở mỗi commit)

| Test | Khi nào | Invariant |
|---|---|---|
| **IDOR Layer 1**: bound→A, gọi getProfile → trả profile A (dùng bound customerId), không phải whatever-userId-maps-to | Sau D2 | customerId từ binding, KHÔNG từ client/userId |
| **IDOR Layer 2**: bound→A, request invoice/meter/contract của B → 404/403 (ownership enforce) | Sau D4 | record-scoped port scope theo customerId; mock honor nó |
| Guard gắn `request.customer` khi verified, 403 khi không | Sau D1 | @CustomerId() có giá trị iff binding verified |
| Cache hit: request 2nd → 0 DB query (db.select mock not called) | Sau D3+D6 | guard đọc cache trước |
| Cache miss → DB fallback → set cache | Sau D3 | warm đúng key `bind:{userId}` |
| Unbind/revoke → `cache.delete(bind:{userId})` → request kế tiếp 403 hoặc re-resolve | Sau D3 (invalidate hook) | stale cache không mở data sau revoke |
| JWT sign scope `lookup` pre-bind, `customerId` post-bind | Sau D5 | token mang đúng scope |
| Decrypt fail → 500 không leak | Sau D1 | data integrity không im lặng |

> Test Layer 2 là **test quan trọng nhất** — nó không pass được ở trạng thái hiện tại (mock
> trả fixture bất kể owner). A2 làm nó pass: mock adapter scope theo customerId → request
> record của B với binding A → 404. Đây là bằng chứng IDOR đã đóng ở controller, không phải
> resolve/bind.

---

## 4. 🔴 GO-LIVE GATE (dòng cứng)

**A2 (customerId-from-binding) PHẢI xong trước khi `CUSTOMER_SERVICE_URL` trỏ data thật.**

Lý do: lúc wire live, nếu A2 chưa xong, một user bind hợp lệ có thể chạm data khách khác qua
customerId client-điều-khiển (Layer 2) hoặc qua userId-as-customerId (Layer 1) — đúng IDOR
ta đã đóng ở resolve/bind, nhưng lần này ở tầng controller, và lần này data thật. Mock che
lỗ này; live lộ ngay.

Thêm vào `SPEC-safe-wire Phần D` (go-live gate): "binding step + A2 customerId-from-binding
+ N-match deny + session scoping" — không chỉ "binding step" chung chung.

---

## 5. Quyết định đã chốt (redline nếu muốn)

1. **Cache CIPHERTEXT customerId** (D3, redline #1) — decrypt per-request trong memory. Cache
   plaintext hoàn tác mã hoá at-rest của Postgres; Redis ít hardening hơn; decrypt rẻ. Cache
   chỉ tiết kiệm DB lookup (phần đắt), giữ ciphertext thì vẫn decrypt sau cache hit.
2. **Ownership = contract downstream, mock mô phỏng** (D4) — BFF không tự check owner bằng
   data giả pre-live; mock adapter scope theo customerId để test pass.
3. **JWT scope split trong A2** (D5) — structural ngay, enforce khi live (góp phần đóng IDOR
   ở downstream khi wire).
4. **Flip opt-out SAU A2** (D7) — không trước (tránh ảo giác an toàn trên cổng bound-to-anyone).
5. **Incidents theo `area`** = bound-shared (gate-only) — area-level infra (mất nước/áp suất
   yếu, `affectedCustomers: count`), không mang PII người báo. **NHƯNG `report`/Phản ánh**
   (per-customer, mang `customerId` + description + location + photoUrls + address) =
   **customer-scoped → Layer-2** (inject customerId + ownership), KHÔNG bound-shared — user B
   đọc Phản ánh của user A = leak. (Redline #5 — đã verify schema: `createReport(customerId,…)`
   + DTO `customer_report` có `customerId` + `address`.)

---

## 6. Out of scope (A2 không làm)

- Audit table (A1.5) — sau A2.
- Re-verify triggers (A1.6) — sau A2.
- Mobile bind UI — sau A2 (lõi authz phải xong trước bề mặt).
- Live HTTP customer-service client — khi team customer-service answer B5 + ship endpoints.
- Fix 4 omnichannel bypass (cross-team flag).

## Reuse (không reinvent)
- `BindingVerifiedGuard` (mở rộng), `PiiEncryptionService.decryptIfNeeded`, `ICacheService`,
  `customer_bindings` table, `@CurrentUser` pattern (mirror cho `@CustomerId`), JwtSignerService,
  mock adapter ownership pattern (mirror `MockCustomerServiceClient` seed-by-ref).
