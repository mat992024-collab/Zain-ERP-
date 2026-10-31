Dim WshShell, fso, appDir, nodeExe
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = appDir

nodeExe = appDir & "\node.exe"
If Not fso.FileExists(nodeExe) Then
  nodeExe = appDir & "\installer\node.exe"
  If Not fso.FileExists(nodeExe) Then
    nodeExe = "node"
  End If
End If

WshShell.Run """" & nodeExe & """ """ & appDir & "\src\launcher.js""", 0, False
