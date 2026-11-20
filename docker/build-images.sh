#!/usr/bin/env bash
# Build the language images ONCE. Never build per-submission — image builds
# take seconds, and doing it per request would dominate execution latency.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t cee-python:latest -f python.Dockerfile .
docker build -t cee-node:latest   -f node.Dockerfile   .
docker build -t cee-cpp:latest    -f cpp.Dockerfile    .
echo "✅ Built: cee-python, cee-node, cee-cpp"
