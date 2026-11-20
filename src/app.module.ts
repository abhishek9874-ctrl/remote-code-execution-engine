import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { MetricsModule } from './metrics/metrics.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_DATABASE', 'code_exec_engine'),
        autoLoadEntities: true,
        // Day 2: switched off. Schema changes now go through versioned
        // migrations (see data-source.ts + migrations/) instead of
        // auto-sync guessing the schema from entities at boot time.
        synchronize: false,
        migrations: ['dist/migrations/*.js'],
        migrationsRun: false,
      }),
    }),
    // Day 3 (hardening): global rate limiting using a fixed-window
    // algorithm — N requests per TTL window, tracked per client IP by
    // default. Two tiers here: a loose global default, and a stricter
    // one applied specifically to the submissions endpoints (see
    // submissions.controller.ts's @Throttle overrides).
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minute window
        limit: 30, // 30 requests/min/IP across the whole API
      },
    ]),
    // Week 2: Redis connection shared by every queue in the app.
    //
    // Plain options are fine here because registerBullRedisDriver() (called
    // in main.ts) installs a global RedisConnection.clientFactory that knows
    // how to construct an ioredis client under native ESM.
    //
    // maxRetriesPerRequest: null is REQUIRED by BullMQ workers — they hold
    // long-lived blocking connections, and ioredis' default retry cap would
    // kill them mid-wait.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    MetricsModule,
    SubmissionsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
