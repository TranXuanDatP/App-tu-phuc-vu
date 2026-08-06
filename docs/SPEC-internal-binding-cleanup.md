# Spec — Cleanup link nội bộ app-BFF (việc nhà, không gửi downstream)

> **Doc nội bộ** — regression register, đơn-nguồn-sự-thật, sync mobile gate. Không hand
> cho team downstream (coi `SPEC-downstream-ownership-contract.md`). Hai doc NEO chung một
> invariant (dưới) để không trôi khỏi nhau.

---

## Invariant (neo chung — cùng `SPEC-downstream-ownership-contract.md`)

> **`customer_bindings.status='verified'` là thẩm quyền DUY NHẤT cấp quyền đọc data
> khách.** Mọi path — register, bind, downstream fetch — tuân theo. Không path nào cấp
> data khách mà không qua binding verified (challenge, hoặc create-khi-resolve-none).

Giá trị hiện tại: guard đọc đúng nguồn (`customer_bindings`), nên các path unverified set
`users.customerId` nhưng vẫn ăn 403 ở cổng data. **Nguyên tắc "guard đọc đúng nguồn" giữ
cổng đứng — ngày nào gate nhầm lên `users.customerId` cho tiện thì các path đó thành lỗ.**

---

## 1. Bypass audit (đã verify code)

Mọi path set `users.customerId` (link-granting) mà không qua challenge:

| Path | Vị trí | Set customerId? | Challenge? | Insert binding? | Trạng thái |
|---|---|---|---|---|---|
| `bind` | binding.service | (qua binding table) | ✅ | ✅ | cổng duy nhất, đúng |
| `check-registration` | auth.controller:343 | ✅ | ❌ | ❌ | soft bypass, **defanged** (guard dùng binding) |
| `register` | auth.controller:244 | ✅ | ❌ | ❌ | tạo customer mới, **gãy UX** (xem §2) |
| `link-customer` | auth.controller:439 | (return only) | ❌ | ❌ | legacy, defanged |
| ~~RabbitMQ identity-event~~ | (plan `flickering-frolicking-brook`) | — | ❌ | — | **OBSOLETE — KHÔNG build** (loại 1 auto-link bypass; chưa code, chỉ comment trỏ plan ở auth.controller:321). Binding flow đã thay thế |

**Verdict:** không bypass sống hôm nay (guard đọc đúng nguồn). Nhưng §2 (register gãy) và
§3 (hai nguồn sự thật) là hazard thật phải xử lý trước go-live.

---

## 2. Finding 1 — register → bind: thống nhất thành một flow, gác bằng resolve

### Vấn đề
`register` hiện set `users.customerId` + `profile_status='complete'` nhưng **không tạo
binding** → từ khi có guard (A1.2), user vừa register bị guard chặn data của chính họ.
Regression do mình.

### Bẫy nếu fix sai
"Register cứ cấp verified binding (creation=proof)" đúng với khách THẬT sự mới. Nhưng lúc
wire live: nếu register auto-bind không kiểm resolve trước, một người khai "tôi là khách
mới" với số ĐANG thuộc khách QUAWACO có lịch sử hóa đơn → auto-bind → khi customer-service
link số đó tới customerId thật, họ vào data thật **không qua challenge**. Register thành
đúng porting-bypass mà bind flow sinh ra để bịt. Pre-live (mock) latent; flip URL → bypass.

### Fix đúng — một flow "thiết lập link", hai nhánh, gác bằng resolve
```
bind-init  (BFF dùng session.phone) → resolve/phone
  ├─ status='one'/'many'  → bind:        verify bill-secret      → binding verified
  └─ status='none'        → register:    create Customer 360      → binding verified (creation=proof)
```
Cả hai nhánh kết ở **một dòng `customer_bindings` status='verified'`. Quy tắc sống còn:
**nhánh create chỉ chạy khi resolve='none'**, và resolve phải **authoritative complete**
(không false-negative — giả định downstream, coi `SPEC-downstream-ownership-contract §3`).

### Hai điểm reject — re-resolve KHÔNG đóng TOCTOU, chỉ thu hẹp khe

Re-resolve là một call riêng, create là call khác → khe giữa "authority nói none" và
"authority create" vẫn mở: khách thật cho số đó xuất hiện đúng trong khe → create duplicate
+ auto-bind = bypass. Re-resolve làm khe nhỏ lại, **không làm nó biến mất**.

Cái thật sự đóng race là **create bị reject nếu customer giờ đã tồn tại** (atomic
phone-uniqueness ở authority — `SPEC-downstream-ownership-contract §3.1`). Flow phải xử lý
**HAI điểm reject**, không phải một:

1. **re-resolve thấy tồn tại** → reroute challenge (sớm, **best-effort** bắt ca thường gặp — UX).
2. **create bị reject vì customer vừa xuất hiện** (đuôi race) → **cũng reroute challenge**;
   BFF **TUYỆT ĐỐI không proceed auto-bind**. **Đây mới là gate bảo mật thật.**

Đọc nhầm "re-resolve đóng được race" = quên build handler điểm 2 → đuôi race vẫn auto-bind,
đúng bypass ta đóng. **Phụ thuộc external §3.1:** nếu authority KHÔNG enforce
phone-uniqueness ở create, BFF không thể tự đóng race dù re-resolve bao nhiêu lần — điều kiện
downstream (xem §6.3 downstream).

### Thực thi
- `register` = nhánh create+bind của flow bind: **re-resolve server-side** (best-effort bắt
  sớm — không tin "tôi mới" từ client), chỉ gọi create khi resolve='none'.
- **Handler create-rejection (gate điểm 2):** create trả 409/conflict (phone đã tồn tại) →
  **reroute nhánh challenge**, KHÔNG auto-bind, KHÔNG insert binding. Bắt buộc có.
- Insert binding **cùng transaction** với create, **chỉ khi create thành công**.
- **Encode CẢ HAI reject NGAY (mock):** mock create mô phỏng 409 khi phone trùng, để test
  handler điểm 2. Flip URL mà thiếu handler = bypass sống.
- `check-registration` + `link-customer`: legacy, defanged → **remove** sau hợp nhất. Không
  giữ path link nào ngoài bind/register-hai-nhánh.

---

## 3. Finding 2 — Một nguồn sự thật: `customer_bindings` là nguồn duy nhất

`users.customerId` / `profile_status` tồn tại song song `customer_bindings` → hazard: code
tương lai gate nhầm lên cột unverified = lỗ mới.

### Bước 0 — inventory reader (đã grep BFF src)
Reader `users.customerId` / `profileStatus`:
1. **`auth/me`** (auth.controller:190) — trả `customerId`, `profileStatus`, `linked` cho FE.
   Mobile `ProfileGate`/`useProfileStatus` đọc `profileStatus` → **gate FE lệch BFF**
   (`complete` ≠ `binding-verified`).
2. **`register`** (auth.controller:270) — dedup bằng `profileStatus==='complete'`.
3. Guard **không** đọc (đúng rồi).
4. Mobile (repo khác) đọc `profileStatus` qua `/auth/me`.

Không reader analytics/flow-cũ khác trong BFF. (Xác nhận lại bằng grep trước khi drop —
repoint-then-remove.)

### Quy tắc: repoint-then-remove, KHÔNG xóa thẳng
1. **Repoint** `auth/me` derive từ binding: `linked = hasVerifiedBinding(userId)`,
   `customerId` = decrypt(binding) (hoặc ẩn nếu không muốn lộ). `profileStatus` → xem §3b.
2. **Repoint** `register` dedup → "đã có verified binding" thay vì `profileStatus`.
3. **Additive-then-remove ở tầng API** (KHÔNG flip đồng bộ hai deploy — coi §"Mobile gate
   skew" dưới): trong chuyển, `auth/me` trả **cả hai** — `profileStatus` (derive, backward-
   compat) VÀ `linked`/`binding-verified` — để mobile migrate theo lịch riêng.
4. **Sau khi** mobile đã chuyển đọc field mới + hết reader BFF → drop `users.customerId` /
   `profile_status` + field `profileStatus` cũ (migration).

### §3b — kiểm semantics `profile_status` trước khi gộp
`profile_status` có thể đang trộn hai khái niệm khác:
- **"link-verified"** (đã bind khách) — = binding. Nên bỏ, nguồn là `customer_bindings`.
- **"hồ sơ đủ field"** (đã nhập họ tên/địa chỉ/CCCD?) — nếu là concept riêng (vd gate tính
  năng phụ thuộc hồ sơ đủ), **không nuốt vào binding**. Giữ làm trạng thái hồ sơ tách biệt,
  hoặc cũng bỏ nếu không dùng.

Tách rõ hai khái niệm TRƯỚC khi collapse. Không assume `profile_status` = link.

### Mobile gate skew — additive-then-remove (KHÔNG "cùng lúc" hai deploy)
Hiện mobile `ProfileGate` đọc `profileStatus` ('complete') → có thể hiện dashboard khi BFF
guard chưa có binding → **gate lệch** (FE tưởng đủ điều kiện, BFF 403). Nhưng mobile là
repo/deploy riêng (Expo) → "đồng bộ cutover" hai deploy độc lập gần không đạt: luôn có cửa
sổ BFF đổi mà mobile chưa (hoặc ngược lại) → lệch đúng lúc chuyển.

Giải pháp: **additive ở tầng API**, mobile migrate theo lịch riêng:
1. `auth/me` trả **cả hai** field: `profileStatus` (derive từ binding, backward-compat) VÀ
   `bindingVerified` (field mới, nguồn thật).
2. Mobile chuyển đọc `bindingVerified` theo lịch deploy riêng (không cần cutover đồng bộ).
3. Sau mobile chuyển xong → bỏ field `profileStatus` cũ (drop cùng `users` columns).

Với hai deploy độc lập, **additive luôn thắng "cùng lúc"** — đây chính là
repoint-then-remove áp cho contract API. BFF không bao giờ ở trạng thái "đã bỏ field cũ
trước khi mobile chuyển xong".

---

## 4. Hard line + go-live-gate (đỏ)

**A2 CHƯA done** — mới invoice đóng Layer-2. Đỏ tới khi Layer-2 đóng trên
meter/contract/Phản ánh (same pattern, `SPEC-A2-customerId-from-binding §D4`).

**Register-flow ĐANG GÃY** (do A1.2 guard + register không bind) — đỏ tới khi §2 (register-
bind hợp nhất, resolve-gated) xong.

**Go-live gate cứng:** `CUSTOMER_SERVICE_URL` không trỏ data thật cho đến khi:
- A2 Layer-2 đóng trên mọi record-scoped port (invoice ✅, meter/contract/Phản ánh ☐).
- register-bind hợp nhất + resolve-gate (§2) — không thì register = porting-bypass lúc live.
- resolve downstream authoritative complete (giả định `SPEC-downstream §0.4/§3`).
- `customer_bindings` nguồn duy nhất (§3) — không reader nào còn gate lên cột unverified.
- Mobile gate sync binding-verified (§3).

"610 xanh" hiện tại ≠ các mục trên đỏ đã xanh. Đừng đọc xanh test thành "binding xong".

---

## 5. Thứ tự đề xuất (build resume khi nào mở pause)

1. (design encode ngay) register-bind hợp nhất + resolve-gate (§2) —_close cả regression UX
   và bypass latent. Đây là điều kiện gần nhất thành bypass nếu bỏ qua.
2. Layer-2 ownership meter/contract/Phản ánh (đóng lỗ A2, same invoice pattern).
3. repoint `auth/me` → binding-derived + sync mobile gate (§3).
4. drop `users.customerId`/`profile_status` (sau khi hết reader).
5. JWT scope split + guard opt-in→opt-out.
6. A1.5 audit / A1.6 re-verify.

Mọi mục trên = phe mình, không block downstream (trừ resolve-authoritative là giả định downstream).
