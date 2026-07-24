/**
 * Session controller — REST endpoints for session data and events.
 * Thin: route + auth → delegates to SessionService.
 *
 * Routes (preserved exactly):
 *  - GET /sessions/me          → current session metadata + recent events
 *  - GET /sessions/me/events   → session event history (paginated/filtered)
 *
 * ⚠️ Route ordering: GET /me and GET /me/events MUST come BEFORE any :id routes.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { SessionService } from './session.service';

@ApiTags('Sessions')
@ApiBearerAuth('JWT-auth')
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * GET /sessions/me
   * Get current session metadata + recent events (last 2h) (AC#1, #2)
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current session detail' })
  getMySession(@CurrentUser('id') userId: string) {
    return this.sessionService.getMySession(userId);
  }

  /**
   * GET /sessions/me/events
   * Get session events with pagination and filters (AC#4)
   */
  @Get('me/events')
  @ApiOperation({ summary: 'Get session event history' })
  getMyEvents(
    @CurrentUser('id') userId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.sessionService.getMyEvents(userId, query);
  }
}
