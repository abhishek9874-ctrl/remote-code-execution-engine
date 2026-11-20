
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const startTime = process.hrtime();

    response.once('finish', () => {
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const duration = seconds + nanoseconds / 1e9;

      const labels = {
        method: request.method,
        route: request.route?.path ?? request.path,
        status_code: String(response.statusCode),
      };

      this.metricsService.httpRequests.inc(labels);

      if (response.statusCode >= 400) {
        this.metricsService.httpErrors.inc(labels);
      }
    });

    return next.handle();
  }
}
