' Claude Agent UI — Windows 零窗口启动
' 双击此文件即可后台启动服务，无任何可见窗口
' 日志: logs/server.log | PID: logs/server.pid

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

WshShell.CurrentDirectory = projectDir
WshShell.Run "node """ & projectDir & "\scripts\start.mjs"" --headless-worker", 0, False
