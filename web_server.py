"""
Figma 实时动态汉化本地 Web 管理器
提供本地网页界面及 RESTful 控制接口
访问地址: http://localhost:8765
"""
import http.server
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Dict, Any, List

# 保证在无控制台 / GUI 打包模式下不会因 stdout/stderr 为 None 抛出异常
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

# 导入核心功能模块
from core.figma_detector import (
    get_default_figma_dir,
    is_figma_running,
    kill_figma,
    check_figma_status,
)
from core.injector import apply_localization, restore_original

# 根目录与前端目录
if getattr(sys, "frozen", False):
    BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
else:
    BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
CUSTOM_FIGMA_DIR: Path = None


def get_current_figma_dir() -> Path:
    global CUSTOM_FIGMA_DIR
    if CUSTOM_FIGMA_DIR and CUSTOM_FIGMA_DIR.exists():
        return CUSTOM_FIGMA_DIR
    return get_default_figma_dir()


class FigmaWebHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 简化日志输出，保持控制台清爽
        sys.stdout.write(f"[{self.log_date_time_string()}] {self.command} {self.path}\n")

    def send_json(self, data: Dict[str, Any], status_code: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        url_parsed = urllib.parse.urlparse(self.path)
        path = url_parsed.path

        if path in ("/", "/index.html"):
            index_path = WEB_DIR / "index.html"
            if not index_path.exists():
                self.send_error(404, "Index file not found")
                return
            content = index_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        elif path == "/api/status":
            figma_dir = get_current_figma_dir()
            is_running = is_figma_running()

            if not figma_dir:
                self.send_json({
                    "figma_dir": None,
                    "version": "--",
                    "status": "NOT_FOUND",
                    "is_patched": False,
                    "is_running": is_running,
                    "has_backup": False,
                })
                return

            version, status_code, asar_path = check_figma_status(figma_dir)
            bak_path = figma_dir / "resources" / "app.asar.bak"

            self.send_json({
                "figma_dir": str(figma_dir),
                "version": version,
                "status": status_code,
                "is_patched": (status_code == "INSTALLED_PATCHED"),
                "is_running": is_running,
                "has_backup": bak_path.exists(),
            })
            return

        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        url_parsed = urllib.parse.urlparse(self.path)
        path = url_parsed.path

        figma_dir = get_current_figma_dir()

        if path == "/api/localize":
            if not figma_dir:
                self.send_json({"success": False, "error": "未找到 Figma 安装目录"}, 400)
                return

            logs: List[str] = []

            def on_progress(msg: str, progress: float):
                logs.append(f"[{int(progress * 100)}%] {msg}")

            try:
                apply_localization(figma_dir, auto_close_figma=True, progress_callback=on_progress)
                self.send_json({"success": True, "logs": logs})
            except Exception as e:
                self.send_json({"success": False, "error": str(e), "logs": logs}, 500)
            return

        elif path == "/api/restore":
            if not figma_dir:
                self.send_json({"success": False, "error": "未找到 Figma 安装目录"}, 400)
                return

            logs: List[str] = []

            def on_progress(msg: str, progress: float):
                logs.append(f"[{int(progress * 100)}%] {msg}")

            try:
                restore_original(figma_dir, auto_close_figma=True, progress_callback=on_progress)
                self.send_json({"success": True, "logs": logs})
            except Exception as e:
                self.send_json({"success": False, "error": str(e), "logs": logs}, 500)
            return

        elif path == "/api/kill":
            success = kill_figma()
            self.send_json({"success": success})
            return

        elif path == "/api/launch":
            if not figma_dir:
                self.send_json({"success": False, "error": "未找到 Figma 安装目录"}, 400)
                return

            exe_path = figma_dir / "Figma.exe"
            if not exe_path.exists():
                self.send_json({"success": False, "error": f"未找到 Figma.exe: {exe_path}"}, 404)
                return

            try:
                subprocess.Popen([str(exe_path)])
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)}, 500)
            return

        else:
            self.send_error(404, "Not Found")


def run_server(port: int = 8765):
    server_address = ("127.0.0.1", port)
    try:
        httpd = http.server.ThreadingHTTPServer(server_address, FigmaWebHandler)
    except OSError:
        # 端口若被占用，使用后备端口
        port = 8766
        server_address = ("127.0.0.1", port)
        httpd = http.server.ThreadingHTTPServer(server_address, FigmaWebHandler)

    url = f"http://127.0.0.1:{port}"
    print("=" * 60)
    print("  Figma 实时动态汉化管理器 (本地网页版)")
    print(f"  服务已启动: {url}")
    print("  在浏览器中打开上方网址即可控制汉化与还原")
    print("  按 Ctrl + C 可退出服务")
    print("=" * 60)

    # 延迟 0.6 秒自动打开浏览器
    def open_browser():
        time.sleep(0.6)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止本地服务...")
        httpd.server_close()
        print("本地服务已安全停止。")


if __name__ == "__main__":
    run_server()
