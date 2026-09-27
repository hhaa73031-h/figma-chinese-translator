"""
Figma 一键实时汉化桌面端主界面 (CustomTkinter)
设计规范：
1. 严禁使用蓝紫色系，采用硬朗高对比的碳黑、暗岩灰、暖金琥珀 (#D97706) 与青翠翡绿 (#10B981)。
2. 严禁使用大圆角图标/气泡感组件，全界面所有组件使用 0~2px 微圆角与直角切面，体现硬核工匠工具质感。
"""
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

from core.figma_detector import (
    get_default_figma_dir,
    is_figma_running,
    kill_figma,
    check_figma_status,
)
from core.injector import apply_localization, restore_original

# 颜色常量 (严格杜绝蓝紫色)
COLOR_BG_DARK = "#121316"         # 主背景：深黑曜石碳色
COLOR_CARD_BG = "#1A1D21"         # 卡片背景：暗岩灰
COLOR_CARD_BORDER = "#2E333B"     # 边框线：深冷灰
COLOR_TEXT_PRIMARY = "#F3F4F6"    # 主标题文字：亮白灰
COLOR_TEXT_MUTED = "#9CA3AF"      # 次要文字：银灰
COLOR_ACCENT_AMBER = "#D97706"    # 主要操作琥珀金
COLOR_ACCENT_AMBER_HOVER = "#B45309"
COLOR_SECONDARY_BTN = "#25282F"   # 次要按钮：石墨暗色
COLOR_SECONDARY_HOVER = "#333742"
COLOR_STATUS_GREEN = "#10B981"    # 翡翠绿状态
COLOR_STATUS_AMBER = "#F59E0B"    # 警告/运行中琥珀色
COLOR_STATUS_RED = "#EF4444"      # 错误警示红
COLOR_TERMINAL_BG = "#0D0E11"     # 终端日志背景
COLOR_TERMINAL_TEXT = "#34D399"   # 终端文字柔和淡绿


class FigmaCNApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        # 基础窗口属性
        self.title("Figma 一键实时汉化 v1.0.0")
        self.geometry("640x630")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        self.configure(fg_color=COLOR_BG_DARK)

        # 当前选中的 Figma 目录
        self.current_figma_dir = get_default_figma_dir()
        self.is_processing = False

        self._build_ui()
        self.refresh_status()

    def _build_ui(self):
        """构建整体 UI 界面"""
        # 1. 顶部 Header 标题栏
        header_frame = ctk.CTkFrame(
            self,
            fg_color="transparent",
            corner_radius=0
        )
        header_frame.pack(fill="x", padx=20, pady=(16, 10))

        title_label = ctk.CTkLabel(
            header_frame,
            text="◈  Figma 一键实时汉化",
            font=ctk.CTkFont(family="Segoe UI", size=18, weight="bold"),
            text_color=COLOR_TEXT_PRIMARY,
        )
        title_label.pack(side="left")

        ver_tag = ctk.CTkLabel(
            header_frame,
            text="PRO / 极速版",
            font=ctk.CTkFont(family="Segoe UI", size=11, weight="bold"),
            text_color=COLOR_ACCENT_AMBER,
            fg_color="#261E14",
            corner_radius=2,
            padx=8,
            pady=2,
        )
        ver_tag.pack(side="left", padx=10)

        refresh_btn = ctk.CTkButton(
            header_frame,
            text="刷新检测",
            width=76,
            height=28,
            font=ctk.CTkFont(family="Segoe UI", size=12),
            fg_color=COLOR_SECONDARY_BTN,
            hover_color=COLOR_SECONDARY_HOVER,
            text_color=COLOR_TEXT_PRIMARY,
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            corner_radius=2,
            command=self.refresh_status,
        )
        refresh_btn.pack(side="right")

        # 2. 状态检测卡片
        status_card = ctk.CTkFrame(
            self,
            fg_color=COLOR_CARD_BG,
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            corner_radius=2,
        )
        status_card.pack(fill="x", padx=20, pady=6)

        # 路径选择行
        path_row = ctk.CTkFrame(status_card, fg_color="transparent", corner_radius=0)
        path_row.pack(fill="x", padx=14, pady=(12, 6))

        path_title = ctk.CTkLabel(
            path_row,
            text="Figma 路径:",
            font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            text_color=COLOR_TEXT_MUTED,
            width=70,
            anchor="w",
        )
        path_title.pack(side="left")

        self.path_entry = ctk.CTkEntry(
            path_row,
            font=ctk.CTkFont(family="Consolas", size=11),
            fg_color="#121316",
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            text_color=COLOR_TEXT_PRIMARY,
            corner_radius=2,
            height=28,
        )
        self.path_entry.pack(side="left", fill="x", expand=True, padx=(4, 8))

        browse_btn = ctk.CTkButton(
            path_row,
            text="浏览...",
            width=68,
            height=28,
            font=ctk.CTkFont(family="Segoe UI", size=12),
            fg_color=COLOR_SECONDARY_BTN,
            hover_color=COLOR_SECONDARY_HOVER,
            text_color=COLOR_TEXT_PRIMARY,
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            corner_radius=2,
            command=self._on_browse_path,
        )
        browse_btn.pack(side="right")

        # 状态指标栅格
        metrics_row = ctk.CTkFrame(status_card, fg_color="transparent", corner_radius=0)
        metrics_row.pack(fill="x", padx=14, pady=(4, 12))

        # 版本号
        self.ver_label = ctk.CTkLabel(
            metrics_row,
            text="版本: 检测中...",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=COLOR_TEXT_PRIMARY,
            anchor="w",
        )
        self.ver_label.pack(side="left", padx=(0, 20))

        # 汉化状态
        self.patch_status_label = ctk.CTkLabel(
            metrics_row,
            text="状态: 检测中...",
            font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            text_color=COLOR_STATUS_GREEN,
            anchor="w",
        )
        self.patch_status_label.pack(side="left", padx=(0, 20))

        # 运行状态
        self.proc_status_label = ctk.CTkLabel(
            metrics_row,
            text="进程: 检测中...",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=COLOR_TEXT_MUTED,
            anchor="w",
        )
        self.proc_status_label.pack(side="left")

        # 3. 核心功能按钮操作区
        action_frame = ctk.CTkFrame(self, fg_color="transparent", corner_radius=0)
        action_frame.pack(fill="x", padx=20, pady=8)

        # 按钮 1：一键开启实时汉化 (高亮主要操作)
        self.btn_localize = ctk.CTkButton(
            action_frame,
            text="⚡  一键开启实时汉化",
            height=46,
            font=ctk.CTkFont(family="Segoe UI", size=15, weight="bold"),
            fg_color=COLOR_ACCENT_AMBER,
            hover_color=COLOR_ACCENT_AMBER_HOVER,
            text_color="#FFFFFF",
            corner_radius=2,
            command=self._start_localize_task,
        )
        self.btn_localize.pack(fill="x", pady=(0, 8))

        # 按钮 2：一键还原官方英文 (次要稳定操作)
        self.btn_restore = ctk.CTkButton(
            action_frame,
            text="⟲  一键还原官方英文",
            height=42,
            font=ctk.CTkFont(family="Segoe UI", size=14),
            fg_color=COLOR_SECONDARY_BTN,
            hover_color=COLOR_SECONDARY_HOVER,
            text_color=COLOR_TEXT_PRIMARY,
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            corner_radius=2,
            command=self._start_restore_task,
        )
        self.btn_restore.pack(fill="x", pady=(0, 4))

        # 4. 选项行
        options_row = ctk.CTkFrame(self, fg_color="transparent", corner_radius=0)
        options_row.pack(fill="x", padx=22, pady=(2, 6))

        self.auto_kill_var = ctk.BooleanVar(value=True)
        chk_kill = ctk.CTkCheckBox(
            options_row,
            text="检测到 Figma 运行中时自动协助关闭 (避免文件被占用)",
            variable=self.auto_kill_var,
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=COLOR_TEXT_MUTED,
            fg_color=COLOR_ACCENT_AMBER,
            hover_color=COLOR_ACCENT_AMBER_HOVER,
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            corner_radius=2,
            checkmark_color="#FFFFFF",
        )
        chk_kill.pack(side="left")

        # 5. 实时操作日志终端区域
        log_header = ctk.CTkLabel(
            self,
            text="执行日志:",
            font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            text_color=COLOR_TEXT_MUTED,
            anchor="w",
        )
        log_header.pack(fill="x", padx=22, pady=(4, 2))

        self.log_textbox = ctk.CTkTextbox(
            self,
            height=180,
            font=ctk.CTkFont(family="Consolas", size=11),
            fg_color=COLOR_TERMINAL_BG,
            border_color=COLOR_CARD_BORDER,
            border_width=1,
            text_color=COLOR_TERMINAL_TEXT,
            corner_radius=2,
            wrap="word",
        )
        self.log_textbox.pack(fill="both", expand=True, padx=20, pady=(0, 16))

        # 底部快捷提示
        self.log_message("系统初始化就绪。随时可执行【一键开启实时汉化】或【一键还原官方英文】。")

    def log_message(self, msg: str):
        """向日志终端追加时间戳信息"""
        now_str = datetime.now().strftime("%H:%M:%S")
        self.log_textbox.configure(state="normal")
        self.log_textbox.insert("end", f"[{now_str}] > {msg}\n")
        self.log_textbox.see("end")
        self.log_textbox.configure(state="disabled")

    def _on_browse_path(self):
        """手动选择 Figma 目录"""
        selected = filedialog.askdirectory(title="选择 Figma 安装目录 (例如 app-126.x.x)")
        if selected:
            p = Path(selected)
            self.current_figma_dir = p
            self.refresh_status()

    def refresh_status(self):
        """刷新并检测 Figma 状态"""
        if not self.current_figma_dir:
            self.current_figma_dir = get_default_figma_dir()

        # 更新路径显示
        self.path_entry.delete(0, "end")
        if self.current_figma_dir:
            self.path_entry.insert(0, str(self.current_figma_dir))
        else:
            self.path_entry.insert(0, "未检测到 Figma 默认目录，请点击右侧【浏览...】指定")

        # 检测版本与汉化状态
        if self.current_figma_dir and self.current_figma_dir.exists():
            ver, status, asar_p = check_figma_status(self.current_figma_dir)
            self.ver_label.configure(text=f"版本: {ver}")

            if status == "INSTALLED_PATCHED":
                self.patch_status_label.configure(
                    text="状态: ● 实时汉化生效中", text_color=COLOR_STATUS_GREEN
                )
            elif status == "INSTALLED_ORIGINAL":
                self.patch_status_label.configure(
                    text="状态: ○ 官方原版 (就绪)", text_color=COLOR_TEXT_PRIMARY
                )
            else:
                self.patch_status_label.configure(
                    text="状态: ✕ 资源包不完整", text_color=COLOR_STATUS_RED
                )
        else:
            self.ver_label.configure(text="版本: 未知")
            self.patch_status_label.configure(
                text="状态: ✕ 未找到目录", text_color=COLOR_STATUS_RED
            )

        # 检测进程
        running = is_figma_running()
        if running:
            self.proc_status_label.configure(
                text="进程: 🟠 Figma 运行中", text_color=COLOR_STATUS_AMBER
            )
        else:
            self.proc_status_label.configure(
                text="进程: 🟢 未运行 (安全)", text_color=COLOR_STATUS_GREEN
            )

    def _set_buttons_state(self, enabled: bool):
        """操作进行中锁定按钮，防并发"""
        state = "normal" if enabled else "disabled"
        self.btn_localize.configure(state=state)
        self.btn_restore.configure(state=state)

    def _start_localize_task(self):
        """开启汉化线程"""
        if self.is_processing:
            return

        if not self.current_figma_dir or not self.current_figma_dir.exists():
            messagebox.showerror("错误", "请先选择有效的 Figma 安装目录！")
            return

        def task():
            self.is_processing = True
            self._set_buttons_state(False)
            self.log_message("=== 开始执行【一键实时汉化】===")

            auto_kill = self.auto_kill_var.get()
            try:
                apply_localization(
                    self.current_figma_dir,
                    auto_close_figma=auto_kill,
                    progress_callback=lambda msg, p: self.log_message(msg),
                )
                self.log_message("=== 汉化成功完成！===")
                self.after(0, self.refresh_status)
                messagebox.showinfo("完成", "Figma 实时汉化已成功安装！\n现在启动 Figma 即可体验实时汉化。")
            except Exception as e:
                self.log_message(f"汉化遇到错误: {str(e)}")
                messagebox.showerror("操作失败", f"汉化失败:\n{str(e)}")
            finally:
                self.is_processing = False
                self.after(0, lambda: self._set_buttons_state(True))
                self.after(0, self.refresh_status)

        threading.Thread(target=task, daemon=True).start()

    def _start_restore_task(self):
        """开启还原线程"""
        if self.is_processing:
            return

        if not self.current_figma_dir or not self.current_figma_dir.exists():
            messagebox.showerror("错误", "请先选择有效的 Figma 安装目录！")
            return

        def task():
            self.is_processing = True
            self._set_buttons_state(False)
            self.log_message("=== 开始执行【一键还原官方英文】===")

            auto_kill = self.auto_kill_var.get()
            try:
                restore_original(
                    self.current_figma_dir,
                    auto_close_figma=auto_kill,
                    progress_callback=lambda msg, p: self.log_message(msg),
                )
                self.log_message("=== 已成功还原为官方英文原版！===")
                self.after(0, self.refresh_status)
                messagebox.showinfo("完成", "已恢复为官方原生英文 Figma！")
            except Exception as e:
                self.log_message(f"还原遇到错误: {str(e)}")
                messagebox.showerror("还原失败", f"还原失败:\n{str(e)}")
            finally:
                self.is_processing = False
                self.after(0, lambda: self._set_buttons_state(True))
                self.after(0, self.refresh_status)

        threading.Thread(target=task, daemon=True).start()


def main():
    app = FigmaCNApp()
    app.mainloop()


if __name__ == "__main__":
    main()
