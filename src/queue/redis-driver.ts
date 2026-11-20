import { RedisConnection, createIORedisClient } from 'bullmq';
import { Redis as IORedis } from 'ioredis';

/**
 * Teaches BullMQ how to build a Redis client in a native ESM project.
 *
 * BullMQ lazy-loads ioredis with a bare `require('ioredis')`. In a package
 * with "type": "module" there is no `require`, so that load throws:
 *   "BullMQ could not load the optional 'ioredis' package."
 *
 * Passing a pre-built client via BullModule's `connection` option is not
 * enough on its own: @nestjs/bullmq creates a *separate* Worker per
 * @Processor, and that Worker constructs its own RedisConnection, which
 * falls back to the broken require() path.
 *
 * `RedisConnection.clientFactory` is the documented global escape hatch —
 * whenever BullMQ needs a client (queue, worker, events) it calls this
 * instead of require()ing ioredis itself.
 *
 * Must run BEFORE Nest instantiates any queue or worker, so main.ts imports
 * this module first.
 */
export function registerBullRedisDriver(): void {
  if (RedisConnection.clientFactory) return; // idempotent

  RedisConnection.clientFactory = (opts) => {
    const { url, ...rest } = (opts ?? {}) as Record<string, unknown> & {
      url?: string;
    };

    const client = url
      ? new IORedis(url, rest as object)
      : new IORedis(rest as object);

    return createIORedisClient(client);
  };
}
