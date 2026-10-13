# STORYMATIC — les stories Instagram de la semaine, écrites et mises en page par Claude

Storymatic prépare chaque semaine les stories Instagram de la personne qui s'en sert, d'après SA semaine type, à SA DA
Story, et les exporte prêtes à programmer (Meta Business Suite ou autre). Tout ce qui la concerne vit dans son profil
(`MON-PROFIL/`) : rien n'est écrit en dur pour une personne dans le code.

- Port **4351** (`node serveur.js --port=4352` pour un autre). Porte d'entrée : `OUVRIR STORYMATIC.vbs` (Windows →
  `LANCEUR/lancer-studio.ps1` : Node de `MOTEUR/node` sinon celui du poste, fenêtre avec le profil `LANCEUR/profil-navigateur`,
  moteur arrêté à la fermeture ; l'icône du Bureau pointe sur `LANCEUR/Storymatic.vbs`) ; `OUVRIR STORYMATIC.command` (Mac :
  lève la quarantaine puis ouvre `Storymatic.app`, dont `Contents/MacOS/lancer` fait le même travail).
- **L'installation sans terminal** (13 oct. 2026, reprise de MOSAIC ; `installation.js`, `app/installation-ui.js`) : la page
  « Installation » s'ouvre au démarrage tant que l'ordinateur n'est pas prêt (Claude Code, compte Claude connecté, ffmpeg, un
  navigateur), avant « Faisons connaissance » ; « Plus tard » laisse un bandeau. Pièces : `claude` (installateur officiel),
  `compte` (`claude auth login`, code, changer de compte ; Pro/Max vérifié), `ffmpeg` (→ `MOTEUR/ffmpeg`), `navigateur` (Chrome
  for Testing → `MOTEUR/navigateur`, seulement sans Chrome ni Edge), `raccourci`, et en FACULTATIF `detourage` (Python officiel /
  python-build-standalone → `MOTEUR/python`, onnxruntime, BiRefNet ≈ 970 Mo) et `giphy` (la clé, `/api/gifs/giphy-cle`). Les
  chemins vont dans `reglages.json` (recalés au démarrage si le dossier a bougé). Aussi dans le menu du profil.
- **Les zips** : `node OUTILS/release/fabriquer.js` → `_RELEASES/Storymatic-Windows_<date>.zip` et `-Mac_<date>.zip`, avec
  Node.js (dernière LTS, SHA-256 vérifié) et `VERSION.json` ; rien de personnel (liste blanche : `FICHIERS`, `DOSSIERS`).
  Ce sont eux qu'on joint à une Release GitHub. Tout nouveau fichier serveur à la racine doit entrer dans `FICHIERS`.
- **Rien n'est généré, rien ne coûte de crédit** : Claude écrit (plan, mise en page, briefs) sur l'abonnement ; les images sont
  celles de la personne (sa banque, sa matière, ses captures, ses vidéos) ; les GIF viennent de GIPHY (SA clé gratuite).

## Le profil (`profil.js`, `app/profil-ui.js`)

- **Plusieurs profils** (un par compte Instagram) : `MON-PROFIL/<id>/` (profil.json + semaine-type.md) et `MON-PROFIL/profils.json`
  ({actif, ordre}). Chaque profil a SON projet (`stories-<id>`), SA DA, `MES CAPTURES/<id>/`, `MES VIDEOS/<id>/` et ses exports
  `A POSTER/<compte>/`. Le menu `[data-profils]` (calendrier et barre de la semaine, `menuProfils` dans `app/profil-ui.js`) change
  de profil (`/api/profils/choisir`), en crée un (`/nouveau` : « Faisons connaissance » avec « Annuler ce profil ») ou en retire un
  (`/retirer` → `MON-PROFIL/_corbeille`, jamais le dernier). On ne change pas de profil pendant qu'une tâche tourne. L'ancien
  profil unique (`MON-PROFIL/profil.json` à la racine) est repris tout seul au démarrage (`reprendreUnique`).
- `MON-PROFIL/<id>/profil.json` : prénom, compte, niche, cible, `presence` (jamais / visage / avatar), `offre`, `ressource`, `mots`
  (les mots à répondre et ce qu'ils envoient), `rythme` (min, max, jours postés), `captures` / `videos` (ce qu'elles montrent),
  `recette` (comment une story est construite ; vide = `RECETTE_DEFAUT`), `gifChaqueStory`, `projet` (le dossier dans PROJETS/,
  `stories-<id>`), `da` (l'id de sa DA, créée d'office : « DA de <prénom> »), `complet`.
- `MON-PROFIL/<id>/semaine-type.md` : un `## <Jour> — <rôle>` par jour posté ; écrite par Claude (`/api/profil/semaine-type/proposer`)
  d'après `SAVOIR/stories/methode-semaine.md` et le profil, retouchée jour par jour par la personne.
- Sa voix (façon de parler, textes à elle) est rangée dans SA DA (`/api/profil/voix`) : Claude la lit pour chaque story.
- **« Faisons connaissance »** (`app/profil-ui.js`) : 7 étapes — toi · ce que tu vends · ta voix · ton rythme · ta semaine type ·
  ton style (DA, GIPHY, recette) · tes éléments. Au premier lancement (`complet` faux) il s'ouvre avant le calendrier ; ensuite,
  « Mon profil ».
- `profil.enClair()` : le profil en texte pour les demandes à Claude. Toute consigne à Claude qui parle de la personne passe par
  lui (jamais un nom, une offre ou un mot écrits en dur).

## Les écrans

1. **Le calendrier** (`/`, `app/semaine.html`) : l'année, une ligne par semaine (lundi, numéro ISO), verte quand elle est faite
   (exportée, ou tous ses jours prêts), orange commencée, cerclée de blanc la semaine en cours. Le bandeau « Prochaine semaine à
   préparer » vise la première semaine non faite APRÈS la dernière faite (jamais avant la semaine en cours).
2. **Ma semaine** (`/?semaine=AAAA-MM-JJ`, même page) : à gauche une barre fixe (semaine, jauge, « ✦ Préparer la semaine », les 7
   jours, et en bas Préparer / Briefs / Exporter / dossier / DA) ; à droite UN jour en grand — ses stories côte à côte, chacune avec
   SA partie du brief (`briefParStory`) — ou la préparation (l'actu, la matière, les tuiles Ma banque / Mes captures / Mes vidéos,
   chacune avec ajout, « Décrire » par Claude, retouche et retrait). La vue est gardée par semaine (`sessionStorage vue-<id>`).
3. **L'éditeur** (`/editeur`, `app/index.html`) : on n'y entre que par un jour (`?pub=<id>&semaine=…`) ou par la DA Story
   (`?da=story`, la DA du profil : `window.SM_DA`) ; sinon retour à la semaine. Deux écrans seulement (`SM_ECRANS` dans `app.js`) :
   les stories d'un jour (« Le plan » puis « Les stories ») et la DA Story.

## Refaire des stickers (`stickers.js`, `app/js/stickers.js`)

- Dans « Ma DA Story » → tiroir « Les éléments » → « ✦ Refaire des stickers d'après une image ». La personne dépose une planche
  de stickers (Pinterest…), choisit les textes (traduits en français / adaptés à son univers via `profil.enClair()`) et les
  couleurs (celles de l'image / celles de sa DA), plus une demande libre (un ordre).
- Claude : 1. l'inventaire (`demanderJson` : description, texte final, nom, « quand ») ; 2. le dessin en SVG, 3 stickers par
  demande, 3 demandes à la fois (règles `REGLES_DESSIN`, boîte à outils `KIT` : #grain, #cut, #cutBlob, #spk, #cursor, #pixcur,
  `data-star`, `data-zig` développés par le serveur) ; 3. la photographie : `/stickers-page/<id>/<n>` (sans script, ×3, fond
  transparent, `photographier`), PNG rogné en Node (`lirePng`/`ecrirePng`, zlib) ; 4. la relecture : planche ffmpeg + original →
  les défauts visibles, corrigés une fois. Polices : la liste `POLICES` (Google Fonts) + celles de la DA.
- Sessions dans `CACHE/stickers/<id>/` ; PNG finis copiés dans `MES STICKERS/<profil>/<date>/` ; « Ajouter à mes éléments » →
  `ajouterElementDA` (sous-DA story). Retouche d'un sticker : son texte et/ou ce qui ne va pas.
- Le test d'origine (16 stickers refaits à la main) : `../LABO/stickers-fr/`.

## Le serveur

- `serveur.js` : les publications (une par jour), les DA, les polices, les GIF, GIPHY, l'export ; il branche `profil.js`,
  `semaine.js` (la semaine, la banque, les captures, les vidéos, l'export de la semaine et ses guides) et `apprendre.js`
  (« Apprendre mon style »). Claude est appelé en `--print` avec Read, Glob, Grep seulement (`interroger`).
- **Les données** (jamais dans Git, voir `.gitignore`) : `MON-PROFIL/` ; le projet `PROJETS/<projet>/` — `SEMAINES/<lundi>/semaine.json`,
  `PUBLICATIONS/<id>/`, `RENDUS/banque/` (+ `banque.json`), `RENDUS/semaines/<lundi>/` (la matière) ; la DA dans `IDENTITES/<da>/` ;
  polices de l'ordinateur `IDENTITES/_polices-locales/` ; GIF `GIFS/` ; clé GIPHY `%USERPROFILE%/.storymatic/giphy.key` ; captures
  `MES CAPTURES/<id>/` (C#, `captures.json`) ; vidéos `MES VIDEOS/<id>/` (V#, `videos.json`) ; stickers refaits `MES STICKERS/<id>/` ; exports
  `A POSTER/<compte>/Semaine du <lundi>/`.
- **La semaine** : les briefs (une demande à Claude : le profil, la semaine type, l'actu, la matière, la banque, les captures, les
  vidéos), puis chaque jour = une publication « stories » faite par `ecrirePlanPub` + `composerPub` ; `pub.sansGen` (aucune image
  générée). Un jour verrouillé (`verrou`) n'est plus jamais refait. AUCUN FAIT INVENTÉ : les faits viennent de l'actu et de la matière.
- **Le plan** : la recette du profil ; les GIF : `"gif":{"chercher":"<mots anglais de l'émotion>"}` → `choisirGifsGiphy` (8 candidats,
  une planche par story que Claude regarde) ; la bibliothèque de la DA seulement si un « quand » colle exactement.
- **La mise en page** : Claude compose chaque story en HTML/CSS d'après la charte de la DA ; le serveur nettoie (`htmlSur`, `cssSur`),
  sert `/pub/<projet>/<id>/slide/<n>` sans script, et le **contrôle géométrique** (`app/js/audit-slide.js`) fait refaire les stories
  où un texte est recouvert (deux passes au plus).
- **L'export** (`exporterPub`, `exporterSlideVideo`) : PNG pour une story fixe, MP4 1080 × 1920 pour une story qui bouge ; une story
  à carte GIF dure 12 s ; ce qui est AU-DESSUS de la vidéo dans les calques repasse devant elle (`?dessus=1`).

## Les règles

- Réponses en français.
- Ne jamais générer quoi que ce soit de payant.
- Ne jamais écrire une donnée de la personne dans le code : tout passe par le profil.
- Après une modification : relancer Storymatic (vérifier qu'aucun `claude --print` ne tourne).
- Les suppressions vont dans une corbeille (`_corbeille` du dossier) ; les copies d'avant un gros changement dans `SAUVEGARDES/`.
