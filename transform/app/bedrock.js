'use strict';

const {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const client = new BedrockRuntimeClient({ region: REGION });

// --- Low-level helpers --------------------------------------------------------
async function converse(prompt, maxTokens = 300) {
  const resp = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens, temperature: 0.2 },
    })
  );
  return {
    text: resp.output?.message?.content?.[0]?.text ?? '',
    outputTokens: resp.usage?.outputTokens ?? 0,
  };
}

async function* converseStream(prompt, maxTokens = 600) {
  const resp = await client.send(
    new ConverseStreamCommand({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens, temperature: 0.3 },
    })
  );
  for await (const event of resp.stream) {
    const delta = event.contentBlockDelta?.delta?.text;
    if (delta) yield delta;
  }
}

// --- Simple one-shot summary (small text) -------------------------------------
async function summarize(text) {
  const t0 = Date.now();
  const r = await converse(`Summarize the following text in one concise sentence.\n\n${text}`, 256);
  return { summary: r.text, model: MODEL_ID, usage: { outputTokens: r.outputTokens }, totalMs: Date.now() - t0 };
}

function chunk(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// Evenly sample up to `max` chunks across the whole document (representative,
// not just the opening pages).
function sampleChunks(all, max) {
  if (all.length <= max) return all.map((c, i) => ({ c, idx: i }));
  const step = all.length / max;
  const picked = [];
  for (let k = 0; k < max; k++) picked.push({ c: all[Math.floor(k * step)], idx: Math.floor(k * step) });
  return picked;
}

/*
 * Long-document summarization via map-reduce:
 *   map    - summarize many chunks concurrently (lots of parallel Bedrock calls,
 *            mostly I/O wait = the active-CPU sweet spot)
 *   reduce - stream a final synthesis of the section summaries
 * Yields event objects the SSE handler forwards to the browser.
 */
async function* summarizeLargeDocument(text, opts = {}) {
  const chunkChars = opts.chunkChars || 12000;
  const maxChunks = opts.maxChunks || 12;
  const concurrency = opts.concurrency || 4;

  const all = chunk(text, chunkChars);
  const picked = sampleChunks(all, maxChunks);
  const t0 = Date.now();
  yield { type: 'start', chars: text.length, totalSections: all.length, sampledSections: picked.length, concurrency };

  const partials = new Array(picked.length);
  let done = 0;
  let ttftMs = null;
  for (let i = 0; i < picked.length; i += concurrency) {
    const batch = picked.slice(i, i + concurrency).map(async (p, j) => {
      const r = await converse(
        `This is section ${p.idx + 1} of a long document. Summarize its key points in 2-3 sentences.\n\n${p.c}`,
        200
      );
      if (ttftMs === null) ttftMs = Date.now() - t0;
      partials[i + j] = r.text;
      done++;
    });
    await Promise.all(batch);
    yield { type: 'progress', done, total: picked.length };
  }

  yield { type: 'reduce' };
  const reducePrompt =
    `The following are summaries of ${picked.length} sections sampled across a long document ` +
    `(${all.length} sections total). Write a cohesive overall summary in 4-6 sentences.\n\n` +
    partials.map((s, i) => `Section ${i + 1}: ${s}`).join('\n\n');
  for await (const d of converseStream(reducePrompt, 700)) yield { type: 'delta', text: d };

  yield {
    type: 'done',
    ttftMs: ttftMs ?? Date.now() - t0,
    totalMs: Date.now() - t0,
    sampledSections: picked.length,
    totalSections: all.length,
    bedrockCalls: picked.length + 1,
  };
}

module.exports = { summarize, summarizeLargeDocument, MODEL_ID };
