# Build for linux/amd64 (Fargate x86_64). Build on Apple Silicon with:
#   docker build --platform linux/amd64 -t doc-intel-api .
FROM public.ecr.aws/docker/library/node:24-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
