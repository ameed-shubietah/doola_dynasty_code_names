FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl \
    && curl -fsSL https://ollama.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; elif [ -f package.json ]; then npm install --omit=dev; fi \
    && chmod +x /app/start-render-ollama.sh

ENV NODE_ENV=production
ENV AI_CLUES_ENABLED=true
ENV AI_CLUE_PROVIDER=ollama
ENV AI_CLUE_DEBUG=1
ENV OLLAMA_HOST=127.0.0.1:11434
ENV OLLAMA_BASE_URL=http://127.0.0.1:11434
ENV OLLAMA_MODEL=qwen2.5:3b-instruct
ENV OLLAMA_MODELS=/root/.ollama/models
ENV AI_CLUE_TIMEOUT_MS=12000
ENV AI_CLUE_CANDIDATES=18

EXPOSE 10000

CMD ["bash", "/app/start-render-ollama.sh"]
