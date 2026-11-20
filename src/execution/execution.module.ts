import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CodeExecutor } from './executor.interface.js';
import { DockerExecutor } from './docker.executor.js';
import { LocalExecutor } from './local.executor.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CodeExecutor,
      inject: [ConfigService],
      useFactory: (config: ConfigService): CodeExecutor => {
        const mode = config.get<string>('EXECUTOR', 'docker');
        const env = config.get<string>('NODE_ENV', 'development');

        if (mode === 'local') {
          // Hard stop rather than a warning. An unsandboxed executor in
          // production is a remote-code-execution hole, not a config smell.
          if (env === 'production') {
            throw new Error(
              'EXECUTOR=local is forbidden in production — it does not sandbox submitted code.',
            );
          }
          new Logger('ExecutionModule').warn(
            'Using LocalExecutor (no sandbox). Set EXECUTOR=docker for real isolation.',
          );
          return new LocalExecutor();
        }

        return new DockerExecutor();
      },
    },
  ],
  exports: [CodeExecutor],
})
export class ExecutionModule {}
