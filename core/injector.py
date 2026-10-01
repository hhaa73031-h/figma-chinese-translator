"""
核心注入与还原模块：负责 app.asar 备份、实时汉化注入、打包以及无损还原官方英文
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Callable, Optional

from core.asar_handler import extract_asar, pack_asar
from core.figma_detector import is_figma_running, kill_figma


def apply_localization(
    figma_app_dir: Path,
    auto_close_figma: bool = False,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> bool:
    """
    执行一键实时汉化：
    1. 进程占用检测
    2. 创建 app.asar.bak 原始完整备份
    3. 解包 app.asar（自动保存原生 unpacked 模块元数据）
    4. 注入 hook、动态汉化脚本与词典
    5. 修改 main.js 挂载点
    6. 重新打包并原子替换
    """
    def log(msg: str, progress: float):
        if progress_callback:
            progress_callback(msg, progress)

    # 1. 检查目录
    resources_dir = figma_app_dir / "resources"
    asar_path = resources_dir / "app.asar"
    bak_path = resources_dir / "app.asar.bak"

    if not asar_path.exists() and not bak_path.exists():
        raise FileNotFoundError(f"未找到 Figma 核心资源文件: {asar_path}")

    # 2. 检查 Figma 进程
    if is_figma_running():
        if auto_close_figma:
            log("检测到 Figma 正在运行，正在关闭进程...", 0.1)
            kill_figma()
        else:
            raise PermissionError("Figma.exe 正在运行中，请先关闭 Figma 后再执行汉化。")

    # 3. 备份原版 app.asar
    if asar_path.exists() and not bak_path.exists():
        log("正在为官方原版创建安全备份 (app.asar.bak)...", 0.2)
        shutil.copy2(asar_path, bak_path)

    # 如果当前 asar 不存在（但 bak 存在），从 bak 复制
    source_asar = asar_path if asar_path.exists() else bak_path

    # 4. 解包 asar 到临时工作区
    log("正在解析 Figma 核心资源包 (保留原生二进制依赖)...", 0.3)
    temp_extract_dir = Path(tempfile.mkdtemp(prefix="figma_cn_extract_"))

    try:
        extract_asar(source_asar, temp_extract_dir)
        log("资源解包完成，正在装配实时汉化引擎...", 0.5)

        # 5. 复制汉化组件
        if getattr(sys, "frozen", False):
            base_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        else:
            base_dir = Path(__file__).resolve().parent.parent
        translator_dir = base_dir / "translator"
        if not translator_dir.exists():
            translator_dir = Path(sys.executable).parent / "translator"

        inject_files = [
            "figma_chinese_hook.js",
            "realtime_translator.js",
            "translations.json",
            "menu_dict.json",
            "zh-CN.json",
            "dynamic_learned.json",
        ]

        for fname in inject_files:
            src_f = translator_dir / fname
            if src_f.exists():
                shutil.copy2(src_f, temp_extract_dir / fname)

        # 6. 修改 main.js 注入主进程挂钩 (原生菜单栏、自毁定时器拦截、窗口守护)
        main_js_path = temp_extract_dir / "main.js"
        if main_js_path.exists():
            main_code = main_js_path.read_text(encoding="utf-8", errors="ignore")
            hook_stmt = "require('./figma_chinese_hook.js');\n"
            if "figma_chinese_hook.js" not in main_code:
                main_js_path.write_text(hook_stmt + main_code, encoding="utf-8")

        # 6.1 在预加载渲染脚本中直接挂载实时汉化引擎 (保证画图编辑界面与工作区秒开即汉化)
        trans_data_file = translator_dir / "translations.json"
        realtime_file = translator_dir / "realtime_translator.js"
        if trans_data_file.exists() and realtime_file.exists():
            engine_embed = f"\n;var __FIGMA_BUILTIN_TRANSLATIONS__ = {trans_data_file.read_text(encoding='utf-8')};\n{realtime_file.read_text(encoding='utf-8')}\n"
            
            # 注入网页绑定预加载脚本 (主页、画图编辑器画布、所有设计文件)
            web_renderer_path = temp_extract_dir / "web_app_binding_renderer.js"
            if web_renderer_path.exists():
                web_code = web_renderer_path.read_text(encoding="utf-8", errors="ignore")
                if "__FIGMA_REALTIME_TRANSLATOR_ACTIVE__" not in web_code:
                    web_renderer_path.write_text(web_code + engine_embed, encoding="utf-8")

            # 注入外壳绑定预加载脚本 (桌面标签栏与外壳)
            shell_renderer_path = temp_extract_dir / "shell_app_binding_renderer.js"
            if shell_renderer_path.exists():
                shell_code = shell_renderer_path.read_text(encoding="utf-8", errors="ignore")
                if "__FIGMA_REALTIME_TRANSLATOR_ACTIVE__" not in shell_code:
                    shell_renderer_path.write_text(shell_code + engine_embed, encoding="utf-8")

        # 7. 打包为新的 asar (内置回填 unpacked 节点)
        log("正在封装并生成新的实时汉化核心...", 0.75)
        temp_out_asar = temp_extract_dir.parent / "app_patched.asar"
        pack_asar(temp_extract_dir, temp_out_asar)

        # 8. 原子替换
        log("正在应用汉化核心...", 0.9)
        if asar_path.exists():
            asar_path.unlink()
        shutil.move(str(temp_out_asar), str(asar_path))

        log("汉化注入成功！启动 Figma 即可体验实时汉化。", 1.0)
        return True

    finally:
        if temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir, ignore_errors=True)


def restore_original(
    figma_app_dir: Path,
    auto_close_figma: bool = False,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> bool:
    """
    一键还原为官方原版英文
    """
    def log(msg: str, progress: float):
        if progress_callback:
            progress_callback(msg, progress)

    resources_dir = figma_app_dir / "resources"
    asar_path = resources_dir / "app.asar"
    bak_path = resources_dir / "app.asar.bak"

    if not bak_path.exists():
        if asar_path.exists():
            log("未检测到备份文件，当前已是原生文件或备份不存在。", 1.0)
            return True
        raise FileNotFoundError("未找到原版备份文件 (app.asar.bak)，无法执行还原。")

    if is_figma_running():
        if auto_close_figma:
            log("检测到 Figma 正在运行，正在关闭进程...", 0.2)
            kill_figma()
        else:
            raise PermissionError("Figma.exe 正在运行中，请先关闭 Figma 后再执行还原。")

    log("正在从官方备份还原原始文件...", 0.5)
    if asar_path.exists():
        asar_path.unlink()

    shutil.copy2(bak_path, asar_path)
    log("已成功还原为官方英文原版！", 1.0)
    return True
