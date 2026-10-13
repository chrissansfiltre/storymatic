' Storymatic - lancement sans fenetre noire (Windows).
' Lance lancer-studio.ps1, dans le meme dossier, en cachant la console. Le raccourci du Bureau pointe ici.
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dossier & "\lancer-studio.ps1""", 0, False
