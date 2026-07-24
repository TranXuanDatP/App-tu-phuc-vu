/**
 * In-Memory Session Store
 *
 * Fallback implementation of ISessionStore for development without Redis.
 * Uses Map + sorted arrays to simulate Redis Hash + Sorted Set behavior.
 *
 * NOT suitable for production — data lost on restart, no cross-instance sharing.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { ISessionStore } from '../session-store.interface';
import type { SessionEvent, SessionMetadata } from '../../dto/session-event.dto';

interface SessionData {
  metadata: SessionMetadata;
  events: SessionEvent[];
}

@Injectable()
export class InMemorySessionStore implements ISessionStore {
  private readonly logger = new Logger(InMemorySessionStore.name);
  private readonly sessions = new Map<string, SessionData>();
  private readonly defaultTtl: number;

  constructor(defaultTtl = 86400) {
    this.defaultTtl = defaultTtl;
    this.logger.warn('Using InMemorySessionStore — sessions will NOT survive restarts. Start Redis for production behavior.');
  }

  async appendEvent(userId: string, event: SessionEvent, ttl?: number): Promise<void> {
    let session = this.sessions.get(userId);

    if (!session) {
      const now = new Date().toISOString();
      session = {
        metadata: {
          sessionId: event.id, // Use first event ID as session ID
          userId,
          channel: event.channel,
          createdAt: now,
          updatedAt: now,
          eventCount: 0,
        },
        events: [],
      };
      this.sessions.set(userId, session);
    }

    session.events.push(event);
    session.metadata.updatedAt = event.timestamp;
    session.metadata.channel = event.channel;
    session.metadata.eventCount = session.events.length;
  }

  async getSession(userId: string): Promise<SessionMetadata | null> {
    const session = this.sessions.get(userId);
    if (!session) return null;
    return { ...session.metadata };
  }

  async getEvents(userId: string, from = 0, to = Infinity): Promise<SessionEvent[]> {
    const session = this.sessions.get(userId);
    if (!session) return [];

    return session.events.filter((event) => {
      const ts = new Date(event.timestamp).getTime();
      return ts >= from && ts <= to;
    });
  }

  async sessionExists(userId: string): Promise<boolean> {
    return this.sessions.has(userId);
  }
}
