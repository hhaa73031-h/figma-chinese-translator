"""
Figma 一键实时汉化程序入口
"""
import sys
from pathlib import Path

# 将根目录添加到模块搜索路径
root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from ui.app import main

if __name__ == "__main__":
    main()
