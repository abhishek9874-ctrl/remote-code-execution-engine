import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { registerBullRedisDriver } from './queue/redis-driver.js';
import { AppModule } from './app.module.js';
import { startTelemetry } from './instrumentation.js';
import { MetricsInterceptor } from './metrics/metrics.interceptor.js';

// Must happen before NestFactory.create — @nestjs/bullmq builds its Workers
// during module initialisation, and they need this factory in place.
registerBullRedisDriver();

async function bootstrap() {
  startTelemetry();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Day 3 hardening: sets sane security headers (X-Content-Type-Options,
  // X-Frame-Options, HSTS, etc.) with one line instead of hand-rolling them.
  app.use(helmet());

  // Week 2+: allow the frontend (a different origin — Vite on :5173 vs this
  // API on :3000) to call this API from the browser. Locked to the Vite
  // dev server origin rather than left wide open.
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  });

  // Cap request body size at 100kb. Our DTO already limits `code` to 20k
  // chars, but that check only runs AFTER Express has parsed the whole
  // body into memory. This stops someone from sending a 500MB body and
  // making the server do the (expensive) parsing work at all.
  app.useBodyParser('json', { limit: '100kb' });

  // Global validation: every DTO's class-validator decorators (the language
  // whitelist, code size limit, etc.) are enforced automatically on every
  // request. whitelist:true strips any fields not defined on the DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const metricsInterceptor = app.get(MetricsInterceptor);
  app.useGlobalInterceptors(metricsInterceptor);

  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
