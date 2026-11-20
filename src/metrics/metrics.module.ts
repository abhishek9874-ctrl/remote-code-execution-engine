import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MetricsService } from './metrics.service.js';
import { MetricsController } from './metrics.controller.js';
import { EXECUTION_QUEUE } from '../queue/queue.constants.js';
import { MetricsInterceptor } from './metrics.interceptor.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: EXECUTION_QUEUE,
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService],
})
export class MetricsModule {}