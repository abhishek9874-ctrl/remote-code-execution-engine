import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  serviceName: 'code-exec-engine',
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
});

export function startTelemetry() {
  sdk.start();
}

process.on('SIGTERM', () => {
  void sdk.shutdown();
});

process.on('SIGINT', () => {
  void sdk.shutdown();
});