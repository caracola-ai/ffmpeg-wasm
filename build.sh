#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 prepare.py
docker buildx build --platform linux/amd64 --target artifacts --output "type=local,dest=${1:-dist}" .
