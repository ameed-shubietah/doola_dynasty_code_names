#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-10000}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-https://replace-this-with-your-pc-ollama-tunnel}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b-instruct}"

echo "Using remote Ollama at ${OLLAMA_BASE_URL}"
echo "Render will not start or load Ollama locally. Keep the host PC and tunnel online for single-player mode."

echo "Starting Node server on port ${PORT}..."
exec node server.js
