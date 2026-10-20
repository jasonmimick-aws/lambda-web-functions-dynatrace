'use strict';

/*
 * Platform-agnostic OpenTelemetry bootstrap. The SAME file runs on ECS Fargate
 * and on a Lambda Web Function. The only thing that differs is the value of
 * DEPLOY_PLATFORM, which we stamp onto every span and metric (as a resource
 * attribute AND an explicit dimension) so Dynatrace can overlay the two
 * platforms on one chart via `by:{platform}`.
 *
 * Config comes from OTEL_* env vars (no secrets in source):
 *   OTEL_EXPORTER_OTLP_ENDPOINT = https://<env>.live.dynatrace.com/api/v2/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS  = Authorization=Api-Token dt0c01....
 *   OTEL_EXPORTER_OTLP_PROTOCOL = http/protobuf
 *   OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = delta
 */

const PLATFORM = process.env.DEPLOY_PLATFORM || 'local';

const { diag, DiagConsoleLogger, DiagLogLevel, metrics } = require('@opentelemetry/api');
if (process.env.OTEL_LOG_LEVEL) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  if (!process.env.OTEL_NODE_RESOURCE_DETECTORS) {
    process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env,process';
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'doc-intel-api',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
    'deployment.environment': process.env.APP_ENV || 'poc',
    'deployment.platform': PLATFORM,
    'cloud.provider': 'aws',
    'cloud.region': process.env.AWS_REGION || 'us-east-1',
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter(), {
        scheduledDelayMillis: Number(process.env.OTEL_BSP_SCHEDULE_DELAY || 2000),
        maxExportBatchSize: 512,
        maxQueueSize: 4096,
      }),
    ],
  });
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 15000),
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  // eslint-disable-next-line no-console
  console.log(`[otel] started platform=${PLATFORM} -> ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`);

  const shutdown = () =>
    Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]).finally(() =>
      process.exit(0)
    );
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  // eslint-disable-next-line no-console
  console.log('[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set, telemetry disabled');
}

module.exports = { PLATFORM };
