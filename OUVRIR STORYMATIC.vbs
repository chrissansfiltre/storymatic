' STORYMATIC - Windows : double-cliquez ici, la premiere fois comme les autres.
' La premiere fois, Storymatic s'ouvre sur sa page « Installation » : il installe lui-meme
' ses outils, vous connectez votre compte Claude, et il pose son icone sur le Bureau.
' Ensuite, l'icone du Bureau suffit. (Ce fichier lance LANCEUR\lancer-studio.ps1, sans fenetre noire.)
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dossier & "\LANCEUR\lancer-studio.ps1""", 0, False
