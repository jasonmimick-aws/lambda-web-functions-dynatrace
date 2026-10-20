# AWS Lambda Web Functions × Dynatrace — migration study

Evaluating the new **AWS Lambda Web Functions** form factor (HTTP-native Lambda, launched
Oct 2026) as a destination for enterprise HTTP workloads, with **Dynatrace** as the
measurement layer. The same Node.js service runs **unchanged** on AWS Lambda Web Functions
and on Amazon ECS Fargate, is instrumented with OpenTelemetry, and is compared under load on
a single Dynatrace dashboard. The service also carries a real GenAI workload: map-reduce
summarization of full-length books via Amazon Bedrock (Claude Sonnet).

> Shared for technical review. Feedback and ideas welcome.

## TL;DR findings (measured, not asserted)

- **Equivalent through p99.** Under steady load, server-side p50 ≈ 40 ms on both platforms,
  identical through the 99th percentile.
- **Cold-start cost is only in the far tail.** p99.9 ≈ 163 ms / max 290 ms on Web Functions
  vs 97 ms / 105 ms on always-warm Fargate.
- **Comparable throughput with zero capacity planning** (~400 vs ~320 req/s at a small, fixed
  Fargate size).
- **CPU-bound is the weakest case** (active-CPU billing saves nothing when the CPU is never
  idle). **I/O-bound and GenAI fan-out are the strongest fit** (long waits are nearly free,
  native streaming).

Full write-up with charts: [`transform/one-pager-lambda-web-functions.md`](transform/one-pager-lambda-web-functions.md)
(figures in [`transform/one-pager-assets/`](transform/one-pager-assets/)).

## Repository layout

```
transform/
  app/                 Shared Node.js service (same code on both platforms)
    index.js           Express app: documents API, /api/cpu, Bedrock summarize (SSE)
    bedrock.js         Map-reduce long-document summarization via Amazon Bedrock
    otel.js            OpenTelemetry -> Dynatrace OTLP (traces + metrics), tagged by platform
    public/index.html  Demo UI (browse books, summarize, generate load)
    documents/         Public-domain books (Project Gutenberg)
    Dockerfile         For the Fargate image
  dashboard/
    doc-intel-compare.yaml   Dynatrace comparison dashboard (dtctl apply)
  one-pager-lambda-web-functions.md   The study
  one-pager-assets/    Generated charts (make_charts.py)
app/                   Earlier/simpler first POC (single Web Function + dashboard)
```

## How it is instrumented

Lambda Web Functions run a plain port-listening Node HTTP server, a different model from the
classic event-handler Lambda, so the Dynatrace Lambda extension does not apply. Instead the
app uses the **OpenTelemetry SDK in-process**, exporting OTLP to the Dynatrace tenant. Every
span and metric carries a `deployment.platform` attribute (`lambda-web` or `fargate`) so both
platforms render on one dashboard, split by platform.

## Run locally

```bash
cd transform/app
npm install
AWS_REGION=us-east-1 DEPLOY_PLATFORM=local PORT=8080 node index.js
# open http://localhost:8080
```

Telemetry is sent only if `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`
(an `Authorization=Api-Token ...` header for your own Dynatrace tenant) are set. Bedrock
summarization requires AWS credentials with `bedrock:InvokeModel*`.

## Deploy

**Web Function** (AWS CLI >= 2.37.9):
```bash
cd transform/app
aws lambda-web deploy --name doc-intel-api --code . --region us-east-1 \
  --env DEPLOY_PLATFORM=lambda-web --env BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
  --env OTEL_EXPORTER_OTLP_ENDPOINT=https://<env>.live.dynatrace.com/api/v2/otlp \
  --env OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
  --env OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta \
  --env "OTEL_EXPORTER_OTLP_HEADERS=Authorization=Api-Token <token>"
```

**Fargate**: build `transform/app/Dockerfile` for `linux/amd64`, push to ECR, run on ECS
Fargate behind an ALB with the same `--env` values plus `DEPLOY_PLATFORM=fargate`. The
execution/task role needs `bedrock:InvokeModel*`.

**Dashboard**: `dtctl apply -f transform/dashboard/doc-intel-compare.yaml`.

## Notes

- Node.js 24 / Arm64 / five regions at launch. JVM/.NET/Python services cannot migrate yet.
- Endpoints are public by default; front with CloudFront + OAC or require IAM auth for real
  use, and keep secrets in AWS Secrets Manager rather than environment variables.
- No credentials are committed. Supply your own Dynatrace token and AWS credentials.
