/**
 * BindingAuditRepository (A1.5) — append-only writes vào binding_audit.
 *
 * Template outbox.repository.ts: inject DATABASE_WRITE_TOKEN, mỗi write nhận
 * `transaction?` (optional-tx pattern) để caller có thể pass tx khi cần atomic
 * multi-table. BindingService hiện KHÔNG dùng UoW — gọi record() thường; thứ tự
 * ghi (audit SAU upsertVerified) đảm bảo không có audit row mồ côi.
 *
 * Insert failure do CALLER nuốt (BindingService.writeAudit — audit không được
 * phá bind UX); repository giữ semantics throw như mọi data-access class.
 */
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { type DrizzleDB } from '@shared';
import { type DrizzleTransaction } from '@shared/database/drizzle';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import { bindingAuditTable } from './drizzle/schema/binding-audit.schema';
import type { BindingAuditAction } from './drizzle/schema/binding-audit.schema';

export interface BindingAuditEntry {
  userId: string;
  customerRef?: string | null;
  action: BindingAuditAction;
  success: boolean;
  detail?: string | null;
  ip?: string | null;
  deviceInfo?: string | null;
}

@Injectable()
export class BindingAuditRepository {
  constructor(@Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB) {}

  async record(entry: BindingAuditEntry, transaction?: unknown): Promise<void> {
    const db = (transaction as DrizzleTransaction) || this.db;
    await db.insert(bindingAuditTable).values({ id: randomUUID(), ...entry });
  }
}
