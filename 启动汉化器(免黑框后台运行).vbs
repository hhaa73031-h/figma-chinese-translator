Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = "D:\Antigravity文件\Figma一键汉化"
ws.Run {py_exe} & " web_server.py", 0, False
