# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['D:/Antigravity文件/Figma一键汉化/web_server.py'],
    pathex=[],
    binaries=[],
    datas=[('D:/Antigravity文件/Figma一键汉化/web', 'web'), ('D:/Antigravity文件/Figma一键汉化/translator', 'translator')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Figma汉化管理器',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
