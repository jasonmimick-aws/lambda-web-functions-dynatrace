'use strict';

/*
 * OpenTelemetry bootstrap for the Lambda Web Function POC.
 *
 * Lightweight, explicit setup (no auto-instrumentation): we create spans
 * ourselves in the request middleware. This avoids framework-instrumentation
 * compatibility gaps and keeps the Lambda cold-start small.
 *
 * Config comes from OTEL_* environment variables so no secrets live in source:
 *   OTEL_EXPORTER_OTLP_ENDPOINT = https://<env>.live.dynatrace.com/api/v2/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS  = Authorization=Api-Token dt0c01....
 *   OTEL_EXPORTER_OTLP_PROTOCOL = http/protobuf
 *   OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = delta   (Dynatrace needs delta)
 */

const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
if (process.env.OTEL_LOG_LEVEL) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { metrics } = require('@opentelemetry/api');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');

let started = false;

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'lambda-web-poc',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
    'deployment.environment': process.env.APP_ENV || 'poc',
    'cloud.provider': 'aws',
    'cloud.platform': 'aws_lambda_web',
    'faas.name': process.env.AWS_LAMBDA_FUNCTION_NAME || 'lambda-web-dynatrace-poc',
    'aws.region': process.env.AWS_REGION || 'local',
  });

  // --- Traces ---
  const spanProcessors = [
    new BatchSpanProcessor(new OTLPTraceExporter(), {
      scheduledDelayMillis: Number(process.env.OTEL_BSP_SCHEDULE_DELAY || 2000),
      maxExportBatchSize: 512,
    }),
  ];
  if (process.env.OTEL_DEBUG_CONSOLE) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }
  const tracerProvider = new NodeTracerProvider({ resource, spanProcessors });
  tracerProvider.register();

  // --- Metrics ---
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

  started = true;
  // eslint-disable-next-line no-console
  console.log('[otel] started, exporting to', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

  const shutdown = () => {
    Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]).finally(() =>
      process.exit(0)
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  // eslint-disable-next-line no-console
  console.log('[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set, telemetry disabled');
}

module.exports = { started };
