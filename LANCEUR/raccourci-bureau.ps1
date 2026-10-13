# Storymatic - l'icone du Bureau (Windows) : cree « Storymatic » sur le Bureau, avec son icone.

$ErrorActionPreference = "Stop"
$Vbs    = Join-Path $PSScriptRoot "Storymatic.vbs"
$Icone  = Join-Path $PSScriptRoot "storymatic.ico"
$bureau = [Environment]::GetFolderPath('Desktop')
if (-not $bureau) { $bureau = Join-Path $env:USERPROFILE "Desktop" }

$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut((Join-Path $bureau "Storymatic.lnk"))
$l.TargetPath = "$env:WINDIR\System32\wscript.exe"
$l.Arguments = "`"$Vbs`""
$l.WorkingDirectory = $PSScriptRoot
$l.IconLocation = "$Icone,0"
$l.Description = "Storymatic - mes stories de la semaine"
$l.Save()
Write-Output "BUREAU=$bureau"
