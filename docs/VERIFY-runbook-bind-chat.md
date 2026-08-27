# Runbook verify: bind flow + chat E2E (API/DB/wire)

Lần chạy 2026-08-27: **14/14 ĐẠT** (B3 trúng sinh đôi → fix omnichannel `5c0930f` → re-verify xanh).
Bản này là nguồn chuẩn cho lần chạy sau — số seed, secret, SQL reset đã đúng từ thực tế chạy.

## Số seed & secret (từ mock — nguồn: customer-service-mock.client.ts)

| Số nhập | normalize | Kỳ vọng resolve | Secret đúng |
|---|---|---|---|
| `+84987654321` | 987654321 | `one` REF-001 (Nguyễn V*** • 12 Lê Lợi, Hải Châu) | **247500** |
| `+84912345678` | 912345678 | `one` REF-002 (Trần T*** • 45 Trần Phú, Sơn Trà) | **189000** — dành riêng cho lockout (A8) |
| `+849777666555` | 9777666555 | `many` 2 candidates (Lê M*** • Lê Lợi / Lê M*** • Trần Phú) | REF-003: **312000**; REF-004: **156000** |
| `+84666555444` | 666555444 | `many` + `capped:true`, **KHÔNG candidates** | — (hotline view) |

⚠️ Số capped là **+84666555444** (9 số sau 84 — seed ghi `666555444`, KHÔNG phải dạng 09…).
Sai dạng số → normalize lệch → resolve `none` (đã té一次 vì ghi 09…).

## A0 — Reset (nút chạy lại)

```sql
-- số test A1-A3 (đổi theo số đang dùng; users dạng +84…, mock store đã-normalize):
DELETE FROM mock_customer_store   WHERE phone = '199900001';
DELETE FROM customer_bindings     WHERE user_id IN
  (SELECT id FROM users WHERE phone_number = '+84199900001');
DELETE FROM users                 WHERE phone_number = '+84199900001';
-- seed cho A5 (REF-001) + A8 (REF-002):
DELETE FROM customer_bindings     WHERE customer_ref IN ('REF-001','REF-002');
```
Lockout = MemoryCache → **restart BFF là sạch**. Chat reset: xoá conversation theo
`customer_channel_id` (DB `nestjs_project`) + `UPDATE chat_outbox SET forwarded_at = NULL`.
`users.customer_id` KHÔNG tồn tại (0008 đã drop) — không cần đụng users ngoài xoá hẳn row test.

## Trình tự (thứ tự cứng)

A0 → A1 (số mới: `none` + `/auth/me` incomplete + customerId null) → A2 (register: kéo form
khi gõ + submit) → **A3 nghiệm thu bằng DB** (bindings `verified` + mock store row khớp) →
A4 (restart BFF → **đọc lại stamp** + data còn) → A5 (challenge 247500) → A6 (N-match: chọn
nhầm → back → chọn đúng) → A7 (capped + nút tổng đài) → **A8 CUỐI, ref riêng REF-002,
liền mạch không restart BFF giữa chừng** (memory-lockout: restart = mất khả năng phân biệt
"hết hạn" với "chưa từng khoá").

Bind-init resolve cache **5 phút** — bind-init xong phải bind LIỀN (Fix-1).

## A8 — phạm vi & kỳ vọng thực tế

Tầng 1 (UX + (user,ref)): 2 lần sai → `bound:false` (không oracle); **từ lần thử thứ 3** →
`429 BINDING_LOCKED`; đúng-secret-sau-khoá → vẫn 429. Tầng 2/3 đã curl-verify trước đây —
gõ sai trên 1 ref không chạm được; đừng ghi "3 tầng" cho A8.

## B — chat E2E

B1 gửi khi receiver chết (sent:true + thread 1 tin) → B2 outbox row pending (DB) →
B3 bật receiver → ≤30s flush → **GET thread + ĐẾM: ĐÚNG 1** (2 = FAIL — sinh đôi
optimistic+flush; đã từng xảy ra, fix `5c0930f` omnichannel) → B4 reply qua
`POST :4001/bff/conversations/:id/reply` body `{agentId, content}` → thread 2 tin
(window cache vài giây sau reply — poll 4s bắt được).

## RED LIST — trước go-live

1. **Outbox depth im lặng**: 3 tin pending nằm nguyên đêm không ai biết (B2 phát hiện).
   Cần: cảnh báo theo tuổi row pending, hoặc outbox depth vào /health.
2. **Dedup non-uuid chưa verify**: nhánh Zalo/FB (randomUUID) không test nào chạm —
   xem `docs/wire-external-id-passthrough.md` (omnichannel_be).
3. **Hotline 19001008 chưa xác nhận với QUAWACO** — sai số trước khách = dialer nhầm đầu dây.
4. **CONTRACT customer-service chưa gửi** — B5 (secretType) + 5 xác nhận còn treo.
