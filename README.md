# IOC Customer — Module CSKH

> **Trạm Điều phối Trung tâm (CSKH)** — API Gateway & Orchestrator (BFF) cho dịch vụ cấp nước.
> Built with NestJS + DDD/CQRS + Hexagonal Ports.

![Tests](https://img.shields.io/badge/tests-1018%20passing-brightgreen) ![Endpoints](https://img.shields.io/badge/endpoints-41%2F41%20verified-brightgreen) ![Docker](https://img.shields.io/badge/docker-production%20ready-blue)

---

## 📖 Hướng dẫn sử dụng (Usage Guide)

Đây là file hướng dẫn chính. **Bắt đầu từ đây.** Các tài liệu chuyên sâu nằm trong [docs/](docs/).

| Tài liệu | Mô tả | Khi nào đọc |
|---|---|---|
| **README.md** (file này) | Hướng dẫn sử dụng + setup | Lần đầu tiếp xúc dự án |
| [docs/project-documentation.md](docs/project-documentation.md) | Tổng quan kiến trúc + phân tích modules | Hiểu cấu trúc & business logic |
| [docs/SPEC-A4-A1-build-ready.md](docs/SPEC-A4-A1-build-ready.md) | Customer binding flow (challenge/verify→bind) — A4 + A1.1‑A1.4 | Hiểu binding domain |
| [docs/SPEC-A2-customerId-from-binding.md](docs/SPEC-A2-customerId-from-binding.md) | A2: customerId-from-binding (đóng IDOR ở controller) | Hiểu A2 + remaining |
| [docs/SPEC-downstream-ownership-contract.md](docs/SPEC-downstream-ownership-contract.md) | Hợp đồng ownership gửi team downstream | Handoff downstream |
| [docs/SPEC-safe-wire-app-vs-customer-service.md](docs/SPEC-safe-wire-app-vs-customer-service.md) | Wire an toàn app‑BFF ↔ customer‑service | Hiểu ranh giới 2 bên |

---

## 🎯 Dự án là gì?

**Module CSKH** là một **API Gateway** (BFF — Backend For Frontend) cho công ty cấp nước. Nó **KHÔNG** chứa business logic — chỉ **coordinate, route, transform** giữa frontend và Backend API.

```
┌──────────┐      ┌─────────────┐      ┌──────────────┐
│ Frontend │ ←──→ │  CSKH (BFF) │ ←──→ │ Backend API  │
│ (Web/App)│      │  (dự án này)│      │ (contracts,  │
└──────────┘      └──────┬──────┘      │  meters, ...)│
                         │              └──────────────┘
                         ↓
                  ┌─────────────┐
                  │ Payment/    │
                  │ Ticket/KB   │
                  │ Services    │
                  └─────────────┘
```

### 9 Module nghiệp vụ

| Module | Vai trò |
|---|---|
| 🔐 **Auth** | Đăng ký/đăng nhập qua SĐT + OTP, OAuth (Zalo, Google, FB, Apple) |
| 👤 **Customer** | Hồ sơ 360°, timeline, tài khoản liên quan |
| 📄 **Contract** | Hợp đồng cấp nước, phiên bản, PDF |
| 💧 **Meter** | Đồng hồ nước, kiểm định, lịch sử tiêu thụ |
| 💰 **Billing** | Hóa đơn, biểu giá bậc thang, phí |
| 💳 **Payment** | Thanh toán (QR/batch), công nợ, auto-debit |
| 🎫 **Ticket** | Phản ánh sự cố, theo dõi, CSAT, Knowledge Base |
| 📢 **Communication** | Cảnh báo khu vực, thông báo, preferences |
| 🔄 **Session** | Ghi nhận hành trình tương tác khách hàng |

---

## 🚀 Quick Start (Docker — Khuyến nghị)

### Yêu cầu
- [Docker Desktop](https://www.docker.com/) (có Docker Compose v2)
- Git

### Bước 1: Khởi động stack

```bash
git clone <repository-url>
cd IOC_Customer
docker-compose up -d
```

Stack khởi động 3 service:
- **app** — API server (port 3000, distroless binary)
- **postgres** — Database (port 5432, internal only)
- **redis** — Cache + session store (port 6379, internal only)

### Bước 2: Kiểm tra sức khỏe

```bash
curl http://localhost:3000/health
```

Kỳ vọng: `{ "status": "up", ... }` với 13 circuit breakers CLOSED, DB + Redis healthy.

### Bước 3: Swagger UI

Mở trình duyệt: **http://localhost:3000/api/docs**

---

## 🔑 Authentication (Cách đăng nhập)

Hệ thống dùng **better-auth** với **phone + OTP** (không có username/password).

### Quy trình đăng nhập (3 bước)

```bash
# 1. Gửi OTP đến SĐT
curl -X POST http://localhost:3000/api/auth/phone-number/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"0987654321"}'
# → { "message": "code sent" }

# 2. Lấy mã OTP (từ DB — trong production thật KH nhận qua SMS)
docker exec nestjs-ddd-postgres psql -U postgres -d nestjs_project -tAc \
  "SELECT split_part(value, ':', 1) FROM verification WHERE identifier='0987654321' ORDER BY created_at DESC LIMIT 1;"

# 3. Xác thực OTP → nhận session cookie
curl -c cookies.txt -X POST http://localhost:3000/api/auth/phone-number/verify \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"0987654321","code":"<OTP_CODE>"}'
# → { "status": true, "token": "...", "user": {...} }
```

### Gọi API đã xác thực

```bash
# File cookies.txt chứa session cookie (HttpOnly, 7-day TTL)
curl -b cookies.txt http://localhost:3000/customers/profile
curl -b cookies.txt http://localhost:3000/billing/invoices
```

> ⚠️ **Lưu ý:** Mọi endpoint đều yêu cầu xác thực (qua `SessionAuthGuard`), TRỪ:
> - `/auth/register-phone`, `/api/auth/*` (public auth flow)
> - `/webhooks/*` (xác thực bằng `x-api-key` thay vì session)

---

## 🧪 Testing

### Unit Tests (1018 tests)

```bash
# Cần cài dependencies trước
npm install        # hoặc bun install
npx jest           # chạy toàn bộ 1018 tests
```

Kết quả kỳ vọng: `Test Suites: 106 passed, 106 total | Tests: 1018 passed`

### Production Smoke Test (Docker) — 1 lệnh!

Kịch bản tự động: **tự authenticate + test toàn bộ 9 modules + webhooks + Swagger**.

```bash
# Yêu cầu: Docker stack đang chạy
docker-compose up -d

# Chạy (50 tests, ~30 giây)
./scripts/smoke-test.sh

# Output:
#   ✅ TẤT CẢ PASS: 50/50 tests
```

Options:

```bash
./scripts/smoke-test.sh --json      # output JSON (cho CI/CD)
./scripts/smoke-test.sh --no-auth   # bỏ qua auth, dùng cookie có sẵn
```

> Test guide đã được dọn (đăng trên README phần test + `package.json` scripts). Chi tiết contract test: `test/integration/*.spec.ts`.

---

## 🛠️ Phát triển (Development)

### Yêu cầu dev
- [Bun](https://bun.sh/) 1.1+
- [Node.js](https://nodejs.org/) 22+

### Cài đặt & chạy dev

```bash
bun install

# Start Postgres + Redis (chỉ infra, không chạy app trong container)
docker-compose up -d postgres redis

# Copy env
cp .env.example .env
# → Cập nhật DATABASE_URL, REDIS_URL trỏ tới localhost

# Database migrations
bun run db:generate    # generate từ schema thay đổi
bun run db:migrate     # apply migrations
bun run db:studio      # (optional) Drizzle Studio UI

# Start dev server (hot-reload)
bun run start:dev
```

### Scripts có sẵn

| Script | Mô tả |
|---|---|
| `bun run start:dev` | Dev mode (hot-reload) |
| `bun run build` | Build (NestJS) |
| `bun run build:binary` | Build Bun single-binary (cho Docker) |
| `bun run start:prod` | Chạy binary production |
| `bun run test` | Unit tests (Jest) |
| `bun run test:cov` | Test + coverage report |
| `bun run lint` | ESLint + auto-fix |
| `bun run format` | Prettier format |
| `bun run db:generate` | Generate Drizzle migration |
| `bun run db:migrate` | Apply migration |
| `bun run db:studio` | Drizzle Studio (DB UI) |

---

## ⚙️ Cấu hình (Environment Variables)

Copy `.env.example` → `.env` và cấu hình. Các biến quan trọng:

```bash
# Service
PORT=3000
NODE_ENV=production          # production | development

# Database (PostgreSQL 16)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nestjs_project

# Redis (cache + session)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost

# Auth
BETTER_AUTH_SECRET=<32+ chars random>      # ⚠️ Rotate trong production
BETTER_AUTH_URL=http://localhost:3000
PII_ENCRYPTION_KEY=<64 hex chars>          # AES-256 key cho PII encryption

# Inter-service webhook auth
INTER_SERVICE_API_KEY=<shared secret>      # Payment IPN + Ticket webhook

# Downstream Backend API
BACKEND_BASE_URL=http://localhost:8080     # Backend thật (khi live)
```

> 🔒 **Production:** Rotate tất cả secrets. Xem thêm trong [project-context.md](\_bmad-output/project-context.md).

---

## 🏗️ Kiến trúc

### DDD/CQRS + Hexagonal Ports

```
src/
├── modules/                    # 9 business modules (vertical slices)
│   └── {module}/
│       ├── domain/             # entities, value-objects, events
│       ├── application/        # commands/queries + handlers + dtos
│       └── infrastructure/     # http controllers, ports, persistence
├── libs/
│   ├── core/                   # DDD base (AggregateRoot, VO, IUnitOfWork)
│   └── shared/                 # Port Registry, CQRS, Resilience, Security
└── main.ts
```

### 3 Pattern xử lý chính

| Pattern | Ví dụ | Module |
|---|---|---|
| **Pass-through** | Gọi downstream, trả về | Contract, Billing |
| **BFF-Computed** | Tính UI flags tại BFF | Meter (`isWarning`, `percentageChange`) |
| **Orchestration** | Nhiều bước + guard | Payment (verify → pay), Webhooks |

### Hexagonal Port System

Mọi call đến Backend API đi qua `PortRegistry`:
- **Mock/Live switching** qua `config/api-endpoints.yaml` (`adapter: mock|live`)
- **Per-port Circuit Breaker** (13 ports, độc lập)
- **Cache tiers**: static (12h), dynamic (15m), transaction (no cache)
- **Fallback**: trả cached data khi CB open

Hiện tại tất cả ports chạy `adapter: mock`. Khi Backend API live, đổi sang `adapter: live`.

📖 Chi tiết: [docs/project-documentation.md](docs/project-documentation.md)

---

## 📊 Trạng thái hiện tại

| Chỉ số | Giá trị |
|---|---|
| API Endpoints | 41 (tất cả verified trong Docker) |
| Unit Tests | 1018 passing (106 suites) |
| Source files | 466 TypeScript |
| DB tables (CSKH-owned) | 5 (users, provider_links, sessions, verification, outbox) |
| Circuit Breakers | 13 (tất cả healthy) |
| PII Encryption | AES-256-GCM + HMAC blind index |

---

## 🐛 Troubleshooting

| Vấn đề | Nguyên nhân | Cách fix |
|---|---|---|
| Endpoints trả 500 `PortFallbackException` | Docker image thiếu `mocks/` | Đã fix trong Dockerfile — rebuild: `docker-compose build app && docker-compose up -d app` |
| Webhook trả 403 | `INTER_SERVICE_API_KEY` chưa set | Thêm vào `.env.docker.compose` rồi restart |
| Endpoints trả 401 | Chưa xác thực hoặc session hết hạn | Làm lại flow phone OTP (xem Authentication) |
| better-auth 404 trên `/api/auth/sign-in/phone` | Sai route | Route đúng: `/api/auth/phone-number/send-otp` |
| App không start | Postgres/Redis chưa healthy | `docker-compose up -d` rồi chờ healthcheck |

---

## 📚 Tài liệu thêm

- [BMAD Method](_bmad/) — Framework quy trình phát triển
- [Project Context](_bmad-output/project-context.md) — Quick reference cho AI agents (the "bible")
- [Architecture](_bmad-output/planning-artifacts/architecture.md) — Kiến trúc chi tiết
- [PRD](_bmad-output/planning-artifacts/prd.md) — Product Requirements
- [Epics](_bmad-output/planning-artifacts/epics.md) — Epic breakdown

---

## 📄 License

UNLICENSED — Internal use only.

---

_Cập nhật lần cuối: 2026-06-13_
