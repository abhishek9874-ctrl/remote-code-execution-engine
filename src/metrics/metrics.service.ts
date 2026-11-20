
import { Injectable } from '@nestjs/common';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EXECUTION_QUEUE } from '../queue/queue.constants.js';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // Total HTTP requests
  readonly httpRequests: Counter<string>;

  // Total HTTP errors
  readonly httpErrors: Counter<string>;

  // Current pending jobs
  readonly queueDepth: Gauge<string>;

  // Code execution duration
  readonly executionDuration: Histogram<string>;

  constructor(
    @InjectQueue(EXECUTION_QUEUE)
    private readonly executionQueue: Queue,
  ) {
    this.registry = new Registry();

    // Default Node.js metrics: memory, CPU, event loop, etc.
    collectDefaultMetrics({
      register: this.registry,
    });

    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpErrors = new Counter({
      name: 'http_errors_total',
      help: 'Total number of HTTP errors',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'queue_depth',
      help: 'Current number of waiting jobs',
      registers: [this.registry],
    });

    this.executionDuration = new Histogram({
      name: 'execution_duration_seconds',
      help: 'Code execution duration in seconds',
      labelNames: ['language'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
  }

  async updateQueueDepth(): Promise<void> {
    const waitingCount = await this.executionQueue.getWaitingCount();
    this.queueDepth.set(waitingCount);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
