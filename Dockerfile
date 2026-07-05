FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; elif [ -f package.json ]; then npm install --omit=dev; fi \
    && chmod +x /app/start-render-ollama.sh

ENV NODE_ENV=production
ENV AI_CLUES_ENABLED=true
ENV AI_CLUE_PROVIDER=ollama
ENV AI_CLUE_DEBUG=1
ENV OLLAMA_BASE_URL=https://replace-this-with-your-pc-ollama-tunnel
ENV OLLAMA_MODEL=qwen2.5:1.5b-instruct
ENV AI_CLUE_TIMEOUT_MS=60000
ENV AI_STATUS_TIMEOUT_MS=5000
ENV AI_CLUE_CANDIDATES=18

EXPOSE 10000

CMD ["bash", "/app/start-render-ollama.sh"]
