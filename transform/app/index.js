'use strict';

// MUST be first.
const { PLATFORM } = require('./otel');

const express = require('express');
const path = require('path');
const { trace, context, metrics, SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const { summarize, summarizeLargeDocument, MODEL_ID } = require('./bedrock');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Port resolution: Lambda Web Functions set AWS_LAMBDA_HTTP_ENDPOINT (host:port);
// containers (Fargate) just get PORT. Same code, both platforms.
// Local development is loopback-only. Fargate listens on all container
// interfaces because the task ENI and ALB are the network boundary.
let host = PLATFORM === 'fargate' ? '0.0.0.0' : '127.0.0.1';
let port = process.env.PORT || 8080;
if (process.env.AWS_LAMBDA_HTTP_ENDPOINT) {
  [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');
}

const tracer = trace.getTracer('doc-intel-api');
const meter = metrics.getMeter('doc-intel-api');

// Cold-start detection: a fresh execution environment is a fresh Node process,
// so a module-level flag flips false after the first request this process serves.
let COLD = true;

// Every metric carries platform so Dynatrace can overlay fargate vs lambda-web.
const base = { platform: PLATFORM };
const requestCounter = meter.createCounter('app.requests', { description: 'Requests by route/method/status' });
const errorCounter = meter.createCounter('app.errors', { description: '5xx errors by route' });
const latency = meter.createHistogram('app.request.duration', { description: 'Request duration', unit: 'ms' });
const inflight = meter.createUpDownCounter('app.inflight', { description: 'In-flight concurrent requests' });
const genaiLatency = meter.createHistogram('genai.request.duration', { description: 'Bedrock call duration', unit: 'ms' });
const genaiTtft = meter.createHistogram('genai.ttft', { description: 'Time to first token', unit: 'ms' });
const genaiOutTokens = meter.createCounter('genai.output_tokens', { description: 'Output tokens generated' });
const coldstartCounter = meter.createCounter('app.coldstart', { description: 'Cold starts (first request per environment)' });

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const isCold = COLD;
  COLD = false;
  inflight.add(1, base);
  res.setHeader('x-platform', PLATFORM);
  const span = tracer.startSpan(`${req.method} ${req.path}`, {
    kind: SpanKind.SERVER,
    attributes: { 'http.request.method': req.method, 'url.path': req.path, platform: PLATFORM, 'faas.coldstart': isCold },
  });
  if (isCold) coldstartCounter.add(1, base);
  context.with(trace.setSpan(context.active(), span), () => {
    res.on('finish', () => {
      const route = req.route ? req.route.path : req.path;
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      const dims = { ...base, 'http.route': route, 'http.request.method': req.method, 'http.response.status_code': res.statusCode };
      span.setAttribute('http.route', route);
      span.setAttribute('http.response.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        errorCounter.add(1, { ...base, 'http.route': route });
      }
      requestCounter.add(1, dims);
      latency.record(durMs, dims);
      inflight.add(-1, base);
      span.end();
    });
    next();
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Large public-domain documents served from ./documents. Sizes are read from
// file stats at startup (cheap); full text is read lazily only when summarizing.
const fs = require('fs');
const DOC_DIR = path.join(__dirname, 'documents');
const DOC_META = {
  'warandpeace.txt': { title: 'War and Peace', author: 'Leo Tolstoy' },
  'kjvbible.txt': { title: 'The King James Bible', author: 'Authorized Version, 1611' },
  'mobydick.txt': { title: 'Moby-Dick; or, The Whale', author: 'Herman Melville' },
  'shakespeare.txt': { title: 'The Complete Works of William Shakespeare', author: 'William Shakespeare' },
};
const CHUNK_CHARS = 12000;
let DOCS = [];
try {
  DOCS = fs.readdirSync(DOC_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f, i) => {
      const bytes = fs.statSync(path.join(DOC_DIR, f)).size;
      const meta = DOC_META[f] || { title: f, author: 'Unknown' };
      return {
        id: i + 1,
        file: f,
        title: meta.title,
        author: meta.author,
        bytes,
        words: Math.round(bytes / 6),
        sections: Math.ceil(bytes / CHUNK_CHARS),
      };
    })
    .sort((a, b) => a.id - b.id);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log('[docs] no documents dir:', e.message);
}

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
function docById(id) {
  return DOCS.find((d) => d.id === id);
}
function readDocText(doc) {
  return fs.readFileSync(path.join(DOC_DIR, doc.file), 'utf8');
}

async function downstream(name, ms, attrs = {}) {
  const span = tracer.startSpan(name, { kind: SpanKind.CLIENT, attributes: { platform: PLATFORM, ...attrs } });
  await sleep(ms);
  span.end();
}

// ---- Routes ------------------------------------------------------------------
// Static single-page UI (served at /).
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/info', (req, res) =>
  res.json({ service: 'doc-intel-api', platform: PLATFORM, runtime: process.version, region: process.env.AWS_REGION || 'local', model: MODEL_ID, dashboardUrl: process.env.DASHBOARD_URL || null })
);

app.get('/health', (req, res) => res.json({ status: 'ok', platform: PLATFORM }));

// CPU-bound endpoint: burns ~ms of real CPU on the (single) Node thread. This
// surfaces the multi-concurrency tradeoff — many concurrent CPU requests packed
// into one execution environment contend for one thread, inflating tail latency.
app.get('/api/cpu', (req, res) => {
  const ms = Math.min(Math.max(Number(req.query.ms) || 40, 1), 500);
  const span = tracer.startSpan('cpu.work', { attributes: { platform: PLATFORM, 'cpu.target_ms': ms } });
  const t0 = Date.now();
  let x = 0;
  while (Date.now() - t0 < ms) {
    for (let i = 0; i < 20000; i++) x += Math.sqrt(i * Math.random());
  }
  span.setAttribute('cpu.actual_ms', Date.now() - t0);
  span.end();
  res.json({ ok: true, cpuMs: ms, platform: PLATFORM, checksum: Math.round(x) });
});

app.get('/api/documents', (req, res) =>
  res.json(DOCS.map((d) => ({ id: d.id, title: d.title, author: d.author, size: mb(d.bytes), words: d.words, sections: d.sections })))
);

// I/O-bound metadata read — also the deterministic load-comparison endpoint.
// Returns small metadata + preview (never the multi-MB body).
app.get('/api/documents/:id', async (req, res) => {
  const id = Number(req.params.id);
  const lat = 30 + (id % 50);
  await downstream('datastore.get', lat, { 'db.system': 'dynamodb', 'db.operation': 'GetItem' });
  const doc = docById(id);
  if (!doc) return res.json({ id, title: `Archived doc ${id}`, servedBy: PLATFORM, downstreamMs: lat });
  let preview = '';
  try {
    const fd = fs.openSync(path.join(DOC_DIR, doc.file), 'r');
    const buf = Buffer.alloc(1600);
    fs.readSync(fd, buf, 0, 1600, 400);
    fs.closeSync(fd);
    preview = buf.toString('utf8').replace(/\s+/g, ' ').trim() + '…';
  } catch (e) { /* ignore */ }
  res.json({ id: doc.id, title: doc.title, author: doc.author, size: mb(doc.bytes), words: doc.words, sections: doc.sections, preview, servedBy: PLATFORM, downstreamMs: lat });
});

// GenAI feature: summarize text via Bedrock (non-streaming JSON).
app.post('/api/summarize', async (req, res) => {
  const text = (req.body && req.body.text) || 'AWS Lambda Web Functions run standard HTTP servers on Lambda with multi-concurrency and active-CPU billing.';
  const span = tracer.startSpan('bedrock.summarize', { kind: SpanKind.CLIENT, attributes: { platform: PLATFORM, 'gen_ai.request.model': MODEL_ID } });
  try {
    const out = await summarize(text);
    span.setAttribute('gen_ai.usage.output_tokens', out.usage?.outputTokens || 0);
    genaiLatency.record(out.totalMs, base);
    genaiOutTokens.add(out.usage?.outputTokens || 0, base);
    res.json(out);
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    res.status(502).json({ error: String(err.message || err) });
  } finally {
    span.end();
  }
});

// GenAI: summarize a LARGE document by id via map-reduce. Streams progress for
// each section (many concurrent Bedrock calls) then the final synthesis token
// by token. This is a long, I/O-bound, fan-out request — the Web Functions
// active-CPU + multi-concurrency sweet spot.
app.post('/api/summarize/stream', async (req, res) => {
  const id = Number(req.body && req.body.id);
  const doc = docById(id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  const span = tracer.startSpan('bedrock.summarize_document', {
    kind: SpanKind.CLIENT,
    attributes: { platform: PLATFORM, 'gen_ai.request.model': MODEL_ID, 'document.id': id, 'document.title': doc ? doc.title : '' },
  });
  try {
    if (!doc) {
      res.write(`data: ${JSON.stringify({ error: 'unknown document id' })}\n\n`);
      return;
    }
    const text = readDocText(doc);
    for await (const ev of summarizeLargeDocument(text, { maxChunks: Number(process.env.SUMMARIZE_MAX_CHUNKS) || 12 })) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (ev.type === 'done') {
        span.setAttribute('gen_ai.ttft_ms', ev.ttftMs);
        span.setAttribute('gen_ai.bedrock_calls', ev.bedrockCalls);
        genaiTtft.record(ev.ttftMs, base);
        genaiLatency.record(ev.totalMs, base);
        genaiOutTokens.add(ev.bedrockCalls, base);
      }
    }
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
  } finally {
    span.end();
    res.end();
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const span = trace.getActiveSpan();
  if (span) span.recordException(err);
  res.status(500).json({ error: err.message });
});

app.listen(Number(port), host, () => {
  // eslint-disable-next-line no-console
  console.log(`doc-intel-api [${PLATFORM}] listening on http://${host}:${port}`);
});
