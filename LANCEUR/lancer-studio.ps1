# Storymatic - le lanceur (Windows).
#
# Demarre le moteur (serveur.js, port 4351) en fenetre cachee s'il ne tourne pas deja, ouvre Storymatic dans sa
# propre fenetre (Chrome, sinon Edge, avec un profil a lui : LANCEUR\profil-navigateur), et arrete le moteur quand
# cette fenetre se ferme. Lance par Storymatic.vbs (le raccourci du Bureau), sans console.

$Racine = Split-Path -Parent $PSScriptRoot
$Port   = 4351
$Url    = "http://127.0.0.1:$Port"
$ProfilNavigateur = Join-Path $PSScriptRoot "profil-navigateur"

function Message($texte) {
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($texte, "Storymatic", "OK", "Warning") | Out-Null
  } catch { }
}
# Le moteur ecoute-t-il deja ? On le demande a Windows (quelques millisecondes) plutot que par une requete.
function MoteurEcoute {
  try {
    [bool]([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
           Where-Object { $_.Port -eq $Port })
  } catch { $false }
}

# 0. La premiere fois : Windows marque tout fichier venu d'Internet (le zip), et demanderait une confirmation a chaque
#    lancement de node.exe. On leve cette marque sur ce qui se lance (la racine, LANCEUR, MOTEUR), une seule fois.
$Moteur = Join-Path $Racine "MOTEUR"
$marque = Join-Path $Moteur ".debloque"
if (-not (Test-Path $marque)) {
  try {
    Get-ChildItem -LiteralPath $Racine -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    foreach ($d in @("LANCEUR", "MOTEUR", "OUTILS")) {
      $p = Join-Path $Racine $d
      if (Test-Path $p) { Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue }
    }
    New-Item -ItemType Directory -Force $Moteur | Out-Null
    Set-Content -LiteralPath $marque -Value (Get-Date -Format s)
  } catch { }
}

# Node.js : celui qui est livre avec Storymatic (MOTEUR\node), sinon celui de l'ordinateur.
$Node = Join-Path $Moteur "node\node.exe"
if (-not (Test-Path $Node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  $Node = if ($cmd) { $cmd.Source } else { $null }
}

# 1. Le moteur, sauf s'il tourne deja.
$moteur = $null
if (-not (MoteurEcoute)) {
  if (-not $Node) { Message "Le moteur de Storymatic est introuvable (dossier MOTEUR incomplet). Telechargez a nouveau Storymatic et decompressez-le en entier."; exit 1 }
  if (-not (Test-Path (Join-Path $Racine "serveur.js"))) { Message "Le dossier de Storymatic est incomplet (serveur.js introuvable)."; exit 1 }
  $moteur = Start-Process $Node -ArgumentList 'serveur.js' -WorkingDirectory $Racine -WindowStyle Hidden -PassThru
  # Au plus 20 secondes ; on s'arrete tout de suite si le moteur est tombe.
  $i = 0
  while (-not (MoteurEcoute) -and -not $moteur.HasExited -and $i -lt 200) { Start-Sleep -Milliseconds 100; $i++ }
  if (-not (MoteurEcoute)) {
    if ($moteur -and -not $moteur.HasExited) { Stop-Process -Id $moteur.Id -Force }
    Message "Le moteur de Storymatic n'a pas demarre. Dans un terminal, dans le dossier de Storymatic : node serveur.js, pour voir l'erreur."
    exit 1
  }
}

# 2. Le navigateur : Chrome, sinon Edge (toujours present sur Windows 11).
$navigateur = $null
foreach ($p in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                 "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                 "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
                 "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                 "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
                 (Join-Path $Racine "MOTEUR\navigateur\chrome-win64\chrome.exe"))) {
  if (Test-Path $p) { $navigateur = $p; break }
}
if (-not $navigateur) { Start-Process $Url; exit }

# 3. La fenetre de Storymatic.
$chrono = [Diagnostics.Stopwatch]::StartNew()
$fenetre = Start-Process $navigateur -ArgumentList "--app=$Url --window-size=1440,920 --user-data-dir=`"$ProfilNavigateur`" --no-first-run --no-default-browser-check" -PassThru

# L'icone de la barre des taches. Le navigateur n'y met que le favicon (16 ou 32 px), agrandi et flou sur un ecran
# a 175 % : on pose sur la fenetre l'icone du logo en haute definition (storymatic.ico), et on la remet si le
# navigateur la remplace (a chaque changement de page). Tant que la fenetre est ouverte.
$Ico = Join-Path $PSScriptRoot "storymatic.ico"
try {
  Add-Type -ErrorAction Stop -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class IconeFenetre {
  delegate bool Rappel(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Rappel f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr i, string f, uint t, int cx, int cy, uint fl);
  static IntPtr grande, petite;
  public static void Charger(string ico) { grande = LoadImage(IntPtr.Zero, ico, 1, 256, 256, 0x10); petite = LoadImage(IntPtr.Zero, ico, 1, 32, 32, 0x10); }
  // Pose l'icone sur chaque fenetre visible dont le titre commence par "Storymatic" ; rend le nombre de fenetres.
  public static int Poser() {
    int n = 0;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var s = new StringBuilder(256); GetWindowText(h, s, 256);
      if (!s.ToString().StartsWith("Storymatic")) return true;
      n++;
      if (SendMessage(h, 0x7F, (IntPtr)1, IntPtr.Zero) != grande) SendMessage(h, 0x80, (IntPtr)1, grande);
      if (SendMessage(h, 0x7F, IntPtr.Zero, IntPtr.Zero) != petite) SendMessage(h, 0x80, IntPtr.Zero, petite);
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
"@
  [IconeFenetre]::Charger($Ico)
  $vue = $false
  # au plus 30 s pour voir la fenetre apparaitre, puis tant qu'une fenetre Storymatic est ouverte
  while ($true) {
    $n = [IconeFenetre]::Poser()
    if ($n -gt 0) { $vue = $true } elseif ($vue -or $chrono.Elapsed.TotalSeconds -gt 30) { break }
    Start-Sleep -Milliseconds 700
  }
} catch { }
if (-not $fenetre.HasExited) { $fenetre.WaitForExit() }

# Revenu tout de suite : une fenetre de Storymatic etait deja ouverte et a recu la demande ; on ne touche pas au moteur.
if ($chrono.Elapsed.TotalSeconds -lt 5) { exit }

# 4. La fenetre est fermee : on arrete le moteur, seulement si c'est nous qui l'avons demarre.
if ($moteur -and -not $moteur.HasExited) { Stop-Process -Id $moteur.Id -Force }
