"""One-click launcher for the local 书中人 development server.

Double-click this file in Explorer, or run `python start.py` from a terminal.
The script starts `npm run dev`, waits until http://127.0.0.1:3000 answers its
status endpoint, then opens the browser. Press Ctrl+C to stop the server.
"""

from __future__ import annotations

import http.client
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 3000
BASE_URL = f"http://{HOST}:{PORT}"
STATUS_PATH = "/api/story/status"
READY_TIMEOUT_SECONDS = 180
PROBE_TIMEOUT_SECONDS = 3


def status_is_up() -> bool:
    """Return True when the local app answers its status endpoint."""
    connection = http.client.HTTPConnection(HOST, PORT, timeout=PROBE_TIMEOUT_SECONDS)
    try:
        connection.request("GET", STATUS_PATH)
        response = connection.getresponse()
        response.read()
        return response.status == 200
    except OSError:
        return False
    finally:
        connection.close()


def port_is_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1)
        return probe.connect_ex((HOST, PORT)) == 0


def pause_before_close(message: str) -> None:
    """Keep the console window open so a double-click user can read the error."""
    print(message, flush=True)
    try:
        input("按回车键关闭窗口...")
    except EOFError:
        pass


def ensure_dependencies(npm: str) -> bool:
    if (PROJECT_ROOT / "node_modules").is_dir():
        return True
    print("未找到 node_modules，正在执行 npm ci 安装依赖（首次可能需要几分钟）...", flush=True)
    return subprocess.run([npm, "ci"], cwd=PROJECT_ROOT).returncode == 0


def wait_until_ready(process: subprocess.Popen[bytes]) -> bool:
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    print("等待服务就绪（首次编译较慢）", end="", flush=True)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        if status_is_up():
            print(" 完成", flush=True)
            return True
        print(".", end="", flush=True)
        time.sleep(2)
    print("", flush=True)
    return False


def stop_process_tree(process: subprocess.Popen[bytes]) -> None:
    """Kill npm together with the node process it spawned."""
    if process.poll() is not None:
        return
    subprocess.run(
        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
        capture_output=True,
        check=False,
    )


def main() -> int:
    print("书中人 - 本地开发服务启动器", flush=True)
    print(f"项目目录：{PROJECT_ROOT}", flush=True)

    if port_is_open():
        if status_is_up():
            print("服务已在运行，直接打开浏览器。", flush=True)
            webbrowser.open(BASE_URL + "/?fresh=1" if "--fresh" in sys.argv[1:] else BASE_URL)
            return 0
        pause_before_close(f"端口 {PORT} 已被其他程序占用，请先关闭该程序。")
        return 1

    npm = shutil.which("npm")
    if npm is None:
        pause_before_close("未找到 npm，请先安装 Node.js 并确保 npm 在 PATH 中。")
        return 1
    if not ensure_dependencies(npm):
        pause_before_close("依赖安装失败，请检查网络后重试（命令：npm ci）。")
        return 1

    print("正在启动 npm run dev ...", flush=True)
    process = subprocess.Popen([npm, "run", "dev"], cwd=PROJECT_ROOT)
    try:
        if not wait_until_ready(process):
            if process.poll() is None:
                stop_process_tree(process)
                pause_before_close(f"等待 {READY_TIMEOUT_SECONDS} 秒后服务仍未就绪，已停止该进程。")
            else:
                pause_before_close(f"服务启动失败，退出码 {process.returncode}。")
            return 1
        print(f"服务已就绪：{BASE_URL}", flush=True)
        webbrowser.open(BASE_URL + "/?fresh=1" if "--fresh" in sys.argv[1:] else BASE_URL)
        print("按 Ctrl+C 或关闭本窗口即可停止服务。", flush=True)
        process.wait()
    except KeyboardInterrupt:
        print("\n正在停止本地服务...", flush=True)
        stop_process_tree(process)
    return 0


if __name__ == "__main__":
    sys.exit(main())
