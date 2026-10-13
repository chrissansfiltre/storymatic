# Storymatic

**Tes stories Instagram de la semaine, écrites et mises en page par Claude, dans ton style.**

Tu réponds à quelques questions (ta niche, ta cible, ce que tu vends, ta façon de parler, ton rythme), Storymatic te
propose ta **semaine type** — un rôle par jour : vendre, prouver, créer du lien, apprendre, donner — puis, chaque semaine :

1. tu écris l'actu de ta semaine (ce qui s'est passé, ce qui arrive) et tu déposes ta matière (un message de client, des stats…) ;
2. Claude écrit le brief de chaque jour, puis les stories, **avec tes mots** et **à ton style** (tes couleurs, tes polices,
   tes stickers, tes GIF) ;
3. tu retouches ce que tu veux dans l'éditeur, et tu exportes : les stories prêtes à programmer (PNG, ou MP4 quand elles
   bougent), un guide pour poser tes stickers, et le programme de la semaine.

Rien n'est généré par une IA payante : Claude écrit et met en page, les images sont **les tiennes** (tes photos, tes
captures, tes vidéos), les GIF viennent de GIPHY.

## Installer Storymatic (sans terminal)

Il te faut seulement **un abonnement Claude** (Pro ou Max — [claude.ai](https://claude.ai)). Tout le reste, Storymatic
l'installe lui-même.

1. Dans **[Releases](../../releases/latest)** (à droite sur cette page), télécharge le zip de ton ordinateur :
   `Storymatic-Windows_….zip` ou `Storymatic-Mac_….zip`.
2. **Décompresse-le en entier** (clic droit › Extraire tout, sur Windows ; double-clic sur Mac), là où tu veux le garder
   (Documents par exemple).
3. Double-clic sur **`OUVRIR STORYMATIC`** :
   - **Windows** : `OUVRIR STORYMATIC.vbs`. Si Windows affiche « Windows a protégé votre ordinateur » : « Informations
     complémentaires » › « Exécuter quand même ».
   - **Mac** : `OUVRIR STORYMATIC.command`. La toute première fois, macOS le bloque (« développeur non identifié ») :
     Réglages Système › Confidentialité et sécurité › « Ouvrir quand même ». Une seule fois.
4. Storymatic s'ouvre sur sa page **Installation** : clique **« Tout installer »** (Claude Code, les outils vidéo, l'icône
   du Bureau — gratuits, depuis leurs sites officiels), puis **« Se connecter à Claude »** et connecte ton compte.
   En facultatif : le détourage gratuit (« Supprimer le fond », ≈ 1 Go) et ta clé GIPHY gratuite (tes GIF trouvés tout seuls).
5. Ensuite, l'icône **Storymatic** du Bureau suffit.

Le zip contient Node.js (le moteur de Storymatic, licence MIT) : rien à installer avant. La page Installation se retrouve
dans le menu à ton nom (« Installation de l'ordinateur »), par exemple pour changer de compte Claude.

**Depuis le code** (développeurs) : Node.js 20 ou plus, puis `node serveur.js` dans ce dossier et
<http://127.0.0.1:4351> (`--port=4352` pour un autre port) — la même page Installation s'occupe du reste.
Fabriquer les zips : `node OUTILS/release/fabriquer.js` (ils sortent dans `_RELEASES/`).

## Ta première semaine

Au premier lancement, **« Faisons connaissance »** te pose tes questions. Tout se retouche ensuite dans **Mon profil**.
Tu gères plusieurs comptes Instagram ? Le menu à ton nom (en haut du calendrier) passe d'un profil à l'autre ou en crée
un nouveau : chacun a sa semaine type, sa DA, ses captures, ses vidéos et ses exports (`A POSTER/<compte>/`).
Ton style se règle dans **Ma DA Story** : le plus rapide est « Apprendre mon style » — tu glisses un dossier de tes
anciennes stories (et tes stickers, tes polices, tes GIF), et Storymatic en tire ta charte.

## Tes données restent chez toi

Tout ce qui est à toi vit dans ce dossier et n'est jamais envoyé ailleurs que chez Claude (pour écrire) et GIPHY (pour
chercher un GIF) : `MON-PROFIL/` (tes réponses, ta semaine type), `PROJETS/` (tes semaines, tes photos), `IDENTITES/` (ta
DA), `MES CAPTURES/`, `MES VIDEOS/`, `MES STICKERS/`, `GIFS/`, `A POSTER/` (tes exports). Les outils installés vont
dans `MOTEUR/`. Le `.gitignore` les tient hors de Git.

## Licence

MIT — voir [LICENSE](LICENSE). Les GIF de GIPHY ont leurs propres droits (souvent des films et des séries) : à toi de
juger ce que tu publies.
