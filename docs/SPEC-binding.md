# Spec — Customer Binding (app-tu-phuc-vu, internal)

> Source-of-truth nội bộ cho customer binding: rationale bảo mật + trạng thái + việc còn lại.
> Doc gửi downstream tách rời: `SPEC-downstream-ownership-contract.md`. Hai doc NEO chung
> invariant (dưới). Fold từ A4-A1-build-ready + A2-customerId-from-binding + internal-cleanup
> (bản gốc trong git history).

---

## Invariant (neo chung — cùng `SPEC-downstream-ownership-contract.md`)

> **`customer_bindings.status='verified'` là thẩm quyền DUY NHẤT cấp quyền đọc data khách.**
> Mọi path — register, bind, downstream fetch — tuân theo. Không path nào cấp data khách mà
> không qua binding verified (challenge bill-secret, hoặc create-khi-resolve-none).

Guard đọc đúng nguồn (`customer_bindings`) → các path unverified set `users.customerId` nhưng
vẫn 403 ở cổng data. **Nguyên tắc "guard đọc đúng nguồn" giữ cổng đứng — gate nhầm lên
`users.customerId` cho tiện = lỗ.**

---

## 1. Trạng thái

| Việc | Trạng thái | Commit |
|---|---|---|
| A4 mock customer-service client (resolve/verify/profile) | ✅ done | `0d779ed` |
| A1.1 binding schema + migration 0006 (customerId mã hoá at-rest) | ✅ done | `0d779ed` |
| A1.2 BindingVerifiedGuard (deny-first, global APP_GUARD) + `@RequiresBinding` 12 controller | ✅ done | `0d779ed` |
| A1.3 bind-init (session-phone) + bind (verify→binding) | ✅ done | `0d779ed` |
| A1.4 dual-ceiling lockout (per-userRef + per-customerRef global) | ✅ done | `0d779ed` |
| A2 foundation: guard resolve binding → decrypt per-request → `request.customer` (ciphertext cache) + `@CustomerId()` | ✅ done | `f759def` |
| A2 Layer-1: billing/account/usage/payment → `@CustomerId()` | ✅ done | `5cb2ff5` |
| A2 Layer-2: invoice owner-scoped mock + IDOR test | ✅ done | `5cb2ff5` |
| A2 Layer-2: meter / contract / Phản ánh (same invoice pattern) | ⏸ paused — **IDOR còn mở ở 3 port** |
| register→bind hợp nhất (resolve-gated, hai điểm reject) | ⏸ paused — **regression sống** (register gãy, §4) |
| single-source repoint + mobile additive sync | ⏸ paused (§5) |
| JWT scope split + guard opt-in→opt-out | ⏸ paused |
| A1.5 audit / A1.6 re-verify | ⏸ paused |

610 jest xanh; tsc sạch; migration 0006 đã apply thật. **"610 xanh" ≠ binding done** —
register đang gãy + IDOR mở ở 3 port (meter/contract/Phản ánh).

---

## 2. Rationale bảo mật — WHY flow hình thành thế (Fix 1-5)

1. **resolve/bind oracle → session-scoped (Fix 1).** resolve dùng `session.phoneNumber`
   (OTP-verified), KHÔNG nhận phone từ client; bind chỉ chấp nhận `customerRef` từ
   `bind-init` của chính session đó (foreign ref → 400). Chống kẻ có session A bind
   customerRef của session B.
2. **Dual-ceiling lockout (Fix 2).** per-(userRef, customerRef) 3 sai/15m **và**
   per-customerRef GLOBAL 10 sai/1h → lock 24h cho MỌI user. Chống tạo N account × 3 thử
   = 3N brute-force trên một nạn nhân.
3. **maskedHint độc lập bí mật (Fix 3).** Hint chỉ theo ĐỊA CHỈ (`"Nguyễn V*** • 12 Lê Lợi"`),
   KHÔNG chứa mã KH/amount/contract# — hint không thu nhỏ không gian secret (khách nhận ra
   nhà mình, kẻ không dò được).
4. **customerId mã hoá at-rest (Fix 5).** AES-256-GCM (`PiiEncryptionService`) trong
   `customer_bindings.customer_id`; cache Redis `bind:{userId}` giữ **CIPHERTEXT**, decrypt
   per-request trong memory (KHÔNG cache plaintext — cache plaintext hoàn tác at-rest
   encryption; Redis ít hardening hơn DB; AES-GCM decrypt = micro giây).
5. **Omnichannel bypass (Fix 4, cross-team).** App bind rồi omnichannel auto-resolve vẫn mở
   full Customer 360 cho staff = đường vòng qua cổng. Cần event `CustomerBound` → omnichannel
   nâng edge "verified" (flag gửi team omnichannel, không block A1).

---

## 3. Bypass audit (đã verify code)

Mọi path set `users.customerId` (link-granting) mà không qua challenge:

| Path | Vị trí | Set customerId? | Challenge? | Insert binding? | Trạng thái |
|---|---|---|---|---|---|
| `bind` | binding.service | (qua binding table) | ✅ | ✅ | cổng duy nhất, đúng |
| `check-registration` | auth.controller:343 | ✅ | ❌ | ❌ | soft bypass, **defanged** (guard dùng binding) |
| `register` | auth.controller:244 | ✅ | ❌ | ❌ | tạo customer mới, **gãy UX** (§4) |
| `link-customer` | auth.controller:439 | (return only) | ❌ | ❌ | legacy, defanged |
| ~~RabbitMQ identity-event~~ | (plan `flickering-frolicking-brook`) | — | ❌ | — | **OBSOLETE — KHÔNG build** (loại-1 auto-link bypass; chưa code, chỉ comment trỏ plan ở auth.controller:321). Binding flow đã thay thế |

**Verdict:** không bypass sống hôm nay (guard đọc đúng nguồn). §4 (register gãy) và §5 (hai
nguồn sự thật) là hazard thật phải xử lý trước go-live.

---

## 4. register → bind hợp nhất (resolve-gated, HAI điểm reject) — regression sống

### Vấn đề
`register` hiện set `users.customerId` + `profile_status='complete'` nhưng **không tạo
binding** → từ khi có guard (A1.2), user vừa register bị guard chặn data của chính họ.
Regression do mình.

### Bẫy nếu fix sai
"Register cứ cấp verified binding (creation=proof)" đúng với khách THẬT sự mới. Nhưng khi
wire live: nếu register auto-bind không kiểm resolve trước, một người khai "tôi mới" với số
ĐANG thuộc khách có lịch sử hóa đơn → auto-bind → khi customer-service link số đó tới
customerId thật, họ vào data thật **không qua challenge**. Register thành porting-bypass mà
bind flow sinh ra để bịt. Pre-live (mock) latent; flip URL → bypass.

### Fix đúng — một flow "thiết lập link", hai nhánh, gác bằng resolve
```
bind-init  (BFF dùng session.phone) → resolve/phone
  ├─ status='one'/'many'  → bind:     verify bill-secret   → binding verified
  └─ status='none'        → register: create Customer 360  → binding verified (creation=proof)
```
Cả hai nhánh kết ở **một dòng `customer_bindings` status='verified'**.

### Hai điểm reject — re-resolve KHÔNG đóng TOCTOU, chỉ thu hẹp khe
Re-resolve là một call riêng, create là call khác → khe giữa "authority nói none" và
"authority create" vẫn mở: khách thật cho số đó xuất hiện đúng trong khe → create duplicate
+ auto-bind = bypass. Re-resolve làm khe nhỏ lại, **không làm nó biến mất**.

Cái thật sự đóng race là **create bị reject nếu customer giờ đã tồn tại** (atomic
phone-uniqueness ở authority — `SPEC-downstream-ownership-contract §3.1`). Flow phải xử lý
**HAI điểm reject**:
1. **re-resolve thấy tồn tại** → reroute challenge (sớm, best-effort — UX).
2. **create bị reject vì customer vừa xuất hiện** (đuôi race) → **cũng reroute challenge**;
   BFF **TUYỆT ĐỐI không proceed auto-bind**. **Đây mới là gate bảo mật thật.**

Đọc nhầm "re-resolve đóng được race" = quên build handler điểm 2 → đuôi race vẫn auto-bind.
**Phụ thuộc external §3.1:** nếu authority KHÔNG enforce phone-uniqueness ở create, BFF không
tự đóng race được — điều kiện downstream (§6.3 downstream).

### Thực thi
- `register` = nhánh create+bind: **re-resolve server-side** (best-effort), chỉ gọi create
  khi resolve='none'.
- **Handler create-rejection (gate điểm 2):** create trả 409/conflict → **reroute nhánh
  challenge**, KHÔNG auto-bind, KHÔNG insert binding. Bắt buộc có.
- Insert binding **cùng transaction** với create, **chỉ khi create thành công**.
- **Encode CẢ HAI reject NGAY (mock):** mock create mô phỏng 409 khi phone trùng, để test
  handler điểm 2. Flip URL mà thiếu handler = bypass sống.
- `check-registration` + `link-customer`: legacy, defanged → **remove** sau hợp nhất.

---

## 5. Một nguồn sự thật — `customer_bindings` là nguồn duy nhất

`users.customerId` / `profile_status` tồn tại song song `customer_bindings` → hazard: code
tương lai gate nhầm lên cột unverified = lỗ mới.

### Reader (đã grep BFF src)
1. **`auth/me`** (auth.controller:190) — trả `customerId`, `profileStatus`, `linked` cho FE.
   Mobile `ProfileGate`/`useProfileStatus` đọc `profileStatus` → **gate FE lệch BFF**
   (`complete` ≠ `binding-verified`).
2. **`register`** (auth.controller:270) — dedup bằng `profileStatus==='complete'`.
3. Guard **không** đọc (đúng rồi).
4. Mobile (repo khác) đọc `profileStatus` qua `/auth/me`.

### Repoint-then-remove, KHÔNG xóa thẳng
1. **Repoint** `auth/me` derive từ binding: `linked = hasVerifiedBinding(userId)`,
   `customerId` = decrypt(binding). `profileStatus` → xem §5b.
2. **Repoint** `register` dedup → "đã có verified binding".
3. **Additive-then-remove ở tầng API** (xem §5c): `auth/me` trả **cả hai** field trong chuyển.
4. **Sau khi** mobile chuyển + hết reader BFF → drop `users.customerId`/`profile_status` +
   field `profileStatus` cũ (migration).

### §5b — semantics `profile_status` trước khi gộp
`profile_status` có thể trộn: **"link-verified"** (= binding, nên bỏ) với **"hồ sơ đủ field"**
(concept riêng — KHÔNG nuốt vào binding nếu còn dùng). Tách rõ TRƯỚC khi collapse.

### §5c — Mobile gate skew: additive-then-remove (KHÔNG "cùng lúc" hai deploy)
Mobile là repo/deploy riêng (Expo) → "đồng bộ cutover" hai deploy độc lập gần không đạt: luôn
cửa sổ lệch đúng lúc chuyển. **Additive ở tầng API**:
1. `auth/me` trả cả `profileStatus` (derive, backward-compat) VÀ `bindingVerified` (mới).
2. Mobile chuyển đọc `bindingVerified` theo lịch deploy riêng.
3. Sau mobile chuyển xong → bỏ field `profileStatus` cũ.

Với hai deploy độc lập, **additive luôn thắng "cùng lúc"** — repoint-then-remove áp cho
contract API.

---

## 6. Hard line + go-live gate (đỏ)

- **A2 CHƯA done** — mới invoice đóng Layer-2. Đỏ tới khi Layer-2 đóng trên
  meter/contract/Phản ánh (same invoice pattern — ref impl `MockInvoiceAdapter`).
- **Register-flow ĐANG GÃY** (A1.2 guard + register không bind). Đỏ tới khi §4 xong.

**Go-live gate cứng:** `CUSTOMER_SERVICE_URL` không trỏ data thật cho đến khi:
- A2 Layer-2 đóng trên mọi record-scoped port (invoice ✅, meter/contract/Phản ánh ☐).
- register-bind hợp nhất + resolve-gate, HAI điểm reject (§4) — không thì register =
  porting-bypass lúc live.
- resolve downstream authoritative complete (giả định `SPEC-downstream §3`).
- `customer_bindings` nguồn duy nhất (§5) — không reader nào còn gate lên cột unverified.
- Mobile gate sync binding-verified (§5c).

"610 xanh" hiện tại ≠ các mục trên đỏ đã xanh.

---

## 7. Thứ tự resume build

1. **register→bind hợp nhất + resolve-gate (§4)** — gần nhất thành bypass nếu bỏ, + regression
   đang sống. Mở đầu khi unpause.
2. **Layer-2 ownership meter/contract/Phản ánh** (same invoice pattern).
3. **repoint `auth/me` → binding-derived + mobile additive sync** (§5).
4. **drop `users.customerId`/`profile_status`** (sau khi hết reader).
5. **JWT scope split + guard opt-in→opt-out.**
6. **A1.5 audit / A1.6 re-verify.**

Mọi mục = phe mình, không block downstream (trừ resolve-authoritative là giả định downstream).
Câu chặn duy nhất downstream: **B5** (verify được secret nào) — `SPEC-downstream-ownership-contract §6`.
