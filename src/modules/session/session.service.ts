/**
 * Session service — lean BFF orchestrator over the session/event store.
 * Thin read-only access; no business logic. Methods are the former READ
 * handlers' execute() bodies:
 *  - getMySession  ← GetSessionDetailHandler (session metadata + recent events)
 *  - getMyEvents   ← GetSessionEventsHandler (paginated/filtered event history)
 *
 * The write-side handlers (record-session-event / ensure-session) were dropped;
 * the store still serves reads and writes will be re-wired later if needed.
 */
import { Injectable, Inject } from '@nestjs/common';
import { SESSION_STORE_TOKEN } from './constants/tokens';
import type { ISessionStore } from './infrastructure/session-store.interface';
import { SessionEventsQuerySchema } from './dto/session-query.dto';
import type {
  SessionDetailResponse,
  SessionEventsResponse,
} from './dto/session-query.dto';
import { ValidationException } from '@core/common';

/** Time window for "recent events" in the session detail view (2 hours in ms) */
const RECENT_EVENTS_WINDOW_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_STORE_TOKEN) private readonly sessionStore: ISessionStore,
  ) {}

  /** GET /sessions/me — session metadata + recent events (last 2h). */
  async getMySession(userId: string): Promise<SessionDetailResponse> {
    const metadata = await this.sessionStore.getSession(userId);
    if (!metadata) {
      return { session: null, recentEvents: [] };
    }
    const windowStart = Date.now() - RECENT_EVENTS_WINDOW_MS;
    const recentEvents = await this.sessionStore.getEvents(userId, windowStart);
    return { session: metadata, recentEvents };
  }

  /** GET /sessions/me/events — paginated, filtered session event history. */
  async getMyEvents(
    userId: string,
    query: Record<string, unknown>,
  ): Promise<SessionEventsResponse> {
    const validated = SessionEventsQuerySchema.safeParse(query);
    if (!validated.success) {
      throw new ValidationException(validated.error.message);
    }
    const { from, to, channel, page, pageSize } = validated.data;

    // Fetch session metadata for sessionId
    const metadata = await this.sessionStore.getSession(userId);

    // Fetch all time-range events from the store, then secondary channel filter
    let events = await this.sessionStore.getEvents(userId, from, to);
    if (channel) {
      events = events.filter((e) => e.channel === channel);
    }

    const totalCount = events.length;
    const offset = (page - 1) * pageSize;
    const paginatedEvents = events.slice(offset, offset + pageSize);

    return {
      sessionId: metadata?.sessionId ?? null,
      events: paginatedEvents,
      totalCount,
      page,
      pageSize,
    };
  }
}
