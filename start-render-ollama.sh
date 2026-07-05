#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-10000}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b-instruct}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/root/.ollama/models}"

echo "Starting Ollama on ${OLLAMA_HOST}..."
ollama serve &
OLLAMA_PID=$!

cleanup() {
    kill "$OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for Ollama API at ${OLLAMA_BASE_URL}..."
for i in $(seq 1 60); do
    if curl -fsS "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1; then
        break
    fi
    if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
        echo "Ollama exited before becoming ready."
        exit 1
    fi
    sleep 1
done

if ! curl -fsS "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1; then
    echo "Ollama did not become ready in time."
    exit 1
fi

echo "Ensuring Ollama model is installed: ${OLLAMA_MODEL}"
ollama pull "${OLLAMA_MODEL}"

echo "Installed Ollama models:"
ollama list || true

echo "Starting Node server on port ${PORT}..."
exec node server.js
