#!/bin/bash
# STORYMATIC — Mac : double-cliquez ici la PREMIÈRE fois (et en secours ensuite).
#
# Un fichier venu d'Internet est « mis en quarantaine » par macOS : l'application, lancée telle quelle, serait ouverte
# depuis un dossier temporaire et ne trouverait plus le reste de Storymatic. Ce fichier lève la quarantaine sur le
# dossier, rend ses programmes exécutables, puis ouvre l'application. Storymatic s'ouvre alors sur sa page
# « Installation », qui installe tout le reste, sans Terminal.
#
# macOS bloque ce fichier la toute première fois (« développeur non identifié ») : Réglages Système >
# Confidentialité et sécurité > « Ouvrir quand même ». Une seule fois.
ICI="$(cd "$(dirname "$0")" && pwd)"
clear
echo
echo "  Storymatic se prépare…"
echo
xattr -dr com.apple.quarantine "$ICI" 2>/dev/null
chmod +x "$ICI/Storymatic.app/Contents/MacOS/lancer" "$ICI"/*.command 2>/dev/null
chmod +x "$ICI"/MOTEUR/node/*/bin/node 2>/dev/null
mkdir -p "$ICI/MOTEUR" && date > "$ICI/MOTEUR/.debloque"
open "$ICI/Storymatic.app"
echo "  C'est prêt : Storymatic s'ouvre."
echo "  Vous pouvez fermer cette fenêtre."
echo
exit 0
