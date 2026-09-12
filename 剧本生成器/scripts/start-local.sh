#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

if [[ ! -x backend/.venv/bin/python || ! -d frontend/node_modules ]]; then
  echo "开发依赖尚未准备好，请按 README 的安装步骤操作。"
  exit 1
fi
for port in 3001 8001; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $port 已被占用。请先关闭此前的本项目服务，不会自动终止其他进程。"
    exit 1
  fi
done

(cd backend && .venv/bin/alembic upgrade head)
if [[ ! -f frontend/.next/BUILD_ID ]]; then
  (cd frontend && npm run build)
fi

backend_pid=""
frontend_pid=""
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$frontend_pid" ]] || kill "$frontend_pid" 2>/dev/null || true
  [[ -z "$backend_pid" ]] || kill "$backend_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd backend && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --no-access-log) &
backend_pid=$!
(cd frontend && exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001) &
frontend_pid=$!
echo "打开 http://127.0.0.1:3001 开始体验。Ctrl+C 关闭本次启动的两个服务。"
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done
