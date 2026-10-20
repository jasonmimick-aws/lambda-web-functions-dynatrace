'use strict';

// MUST be first: configures the OpenTelemetry tracer/meter providers.
require('./otel');

const express = require('express');
const {
  trace,
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
} = require('@opentelemetry/api');

const app = express();
app.use(express.json());

// Lambda Web Functions tell you where to listen via AWS_LAMBDA_HTTP_ENDPOINT.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT || '127.0.0.1:3000';
const [host, port] = endpoint.split(':');

const tracer = trace.getTracer('lambda-web-poc');
const meter = metrics.getMeter('lambda-web-poc');

// ---- Metrics (RED + custom) --------------------------------------------------
const requestCounter = meter.createCounter('app.requests', {
  description: 'Request count by route, method, and status',
});
const errorCounter = meter.createCounter('app.errors', {
  description: 'Error (5xx) count by route',
});
const latencyHistogram = meter.createHistogram('app.request.duration', {
  description: 'Request duration',
  unit: 'ms',
});

// ---- Tracing + metrics middleware (one SERVER span per request) --------------
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const span = tracer.startSpan(`${req.method} ${req.path}`, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.request.method': req.method,
      'url.path': req.path,
      'server.address': host,
      'user_agent.original': req.headers['user-agent'] || '',
    },
  });

  context.with(trace.setSpan(context.active(), span), () => {
    res.on('finish', () => {
      const route = req.route ? req.route.path : req.path;
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      const dims = {
        'http.route': route,
        'http.request.method': req.method,
        'http.response.status_code': res.statusCode,
      };
      span.setAttribute('http.route', route);
      span.setAttribute('http.response.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        errorCounter.add(1, { 'http.route': route });
      }
      requestCounter.add(1, dims);
      latencyHistogram.record(durMs, dims);
      span.end();
    });
    next();
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRODUCTS = [
  { id: 1, name: 'Firecracker microVM', price: 0 },
  { id: 2, name: 'Active-CPU billing', price: 42 },
  { id: 3, name: 'Multi-region routing', price: 99 },
];

// Helper: run a child span around simulated downstream I/O.
async function downstream(name, latencyMs, attrs = {}) {
  const span = tracer.startSpan(name, { kind: SpanKind.CLIENT, attributes: attrs });
  await sleep(latencyMs);
  span.end();
}

// ---- Routes ------------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    message: 'Hello from Lambda Web Functions + Dynatrace!',
    runtime: process.version,
    region: process.env.AWS_REGION || 'local',
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/products', (req, res) => res.json(PRODUCTS));

// I/O-bound: the sweet spot for Web Functions active-CPU billing.
app.get('/api/products/:id', async (req, res) => {
  const latency = 40 + Math.floor(Math.random() * 120);
  await downstream('catalog-db.query', latency, { 'db.system': 'dynamodb', 'db.operation': 'GetItem' });
  const product = PRODUCTS.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'not found' });
  res.json(product);
});

// Deliberately slow I/O to make the latency distribution interesting.
app.get('/api/slow', async (req, res) => {
  const latency = 300 + Math.floor(Math.random() * 600);
  await downstream('report-service.render', latency, { 'peer.service': 'report-service' });
  res.json({ ok: true, waitedMs: latency });
});

// Randomly errors so the dashboard has a non-zero failure rate.
app.get('/api/error', (req, res) => {
  if (Math.random() < 0.5) throw new Error('Simulated downstream failure');
  res.json({ ok: true });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const span = trace.getActiveSpan();
  if (span) span.recordException(err);
  res.status(500).json({ error: err.message });
});

app.listen(Number(port), host, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://${host}:${port}`);
});
