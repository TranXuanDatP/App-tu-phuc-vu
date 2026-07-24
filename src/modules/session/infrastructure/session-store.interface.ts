import type { SessionEvent, SessionMetadata } from '../dto/session-event.dto';

export interface ISessionStore {
  /**
   * Atomically append a session event.
   * Uses Lua script for atomic ZADD + EXPIRE + HSET + EXPIRE.
   */
  appendEvent(userId: string, event: SessionEvent, ttl?: number): Promise<void>;

  /**
   * Get session metadata. Returns null if session doesn't exist.
   */
  getSession(userId: string): Promise<SessionMetadata | null>;

  /**
   * Get session events within a time range.
   * @param from Unix timestamp ms (default: 0)
   * @param to Unix timestamp ms (default: +Infinity)
   */
  getEvents(userId: string, from?: number, to?: number): Promise<SessionEvent[]>;

  /**
   * Check if a session exists.
   */
  sessionExists(userId: string): Promise<boolean>;
}
