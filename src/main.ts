if (process.env.NODE_ENV !== 'production' && !process.env.SKIP_TSCONFIG_PATHS) {
  try {
    require('tsconfig-paths/register');
  } catch (e) {
    // Ignore error if not found or failing in non-dev env
  }
}
// Build stamp — log MỖI lần boot: git short hash + '-dirty' nếu working tree
// có thay đổi chưa commit (điều kiện cần cho verify: biết chắc SERVER đang chạy
// code nào — stamp mobile chỉ chứng minh được phía client).
try {
  const { execSync } = require('child_process') as typeof import('child_process');
  const hash = execSync('git rev-parse --short HEAD').toString().trim();
  const dirty = execSync('git status --porcelain').toString().trim() ? '-dirty' : '';
  // eslint-disable-next-line no-console
  console.log(`[build] app-tu-phuc-vu BFF running code: ${hash}${dirty}`);
} catch {
  // eslint-disable-next-line no-console
  console.log('[build] app-tu-phuc-vu BFF running code: unknown (no git)');
}
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  GlobalExceptionFilter,
  ResponseInterceptor,
  GlobalValidationPipe,
} from 'src/libs/shared/http';
import fastifyRawBody from 'fastify-raw-body';
import fastifyCors from '@fastify/cors';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      bufferLogs: true,
    },
  );

  // Use Pino logger for all NestJS logging
  app.useLogger(app.get(Logger));

  // Register raw body — needed for webhook signature verification
  // and better-auth (which requires raw body stream access).
  // global: true so all routes have rawBody available.
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: true,
    encoding: 'utf8',
  });

  // CORS — the Expo/mobile client calls cross-origin (no same-origin proxy like the
  // Next.js FE had). Dev config reflects any origin; lock `origin` down for production.
  // (Pc, 2026-07-14 — app-tu-phuc-vu-mobile migration slice)
  await app.register(fastifyCors, { origin: true, credentials: true });

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  // Global Validation Pipe - validates and transforms DTOs
  app.useGlobalPipes(GlobalValidationPipe);

  // Global Exception Filter - handles all exceptions
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global Response Interceptor - standardizes all responses
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger API Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NestJS DDD/CQRS API')
    .setDescription(
      `
## Overview
This API demonstrates Domain-Driven Design (DDD) and CQRS patterns in NestJS.

## Architecture
- **Domain Layer**: Pure TypeScript entities, value objects, domain events
- **Application Layer**: Commands, Queries, Handlers (CQRS)
- **Infrastructure Layer**: Repositories, DAOs, Controllers

## Features
- Aggregate Root pattern with Optimistic Concurrency Control
- Event-driven architecture with Transactional Outbox Pattern
- Read/Write separation (CQRS)
- Request correlation for distributed tracing
- Rate limiting and validation

## Authentication
Currently, this demo API does not require authentication.
In production, add Bearer token authentication.
    `,
    )
    .setVersion('1.0')
    .addTag('health', 'Health check endpoints')
    .addTag('auth', 'Authentication & user management')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Idempotency-Key',
        in: 'header',
        description: 'Idempotency key for safe retries',
      },
      'Idempotency-Key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Correlation-Id',
        in: 'header',
        description: 'Correlation ID for distributed tracing',
      },
      'Correlation-Id',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'NestJS DDD/CQRS API Docs',
    // Bun --compile binary does NOT bundle node_modules, so the default
    // swagger-ui-dist asset path (absolute node_modules path) is absent at
    // runtime → CSS/JS assets 404. Point to a directory we COPY into the
    // image (see Dockerfile). Falls back to default in dev (ts-node/bun run).
    ...(process.env.SWAGGER_UI_DIST
      ? { customSwaggerUiPath: process.env.SWAGGER_UI_DIST }
      : {}),
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`Application is running on: http://0.0.0.0:${port}`);
  logger.log(`Swagger docs available at: http://0.0.0.0:${port}/api/docs`);
}

bootstrap();
