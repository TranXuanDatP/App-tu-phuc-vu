/**
 * Drizzle Schema Exports
 *
 * Export tất cả table schemas
 */

import {
  outboxStatusEnum,
  outboxTable,
} from '@shared/database/outbox/drizzle/schema/outbox.schema';

import {
  usersTable,
  userRoleEnum,
  userStatusEnum,
} from '@modules/auth/infrastructure/persistence/drizzle/schema/user.schema';

import {
  providerLinksTable,
  providerTypeEnum,
} from '@modules/auth/infrastructure/persistence/drizzle/schema/provider-link.schema';

import { sessionsTable } from '@modules/auth/infrastructure/persistence/drizzle/schema/session.schema';

import { verificationTable } from '@modules/auth/infrastructure/persistence/drizzle/schema/verification.schema';

import { customerBindingsTable } from '@modules/binding/infrastructure/persistence/drizzle/schema/binding.schema';

export const schema = {
  outboxTable,
  outboxStatusEnum,
  // Auth module tables
  usersTable,
  userRoleEnum,
  userStatusEnum,
  providerLinksTable,
  providerTypeEnum,
  sessionsTable,
  verificationTable,
  // Binding module table (customer binding proof)
  customerBindingsTable,
};
