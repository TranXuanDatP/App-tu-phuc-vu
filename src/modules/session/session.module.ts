/**
 * Session module — lean BFF module (4-part: controller + service + dto + infra store).
 * Owns a session/event store (Redis or InMemory) as infra — like a cache, NOT
 * business state. No domain/, no CQRS handlers.
 */
import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { SESSION_STORE_TOKEN, SESSION_TTL_TOKEN } from './constants/tokens';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import { RedisSessionStore } from './infrastructure/redis/redis-session.store';
import { InMemorySessionStore } from './infrastructure/memory/in-memory-session.store';

@Module({
  controllers: [SessionController],
  providers: [
    SessionService,
    // TTL configuration from env
    {
      provide: SESSION_TTL_TOKEN,
      useFactory: (configService: ConfigService) =>
        parseInt(configService.get<string>('SESSION_TTL_SECONDS', '86400'), 10),
      inject: [ConfigService],
    },
    // Session Store — Redis when available, InMemory fallback.
    // Factory decides at bootstrap; only one store implementation is instantiated.
    {
      provide: SESSION_STORE_TOKEN,
      useFactory: (configService: ConfigService, cacheService: any, ttl: number) => {
        const logger = new Logger('SessionModule');
        const redisHost = configService.get<string>('REDIS_HOST');
        if (redisHost) {
          logger.log('Using RedisSessionStore (Redis available)');
          return new RedisSessionStore(cacheService, ttl);
        }
        logger.warn(
          'Using InMemorySessionStore (no Redis) — sessions will NOT survive restarts',
        );
        return new InMemorySessionStore(ttl);
      },
      inject: [ConfigService, CACHE_SERVICE_TOKEN, SESSION_TTL_TOKEN],
    },
  ],
  exports: [SESSION_STORE_TOKEN],
})
export class SessionModule {}
