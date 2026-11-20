import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Submission } from './entities/submission.entity.js';
import { SubmissionsService } from './submissions.service.js';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsProcessor } from './submissions.processor.js';
import { EXECUTION_QUEUE } from '../queue/queue.constants.js';
import { ExecutionModule } from '../execution/execution.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Submission]),
    BullModule.registerQueue({ name: EXECUTION_QUEUE }),
    ExecutionModule,
    MetricsModule
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SubmissionsProcessor],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
