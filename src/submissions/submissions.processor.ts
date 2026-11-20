import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import {
  Submission,
  SubmissionStatus,
} from './entities/submission.entity.js';
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api';
import {
  EXECUTION_QUEUE,
  ExecutionJobData,
} from '../queue/queue.constants.js';
import { CodeExecutor } from '../execution/executor.interface.js';
import {
  ExecutionOutcome,
  ExecutionResult,
} from '../execution/execution.types.js';
import { compareOutput } from '../execution/output-comparator.js';
import { MetricsService } from '../metrics/metrics.service.js';

const EXECUTION_TIMEOUT_MS = 5_000;

@Processor(EXECUTION_QUEUE, { concurrency: 4 })
export class SubmissionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionsProcessor.name);
  private readonly tracer = trace.getTracer('code-exec-engine');

  constructor(
    @InjectRepository(Submission)
    private readonly submissionsRepo: Repository<Submission>,
    private readonly executor: CodeExecutor,
    private readonly metricsService: MetricsService,
  ) {
    super();
  }


  async process(job: Job<ExecutionJobData>): Promise<void> {
    const { submissionId, traceContext } = job.data;

    // Recover the trace context injected by the API.
    const parentContext = propagation.extract(
      context.active(),
      traceContext ?? {},
    );

    return context.with(parentContext, async () => {
      return this.tracer.startActiveSpan(
        'submission.process',
        async (span) => {
          try {
            span.setAttribute('submission.id', submissionId);
            span.setAttribute('bullmq.job.id', String(job.id ?? 'unknown'));
            span.setAttribute('bullmq.attempt', job.attemptsMade);

            const submission = await this.submissionsRepo.findOne({
              where: { id: submissionId },
            });

            if (!submission) {
              this.logger.warn(
                `Submission ${submissionId} not found — dropping job`,
              );
              return;
            }

            if (this.isTerminal(submission.status)) {
              this.logger.log(
                `Submission ${submissionId} already ${submission.status} — skipping duplicate delivery`,
              );
              return;
            }

            await this.submissionsRepo.update(submissionId, {
              status: SubmissionStatus.RUNNING,
            });

            const result = await this.tracer.startActiveSpan(
              'docker.execute',
              async (dockerSpan) => {
                try {
                  dockerSpan.setAttribute('execution.language', submission.language);
                  dockerSpan.setAttribute('submission.id', submissionId);
                  dockerSpan.setAttribute('execution.timeout_ms', EXECUTION_TIMEOUT_MS);

                  const executionResult = await this.executor.execute({
                    code: submission.code,
                    language: submission.language,
                    stdin: submission.stdin,
                    timeoutMs: EXECUTION_TIMEOUT_MS,
                  });

                  this.metricsService.executionDuration.observe(
                    { language: submission.language },
                    executionResult.durationMs / 1000,
                  );

                  dockerSpan.setAttribute(
                    'execution.outcome',
                    executionResult.outcome,
                  );
                  dockerSpan.setAttribute(
                    'execution.duration_ms',
                    executionResult.durationMs,
                  );

                  return executionResult;
                } catch (err) {
                  dockerSpan.recordException(
                    err instanceof Error ? err : new Error(String(err)),
                  );
                  dockerSpan.setStatus({ code: SpanStatusCode.ERROR });
                  throw err;
                } finally {
                  dockerSpan.end();
                }
              },
            );

            if (result.outcome === ExecutionOutcome.INTERNAL_ERROR) {
              const attemptsLeft = job.opts.attempts ?? 1;

              if (job.attemptsMade + 1 < attemptsLeft) {
                this.logger.warn(
                  `Infra error on ${submissionId}, attempt ${job.attemptsMade + 1}/${attemptsLeft} — retrying`,
                );

                await this.submissionsRepo.update(submissionId, {
                  status: SubmissionStatus.PENDING,
                });

                throw new Error(result.stderr || 'Executor internal error');
              }
            }


            await this.tracer.startActiveSpan(
              'submission.update-result',
              async (updateSpan) => {
                try {
                  updateSpan.setAttribute('db.system', 'postgresql');
                  updateSpan.setAttribute('db.operation.name', 'UPDATE');
                  updateSpan.setAttribute('submission.id', submissionId);

                  await this.submissionsRepo.update(submissionId, {
                    status: this.toStatus(result.outcome),
                    result: result.stdout,
                    errorMessage: this.toErrorMessage(result),
                    passed: this.toPassed(result, submission.expectedOutput),
                  });

                  updateSpan.setAttribute(
                    'submission.status',
                    this.toStatus(result.outcome),
                  );
                } catch (err) {
                  updateSpan.recordException(
                    err instanceof Error ? err : new Error(String(err)),
                  );
                  updateSpan.setStatus({ code: SpanStatusCode.ERROR });
                  throw err;
                } finally {
                  updateSpan.end();
                }
              },
            );


            span.setAttribute('execution.outcome', result.outcome);
            span.setAttribute('execution.duration_ms', result.durationMs);

            this.logger.log(
              `Submission ${submissionId} → ${this.toStatus(result.outcome)} (${result.durationMs}ms)`,
            );
          } catch (err) {
            span.recordException(
              err instanceof Error ? err : new Error(String(err)),
            );
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          } finally {
            span.end();
          }
        },
      );
    });
  }

  // Comparison sirf tab jab expectedOutput diya ho AUR program cleanly
  // complete hua ho. Crash ya timeout ke output ko compare karna
  // meaningless hai, isliye wahan null rehta hai, false nahi.
  private toPassed(
    result: ExecutionResult,
    expectedOutput: string | null | undefined,
  ): boolean | null {
    if (!expectedOutput) return null;
    if (result.outcome !== ExecutionOutcome.SUCCESS) return null;
    return compareOutput(result.stdout, expectedOutput).passed;
  }

  private isTerminal(status: SubmissionStatus): boolean {
    return (
      status === SubmissionStatus.COMPLETED ||
      status === SubmissionStatus.FAILED ||
      status === SubmissionStatus.TIMEOUT
    );
  }

  private toStatus(outcome: ExecutionOutcome): SubmissionStatus {
    switch (outcome) {
      case ExecutionOutcome.SUCCESS:
        return SubmissionStatus.COMPLETED;
      case ExecutionOutcome.TIMEOUT:
        return SubmissionStatus.TIMEOUT;
      default:
        return SubmissionStatus.FAILED;
    }
  }

  private toErrorMessage(result: ExecutionResult): string | null {
    if (result.outcome === ExecutionOutcome.SUCCESS) return null;
    if (result.outcome === ExecutionOutcome.TIMEOUT) {
      return `Execution exceeded ${EXECUTION_TIMEOUT_MS}ms and was killed`;
    }
    if (result.stderr) return result.stderr;
    const code = `Exited with code ${result.exitCode}`;
    return result.stdout ? `${code}\n${result.stdout}` : code;
  }

}
