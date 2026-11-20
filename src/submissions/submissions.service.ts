import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Submission, SubmissionStatus } from './entities/submission.entity.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { ListSubmissionsDto } from './dto/list-submissions.dto.js';
import { context, propagation, trace, SpanStatusCode, } from '@opentelemetry/api';
import { EXECUTION_QUEUE, ExecutionJobData, } from '../queue/queue.constants.js';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);
  private readonly tracer = trace.getTracer('code-exec-engine');

  constructor(
    @InjectRepository(Submission)
    private readonly submissionsRepo: Repository<Submission>,
    @InjectQueue(EXECUTION_QUEUE)
    private readonly executionQueue: Queue<ExecutionJobData>,
  ) { }


  async create(dto: CreateSubmissionDto): Promise<Submission> {
    return this.tracer.startActiveSpan('submission.create', async (span) => {
      try {
        const submission = this.submissionsRepo.create({
          code: dto.code,
          language: dto.language,
          stdin: dto.stdin ?? null,
          expectedOutput: dto.expectedOutput ?? null,
          status: SubmissionStatus.PENDING,
        });

        const saved = await this.tracer.startActiveSpan(
          'submission.save',
          async (span) => {
            try {
              const result = await this.submissionsRepo.save(submission);

              span.setAttribute('db.system', 'postgresql');
              span.setAttribute('db.operation.name', 'INSERT');
              span.setAttribute('submission.id', result.id);

              return result;
            } catch (err) {
              span.recordException(
                err instanceof Error ? err : new Error(String(err)),
              );

              span.setStatus({
                code: SpanStatusCode.ERROR,
              });

              throw err;
            } finally {
              span.end();
            }
          },
        );

        span.setAttribute('submission.id', saved.id);
        span.setAttribute('submission.language', saved.language);

        const traceContext: Record<string, string> = {};
        propagation.inject(context.active(), traceContext);


        try {
          await this.tracer.startActiveSpan('queue.enqueue', async (span) => {
            try {
              span.setAttribute('messaging.system', 'bullmq');
              span.setAttribute('messaging.destination.name', EXECUTION_QUEUE);
              span.setAttribute('submission.id', saved.id);

             const job= await this.executionQueue.add(

                'execute',
                {
                  submissionId: saved.id,
                  traceContext,
                },
                {
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1_000 },
                  removeOnComplete: { count: 1_000 },
                  removeOnFail: { count: 5_000 },
                },
              );
              console.log('Job added:', job.id);

              console.log('Queue counts:', await this.executionQueue.getJobCounts(
                'waiting',
                'active',
                'completed',
                'failed',
              ));
            } catch (err) {
              span.recordException(
                err instanceof Error ? err : new Error(String(err)),
              );
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw err;
            } finally {
              span.end();
            }
          });
        } catch (err) {
          this.logger.error(
            `Failed to enqueue submission ${saved.id}: ${String(err)}`,
          );
        }


        return saved;
      } finally {
        span.end();
      }
    });
  }


  async findOne(id: string): Promise<Submission> {
    const submission = await this.submissionsRepo.findOne({ where: { id } });
    if (!submission) {
      throw new NotFoundException(`Submission ${id} not found`);
    }
    return submission;
  }

  async findAll(
    query: ListSubmissionsDto,
  ): Promise<{ data: Submission[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await this.submissionsRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }
}
