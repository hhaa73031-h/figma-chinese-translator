"""
Figma 检测模块：自动探测安装路径、版本号、运行状态及汉化状态
"""
import os
import re
import subprocess
from pathlib import Path
from typing import Optional, Tuple


def get_default_figma_dir() -> Optional[Path]:
    """
    自动检测 Windows 下 Figma 默认安装目录，查找最新 app-x.x.x 目录
    """
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        return None

    figma_root = Path(local_app_data) / "Figma"
    if not figma_root.exists():
        return None

    # 寻找所有的 app-x.x.x 目录，按版本号排序
    app_dirs = []
    for item in figma_root.iterdir():
        if item.is_dir() and item.name.startswith("app-"):
            # 检查里面是否有 resources/app.asar
            asar_path = item / "resources" / "app.asar"
            if asar_path.exists() or (item / "resources" / "app.asar.bak").exists():
                app_dirs.append(item)

    if not app_dirs:
        return None

    # 按版本号自然排序（例如 app-126.9.10 按照纯数字列表排序）
    def parse_version(d: Path):
        m = re.findall(r"\d+", d.name)
        return [int(x) for x in m] if m else [0]

    app_dirs.sort(key=parse_version, reverse=True)
    return app_dirs[0]


def is_figma_running() -> bool:
    """
    检测 Figma.exe 进程是否正在运行
    """
    try:
        # 使用 tasklist 查找 Figma.exe
        output = subprocess.check_output(
            ["tasklist", "/FI", "IMAGENAME eq Figma.exe", "/FO", "CSV", "/NH"],
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            text=True,
            errors="ignore",
        )
        return "Figma.exe" in output
    except Exception:
        return False


def kill_figma() -> bool:
    """
    终止正在运行的 Figma.exe 进程
    """
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", "Figma.exe"],
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return True
    except Exception:
        return False


def check_figma_status(figma_app_dir: Path) -> Tuple[str, str, Optional[Path]]:
    """
    检测指定 Figma app 目录的状态：
    返回: (版本号, 汉化状态描述, app.asar路径)
    汉化状态描述:
      - 'INSTALLED_ORIGINAL': 原版英文 (就绪可汉化)
      - 'INSTALLED_PATCHED': 实时汉化生效中
      - 'INVALID_PATH': 无效路径
    """
    if not figma_app_dir or not figma_app_dir.exists():
        return ("未知", "INVALID_PATH", None)

    version_name = figma_app_dir.name.replace("app-", "v")
    resources_dir = figma_app_dir / "resources"
    asar_path = resources_dir / "app.asar"
    bak_path = resources_dir / "app.asar.bak"

    if not asar_path.exists() and not bak_path.exists():
        return (version_name, "INVALID_PATH", None)

    # 检查 asar_path 是否已经注入了汉化标记
    if asar_path.exists():
        try:
            # 快速检查 asar 中是否包含汉化标记特征
            with open(asar_path, "rb") as f:
                header_data = f.read(65536)  # 只读取头部元数据区域
                if b"realtime_translator.js" in header_data or b"figma_chinese_hook.js" in header_data:
                    return (version_name, "INSTALLED_PATCHED", asar_path)
        except Exception:
            pass

    return (version_name, "INSTALLED_ORIGINAL", asar_path)
