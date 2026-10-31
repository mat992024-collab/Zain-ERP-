Dim WshShell, appDir
Set WshShell = CreateObject("WScript.Shell")
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = appDir
WshShell.Run """" & appDir & "\node.exe"" """ & appDir & "\src\launcher.js""", 0, False
