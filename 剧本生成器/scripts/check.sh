#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root/backend"
.venv/bin/ruff check app tests alembic
.venv/bin/pytest -q
cd "$project_root/frontend"
npm run lint
npm run typecheck
npm run build
