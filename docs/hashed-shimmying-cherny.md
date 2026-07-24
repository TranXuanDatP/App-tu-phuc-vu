# Plan: Build 4 mobile feature areas (invoices, usage, incidents, account) — consume backend mock, API-ready

## Context
Mobile slice (app-tu-phuc-vu-mobile, Expo SDK 54) đã có login + dashboard + 5-tab nav với **4 placeholder screens** (invoices, meters, incidents, profile). Backend lean BFF (app-tu-phuc-vu) đã **mock sẵn cả 4 area** (billing/invoices, usage/meters, report/incidents, account/customers — verified: 554 tests, mock JSON, curl). Pc muốn build 4 tab feature này, gọi backend mock ngay, **API-ready khi downstream service (billing-service, incident-service…) live** (chỉ flip backend YAML `adapter: mock→live`, không đổi mobile). Web FE (app-tu-phuc-vu-fe) là design + query reference.

**Scope**: core mỗi area — main tab screen + key sub-screens (full parity = follow-up). **Order per Pc**: invoices → usage → incidents → account.

## Query layer status (mobile src/features/)
- `invoices/queries` ✓ (list, detail, pdf)
- `meters/queries` ✓ (consumption, comparison, reading-detail, calibration, history, meters)
- `customers/queries` ✓ (profile, timeline, related, update) — cho account
- **`incidents/queries` ✗ — port từ web** `app-tu-phuc-vu-fe/src/features/incident/queries.ts`: `useMyReports`, `useReportDetail`, `useCreateReport` (mutation), `useUploadReportPhoto` (mutation)

## Nav restructure (expo-router)
4 placeholder flat file → directory (tab = `index.tsx`, sub-route = file thêm):
- `(app)/invoices.tsx` → `(app)/invoices/index.tsx` + `[id].tsx`
- `(app)/meters.tsx` → `(app)/meters/index.tsx` + `history.tsx`
- `(app)/incidents.tsx` → `(app)/incidents/index.tsx` + `create.tsx` + `[id].tsx`
- `(app)/profile.tsx` → `(app)/profile/index.tsx` + `edit.tsx`
- `dashboard.tsx` giữ flat. Tabs `_layout` route name không đổi (directory = route, `index.tsx` = tab screen, file khác = push).

## Phase 0 — shared components (mọi area dùng)
- `components/layout/app-bar.tsx` — sticky header (title + back chevron) cho sub-page (web có, mobile chưa).
- `components/ui/badge.tsx` — status badge (paid/unpaid/overdue, incident status).
- `components/ui/form-field.tsx` — labeled input wrapper (incident form, profile edit).
- Filter tabs (invoice status): Pressable row đơn giản (không cần Radix Tabs).
- Reuse: `Card`, `Skeleton`, `Button`, `Input` (đã có) + `LinearGradient` (hero) + lucide-react-native icons.

## Phase 1 — Invoices (hóa đơn)
- Screens: `invoices/index.tsx` (list: status filter, invoice card → tap detail) + `invoices/[id].tsx` (detail: period, line items, fees, total, due, PDF btn, "Thanh toán" link).
- Queries: `useInvoices`, `useInvoice`, `useInvoicePdf`.
- Web ref: `app-tu-phuc-vu-fe/src/app/(app)/invoices/`.

## Phase 2 — Usage / tiêu thụ
- Screens: `meters/index.tsx` (consumption overview: ring tháng này, readings history list, comparison summary) + `meters/history.tsx` (history/comparison chi tiết).
- Queries: `useConsumption`, `useMeterHistory`, `useConsumptionComparison`, `useCalibration`.
- Web ref: `app-tu-phuc-vu-fe/src/app/(app)/meters/`.

## Phase 3 — Incidents / sự cố (Phản ánh)
- Port queries: web `incident/queries.ts` → mobile `features/incidents/queries.ts` (strip "use client", `sonner`→`@/lib/toast`).
- Screens: `incidents/index.tsx` (my reports list + "Báo sự cố" btn) + `incidents/create.tsx` (form: type, description, location, photo) + `incidents/[id].tsx` (detail + status timeline).
- Queries: `useMyReports`, `useCreateReport`, `useReportDetail`, `useUploadReportPhoto`.
- Web ref: `app-tu-phuc-vu-fe/src/app/(app)/incidents/`.

## Phase 4 — Account / tài khoản
- Screens: `profile/index.tsx` (customer info card + menu: edit profile, related accounts, timeline, **logout**) + `profile/edit.tsx` (edit contact form: phone/email/address).
- Queries: `useCustomerProfile`, `useUpdateProfile` (mutation), `useRelatedAccounts`, `useCustomerTimeline`. Logout: `useSignOut` (đã có).
- Web ref: `app-tu-phuc-vu-fe/src/app/(app)/profile/`.

## Build pattern (lặp mỗi screen)
1. Đọc web FE screen (`app-tu-phuc-vu-fe/src/app/(app)/<area>/...`) cho structure/content.
2. Rebuild RN: `View/Text/Pressable/ScrollView` + NativeWind classes (cùng tokens) + `LinearGradient` hero + lucide-react-native icons + query hook. Web `Link`→expo-router `router.push`, `<button>`→`<Pressable>`, conic-gradient→SVG ring (pattern từ dashboard).
3. Sub-page dùng `AppBar`. `Skeleton` khi loading. `toast` cho mutation.

## Verification (mỗi phase)
1. `npx tsc --noEmit` sạch (mobile).
2. Backend `:3000` chạy (mock).
3. Device Expo Go: tab screen load mock data (list/detail), nav push/pop, mutation toast, 0 runtime error.
4. **API-ready**: data từ backend mock qua `apiClient` → khi service live, flip backend `config/api-endpoints.yaml` `adapter: live` → không đổi mobile.

## Out of scope (follow-up)
- Full-parity sub-screens (PDF viewer, payment flow, calibration detail, sessions, settings).
- FCM push + offline delivery.
- Real downstream service wiring (backend mock→live adapter).
