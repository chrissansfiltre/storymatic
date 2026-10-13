/* ============================================================
   LE PONT — relie l'application à Claude Code
   ============================================================

   Ce petit serveur tourne en local, sur votre machine uniquement.
   Il fait deux choses :

     1. il sert l'application (le studio) dans le navigateur ;
     2. quand vous envoyez une demande depuis le studio, il la transmet
        à Claude Code, attend sa réflexion, et renvoie sa réponse à l'écran.

   Aucune donnée ne sort de la machine autrement que par Claude Code, avec
   votre propre abonnement. Le serveur n'écoute que sur 127.0.0.1 : il est
   invisible depuis le réseau.

   Lancement : double-clic sur LANCER-LE-STUDIO.bat
   ============================================================ */

const http  = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

const RACINE = __dirname;

/* La date du code au moment du lancement. Si le fichier sur le disque
   devient plus récent, c'est que le studio tourne sur une version
   dépassée : il faut le relancer pour que le changement s'applique. */
const DATE_DU_CODE = (() => {
  try { return fs.statSync(__filename).mtimeMs; } catch (e) { return 0; }
})();

function codePerime() {
  try { return fs.statSync(__filename).mtimeMs > DATE_DU_CODE + 1000; }
  catch (e) { return false; }
}
const APP    = path.join(RACINE, 'app');
/* Le port. On peut en lancer une seconde instance sur un autre port
   (PORT=4322) pour essayer une modification sans fermer celle qui
   tourne. */
const PORT   = Number(process.env.PORT) || Number((process.argv.find(a => a.startsWith('--port=')) || '').slice(7)) || 4351;   // Storymatic (« node serveur.js --port=4352 » pour un autre port)

// Délai maximum laissé à Claude Code pour répondre.
// Écrire un prompt prend de 20 s à 2 min ; attendre qu'un modèle rende
// une vidéo peut prendre un quart d'heure. Deux délais, donc.
const DELAI_MAX = 5 * 60 * 1000;
const DELAI_GENERATION = 30 * 60 * 1000;

/* ------------------------------------------------------------
   LES PROJETS

   Storymatic n'a qu'un projet, PROJETS/<projet>/ : projet.json, SEMAINES/,
   PUBLICATIONS/ (une par jour) et RENDUS/ (la banque d'images).

   Chaque requête dit son projet (en-tête X-Projet, sinon cookie « projet »,
   sinon le dernier projet ouvert) ; AsyncLocalStorage le garde attaché à tout
   ce que la requête déclenche.
   ------------------------------------------------------------ */
const { AsyncLocalStorage, AsyncResource } = require('async_hooks');
const CONTEXTE = new AsyncLocalStorage();
const DOSSIER_PROJETS = path.join(RACINE, 'PROJETS');
const DOSSIER_CACHE = path.join(RACINE, 'CACHE');
const PROJET_DEFAUT = 'mes-creations';
const SOUS_DOSSIERS_PROJET = ['RENDUS', 'PUBLICATIONS'];

function projetExiste(id) {
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || '')) &&
    fs.existsSync(path.join(DOSSIER_PROJETS, String(id), 'projet.json'));
}
function lireProjet(id) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(DOSSIER_PROJETS, id, 'projet.json'), 'utf8'));
    return Object.assign({ nom: id, brief: '' }, p, { id: id });
  } catch (e) { return null; }
}
function ecrireProjet(id, p) {
  const copie = Object.assign({}, p);
  delete copie.id;
  ecrireJsonSurement(path.join(DOSSIER_PROJETS, id, 'projet.json'), copie);
}
// Les projets, du plus récemment ouvert au plus ancien. `_…` est ignoré.
function listeProjets() {
  let noms = [];
  try { noms = fs.readdirSync(DOSSIER_PROJETS, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch (e) { return []; }
  return noms.filter(x => !x.startsWith('_') && projetExiste(x)).map(lireProjet).filter(Boolean)
    .sort((a, b) => String(b.ouvert || b.cree || '').localeCompare(String(a.ouvert || a.cree || '')));
}
function projetParDefaut() {
  const l = listeProjets();
  return l.length ? l[0].id : PROJET_DEFAUT;
}
function projetCourant() {
  const c = CONTEXTE.getStore();
  return (c && c.projet) || projetParDefaut();
}
// Le projet d'une requête : en-tête, cookie, sinon le dernier ouvert.
function projetDeRequete(req) {
  const entete = String(req.headers['x-projet'] || '').trim();
  if (projetExiste(entete)) return entete;
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)projet=([a-z0-9-]+)/);
  if (m && projetExiste(m[1])) return m[1];
  return projetParDefaut();
}
const dossierProjet = id => path.join(DOSSIER_PROJETS, id || projetCourant());
const dossierRendus = () => path.join(dossierProjet(), 'RENDUS');
const fichierRendus = () => path.join(dossierRendus(), 'rendus.json');

/* Créer un projet : son dossier, ses sous-dossiers, sa fiche. */
function creerProjet(d, idVoulu) {
  const nom = String(d && d.nom || '').trim().slice(0, 80);
  if (!nom) throw new Error('Donnez un nom au projet.');
  let id = idVoulu || slugAvatar(nom) || 'projet', k = 2;
  const base = id;
  while (fs.existsSync(path.join(DOSSIER_PROJETS, id))) id = base + '-' + (k++);
  SOUS_DOSSIERS_PROJET.forEach(x => fs.mkdirSync(path.join(DOSSIER_PROJETS, id, x), { recursive: true }));
  const maintenant = new Date().toISOString();
  ecrireProjet(id, {
    nom: nom, brief: String(d.brief || '').trim().slice(0, 4000),
    cree: maintenant, ouvert: maintenant
  });
  return lireProjet(id);
}

/* Ce qu'une carte de projet affiche : ses chiffres et sa couverture — la
   dernière image produite dans le projet, sinon son dernier lieu. */
function resumeProjet(p) {
  if (!p) return null;
  return CONTEXTE.run({ projet: p.id }, () => {
    const rendus = lireRendus() || [];
    const image = rendus.find(x => x && x.fichier && /.(png|jpe?g|webp)$/i.test(x.fichier));
    const couverture = image ? '/PROJETS/' + p.id + '/RENDUS/' + image.fichier.split('/').map(encodeURIComponent).join('/') : null;
    return {
      id: p.id, nom: p.nom, brief: p.brief || '',
      cree: p.cree || null, ouvert: p.ouvert || null, modifie: p.modifie || null,
      nbRendus: rendus.length,
      couverture: couverture
    };
  });
}


// Les images déposées par l'équipe pour une demande ponctuelle.
// (dossierImports() : voir « LES PROJETS » plus bas)
const TYPES_IMAGE = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const IMPORT_MAX_OCTETS = 12 * 1024 * 1024;

/* ------------------------------------------------------------
   L'historique
   ------------------------------------------------------------ */

/* Avant d'écraser un fichier de données, on garde la version précédente à
   côté, en .bak. Une écriture interrompue — coupure, disque plein — laisse
   sinon un JSON illisible, et la lecture repart alors d'une liste vide :
   l'écriture suivante effacerait tout pour de bon. */
function sauvegarderAvant(fichier) {
  try {
    if (fs.existsSync(fichier)) fs.copyFileSync(fichier, fichier + '.bak');
  } catch (e) { /* une sauvegarde ratée ne doit pas bloquer l'écriture */ }
}

/* Écriture en deux temps : on écrit à côté, puis on renomme. Le renommage
   est atomique, donc le fichier lu n'est jamais un fichier à moitié écrit. */
function ecrireJsonSurement(fichier, donnees) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  sauvegarderAvant(fichier);
  const tmp = fichier + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(donnees, null, 2), 'utf8');
  fs.renameSync(tmp, fichier);
}

/* Si le fichier principal est illisible, on tente sa sauvegarde plutôt que
   de repartir de zéro. */
function lireJsonAvecSecours(fichier) {
  for (const f of [fichier, fichier + '.bak']) {
    try {
      const l = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(l)) {
        if (f !== fichier) {
          console.log('  (fichier ' + path.basename(fichier) +
                      ' illisible : la sauvegarde .bak a été utilisée)');
        }
        return l;
      }
    } catch (e) { /* on essaie le suivant */ }
  }
  return [];
}

/* Les rendus du projet (RENDUS/) : la banque d'images de la semaine. */
function lireRendus() {
  return lireJsonAvecSecours(fichierRendus());
}

/* Les rayons du dossier RENDUS/. Un rendu va dans celui de son genre, pour
   qu'on le retrouve à l'œil dans le dossier comme dans « Importer un rendu ».
   L'ordre est celui de la fenêtre d'import. */
const RAYONS_RENDUS = [
  { slug: 'character-sheets', titre: 'Character sheets' },
  { slug: 'ref-sheets',       titre: 'Ref sheets' },
  { slug: 'packshots',        titre: 'Packshots' },
  { slug: 'environnements',   titre: 'Environnements' },
  { slug: 'images',           titre: 'Images' },
  { slug: 'videos',           titre: 'Vidéos' },
  { slug: 'audio',            titre: 'Voix & son' }
];
const SLUGS_RENDUS = RAYONS_RENDUS.map(x => x.slug);




/* Le chemin ABSOLU d'un rendu à partir de son nom déclaré (« images/2026-…png », ou un nom seul pour les
   plus anciens, à la racine). Un rayon inconnu, un « .. » ou un chemin absolu rendent null : rien ne sort
   de RENDUS/. Avant le 24 septembre 2026, ces routes ne gardaient que le nom du fichier et le cherchaient
   à la racine : supprimer un rendu laissait le fichier sur le disque, et l'importer répondait « introuvable ». */
function cheminRendu(declare) {
  const parts = String(declare || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const nom = parts[parts.length - 1];
  if (nom === '.' || nom === '..' || nom !== path.basename(nom)) return null;
  if (parts.length === 2 && SLUGS_RENDUS.indexOf(parts[0]) === -1) return null;
  return path.join(dossierRendus(), ...parts);
}


/* ------------------------------------------------------------
   Localiser Claude Code
   ------------------------------------------------------------ */

/* L'application Claude (desktop) embarque son propre Claude Code, hors PATH :
   %APPDATA%\Claude\claude-code\<version>\claude.exe sur Windows,
   ~/Library/Application Support/Claude/claude-code/<version>/claude sur Mac.
   Quand l'app vient du Microsoft Store, Windows isole son AppData : le vrai
   dossier est alors %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude.
   Le numéro de version change à chaque mise à jour de l'app : on balaie chaque
   racine et on essaie la version la plus récente en premier. */
function dossiersClaudeDesktop() {
  const racines = [];
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const local   = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    racines.push(path.join(roaming, 'Claude', 'claude-code'));
    try {
      fs.readdirSync(path.join(local, 'Packages'))
        .filter(n => /^Claude_/i.test(n))
        .forEach(n => racines.push(path.join(local, 'Packages', n, 'LocalCache', 'Roaming', 'Claude', 'claude-code')));
    } catch (e) { /* pas de dossier Packages : app non Store */ }
  } else {
    racines.push(path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code'));
  }

  const dossiers = [];
  for (const racine of racines) {
    try {
      fs.readdirSync(racine, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .forEach(v => dossiers.push(path.join(racine, v)));
    } catch (e) { /* racine absente, on continue */ }
  }
  return dossiers;
}

function trouverClaude() {
  const noms = process.platform === 'win32'
    ? ['claude.exe', 'claude.cmd', 'claude']
    : ['claude'];

  const dossiers = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'claude'),
    ...(process.env.PATH || '').split(path.delimiter),
    ...dossiersClaudeDesktop()
  ];

  for (const d of dossiers) {
    for (const n of noms) {
      try {
        const p = path.join(d, n);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      } catch (e) { /* dossier illisible, on continue */ }
    }
  }
  return null;
}

/* Le binaire peut être imposé par la variable STUDIO_CLAUDE — un chemin, ou
   une commande avec ses premiers arguments (« node C:\outil\faux-claude.js »).
   Sert au support quand le binaire est rangé ailleurs, et aux essais du
   studio sans dépenser de crédits. */
const CLAUDE_PREFIXE = [];
// « let » : la page Installation installe Claude Code pendant que le moteur tourne, puis le fait rechercher
// (redetecterClaude) — sans quoi il faudrait relancer le studio pour qu'il le voie.
let CLAUDE = (() => {
  const force = String(process.env.STUDIO_CLAUDE || '').trim();
  if (!force) return trouverClaude();
  if (fs.existsSync(force)) return force;
  const morceaux = force.match(/"[^"]+"|\S+/g).map(x => x.replace(/^"|"$/g, ''));
  CLAUDE_PREFIXE.push(...morceaux.slice(1));
  return morceaux[0];
})();
function redetecterClaude() {
  if (String(process.env.STUDIO_CLAUDE || '').trim()) return CLAUDE;
  CLAUDE = trouverClaude();
  return CLAUDE;
}

/* ------------------------------------------------------------
   LE MODÈLE DE CLAUDE

   Le studio n'imposait aucun modèle : il prenait celui que Claude Code a par
   défaut sur le poste. Deux acheteurs pouvaient donc faire tourner le même
   studio sur deux modèles différents, sans que rien à l'écran ne le dise.

   Les formules Pro et Max donnent accès aux mêmes modèles (relevé sur la page
   de tarifs le 22 septembre 2026) : ce qui les sépare, ce sont les limites
   d'usage. Un modèle plus fin les épuise donc plus vite, il ne se refuse pas.

   Le choix vit maintenant dans reglages.json, à la racine du studio, et part
   sur la ligne de commande (--model). Les noms sont courts exprès : « opus »
   suit les sorties de modèles, un identifiant figé vieillirait. Le zip de
   vente ne contient pas ce fichier : une installation neuve part donc sur le
   réglage du compte, comme avant.
   ------------------------------------------------------------ */

const F_REGLAGES = path.join(RACINE, 'reglages.json');

const MODELES_CLAUDE = [
  { id: '',       nom: 'Celui de Claude Code', sous: 'le réglage de votre compte' },
  /* Opus 5.5 nommé EN TOUTES LETTRES (23 sept. 2026, à la demande de l'utilisateur) : l'alias « opus »
     suit la version du CLI installé — un Claude Code 2.1.274 le faisait pointer sur Opus 5, et il
     fallait la 2.1.280 pour Opus 5.5. L'identifiant exact garantit le modèle ; un CLI trop ancien
     pour le connaître le dit à la première demande (unrecognized_model) au lieu de tourner en silence
     sur un autre. Un poste réglé sur l'ancien « opus » est repris par MODELES_ANCIENS. */
  { id: 'claude-opus-5-5', nom: 'Opus 5.5',        sous: 'le plus fin — épuise plus vite vos limites' },
  { id: 'sonnet', nom: 'Sonnet',               sous: 'le bon compromis vitesse / finesse' }
];

/* HAIKU A ÉTÉ RETIRÉ DU MENU le 22 septembre 2026, après une comparaison réelle sur
   un character sheet — mêmes réglages, mêmes paramètres d'avatar, les trois modèles.
   Son prompt collait du commentaire français devant le prompt envoyé au modèle
   d'image, laissait des choix en suspens (« dark brown or charcoal »), et écrivait
   un portrait frontal, ce que la loi 5 interdit. La planche obtenue ne peut pas
   servir de référence d'identité — c'est pourtant tout son rôle. Un studio vendu à
   des débutants ne doit pas proposer un réglage qui casse leur avatar en silence.
   Une valeur inconnue dans reglages.json retombe sur le défaut : un poste réglé sur
   haiku repart donc sur le modèle du compte, sans rien à réparer à la main. */

function lireReglages() {
  try { return JSON.parse(fs.readFileSync(F_REGLAGES, 'utf8')) || {}; } catch (e) { return {}; }
}
function ecrireReglages(r) { ecrireJsonSurement(F_REGLAGES, r); }
/* Les outils posés par la page Installation vivent dans MOTEUR/ (ffmpeg, Python du détourage) : si le dossier de
   Storymatic a été déplacé, leurs chemins écrits dans reglages.json visent l'ancien endroit — on les recale ici. */
(function accorderReglagesMoteur() {
  const r = lireReglages(); let change = false;
  ['ffmpeg', 'ffprobe', 'pythonDetourage'].forEach(k => {
    const v = String(r[k] || ''); if (!v || fs.existsSync(v)) return;
    const i = v.split(path.sep).join('/').split('\\').join('/').lastIndexOf('/MOTEUR/'); if (i < 0) return;
    const neuf = path.join(RACINE, v.split(path.sep).join('/').split('\\').join('/').slice(i + 1));
    if (fs.existsSync(neuf)) { r[k] = neuf; change = true; }
  });
  if (change) try { ecrireReglages(r); } catch (e) {}
})();

// Les anciens réglages, repris sous leur nouveau nom plutôt que de retomber sur le défaut.
const MODELES_ANCIENS = { opus: 'claude-opus-5-5' };

let MODELE = (() => {
  let m = String(lireReglages().modele || '').trim();
  if (MODELES_ANCIENS[m]) m = MODELES_ANCIENS[m];
  return MODELES_CLAUDE.some(x => x.id === m) ? m : '';
})();

function poserModele(id) {
  let m = String(id || '').trim();
  if (MODELES_ANCIENS[m]) m = MODELES_ANCIENS[m];
  if (!MODELES_CLAUDE.some(x => x.id === m)) throw new Error("Ce modele n'est pas propose par le studio.");
  MODELE = m;
  const r = lireReglages();
  r.modele = m;
  ecrireJsonSurement(F_REGLAGES, r);
  return m;
}

/* Un identifiant propre tiré d'un nom (sans accents, sans espaces). */
function slugAvatar(nom) {
  return String(nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'avatar';
}

const EXT_IMAGE = ['.png', '.jpg', '.jpeg', '.webp'];


/* ------------------------------------------------------------
   Interroger Claude Code
   ------------------------------------------------------------ */

/* Interroge Claude Code et relaie sa réponse AU FUR ET À MESURE.
   Écrire un prompt complet demande une à deux minutes : voir le texte
   s'écrire rend l'attente lisible, et c'est exactement l'expérience
   qu'on a en parlant à Claude Code directement. */
/* `options` (facultatif) :
     suivre(e)   — reçoit CHAQUE événement du flux (pas seulement le texte) : un outil qui démarre,
                   une réflexion en cours. Sans lui, un Claude qui réfléchit dix minutes ressemble
                   trait pour trait à un Claude planté : rien ne sort, rien ne bouge ;
     controle    — un objet où la fonction dépose `arreter()`, pour annuler depuis l'extérieur ;
     env         — des variables d'environnement en plus pour ce lancement ;
     args        — des options en plus sur la ligne de commande de Claude Code (ex. --effort low) ;
     outils      — les outils de Claude Code pour ce lancement (par défaut Read, Glob, Grep). */
function interroger(question, sysPrompt, onDelta, minTexte, delai, options) {
  const O = options || {};
  const SEUIL = (typeof minTexte === 'number') ? minTexte : 40;
  const LIMITE = (typeof delai === 'number') ? delai : DELAI_MAX;
  return new Promise((resolve, reject) => {
    if (!CLAUDE) {
      return reject(new Error(
        "Claude Code est introuvable sur cette machine. Installez-le, puis relancez le studio."
      ));
    }

    // Les consignes passent par un fichier : elles sont trop longues
    // pour tenir dans une ligne de commande Windows.
    const fSys = path.join(os.tmpdir(), 'avatar-consignes-' + Date.now() + '.md');
    fs.writeFileSync(fSys, sysPrompt, 'utf8');

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--append-system-prompt-file', fSys,
      /* ToolSearch d'office (1er oct. 2026) : Claude Code 2.1 charge les outils MCP « à la demande ». Quand Higgsfield
         ou Magnific se connecte encore au démarrage de Claude, leurs outils (media_upload…) n'arrivent que par
         ToolSearch — sans lui, l'envoi des références échouait au hasard (« encore en cours de connexion »).
         ToolSearch ne fait que charger la définition d'un outil : aucun risque. */
      '--tools', ...(O.outils || ['Read', 'Glob', 'Grep', 'ToolSearch']),
      '--permission-mode', 'bypassPermissions'
    ];
    // Sans reglage, Claude Code garde le modele par defaut du compte.
    if (MODELE) args.push('--model', MODELE);

    const proc = spawn(CLAUDE, CLAUDE_PREFIXE.concat(args, O.args || []), { cwd: RACINE, windowsHide: true,
                                                              env: O.env ? Object.assign({}, process.env, O.env) : process.env });
    let annule = false;
    if (O.controle) O.controle.arreter = raison => { annule = raison || 'Annulé.'; try { proc.kill(); } catch (_) {} };

    let texte = '', brut = '', erreur = '', reste = '';
    let limiteAtteinte = false;

    const minuteur = setTimeout(() => {
      proc.kill();
      reject(new Error(
        "Le délai d'attente est dépassé (" + Math.round(LIMITE / 60000) + " min). " +
        "La génération a peut-être abouti sur la plateforme : ouvrez l'atelier et " +
        "demandez la liste de vos dernières créations."
      ));
    }, LIMITE);

    const nettoyer = () => {
      clearTimeout(minuteur);
      try { fs.unlinkSync(fSys); } catch (_) {}
    };

    // Le flux arrive en JSON, une ligne par événement.
    proc.stdout.on('data', d => {
      brut += d.toString();
      reste += d.toString();
      const lignes = reste.split('\n');
      reste = lignes.pop();
      for (const l of lignes) {
        const s = l.trim();
        if (!s) continue;
        let ev;
        try { ev = JSON.parse(s); } catch (_) { continue; }

        if (ev.type === 'stream_event' && ev.event) {
          const e = ev.event;
          if (O.suivre) { try { O.suivre(e); } catch (_) {} }
          if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
            texte += e.delta.text;
            if (onDelta) onDelta(e.delta.text);
          }
        } else if (ev.type === 'rate_limit_event') {
          // Cet événement ouvre TOUJOURS le flux, y compris quand tout va
          // bien : seul son champ status dit s'il y a un vrai blocage.
          const st = ev.rate_limit_info && ev.rate_limit_info.status;
          if (st && st !== 'allowed') limiteAtteinte = true;
        }
      }
    });

    proc.stderr.on('data', d => erreur += d.toString());

    proc.on('error', e => {
      nettoyer();
      reject(new Error("Impossible de lancer Claude Code : " + e.message));
    });

    proc.on('close', code => {
      nettoyer();

      // Arrêté de l'extérieur (annulation, garde-fou) : ce n'est pas une réponse, même partielle.
      if (annule) return reject(new Error(String(annule)));

      // Un texte écrit est un texte livré : on ne le jette jamais,
      // même si le flux se termine mal.
      if (texte.trim().length >= SEUIL) {
        return resolve({ texte: texte.trim() });
      }

      const tout = brut + '\n' + erreur;

      if (/Failed to authenticate|OAuth session|not logged in|Please run .?claude login|Invalid API key/i.test(tout)) {
        return reject(new Error(
          "Claude Code n'est pas connecté. Ouvrez un terminal, tapez « claude », " +
          "connectez-vous à votre compte, puis réessayez ici."
        ));
      }
      if (limiteAtteinte || /usage limit reached|Claude usage limit/i.test(tout)) {
        return reject(new Error(
          "La limite d'utilisation de Claude Code est atteinte. Elle se réinitialise " +
          "au bout de quelques heures — réessayez plus tard."
        ));
      }
      reject(new Error(erreur.trim() || "Claude Code s'est arrêté sans rien écrire."));
    });

    proc.stdin.write(question);
    proc.stdin.end();
  });
}

/* Extrait le PREMIER objet JSON complet d'un texte, en suivant les accolades
   et en ignorant celles qui sont dans une chaine.

   Découper du premier « { » au dernier « } », comme on le faisait, se casse
   dès que le moteur ajoute une phrase derrière son JSON : si cette phrase
   contient une accolade, le découpage avale les deux et JSON.parse échoue sur
   « Unexpected non-whitespace character after JSON ». Claude respecte en
   général la consigne « du JSON et rien d'autre », mais une phrase en trop ne
   doit jamais casser la lecture. */
function premierObjetJson(t) {
  let profondeur = 0, debut = -1, dansChaine = false, echap = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dansChaine) {
      if (echap) echap = false;
      else if (c === '\\') echap = true;
      else if (c === '"') dansChaine = false;
      continue;
    }
    if (c === '"') { dansChaine = true; continue; }
    if (c === '{') { if (profondeur === 0) debut = i; profondeur++; }
    else if (c === '}' && profondeur > 0) {
      profondeur--;
      if (profondeur === 0) return t.slice(debut, i + 1);
    }
  }
  return null;
}

function demanderJson(question, delai, options) {
  const consigne = [
    'Tu reponds UNIQUEMENT du JSON strict, sur une seule ligne.',
    'Aucun texte avant, aucun texte apres, aucun bloc de code.',
    'Si une information manque, mets null a sa place plutot que',
    'de l\'inventer.'
  ].join('\n');

  return interroger(question, consigne, null, 1, delai, options).then(r => {
    const t = r.texte || '';
    const bloc = premierObjetJson(t);
    if (!bloc) {
      throw new Error(
        "Le moteur n'a pas repondu dans le format attendu. Il a ecrit : " +
        (t.trim().slice(0, 300) || '(rien)')
      );
    }
    try {
      return JSON.parse(bloc);
    } catch (e) {
      throw new Error("Le moteur a repondu un JSON illisible : " + e.message);
    }
  });
}

/* ============================================================
   LA DA ET LES PUBLICATIONS (les stories d'un jour)

   Une IDENTITÉ est une direction artistique : couleurs, polices, logo,
   visuels d'exemple, fichier de design. Elle vit dans IDENTITES/<id>/, à la
   racine de Storymatic. Seule sa sous-DA Story existe ici.

   Une PUBLICATION est la suite de stories d'un jour. Elle vit dans
   PROJETS/<projet>/PUBLICATIONS/<id>/ et passe par trois états :
     1. le PLAN — slide par slide, écrit par Claude, corrigé à la main ;
     2. la MISE EN PAGE — Claude compose les slides en HTML et CSS, à la DA.
        Le texte reste du texte : il se corrige sans rien regénérer, et
        aucune plateforme de génération n'est appelée (aucun crédit) ;
     3. l'EXPORT — chaque slide est photographiée en PNG par le navigateur
        du poste, sans fenêtre, puis le tout est rangé dans un .zip.
   ============================================================ */

const DOSSIER_IDENTITES = path.join(RACINE, 'IDENTITES');

/* Les polices proposées : toutes chez Google Fonts, chargées par le studio.
   Claude ne peut en employer aucune autre — une police absente du poste
   retomberait sur Arial au moment de l'export. */
const POLICES_BASE = ['Inter', 'Poppins', 'Sora', 'Montserrat', 'Manrope', 'DM Sans', 'Space Grotesk', 'Outfit',
  'Plus Jakarta Sans', 'Archivo', 'Bebas Neue', 'Anton', 'Oswald', 'Syne', 'Unbounded',
  'Playfair Display', 'DM Serif Display', 'Fraunces', 'Cormorant Garamond', 'Lora', 'Caveat', 'Permanent Marker'];

/* CE QUE CHAQUE POLICE POSSÈDE VRAIMENT : ses graisses et son italique (relevé sur Google Fonts). L'éditeur
   de slide proposait les cinq mêmes graisses pour toutes — Bebas Neue n'en a qu'une, Sora n'a pas d'italique —
   et demander à Google une graisse qui n'existe pas peut faire échouer le chargement de toute la police. */
const POLICES_INFO = {
  'Inter':              { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: true },
  'Poppins':            { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: true },
  'Sora':               { graisses: [100, 200, 300, 400, 500, 600, 700, 800], italique: false },
  'Montserrat':         { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: true },
  'Manrope':            { graisses: [200, 300, 400, 500, 600, 700, 800], italique: false },
  'DM Sans':            { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: true },
  'Space Grotesk':      { graisses: [300, 400, 500, 600, 700], italique: false },
  'Outfit':             { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: false },
  'Plus Jakarta Sans':  { graisses: [200, 300, 400, 500, 600, 700, 800], italique: true },
  'Archivo':            { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: true },
  'Bebas Neue':         { graisses: [400], italique: false },
  'Anton':              { graisses: [400], italique: false },
  'Oswald':             { graisses: [200, 300, 400, 500, 600, 700], italique: false },
  'Syne':               { graisses: [400, 500, 600, 700, 800], italique: false },
  'Unbounded':          { graisses: [200, 300, 400, 500, 600, 700, 800, 900], italique: false },
  'Playfair Display':   { graisses: [400, 500, 600, 700, 800, 900], italique: true },
  'DM Serif Display':   { graisses: [400], italique: true },
  'Fraunces':           { graisses: [100, 200, 300, 400, 500, 600, 700, 800, 900], italique: true },
  'Cormorant Garamond': { graisses: [300, 400, 500, 600, 700], italique: true },
  'Lora':               { graisses: [400, 500, 600, 700], italique: true },
  'Caveat':             { graisses: [400, 500, 600, 700], italique: false },
  'Permanent Marker':   { graisses: [400], italique: false }
};
/* ============================================================
   LES POLICES AJOUTÉES — la bibliothèque de Google Fonts

   Aux 22 polices de base, la personne ajoute celles qu'elle choisit dans la bibliothèque (app/js/
   polices.js), qui montre tout Google Fonts écrit avec son propre texte. Une police ajoutée est
   COMMUNE à tout le studio, comme les DA : IDENTITES/polices-ajoutees.json, avec sa fiche (famille,
   graisses, italique) prise dans le catalogue. Dès lors elle vaut partout : les DA, l'éditeur de
   slide, la page des stories et donc l'export.

   Le catalogue vient de fonts.google.com/metadata/fonts — Google ne le laisse pas lire depuis une
   page, c'est donc le serveur qui le cherche ; il le garde une semaine dans CACHE/, et resert
   l'ancien s'il n'arrive pas à le renouveler (hors ligne, par exemple).
   ============================================================ */

const F_POLICES_AJOUTEES = path.join(DOSSIER_IDENTITES, 'polices-ajoutees.json');
const F_CATALOGUE_POLICES = path.join(DOSSIER_CACHE, 'polices-google.json');
const CATALOGUE_DUREE = 7 * 24 * 3600 * 1000;
const CAT_POLICE = { 'Sans Serif': 's', 'Serif': 'e', 'Display': 'a', 'Handwriting': 'm', 'Monospace': 't' };

/* Gardé en mémoire tant que le fichier ne change pas : pageDeSlide, etatPolices, policePropre… le relisaient
   plusieurs fois par requête, et une grille de 20 slides des dizaines de fois. La date du fichier suffit à voir
   un changement, même fait à la main. Chaque appel reçoit sa propre copie : ajouterPolice la modifie. */
let policesMemo = { date: -1, liste: [] };
function lirePolicesAjoutees() {
  let date = 0;
  try { date = fs.statSync(F_POLICES_AJOUTEES).mtimeMs; } catch (e) { return []; }
  if (date !== policesMemo.date) {
    let l = [];
    try { l = JSON.parse(fs.readFileSync(F_POLICES_AJOUTEES, 'utf8')); } catch (e) { l = []; }
    policesMemo = { date: date, liste: Array.isArray(l) ? l.filter(p => p && p.nom) : [] };
  }
  return policesMemo.liste.map(p => Object.assign({}, p));
}
// La liste des MENUS : les 22 de base, puis les ajoutées que la personne n'a pas retirées.
function policesStudio() {
  return POLICES_BASE.concat(lirePolicesAjoutees().filter(p => !p.masquee).map(p => p.nom).filter(n => !POLICES_BASE.includes(n)));
}
/* Toutes les polices CONNUES, y compris celles retirées des menus : une police retirée reste employée par les
   slides et les DA qui l'ont choisie — la page des slides doit continuer de la charger, et une DA de la garder. */
function policesConnues() {
  return POLICES_BASE.concat(lirePolicesAjoutees().map(p => p.nom).filter(n => !POLICES_BASE.includes(n)));
}
// La fiche d'une police : celle de base, sinon celle rangée à l'ajout.
function infoPolice(f) {
  if (POLICES_INFO[f]) return POLICES_INFO[f];
  const a = lirePolicesAjoutees().find(p => p.nom === f);
  return a ? Object.assign({ graisses: a.graisses, italique: !!a.italique, cat: a.cat }, a.locale ? { locale: true, fichiers: a.fichiers || {} } : {}) : null;
}
function policesInfoStudio() {
  const o = Object.assign({}, POLICES_INFO);
  lirePolicesAjoutees().forEach(p => { o[p.nom] = Object.assign({ graisses: p.graisses, italique: !!p.italique, cat: p.cat }, p.locale ? { locale: true, fichiers: p.fichiers || {} } : {}); });
  return o;
}

/* LES POLICES DE L'ORDINATEUR (30 sept. 2026 : ses carrousels sont en ITC Garamond Book Narrow, une police du
   commerce absente de Google Fonts, qu'il a installée sur son poste) : un fichier .otf / .ttf / .woff / .woff2 rangé
   dans IDENTITES/_polices-locales/ (jamais livré avec le studio : sa licence est celle de la personne), déclaré dans
   polices-ajoutees.json avec « locale: true » et ses fichiers par style (normal, italique). Les slides la chargent par
   @font-face depuis /polices-locales/<fichier> (le Chrome du poste la dessine, à l'aperçu comme à l'export) ; les
   menus, l'éditeur et la DA pareil. */
const DOSSIER_POLICES_LOCALES = path.join(DOSSIER_IDENTITES, '_polices-locales');
const policesLocales = () => lirePolicesAjoutees().filter(p => p.locale && p.fichiers && Object.keys(p.fichiers).length);
const estPoliceLocale = f => policesLocales().some(p => p.nom === f);
function cssPolicesLocales(noms) {
  return policesLocales().filter(p => !noms || noms.includes(p.nom)).map(p => Object.entries(p.fichiers).map(([style, fichier]) =>
    "@font-face{font-family:'" + p.nom.replace(/['\\]/g, '') + "';src:url('/polices-locales/" + encodeURIComponent(fichier) + "');font-style:" +
    (style === 'italique' ? 'italic' : 'normal') + ";font-weight:" + (p.graisses && p.graisses[0] || 400) + ";font-display:block}").join('')).join('');
}
function ajouterPoliceLocale(d) {
  const nom = String(d.nom || '').replace(/[^\p{L}\p{N} .&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!nom) throw new Error('Donnez un nom à cette police.');
  if (POLICES_BASE.includes(nom) || (cataloguePoliceConnue(nom))) throw new Error('« ' + nom + ' » est déjà une police de Google Fonts : ajoutez-la depuis « Plus de polices ».');
  const style = d.style === 'italique' ? 'italique' : 'normal';
  const m = String(d.donnees || '').match(/^data:[^;,]*;base64,(.+)$/);
  if (!m) throw new Error('Fichier de police illisible.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 1000 || buf.length > 12e6) throw new Error('Ce fichier ne ressemble pas à une police (12 Mo au plus).');
  const tete = buf.slice(0, 4).toString('latin1'), ext = tete === 'OTTO' ? '.otf' : tete === 'wOFF' ? '.woff' : tete === 'wOF2' ? '.woff2'
    : (buf.readUInt32BE(0) === 0x00010000 || tete === 'true') ? '.ttf' : null;
  if (!ext) throw new Error('Formats acceptés : .otf, .ttf, .woff, .woff2.');
  fs.mkdirSync(DOSSIER_POLICES_LOCALES, { recursive: true });
  const fichier = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + style + ext;
  fs.writeFileSync(path.join(DOSSIER_POLICES_LOCALES, fichier), buf);
  const l = lirePolicesAjoutees();
  let p = l.find(x => x.nom === nom);
  if (!p) { p = { nom: nom, cat: 's', graisses: [400], italique: false, locale: true, fichiers: {}, ajoutee: new Date().toISOString() }; l.push(p); }
  p.locale = true; p.fichiers = Object.assign({}, p.fichiers || {}, { [style]: fichier }); p.italique = !!p.fichiers.italique; delete p.masquee;
  ecrireJsonSurement(F_POLICES_AJOUTEES, l);
  return etatPolices();
}
// une police du catalogue Google (s'il est en cache) : un nom local ne doit pas la cacher
function cataloguePoliceConnue(nom) {
  try { const c = JSON.parse(fs.readFileSync(F_CATALOGUE_POLICES, 'utf8')); return (c.liste || []).some(f => f[0] === nom); } catch (e) { return false; }
}

async function cataloguePolices() {
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(F_CATALOGUE_POLICES, 'utf8')); } catch (e) {}
  if (cache && Date.now() - new Date(cache.date).getTime() < CATALOGUE_DUREE && Array.isArray(cache.liste)) return cache;
  try {
    const r = await fetch('https://fonts.google.com/metadata/fonts');
    if (!r.ok) throw new Error('Google Fonts répond ' + r.status);
    const t = (await r.text()).replace(/^\)\]\}'\s*/, '');
    const j = JSON.parse(t);
    // L'alphabet latin seulement, sans les polices maison de Google ni les polices d'émojis.
    const liste = (j.familyMetadataList || []).filter(f => (f.subsets || []).includes('latin') && !/^Google Sans|Emoji/.test(f.family) &&
      (!f.primaryScript || f.primaryScript === 'Latn')).map(f => {
      const k = Object.keys(f.fonts || {});
      const g = [...new Set(k.map(x => parseInt(x, 10)).filter(n => !isNaN(n)))].sort((a, b) => a - b);
      return [f.family, CAT_POLICE[f.category] || 's', f.popularity || 9999, g.join(','), k.some(x => /i$/.test(x)) ? 1 : 0, String(f.dateAdded || '').slice(0, 4)];
    }).sort((a, b) => a[2] - b[2]);
    if (!liste.length) throw new Error('catalogue vide');
    const neuf = { date: new Date().toISOString(), liste: liste };
    try { fs.mkdirSync(DOSSIER_CACHE, { recursive: true }); fs.writeFileSync(F_CATALOGUE_POLICES, JSON.stringify(neuf)); } catch (e) {}
    return neuf;
  } catch (e) {
    if (cache && Array.isArray(cache.liste)) return cache;
    throw new Error('Le catalogue de Google Fonts est injoignable (' + (e.message || e) + '). Vérifiez la connexion internet.');
  }
}
async function ajouterPolice(nom) {
  nom = String(nom || '').trim();
  const cat = await cataloguePolices();
  const x = cat.liste.find(f => f[0] === nom);
  if (!x) throw new Error('« ' + nom + ' » n\'est pas dans le catalogue de Google Fonts.');
  const l = lirePolicesAjoutees(), deja = l.find(p => p.nom === nom);
  if (deja && deja.masquee) { delete deja.masquee; ecrireJsonSurement(F_POLICES_AJOUTEES, l); }
  else if (!POLICES_BASE.includes(nom) && !deja) {
    l.push({ nom: nom, cat: x[1], graisses: x[3].split(',').map(Number).filter(Boolean), italique: !!x[4], ajoutee: new Date().toISOString() });
    ecrireJsonSurement(F_POLICES_AJOUTEES, l);
  }
  return etatPolices();
}
// Retirer, c'est MASQUER des menus : les slides et les DA qui l'emploient la gardent (voir policesConnues).
function retirerPolice(nom) {
  const l = lirePolicesAjoutees(), p = l.find(x => x.nom === nom);
  if (p) { p.masquee = true; ecrireJsonSurement(F_POLICES_AJOUTEES, l); }
  return etatPolices();
}
const etatPolices = () => ({ polices: policesStudio(), policesInfo: policesInfoStudio(), policesAjoutees: lirePolicesAjoutees().filter(p => !p.masquee).map(p => p.nom) });

// Le morceau « family=… » d'un lien Google Fonts, qui ne demande QUE les graisses et l'italique existants.
function familleGoogle(f) {
  const i = infoPolice(f) || { graisses: [400, 500, 600, 700, 800], italique: false };
  const nom = 'family=' + encodeURIComponent(f).replace(/%20/g, '+');
  if (i.graisses.length === 1 && !i.italique) return nom;
  if (i.graisses.length === 1) return nom + ':ital@0;1';
  if (!i.italique) return nom + ':wght@' + i.graisses.join(';');
  return nom + ':ital,wght@' + i.graisses.map(g => '0,' + g).concat(i.graisses.map(g => '1,' + g)).join(';');
}

const FORMATS_PUB = {
  carrousel: { l: 1080, h: 1350, ratio: '4:5',  un: 'slide', des: 'slides' },
  stories:   { l: 1080, h: 1920, ratio: '9:16', un: 'story', des: 'stories' }
};
const PUB_SLIDES_MAX = 20;   // la limite d'Instagram pour un carrousel
const PUB_MODELE_MAX = 16;   // les images d'un carrousel donné en exemple
const PUB_MEDIAS_MAX = 24;   // huit images déposées au plus (l'application y veille), plus une illustration par slide

const couleurPropre = (c, defaut) => /^#[0-9a-f]{6}$/i.test(String(c || '').trim()) ? String(c).trim().toLowerCase() : defaut;
const policePropre = (p, defaut) => policesConnues().includes(String(p || '')) ? String(p) : defaut;
const idSimple = x => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(x || ''));

// Le corps JSON d'une requête, avec un plafond.
function corpsJson(req, max) {
  return new Promise((ok, ko) => {
    let corps = '';
    req.on('data', c => { corps += c; if (corps.length > max) { req.destroy(); ko(new Error('Envoi trop lourd.')); } });
    req.on('end', () => { try { ok(corps ? JSON.parse(corps) : {}); } catch (e) { ko(new Error('Requête illisible.')); } });
    req.on('error', ko);
  });
}
function repondreJson(res, code, o) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(o));
}

// Une image reçue en « data: » devient un fichier. Rend son nom, ou lève une erreur lisible.
function ecrireImageRecue(dataUrl, dossier, base) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Image illisible.');
  const ext = TYPES_IMAGE[m[1]];
  if (!ext) throw new Error("Ce format d'image n'est pas accepté. Utilisez du PNG, du JPEG ou du WebP.");
  const data = Buffer.from(m[2], 'base64');
  if (data.length > IMPORT_MAX_OCTETS) throw new Error('Cette image est trop lourde (12 Mo maximum).');
  fs.mkdirSync(dossier, { recursive: true });
  const nom = base + ext;
  fs.writeFileSync(path.join(dossier, nom), data);
  return nom;
}

/* ---------- Les identités ---------- */

/* LES TROIS SOUS-DA (30 sept. 2026 ; maquette LABO/module-da-v2) : une DA = un nom + UNE façon de parler
   (parole, paroleExemples : commune aux trois) + trois sous-DA INDÉPENDANTES — `sous.reel`, `sous.carrousel`, `sous.story`
   (null tant qu'elle n'est pas créée). Chacune a TOUT à elle : couleurs, polices, ton (le style), illustration, logo, visuels,
   fonds, fichier de design, éléments (+ montage pour le Reel ; exemples et apprise pour carrousel et story). Pas de socle,
   pas d'héritage (« je veux pas d'histoire de socle ») : pas de sous-DA = pas de contenu de ce genre avec cette DA.
   Les fichiers restent à plat dans IDENTITES/<id>/ ; deux sous-DA peuvent désigner le même fichier (reprise, copie) : un
   fichier n'est mis à la corbeille que si plus aucune sous-DA ne l'emploie (fichierEmploye).
   Chaque module reçoit SA sous-DA « à plat » (lireDA), sous la forme d'une DA d'avant : { id, nom, parole, paroleExemples,
   genre, couleurs, polices… } — le code des carrousels, des stories et du montage n'a presque pas bougé.
   Une DA d'avant (sans `version: 2`) est reprise à la première lecture : les trois sous-DA reçoivent ses réglages (la DA
   servait aux trois), le montage va au Reel, le fichier de design et les éléments au carrousel et à la story. L'ancienne
   fiche est gardée à côté (identite.json.avant-sous-da). */
const SOUS_DA = ['story'];
const NOMS_SOUS_DA = { story: 'DA Story' };
const sousDA = g => g === 'stories' || g === 'story' ? 'story' : null;
const COULEURS_STUDIO = { fond: '#0b0b0d', texte: '#f2f2f2', accent: '#f97316', second: '#fdba74' };
function sousDepuisAncienne(d, g) {
  const s = { couleurs: Object.assign({}, COULEURS_STUDIO, d.couleurs || {}), polices: Object.assign({ titres: 'Sora', texte: 'Inter' }, d.polices || {}),
    ton: d.ton || '', illustration: d.illustration || '', logo: d.logo || null, visuels: (d.visuels || []).slice(), fonds: Object.assign({}, d.fonds || {}) };
  s.design = d.design || null; s.designNom = d.designNom || null; s.elements = (d.elements || []).map(e => Object.assign({}, e));
  return s;
}
function migrerIdentite(dossier, d) {
  if (d && d.version === 2) return d;
  const n = { version: 2, nom: d.nom, parole: d.parole || '', paroleExemples: d.paroleExemples || '', cree: d.cree || new Date().toISOString(), maj: d.maj || new Date().toISOString(),
    sous: { story: sousDepuisAncienne(d, 'story') } };
  try {
    const f = path.join(dossier, 'identite.json'), garde = f + '.avant-sous-da';
    if (!fs.existsSync(garde)) fs.copyFileSync(f, garde);
    ecrireJsonSurement(f, n);
  } catch (e) { /* lecture seule : la reprise se refera */ }
  return n;
}
function lireIdentite(id) {
  if (!idSimple(id)) return null;
  try {
    const dossier = path.join(DOSSIER_IDENTITES, id);
    const d = migrerIdentite(dossier, JSON.parse(fs.readFileSync(path.join(dossier, 'identite.json'), 'utf8')));
    d.sous = d.sous || {};
    SOUS_DA.forEach(g => { if (!d.sous[g]) d.sous[g] = null; });
    return Object.assign({}, d, { id: id });
  } catch (e) { return null; }
}
// La sous-DA d'un genre, « à plat » comme une DA d'avant — ou null si elle n'existe pas (ce genre est alors fermé).
function daAPlat(d, genre) {
  const g = sousDA(genre), s = d && g && d.sous && d.sous[g];
  if (!s) return null;
  return Object.assign({ couleurs: Object.assign({}, COULEURS_STUDIO), polices: { titres: 'Sora', texte: 'Inter' }, ton: '', illustration: '', logo: null, visuels: [], fonds: {}, elements: [], design: null, designNom: null },
    s, { id: d.id, nom: d.nom, parole: d.parole || '', paroleExemples: d.paroleExemples || '', genre: g, cree: d.cree, maj: d.maj });
}
const lireDA = (id, genre) => id ? daAPlat(lireIdentite(id), genre) : null;
// Un fichier de la DA est-il encore employé par une sous-DA (hors `sauf`) ? Sinon, seulement, il part à la corbeille.
function fichierEmploye(fiche, f, sauf) {
  if (!f) return false;
  return SOUS_DA.some(g => {
    const s = fiche.sous && fiche.sous[g]; if (!s || s === sauf) return false;
    return s.logo === f || s.design === f || (s.visuels || []).includes(f) || Object.values(s.fonds || {}).includes(f) ||
      (s.elements || []).some(e => e.fichier === f || e.origine === f) || (s.exemples || []).includes(f);
  });
}
function ecarterFichierDA(dossier, fiche, f, sauf) {
  if (!f || fichierEmploye(fiche, f, sauf)) return;
  try {
    fs.mkdirSync(path.join(dossier, '_corbeille'), { recursive: true });
    fs.renameSync(path.join(dossier, f), path.join(dossier, '_corbeille', Date.now().toString(36) + '-' + f));
  } catch (e) { /* déjà absent */ }
}
// Lire, modifier, écrire la fiche brute d'une DA (toujours en v2)
function modifierFicheDA(id, fn) {
  const d = lireIdentite(id); if (!d) throw new Error('DA inconnue.');
  const dossier = path.join(DOSSIER_IDENTITES, id), f = path.join(dossier, 'identite.json');
  const fiche = JSON.parse(fs.readFileSync(f, 'utf8'));
  fiche.sous = fiche.sous || {};
  const r = fn(fiche, dossier);
  fiche.maj = new Date().toISOString();
  ecrireJsonSurement(f, fiche);
  return r;
}
function sousExistante(fiche, genre) {
  const g = sousDA(genre);
  if (!g) throw new Error('Genre de DA inconnu.');
  if (!fiche.sous[g]) throw new Error('Cette DA n\'a pas encore de ' + NOMS_SOUS_DA[g] + '.');
  return fiche.sous[g];
}
function lireIdentites() {
  let noms = [];
  try { noms = fs.readdirSync(DOSSIER_IDENTITES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch (e) { return []; }
  return noms.filter(x => !x.startsWith('_')).map(lireIdentite).filter(Boolean)
    .sort((a, b) => String(b.maj || '').localeCompare(String(a.maj || '')));
}

/* LES ÉLÉMENTS DE LA DA (30 sept. 2026 : des patchs brodés, une carte en tissu, un logo) : de
   vraies images de la marque, rangées dans IDENTITES/<id>/element-<eid>.png, avec un nom et « quand l'utiliser » (comme les
   sons). Détourées sur l'ordinateur à l'import si on le demande (l'original est gardé). À la composition d'une slide, Claude
   les reçoit avec leur URL et les pose TELS QUELS (ressourcesPub) ; il ne les redessine jamais. */
const ELEMENTS_MAX = 80;
// `d.sous` : la sous-DA qui reçoit l'élément (le carrousel par défaut)
async function ajouterElementDA(id, d) {
  const g = sousDA(d.sous || 'carrousel');
  const da = lireIdentite(id); if (!da) throw new Error('DA inconnue.');
  if (!g || !da.sous[g]) throw new Error('Cette DA n\'a pas encore de ' + (NOMS_SOUS_DA[g] || 'sous-DA') + '.');
  if ((da.sous[g].elements || []).length >= ELEMENTS_MAX) throw new Error(ELEMENTS_MAX + ' éléments au plus par sous-DA.');
  const m = String(d.donnees || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!m) throw new Error('Importez une image (PNG, JPEG ou WebP).');
  const eid = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const dossier = path.join(DOSSIER_IDENTITES, id), ext = m[1].toLowerCase() === 'png' ? '.png' : m[1].toLowerCase() === 'webp' ? '.webp' : '.jpg';
  const origine = 'element-' + eid + '-origine' + ext;
  fs.writeFileSync(path.join(dossier, origine), Buffer.from(m[2], 'base64'));
  let fichier = origine, detoure = false;
  if (d.detourer) {
    const sortie = 'element-' + eid + '.png';
    try { await detourerEnLocal(path.join(dossier, origine), path.join(dossier, sortie), ['ia', 'uni', 'auto'].includes(d.methode) ? d.methode : 'auto'); fichier = sortie; detoure = true; }
    catch (e) { /* on garde l'original : le détourage se refera */ }
  }
  const el = { id: eid, fichier: fichier, origine: origine, detoure: detoure, nom: String(d.nom || 'élément').trim().slice(0, 60), quand: String(d.quand || '').trim().slice(0, 300), ajoute: new Date().toISOString() };
  modifierFicheDA(id, fiche => { const s = sousExistante(fiche, g); s.elements = (s.elements || []).concat([el]); });
  return { element: el, identite: lireIdentite(id) };
}
function majElementDA(id, eid, d) {
  const g = sousDA(d.sous || 'carrousel');
  modifierFicheDA(id, (fiche, dossier) => {
    const s = sousExistante(fiche, g), el = (s.elements || []).find(x => x.id === eid);
    if (!el) throw new Error('Élément introuvable.');
    if (d.retirer) {
      s.elements = s.elements.filter(x => x.id !== eid);
      [el.fichier, el.origine].filter((x, i, a) => x && a.indexOf(x) === i).forEach(x => ecarterFichierDA(dossier, fiche, x));
    } else {
      if (typeof d.nom === 'string' && d.nom.trim()) el.nom = d.nom.trim().slice(0, 60);
      if (typeof d.quand === 'string') el.quand = d.quand.trim().slice(0, 300);
    }
  });
  return lireIdentite(id);
}
// Les réglages d'une sous-DA, nettoyés ; `ancienne` garde ce que l'éditeur n'envoie pas (fichiers, éléments…)
function sousPropre(d, g, ancienne) {
  const a = ancienne || {}, c = d.couleurs || a.couleurs || {}, p = d.polices || a.polices || {};
  const s = {
    couleurs: { fond: couleurPropre(c.fond, COULEURS_STUDIO.fond), texte: couleurPropre(c.texte, COULEURS_STUDIO.texte),
      accent: couleurPropre(c.accent, COULEURS_STUDIO.accent), second: couleurPropre(c.second, COULEURS_STUDIO.second) },
    polices: { titres: policePropre(p.titres, 'Sora'), texte: policePropre(p.texte, 'Inter') },
    // le style visuel (l'ancien « ton ») et celui des illustrations générées : propres à CETTE sous-DA
    ton: String(d.ton != null ? d.ton : a.ton || '').trim().slice(0, 600),
    illustration: String(d.illustration != null ? d.illustration : a.illustration || '').trim().slice(0, 500),
    logo: a.logo || null, visuels: (a.visuels || []).slice(), fonds: Object.assign({}, a.fonds || {})
  };
  {
    s.design = a.design || null; s.designNom = a.designNom || null;
    s.elements = (a.elements || []).slice();
    // SES GIF (1er oct. 2026) : des ids de la bibliothèque commune — le plan ne propose que ceux-là
    s.gifs = Array.isArray(d.gifs) ? [...new Set(d.gifs.map(String).filter(x => /^g[a-z0-9]+$/.test(x)))].slice(0, 60) : (a.gifs || []).slice();
    if (a.exemples) s.exemples = a.exemples.slice();
    if (a.apprise) s.apprise = a.apprise;
  }
  return s;
}
/* Enregistrer une DA. Le NIVEAU DE LA DA : nom, parole, paroleExemples (communs aux trois sous-DA). Avec `sous`
   (reel | carrousel | story) : les réglages de CETTE sous-DA, créée si elle n'existe pas (couleurs, polices, ton,
   illustration, montage, logo, visuels, fichier de design). `retirerSous` la retire (ses fichiers restent) ; `copierSous:
   { de, vers }` crée une sous-DA par COPIE d'une autre — une fois, sans lien ensuite. */
function enregistrerIdentite(d) {
  d = d || {};
  let id = idSimple(d.id) && lireIdentite(d.id) ? d.id : null;
  const ancienne = id ? lireIdentite(id) : null;
  const nom = String(d.nom != null ? d.nom : (ancienne && ancienne.nom) || '').trim().slice(0, 60);
  if (!nom) throw new Error('Donnez un nom à cette direction artistique.');
  if (!id) {
    id = slugAvatar(nom) || 'da';
    const base = id; let k = 2;
    while (fs.existsSync(path.join(DOSSIER_IDENTITES, id))) id = base + '-' + (k++);
  }
  const dossier = path.join(DOSSIER_IDENTITES, id);
  fs.mkdirSync(dossier, { recursive: true });
  const fiche = ancienne ? JSON.parse(fs.readFileSync(path.join(dossier, 'identite.json'), 'utf8'))
    : { version: 2, sous: { story: null }, cree: new Date().toISOString() };
  fiche.version = 2; fiche.sous = fiche.sous || {};
  fiche.nom = nom;
  // La façon de parler : commune aux trois sous-DA. Gardée si l'éditeur ne l'envoie pas.
  fiche.parole = String(d.parole != null ? d.parole : fiche.parole || '').trim().slice(0, 800);
  // « Tes phrases à toi » (30 sept. 2026) : des textes écrits ou dits par la personne, dont Claude imite la voix
  fiche.paroleExemples = String(d.paroleExemples != null ? d.paroleExemples : fiche.paroleExemples || '').trim().slice(0, 16000);
  fiche.maj = new Date().toISOString();

  const g = sousDA(d.sous);
  if (g && d.retirerSous) {
    const s = fiche.sous[g]; fiche.sous[g] = null;
    if (s) { /* rien n'est effacé : ses fichiers restent dans le dossier de la DA */ }
  } else if (g) {
    const s = sousPropre(d, g, fiche.sous[g]);
    fiche.sous[g] = s;
    // Rien n'est effacé : un fichier retiré part dans la corbeille de la DA — s'il ne sert plus à aucune sous-DA.
    const ecarter = f => ecarterFichierDA(dossier, fiche, f, s);
    if (d.retirerLogo && s.logo) { const f = s.logo; s.logo = null; ecarter(f); }
    if (d.logo && d.logo.donnees) {
      const f = s.logo; s.logo = ecrireImageRecue(d.logo.donnees, dossier, 'logo-' + Date.now().toString(36)); ecarter(f);
    }
    (Array.isArray(d.retirerVisuels) ? d.retirerVisuels : []).forEach(f => {
      const nomF = path.basename(String(f));
      if (s.visuels.includes(nomF)) { s.visuels = s.visuels.filter(x => x !== nomF); ecarter(nomF); }
    });
    (Array.isArray(d.visuels) ? d.visuels : []).forEach((v, i) => {
      if (s.visuels.length >= 8 || !v || !v.donnees) return;
      s.visuels.push(ecrireImageRecue(v.donnees, dossier, 'visuel-' + Date.now().toString(36) + '-' + i));
    });
    // Le fichier de design (carrousel, story) : du texte (HTML, CSS, Markdown, JSON). Il n'est jamais
    // exécuté ni servi : Claude le LIT comme un cahier des charges.
    if (g !== 'reel') {
      if (d.retirerDesign && s.design) { const f = s.design; s.design = null; s.designNom = null; ecarter(f); }
      if (d.design && typeof d.design.texte === 'string' && d.design.texte.trim()) {
        const f = s.design;
        s.design = 'design-' + Date.now().toString(36) + '.txt';
        fs.writeFileSync(path.join(dossier, s.design), d.design.texte.slice(0, 200000), 'utf8');
        s.designNom = String(d.design.nom || 'fichier de design').slice(0, 80);
        ecarter(f);
      }
    }
  }
  ecrireJsonSurement(path.join(dossier, 'identite.json'), fiche);
  return lireIdentite(id);
}

/* ---------- Les FONDS d'une DA (26 sept. 2026) ----------
   Les cartes, les captures et le texte géant des Reels se posent sur deux fonds : `fond` et `fond_accent`. Sans image,
   ce sont des aplats des couleurs de la DA avec un grain (montage.js, fichierStyle) — trop pauvre pour « un fond noir
   texturé façon tissu ». Une DA peut donc garder une IMAGE par fond : importée (gratuit), ou générée une fois (Claude
   écrit le prompt, le prix est annoncé, rien ne part sans accord). `identite.json` → `fonds: { fond: "fond-…png" }`. */
const CLES_FOND = ['fond', 'fond_accent'];
// `sous` : la sous-DA dont on pose le fond (chaque sous-DA a les siens ; le Reel par défaut)
function poserFondDA(id, cle, fichier, sous) {
  if (!lireIdentite(id) || !CLES_FOND.includes(cle)) throw new Error('DA ou fond inconnu.');
  modifierFicheDA(id, (fiche, dossier) => {
    const s = sousExistante(fiche, sous || 'reel');
    s.fonds = s.fonds || {};
    const ancien = s.fonds[cle];
    if (fichier) s.fonds[cle] = fichier; else delete s.fonds[cle];
    // rien n'est effacé : l'ancien fond part dans la corbeille de la DA, s'il ne sert plus ailleurs
    if (ancien && ancien !== fichier) ecarterFichierDA(dossier, fiche, ancien);
  });
  return lireIdentite(id);
}


/* ---------- Les publications ---------- */

const dossierPubs = projet => path.join(dossierProjet(projet), 'PUBLICATIONS');
const dossierPub = (id, projet) => path.join(dossierPubs(projet), id);

function lirePub(id, projet) {
  if (!/^p[a-z0-9]{4,20}$/.test(String(id || ''))) return null;
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dossierPub(id, projet), 'publication.json'), 'utf8'));
    /* Un plan écrit avant les illustrations n'a pas d'identifiant de slide. On lui en donne un
       à la lecture, toujours le même (tiré de la publication et du rang) : l'application le
       renvoie à l'enregistrement suivant, et il devient définitif. */
    if (p.plan && Array.isArray(p.plan.slides)) {
      p.plan.slides.forEach((s, i) => { if (s && !s.id) s.id = 's' + String(id).slice(1, 9) + 'n' + i; });
      // Un plan d'avant le storyboard : ses illustrations et son média deviennent des visuels (voir planPropre).
      if (p.plan.slides.some(s => s && !Array.isArray(s.visuels))) p.plan = planPropre(p.plan, p.genre, p.medias, p.videos);
    }
    return Object.assign({}, p, { id: id });
  } catch (e) { return null; }
}
function ecrirePub(pub, projet) {
  const copie = Object.assign({}, pub, { maj: new Date().toISOString() });
  delete copie.id;
  ecrireJsonSurement(path.join(dossierPub(pub.id, projet), 'publication.json'), copie);
  return lirePub(pub.id, projet);
}
function lireDeck(id, projet) {
  try { return JSON.parse(fs.readFileSync(path.join(dossierPub(id, projet), 'deck.json'), 'utf8')); }
  catch (e) { return null; }
}
function ecrireDeck(id, deck) { ecrireJsonSurement(path.join(dossierPub(id), 'deck.json'), deck); }

function listePubs() {
  let noms = [];
  try { noms = fs.readdirSync(dossierPubs(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch (e) { return []; }
  return noms.filter(x => !x.startsWith('_')).map(x => lirePub(x)).filter(Boolean)
    .map(p => { const x = infoExport(p.id); return Object.assign({}, p, { compose: !!lireDeck(p.id), exporte: x ? x.date : null, projet: projetCourant() }); })
    .sort((a, b) => String(b.maj || '').localeCompare(String(a.maj || '')));
}

/* ------------------------------------------------------------
   LES REELS

   Un carrousel a un dossier à lui (plan, deck, médias, export) ; un reel n'a
   qu'un prompt et des vidéos, et ses vidéos vivent déjà dans RENDUS. Il lui
   manquait seulement une FICHE. Sans elle, un reel n'existait que dans le
   navigateur : l'accueil ne pouvait ni le lister à côté des carrousels, ni le
   dire terminé, et changer de poste ou vider le navigateur l'effaçait.

   D'où un registre unique par projet, REELS/reels.json — pas un dossier par
   reel, il n'aurait rien à contenir.
   ------------------------------------------------------------ */

/* LE STORYBOARD (23 septembre 2026). Une slide porte :
     · sa COULEUR — l'une des quatre de la DA (fond, texte, accent, second) : le fond de la slide, et
       celui des images générées posées dessus ;
     · ses VISUELS — zéro à quatre images, chacune avec sa SOURCE (« gen » : le studio la génère et
       elle coûte ; « mienne » : un média importé, gratuit) et son CADRE (posée, ou en PLEIN CADRE :
       elle devient le fond de la slide, une seule par slide) ;
     · pour une image générée, QUI est dedans (refs : avatar, invité d'après sa photo, packshot, lieu,
       image de la publication) et les figurants, décrits en mots.
   L'identifiant d'un visuel généré le relie à son média (slideId), exactement comme celui d'une slide
   le faisait : une ancienne première illustration garde l'identifiant de sa slide, et son image.

   Les plans d'avant (illustration, fondIllu, refs, media, images) sont repris une fois, à la lecture
   (visuelsAnciens), sans rien perdre : l'illustration devient un visuel généré, le média déposé un
   visuel importé, les images de plus des visuels générés. */
const PUB_VISUELS_MAX = 4;
/* LES FONDS D'UNE SLIDE : les deux fonds de la DA, et eux seuls (27 sept. 2026) —
   « fond » (sa couleur de fond, avec sa texture s'il y en a une) et « accent » (le fond accent). Le studio
   proposait les QUATRE couleurs, texte compris : une DA « fond noir texturé » sortait des slides blanches,
   parce que le blanc de ses textes servait de fond aux slides qui expliquent. Un plan d'avant qui disait
   « texte » ou « second » repasse sur « fond ». Les autres couleurs restent pour les textes, cartes, formes. */
const COULEURS_SLIDE = ['fond', 'accent'];
const ID_VISUEL = /^[sv][a-z0-9]{4,20}$/;
// « invite » : une personne d'après sa photo ; « objet » : un objet d'après sa photo. Les deux vivent dans pub.invites.
const TYPES_REF = ['avatar', 'lieu', 'packshot', 'media', 'invite', 'objet'];
const refsPropres = l => (Array.isArray(l) ? l : []).filter(r => r && TYPES_REF.includes(r.type) &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/.test(String(r.id || ''))).slice(0, 4).map(r => ({ type: r.type, id: String(r.id) }));

function visuelsAnciens(s, medias) {
  const l = [];
  const m = s.media ? (medias || [])[s.media - 1] : null;
  if (String(s.illustration || '').trim()) {
    l.push({ id: s.id, source: 'gen', plein: s.fondIllu === 'plein', illustration: s.illustration,
             refs: Array.isArray(s.refs) && s.refs.length ? s.refs : (s.avatarId ? [{ type: 'avatar', id: s.avatarId }] : []) });
  } else if (m && !m.illustration && m.fichier) {
    l.push({ id: 'v' + String(s.id || '').slice(1) + 'm', source: 'mienne', plein: false, fichier: m.fichier });
  }
  (Array.isArray(s.images) ? s.images : []).forEach(x => {
    if (x && String(x.illustration || '').trim()) l.push({ id: x.id, source: 'gen', plein: false, illustration: x.illustration, refs: x.refs || [] });
  });
  return l;
}

function visuelsPropres(s, medias) {
  const brut = Array.isArray(s && s.visuels) ? s.visuels : visuelsAnciens(s || {}, medias);
  let plein = false;
  return brut.filter(v => v && typeof v === 'object').slice(0, PUB_VISUELS_MAX).map(v => {
    const source = v.source === 'mienne' ? 'mienne' : 'gen';
    const o = { id: ID_VISUEL.test(String(v.id || '')) ? v.id : 'v' + Math.random().toString(36).slice(2, 10), source: source, plein: !!v.plein && !plein };
    if (o.plein) plein = true;                              // une seule image en plein cadre par slide
    if (source === 'gen') {
      o.illustration = String(v.illustration || '').trim().slice(0, 400);
      o.refs = refsPropres(v.refs);
      o.figurants = (Array.isArray(v.figurants) ? v.figurants : []).map(x => String(x || '').trim().slice(0, 120)).filter(Boolean).slice(0, 3);
    } else {
      o.fichier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/.test(String(v.fichier || '')) ? String(v.fichier) : null;
    }
    return o;
  });
}

function planPropre(plan, genre, medias, videos) {
  const slides = (plan && Array.isArray(plan.slides) ? plan.slides : []).slice(0, PUB_SLIDES_MAX).map(s => videoSeule({
    role: String(s && s.role || '').trim().slice(0, 40),
    titre: String(s && s.titre || '').trim().slice(0, 200),
    texte: String(s && s.texte || '').trim().slice(0, 600),
    /* Le numéro de l'image du MODÈLE que cette slide transpose. Écrit par Claude au plan, il sert
       ensuite à la mise en page : la slide K se compose d'après l'image que son plan lui a donnée. */
    modele: Number.isInteger(s && s.modele) && s.modele > 0 ? s.modele : null,
    // Un identifiant stable : les images générées pour cette slide la suivent quand on réordonne le plan.
    id: /^s[a-z0-9]{4,14}$/.test(String(s && s.id || '')) ? s.id : 's' + Math.random().toString(36).slice(2, 10),
    couleur: COULEURS_SLIDE.includes(s && s.couleur) ? s.couleur
           : COULEURS_SLIDE.includes(s && s.fondIllu) ? s.fondIllu : 'fond',
    visuels: visuelsPropres(s, medias),
    // Une slide vidéo (27 sept. 2026) : sa vidéo, et alors aucune image (videoSeule)
    video: videoDeSlide(s && s.video, { videos: videos || [] }),
    // La raison de Claude, en une ligne : montrée sous la slide, pour qu'on corrige au lieu de remplir.
    pourquoi: String(s && s.pourquoi || '').trim().slice(0, 300),
    // Verrouillée : écrite ou validée par la personne. Claude ne la réécrit plus, il accorde les autres à elle.
    verrou: !!(s && s.verrou),
    sticker: genre === 'stories' ? String(s && s.sticker || '').trim().slice(0, 80) : ''
  /* Une slide SANS AUCUN TEXTE est légitime : une image qui parle toute seule, comme dans beaucoup de
     carrousels. Le filtre ne retirait que les slides vides, mais il jetait aussi celles-là — transposer
     un modèle de 14 images en rendait 7, les autres disparaissant en silence (21 septembre 2026). */
  })).filter(s => s.titre || s.texte || s.visuels.length || s.video || s.sticker);
  return { slides: slides, legende: String(plan && plan.legende || '').trim().slice(0, 2200) };
}

const dossierModele = id => path.join(dossierPub(id), 'modele');

/* Les vignettes fabriquées avant la correction du 21 septembre 2026 sont des carrés gris vides, tous
   de la même taille au cliché près. On les écarte une fois pour toutes, au démarrage : elles se
   refabriqueront à la première demande. Rien n'est perdu, une vignette se rejoue en une seconde. */
function oublierVignettesVides() {
  try {
    for (const projet of fs.readdirSync(DOSSIER_PROJETS)) {
      const pubs = path.join(DOSSIER_PROJETS, projet, 'PUBLICATIONS');
      if (!fs.existsSync(pubs)) continue;
      for (const id of fs.readdirSync(pubs)) {
        for (const sous of ['medias', 'modele']) {
          const d = path.join(pubs, id, sous, '_vignettes');
          if (!fs.existsSync(d)) continue;
          for (const f of fs.readdirSync(d)) {
            const p = path.join(d, f);
            try { if (fs.statSync(p).size < 8000) fs.unlinkSync(p); } catch (e) { /* tant pis */ }
          }
        }
      }
    }
  } catch (e) { /* le studio démarre quand même */ }
}
oublierVignettesVides();

const TYPES_DISTRIBUTION = ['avatar', 'packshot', 'lieu'];
function distributionPropre(l) {
  return (Array.isArray(l) ? l : []).filter(r => r && TYPES_DISTRIBUTION.includes(r.type) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/.test(String(r.id || ''))).slice(0, 6).map(r => ({ type: r.type, id: String(r.id) }));
}
// Ce que chaque élément de la distribution apporte, en clair — pour le plan comme pour les prompts.
function distributionEnClair() {
  return [];   // Storymatic : ni avatar, ni packshot, ni lieu
}

/* LA MÉTHODE DU CARROUSEL (30 sept. 2026) :
   SAVOIR/carrousel/methode.md) : l'objectif (le « but » : abonnés, lien, vente), la forme du corps, la cible et la fin
   voulue, choisis à l'étape « Le but », guident le plan ; la méthode elle-même est lue par Claude à chaque plan. */
const FORMES_CARROUSEL = {
  liste: 'une LISTE (« X erreurs / X astuces / X idées ») : une slide par élément, la même mise en page pour tous, le plus impactant en premier',
  guide: 'un GUIDE PAS À PAS : une slide par étape (« Étape 1 : … »), une explication courte et un exemple concret, actionnable',
  nuls: 'un GUIDE POUR LES NULS : une notion compliquée rendue simple — métaphores, exemples du quotidien, une question par slide',
  histoire: 'une HISTOIRE, le voyage du héros (le monde ordinaire, l\'appel de l\'aventure, la quête, la confrontation, la résolution, la morale), dont le héros est la cible ou une cliente'
};
const OBJECTIFS_CARROUSEL = { 'Gagner des abonnés': 'acquisition', 'Créer du lien': 'connexion', 'Vendre': 'conversion' };
function creerOuMajPub(d) {
  const genre = FORMATS_PUB[d.genre] ? d.genre : null;
  let pub = d.id ? lirePub(d.id) : null;
  if (!pub && !genre) throw new Error('Genre de publication inconnu.');
  if (!pub) {
    pub = { id: 'p' + Date.now().toString(36), genre: genre, cree: new Date().toISOString(), medias: [], plan: null };
    fs.mkdirSync(dossierPub(pub.id), { recursive: true });
  }
  if (typeof d.but === 'string') pub.but = d.but.trim().slice(0, 80);
  if (typeof d.sujet === 'string') pub.sujet = d.sujet.trim().slice(0, 4000);
  // la méthode du carrousel (30 sept. 2026) : la forme du corps, la cible, la fin voulue
  if (typeof d.forme === 'string') pub.forme = FORMES_CARROUSEL[d.forme] ? d.forme : '';
  if (typeof d.cible === 'string') pub.cible = d.cible.trim().slice(0, 300);
  if (typeof d.appel === 'string') pub.appel = d.appel.trim().slice(0, 400);
  if ('identiteId' in d) {
    if (d.identiteId && lireIdentite(d.identiteId) && !lireDA(d.identiteId, pub.genre))
      throw new Error('Cette DA n\'a pas encore de ' + NOMS_SOUS_DA[sousDA(pub.genre)] + ' : créez-la dans Vos DA pour l\'utiliser ici.');
    pub.identiteId = lireDA(d.identiteId, pub.genre) ? d.identiteId : null;
  }
  if (Number.isInteger(d.nb)) pub.nb = Math.max(1, Math.min(PUB_SLIDES_MAX, d.nb));
  if (Array.isArray(d.distribution)) pub.distribution = distributionPropre(d.distribution);
  if (d.plan) {
    const avant = signatureVideos(pub.plan);
    pub.plan = planPropre(d.plan, pub.genre, pub.medias, pub.videos);
    // une vidéo recoupée, passée en plein cadre, avec ou sans son : l'export d'avant ne lui correspond plus
    if (signatureVideos(pub.plan) !== avant) pub.aMajExports = true;
  }

  /* LES INVITÉS : une personne qui n'est PAS dans le studio, d'après une simple photo — pas de planche à
     fabriquer. Rangés à part (dossier invites/) : ce ne sont pas des médias à montrer dans les slides,
     seulement des références pour les images générées. Huit au plus. */
  if (Array.isArray(d.invites)) {
    const di = path.join(dossierPub(pub.id), 'invites');
    const gardes = [];
    d.invites.slice(0, 8).forEach((x, i) => {
      if (!x || !/^inv[a-z0-9]{2,16}$/.test(String(x.id || ''))) return;
      const nom = String(x.nom || '').trim().slice(0, 40) || 'Invité';
      const deja = (pub.invites || []).find(y => y.id === x.id);
      if (deja) { gardes.push(Object.assign({}, deja, { nom: nom })); return; }
      const genre = x.genre === 'objet' ? { genre: 'objet' } : {};
      let fichier = null;
      if (x.rendu) {
        /* Un RENDU du studio (une image déjà générée dans ce projet) : copié depuis Rendus, jamais déplacé.
           Seules les images passent — une vidéo ne peut pas servir de référence d'identité. */
        const src = path.join(dossierRendus(), String(x.rendu));
        const ext = path.extname(src).toLowerCase();
        if (!src.startsWith(dossierRendus()) || !EXT_IMAGE.includes(ext) || !fs.existsSync(src)) return;
        fs.mkdirSync(di, { recursive: true });
        fichier = x.id + '-' + Date.now().toString(36) + ext;
        fs.copyFileSync(src, path.join(di, fichier));
      } else if (x.donnees) {
        fichier = ecrireImageRecue(x.donnees, di, x.id + '-' + Date.now().toString(36));
      }
      if (fichier) gardes.push(Object.assign({ id: x.id, nom: nom, fichier: fichier }, genre));
    });
    pub.invites = gardes;
  }
  if (typeof d.titre === 'string' && d.titre.trim()) pub.titre = d.titre.trim().slice(0, 120);
  if (typeof d.modeleFidelite === 'string') pub.modeleFidelite = ['libre', 'charpente', 'fidele'].includes(d.modeleFidelite) ? d.modeleFidelite : 'charpente';

  if (Array.isArray(d.modele)) {
    const dm = dossierModele(pub.id);
    const gardes = [];
    d.modele.slice(0, PUB_MODELE_MAX).forEach((m, i) => {
      if (!m) return;
      const deja = m.fichier && (pub.modele || []).find(x => x.fichier === m.fichier);
      if (deja) { gardes.push(deja); return; }
      if (!m.donnees) return;
      const fichier = ecrireImageRecue(m.donnees, dm, 'x' + Date.now().toString(36) + i);
      if (fichier) gardes.push({ fichier: fichier, nom: String(m.nom || fichier).slice(0, 80) });
    });
    pub.modele = gardes;
  }

  // Les médias à montrer : un rendu du studio (copié) ou une image déposée.
  if (Array.isArray(d.medias)) {
    const dm = path.join(dossierPub(pub.id), 'medias');
    const gardes = [];
    d.medias.slice(0, PUB_MEDIAS_MAX).forEach((m, i) => {
      if (!m) return;
      const deja = m.fichier && (pub.medias || []).find(x => x.fichier === m.fichier || x.avecFond === m.fichier || x.sansFond === m.fichier);
      /* La note d'une ILLUSTRATION est sa description au moment où elle a été générée : c'est elle qu'on
         compare au plan pour savoir si l'image est à refaire. Elle ne se coupe donc pas (une description
         fait jusqu'à 400 caractères) — coupée à 200, toute image un peu décrite passait pour « modifiée ».
         L'application peut aussi la remettre d'accord avec le plan (« Garder cette image »). */
      if (deja) {
        const maj = { note: String(m.note || '').slice(0, deja.illustration ? 400 : 200) };
        // Une image importée se renomme depuis le storyboard : un nom de fichier machinal ne dit rien.
        if (!deja.illustration && typeof m.nom === 'string' && m.nom.trim()) maj.nom = m.nom.trim().slice(0, 80);
        if (deja.illustration && typeof m.refsSig === 'string') maj.refsSig = m.refsSig.slice(0, 600);
        if (deja.illustration && typeof m.cadre === 'string') maj.cadre = m.cadre.slice(0, 12);
        gardes.push(Object.assign({}, deja, maj));
        return;
      }
      const base = 'm' + Date.now().toString(36) + i;
      let fichier = null;
      if (m.rendu) {
        const src = path.join(dossierRendus(), String(m.rendu));
        const ext = path.extname(src).toLowerCase();
        if (!src.startsWith(dossierRendus()) || !EXT_IMAGE.includes(ext) || !fs.existsSync(src)) return;
        fs.mkdirSync(dm, { recursive: true });
        fichier = base + ext;
        fs.copyFileSync(src, path.join(dm, fichier));
      } else if (m.donnees) {
        fichier = ecrireImageRecue(m.donnees, dm, base);
      }
      // « plan » : importée depuis le storyboard, pour une slide précise — elle ne change pas les réponses du parcours.
      if (fichier) gardes.push(Object.assign({ fichier: fichier, nom: String(m.nom || fichier).slice(0, 80), note: String(m.note || '').slice(0, 200) },
                                             m.origine === 'plan' ? { origine: 'plan' } : {}));
    });
    (pub.medias || []).filter(x => x.videoId && !gardes.some(g => g.fichier === x.fichier)).forEach(x => gardes.push(x));
    pub.medias = gardes;
  }
  const majVideos = pub.aMajExports; delete pub.aMajExports;
  const ecrite = ecrirePub(pub);
  if (majVideos) majExports(pub.id);   // l'export suit les réglages des vidéos (voir empreinteDeck)
  return ecrite;
}

/* LA VOIX DE LA PERSONNE (30 sept. 2026) : la façon de parler de la DA et ses
   textes à elle partaient seulement avec les scripts de Reel ; ils partent aussi avec chaque carrousel et chaque story. */
function voixDeLaDA(da) {
  if (!da) return '';
  const p = String(da.parole || '').trim(), ex = String(da.paroleExemples || '').trim();
  if (!p && !ex) return '';
  return 'SA FAÇON DE PARLER — tout le texte (titres, textes, légende) s\'écrit COMME ELLE PARLE, pas comme un rédacteur : ses mots, son registre, ses tournures, ce qu\'elle évite.' +
    (p ? '\n' + p : '') +
    (ex ? '\nDES TEXTES À ELLE (écrits ou dits par elle) — imite leur voix : longueur des phrases, vocabulaire, expressions, tics de langage, ponctuation, humour, langage parlé. Tu n\'en recopies NI les phrases NI les faits (ils parlent d\'autre chose) :\n«««\n' + ex + '\n»»»' : '');
}

// Ce que Claude doit savoir de la publication, commun au plan et à la mise en page.
function contextePub(pub) {
  const F = FORMATS_PUB[pub.genre];
  const projet = lireProjet(projetCourant());
  const da = pub.identiteId ? lireDA(pub.identiteId, pub.genre) : null;
  const l = [];
  l.push('GENRE : ' + (pub.genre === 'stories' ? 'une suite de stories Instagram' : 'un carrousel Instagram') +
         ', format ' + F.ratio + ' (' + F.l + ' × ' + F.h + ' px).');
  if (pub.but) l.push('BUT : ' + pub.but + (OBJECTIFS_CARROUSEL[pub.but] && pub.genre !== 'stories' ? ' (l\'objectif « ' + OBJECTIFS_CARROUSEL[pub.but] + ' » de la méthode)' : '') + '.');
  if (pub.genre !== 'stories' && pub.forme && FORMES_CARROUSEL[pub.forme]) l.push('LA FORME DU CORPS, CHOISIE PAR LA PERSONNE : ' + FORMES_CARROUSEL[pub.forme] + '.');
  if (pub.genre !== 'stories' && pub.cible) l.push('POUR QUI (LA CIBLE) : ' + pub.cible);
  if (pub.sujet) l.push('CE QUE LA PERSONNE VEUT DIRE :\n' + pub.sujet);
  if (pub.genre !== 'stories' && pub.appel) l.push('LA FIN QU\'ELLE VEUT (son appel à l\'action, son cadeau ou son offre — à reprendre tel quel, sans rien y ajouter) : ' + pub.appel);
  if (projet && projet.brief) l.push('DIRECTION DU PROJET (vaut pour tout le projet) :\n' + projet.brief);
  if (da && da.ton) l.push('TON ET STYLE DE LA MARQUE : ' + da.ton);
  if (voixDeLaDA(da)) l.push(voixDeLaDA(da));
  if (da && da.illustration) l.push("STYLE DES ILLUSTRATIONS DE LA MARQUE (appliqué automatiquement à la génération — ne le recopie PAS dans les descriptions) : " + da.illustration);
  const dist = distributionEnClair(pub);
  if (dist.length) l.push('QUI ET QUOI APPARAÎT DANS CETTE PUBLICATION (le studio en a les références : ces personnes et ces objets peuvent être dans les images générées, à l\'identique) :\n' +
    dist.map(x => '  - [' + x.cle + '] ' + x.texte).join('\n'));
  if ((pub.medias || []).some(m => !m.videoId)) {
    l.push('MÉDIAS À MONTRER (numérotés) :\n' + pub.medias.map((m, i) => m.videoId ? '' :
      '  ' + (i + 1) + '. ' + m.nom + (m.note ? ' — ' + m.note : '') + '\n     fichier : ' + path.join(dossierPub(pub.id), 'medias', m.fichier)).filter(Boolean).join('\n'));
  }
  // la bibliothèque de GIF (30 sept. 2026) : des réactions à poser dans une carte GIF
  const gifs = gifsDeDA(da);
  if (gifs.length) l.push('LES GIF (réactions de la bibliothèque, à poser par leur id) :\n' + gifs.map(g => '  - [' + g.id + '] ' + g.nom + (g.quand ? ' — quand : ' + g.quand : '')).join('\n'));
  // les vidéos de la personne (27 sept. 2026) : déposées à l'étape « Qui et quoi » ou dans le plan — Claude peut les placer
  if ((pub.videos || []).length) {
    l.push('VIDÉOS À MONTRER (numérotées) — tu peux regarder leur première image :\n' + pub.videos.map((v, i) =>
      '  ' + (i + 1) + '. ' + v.nom + (v.note ? ' — ' + v.note : '') + ' — ' + Math.round(v.duree) + ' s, ' + (v.h > v.l ? 'en hauteur' : v.h < v.l ? 'en largeur' : 'carrée') +
      '\n     sa première image : ' + path.join(dossierPub(pub.id), 'medias', 'affiche-' + v.id + '.jpg')).join('\n'));
  }
  return { texte: l.join('\n\n'), da: da, F: F };
}

// Les visuels d'une slide, au format que Claude écrit — pour qu'il relise le plan actuel dans sa propre langue.
// une slide vidéo ne porte pas d'image : la vidéo occupe « Ce qu'on y voit » à elle seule
// Storymatic (7 oct. 2026) : une story à carte GIF GARDE sa photo de fond (comme une story de référence)
function videoSeule(s) { if (s.video) s.visuels = s.video.gif ? (s.visuels || []).filter(v => v.plein).slice(0, 1) : []; else delete s.video; return s; }
function visuelsPourClaude(pub, s) {
  return (s.visuels || []).map(v => v.source === 'mienne'
    ? { source: 'media', media: (pub.medias || []).findIndex(m => m.fichier === v.fichier) + 1 || null, plein: v.plein }
    : { source: 'gen', illustration: v.illustration, qui: (v.refs || []).filter(r => !['invite', 'objet', 'media'].includes(r.type)).map(r => r.type + ':' + r.id), plein: v.plein });
}

async function ecrirePlanPub(pub, remarque, accorder) {
  const ctx = contextePub(pub);
  const stories = pub.genre === 'stories';
  /* Les slides verrouillées : la personne les a écrites elle-même. Elles restent mot pour mot, à leur
     place, et ce sont ELLES qui font autorité : les autres se réécrivent pour en découler. Sans
     remarque ni demande d'accord (un plan neuf), il n'y a pas de verrou à respecter. */
  const anciennes = (pub.plan && pub.plan.slides) || [];
  const verrous = (remarque || accorder) ? anciennes.map((s, i) => s.verrou ? i : -1).filter(i => i >= 0) : [];
  const nb = verrous.length ? anciennes.length : (pub.nb || (stories ? 3 : 7));
  const modele = await ressourcesModele(pub, nb);
  let methode = '';
  if (!stories) { try { methode = fs.readFileSync(path.join(RACINE, 'SAVOIR', 'carrousel', 'methode.md'), 'utf8'); } catch (e) {} }
  /* LA CHARTE DE LA MARQUE AU PLAN (30 sept. 2026) : son fichier de design décide aussi de ce que le plan choisit — les fonds
     (« couleur »), les slides signatures (la 1re, la dernière) et le texte qu'elles portent. Seule la composition le lisait :
     le plan posait des fonds accent que la charte proscrit, et une dernière slide sans la signature de la personne. */
  let charte = '';
  if (ctx.da && ctx.da.design && /\.(md|txt|html?|css|json)$/i.test(ctx.da.design)) { try { charte = fs.readFileSync(path.join(DOSSIER_IDENTITES, ctx.da.id, ctx.da.design), 'utf8').slice(0, 20000); } catch (e) {} }
  const consigne = [
    'Tu es concepteur-rédacteur pour les réseaux sociaux. Tu écris le PLAN d\'' +
      (stories ? 'une suite de stories Instagram' : 'un carrousel Instagram') + ', en français, dans la langue et le registre de la personne.',
    '',
    'Règles :',
    stories
      ? (pub.sansGen
        /* Storymatic (7 oct. 2026) : la grammaire d'une story de référence —
           un titre-question, l'encadré qui enfonce le clou, puis la punchline en grand. */
        ? (PROFIL.lire().recette || PROFIL.RECETTE_DEFAUT)
        : '- Une story = UNE idée, lue en 3 secondes : un titre de 3 à 8 mots, et au plus une phrase courte de texte.')
      : methode
        ? '- Tu suis LA MÉTHODE DU CARROUSEL (plus bas). Slide 1 = l\'accroche : son TITRE fait 10 mots au plus et dit le sujet, la cible et le problème ; le complément court (un aparté, un contexte) va dans « texte ». Slide 2 = la deuxième chance : « titre » = l\'accroche reformulée (pas répétée), « texte » = le contexte puis le teasing, en deux ou trois petits blocs séparés par \\n. Puis le corps, dans la forme choisie (sinon la plus juste pour ce sujet) : une idée par slide, un titre court, un texte d\'une à trois phrases courtes ou une liste courte (lignes séparées par \\n). La dernière = la slide finale de la méthode.'
        : '- Une slide = UNE idée. Titre de 3 à 9 mots. Texte : une à trois phrases courtes, jamais un paragraphe.',
    stories
      ? '- La première arrête le pouce. La dernière porte l\'appel à l\'action adapté au but.'
      : methode
        ? '- La dernière slide : la morale ou le message, puis l\'appel qui suit l\'OBJECTIF (acquisition : s\'abonner, enregistrer, le cadeau ; connexion : un commentaire, un message ; conversion : un message privé, le mot à commenter, l\'offre). Si la personne a écrit LA FIN QU\'ELLE VEUT, c\'est elle, telle quelle. Sinon : s\'abonner, enregistrer, et une question qui se répond d\'un mot ou d\'un choix — jamais un cadeau, un mot à commenter ou une offre qu\'elle n\'a pas donnés, jamais une question trop ouverte.'
        : '- La slide 1 est l\'accroche : elle arrête le pouce et promet quelque chose de précis. La dernière porte l\'appel à l\'action adapté au but (vendre, s\'abonner, enregistrer, commenter…).',
    '- Ici RIEN ne se génère : tu n\'appelles aucun outil de génération, tu ne dépenses aucun crédit. Tu lis (Read) et tu écris, c\'est tout.',
    '- Du concret, pas de formule creuse.',
    methode
      ? '- CE QUE TU APPORTES — le texte de la personne est son BRIEF, pas le script : tu ne le découpes pas en slides, tu le DÉVELOPPES en un contenu qui a de la valeur. Tu expliques le comment et le pourquoi, tu donnes des conseils concrets et actionnables, les erreurs à éviter, des exemples parlants, des métaphores, et les situations, pensées et émotions que vit la cible (effet miroir). Chaque slide du corps apprend ou fait ressentir quelque chose que son texte ne disait pas. Tu restes dans son sujet, son message, son point de vue et son registre ; ses phrases fortes, tu peux les garder.\n' +
        '- CE QUE TU N\'INVENTES JAMAIS — les FAITS sur la personne et son activité : un chiffre, un montant, un revenu, un résultat, une durée, une date, un prix, un nom, un client, un témoignage, un événement de sa vie, une offre, un cadeau. Ceux-là viennent de son texte, tels quels. Ce que tu ajoutes se présente comme un conseil (« commence par… »), un exemple (« par exemple », « imagine ») ou ce que vit la cible (« tu te lèves… »), JAMAIS comme ce qu\'elle a fait, vécu ou obtenu. Pas de promesse chiffrée ni de résultat garanti. Cette publication sort sous son nom : une invention la ferait mentir.'
      : '- AUCUN FAIT INVENTÉ. Tout chiffre, durée (« trois ans », « en deux jours »), date, prix, nom, résultat, promesse ou témoignage doit figurer mot pour mot dans ce que la personne a écrit. Un fait qui te manque ne s\'écrit pas : tourne la phrase sans lui. Cette publication sort sous le nom de la personne : une invention la ferait mentir.',
    '- « role » nomme la fonction de la slide en un ou deux mots (Accroche, Problème, Étape 1, Preuve, Appel…).',
    '- Si des médias sont fournis, ouvre-les avec l\'outil Read et place chacun dans la slide où il sert le mieux, comme un visuel {"source":"media","media":<son numéro>,"plein":false}.',
    modele ? '- Quand un MODÈLE est donné (plus bas), c\'est lui qui décide du déroulé ET de quelles slides portent une image : une slide du modèle qui repose sur une photo se transpose en une slide avec un visuel, une photo qui remplit toute la slide en un visuel « plein », et une slide du modèle qui montre PLUSIEURS photos en une slide à plusieurs visuels.' : '',
    "- « couleur » : le FOND de la slide, et il n'en existe que DEUX, ceux de la DA : \"fond\" (" + ((ctx.da && ctx.da.couleurs) || {}).fond + (ctx.da && ctx.da.fonds && ctx.da.fonds.fond ? ", sa texture" : "") + ") ou \"accent\" (le fond accent, " + ((ctx.da && ctx.da.couleurs) || {}).accent + (ctx.da && ctx.da.fonds && ctx.da.fonds.fond_accent ? ", sa texture" : "") + "). Aucune autre valeur : ni \"texte\", ni \"second\" — la couleur des textes n'est JAMAIS un fond de slide. Le fond porte les slides qui expliquent ; l'accent, les slides d'impact (l'accroche, une rupture, l'appel), assez rares pour qu'elles frappent. Une slide dont un visuel est en plein cadre garde une couleur, mais elle ne se verra pas.",
    pub.sansGen ? "- AUCUNE IMAGE À GÉNÉRER dans cette publication : les seules images sont les MÉDIAS FOURNIS (les photos du quotidien de la banque, les captures de la personne). Chacun se place UNE fois, sur la story où il sert le mieux, en {\"source\":\"media\",\"media\":<son numéro>,\"plein\":…} ; une photo du quotidien se met TOUJOURS en plein cadre (\"plein\":true : elle devient le fond de la story), une capture reste posée. Les autres stories sont en texte seul. N'écris JAMAIS de visuel « gen »." : '',
    "- « visuels » : les IMAGES de la slide, de zéro à quatre. Tableau vide : la slide est en texte seul, et c'est souvent le mieux. Deux sortes :",
    "    · une image à GÉNÉRER : {\"source\":\"gen\",\"illustration\":\"<une phrase>\",\"qui\":[…],\"plein\":false}. Le studio peut générer ce que du texte et des formes ne savent pas montrer : un objet, une scène, une métaphore visuelle. Décris-la en une phrase concrète : ce qu'elle montre, l'action, la pose, le cadrage, l'objet, l'humeur. Chaque image montre l'idée de SA slide : jamais deux fois la même description. Une personne de la distribution se désigne par son PRÉNOM (« Prénom, assise de trois-quarts, … ») : ne décris ni son visage, ni son corps, ni ses cheveux, ni sa tenue — sa planche d'identité les porte ; ne cite une tenue que si cette slide en exige une autre que la sienne. Le style des illustrations de la marque s'applique tout seul : ne le recopie pas. N'écris AUCUNE couleur de fond : elle vient de « couleur » — sauf pour un objet qui porte le sien (une photo, un polaroïd, un écran). Pas de texte dans l'image, pas de logo.",
    "    · un média FOURNI : {\"source\":\"media\",\"media\":<son numéro>,\"plein\":false}.",
    "  « plein » : true quand l'image REMPLIT toute la slide et que le texte se pose dessus — une photo d'accroche forte, une scène. Une seule par slide ; les autres restent posées. Plusieurs visuels sur une même slide : seulement quand c'est l'idée même (un moodboard, un avant/après, une série, les étapes d'un geste) — une ou deux slides par publication au plus. Vise une slide sur deux au plus avec une image générée, l'accroche en priorité : chaque image générée coûte des crédits.",
    "- « qui » : pour chaque image à générer, les clés — entre crochets dans « QUI ET QUOI APPARAÎT », par exemple \"avatar:lea\" — de ce qui se voit DANS cette image : la personne, le produit, le lieu. Rien qui ne soit dans la liste. Un tableau VIDE dit « personne, aucun produit » : c'est une vraie réponse, respectée telle quelle. Une image qui nomme une personne l'a dans « qui ».",
    "- « pourquoi » : une ligne, en français, adressée à la personne : pourquoi cette couleur et ces images (« Photo en plein cadre pour arrêter le pouce », « Texte seul sur l'accent : la phrase suffit, et l'orange casse le rythme »).",
    "- Une slide du PLAN ACTUEL qui porte « video » montre une VIDÉO choisie par la personne : elle garde sa place, tu lui laisses « visuels » VIDE, et tu lui écris un titre court qui accompagne ce qu'on voit — la vidéo parle d'elle-même.",
    (pub.videos || []).length ? "- « video » : si des VIDÉOS À MONTRER sont fournies, regarde leur première image (Read) et pose CHACUNE sur la slide où elle sert le mieux : \"video\":{\"numero\":<son numéro>,\"plein\":false} — « plein » : true si elle remplit la slide et que le texte se pose dessus. Une seule vidéo par slide, et cette slide n'a alors AUCUN visuel. Une vidéo ne se répète pas." : '',
    (gifsDeDA(ctx.da).length || cleGiphy()) ? (cleGiphy()
      ? "- « gif » : une slide peut porter UN GIF de réaction quand il sert la phrase — la cible qui se reconnaît, une vanne, un choc. Deux façons : " +
        (gifsDeDA(ctx.da).length ? "un GIF de la bibliothèque (plus bas, « LES GIF »), SEULEMENT si son « quand » colle exactement à la phrase, et UN OU DEUX par " + (stories ? 'suite' : 'carrousel') + " au plus : \"gif\":{\"id\":\"<son id>\",\"nom\":\"<qui réagit>\"} ; PAR DÉFAUT " : '') +
        "une recherche GIPHY (des millions de GIF : c'est elle qui trouve la réaction juste) — le studio cherche et choisit en regardant : \"gif\":{\"chercher\":\"<2 à 4 mots EN ANGLAIS : la réaction ou la scène que la phrase appelle>\",\"nom\":\"<qui réagit : Toi, Moi, MoiEnCeMoment, MoiDevantLordi…>\"}. " +
        "« chercher » décrit l'ÉMOTION ou la situation avec les mots COURANTS des tags GIPHY (1 à 3 mots, ceux qu'un Américain taperait), jamais le sujet technique (pas « CapCut », pas « AI », pas « Instagram ») : « exhausted », « facepalm », « mind blown », « so tired », « make it rain », « waiting », « proud », « nervous laugh », « deal with it », « mic drop ». Deux slides n'ont jamais les mêmes mots. "
      : "- « gif » : une slide peut porter UN GIF de réaction de la bibliothèque (plus bas, « LES GIF ») quand il sert la phrase — la cible qui se reconnaît, une vanne, un choc : \"gif\":{\"id\":\"<son id>\",\"nom\":\"<qui réagit : Toi, Moi, MoiEnCeMoment, MoiDevantLordi…>\"}. Choisis-le par son « quand ». ") + (pub.sansGen
      ? (PROFIL.lire().gifChaqueStory
        ? "Ici : une carte GIF sur CHAQUE story, la 1 comprise, sauf celle qui montre une capture ; jamais deux fois le même GIF dans la suite. Une story à GIF GARDE sa photo de fond si elle en a une (son visuel « plein ») et n'a pas d'autre image."
        : "Deux GIF par suite au plus, jamais deux fois le même. Une story à GIF GARDE sa photo de fond si elle en a une (son visuel « plein ») et n'a pas d'autre image.")
      : "Deux ou trois GIF par " + (stories ? 'suite' : 'carrousel') + " au plus, jamais deux fois le même, et pas sur la slide 1. Une slide avec un GIF garde « visuels » VIDE.") : '',
    stories ? '- « sticker » : si un sticker Instagram sert l\'idée (sondage, question, lien, compte à rebours), nomme-le en quelques mots ; sinon chaîne vide.' : '',
    stories ? '' : methode
      ? '- « legende » : la légende du post, construite comme « 5. La légende » de la méthode — la première ligne en CAPITALES qui donne envie d\'ouvrir (avec 👇), le contexte en une ou deux lignes, le message (quelques lignes ou une liste courte), l\'appel (le même que la dernière slide), 5 à 8 hashtags, puis une ligne de mots-clés séparés par « - » (ceux du domaine, du sujet et de la cible). Les lignes se séparent par \\n. Pas de répétition, pas de phrase générique.'
      : '- « legende » : la légende du post, 3 à 6 lignes, avec un appel à l\'action et 5 à 8 hashtags pertinents.',
    '',
    charte ? '\n# LA CHARTE DE LA MARQUE (son fichier de design) — elle PRIME sur les règles générales pour ce que le plan choisit : les fonds (« couleur »), la place des GIF, ce que portent la slide 1 et la dernière slide (écris dans leur « texte » les éléments qu\'elle y demande : l\'étiquette et la phrase du dossier, la signature de fin…). La mise en page suivra la même charte.\n\n' + charte + '\n' : '',
    methode ? '\n# LA MÉTHODE DU CARROUSEL\n\n' + methode + '\n\nQuand un MODÈLE est donné, son déroulé prime ; la méthode règle alors l\'écriture de chaque slide et de la légende. La règle sur les FAITS passe avant la méthode : les exemples de la méthode (leurs chiffres, leurs clientes, leurs résultats) ne sont jamais des faits de la personne.\n' : '',
    'Tu réponds UNIQUEMENT du JSON strict, sur une seule ligne, sans bloc de code :',
    '{"titre":"<nom court de la publication>","slides":[{"role":"…","titre":"…","texte":"…","couleur":"fond","visuels":[],"pourquoi":"…"' + (modele ? ',"modele":<numéro de la slide du modèle transposée>' : '') + (stories ? ',"sticker":""' : '') + '}],"legende":"' + (stories ? '' : '…') + '"}'
  ].filter(x => x !== '').join('\n');

  const question = [
    ctx.texte,
    '',
    modele ? modele + '\n' : '',
    'NOMBRE DE ' + ctx.F.des.toUpperCase() + ' : exactement ' + nb + '.',
    pub.plan && (remarque || accorder) ? 'LE PLAN ACTUEL :\n' + JSON.stringify({ slides: anciennes.map((s, i) => ({ n: i + 1, VERROUILLEE: !!s.verrou, role: s.role, titre: s.titre, texte: s.texte, couleur: s.couleur, visuels: visuelsPourClaude(pub, s), video: s.video ? (s.video.plein ? 'en plein cadre' : 'posée') : undefined })), legende: pub.plan.legende }) : '',
    verrous.length ? 'SLIDES VERROUILLÉES : ' + verrous.map(i => i + 1).join(', ') + '. La personne les a écrites ELLE-MÊME : tu les rends MOT POUR MOT, à la même place, sans corriger ni reformuler. Ce sont elles qui font autorité. Tu RÉÉCRIS toutes les autres pour qu\'elles en découlent : elles tiennent la promesse de l\'accroche telle qu\'elle est écrite maintenant, dans le même registre (tutoiement ou vouvoiement, niveau de langue, vocabulaire, énergie), sans répéter ce que les slides verrouillées disent déjà. Leurs illustrations suivent aussi : même univers visuel que celles des slides verrouillées. La légende du post se réaccorde de même.' : '',
    remarque ? 'CE QUE LA PERSONNE DEMANDE DE CHANGER :\n' + remarque : '',
    '',
    'Écris le plan.'
  ].filter(Boolean).join('\n');

  const r = await interroger(question, consigne, null, 1, DELAI_MAX);
  const bloc = premierObjetJson(r.texte || '');
  if (!bloc) throw new Error("Claude n'a pas rendu de plan lisible. Réessayez.");
  let brut;
  try { brut = JSON.parse(bloc); } catch (e) { throw new Error("Le plan reçu est illisible : " + e.message); }

  /* Le nombre de slides est celui que la personne a choisi, pas celui que Claude juge suffisant :
     quand il ne l'a pas respecté, on le lui redit une fois, avec son propre plan sous les yeux.
     Une seule reprise — au-delà, on garde ce qu'il a rendu plutôt que de faire attendre. */
  if (Array.isArray(brut.slides) && brut.slides.length !== nb) {
    const eu = brut.slides.length;
    const rattrapage = [
      'Tu viens de rendre ' + eu + ' ' + ctx.F.des + ' alors qu\'il en faut EXACTEMENT ' + nb + '.',
      eu < nb
        ? 'Reprends ton plan et porte-le à ' + nb + ' : tu gardes tes ' + eu + ' ' + ctx.F.des + ' telles quelles, dans le même ordre, et tu en ajoutes ' + (nb - eu) + ' à leur place dans le déroulé' + (modele ? ', en suivant le modèle image par image — les répétitions du modèle en sont, elles ne se fondent pas' : '') + '.'
        : 'Reprends ton plan et ramène-le à ' + nb + ' : tu gardes la première et la dernière, et tu fonds ou retires les ' + (eu - nb) + ' qui répètent le plus.',
      '',
      'TON PLAN ACTUEL :',
      JSON.stringify(brut),
      '',
      'Tu rends le plan COMPLET, au même format JSON, avec exactement ' + nb + ' ' + ctx.F.des + '.'
    ].join('\n');
    try {
      const r2 = await interroger(rattrapage, consigne, null, 1, DELAI_MAX);
      const b2 = premierObjetJson(r2.texte || '');
      const p2 = b2 && JSON.parse(b2);
      if (p2 && Array.isArray(p2.slides) && Math.abs(p2.slides.length - nb) < Math.abs(eu - nb)) brut = p2;
    } catch (e) { /* on garde le premier plan : il vaut mieux qu'une erreur */ }
  }

  /* Les visuels rendus par Claude deviennent ceux du studio. « qui » est respecté TEL QUEL : un tableau
     vide veut dire « personne » — la distribution n'est plus ajoutée d'office (le 22 septembre 2026, Prune
     se retrouvait dans une image de carnet où Claude n'avait mis personne). Seul filet : une image qui
     NOMME un avatar de la distribution reçoit sa planche, sans quoi son visage serait inventé. */
  const cles = distributionEnClair(pub), marquesDist = {};
  const sansAccent = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const refsDe = v => {
    const lues = (Array.isArray(v.qui) ? v.qui : Array.isArray(v.refs) ? v.refs : []).map(x => String(x && x.cle || (x && x.type ? x.type + ':' + x.id : x) || ''))
      .filter(c => cles.some(y => y.cle === c)).map(c => ({ type: c.slice(0, c.indexOf(':')), id: c.slice(c.indexOf(':') + 1) }));
    (pub.distribution || []).filter(r => r.type === 'avatar').forEach(r => {
      const a = marquesDist[r.id];
      if (a && new RegExp('\\b' + sansAccent(a.nom) + '\\b').test(sansAccent(v.illustration)) && !lues.some(x => x.type === 'avatar' && x.id === r.id)) lues.unshift({ type: 'avatar', id: r.id });
    });
    return lues.slice(0, 4);
  };
  (brut.slides || []).forEach(s => {
    if (!s) return;
    s.visuels = (Array.isArray(s.visuels) ? s.visuels : []).map(v => {
      if (!v || typeof v !== 'object') return null;
      if (v.source === 'media' || (v.media && v.source !== 'gen')) {
        const m = (pub.medias || [])[Number(v.media) - 1];
        return m && m.fichier && !m.illustration ? { source: 'mienne', plein: !!v.plein, fichier: m.fichier } : null;
      }
      if (!String(v.illustration || '').trim() || pub.sansGen) return null;
      return { source: 'gen', plein: !!v.plein, illustration: v.illustration, refs: refsDe(v), figurants: [] };
    }).filter(Boolean).slice(0, PUB_VISUELS_MAX);
  });

  /* Place pour place, un visuel garde l'identifiant du visuel d'avant de même source : c'est lui qui le
     relie à son image générée. Une image DÉJÀ générée (et payée) garde sa description, ses références et
     son cadre — les réécrire la rendrait « à refaire ». Une image que la personne a IMPORTÉE reste sur sa
     slide même si Claude ne l'a pas reprise : elle l'y a mise exprès. */
  const payee = v => v && v.source === 'gen' && String(v.illustration || '').trim() && (pub.medias || []).some(m => m.illustration && m.slideId === v.id);
  (brut.slides || []).forEach((s, i) => {
    const avant = anciennes[i];
    if (!s || !avant) return;
    s.id = avant.id;
    const vieux = avant.visuels || [], neufs = s.visuels || [], garde = [];
    for (let j = 0; j < Math.max(vieux.length, neufs.length) && garde.length < PUB_VISUELS_MAX; j++) {
      const v = vieux[j], nv = neufs[j];
      if (payee(v)) garde.push(v);
      else if (nv) garde.push(Object.assign({}, nv, v && v.source === nv.source ? { id: v.id } : {}));
    }
    vieux.filter(v => v.source === 'mienne' && v.fichier && !garde.some(x => x.fichier === v.fichier))
      .forEach(v => { if (garde.length < PUB_VISUELS_MAX) garde.push(v); });
    if (garde.filter(v => v.plein).length > 1) garde.forEach((v, k) => { if (k !== garde.findIndex(x => x.plein)) v.plein = false; });
    s.visuels = garde;
  });
  // Les GIF que Claude a posés (« gif » : { id, nom }) deviennent des vidéos de la publication, dans leur carte (30 sept. 2026)
  const gifsLib = gifsDeDA(ctx.da);
  // « gif.chercher » : le studio cherche sur GIPHY et Claude choisit en regardant (choisirGifsGiphy) ; sinon le GIF de la bibliothèque
  const aChercher = cleGiphy() ? (brut.slides || []).map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s && s.gif && typeof s.gif === 'object' && String(s.gif.chercher || '').trim() && !(anciennes[i] && anciennes[i].video)) : [];
  let deGiphy = {};
  if (aChercher.length) {
    try { deGiphy = await choisirGifsGiphy(pub, ctx.F, aChercher.map(({ s, i }) => ({ n: i + 1, chercher: String(s.gif.chercher).trim().slice(0, 60), nom: String(s.gif.nom || 'Toi').slice(0, 40),
      titre: String(s.titre || '').slice(0, 200), texte: String(s.texte || '').slice(0, 400) }))); } catch (e) { deGiphy = {}; }
  }
  for (let i = 0; i < (brut.slides || []).length; i++) {
    const s = brut.slides[i], avant = anciennes[i];
    if (!s || !s.gif || (avant && avant.video)) { if (s) delete s.gif; continue; }
    const gy = deGiphy[i + 1];
    const g = (gy && lireGifs().find(x => x.id === gy.id)) || gifsLib.find(x => x.id === String(s.gif.id || s.gif));
    if (g) {
      try { const r = await ajouterVideoPub(pub, { gif: g.id }); pub.videos = r.pub.videos; pub.medias = r.pub.medias;
        s.video = { id: r.video.id, de: 0, a: r.video.a, plein: false, son: false, forme: 'video', gif: String(s.gif.nom || 'Toi') }; s.visuels = (s.visuels || []).filter(v => v.plein).slice(0, 1);
        if (gy && gy.id === g.id) s.video.recherche = gy.recherche; }
      catch (e) { /* le GIF n'a pas pu être posé : la slide reste sans */ }
    }
    delete s.gif;
  }
  // Une vidéo choisie par la personne reste sur sa slide, comme une image qu'elle a importée : Claude n'en décide pas.
  // Claude a pu poser une vidéo de la personne ({ numero, plein }) sur une slide qui n'en avait pas : elle part sur ses 15 premières secondes
  (brut.slides || []).forEach((s, i) => {
    const avant = anciennes[i];
    if (!s) return;
    if (avant && avant.video) { s.video = avant.video; s.visuels = []; return; }
    const n = s.video && typeof s.video === 'object' ? Number(s.video.numero) : Number(s.video), v = (pub.videos || [])[n - 1];
    if (s.video && s.video.gif && (pub.videos || []).some(x => x.id === s.video.id)) return;   // un GIF posé juste au-dessus
    if (v) { s.video = { id: v.id, de: 0, a: Math.min(v.duree, VIDEO_DUREE_DEFAUT), plein: !!(s.video && s.video.plein), son: false, forme: 'libre' }; s.visuels = []; }
    else delete s.video;
  });
  // Les verrous ne reposent pas sur la bonne volonté du modèle : les slides verrouillées sont remises telles quelles.
  verrous.forEach(i => { if (brut.slides && anciennes[i]) brut.slides[i] = Object.assign({}, anciennes[i]); });
  const plan = planPropre(brut, pub.genre, pub.medias, pub.videos);
  if (!plan.slides.length) throw new Error("Le plan reçu est vide. Réessayez en précisant ce que vous voulez dire.");
  /* Claude a pu mettre une minute : ce qui a changé entre-temps (un média ajouté, un détourage) est gardé.
     On ne remplace que le plan et, s'il manquait, le titre. */
  const frais = lirePub(pub.id) || pub;
  frais.plan = plan;
  if (!frais.titre && brut.titre) frais.titre = String(brut.titre).slice(0, 120);
  return ecrirePub(frais);
}

/* Ce que Claude écrit est affiché dans le studio : on n'y laisse passer ni
   script, ni gestionnaire d'événement, ni ressource venue d'ailleurs. La
   page qui sert les slides porte en plus une politique qui interdit tout
   script — deux verrous plutôt qu'un. */
function htmlSur(h) {
  return String(h || '')
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form|input|button)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '');
}
function cssSur(c) {
  return String(c || '')
    .replace(/@import[^;]*;/gi, '')
    .replace(/url\(\s*(['"]?)\s*(https?:)?\/\/[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/<\/?style[^>]*>/gi, '');
}
function decouperDeck(texte) {
  const css = [];
  String(texte).replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, c) => { css.push(c); return ''; });
  const sections = String(texte).match(/<section\b[^>]*\bslide\b[^>]*>[\s\S]*?<\/section>/gi) || [];
  return { css: cssSur(css.join('\n')), slides: sections.map(htmlSur) };
}

function consigneMiseEnPage(pub, ctx, N, avecModele) {
  const F = ctx.F, da = ctx.da, stories = pub.genre === 'stories';
  const marge = stories ? 80 : 90;
  const c = (da && da.couleurs) || { fond: '#0b0b0d', texte: '#f2f2f2', accent: '#f97316', second: '#fdba74' };
  const p = (da && da.polices) || { titres: 'Sora', texte: 'Inter' };
  return [
    'Tu es directeur artistique et intégrateur HTML/CSS. Tu fabriques les ' + N + ' ' + F.des + ' d\'une publication Instagram, en HTML et CSS purs, à partir d\'un plan déjà validé et d\'une direction artistique (DA).',
    '',
    'FORMAT DE SORTIE — strict :',
    '1. Un seul bloc <style>…</style>, puis exactement ' + N + ' blocs <section class="slide" data-n="K">…</section>, K de 1 à ' + N + ', dans l\'ordre. Rien d\'autre : pas de <html>, pas de <body>, pas de commentaire, pas de bloc de code Markdown, pas de <section> imbriquée.',
    '2. Chaque .slide mesure exactement ' + F.l + ' × ' + F.h + ' px. Le studio pose déjà : .slide{width:' + F.l + 'px;height:' + F.h + 'px;position:relative;overflow:hidden;box-sizing:border-box;margin:0}. Tout ton CSS est préfixé par .slide. Toutes les tailles sont en px.',
    '3. Interdits : <script>, <link>, <iframe>, @import, url() vers Internet, toute image autre que celles listées, attributs on*, animations, position:fixed.',
    '4. Les polices sont déjà chargées : « ' + p.titres + ' » pour les titres, « ' + p.texte + ' » pour le texte. N\'en emploie aucune autre.',
    '',
    'Ici RIEN ne se génère : tu n\'appelles aucun outil de génération, tu ne dépenses aucun crédit. Tu lis (Read) et tu écris, c\'est tout.',
    '',
    'LE TEXTE : tu reprends les textes du plan MOT POUR MOT (titre et texte). Tu ne réécris rien, tu n\'ajoutes aucune phrase, tu ne corriges rien. Tu peux mettre en valeur un ou deux mots d\'un titre (couleur d\'accent, surlignage) avec un <span>. Le rôle d\'une slide (Accroche, Étape 1…) ne s\'affiche pas, sauf s\'il sert de sur-titre discret.',
    '',
    'LES TITRES SUR PLUSIEURS LIGNES : une police condensée en capitales tolère un interligne serré, mais JAMAIS en dessous de 1.02 ; et dès qu\'un mot est surligné (un fond de couleur derrière lui), l\'interligne du titre passe à 1.15 au moins et le mot surligné est en display:inline-block avec un padding vertical de 0.04em au plus : un surlignage ne recouvre JAMAIS la ligne du dessus ni celle du dessous.',
    '',
    'LA LISIBILITÉ (lu sur un téléphone) : titres d\'au moins 72px, texte courant d\'au moins 38px, contraste fort.',
    '',
    'LA GÉOMÉTRIE — la règle la plus importante de toutes. Une slide est une pile de boîtes posées en',
    'position:absolute : si tu ne calcules pas leurs bords, elles se recouvrent, et le studio te rend une',
    'slide illisible. Tu procèdes donc ainsi, pour CHAQUE slide, AVANT d\'écrire son CSS :',
    '',
    '1. TU DÉCOUPES LA HAUTEUR EN BANDES qui ne se touchent pas. La slide fait ' + F.h + 'px de haut. Tu écris,',
    '   en clair, la bande de chaque bloc : par exemple image 230→890, titre 940→1120, texte 1150→1250.',
    '   La bande d\'un bloc commence après la fin du précédent. DEUX BLOCS NE PARTAGENT JAMAIS LA MÊME',
    '   BANDE, sauf s\'ils sont côte à côte et que leurs bandes horizontales, elles, ne se croisent pas',
    '   (l\'un finit à gauche avant que l\'autre ne commence à droite).',
    '',
    '2. TU COMPTES LA HAUTEUR DE CHAQUE TEXTE avant de lui donner sa bande : nombre de caractères ÷',
    '   (largeur de la boîte ÷ (taille de police × 0.52)) = nombre de lignes, puis lignes × taille ×',
    '   interligne = hauteur. Un titre de 92px sur 900px de large tient environ 19 caractères par ligne.',
    '   Si la hauteur obtenue ne tient pas dans sa bande, tu RÉDUIS la police — tu ne débordes pas.',
    '',
    '3. LES MARGES DE SÉCURITÉ : rien de visible (texte, image, forme) ne s\'approche à moins de ' + marge + 'px',
    '   des quatre bords, sauf une image de FOND en plein cadre et les aplats décoratifs, qui peuvent',
    '   déborder volontairement.',
    '',
    '4. L\'ORDRE D\'EMPILEMENT : dans une slide, ce qui est écrit EN DERNIER dans le HTML se peint PAR-DESSUS.',
    '   Donc l\'ordre est toujours : d\'abord le fond et les formes décoratives, ENSUITE les images, ET LE',
    '   TEXTE EN DERNIER. Un bloc de texte écrit avant une <img> passe DESSOUS et disparaît. Ne compte pas',
    '   sur z-index pour rattraper un mauvais ordre : mets le texte à la fin.',
    '',
    '5. UN TEXTE SUR UNE IMAGE, seulement si l\'image est un FOND en plein cadre (inset:0), et alors',
    '   obligatoirement avec un voile dégradé ou un cartouche plein derrière le texte. Une image posée',
    '   DANS la page (une carte, une vignette, un bandeau) ne porte JAMAIS de texte : le texte prend une',
    '   autre bande, à côté ou en dessous.',
    '',
    '5 bis. LES MOTS GÉANTS DÉCORATIFS — un mot ou un numéro énorme posé en fond, en couleur pâle ou',
    '   translucide, volontairement coupé par les bords (« Chess » derrière un cavalier, « BOOM! » qui',
    '   déborde) — sont des ORNEMENTS, pas du texte à lire : ils portent l\'attribut data-decor, sont écrits',
    '   AVANT le reste dans le HTML, et peuvent sortir du cadre et passer sous le reste. Le contrôle du',
    '   studio les laisse tels quels. Tout ce qui DOIT être lu (titre, dates, infos) n\'est jamais data-decor.',
    '',
    '5 ter. AUCUN ÉLÉMENT VIDE POUR RÉSERVER UNE PLACE. Une grille à trous (un damier de cases dont',
    '   certaines manquent) ne s\'écrit PAS avec des cases transparentes qui tiennent la place des trous :',
    '   dans l\'éditeur, ce sont des calques invisibles, qu\'on ne peut ni voir ni retirer sans faire glisser',
    '   toutes les cases suivantes. Écris seulement les cases VISIBLES, chacune placée explicitement à sa',
    '   case (grid-column et grid-row, ou une position absolue) ; les trous sont simplement l\'absence de',
    '   case. Pas de <span></span> ni de <div></div> qui ne peint rien.',
    '',
    '6. LES BLOCS QUI SE SUIVENT dans une même colonne se composent en flux (un conteneur',
    '   position:absolute, et dedans des blocs normaux avec des margin) plutôt qu\'en positions absolues',
    '   empilées : le flux ne peut pas se chevaucher tout seul. Réserve l\'absolu aux grands repères',
    '   (l\'image, le numéro géant, la pagination, la flèche).',
    '',
    'Relis chaque slide avant de la rendre : si deux boîtes se croisent, ou si un texte sort du cadre, tu',
    'la refais. Le studio mesure les slides après toi et te renvoie ce qui ne va pas — autant le faire bien.',
    '',
    'LA PALETTE (n\'en sors pas, sauf noir, blanc et transparences) : fond ' + c.fond + ', texte ' + c.texte + ', accent ' + c.accent + ', appoint ' + c.second + '.',
    da && da.ton ? 'LE STYLE DE LA MARQUE : ' + da.ton : '',
    '',
    avecModele
      ? 'LE SYSTÈME : un MODÈLE VISUEL est fourni dans la demande — c\'est lui qui décide de la grille, des places, des proportions et des ornements, ' + F.un + ' par ' + F.un + '. Tu ne « t\'en inspires » pas : tu le transposes. La palette et les polices ci-dessus, elles, ne bougent pas. Les ' + N + ' ' + F.des + ' forment donc la même série que le modèle : ce qui revient chez lui revient chez toi.'
      : 'LE SYSTÈME : les ' + N + ' ' + F.des + ' forment une série — même grille, mêmes marges, mêmes styles de titre — avec du rythme : le fond de chaque slide est l\'un des DEUX fonds de la DA, celui que son plan indique (jamais la couleur des textes en fond) ; les autres couleurs de la palette servent aux titres, aux cartes, aux formes. Varie la composition selon le rôle (accroche = titre géant ; étape ou liste = numéro géant ; preuve = image en grand ; appel = bouton dessiné). Des formes simples en CSS (aplats, cercles, lignes, grilles, dégradés de la palette) valent mieux qu\'un fond vide. Vise un rendu de studio de design, pas un modèle par défaut.',
    stories
      ? 'STORIES : la bande haute de 250px et la bande basse de 340px restent SANS texte ni logo (l\'interface d\'Instagram les recouvre) ; le fond, lui, les remplit. Si le plan indique un sticker, réserve un emplacement vide d\'environ 620 × 230px dans la zone utile et n\'y dessine rien : le vrai sticker sera posé dans Instagram.'
      : 'CARROUSEL : un numéro de page discret « K/' + N + ' », et sur toutes les slides sauf la dernière une invitation à glisser (flèche →). Le logo, s\'il existe, sur la première et la dernière.',
    '',
    'LES IMAGES : uniquement celles listées dans la demande, par leur URL EXACTE, en <img src="…" alt=""> avec object-fit:cover. N\'ouvre (Read) QUE les images marquées « à regarder », et par le chemin indiqué — une vignette. Les autres sont décrites : ne les ouvre pas.'
  ].filter(x => x !== '').join('\n');
}

/* Une image déposée, en petit : 640 px suffisent pour décider d'un cadrage. Montrer à Claude les
   originaux — des PNG de 4 à 6 Mo — alourdissait sa demande au point de la bloquer : dix minutes
   sans un caractère, le 21 septembre 2026. La vignette est faite par le navigateur du poste, sans
   fenêtre, et gardée à côté des médias (le dossier _vignettes n'est jamais servi ni exporté). */
async function vignetteDe(pub, m, sous, cote) {
  try {
    sous = sous || 'medias';
    cote = cote || 640;
    const dossier = path.join(dossierPub(pub.id), sous, '_vignettes');
    const sortie = path.join(dossier, m.fichier.replace(/\.[^.]+$/, '') + '.png');
    if (fs.existsSync(sortie)) return sortie;
    const nav = trouverNavigateur();
    if (!nav) return null;
    fs.mkdirSync(dossier, { recursive: true });
    const page = 'http://127.0.0.1:' + PORT + '/pub/' + projetCourant() + '/' + pub.id + '/apercu/' + sous + '/' + encodeURIComponent(m.fichier) + '?l=' + cote;
    await photographier(nav, page, sortie, cote, cote);
    // Un cliché vide pèse toujours la même chose : on ne garde pas une vignette où l'image n'a pas chargé.
    const t = taillePng(sortie);
    if (!t || t.l !== cote) { try { fs.unlinkSync(sortie); } catch (e) {} return null; }
    return sortie;
  } catch (e) { return null; }
}

/* Ce que Claude peut placer dans les slides, et ce qu'il a VRAIMENT besoin d'ouvrir. Une illustration
   générée, on sait ce qu'elle est (un sujet centré sur un fond uni, ou une scène) : il ne l'ouvre pas.
   Le logo non plus. Les visuels d'exemple de la DA ont déjà servi à en déduire le style, écrit en
   toutes lettres : ils ne repartent pas. Restent les images DÉPOSÉES, montrées en vignette. */
async function ressourcesPub(pub, ctx) {
  const l = [];
  const da = ctx.da, base = '/pub/' + projetCourant() + '/' + pub.id + '/medias/';
  for (let i = 0; i < (pub.medias || []).length; i++) {
    const m = pub.medias[i];
    const url = '\n  URL à écrire : ' + base + m.fichier;
    if (m.detoure) {
      l.push('Média ' + (i + 1) + ' — IMAGE DÉTOURÉE : un PNG TRANSPARENT, le sujet seul, sans aucun fond. Ce qu\'elle montre : ' + (m.note || m.nom || 'un sujet détouré') +
        '. Pose-la en object-fit:contain, en grand (au moins la moitié de la slide), ENTIÈRE : jamais rognée, SANS mask-image, sans cadre, sans bordure, sans ombre portée rectangulaire et sans aplat derrière elle qui dessinerait son carré. Le fond de la slide se voit à travers : elle peut passer devant une forme de la palette (cercle, aplat, grand numéro), et le texte ne passe pas sur le sujet. NE L\'OUVRE PAS.' + url);
      continue;
    }
    if (m.illustration) {
      l.push('Média ' + (i + 1) + ' — ' + (m.pleinCadre
        ? 'ILLUSTRATION GÉNÉRÉE, déjà AU FORMAT DE LA ' + FORMATS_PUB[pub.genre].un.toUpperCase() + ' (' + FORMATS_PUB[pub.genre].ratio + ') : une scène photographique en plein cadre, faite pour la remplir ENTIÈREMENT, bord à bord. Pose-la en fond de slide (object-fit:cover, inset:0), sans marge ni coins arrondis, et place le texte sur sa zone calme, avec un voile dégradé dessous pour qu\'il reste parfaitement lisible.'
        : !m.fond
        ? 'ILLUSTRATION GÉNÉRÉE, carrée, une vraie PHOTOGRAPHIE avec son décor : pose-la comme une photo DANS la mise en page — un bloc net, aux coins arrondis (16 à 28px), en object-fit:cover, sur le fond de la slide qui reste visible autour d\'elle. Ni mask-image, ni bords fondus, ni fond de slide : on doit voir que c\'est une photo posée. Le texte ne passe PAS dessus. Plusieurs photos de ce genre peuvent se ranger en grille.'
        : 'ILLUSTRATION GÉNÉRÉE, carrée, sur un fond UNI ' + m.fond + ' : la slide qui la porte prend EXACTEMENT ce fond (' + m.fond + '), l\'image se pose sans cadre ni bordure, en grand (au moins la moitié de la slide), jamais rognée au point de couper son sujet, NETTE : ni mask-image, ni bords fondus, ni dégradé, ni voile pour la « fondre » dans la slide (le studio la détoure lui-même). Le texte ne passe pas sur le sujet.') +
        ' Ce qu\'elle montre : ' + (m.note || 'une illustration') + '. NE L\'OUVRE PAS : son sujet est entier, centré, avec de la marge autour.' + url);
      continue;
    }
    // l'image d'une vidéo que plus aucune slide ne porte : Claude ne la voit pas (il pourrait la placer ailleurs)
    if (m.videoId && !((pub.plan && pub.plan.slides) || []).some(s => s.video && s.video.id === m.videoId)) continue;
    const chemin = path.join(dossierPub(pub.id), 'medias', m.fichier);
    const t = taillePng(chemin);
    const vignette = m.videoId ? null : await vignetteDe(pub, m);
    if (m.videoId) l.push('Média ' + (i + 1) + " — L'IMAGE D'UNE VIDÉO (" + m.nom.replace(/^Vidéo — /, '') + ") : elle marque la place de la vidéo, qui la remplacera à l'export. Place-la selon la consigne de sa slide, par son URL exacte." + url);
    else l.push('Média ' + (i + 1) + ' — ' + m.nom + (m.note ? ' (' + m.note + ')' : '') +
      (t && t.l > 0 && t.l < 20000 ? ' — taille réelle ' + t.l + ' × ' + t.h + ' px' : '') + url +
      '\n  à regarder (Read) : ' + (vignette
        ? vignette + '  ← une VIGNETTE de 640 px, l\'image entière y tient dans un carré gris : elle sert à décider du cadrage, pas à juger de la netteté.'
        : chemin));
  }
  if (da && da.logo) {
    const t = taillePng(path.join(DOSSIER_IDENTITES, da.id, da.logo));
    l.push('Logo de la marque' + (t && t.l > 0 && t.l < 20000 ? ' (' + t.l + ' × ' + t.h + ' px)' : '') + ' — NE L\'OUVRE PAS : pose-le petit (hauteur 40 à 64 px), en object-fit:contain, sans le déformer ni le recolorer.' +
      '\n  URL à écrire : /IDENTITES/' + da.id + '/' + da.logo);
  }
  const elementsDA = da ? (da.elements || []).filter(e => e && e.fichier && fs.existsSync(path.join(DOSSIER_IDENTITES, da.id, e.fichier))) : [];
  if (elementsDA.length) {
    l.push('LES ÉLÉMENTS DE LA DA — de VRAIES images de la marque (patchs, stickers, cadres, matières), à poser TELLES QUELLES en <img src="…">, jamais redessinées en CSS, ni recolorées, ni déformées (object-fit:contain). ' +
      'Chacun dit QUAND il sert : choisis celui dont le « quand » colle au propos de la slide. Une slide en porte UN au plus (deux sur l\'accroche ou la dernière), et un élément ne revient pas d\'une slide à l\'autre, sauf s\'il est dit récurrent. ' +
      'Ce ne sont pas des médias : ils ne remplacent ni les images du plan ni une vidéo. Un élément qui SERT DE SUPPORT à un texte posé dessus (une bulle, une carte, un cadre) porte l\'attribut data-decor sur son <img> : le contrôle de la mise en page ne le compte alors pas comme recouvrant ce texte — sans lui, la « réparation » glisserait un aplat sous le texte. NE LES OUVRE PAS : leur nom et leur « quand » suffisent.\n' +
      elementsDA.map(e => { const t = taillePng(path.join(DOSSIER_IDENTITES, da.id, e.fichier));
        return '  - « ' + e.nom + ' »' + (t && t.l > 0 && t.l < 20000 ? ' (' + t.l + ' × ' + t.h + ' px' + (e.detoure || /\.png$/i.test(e.fichier) ? ', PNG transparent' : '') + ')' : '') +
          (e.quand ? ' — quand : ' + e.quand : '') + '\n    URL à écrire : /IDENTITES/' + da.id + '/' + e.fichier; }).join('\n'));
  }
  /* LES FONDS DE LA DA (27 sept. 2026) : une texture (un tissu au logo de la marque) importée ou générée dans
     « Vos DA » pour les Reels. Le carrousel ne les recevait pas : Claude ne connaissait que les quatre
     couleurs, et toutes les slides sortaient en aplats. Chaque fond est lié à sa couleur : la slide dont
     la « couleur » est celle-là le porte, avec la couleur dessous (le temps que l'image charge). */
  const fondsDA = da && da.fonds ? CLES_FOND.filter(k => da.fonds[k] && fs.existsSync(path.join(DOSSIER_IDENTITES, da.id, da.fonds[k]))) : [];
  if (fondsDA.length) {
    const c = da.couleurs || {};
    fondsDA.forEach(k => {
      const couleur = k === 'fond' ? 'fond' : 'accent', hex = c[couleur] || '';
      const t = taillePng(path.join(DOSSIER_IDENTITES, da.id, da.fonds[k]));
      l.push((k === 'fond' ? 'FOND TEXTURÉ DE LA DA' : 'FOND ACCENT DE LA DA') + (t && t.l > 0 && t.l < 20000 ? ' (' + t.l + ' × ' + t.h + ' px)' : '') +
        ' — NE L\'OUVRE PAS : c\'est la matière de la marque, sa couleur « ' + couleur + ' » (' + hex + ') en vraie texture. TOUTE slide dont la couleur est « ' + couleur + ' » la porte, ' +
        'sur la <section> elle-même : background:' + hex + ' url(\'/IDENTITES/' + da.id + '/' + da.fonds[k] + '\') center/cover no-repeat. ' +
        'Rien ne la remplace par un aplat, rien ne la voile (pas de calque de couleur par-dessus) : le texte se pose dessus, en couleur « texte » ou « accent », parfaitement lisible.' +
        '\n  URL à écrire : /IDENTITES/' + da.id + '/' + da.fonds[k]);
    });
  }
  const t = [];
  if (l.length) t.push('IMAGES DISPONIBLES :\n' + l.join('\n'));
  // Une DA sans style écrit : un seul visuel d'exemple, pour ne pas partir à l'aveugle.
  if (da && !da.ton && !da.design && (da.visuels || []).length) t.push('VISUEL D\'EXEMPLE DE LA DA — à regarder (Read) pour en saisir le style ; il ne se place PAS dans les slides :\n  ' +
    path.join(DOSSIER_IDENTITES, da.id, da.visuels[0]));
  if (da && (da.exemples || []).length) t.push('LES ' + (da.exemples.length > 1 ? da.exemples.length + ' ' : '') + 'SLIDES D\'EXEMPLE DE LA MARQUE — à regarder (Read) AVANT de composer : elles montrent son STYLE ' +
    '(on n\'en recopie ni les phrases ni les images) :\n' + da.exemples.map(f => '  ' + path.join(DOSSIER_IDENTITES, da.id, f)).join('\n'));
  if (da && da.design) {
    /* Un fichier de design EN TEXTE passe en entier (30 sept. 2026) : donné comme un simple chemin « à lire », il n'était pas
       toujours ouvert — une slide refaite redessinait la flèche, colorait les mots en orange, ajoutait un chiffre décoratif. */
    const fd = path.join(DOSSIER_IDENTITES, da.id, da.design);
    let texte = '';
    if (/\.(md|txt|css|json|html?)$/i.test(da.design)) { try { texte = fs.readFileSync(fd, 'utf8'); } catch (e) {} }
    if (texte && texte.length <= 20000) t.push('LE FICHIER DE DESIGN DE LA MARQUE — il fait AUTORITÉ sur les styles, les espacements, les composants et les éléments à poser. ' +
      'Là où il contredit une règle générale de cette consigne (la couleur des mots, les ornements, les flèches, les fonds), c\'est LUI qui gagne. Les images qu\'il te demande de regarder, ouvre-les (Read).\n\n' + texte);
    else t.push('FICHIER DE DESIGN DE LA MARQUE — à lire (Read) : il fait autorité sur les styles, les espacements et les composants :\n  ' + fd);
  }
  return t.join('\n\n');
}

async function ressourcesModele(pub, nb) {
  const l = (pub.modele || []);
  if (!l.length) return '';
  const lignes = [];
  for (let i = 0; i < l.length; i++) {
    const direct = path.join(dossierModele(pub.id), l[i].fichier);
    let poids = 0;
    try { poids = fs.statSync(direct).size; } catch (e) { /* elle a disparu : la vignette echouera aussi */ }
    const v = poids && poids <= 1.5e6 ? direct : (await vignetteDe(pub, l[i], 'modele', 1200)) || direct;
    lignes.push('  ' + (i + 1) + '. ' + v);
  }
  const F = pub.modeleFidelite === 'fidele' ? 'fidele' : pub.modeleFidelite === 'libre' ? 'libre' : 'charpente';
  return [
    'LE MODÈLE À TRANSPOSER — ' + l.length + ' images, à ouvrir (Read) DANS L\'ORDRE, toutes, avant d\'écrire. LIS LE TEXTE ÉCRIT DESSUS : ici il compte autant que les images.',
    lignes.join('\n'),
    '',
    F === 'libre'
      ? 'CE MODÈLE T\'INSPIRE, sans t\'obliger : tu en retiens l\'esprit, l\'énergie et la manière d\'écrire, et tu construis librement le déroulé qui sert le mieux le sujet de la personne.'
      : 'CETTE PUBLICATION EST UNE TRANSPOSITION DE CE MODÈLE. Ce n\'est pas une vague inspiration : sa CHARPENTE fait loi. Tu procèdes en deux temps.',
    '',
    '1. RELÈVE la charpente du modèle : pour chacune de ses images, ce qu\'elle FAIT dans la série (ce qu\'elle',
    '   promet, ce qu\'elle prouve, ce qu\'elle annonce, ce qu\'elle demande), et COMMENT elle est écrite',
    '   (longueur du titre, présence ou non d\'un texte, d\'un sur-titre, registre, tutoiement ou vouvoiement,',
    '   phrases nominales ou verbales, ponctuation).',
    '',
    '2. TRANSPOSE cette suite au sujet de la personne, dans le MÊME ORDRE. TU EN ÉCRIS',
    '   EXACTEMENT ' + nb + '. Le modèle en compte ' + l.length + '.',
    (nb === l.length
      ? '   C\'EST LE MÊME NOMBRE : une slide pour une image, dans l\'ordre, sans exception. Plusieurs images du modèle se ressemblent ? C\'est SON rythme, et tu le gardes : tu ne fonds JAMAIS deux slides, tu n\'en sautes aucune. La slide K transpose l\'image K.'
      : nb < l.length
      ? '   ON T\'EN DEMANDE MOINS : tu gardes la première, la dernière'
      : '   ON T\'EN DEMANDE PLUS : tu gardes la suite du modèle et tu prolonges ses séries répétées (une preuve de plus, un angle de plus), sans ajouter d\'idée neuve. La première et la dernière gardent leur rôle'),
    (nb < l.length ? '   et les étapes qui portent l\'idée, et tu fonds les répétitions — tu ne réinventes pas un autre déroulé.' : ''),
    '   Chaque slide que tu écris occupe, dans ta série, la place que sa slide d\'origine occupait dans la',
    '   sienne, et elle est écrite de la même manière, à la même longueur.',
    '',
    'Chaque slide porte donc « modele » : le NUMÉRO de la slide du modèle qu\'elle transpose (un nombre de 1 à ' + l.length + ').',
    'Et tu rends EXACTEMENT ' + nb + ' slides, ni plus ni moins : c\'est le nombre que la personne a choisi, il fait loi.',
    '',
    'CE QUE LA PERSONNE A ÉCRIT DANS « CE QU\'ELLE VEUT DIRE » PEUT ÊTRE UNE CONSIGNE plutôt qu\'un sujet',
    '(« reproduis ce carrousel », « refais-le en français », « garde la même structure »). Dans ce cas, tu',
    'l\'exécutes À LA LETTRE — c\'est un ordre, pas un thème — et tu prends la MATIÈRE ailleurs : son but, sa',
    'marque, sa distribution, ses médias. Elle demande « mot pour mot en français » ? Alors tu suis le modèle',
    'd\'aussi près que le français et son sujet le permettent, sans rien réinventer.',
    '',
    F === 'fidele'
      ? 'JUSQU\'OÙ LE SUIVRE : AU PLUS PRÈS. La personne a demandé le MÊME carrousel, en français, pour son sujet à elle. Tu reprends donc slide par slide, dans l\'ordre, la PHRASE du modèle : sa construction, sa longueur, son rythme, sa ponctuation, ses ruptures, son registre — et tu n\'y remplaces que ce qui doit l\'être. Là où le modèle nomme sa marque, son produit ou son secteur, tu mets ceux de la personne. Là où il ne nomme rien, tu gardes sa tournure telle quelle, traduite en français naturel — pas mot à mot, mais au plus près de ce qu\'elle dit et de la manière dont elle le dit. Un titre de trois mots reste un titre de trois mots. Une slide sans texte reste une slide sans texte.'
      : 'CE QUE TU N\'EN PRENDS PAS : aucune phrase, aucun titre, aucune formule recopiés ni simplement traduits — tu écris des phrases neuves.',
    'DANS TOUS LES CAS, JAMAIS :',
    '- ni la marque, ni le produit, ni le nom, ni le secteur de l\'exemple : la publication parle du sujet de la personne, et de lui seul ;',
    '- aucun CHIFFRE, prix, date, promesse ou résultat qui viendrait de l\'exemple : si le modèle avance un fait que la personne n\'a pas écrit, tu gardes la tournure et tu retires le fait, ou tu tournes la phrase sans lui.',
    '',
    'Tu écris en français, dans la langue de la personne.'
  ].join('\n');
}

/* Le modèle vu par la MISE EN PAGE. Jusqu'au 21 septembre 2026, les images de l'exemple
   n'allaient qu'à l'écriture du plan : elles décidaient du déroulé et des phrases, jamais du
   dessin. Le composeur inventait donc une forme qui n'avait rien à voir avec l'exemple fourni,
   et la personne ne comprenait pas pourquoi. Le modèle décide maintenant de la FORME ; la DA,
   elle, garde les couleurs et les polices. Chaque slide sait quelle image elle transpose (le
   « modele » de son plan) : on ne fait ouvrir que celles-là, dans l'ordre des slides. */
async function ressourcesModeleVisuel(pub) {
  const l = pub.modele || [];
  if (!l.length) return '';
  const slides = (pub.plan && pub.plan.slides) || [];
  // Le chemin à ouvrir : l'image elle-même si elle est légère, sa vignette sinon.
  const cheminDe = async i => {
    const direct = path.join(dossierModele(pub.id), l[i].fichier);
    let poids = 0;
    try { poids = fs.statSync(direct).size; } catch (e) { return direct; }
    return poids <= 1.5e6 ? direct : ((await vignetteDe(pub, l[i], 'modele', 1200)) || direct);
  };
  /* La correspondance slide → image. Quand le plan ne l'a pas écrite (un plan d'avant, ou un
     modèle ajouté après coup), on répartit les images sur les slides dans l'ordre : mieux vaut
     une correspondance approchée que pas de modèle du tout. */
  const lignes = [], vues = [];
  for (let k = 0; k < slides.length; k++) {
    const dit = slides[k].modele;
    const n = (Number.isInteger(dit) && dit >= 1 && dit <= l.length)
      ? dit
      : Math.min(l.length, Math.round(k * (l.length - 1) / Math.max(1, slides.length - 1)) + 1);
    if (!vues.includes(n)) vues.push(n);
    lignes.push('  ' + FORMATS_PUB[pub.genre].un + ' ' + (k + 1) + '  ←  image ' + n + ' du modèle : ' + (await cheminDe(n - 1)));
  }
  return [
    'LE MODÈLE VISUEL — C\'EST LUI QUI DÉCIDE DE LA FORME.',
    'La personne a fourni ' + (pub.genre === 'stories' ? 'des stories d\'exemple et demande les SIENNES' : 'un carrousel d\'exemple et demande le SIEN') + ', bâti pareil. Ouvre (Read) ces',
    vues.length + ' images AVANT d\'écrire la moindre ligne de CSS. Chaque ' + FORMATS_PUB[pub.genre].un + ' que tu composes a la sienne :',
    '',
    lignes.join('\n'),
    '',
    'CE QUE TU EN RELÈVES, image par image :',
    '  - LA GRILLE : où commence le texte, où s\'arrête l\'image, quelles marges, combien de colonnes ;',
    '  - LA PLACE de chaque bloc : titre en haut, au milieu ou en bas ; image en plein cadre, en carte,',
    '    en bandeau, en vignette ; texte à côté de l\'image ou dessous, jamais dessus sauf si le modèle',
    '    le fait — et alors avec le même voile ou le même cartouche que lui ;',
    '  - LES PROPORTIONS, mesurées à l\'œil sur l\'image : quelle part de la hauteur le titre occupe,',
    '    quelle part de la surface l\'image prend, quelle taille le texte courant fait à côté du titre ;',
    '  - LES ORNEMENTS : numéro géant, filet, pastille, cartouche, bandeau, cadre — lesquels, et où ;',
    '  - CE QUI REVIENT d\'une image à l\'autre : le logo, la pagination, la flèche, la bande de couleur.',
    '',
    'Tu REPRODUIS cette composition avec les textes du plan et les images de la personne. Une ' + FORMATS_PUB[pub.genre].un + ' du',
    'modèle sans texte reste sans texte ; une ' + FORMATS_PUB[pub.genre].un + ' du modèle où l\'image tient toute la place garde une image',
    'qui tient toute la place.',
    '',
    'CE QUE TU N\'EN PRENDS PAS :',
    '  - ni ses COULEURS ni ses POLICES : elles viennent de la palette donnée plus haut, et d\'elle seule.',
    '    Tu transposes la composition du modèle DANS cette palette — un fond sombre du modèle devient le',
    '    fond sombre de la palette, un aplat de couleur devient l\'accent de la palette ;',
    '  - ni son texte, ni sa marque, ni son produit, ni ses chiffres : le plan validé fait loi pour tout',
    '    ce qui s\'écrit ;',
    '  - ni ses images : tu n\'emploies que celles listées dans « IMAGES DISPONIBLES ». Une image du',
    '    modèle ne se place JAMAIS dans une slide, elle ne sert qu\'à voir la forme.'
  ].concat(pub.genre === 'stories' ? ['',
    'DES STORIES : le modèle est souvent une CAPTURE du téléphone. L\'interface d\'Instagram qu\'on y voit',
    '(barres de progression, photo et nom du compte, heure, croix, « Envoyer un message », cœur, avion) ne',
    'fait PAS partie de la story : tu ne la dessines jamais. Un vrai sticker du modèle (sondage, question,',
    'lien, compte à rebours) devient l\'emplacement VIDE réservé au sticker, à la même place. Et un texte du',
    'modèle posé dans la bande haute ou basse descend ou remonte juste assez pour en sortir.'] : []).join('\n');
}

/* La réflexion silencieuse de Claude avant d'écrire est plafonnée pour la mise en page. Mesuré le
   21 septembre 2026 : 3 min 20 de réflexion pour 33 s d'écriture sur 7 slides — et, avec huit images
   à regarder, plus de dix minutes sans un caractère. Le plan est déjà validé, la DA donnée, les
   règles écrites : il reste à composer, pas à délibérer.
   (La variable MAX_THINKING_TOKENS est ignorée par cette version de Claude Code : 13 000 jetons de
   réflexion malgré elle. C'est l'option --effort qui règle la réflexion. Mesuré sur le même
   carrousel de 7 slides : effort par défaut 3 min 50 à plus de 10 min ; « low » 43 s mais un titre
   qui déborde sur l'image ; « medium » 2 min 55 et un rendu propre. On garde « medium ».) */
const ARGS_MISE_EN_PAGE = ['--effort', 'medium'];

/* Suivre Claude pendant qu'il travaille : ce qu'il fait se dit à l'écran, et un silence trop long
   l'arrête. `dire(message)` reçoit l'activité ; `controle` permet d'annuler de l'extérieur. */
function suiviDeClaude(dire, controle, quoi) {
  let dernier = Date.now(), outils = 0, ecrit = false, reflechit = false;
  const garde = setInterval(() => {
    if (Date.now() - dernier > 4 * 60 * 1000 && controle.arreter) {
      controle.arreter('Claude ne répond plus depuis quatre minutes : ' + quoi + ' est arrêtée. Relancez-la — votre plan et vos images sont intacts, et rien n\'a été dépensé.');
    }
  }, 15000);
  return {
    fin: () => clearInterval(garde),
    suivre: e => {
      dernier = Date.now();
      if (!dire) return;
      const b = e.type === 'content_block_start' && e.content_block;
      if (b && b.type === 'tool_use') { outils++; dire('Claude ouvre une image ou un fichier (' + outils + ')…'); }
      else if (b && b.type === 'thinking' && !reflechit) { reflechit = true; dire('Claude réfléchit à la composition…'); }
      else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && !ecrit) { ecrit = true; dire('Claude écrit les styles de la série…'); }
    }
  };
}

/* Ce que la mise en page doit savoir d'UNE slide : son fond (une couleur de la DA, ou l'image en plein
   cadre), et ses images, avec leur place. Le plan décide ; la composition dessine. */
function mediaDeVisuel(pub, v) {
  return (pub.medias || []).findIndex(m => v.source === 'gen' ? (m.illustration && m.slideId === v.id) : m.fichier === v.fichier) + 1;
}
function lignesSlide(pub, s, da) {
  const c = (da && da.couleurs) || { fond: '#0b0b0d', texte: '#f2f2f2', accent: '#f97316', second: '#fdba74' };
  const NOMS = { fond: 'le fond', accent: 'le fond accent' };
  // Le fond de la slide : sa texture de DA s'il y en a une (un tissu brodé), sinon l'aplat de sa couleur.
  const ligneFond = cle => {
    const k = cle === 'accent' ? 'accent' : 'fond', hex = c[k] || c.fond, img = da && da.fonds && da.fonds[k === 'accent' ? 'fond_accent' : 'fond'];
    return img && fs.existsSync(path.join(DOSSIER_IDENTITES, da.id, img))
      ? "FOND : " + NOMS[k] + " de la DA, EN TEXTURE — sur la <section> : background:" + hex + " url('/IDENTITES/" + da.id + "/" + img + "') center/cover no-repeat ; rien ne le voile."
      : 'FOND : ' + hex + ' (' + NOMS[k] + ' de la DA) — un aplat uni, EXACTEMENT cette couleur.';
  };
  const vis = (s.visuels || []).map(v => ({ v: v, n: mediaDeVisuel(pub, v) })).filter(x => x.n > 0);
  const plein = vis.find(x => x.v.plein), posees = vis.filter(x => !x.v.plein);
  const l = [];
  // Une slide VIDÉO : Claude place l'image de la vidéo ; à l'export, la vidéo prend exactement sa place (exporterSlideVideo)
  const nv = s.video ? (pub.medias || []).findIndex(m => m.videoId === s.video.id) + 1 : 0;
  if (nv) {
    if (s.video.plein) l.push("FOND : le média " + nv + ", l'IMAGE D'UNE VIDÉO, EN PLEIN CADRE — elle remplit la slide bord à bord (object-fit:cover, inset:0), sans marge ni coins arrondis, et RIEN d'autre ne peint le fond derrière elle (pas d'aplat, pas de forme décorative en dessous) : à l'export, la vidéo passe à sa place, SOUS le texte. Le texte se pose sur sa zone la plus calme, avec un voile dégradé dessous pour rester lisible pendant que la vidéo bouge.");
    else {
      l.push(s.video.gif && plein
        ? 'FOND : le média ' + plein.n + ", EN PLEIN CADRE — une photo du quotidien qui remplit toute la story (object-fit:cover, inset:0), opacité baissée comme le dit la charte ; c'est elle le fond, et la carte GIF se pose par-dessus."
        : ligneFond(s.couleur));
      l.push("VIDÉO POSÉE : le média " + nv + " est l'IMAGE D'UNE VIDÉO — à l'export, la vidéo prend EXACTEMENT sa place et sa taille. Pose-la en GRAND (au moins la moitié de la slide), comme une photo : un simple rectangle en object-fit:cover, coins arrondis permis, sans mask-image, sans filtre, sans rotation, sans transparence. RIEN ne passe par-dessus (ni texte, ni forme, ni logo) : ce serait caché par la vidéo.");
      // « Adapter le cadre à la vidéo » (27 sept. 2026) : ses proportions exactes, rien de coupé, les coins arrondis gardés
      const iv = (pub.videos || []).find(x => x.id === s.video.id), F = FORMATS_PUB[pub.genre];
      if (s.video.gif) {
        l.push('CE MÉDIA EST UN GIF, dans sa CARTE GIF (une réaction) : une carte de 300 à 380 px de large, coins arrondis de 22 px, overflow:hidden, ombre portée douce ; en haut, un bandeau CLAIR de 44 px (crème, #FFF7EC) qui porte « ' + s.video.gif + '.GIF » (Open Sans, 700, 18 px, #111, centré) ; dessous, l\'image du média en object-fit:cover' +
          (iv && iv.l && iv.h ? ', au rapport exact aspect-ratio: ' + iv.l + ' / ' + iv.h : '') + '. La carte ACCOMPAGNE le texte (à côté d\'une bulle, sous une phrase) ; elle n\'est pas « en grand » comme une vidéo. Rien ne passe sur l\'image : à l\'export, le GIF prend exactement sa place.');
      } else if (s.video.forme === 'video' && iv && iv.l && iv.h) {
        const marge = pub.genre === 'stories' ? 80 : 90;
        let w = F.l - 2 * marge, h = Math.round(w * iv.h / iv.l);
        if (h > F.h * 0.6) { h = Math.round(F.h * 0.6); w = Math.round(h * iv.l / iv.h); }
        l.push('LE CADRE DE LA VIDÉO A EXACTEMENT SES PROPORTIONS (' + iv.l + ' × ' + iv.h + ', soit aspect-ratio: ' + iv.l + ' / ' + iv.h + ") : la vidéo s'y voit ENTIÈRE, rien n'est coupé. Par exemple " + w + ' × ' + h + " px — plus petit si la place manque, mais JAMAIS d'autres proportions. Coins arrondis de 28 à 40 px, obligatoires. Le titre et le texte s'organisent autour de ce cadre.");
      }
    }
    return l;
  }
  if (plein) {
    l.push('FOND : le média ' + plein.n + ", EN PLEIN CADRE — il remplit la slide bord à bord (object-fit:cover, inset:0), sans marge ni coins arrondis ; c'est lui le fond. Le texte se pose sur sa zone la plus calme, avec un voile dégradé dessous pour rester parfaitement lisible.");
  } else {
    l.push(ligneFond(s.couleur));
  }
  if (posees.length) {
    const dit = posees.map(x => 'média ' + x.n + (x.v.source === 'mienne' ? ' (importé par la personne : posé ENTIER, jamais rogné — object-fit:contain)' : '')).join(', ');
    l.push((posees.length > 1 ? 'IMAGES POSÉES : ' : 'IMAGE POSÉE : ') + dit +
      (plein ? ' — posée' + (posees.length > 1 ? 's' : '') + " PAR-DESSUS la photo de fond, comme " + (posees.length > 1 ? 'des photos : des blocs nets' : 'une photo : un bloc net') + " aux coins arrondis, une ombre douce, sans cacher le texte." : '') +
      (posees.length > 1 ? ' — ' + posees.length + " images à montrer ENSEMBLE, comme une planche : grille, mosaïque, collage, ou photos posées qui se chevauchent un peu. Toutes y sont, entières et reconnaissables, et aucune ne couvre le texte. Cette règle passe AVANT la taille demandée pour chaque image seule (« au moins la moitié de la slide ») : ici, les images sur fond uni se posent elles aussi en blocs nets aux coins arrondis, sans mask-image." : ''));
  }
  return l;
}

async function composerPub(pub, surAvancee, dire, controle) {
  controle = controle || {};
  if (!pub.plan || !pub.plan.slides.length) throw new Error("Cette publication n'a pas encore de plan.");
  const ctx = contextePub(pub), N = pub.plan.slides.length;
  // Le modèle décide de la FORME : il part avec la demande, comme les images et le plan.
  const modeleVisuel = await ressourcesModeleVisuel(pub);
  const question = [
    ctx.texte, '', await ressourcesPub(pub, ctx), '',
    modeleVisuel ? modeleVisuel + '\n' : '',
    'LE PLAN VALIDÉ (textes à reprendre mot pour mot) :',
    pub.plan.slides.map((s, i) => (i + 1) + '. [' + s.role + '] TITRE : ' + s.titre + (s.texte ? '\n   TEXTE : ' + s.texte : '') +
      lignesSlide(pub, s, ctx.da).map(x => '\n   ' + x).join('') + (s.sticker ? '\n   STICKER : ' + s.sticker : '')).join('\n'),
    '', 'Compose les ' + N + ' ' + ctx.F.des + '.'
  ].join('\n');

  let recu = '', faites = 0;
  const suivi = suiviDeClaude(dire, controle, 'la mise en page');
  let r;
  try {
    r = await interroger(question, consigneMiseEnPage(pub, ctx, N, !!modeleVisuel), d => {
      recu += d;
      const n = (recu.match(/<\/section>/gi) || []).length;
      if (n !== faites) { faites = n; if (surAvancee) surAvancee(n, N); }
    }, 1, DELAI_GENERATION, { suivre: suivi.suivre, controle: controle, args: ARGS_MISE_EN_PAGE });
  } finally { suivi.fin(); }

  let deck = decouperDeck(r.texte || '');
  if (!deck.slides.length) throw new Error("Claude n'a pas rendu de mise en page lisible. Réessayez.");
  if (deck.slides.length !== N) {
    // Une slide en trop ou en moins : on garde ce qui correspond au plan, et on le dit.
    deck.slides = deck.slides.slice(0, N);
    deck.avertissement = 'Claude a rendu ' + deck.slides.length + ' ' + ctx.F.des + ' pour un plan de ' + N + '.';
  }
  deck.date = new Date().toISOString();
  // Le plan tel qu'il etait a la mise en page : l'application sait ainsi dire
  // quand les slides ne refletent plus le plan.
  deck.plan = JSON.stringify(pub.plan.slides);
  ecrireDeck(pub.id, deck);
  /* Le contrôle géométrique. Il rend les slides dans un vrai navigateur, mesure ce qui déborde,
     ce qui se recouvre et ce qui est enterré, et le fait corriger. Il lit le deck sur le disque :
     il vient donc APRÈS l'enregistrement. S'il échoue, la composition reste ce qu'elle est. */
  if (dire) dire('Le studio vérifie la mise en page…');
  deck = await controlerEtReparer(pub, deck, ctx, null, dire, controle);
  ecrireDeck(pub.id, deck);
  // Les anciens exports ne correspondent plus : on les met de côté, sans rien effacer.
  majExports(pub.id);
  return deck;
}

async function refaireSlide(pub, n, remarque) {
  let deck = lireDeck(pub.id);
  if (!deck || !deck.slides[n - 1]) throw new Error('Cette ' + FORMATS_PUB[pub.genre].un + ' est introuvable.');
  const ctx = contextePub(pub), N = deck.slides.length, s = pub.plan.slides[n - 1] || {};
  const modeleVisuel = await ressourcesModeleVisuel(pub);
  const consigne = consigneMiseEnPage(pub, ctx, N, !!modeleVisuel) + '\n\n' + [
    'ICI, TU NE REFAIS QU\'UNE SEULE ' + ctx.F.un.toUpperCase() + ' : la numéro ' + n + '. Les autres existent déjà et ne changent pas.',
    'Tu rends UNIQUEMENT : <section class="slide" data-n="' + n + '">…</section>, et, seulement si tu as besoin de règles nouvelles, un bloc <style> AVANT, dont chaque sélecteur commence par .slide[data-n="' + n + '"].',
    'Tu réutilises les classes du CSS existant pour rester dans la série.'
  ].join('\n');
  const question = [
    ctx.texte, '', await ressourcesPub(pub, ctx), '',
    modeleVisuel ? modeleVisuel + '\n' : '',
    'LE CSS EXISTANT DE LA SÉRIE :\n' + deck.css, '',
    'LA ' + ctx.F.un.toUpperCase() + ' ' + n + ' ACTUELLE :\n' + deck.slides[n - 1], '',
    'SON TEXTE AU PLAN (mot pour mot) — TITRE : ' + (s.titre || '') + (s.texte ? ' — TEXTE : ' + s.texte : '') +
      lignesSlide(pub, s, ctx.da).map(x => ' — ' + x).join(''), '',
    'CE QUE LA PERSONNE DEMANDE : ' + (remarque || 'une autre composition, plus forte, dans le même système.')
  ].join('\n');
  const r = await interroger(question, consigne, null, 1, DELAI_GENERATION, { args: ARGS_MISE_EN_PAGE });
  const neuf = decouperDeck(r.texte || '');
  if (!neuf.slides.length) throw new Error("Claude n'a pas rendu de slide lisible. Réessayez.");
  /* Le deck est RELU après l'attente : une retouche faite à la main sur une autre slide pendant que Claude
     travaillait n'est pas écrasée. Seules la slide n et, s'il en faut, de nouvelles règles changent. */
  deck = lireDeck(pub.id) || deck;
  deck.slides[n - 1] = neuf.slides[0].replace(/data-n="\d+"/i, 'data-n="' + n + '"');
  // la slide refaite l'est d'après son plan ACTUEL : l'instantané du plan que garde le deck le suit (sinon elle passerait pour dépassée)
  try { const pl = JSON.parse(deck.plan || '[]'); if (pl.length === deck.slides.length && pub.plan.slides[n - 1]) { pl[n - 1] = pub.plan.slides[n - 1]; deck.plan = JSON.stringify(pl); } } catch (e) {}
  if (neuf.css.trim()) deck.css += '\n/* slide ' + n + ', refaite */\n' + neuf.css;
  ecrireDeck(pub.id, deck);
  // La slide refaite passe le même contrôle que les autres : une retouche peut casser autant qu'une composition.
  const cssAvant = deck.css;
  const controle = await controlerEtReparer(pub, deck, ctx, null, null, null, [n]);
  deck = lireDeck(pub.id) || controle;
  deck.slides[n - 1] = controle.slides[n - 1];
  if (controle.css !== cssAvant) deck.css = controle.css;
  if (controle.controle) deck.controle = controle.controle;
  ecrireDeck(pub.id, deck);
  majExports(pub.id);
  return deck;
}

/* ---------- LE DÉTOURAGE LOCAL, GRATUIT ----------

   Si le poste a le Python du détourage (../OUTILS-DETOURAGE), le fond se supprime
   ICI : gratuitement, hors ligne, en une dizaine de secondes, avec BiRefNet-general.
   Sinon « Supprimer le fond » le dit, et rien d'autre n'est tenté.

   LE STUDIO NE DISTRIBUE PAS LE MODÈLE, et c'est délibéré : les poids d'un
   modèle portent leur propre licence, indépendante de celle du programme. Celui
   qui l'installe le fait pour lui, sur sa machine. Le studio ne fait que s'en
   servir s'il le trouve — Storymatic ne contient que ce script.

   On cherche dans cet ordre : le chemin écrit dans reglages.json, puis deux
   emplacements convenus, à côté du studio et dedans. */

const DETOURAGE_PY = path.join(RACINE, 'OUTILS', 'detourer.py');
// ce que detourer.py charge (plus rembg depuis le 5 oct. 2026 : Smart App Control bloquait numba et scipy, qu'il chargeait)
const DETOURAGE_ESSAI = 'import numpy, PIL.Image, onnxruntime';
let detourageCache = null;     // { python } ou { python: null } : la recherche ne se refait pas à chaque clic

function cheminsPython() {
  const r = String(lireReglages().pythonDetourage || '').trim();
  const dossiers = [
    path.join(RACINE, '..', 'OUTILS-DETOURAGE', 'env'),
    path.join(RACINE, 'OUTILS', 'detourage', 'env')
  ];
  const liste = r ? [r] : [];
  for (const d of dossiers) {
    liste.push(path.join(d, 'Scripts', 'python.exe'));   // Windows
    liste.push(path.join(d, 'bin', 'python3'));          // macOS, Linux
  }
  return liste;
}

/* Trouvé ne suffit pas : un Python sans onnxruntime (ou bloqué par Windows) ferait échouer le détourage au
   moment où la personne clique. On le vérifie une fois, pour de bon. */
function detourageLocal() {
  if (detourageCache) return detourageCache.python;
  for (const py of cheminsPython()) {
    if (!fs.existsSync(py) || !fs.existsSync(DETOURAGE_PY)) continue;
    try {
      const t = require('child_process').spawnSync(py, ['-c', DETOURAGE_ESSAI], { timeout: 60000, windowsHide: true });
      if (t.status === 0) { detourageCache = { python: py }; return py; }
    } catch (e) { /* on essaie le suivant */ }
  }
  detourageCache = { python: null };
  return null;
}

/* La même vérification, SANS BLOQUER le moteur (26 sept. 2026) : « import rembg » prenait 1,4 s, et, faite en
   spawnSync au premier /api/etat, elle figeait tout le studio pendant son ouverture. Lancée au démarrage en
   arrière-plan ; /api/etat l'attend sans empêcher les autres requêtes de passer. */
let detourageVerif = null;
function verifierDetourageLocal() {
  if (detourageCache) return Promise.resolve(detourageCache.python);
  if (detourageVerif) return detourageVerif;
  detourageVerif = (async () => {
    for (const py of cheminsPython()) {
      if (!fs.existsSync(py) || !fs.existsSync(DETOURAGE_PY)) continue;
      const ok = await new Promise(fin => {
        let p; try { p = spawn(py, ['-c', DETOURAGE_ESSAI], { windowsHide: true, stdio: 'ignore' }); } catch (e) { return fin(false); }
        const minuteur = setTimeout(() => { try { p.kill(); } catch (e) {} fin(false); }, 60000);
        p.on('error', () => { clearTimeout(minuteur); fin(false); });
        p.on('exit', code => { clearTimeout(minuteur); fin(code === 0); });
      });
      if (detourageCache) return detourageCache.python;           // une vérification synchrone a conclu entre-temps
      if (ok) { detourageCache = { python: py }; return py; }
    }
    if (!detourageCache) detourageCache = { python: null };
    return detourageCache.python;
  })();
  return detourageVerif;
}

// methode : 'ia' (BiRefNet, par défaut), 'uni' (un objet sur fond uni, sans IA) ou 'auto' (uni si les bords sont d'une couleur)
function detourerEnLocal(entree, sortie, methode) {
  return new Promise((ok, ko) => {
    const py = detourageLocal();
    if (!py) return ko(new Error("Le détourage local n'est pas installé sur ce poste."));
    const proc = spawn(py, [DETOURAGE_PY, entree, sortie].concat(['ia', 'uni', 'auto'].includes(methode) ? [methode] : []), { windowsHide: true });
    let sortieTxt = '', erreurTxt = '';
    proc.stdout.on('data', d => { sortieTxt += d; });
    proc.stderr.on('data', d => { erreurTxt += d; });
    const minuteur = setTimeout(() => { try { proc.kill(); } catch (_) {} ko(new Error('Le détourage local a dépassé cinq minutes.')); }, 5 * 60 * 1000);
    proc.on('close', () => {
      clearTimeout(minuteur);
      /* premierObjetJson rend le TEXTE du premier objet, pas un objet — comme
         partout ailleurs dans ce fichier, il faut le passer à JSON.parse. */
      let r = null;
      try { r = JSON.parse(premierObjetJson(sortieTxt) || 'null'); } catch (e) { r = null; }
      if (r && r.ok) return ok(r);
      const derniere = erreurTxt.trim().split(/\r?\n/).filter(Boolean).pop();
      ko(new Error((r && r.erreur) || derniere || "Le détourage local a échoué."));
    });
    proc.on('error', e => { clearTimeout(minuteur); ko(e); });
  });
}

// Un PNG porte-t-il de la transparence ? (type de couleur 4 ou 6, ou une palette avec un bloc tRNS)
function pngTransparent(fichier) {
  try {
    const b = fs.readFileSync(fichier);
    if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return false;
    const type = b[25];
    if (type === 4 || type === 6) return true;
    return b.slice(0, Math.min(b.length, 4096)).includes(Buffer.from('tRNS'));
  } catch (e) { return false; }
}

// Changer le fichier que montre un média, partout où il sert : la publication et les slides déjà composées.
function basculerFichierMedia(pub, m, neuf) {
  const ancien = m.fichier;
  m.fichier = neuf;
  m.detoure = !!m.sansFond && neuf === m.sansFond;
  // Ce qui désignait l'image par son fichier la suit : les références des illustrations, et leur signature.
  if (ancien !== neuf) {
    if (pub.plan) pub.plan.slides.forEach(s => (s.visuels || []).forEach(v => {
      if (v.fichier === ancien) v.fichier = neuf;
      (v.refs || []).forEach(r => { if (r.type === 'media' && r.id === ancien) r.id = neuf; });
    }));
    (pub.medias || []).forEach(x => { if (typeof x.refsSig === 'string') x.refsSig = x.refsSig.split(ancien).join(neuf); });
  }
  const ecrite = ecrirePub(pub);
  let deck = lireDeck(pub.id);
  if (deck && ancien !== neuf) {
    deck.css = String(deck.css || '').split(ancien).join(neuf);
    deck.slides = deck.slides.map(h => String(h).split(ancien).join(neuf));
    ecrireDeck(pub.id, deck);
    majExports(pub.id);
  }
  return { pub: ecrite, deck: deck };
}

/* `methode` (voie locale) : 'auto' par défaut — le fond UNI (le blanc autour d'un objet ou d'une carte) si
   les bords de l'image sont d'une seule couleur, sinon l'IA (BiRefNet). Le carrousel envoyait tout à l'IA :
   sur une photo sombre posée sur du blanc (une porte dans une pièce noire, slide réelle, 27 sept. 2026),
   BiRefNet ne trouve pas de « sujet » et rend 98 % de l'image À DEMI transparente — une image grise et
   délavée. 'uni' ou 'ia' imposés servent à REFAIRE avec l'autre méthode : la version détourée gardée
   n'est alors pas reprise, on recalcule depuis l'image d'origine. */
async function detourerMedia(pub, fichier, envoyer, voie, methode) {
  const m0 = (pub.medias || []).find(x => x.fichier === fichier);
  if (!m0) throw new Error('Cette image est introuvable dans la publication.');
  if (m0.detoure) throw new Error('Le fond de cette image est déjà supprimé.');
  const dm = path.join(dossierPub(pub.id), 'medias');
  const imposee = ['ia', 'uni'].includes(methode) ? methode : null;
  if (!imposee && m0.sansFond && fs.existsSync(path.join(dm, m0.sansFond))) return Object.assign(basculerFichierMedia(pub, m0, m0.sansFond), { credits: 0, transparent: true });

  const dire = msg => envoyer({ t: 'etape', message: msg });

  if (!detourageLocal()) throw new Error("Le détourage sur cet ordinateur n'est pas installé.");
  /* La voie locale : gratuite, hors ligne, et rien ne part chez personne. */
  {
    dire('Le studio supprime le fond sur votre ordinateur, sans rien dépenser...');
    const neufL = 'd' + Date.now().toString(36) + '.png';
    const r = await detourerEnLocal(path.join(dm, fichier), path.join(dm, neufL), imposee || 'auto');
    const transparentL = pngTransparent(path.join(dm, neufL));
    // Le détourage local ne passe PAS par Rendus : rien n'a été généré ni dépensé,
    // et l'image d'origine est à deux clics. L'historique des dépenses reste juste.
    const fraisL = lirePub(pub.id) || pub;
    const mL = (fraisL.medias || []).find(x => x.fichier === fichier);
    if (!mL) throw new Error("L'image a été retirée de la publication pendant le détourage.");
    mL.avecFond = mL.avecFond || fichier;
    mL.sansFond = neufL;
    mL.methodeFond = r.methode === 'uni' ? 'uni' : 'ia';     // l'application propose de refaire avec l'autre
    dire('Fond supprimé en ' + String(r.secondes).replace('.', ',') + ' s, sur votre ordinateur.');
    return Object.assign(basculerFichierMedia(fraisL, mL, neufL), { credits: 0, transparent: transparentL, local: true });
  }

}

// Remettre le fond, ou le retirer de nouveau : les deux fichiers existent, rien ne se dépense.
function remettreFond(pub, fichier, mode) {
  const m = (pub.medias || []).find(x => x.fichier === fichier);
  if (!m) throw new Error('Cette image est introuvable dans la publication.');
  const cible = mode === 'sans' ? m.sansFond : m.avecFond;
  if (!cible || !fs.existsSync(path.join(dossierPub(pub.id), 'medias', cible))) throw new Error("Cette version de l'image n'existe pas.");
  return basculerFichierMedia(pub, m, cible);
}

// La page d'une slide : ce que l'aperçu affiche, et ce que l'export photographie.
function pageDeSlide(pub, deck, n, projet) {
  const F = FORMATS_PUB[pub.genre];
  const da = pub.identiteId ? lireDA(pub.identiteId, pub.genre) : null;
  const p = (da && da.polices) || { titres: 'Sora', texte: 'Inter' };
  /* Les deux polices de la DA, PLUS toute police du studio employée dans le carrousel : l'éditeur de slide
     permet d'en choisir une autre pour un texte (23 septembre 2026), et sans ce chargement elle se serait
     vue dans l'éditeur mais pas à l'export. */
  const tout = String(deck && deck.css || '') + (deck && deck.slides || []).join('');
  const employees = policesConnues().filter(f => tout.indexOf(f) >= 0);
  const toutes = [p.titres, p.texte].concat(employees).filter((x, i, a) => a.indexOf(x) === i);
  // les polices de l'ordinateur viennent du studio (@font-face), pas de Google Fonts
  const familles = toutes.filter(f => !estPoliceLocale(f)).map(familleGoogle).join('&'), locales = cssPolicesLocales(toutes);
  const c = (da && da.couleurs) || {};
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    (familles ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + familles + '&display=block">' : '') +
    (locales ? '<style>' + locales + '</style>' : '') +
    '<style>html,body{margin:0;padding:0;background:' + (c.fond || '#0b0b0d') + '}' +
    'body{width:' + F.l + 'px;height:' + F.h + 'px;overflow:hidden;overflow:clip}html{overflow:clip}' +
    /* overflow:clip et non hidden seul : une boîte « hidden » se laisse encore FAIRE DÉFILER par le
       navigateur. En tapant un mot plus large que la slide, il la faisait glisser pour suivre le
       curseur, et tout semblait décalé (23 sept. 2026). clip coupe pareil, mais ne défile jamais. */
    // isolation : la slide est son propre plan d'empilement, un élément « passé derrière » reste devant son fond.
    '.slide{width:' + F.l + 'px;height:' + F.h + 'px;position:relative;overflow:hidden;overflow:clip;box-sizing:border-box;margin:0;isolation:isolate;' +
    'font-family:"' + p.texte + '",sans-serif;color:' + (c.texte || '#f2f2f2') + ';background:' + (c.fond || '#0b0b0d') + '}' +
    '.slide *{box-sizing:border-box}.slide img{display:block;max-width:100%}' +
    '.slide [contenteditable]:focus{outline:3px dashed rgba(249,115,22,.9);outline-offset:6px}</style>' +
    '<style>' + deck.css + '</style></head><body>' + (deck.slides[n - 1] || '') + '</body></html>';
}

/* ------------------------------------------------------------
   LE CONTRÔLE GÉOMÉTRIQUE DES SLIDES

   Claude compose en positions absolues sans jamais voir le résultat : il ne
   peut pas savoir où le texte retombe une fois la police chargée, ni ce qui
   finit par recouvrir quoi. La consigne lui dit « rien ne se chevauche »
   depuis toujours, et rien ne le vérifiait — le 21 septembre 2026, un titre
   se retrouvait recouvert à 58 % par la photo de sa propre slide, et peint
   dessous.

   Le studio rend donc chaque slide dans un navigateur sans fenêtre, y injecte
   app/js/audit-slide.js, relit son verdict, et renvoie à Claude la liste de ce
   qui ne va pas — avec les boîtes mesurées, pour qu'il corrige juste.
   ------------------------------------------------------------ */

function pageAuditSlide(pub, deck, n, projet) {
  let script = '';
  try { script = fs.readFileSync(path.join(RACINE, 'app', 'js', 'audit-slide.js'), 'utf8'); } catch (e) { return null; }
  const stories = pub.genre === 'stories';
  const reglages = { marge: stories ? 80 : 90, bandes: stories ? { haut: 250, bas: 340 } : null };
  const page = pageDeSlide(pub, deck, n, projet);
  return page.replace('</body>',
    '<script>window.PG_AUDIT=' + JSON.stringify(reglages) + ';</script><script>' + script + '</script></body>');
}

/* Une slide rendue puis mesurée. Le navigateur sans fenêtre écrit son verdict
   dans la page ; --dump-dom nous rend la page, et le verdict avec. */
function mesurerSlide(navigateur, adresse, l, h) {
  return new Promise(ok => {
    const profil = path.join(DOSSIER_CACHE, 'navigateur-audit');
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      /* La fenêtre doit faire la taille de la slide : sans --window-size, le navigateur sans fenêtre
         en prend une de 800 × 600, elementFromPoint ne répond plus au-delà, et le contrôle sous-estime
         gravement ce qui est recouvert (22 % relevés pour 78 % réels, le 21 septembre 2026). */
      '--force-device-scale-factor=1', '--window-size=' + l + ',' + h, '--virtual-time-budget=9000',
      '--user-data-dir=' + profil, '--dump-dom', adresse];
    const proc = spawn(navigateur, args, { windowsHide: true });
    let sortie = '';
    proc.stdout.on('data', d => { sortie += d.toString(); });
    proc.stderr.on('data', () => {});
    const minuteur = setTimeout(() => { try { proc.kill(); } catch (e) {} ok(null); }, 45000);
    proc.on('error', () => { clearTimeout(minuteur); ok(null); });
    proc.on('close', () => {
      clearTimeout(minuteur);
      const m = /@@AUDIT@@([A-Za-z0-9+/=]+)@@FIN@@/.exec(sortie);
      if (!m) return ok(null);
      try { ok(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))); } catch (e) { ok(null); }
    });
  });
}

/* Le relevé de toute la publication. Rend null si le contrôle n'a pas pu se
   faire (pas de navigateur, par exemple) : la composition n'en dépend jamais. */
async function auditerDeck(pub, deck, projet, dire, seulement) {
  const nav = trouverNavigateur();
  if (!nav) return null;
  const F = FORMATS_PUB[pub.genre];
  const base = 'http://127.0.0.1:' + PORT + '/pub/' + (projet || projetCourant()) + '/' + pub.id + '/audit/';
  const releve = [];
  for (let n = 1; n <= deck.slides.length; n++) {
    if (seulement && !seulement.includes(n)) continue;
    if (dire) dire('Le studio vérifie la ' + FORMATS_PUB[pub.genre].un + ' ' + n + ' sur ' + deck.slides.length + '…');
    const r = await mesurerSlide(nav, base + n, F.l, F.h);
    if (!r || r.erreur) continue;
    const graves = (r.soucis || []).filter(x => x.gravite === 'grave');
    const moyens = (r.soucis || []).filter(x => x.gravite !== 'grave');
    if (graves.length || moyens.length) releve.push({ n: n, graves: graves, moyens: moyens, boites: r.boites || [] });
  }
  return releve;
}

/* La réparation. On ne refait QUE les slides fautives, et on leur redonne leur
   propre CSS : Claude corrige des positions, il ne réinvente pas la série. */
async function reparerDeck(pub, deck, releve, ctx, dire, controle) {
  if (!releve || !releve.length) return deck;
  const F = ctx.F, N = deck.slides.length;
  const aRefaire = releve.filter(x => x.graves.length || x.moyens.length).slice(0, 8);
  if (!aRefaire.length) return deck;
  const consigne = [
    consigneMiseEnPage(pub, ctx, N, false),
    '',
    'ICI TU NE COMPOSES RIEN DE NEUF : TU RÉPARES.',
    'Le studio a rendu les ' + F.des + ' dans un vrai navigateur et les a MESURÉES. Ce qui suit n\'est pas un',
    'avis, ce sont des pixels relevés à l\'écran. Tu corriges CES défauts-là, et rien d\'autre : mêmes textes,',
    'mêmes images, mêmes couleurs, mêmes polices, même esprit de mise en page. Tu déplaces, tu redimensionnes,',
    'tu remets le texte APRÈS les images dans le HTML — tu ne redessines pas la ' + F.un + '.',
    '',
    'Tu rends, pour CHACUNE des ' + F.des + ' citées et pour elles seules :',
    '  <section class="slide" data-n="K">…</section>',
    'précédées d\'UN SEUL bloc <style> contenant les règles corrigées, chaque sélecteur préfixé par',
    '.slide[data-n="K"] pour ne toucher qu\'à sa ' + F.un + '. Rien d\'autre dans ta réponse.'
  ].join('\n');

  const question = [
    'LE CSS ACTUEL DE LA SÉRIE :', deck.css, '',
    aRefaire.map(x => [
      '========== ' + F.un.toUpperCase() + ' ' + x.n + ' ==========',
      'SON HTML ACTUEL :', deck.slides[x.n - 1], '',
      'CE QUE LE STUDIO A MESURÉ À L\'ÉCRAN (cadre de ' + F.l + ' × ' + F.h + 'px) :',
      x.boites.map(b => '  ' + b).join('\n'), '',
      'CE QUI NE VA PAS :',
      x.graves.concat(x.moyens).map((d, i) => '  ' + (i + 1) + '. ' + d.texte).join('\n')
    ].join('\n')).join('\n\n'),
    '', 'Répare ces ' + aRefaire.length + ' ' + F.des + '.'
  ].join('\n');

  if (dire) dire('Claude corrige ' + aRefaire.length + ' ' + (aRefaire.length > 1 ? F.des : F.un) + '…');
  const r = await interroger(question, consigne, null, 1, DELAI_GENERATION, { controle: controle, args: ARGS_MISE_EN_PAGE });
  const neuf = decouperDeck(r.texte || '');
  if (!neuf.slides.length) return deck;
  let posees = 0;
  neuf.slides.forEach(html => {
    const m = /data-n="(\d+)"/i.exec(html);
    const k = m ? Number(m[1]) : 0;
    if (k >= 1 && k <= N && aRefaire.some(x => x.n === k)) { deck.slides[k - 1] = html; posees++; }
  });
  if (!posees) return deck;
  if (neuf.css.trim()) deck.css += '\n/* corrections du contrôle géométrique */\n' + neuf.css;
  return deck;
}

/* Composer, mesurer, réparer, remesurer. Deux passes au plus : au-delà, on garde
   ce qu'on a plutôt que de faire attendre, et on dit ce qui reste. */
async function controlerEtReparer(pub, deck, ctx, projet, dire, controle, seulement) {
  let releve = null;
  try { releve = await auditerDeck(pub, deck, projet, dire, seulement); } catch (e) { return deck; }
  if (!releve) return deck;                     // pas de navigateur : on ne bloque rien
  if (!releve.length) { deck.controle = 'ok'; return deck; }
  try {
    deck = await reparerDeck(pub, deck, releve, ctx, dire, controle);
    ecrireDeck(pub.id, deck);
    const apres = await auditerDeck(pub, deck, projet, dire, seulement);
    if (apres && apres.length) {
      const graves = apres.reduce((n, x) => n + x.graves.length, 0);
      deck.controle = graves
        ? graves + ' défaut' + (graves > 1 ? 's' : '') + ' de mise en page subsistent (' +
          apres.filter(x => x.graves.length).map(x => ctx.F.un + ' ' + x.n).join(', ') + ') : retouchez-les à la main, ou demandez-en une autre version.'
        : 'ok';
    } else deck.controle = 'ok';
  } catch (e) { /* la réparation a échoué : on garde la composition, elle vaut mieux que rien */ }
  return deck;
}

/* ---------- L'export ---------- */

function trouverNavigateur() {
  const c = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const loc = process.env.LOCALAPPDATA || '';
    c.push(path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'));
    if (loc) c.push(path.join(loc, 'Google\\Chrome\\Application\\chrome.exe'));
    c.push(path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'));
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
           '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  } else {
    c.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  // celui que la page Installation pose quand le poste n'a ni Chrome ni Edge (Chrome for Testing)
  const m = path.join(RACINE, 'MOTEUR', 'navigateur');
  c.push(path.join(m, 'chrome-win64', 'chrome.exe'),
    path.join(m, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    path.join(m, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
  return c.find(x => { try { return fs.existsSync(x); } catch (e) { return false; } }) || null;
}

// Les dimensions d'un PNG, lues dans son en-tête.
function taillePng(fichier) {
  try {
    const fd = fs.openSync(fichier, 'r'), b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd);
    return { l: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch (e) { return null; }
}

// transparent : le fond de la page reste transparent dans le PNG (slides vidéo en plein cadre, voir exporterSlideVideo)
function photographier(navigateur, adresse, sortie, l, h, transparent) {
  return new Promise((ok, ko) => {
    // Un profil à part : sans lui, le navigateur passerait la demande à la
    // fenêtre du studio déjà ouverte et rendrait la main sans rien produire.
    const profil = path.join(DOSSIER_CACHE, 'navigateur-export');
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--force-device-scale-factor=1', '--window-size=' + l + ',' + h, '--virtual-time-budget=8000',
      '--user-data-dir=' + profil, '--screenshot=' + sortie, adresse];
    if (transparent) args.splice(1, 0, '--default-background-color=00000000');
    const proc = spawn(navigateur, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    const minuteur = setTimeout(() => { proc.kill(); ko(new Error("L'export d'une slide a pris trop de temps.")); }, 60000);
    proc.on('error', e => { clearTimeout(minuteur); ko(new Error('Le navigateur ne démarre pas : ' + e.message)); });
    proc.on('close', () => {
      clearTimeout(minuteur);
      if (fs.existsSync(sortie)) ok(); else ko(new Error("Le navigateur n'a pas produit l'image." + (err ? ' ' + err.trim().split('\n').pop() : '')));
    });
  });
}

/* Une publication est TERMINÉE quand son export existe : le dossier export/ et son .zip. Toute
   retouche l'écarte (ecarterExports), et la publication redevient « en cours » d'elle-même :
   l'état ne peut pas mentir, il se lit sur le disque. */
function infoExport(id, projet) {
  const d = path.join(dossierPub(id, projet), 'export');
  let noms = [];
  try { noms = fs.readdirSync(d); } catch (e) { return null; }
  const zip = noms.find(n => n.toLowerCase().endsWith('.zip'));
  const images = noms.filter(n => n.toLowerCase().endsWith('.png')).sort();
  const videos = noms.filter(n => n.toLowerCase().endsWith('.mp4')).sort();   // les slides vidéo (exporterSlideVideo)
  if (!zip || !(images.length + videos.length)) return null;
  const racineUrl = '/pub/' + (projet || projetCourant()) + '/' + id + '/export/';
  let date = null;
  try { date = fs.statSync(path.join(d, zip)).mtime.toISOString(); } catch (e) {}
  return { dossier: d, zip: racineUrl + encodeURIComponent(zip), nomZip: zip, images: images.map(n => racineUrl + encodeURIComponent(n)),
    videos: videos.map(n => racineUrl + encodeURIComponent(n)), fichiers: images.concat(videos).sort().map(n => racineUrl + encodeURIComponent(n)), date: date };
}

function ecarterExports(id) {
  const d = path.join(dossierPub(id), 'export');
  if (!fs.existsSync(d)) return;
  try { fs.renameSync(d, path.join(dossierPub(id), '_export-' + Date.now().toString(36))); } catch (e) {}
}

/* Les exports mis de côté (voir majExports) : les trois plus récents suffisent à reprendre un aller-retour.
   Sans limite, chaque retouche suivie d'un export en ajoutait un dossier entier de PNG, pour toujours.
   Un export se refait gratuitement : rien de précieux ne part. À appeler APRÈS une éventuelle reprise. */
const EXPORTS_GARDES = 3;
function elaguerExports(id) {
  let noms = [];
  try { noms = fs.readdirSync(dossierPub(id)).filter(n => n.indexOf('_export-') === 0); } catch (e) { return; }
  noms.sort((a, b) => parseInt(b.slice(8), 36) - parseInt(a.slice(8), 36)).slice(EXPORTS_GARDES)
    .forEach(n => { try { fs.rmSync(path.join(dossierPub(id), n), { recursive: true, force: true }); } catch (e) {} });
}

/* UN ALLER-RETOUR NE DOIT RIEN COÛTER.

   Toute modification d'une slide écarte les images déjà exportées : elles ne
   lui correspondent plus. C'est juste — mais on revient souvent d'où l'on
   vient. On remet le fond d'une image puis on le retire de nouveau ; on
   déplace un bloc puis on annule. Les slides redeviennent EXACTEMENT ce
   qu'elles étaient, et pourtant il fallait tout réexporter, pour rien.

   Chaque export emporte donc l'empreinte du deck qui l'a produit. Dès que le
   deck redevient identique à l'un des exports mis de côté, on le reprend.
   L'empreinte ignore le champ controle : c'est un verdict sur la mise en
   page, il ne change aucune image. */
function empreinteDeck(id) {
  const d = lireDeck(id);
  if (!d) return null;
  // les réglages des vidéos en font partie : une vidéo recoupée change le MP4 exporté sans changer le HTML
  const v = signatureVideos((lirePub(id) || {}).plan);
  return require('crypto').createHash('sha256')
    .update(JSON.stringify([d.css || '', d.slides || []].concat(v ? [v] : []))).digest('hex');
}
const signatureVideos = plan => JSON.stringify(((plan && plan.slides) || []).filter(s => s.video).map(s => s.video)).replace(/^\[\]$/, '');

function empreinteExport(id, nom) {
  try { return fs.readFileSync(path.join(dossierPub(id), nom, 'empreinte.txt'), 'utf8').trim() || null; }
  catch (e) { return null; }
}

/* À appeler APRÈS avoir écrit le deck, à la place d'ecarterExports. */
function majExports(id) {
  const emp = empreinteDeck(id);
  if (emp && empreinteExport(id, 'export') === emp) return;     // l'export correspond déjà : on n'y touche pas
  let noms = [];
  try { noms = fs.readdirSync(dossierPub(id)); } catch (e) { noms = []; }
  const repris = emp ? noms.filter(n => n.indexOf('_export-') === 0).sort().reverse()
                           .find(n => empreinteExport(id, n) === emp) : null;
  ecarterExports(id);
  if (repris) {
    try { fs.renameSync(path.join(dossierPub(id), repris), path.join(dossierPub(id), 'export')); } catch (e) {}
  }
  elaguerExports(id);
}

// Un .zip sans compression : des PNG ne se compressent plus.
const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function ecrireZip(sortie, fichiers) {
  const morceaux = [], centrale = [];
  let decalage = 0;
  fichiers.forEach(f => {
    const data = fs.readFileSync(f.chemin), nom = Buffer.from(f.nom, 'utf8'), crc = crc32(data);
    const tete = Buffer.alloc(30);
    tete.writeUInt32LE(0x04034b50, 0); tete.writeUInt16LE(20, 4); tete.writeUInt16LE(0x0800, 6); tete.writeUInt16LE(0, 8);
    tete.writeUInt16LE(0, 10); tete.writeUInt16LE(0x21, 12); tete.writeUInt32LE(crc, 14);
    tete.writeUInt32LE(data.length, 18); tete.writeUInt32LE(data.length, 22); tete.writeUInt16LE(nom.length, 26); tete.writeUInt16LE(0, 28);
    morceaux.push(tete, nom, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(0, 30); c.writeUInt32LE(0, 34); c.writeUInt32LE(0, 38); c.writeUInt32LE(decalage, 42);
    centrale.push(c, nom);
    decalage += 30 + nom.length + data.length;
  });
  const tailleCentrale = centrale.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleCentrale, 12); fin.writeUInt32LE(decalage, 16);
  fs.writeFileSync(sortie, Buffer.concat(morceaux.concat(centrale, [fin])));
}

/* ============================================================
   LES SLIDES VIDÉO (27 sept. 2026 ; maquette LABO/slides-video)

   Instagram accepte des vidéos dans un carrousel et dans les stories. Une slide peut donc porter UNE vidéo
   (le troisième choix de « Ce qu'on y voit »), POSÉE dans la mise en page ou EN PLEIN CADRE sous le texte.
   · La vidéo vient des rendus du studio ou de l'ordinateur ; elle est COPIÉE dans PUBLICATIONS/<id>/videos/<vid>.mp4.
     Rien ne se génère : c'est gratuit.
   · Claude ne voit jamais la vidéo : il place son IMAGE (medias/affiche-<vid>.jpg, un média marqué videoId), comme une
     photo. C'est l'adresse de cette image qui désigne, dans la slide, la place de la vidéo — aucun attribut à écrire.
   · Les aperçus du studio (?video=1) remplacent cette image par un extrait muet qui tourne en boucle (<vid>-extrait.mp4).
     L'éditeur de slide, lui, garde l'image : ce qu'il enregistre reste la slide telle que Claude l'a écrite.
   · L'export : la slide est photographiée, puis ffmpeg (sur le poste, gratuit) y met la vidéo et sort un MP4 de la taille
     de la slide. Posée : la vidéo PAR-DESSUS la photo, à la place exacte de l'image (coins arrondis compris). Plein cadre :
     la slide est photographiée TROUÉE (fond transparent, l'image masquée) et la vidéo passe DESSOUS — le texte et le voile
     restent devant. La place de l'image est lue dans le navigateur du poste (--dump-dom), comme le contrôle géométrique.
   ============================================================ */
const ID_VIDEO = /^v[a-z0-9]{6,20}$/;
const VIDEO_MAX_OCTETS = 500e6, VIDEO_DUREE_MAX = 60, VIDEO_DUREE_DEFAUT = 15;
const dossierVideosPub = (id, projet) => path.join(dossierPub(id, projet), 'videos');
const ffmpegDuPoste = () => lireReglages().ffmpeg || 'ffmpeg';
const ffprobeDuPoste = () => lireReglages().ffprobe || 'ffprobe';
function executer(prog, args, delai) {
  return new Promise((ok, ko) => {
    const p = spawn(prog, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); if (err.length > 20000) err = err.slice(-8000); });
    p.stdout.on('data', () => {});
    const t = setTimeout(() => { try { p.kill(); } catch (e) {} ko(new Error(path.basename(prog) + ' a pris trop de temps.')); }, delai || 180000);
    p.on('error', e => { clearTimeout(t); ko(new Error(path.basename(prog) + ' ne démarre pas : ' + e.message)); });
    p.on('close', code => { clearTimeout(t); if (code) ko(new Error((err.trim().split('\n').pop() || path.basename(prog) + ' a échoué').slice(0, 300))); else ok(); });
  });
}
function sonderVideo(f) {
  const r = require('child_process').spawnSync(ffprobeDuPoste(), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f], { encoding: 'utf8', windowsHide: true });
  let j = {}; try { j = JSON.parse(r.stdout || '{}'); } catch (e) {}
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  if (!v) throw new Error("Ce fichier n'est pas une vidéo lisible.");
  return { duree: Math.round(Number((j.format || {}).duration || 0) * 100) / 100, l: v.width, h: v.height, son: (j.streams || []).some(s => s.codec_type === 'audio') };
}
// l'aperçu entier (la pellicule de la page), l'extrait muet (les vignettes), l'image de la vidéo (pour Claude)
async function fabriquerApercusVideo(pubId, vid, de, a, entier) {
  const dv = dossierVideosPub(pubId), src = path.join(dv, vid + '.mp4'), dm = path.join(dossierPub(pubId), 'medias');
  fs.mkdirSync(dm, { recursive: true });
  const reduit = ['-vf', "scale='min(720,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
  if (entier) await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-i', src].concat(reduit, [path.join(dv, vid + '-apercu.mp4')]));
  await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-ss', String(de), '-t', String(Math.max(0.2, a - de)), '-i', src].concat(reduit, [path.join(dv, vid + '-extrait.mp4')]));
  await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-ss', String(de), '-i', src, '-frames:v', '1', '-vf', "scale='min(1080,iw)':-2", '-q:v', '3', path.join(dm, 'affiche-' + vid + '.jpg')]);
}
/* LA BIBLIOTHÈQUE DE GIF (30 sept. 2026 : ses carrousels ont des cartes « Toi.GIF », « MoiEnCeMoment.GIF » ; « une
   banque de GIF ? ») : commune au studio, comme les sons — GIFS/bibliotheque.json et les fichiers dans GIFS/ (jamais livrés :
   ce sont les GIF de la personne). Chaque GIF est converti en MP4 muet (H.264 : Instagram et le navigateur le lisent) avec son
   image (.jpg), un nom et « quand l'utiliser » (une émotion, une réaction) que Claude lit pour choisir. GIPHY (recherche) se
   branche par une clé gratuite de la personne, rangée HORS de l'outil (%USERPROFILE%/.storymatic/giphy.key), jamais
   renvoyée à la page. Posé sur une slide, un GIF devient une vidéo de la publication (ajouterVideoPub, { gif }), bouclée
   jusqu'à 4 s au moins, et la slide porte « gif » : le nom de sa carte (« Toi » → « Toi.GIF »). */
const DOSSIER_GIFS = path.join(RACINE, 'GIFS'), F_GIFS = path.join(DOSSIER_GIFS, 'bibliotheque.json');
const F_CLE_GIPHY = path.join(require('os').homedir(), '.storymatic', 'giphy.key');
// les GIF d'une sous-DA (à plat) : ceux de sa liste, présents dans la bibliothèque — aucun sans DA ou sans liste
const gifsDeDA = da => { const ids = (da && Array.isArray(da.gifs)) ? da.gifs : []; return ids.length ? lireGifs().filter(g => ids.includes(g.id)) : []; };
const lireGifs = () => { try { return (JSON.parse(fs.readFileSync(F_GIFS, 'utf8')).gifs || []).filter(g => g && g.id && !g.retire); } catch (e) { return []; } };
function ecrireGifs(l) { fs.mkdirSync(DOSSIER_GIFS, { recursive: true }); ecrireJsonSurement(F_GIFS, { gifs: l }); }
const cleGiphy = () => { try { return fs.readFileSync(F_CLE_GIPHY, 'utf8').trim() || null; } catch (e) { return null; } };
async function ajouterGif(src, d) {
  fs.mkdirSync(DOSSIER_GIFS, { recursive: true });
  const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), mp4 = id + '.mp4', jpg = id + '.jpg';
  await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-i', src, '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', path.join(DOSSIER_GIFS, mp4)], 300000);
  await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-i', path.join(DOSSIER_GIFS, mp4), '-frames:v', '1', '-q:v', '3', path.join(DOSSIER_GIFS, jpg)]);
  const info = sonderVideo(path.join(DOSSIER_GIFS, mp4));
  const g = { id: id, nom: String(d.nom || 'GIF').replace(/\.(gif|mp4|webm|mov)$/i, '').trim().slice(0, 60) || 'GIF', quand: String(d.quand || '').trim().slice(0, 300),
    fichier: mp4, image: jpg, l: info.l, h: info.h, duree: info.duree, source: d.source || 'fichier', giphy: d.giphy || undefined, ajoute: new Date().toISOString() };
  ecrireGifs(lireGifs().concat([g]));
  return g;
}
function majGif(id, d) {
  let l = []; try { l = JSON.parse(fs.readFileSync(F_GIFS, 'utf8')).gifs || []; } catch (e) {}
  const g = l.find(x => x.id === id); if (!g) throw new Error('Ce GIF est introuvable.');
  if (d.retirer) g.retire = true;   // rien n'est effacé : le GIF reste dans GIFS/, caché
  if (typeof d.nom === 'string' && d.nom.trim()) g.nom = d.nom.trim().slice(0, 60);
  if (typeof d.quand === 'string') g.quand = d.quand.trim().slice(0, 300);
  ecrireGifs(l);
  return { gifs: lireGifs() };
}
async function chercherGiphy(q, limite) {
  const cle = cleGiphy(); if (!cle) throw new Error("GIPHY n'est pas branché : posez d'abord votre clé.");
  const u = 'https://api.giphy.com/v1/gifs/search?api_key=' + encodeURIComponent(cle) + '&q=' + encodeURIComponent(String(q || '').slice(0, 80)) + '&limit=' + (limite || 24) + '&rating=pg-13&lang=en';   // les recherches sont en anglais (« lang=fr » appauvrissait les résultats)
  const r = await fetch(u); if (!r.ok) throw new Error('GIPHY a répondu ' + r.status + (r.status === 401 || r.status === 403 ? ' : la clé est refusée.' : '.'));
  const j = await r.json();
  return { resultats: (j.data || []).map(x => { const i = x.images || {}, o = i.original || {}, a = i.fixed_width || {};
    return { id: x.id, titre: String(x.title || '').slice(0, 80), apercu: a.mp4 || a.webp || a.url, apercuMp4: a.mp4, mp4: o.mp4, l: Number(o.width) || 0, h: Number(o.height) || 0 }; }).filter(x => x.mp4) };
}
/* DES GIF PERTINENTS (7 oct. 2026 : des GIF pertinents par rapport aux stories) :
   au plan, Claude écrit pour une slide des mots de recherche GIPHY (« gif.chercher ») ; le studio cherche, fait pour chaque slide
   une PLANCHE des candidats (une ligne par GIF : trois images, début, milieu, fin), et Claude la REGARDE pour choisir celui qui
   sert la phrase. Le GIF retenu entre dans la bibliothèque (déjà pris une fois : réemployé, pas retéléchargé).
   Rien ne se paie : GIPHY gratuit (clé « beta » : 100 recherches par heure), Claude sur l'abonnement.
   demandes : [{ n, chercher, titre, texte }] → { <n>: id du GIF dans la bibliothèque } ; une slide sans choix n'y est pas. */
const GIPHY_CANDIDATS = 8;
// « ✦ GIF pour cette slide » (bloc GIF de la page) : Claude lit la slide et rend les mots de recherche GIPHY (≈ 10 s, gratuit)
async function motsGifSlide(pub, d) {
  const F = FORMATS_PUB[pub.genre];
  const consigne = 'Tu trouves la recherche GIPHY d\'un GIF de réaction pour une ' + F.un + ' Instagram. Ici RIEN ne se génère : tu n\'appelles aucun outil.\n' +
    '1 à 3 mots EN ANGLAIS, les mots COURANTS des tags GIPHY, qui décrivent l\'ÉMOTION ou la situation que la phrase appelle (la cible qui se reconnaît, une vanne, un choc), jamais le sujet technique : « exhausted », « mind blown », « facepalm », « so tired », « waiting ».\n' +
    'Tu réponds UNIQUEMENT du JSON strict : {"chercher":"…"}';
  const q = F.un.toUpperCase() + '\n  titre : ' + String(d.titre || '').slice(0, 200) + '\n  texte : ' + String(d.texte || '').slice(0, 400) +
    (d.autres ? '\nDÉJÀ PRIS AILLEURS (à ne pas reprendre) : ' + String(d.autres).slice(0, 300) : '');
  const r = await interroger(q, consigne, null, 1, DELAI_MAX);
  let j = null; try { j = JSON.parse(premierObjetJson(r.texte || '')); } catch (e) {}
  const c = j && String(j.chercher || '').replace(/[<>"]/g, '').trim().slice(0, 60);
  if (!c) throw new Error("Claude n'a pas trouvé de mots de recherche. Réessayez.");
  return { chercher: c };
}
async function choisirGifsGiphy(pub, F, demandes) {
  const travail = path.join(DOSSIER_CACHE, 'giphy-choix-' + Date.now().toString(36));
  fs.mkdirSync(travail, { recursive: true });
  // les GIF déjà sur cette publication ne reviennent pas
  const deja = new Set(lireGifs().filter(g => g.giphy && (pub.videos || []).some(v => v.gif === g.id)).map(g => g.giphy));
  try {
    const slides = await Promise.all(demandes.map(async (d, k) => {
      let cands = [];
      try { cands = (await chercherGiphy(d.chercher, GIPHY_CANDIDATS + 4)).resultats.filter(x => x.apercuMp4 && !deja.has(x.id)).slice(0, GIPHY_CANDIDATS); } catch (e) { return null; }
      const lignes = [];
      for (let c = 0; c < cands.length; c++) {
        const src = path.join(travail, k + '-' + c + '.mp4'), lg = path.join(travail, k + '-' + c + '.jpg');
        try {
          const r = await fetch(cands[c].apercuMp4); if (!r.ok) continue;
          fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
          const duree = Math.max(0.3, Number(sonderVideo(src).duree) || 1);
          await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-i', src, '-vf', 'fps=3/' + duree.toFixed(2) +
            // des tailles PAIRES : en yuv420p, pad arrondit une hauteur impaire vers le bas et refuse (« Padded dimensions cannot be smaller »)
            ',scale=220:164:force_original_aspect_ratio=decrease,setsar=1,pad=220:164:(ow-iw)/2:(oh-ih)/2:white,tile=3x1:padding=6:color=white,pad=iw+12:ih+16:6:8:0x333333',
            '-frames:v', '1', lg]);
          if (fs.existsSync(lg)) lignes.push({ fichier: lg, cand: cands[c] });
        } catch (e) {}
      }
      if (!lignes.length) return null;
      const planche = path.join(travail, 'planche-' + d.n + '.jpg');
      if (lignes.length === 1) fs.copyFileSync(lignes[0].fichier, planche);
      else await executer(ffmpegDuPoste(), ['-v', 'error', '-y'].concat(...lignes.map(l => ['-i', l.fichier]), ['-filter_complex', 'vstack=inputs=' + lignes.length, '-q:v', '3', planche]));
      return { d, planche, cands: lignes.map(l => l.cand) };
    }));
    const prets = slides.filter(Boolean);
    if (!prets.length) return {};
    const consigne = [
      'Tu choisis des GIF de réaction pour des ' + F.des + ' Instagram. Ici RIEN ne se génère : tu n\'appelles aucun outil de génération.',
      'Pour chaque ' + F.un + ', une PLANCHE : une ligne par GIF candidat, numérotées de 1 (en haut) à N (en bas), trois images de chacun (début, milieu, fin). Ouvre CHAQUE planche avec Read.',
      'Choisis le GIF qui sert le mieux la phrase de la ' + F.un + ' : l\'émotion juste, comprise en une seconde, qui fait sourire ou se reconnaître.',
      'La carte dit QUI réagit (« carte ») : « Moi… » = le créateur lui-même, tel qu\'il se décrit dans ses textes (son genre, son âge, sa vie) — le GIF montre quelqu\'un qui pourrait être lui, ou un personnage neutre (animal, dessin animé) ; jamais quelqu\'un qui le contredit (un enfant, une écolière, l\'autre genre). « Toi » = le lecteur : quelqu\'un dans la situation qu\'il vit.',
      'Écarte : un GIF dont le texte incrusté (souvent en anglais) dit autre chose que la phrase, un logo de chaîne, de série ou de marque (filigrane dans un coin compris) quand un autre candidat n\'en a pas, du sexe, de la violence, un sujet triste ou choquant, une image floue ou illisible en petit.',
      '« gif » : 0 si aucun ne montre la réaction cherchée — mieux vaut pas de GIF qu\'un GIF à côté de l\'émotion (un personnage qui sourit pour « épuisé », c\'est 0). Jamais le même GIF (même titre, même scène) pour deux ' + F.des + '. « secours » : ton deuxième choix (0 s\'il n\'y en a pas).',
      'Tu réponds UNIQUEMENT du JSON strict, sur une ligne : {"choix":[{"slide":<numéro>,"gif":<numéro de ligne>,"secours":<numéro de ligne>}]}'
    ].join('\n');
    const q = prets.map(p => F.un.toUpperCase() + ' ' + p.d.n + '\n  titre : ' + (p.d.titre || '') + '\n  texte : ' + (p.d.texte || '(aucun)') +
      '\n  carte : « ' + (p.d.nom || 'Toi') + '.GIF »\n  réaction cherchée : ' + p.d.chercher + '\n  planche : ' + p.planche + '\n  candidats : ' + p.cands.map((c, i) => (i + 1) + '. ' + (c.titre || 'sans titre')).join(' | ')).join('\n\n') +
      '\n\nChoisis un GIF par ' + F.un + '.';
    const r = await interroger(q, consigne, null, 1, DELAI_MAX);
    let j = null; try { j = JSON.parse(premierObjetJson(r.texte || '')); } catch (e) {}
    const choix = (j && Array.isArray(j.choix)) ? j.choix : [];
    const sortie = {}, pris = new Set();
    for (const p of prets) {
      const c = choix.find(x => Number(x.slide) === p.d.n) || {};
      const cand = [c.gif, c.secours].map(x => p.cands[Number(x) - 1]).find(x => x && !pris.has(x.id));
      if (!cand) continue;
      pris.add(cand.id);
      try {
        const g = lireGifs().find(x => x.giphy === cand.id) ||
          await ajouterDeGiphy({ id: cand.id, mp4: cand.mp4, titre: cand.titre, nom: p.d.chercher, quand: p.d.chercher });
        sortie[p.d.n] = { id: g.id, recherche: p.d.chercher };
      } catch (e) {}
    }
    // le compte rendu du dernier choix (pour comprendre une slide restée sans GIF)
    try { fs.writeFileSync(path.join(DOSSIER_CACHE, 'giphy-dernier-choix.json'), JSON.stringify({ le: new Date().toISOString(), pub: pub.id,
      demandes: demandes, trouves: prets.map(p => ({ n: p.d.n, candidats: p.cands.map(c => c.titre) })), choix: choix, poses: sortie }, null, 2)); } catch (e) {}
    return sortie;
  } finally { try { fs.rmSync(travail, { recursive: true, force: true }); } catch (e) {} }
}
async function ajouterDeGiphy(d) {
  const u = String(d.mp4 || '');
  if (!/^https:\/\/media\d*\.giphy\.com\//i.test(u)) throw new Error('Adresse GIPHY invalide.');
  const r = await fetch(u); if (!r.ok) throw new Error('GIPHY : téléchargement refusé (' + r.status + ').');
  const tmp = path.join(DOSSIER_CACHE, 'giphy-' + Date.now().toString(36) + '.mp4'); fs.mkdirSync(DOSSIER_CACHE, { recursive: true });
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  try { return await ajouterGif(tmp, { nom: d.nom || d.titre, quand: d.quand, source: 'giphy', giphy: String(d.id || '').slice(0, 40) }); }
  finally { try { fs.rmSync(tmp, { force: true }); } catch (e) {} }
}

/* Ajouter une vidéo à la publication : `source` = { gif: <id de la bibliothèque> } ou
   { fichier: <chemin d'un fichier reçu> , nom }. Rend la fiche de la vidéo, et la publication. */
async function ajouterVideoPub(pub, source) {
  const vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const dv = dossierVideosPub(pub.id), cible = path.join(dv, vid + '.mp4');
  fs.mkdirSync(dv, { recursive: true });
  let nom = 'Ma vidéo', gifId = null;
  if (source.gif) {
    // un GIF de la bibliothèque : bouclé jusqu'à 4 s au moins (une vidéo de carrousel trop courte passe mal)
    const g = lireGifs().find(x => x.id === source.gif); if (!g) throw new Error('Ce GIF est introuvable dans la bibliothèque.');
    nom = g.nom; gifId = g.id;
    const src = path.join(DOSSIER_GIFS, g.fichier), t = Math.max(4, Number(g.duree) || 0);
    await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-stream_loop', '-1', '-i', src, '-t', String(t), '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', cible], 300000);
  } else {
    nom = String(source.nom || 'Ma vidéo').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60) || 'Ma vidéo';
    // mov d'un téléphone (HEVC), webm… : tout repasse en H.264, que le navigateur et Instagram lisent
    await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-i', source.fichier, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', cible], 600000);
  }
  const info = sonderVideo(cible);
  if (info.duree < 0.5) throw new Error('Cette vidéo est trop courte.');
  const a = Math.min(info.duree, VIDEO_DUREE_DEFAUT);
  await fabriquerApercusVideo(pub.id, vid, 0, a, true);
  const frais = lirePub(pub.id) || pub;
  frais.videos = (frais.videos || []).concat([Object.assign({ id: vid, nom: String(nom).slice(0, 80) }, info, gifId ? { gif: gifId } : {})]);
  frais.medias = (frais.medias || []).concat([{ fichier: 'affiche-' + vid + '.jpg', nom: 'Vidéo — ' + String(nom).slice(0, 60), note: '', origine: 'plan', videoId: vid }]);
  const p = ecrirePub(frais);
  return { video: Object.assign({ id: vid, de: 0, a: a }, frais.videos.find(x => x.id === vid)), pub: p };
}
// Le moment gardé change : l'extrait et l'image suivent (l'adresse de l'image ne change pas : la slide composée reste juste)
async function couperVideoPub(pub, vid, de, a) {
  const v = (pub.videos || []).find(x => x.id === vid); if (!v) throw new Error('Cette vidéo est introuvable.');
  de = Math.max(0, Math.min(Number(de) || 0, v.duree - 0.5)); a = Math.min(v.duree, Math.max(de + 0.5, Number(a) || v.duree));
  if (a - de > VIDEO_DUREE_MAX) a = de + VIDEO_DUREE_MAX;
  await fabriquerApercusVideo(pub.id, vid, de, a, false);
  return { de, a };
}
// les réglages d'une vidéo dans le plan (planPropre)
function videoDeSlide(v, pub) {
  if (!v || !ID_VIDEO.test(String(v.id || ''))) return null;
  const f = pub && (pub.videos || []).find(x => x.id === v.id), max = f ? f.duree : VIDEO_DUREE_MAX;
  const de = Math.max(0, Math.min(Number(v.de) || 0, max));
  const a = Math.min(max, Math.max(de + 0.5, Number(v.a) || max));
  // le cadrage : quelle partie de la vidéo se voit dans son cadre (object-position, en %) — (27 sept. 2026)
  const pc = x => Math.max(0, Math.min(100, Math.round(Number(x))));
  const cadrage = v.cadrage && isFinite(v.cadrage.x) && isFinite(v.cadrage.y) ? { x: pc(v.cadrage.x), y: pc(v.cadrage.y) } : { x: 50, y: 50 };
  // la forme du cadre (posée) : « libre » (Claude la choisit, la vidéo s'y recadre) ou « video » (ses proportions exactes, rien de coupé)
  const o = { id: v.id, plein: !!v.plein, de: Math.round(de * 100) / 100, a: Math.round(Math.min(a, de + VIDEO_DUREE_MAX) * 100) / 100, son: !!v.son, cadrage,
    forme: v.forme === 'video' ? 'video' : 'libre' };
  // un GIF (30 sept. 2026) : le nom de sa carte, « Toi » → « Toi.GIF »
  if (v.gif) o.gif = String(v.gif).replace(/\.gif$/i, '').replace(/[<>"]/g, '').trim().slice(0, 40) || 'GIF';
  // les mots GIPHY qui l'ont trouvé (7 oct. 2026) : « changer de GIF » relance cette recherche
  if (v.gif && v.recherche) o.recherche = String(v.recherche).replace(/[<>"]/g, '').trim().slice(0, 60);
  return o;
}
// Les aperçus : l'image de la vidéo devient l'extrait muet, en boucle (page de slide servie avec ?video=1)
function slideAvecVideos(html, projet, pubId, pub, n) {
  /* la page n'exécute aucun script : le navigateur montre alors d'office les commandes de lecture (règle HTML) — masquées.
     Le cadrage de la vidéo de CETTE slide (la même vidéo peut servir ailleurs, autrement cadrée) passe par une règle CSS. */
  const s = pub && pub.plan && pub.plan.slides[n - 1], c = s && s.video && s.video.cadrage;
  const cadre = c ? 'video[src*="/' + s.video.id + '-extrait.mp4"]{object-position:' + c.x + '% ' + c.y + '%!important}' : '';
  /* l'image devient une <video> : les règles écrites pour elle (« .gif img{width:100%;aspect-ratio:…} ») ne la visaient plus, et
     l'aperçu montrait la carte GIF plus haute que l'éditeur et l'export (7 oct. 2026). Chaque règle qui vise img est doublée pour video. */
  const pourVideo = css => css.replace(/([^{}]+)\{([^{}]*)\}/g, (regle, sel, decl) => {
    if (/^\s*@/.test(sel)) return regle;
    const parts = sel.split(',').map(p => p.replace(/(^|[\s>+~(])img(?=$|[\s.#:\[>+~)])/g, '$1video')).filter((p, k) => p !== sel.split(',')[k]);
    return parts.length ? regle + parts.join(',') + '{' + decl + '}' : regle;
  });
  html = String(html).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (t, a, css, b) => a + pourVideo(css) + b);
  return html.replace('</head>', '<style>video::-webkit-media-controls,video::-webkit-media-controls-enclosure,video::-webkit-media-controls-panel{display:none!important}' + cadre + '</style></head>').replace(/<img\b([^>]*?)\bsrc="([^"]*\/medias\/affiche-(v[a-z0-9]{6,20})\.jpg)"([^>]*)>/gi, (tout, av, src, vid, ap) =>
    '<video' + av + 'src="/pub/' + projet + '/' + pubId + '/videos/' + vid + '-extrait.mp4" poster="' + src + '" autoplay muted loop playsinline' + ap.replace(/\s*\/$/, '') + '></video>');
}
// La page qui MESURE la place de la vidéo (et, pour le plein cadre, masque l'image et rend le fond transparent) : navigateur du poste seulement
/* « dessus » (7 oct. 2026) : la page ne montre QUE ce qui est peint AU-DESSUS de la vidéo (relevé par elementsFromPoint sur une grille de
   points de son cadre), sur un fond transparent ; l'export le pose par-dessus la vidéo. Le reste de la slide est en dessous. */
const SCRIPT_DESSUS = 'var sec=document.querySelector("section")||document.body,b=i.getBoundingClientRect(),dessus=[];' +
  'for(var gx=0;gx<16;gx++)for(var gy=0;gy<16;gy++){var px=b.left+(gx+.5)*b.width/16,py=b.top+(gy+.5)*b.height/16,pile=document.elementsFromPoint(px,py),k=pile.indexOf(i);' +
  'if(k<0)continue;for(var j=0;j<k;j++){var e=pile[j];if(e!==sec&&sec.contains(e)&&dessus.indexOf(e)<0)dessus.push(e);}}' +
  'var st=document.createElement("style");st.textContent="section, section *{visibility:hidden !important}";document.head.appendChild(st);' +
  'dessus.forEach(function(e){e.style.setProperty("visibility","visible","important");[].forEach.call(e.querySelectorAll("*"),function(x){x.style.setProperty("visibility","visible","important");});});' +
  'r.dessus=dessus.length;';
function pageVideoSlide(pub, deck, n, projet, vid, trou, dessus) {
  const script = '(function(){var i=[].find.call(document.images,function(x){return x.src.indexOf("/affiche-' + vid + '.jpg")>=0});var r=null;' +
    'if(i){var b=i.getBoundingClientRect(),c=getComputedStyle(i);r={x:Math.round(b.left),y:Math.round(b.top),l:Math.round(b.width),h:Math.round(b.height),rayon:parseFloat(c.borderTopLeftRadius)||0,' +
    'fit:c.objectFit,pos:c.objectPosition};' + (trou ? 'i.style.visibility="hidden";for(var e=i.parentElement;e;e=e.parentElement){e.style.setProperty("background","transparent","important");}' : '') + (dessus ? SCRIPT_DESSUS : '') + '}' +
    'var d=document.createElement("pre");d.textContent="@@VIDEO@@"+btoa(JSON.stringify(r))+"@@FIN@@";d.style.display="none";document.body.appendChild(d);})();';
  const page = pageDeSlide(pub, deck, n, projet);
  return (trou || dessus ? page.replace('<style>html,body{margin:0;padding:0;background:', '<style>html,body{margin:0;padding:0;background:transparent!important;--fond-slide:') : page)
    .replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){' + script + '},300)});</script></body>');
}
function lireDansLaPage(navigateur, adresse, l, h) {
  return new Promise(ok => {
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--force-device-scale-factor=1', '--window-size=' + l + ',' + h, '--virtual-time-budget=9000',
      '--user-data-dir=' + path.join(DOSSIER_CACHE, 'navigateur-audit'), '--dump-dom', adresse];
    const proc = spawn(navigateur, args, { windowsHide: true });
    let sortie = '';
    proc.stdout.on('data', d => { sortie += d.toString(); });
    proc.stderr.on('data', () => {});
    const t = setTimeout(() => { try { proc.kill(); } catch (e) {} ok(null); }, 45000);
    proc.on('error', () => { clearTimeout(t); ok(null); });
    proc.on('close', () => { clearTimeout(t); const m = /@@VIDEO@@([A-Za-z0-9+/=]+)@@FIN@@/.exec(sortie);
      try { ok(m ? JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) : null); } catch (e) { ok(null); } });
  });
}
// un masque en niveaux de gris (PNG), blanc dans un rectangle aux coins arrondis : la vidéo posée garde les coins de l'image
function ecrireMasqueArrondi(fichier, l, h, rayon) {
  const r = Math.max(0, Math.min(rayon || 0, l / 2, h / 2)), brut = Buffer.alloc((l + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (l + 1)] = 0;
    for (let x = 0; x < l; x++) {
      let a = 255;
      const cx = x < r ? r : x >= l - r ? l - r : null, cy = y < r ? r : y >= h - r ? h - r : null;
      if (cx !== null && cy !== null) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); a = d <= r - 0.5 ? 255 : d >= r + 0.5 ? 0 : Math.round((r + 0.5 - d) * 255); }
      brut[y * (l + 1) + 1 + x] = a;
    }
  }
  const zlib = require('zlib'), morceau = (type, data) => { const t = Buffer.from(type, 'ascii'), lg = Buffer.alloc(4), c = Buffer.alloc(4);
    lg.writeUInt32BE(data.length); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([lg, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(fichier, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', ihdr), morceau('IDAT', zlib.deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]));
}
// Une slide vidéo → un MP4 de la taille de la slide
const DUREE_STORY_GIF = 12;   // secondes : le temps de lire une story à GIF (7 oct. 2026)
async function exporterSlideVideo(nav, pub, n, v, sortie, travail) {
  const F = FORMATS_PUB[pub.genre], projet = projetCourant();
  const src = path.join(dossierVideosPub(pub.id), v.id + '.mp4');
  if (!fs.existsSync(src)) throw new Error('La vidéo de la ' + F.un + ' ' + n + ' est introuvable.');
  const info = (pub.videos || []).find(x => x.id === v.id) || sonderVideo(src);
  const url = 'http://127.0.0.1:' + PORT + '/pub/' + projet + '/' + pub.id + '/video/' + n + '/' + v.id;
  const place = await lireDansLaPage(nav, url, F.l, F.h);
  if (!place || place.l < 8 || place.h < 8) throw new Error("L'image de la vidéo n'est plus dans la " + F.un + ' ' + n + ' : recomposez-la.');
  const png = path.join(travail, 'slide-' + n + '.png');
  if (v.plein) await photographier(nav, url + '?trou=1', png, F.l, F.h, true);
  else await photographier(nav, 'http://127.0.0.1:' + PORT + '/pub/' + projet + '/' + pub.id + '/slide/' + n, png, F.l, F.h);
  // la vidéo remplit sa place comme l'image la remplissait (object-fit:cover, centrée)
  /* Storymatic (7 oct. 2026) :
     une story à carte GIF dure DUREE_STORY_GIF secondes, le GIF repasse en boucle. Un Reel posé garde le passage choisi. */
  const estGif = !!v.gif;
  const L = place.l + (place.l % 2), H = place.h + (place.h % 2), duree = estGif ? DUREE_STORY_GIF : Math.max(0.5, v.a - v.de);
  // le cadrage choisi (object-position) : la partie gardée quand la vidéo déborde du cadre
  const cx = ((v.cadrage || {}).x ?? 50) / 100, cy = ((v.cadrage || {}).y ?? 50) / 100;
  const vf = '[1:v]fps=30,scale=' + L + ':' + H + ':force_original_aspect_ratio=increase,crop=' + L + ':' + H + ':(iw-ow)*' + cx + ':(ih-oh)*' + cy + ',setsar=1';
  const args = ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', png].concat(estGif
    ? ['-stream_loop', '-1', '-t', String(duree), '-i', src]              // le GIF entier, en boucle jusqu'à la durée
    : ['-ss', String(v.de), '-t', String(duree), '-i', src]);
  let filtre;
  if (v.plein) {
    // la vidéo DESSOUS, la slide trouée par-dessus
    filtre = 'color=c=black:s=' + F.l + 'x' + F.h + ':r=30[fond];' + vf + '[vid];[fond][vid]overlay=' + place.x + ':' + place.y + ':shortest=1[b];[b][0:v]overlay=0:0:shortest=1,format=yuv420p[sortie]';
  } else {
    const masque = path.join(travail, 'masque-' + n + '.png');
    ecrireMasqueArrondi(masque, L, H, place.rayon);
    args.push('-loop', '1', '-i', masque);
    // ce qui est AU-DESSUS de la vidéo dans les calques (un patch, une flèche…) repasse par-dessus elle
    const dessusPng = path.join(travail, 'dessus-' + n + '.png');
    let avecDessus = false;
    try { await photographier(nav, url + '?dessus=1', dessusPng, F.l, F.h, true); avecDessus = fs.existsSync(dessusPng); } catch (e) {}
    if (avecDessus) args.push('-loop', '1', '-i', dessusPng);
    filtre = vf + ',format=rgba[vid];[2:v]format=gray[m];[vid][m]alphamerge[vm];[0:v]format=rgba[fond];[fond][vm]overlay=' + place.x + ':' + place.y + ':shortest=1' +
      (avecDessus ? '[cv];[3:v]format=rgba[dessus];[cv][dessus]overlay=0:0:shortest=1' : '') + ',format=yuv420p[sortie]';
  }
  args.push('-filter_complex', filtre, '-map', '[sortie]');
  if (v.son && info.son) args.push('-map', '1:a?', '-c:a', 'aac', '-b:a', '160k'); else args.push('-an');
  args.push('-t', String(duree), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sortie);
  await executer(ffmpegDuPoste(), args, 600000);
}

async function exporterPub(pub, surAvancee) {
  const deck = lireDeck(pub.id);
  if (!deck || !deck.slides.length) throw new Error("Cette publication n'est pas encore mise en page.");
  const nav = trouverNavigateur();
  if (!nav) throw new Error("L'export en images a besoin de Chrome ou de Edge, introuvables sur ce poste.");
  const F = FORMATS_PUB[pub.genre], projet = projetCourant();
  ecarterExports(pub.id);
  elaguerExports(pub.id);
  const dossier = path.join(dossierPub(pub.id), 'export');
  fs.mkdirSync(dossier, { recursive: true });
  const base = slugAvatar(pub.titre || pub.genre) || pub.genre;
  const fichiers = [];
  /* une slide dont le HTML porte l'image d'une vidéo sort en MP4, avec les réglages de SA slide du plan : la même vidéo peut
     servir à deux slides (posée ici, en plein cadre là, deux moments différents) — un index par vidéo mélangeait les deux */
  const slidesPlan = (pub.plan && pub.plan.slides) || [];
  const reglagesVideo = (n, vid) => { const s = slidesPlan[n - 1]; return s && s.video && s.video.id === vid ? s.video : (slidesPlan.find(x => x.video && x.video.id === vid) || {}).video; };
  const travail = path.join(DOSSIER_CACHE, 'export-video-' + Date.now().toString(36));
  for (let n = 1; n <= deck.slides.length; n++) {
    if (surAvancee) surAvancee(n, deck.slides.length);
    const mv = /\/medias\/affiche-(v[a-z0-9]{6,20})\.jpg/.exec(deck.slides[n - 1] || ''), v = mv && reglagesVideo(n, mv[1]);
    if (v) {
      const nomV = base + '-' + String(n).padStart(2, '0') + '.mp4';
      fs.mkdirSync(travail, { recursive: true });
      await exporterSlideVideo(nav, pub, n, v, path.join(dossier, nomV), travail);
      fichiers.push({ nom: nomV, chemin: path.join(dossier, nomV) });
      continue;
    }
    const nom = base + '-' + String(n).padStart(2, '0') + '.png';
    const sortie = path.join(dossier, nom);
    await photographier(nav, 'http://127.0.0.1:' + PORT + '/pub/' + projet + '/' + pub.id + '/slide/' + n, sortie, F.l, F.h);
    const t = taillePng(sortie);
    if (!t || t.l !== F.l || t.h !== F.h) {
      throw new Error('La ' + F.un + ' ' + n + " n'a pas la bonne taille (" + (t ? t.l + ' × ' + t.h : 'illisible') + ' au lieu de ' + F.l + ' × ' + F.h + ').');
    }
    fichiers.push({ nom: nom, chemin: sortie });
  }
  if (pub.plan && pub.plan.legende) {
    const leg = path.join(dossier, base + '-legende.txt');
    fs.writeFileSync(leg, pub.plan.legende, 'utf8');
    fichiers.push({ nom: base + '-legende.txt', chemin: leg });
  }
  try { fs.rmSync(travail, { recursive: true, force: true }); } catch (e) {}   // les photos et masques de travail des slides vidéo
  ecrireZip(path.join(dossier, base + '.zip'), fichiers);
  // L'empreinte du deck photographié : elle permettra de reprendre cet export
  // si les slides y reviennent (voir majExports).
  try { fs.writeFileSync(path.join(dossier, 'empreinte.txt'), empreinteDeck(pub.id) || '', 'utf8'); } catch (e) {}
  const racineUrl = '/pub/' + projet + '/' + pub.id + '/export/';
  return { dossier: dossier, zip: racineUrl + base + '.zip', nomZip: base + '.zip',
           images: fichiers.filter(f => f.nom.endsWith('.png')).map(f => racineUrl + f.nom),
           videos: fichiers.filter(f => f.nom.endsWith('.mp4')).map(f => racineUrl + f.nom),
           fichiers: fichiers.filter(f => /\.(png|mp4)$/.test(f.nom)).map(f => racineUrl + f.nom) };
}

function ouvrirDossierSurLePoste(dossier) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [dossier], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch (e) {}
}

/* ---------- Les routes ---------- */

// Rend true si la requête a été prise en charge.
function routesPublications(req, res, url) {
  const M = req.method;
  const echec = e => repondreJson(res, 500, { erreur: (e && e.message) || String(e) });
  const flux = () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache',
                         'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    const envoyer = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
    const battement = setInterval(() => envoyer({ t: 'battement' }), 20000);
    return { envoyer: envoyer, finir: () => { clearInterval(battement); res.end(); } };
  };
  let m;

  // Les fichiers d'une identité (images seulement : le fichier de design n'est jamais servi).
  if (M === 'GET' && (m = url.match(/^\/IDENTITES\/([a-z0-9-]+)\/([^\/]+)$/))) {
    if (!EXT_IMAGE.includes(path.extname(m[2]).toLowerCase())) { res.writeHead(403).end('Interdit'); return true; }
    servirFichier(res, path.join(DOSSIER_IDENTITES, m[1]), m[2]);
    return true;
  }

  /* La page qui sert à photographier une vignette : l'image, seule, dans un carré. Elle est servie
     ici plutôt que fabriquée dans une adresse « data: », que le navigateur refusait de remplir. */
  if (M === 'GET' && (m = url.match(/^\/pub\/([a-z0-9-]+)\/(p[a-z0-9]+)\/apercu\/(medias|modele)\/([^\/]+)$/))) {
    const cote = Math.max(200, Math.min(2000, Number(new URLSearchParams(req.url.split('?')[1] || '').get('l')) || 640));
    const src = '/pub/' + m[1] + '/' + m[2] + '/' + m[3] + '/' + encodeURIComponent(m[4]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'" });
    res.end('<!DOCTYPE html><meta charset="utf-8"><body style="margin:0;background:#808080">' +
      '<img src="' + src + '" style="display:block;width:' + cote + 'px;height:' + cote + 'px;object-fit:contain">');
    return true;
  }

  // La page d'une slide, et les fichiers d'une publication. Le projet est dans
  // l'adresse : le navigateur d'export n'a pas le cookie du studio.
  /* Le contrôle géométrique : la même slide, plus le script qui la mesure. Servie au
     navigateur sans fenêtre du poste, jamais à l'extérieur — elle exécute du script. */
  if (M === 'GET' && (m = url.match(/^\/pub\/([a-z0-9-]+)\/(p[a-z0-9]+)\/audit\/(\d+)$/))) {
    const pub = projetExiste(m[1]) ? lirePub(m[2], m[1]) : null, deck = pub && lireDeck(m[2], m[1]);
    const page = deck && pageAuditSlide(pub, deck, Number(m[3]), m[1]);
    if (!page) { res.writeHead(404).end('Introuvable'); return true; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'unsafe-inline'; frame-ancestors 'none'"
    });
    res.end(page);
    return true;
  }
  if (M === 'GET' && (m = url.match(/^\/pub\/([a-z0-9-]+)\/(p[a-z0-9]+)\/slide\/(\d+)$/))) {
    const pub = projetExiste(m[1]) ? lirePub(m[2], m[1]) : null, deck = pub && lireDeck(m[2], m[1]);
    if (!deck) { res.writeHead(404).end('Introuvable'); return true; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'none'; frame-ancestors 'self'"
    });
    // ?video=1 (les vignettes et le Cover Flow) : les slides vidéo tournent ; sans, l'image de la vidéo (l'éditeur, l'export)
    const page = pageDeSlide(pub, deck, Number(m[3]), m[1]);
    res.end(/[?&]video=1/.test(req.url) ? slideAvecVideos(page, m[1], m[2], pub, Number(m[3])) : page);
    return true;
  }
  // La place de la vidéo d'une slide, lue par le navigateur du poste à l'export (exporterSlideVideo) ; ?trou=1 : la slide trouée
  if (M === 'GET' && (m = url.match(/^\/pub\/([a-z0-9-]+)\/(p[a-z0-9]+)\/video\/(\d+)\/(v[a-z0-9]{6,20})$/))) {
    const pub = projetExiste(m[1]) ? lirePub(m[2], m[1]) : null, deck = pub && lireDeck(m[2], m[1]);
    if (!deck || !deck.slides[Number(m[3]) - 1]) { res.writeHead(404).end('Introuvable'); return true; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'unsafe-inline'; frame-ancestors 'none'"
    });
    res.end(pageVideoSlide(pub, deck, Number(m[3]), m[1], m[4], /[?&]trou=1/.test(req.url), /[?&]dessus=1/.test(req.url)));
    return true;
  }
  if (M === 'GET' && (m = url.match(/^\/pub\/([a-z0-9-]+)\/(p[a-z0-9]+)\/(medias|export|modele|invites|videos)\/([^\/]+)$/))) {
    if (!projetExiste(m[1])) { res.writeHead(404).end('Introuvable'); return true; }
    servirFichier(res, path.join(DOSSIER_PROJETS, m[1], 'PUBLICATIONS', m[2], m[3]), m[4]);
    return true;
  }

  if (M === 'GET' && url === '/api/identites') {
    const genre = sousDA(new URLSearchParams(req.url.split('?')[1] || '').get('genre'));
    const l = lireIdentites();
    repondreJson(res, 200, Object.assign({ identites: genre ? l.map(d => daAPlat(d, genre) || Object.assign(daAPlat({ id: d.id, nom: d.nom, parole: d.parole, paroleExemples: d.paroleExemples, sous: { [genre]: {} } }, genre), { manque: true })) : l }, etatPolices()));
    return true;
  }
  // La bibliothèque de polices : le catalogue de Google Fonts, et les polices ajoutées au studio.
  if (M === 'GET' && url === '/api/polices/catalogue') {
    cataloguePolices().then(c => repondreJson(res, 200, c)).catch(echec);
    return true;
  }
  // LA BIBLIOTHÈQUE DE GIF (voir ajouterGif) : la liste, les fichiers, l'import, GIPHY
  if (M === 'GET' && url === '/api/gifs') { repondreJson(res, 200, { gifs: lireGifs(), giphy: !!cleGiphy() }); return true; }
  if (M === 'GET' && (m = url.match(/^\/gifs-fichier\/(g[a-z0-9]+\.(mp4|jpg))$/))) { servirFichier(res, DOSSIER_GIFS, m[1]); return true; }
  if (M === 'POST' && url.split('?')[0] === '/api/gifs/deposer') {
    const nom = new URLSearchParams(req.url.split('?')[1] || '').get('nom') || 'GIF';
    const tmp = path.join(DOSSIER_CACHE, 'gif-recu-' + Date.now().toString(36) + path.extname(nom).toLowerCase().replace(/[^.a-z0-9]/g, ''));
    fs.mkdirSync(DOSSIER_CACHE, { recursive: true });
    let taille = 0, trop = false; const ecrit = fs.createWriteStream(tmp);
    req.on('data', c => { taille += c.length; if (taille > 80e6 && !trop) { trop = true; req.unpipe(ecrit); ecrit.destroy(); } });
    req.pipe(ecrit);
    ecrit.on('close', () => {
      if (trop) { try { fs.rmSync(tmp, { force: true }); } catch (e) {} repondreJson(res, 413, { erreur: 'Ce GIF est trop lourd (80 Mo au plus).' }); return; }
      ajouterGif(tmp, { nom }).then(g => repondreJson(res, 200, { gif: g, gifs: lireGifs() })).catch(echec).finally(() => { try { fs.rmSync(tmp, { force: true }); } catch (e) {} });
    });
    return true;
  }
  if (M === 'GET' && url.split('?')[0] === '/api/gifs/giphy') {
    chercherGiphy(new URLSearchParams(req.url.split('?')[1] || '').get('q')).then(r => repondreJson(res, 200, r)).catch(echec); return true;
  }
  if (M === 'POST' && url === '/api/gifs/giphy') { corpsJson(req, 1e4).then(d => ajouterDeGiphy(d || {})).then(g => repondreJson(res, 200, { gif: g, gifs: lireGifs() })).catch(echec); return true; }
  if (M === 'POST' && url === '/api/gifs/giphy-cle') {
    corpsJson(req, 1e4).then(d => { const c = String((d || {}).cle || '').trim();
      if (c && !/^[A-Za-z0-9]{16,64}$/.test(c)) throw new Error("Cette clé ne ressemble pas à une clé GIPHY.");
      fs.mkdirSync(path.dirname(F_CLE_GIPHY), { recursive: true });
      if (c) fs.writeFileSync(F_CLE_GIPHY, c, 'utf8'); else { try { fs.rmSync(F_CLE_GIPHY, { force: true }); } catch (e) {} }
      repondreJson(res, 200, { giphy: !!c }); }).catch(echec);
    return true;
  }
  if (M === 'POST' && (m = url.match(/^\/api\/gifs\/(g[a-z0-9]+)$/))) { corpsJson(req, 1e4).then(d => repondreJson(res, 200, majGif(m[1], d || {}))).catch(echec); return true; }

  // les polices de l'ordinateur : le fichier, et l'import (voir ajouterPoliceLocale)
  if (M === 'GET' && (m = url.match(/^\/polices-locales\/([^\/]+)$/))) {
    const f = decodeURIComponent(m[1]), ext = path.extname(f).toLowerCase();
    const type = { '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' }[ext];
    if (!type) { res.writeHead(403).end('Interdit'); return true; }
    servirFichier(res, DOSSIER_POLICES_LOCALES, f, { 'Content-Type': type });
    return true;
  }
  if (M === 'POST' && url === '/api/polices/locale') {
    corpsJson(req, 2e7).then(d => ajouterPoliceLocale(d || {})).then(r => repondreJson(res, 200, r)).catch(echec);
    return true;
  }
  if (M === 'POST' && url === '/api/polices') {
    corpsJson(req, 1e4).then(d => ajouterPolice((d || {}).nom)).then(r => repondreJson(res, 200, r)).catch(echec);
    return true;
  }
  if (M === 'DELETE' && (m = url.match(/^\/api\/polices\/(.+)$/))) {
    try { repondreJson(res, 200, retirerPolice(m[1])); } catch (e) { echec(e); }
    return true;
  }
  if (M === 'POST' && url === '/api/identites') {
    corpsJson(req, 120e6).then(d => enregistrerIdentite(d)).then(r => repondreJson(res, 200, r)).catch(echec);
    return true;
  }
  // les fonds de la DA Story : importer une image, ou revenir à l'aplat (Storymatic ne génère rien)
  if (M === 'POST' && (m = url.match(/^\/api\/identites\/([a-z0-9-]+)\/fonds\/(fond|fond_accent)\/(importer|retirer)$/))) {
    const [, id, cle, quoi] = m, sous = sousDA(new URLSearchParams(req.url.split('?')[1] || '').get('sous')) || 'story';
    corpsJson(req, 20e6).then(async d => {
      if (quoi === 'retirer') return poserFondDA(id, cle, null, sous);
      const da = lireDA(id, sous); if (!da) throw new Error('DA inconnue.');
      return poserFondDA(id, cle, ecrireImageRecue(d.donnees, path.join(DOSSIER_IDENTITES, id), cle.replace('_', '-') + '-' + Date.now().toString(36)), sous);
    }).then(r => repondreJson(res, 200, r)).catch(echec);
    return true;
  }
  if (M === 'POST' && (m = url.match(/^\/api\/identites\/([a-z0-9-]+)\/elements$/))) {
    corpsJson(req, 3e7).then(d => ajouterElementDA(m[1], d || {})).then(r => repondreJson(res, 200, r)).catch(echec);
    return true;
  }
  if (M === 'POST' && (m = url.match(/^\/api\/identites\/([a-z0-9-]+)\/elements\/(e[a-z0-9]+)$/))) {
    corpsJson(req, 1e4).then(d => repondreJson(res, 200, majElementDA(m[1], m[2], d || {}))).catch(echec);
    return true;
  }

  if (M === 'GET' && url === '/api/publications') {
    repondreJson(res, 200, listePubs());
    return true;
  }
  if (M === 'POST' && url === '/api/publications') {
    corpsJson(req, 120e6).then(d => repondreJson(res, 200, creerOuMajPub(d))).catch(echec);
    return true;
  }
  if ((m = url.match(/^\/api\/publications\/(p[a-z0-9]+)(?:\/([a-z-]+))?(?:\/(\d+))?$/))) {
    const pub = lirePub(m[1]), action = m[2] || '', n = Number(m[3] || 0);
    if (!pub) { repondreJson(res, 404, { erreur: 'Cette publication est introuvable.' }); return true; }

    if (M === 'GET' && !action) {
      repondreJson(res, 200, Object.assign({}, pub, { deck: lireDeck(pub.id), export: infoExport(pub.id), projet: projetCourant() }));
      return true;
    }
    if (M === 'DELETE' && !action) {
      try {
        const corbeille = path.join(dossierPubs(), '_corbeille');
        fs.mkdirSync(corbeille, { recursive: true });
        fs.renameSync(dossierPub(pub.id), path.join(corbeille, pub.id + '-' + Date.now().toString(36)));
        repondreJson(res, 200, { ok: true });
      } catch (e) { echec(e); }
      return true;
    }
    // Les slides vidéo : un rendu du studio (JSON { rendu }), ou un fichier envoyé tel quel (?nom=…), puis le moment gardé
    if (M === 'POST' && action === 'video') {
      if (/^application\/json/i.test(req.headers['content-type'] || '')) {
        corpsJson(req, 1e4).then(d => ajouterVideoPub(pub, d.gif ? { gif: String(d.gif) } : { rendu: d.rendu })).then(r => repondreJson(res, 200, r)).catch(echec);
        return true;
      }
      const tmp = path.join(DOSSIER_CACHE, 'video-recue-' + Date.now().toString(36));
      fs.mkdirSync(DOSSIER_CACHE, { recursive: true });
      const nom = new URLSearchParams(req.url.split('?')[1] || '').get('nom') || 'Ma vidéo';
      let taille = 0, trop = false;
      const ecrit = fs.createWriteStream(tmp);
      req.on('data', c => { taille += c.length; if (taille > VIDEO_MAX_OCTETS && !trop) { trop = true; req.unpipe(ecrit); ecrit.destroy(); } });
      req.pipe(ecrit);
      ecrit.on('close', () => {
        if (trop) { try { fs.rmSync(tmp, { force: true }); } catch (e) {} repondreJson(res, 413, { erreur: 'Cette vidéo est trop lourde (500 Mo au plus).' }); return; }
        ajouterVideoPub(pub, { fichier: tmp, nom }).then(r => repondreJson(res, 200, r)).catch(echec)
          .finally(() => { try { fs.rmSync(tmp, { force: true }); } catch (e) {} });   // le fichier reçu : une copie de travail, posée ici
      });
      return true;
    }
    if (M === 'POST' && action === 'gif-mots') {
      corpsJson(req, 1e4).then(d => motsGifSlide(pub, d || {})).then(r => repondreJson(res, 200, r)).catch(echec);
      return true;
    }
    // l'étape « Qui et quoi » : dire ce que montre une vidéo (pour Claude), ou la retirer (si aucune slide ne la porte)
    if (M === 'POST' && action === 'video-note') {
      corpsJson(req, 1e4).then(d => {
        const p = lirePub(pub.id) || pub, v = (p.videos || []).find(x => x.id === d.id);
        if (!v) throw new Error('Cette vidéo est introuvable.');
        v.note = String(d.note || '').trim().slice(0, 200);
        return ecrirePub(p);
      }).then(p => repondreJson(res, 200, { videos: p.videos })).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'video-retirer') {
      corpsJson(req, 1e4).then(d => {
        const p = lirePub(pub.id) || pub, v = (p.videos || []).find(x => x.id === d.id);
        if (!v) throw new Error('Cette vidéo est introuvable.');
        if (((p.plan && p.plan.slides) || []).some(s => s.video && s.video.id === v.id)) throw new Error("Une slide du plan montre cette vidéo : changez d'abord la vidéo de cette slide.");
        // rien n'est effacé : la vidéo et ses dérivés partent dans la corbeille de la publication
        const dv = dossierVideosPub(p.id), corbeille = path.join(dv, '_corbeille');
        fs.mkdirSync(corbeille, { recursive: true });
        for (const f of [v.id + '.mp4', v.id + '-apercu.mp4', v.id + '-extrait.mp4']) { try { fs.renameSync(path.join(dv, f), path.join(corbeille, f)); } catch (e) {} }
        p.videos = p.videos.filter(x => x.id !== v.id);
        p.medias = (p.medias || []).filter(m => m.videoId !== v.id);
        return ecrirePub(p);
      }).then(p => repondreJson(res, 200, p)).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'video-couper') {
      corpsJson(req, 1e4).then(d => couperVideoPub(lirePub(pub.id) || pub, String(d.id || ''), d.de, d.a)).then(r => repondreJson(res, 200, r)).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'plan') {
      corpsJson(req, 1e6).then(d => ecrirePlanPub(lirePub(pub.id) || pub, String(d.remarque || '').slice(0, 1000), !!d.accorder))
        .then(p => repondreJson(res, 200, p)).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'composer') {
      corpsJson(req, 1e6).then(async () => {
        const f = flux();
        try {
          f.envoyer({ t: 'debut', total: pub.plan ? pub.plan.slides.length : 0 });
          const controle = {};
          let fini = false;
          res.on('close', () => { if (!fini && controle.arreter) controle.arreter('Mise en page annulée.'); });
          try {
            const deck = await composerPub(lirePub(pub.id) || pub, (fait, total) => f.envoyer({ t: 'avancee', fait: fait, total: total }),
                                           message => f.envoyer({ t: 'activite', message: message }), controle);
            f.envoyer({ t: 'fin', deck: deck });
          } finally { fini = true; }
        } catch (e) { try { f.envoyer({ t: 'erreur', message: (e && e.message) || String(e) }); } catch (_) {} }
        try { f.finir(); } catch (_) {}
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'slides' && n) {
      corpsJson(req, 1e6).then(d => refaireSlide(pub, n, String(d.remarque || '').slice(0, 1000)))
        .then(deck => repondreJson(res, 200, { deck: deck })).catch(echec);
      return true;
    }
    // Une correction à la main, faite dans l'aperçu : le texte d'une slide.
    if (M === 'PUT' && action === 'slides' && n) {
      corpsJson(req, 2e6).then(d => {
        const deck = lireDeck(pub.id);
        if (!deck || !deck.slides[n - 1]) throw new Error('Cette slide est introuvable.');
        const propre = decouperDeck(String(d.html || '')).slides[0];
        if (!propre) throw new Error('Le contenu reçu est illisible.');
        const neuve = propre.replace(/\scontenteditable="[^"]*"/gi, '').replace(/\sspellcheck="[^"]*"/gi, '');

        /* RIEN N'A CHANGÉ : on ne touche à rien. Enregistrer une slide écarte les
           images déjà exportées — c'est normal, elles ne lui correspondent plus.
           Mais une publication terminée perdait ce statut pour un enregistrement
           qui ne changeait rien : on ouvrait une slide, on déplaçait un bloc puis
           on le remettait, et il fallait tout réexporter pour rien. Une comparaison
           vaut mieux qu'une réécriture aveugle. */
        const cssAjout = cssSur(String(d.css || '')).trim();
        if (deck.slides[n - 1] === neuve && !cssAjout) return repondreJson(res, 200, { deck: deck, inchangee: true });

        deck.slides[n - 1] = neuve;
        if (cssAjout) deck.css += '\n/* slide ' + n + ', retouchée */\n' + cssAjout;
        /* Le verdict du contrôle géométrique portait sur ce que Claude avait composé. Une
           retouche à la main le rend caduc : on l'efface plutôt que de le laisser mentir. */
        delete deck.controle;
        ecrireDeck(pub.id, deck);
        majExports(pub.id);
        repondreJson(res, 200, { deck: deck });
      }).catch(echec);
      return true;
    }
    // Supprimer le fond d'une image : sur l'ordinateur seulement (gratuit) — Storymatic n'appelle aucune plateforme payante
    if (M === 'POST' && action === 'detourer') {
      corpsJson(req, 1e5).then(async d => {
        const f = flux();
        try {
          const r = await detourerMedia(lirePub(pub.id) || pub, String((d || {}).fichier || ''), f.envoyer, 'local', (d || {}).methode);
          f.envoyer({ t: 'fin', pub: r.pub, deck: r.deck, credits: r.credits, transparent: r.transparent, local: !!r.local });
        } catch (e) { f.envoyer({ t: 'erreur', message: (e && e.message) || String(e) }); }
        f.finir();
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'fond') {
      corpsJson(req, 1e5).then(d => remettreFond(lirePub(pub.id) || pub, String((d || {}).fichier || ''), (d || {}).mode === 'sans' ? 'sans' : 'avec'))
        .then(r => repondreJson(res, 200, r)).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'exporter') {
      corpsJson(req, 1e6).then(async () => {
        const f = flux();
        try {
          const r = await exporterPub(pub, (fait, total) => f.envoyer({ t: 'avancee', fait: fait, total: total }));
          f.envoyer({ t: 'fin', export: r });
        } catch (e) { f.envoyer({ t: 'erreur', message: (e && e.message) || String(e) }); }
        f.finir();
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'ouvrir-dossier') {
      const d = path.join(dossierPub(pub.id), 'export');
      ouvrirDossierSurLePoste(fs.existsSync(d) ? d : dossierPub(pub.id));
      repondreJson(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------
   Le serveur
   ------------------------------------------------------------ */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.mp4':  'video/mp4',   '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',   '.opus': 'audio/ogg', '.m4a': 'audio/mp4'
};

/* Servir un fichier du disque. Trois choses qui rendent le studio plus fluide, sans jamais montrer une
   version périmée :
   - « no-cache » + ETag : le navigateur garde sa copie mais redemande à chaque fois ; si rien n'a changé
     (même taille, même date), le studio répond « 304 » sans renvoyer le fichier. Une mise à jour du
     studio change la date : elle est donc vue tout de suite, comme avant ;
   - le fichier part par morceaux (stream) au lieu d'être chargé en entier en mémoire ;
   - les requêtes « Range » : une vidéo se lit et s'avance sans être téléchargée en entier.
   La requête est celle de la réponse (res.req) : aucun appelant n'a à la passer. */
function servirFichier(res, base, rel, entetes) {
  const racine = path.resolve(base);
  const cible = path.resolve(racine, rel);
  // Pas de sortie du dossier autorisée (le séparateur compte : « AVATARS-x » n'est pas dans « AVATARS »).
  if (cible !== racine && !cible.startsWith(racine + path.sep)) { res.writeHead(403).end('Interdit'); return; }
  const req = res.req || { headers: {}, method: 'GET' };
  fs.stat(cible, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404).end('Introuvable'); return; }
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const tete = Object.assign({
      'Content-Type': TYPES[path.extname(cible).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'ETag': etag,
      'Last-Modified': st.mtime.toUTCString(),
      'Accept-Ranges': 'bytes'
    }, entetes || {});
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, tete); res.end(); return; }
    let debut = 0, fin = st.size - 1, code = 200;
    const plage = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (plage && st.size > 0) {
      if (plage[1] === '') { debut = Math.max(0, st.size - Number(plage[2])); }
      else { debut = Number(plage[1]); if (plage[2] !== '') fin = Math.min(fin, Number(plage[2])); }
      if (!(debut <= fin)) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }).end(); return; }
      code = 206;
      tete['Content-Range'] = 'bytes ' + debut + '-' + fin + '/' + st.size;
    }
    tete['Content-Length'] = st.size ? fin - debut + 1 : 0;
    res.writeHead(code, tete);
    if (req.method === 'HEAD' || !st.size) { res.end(); return; }
    const flot = fs.createReadStream(cible, { start: debut, end: fin });
    flot.on('error', () => res.destroy());
    flot.pipe(res);
  });
}

/* LES VIGNETTES DES GALERIES. Un rendu pèse 5 à 10 Mo : une galerie de cent images en chargeait des
   centaines. Le navigateur du studio fabrique lui-même une vignette WebP (quelques dizaines de ko) la
   première fois qu'il affiche un rendu, et l'envoie ici ; elle est gardée dans CACHE/vignettes/ et servie
   ensuite à la place de l'original, tant que l'original n'a pas changé. Aucun outil à installer, sur Mac
   comme sur Windows. Sans vignette, c'est l'original qui part, avec « X-Vignette: a-faire ». */
const DOSSIER_VIGNETTES = path.join(DOSSIER_CACHE, 'vignettes');
function cheminVignette(abs) {
  return path.join(DOSSIER_VIGNETTES, require('crypto').createHash('sha1').update(abs).digest('hex') + '.webp');
}
function servirRendu(res, rel, vignette) {
  const abs = cheminRendu(rel);
  if (!abs) { res.writeHead(404).end('Introuvable'); return; }
  if (vignette && /\.(png|jpe?g|webp)$/i.test(abs)) {
    const v = cheminVignette(abs);
    try {
      if (fs.statSync(v).mtimeMs >= fs.statSync(abs).mtimeMs) return servirFichier(res, DOSSIER_VIGNETTES, path.basename(v));
    } catch (e) { /* pas encore de vignette */ }
    return servirFichier(res, dossierRendus(), rel, { 'X-Vignette': 'a-faire' });
  }
  return servirFichier(res, dossierRendus(), rel);
}

/* MA SEMAINE DE STORIES (6 oct. 2026) : l'accueil de l'outil Storymatic — module à part, semaine.js ; page app/semaine.html. */
/* LE PROFIL (13 oct. 2026, profil.js) : à qui appartiennent les stories — ses réponses au parcours « Faisons connaissance », sa
   semaine type, sa DA. Tout ce qui était écrit en dur pour une seule personne passe par lui. */
const PROFIL = require('./profil.js')({ RACINE, ecrireJsonSurement, repondreJson, corpsJson, interroger, premierObjetJson, DELAI_MAX, lireIdentite, enregistrerIdentite });
// une image d'une vidéo, à une fraction de sa durée (pour que Claude « voie » une vidéo : décrire les vidéos de la personne)
async function imageDeVideo(src, fraction, sortie) {
  const d = (sonderVideo(src) || {}).duree || 1;
  await executer(ffmpegDuPoste(), ['-v', 'error', '-y', '-ss', String(Math.max(0, d * fraction)), '-i', src, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', sortie]);
}
const SEMAINE = require('./semaine.js')({ RACINE, profil: PROFIL, imageDeVideo, enProjet: (p, fn) => CONTEXTE.run({ projet: p }, fn), creerProjet, lirePub, lireDeck, creerOuMajPub, ecrirePub,
  ecrirePlanPub, composerPub, exporterPub: p => exporterPub(p), ajouterVideoPub, trouverNavigateur, photographier, port: () => PORT, interroger, premierObjetJson, DELAI_MAX, ecrireJsonSurement, corpsJson, repondreJson,
  servirFichier, lireDA, voixDeLaDA, ouvrirDossier: d => ouvrirDossierSurLePoste(d) });
PROFIL.poserOccupe(SEMAINE.occupe);   // pas de changement de profil pendant une préparation de semaine

/* « APPRENDRE MON STYLE » (30 sept. 2026) : module à part, apprendre.js ; page app/js/apprendre.js. Un dossier glissé dans une sous-DA
   Carrousel ou Story → la charte, les polices, les éléments, les GIF, les slides d'exemple (Claude, gratuit). */
const APPRENDRE = require('./apprendre.js')({ RACINE, DOSSIER_CACHE, DOSSIER_IDENTITES, COULEURS_STUDIO, ecrireJsonSurement, sousDA, lireIdentite, demanderJson, interroger,
  premierObjetJson, executer, ffmpeg: ffmpegDuPoste, ffprobe: ffprobeDuPoste, policesConnues, cataloguePolices, estPoliceLocale, cssPolicesLocales, familleGoogle,
  trouverNavigateur, photographier, port: () => PORT, detourerEnLocal, ajouterPolice, ajouterPoliceLocale, enregistrerIdentite, modifierFicheDA,
  ecarterFichierDA, ajouterElementDA, majElementDA, ajouterGif, lireGifs, sonderVideo, repondreJson, corpsJson, servirFichier });

/* « REFAIRE DES STICKERS » (13 oct. 2026) : module à part, stickers.js ; page app/js/stickers.js. Une image de stickers →
   Claude les redessine en français (SVG), le navigateur du poste les photographie en PNG transparent → éléments de la DA Story. */
const STICKERS = require('./stickers.js')({ RACINE, DOSSIER_CACHE, profil: PROFIL, lireDA, lireIdentite, ajouterElementDA, interroger, demanderJson,
  executer, ffmpeg: ffmpegDuPoste, trouverNavigateur, photographier, port: () => PORT, familleGoogle, estPoliceLocale, cssPolicesLocales,
  ecrireJsonSurement, repondreJson, corpsJson, servirFichier, ouvrirDossier: d => ouvrirDossierSurLePoste(d) });

/* L'INSTALLATION SANS TERMINAL (13 oct. 2026, reprise de MOSAIC) : module à part, installation.js ; page app/installation-ui.js.
   Claude Code, le compte Claude, ffmpeg, un navigateur, l'icône du Bureau ; en facultatif le détourage et la clé GIPHY. */
const INSTALLATION = require('./installation.js')({ RACINE, lireReglages, ecrireReglages, repondreJson, corpsJson, trouverNavigateur,
  cheminClaude: () => CLAUDE, prefixeClaude: () => CLAUDE_PREFIXE.slice(), redetecterClaude,
  verifierDetourage: () => verifierDetourageLocal().catch(() => null), giphyPose: () => !!cleGiphy(),
  oublierOutils: () => { detourageCache = null; detourageVerif = null; } });

const serveur = http.createServer((req, res) => {
  CONTEXTE.run({ projet: projetDeRequete(req) }, () => {
    // Les écouteurs posés sur la requête gardent le projet de la requête.
    const poser = req.on.bind(req);
    req.on = (ev, fn) => poser(ev, AsyncResource.bind(fn));
    traiterRequete(req, res);
  });
});

function traiterRequete(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Adresse mal formée'); return; }

  // La page Installation : ce qui manque sur l'ordinateur, installé sans terminal.
  if (url.startsWith('/api/installation') && INSTALLATION.routes(req, res, url)) return;

  // Ma semaine de stories (l'accueil de Storymatic) : la semaine, la banque, les captures, les vidéos.
  if (url.startsWith('/api/profil') && PROFIL.routes(req, res, url)) return;
  if ((url.startsWith('/api/semaine') || url.startsWith('/api/banque') || url.startsWith('/api/captures') || url.startsWith('/api/videos') || url.startsWith('/semaine-fichier/')) && SEMAINE.routes(req, res, url)) return;

  // La DA et les publications (les stories d'un jour).
  if (routesPublications(req, res, url)) return;

  // « Apprendre mon style » : le dossier d'une sous-DA Carrousel ou Story.
  if ((url.startsWith('/api/apprendre') || url.startsWith('/apprendre-')) && APPRENDRE.routes(req, res, url)) return;

  // « Refaire des stickers » : une planche d'exemple redessinée en éléments de la DA Story.
  if ((url.startsWith('/api/stickers') || url.startsWith('/stickers-')) && STICKERS.routes(req, res, url)) return;

  // Les medias generes, servis a l'application (ceux du projet de la requete).
  if (url.startsWith('/RENDUS/')) {
    return servirRendu(res, url.replace('/RENDUS/', ''), /[?&]vignette=1\b/.test(req.url));
  }

  /* ---------- Les projets ---------- */

  // Les images d'un projet précis (la couverture des cartes de projets).
  {
    const m = url.match(/^\/PROJETS\/([a-z0-9-]+)\/(RENDUS)\/(.+)$/);
    if (m && projetExiste(m[1])) {
      return servirFichier(res, path.join(DOSSIER_PROJETS, m[1], m[2]), m[3]);
    }
  }

  // La liste des projets, avec de quoi dessiner leurs cartes.
  if (req.method === 'GET' && url === '/api/projets') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    try {
      res.end(JSON.stringify({ actif: projetCourant(), projets: listeProjets().map(resumeProjet) }));
    } catch (e) {
      res.end(JSON.stringify({ erreur: e.message || String(e) }));
    }
    return;
  }

  /* LE POSTE (13 oct. 2026) : ce qu'il faut pour que Storymatic marche chez quelqu'un qui vient de le télécharger —
     Claude Code (le moteur, sur l'abonnement de la personne), ffmpeg (les stories vidéo), Chrome ou Edge (photos et export).
     L'accueil l'affiche en haut tant qu'il manque quelque chose. */
  if (req.method === 'GET' && url === '/api/poste') {
    let ffmpeg = false; try { ffmpeg = require('child_process').spawnSync(ffmpegDuPoste(), ['-version'], { windowsHide: true, timeout: 15000 }).status === 0; } catch (e) {}
    repondreJson(res, 200, { claude: !!CLAUDE, ffmpeg, navigateur: !!trouverNavigateur(), giphy: !!cleGiphy(), systeme: process.platform });
    return;
  }
  if (req.method === 'GET' && url === '/api/etat') {
    verifierDetourageLocal().catch(() => null).then(py => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        claude: !!CLAUDE,
        chemin: CLAUDE || null,
        perime: codePerime(),
        modele: MODELE,
        modeles: MODELES_CLAUDE,
        detourageLocal: !!py,
        // Le dossier que sert CE moteur : un autre studio peut tourner sur le
        // meme poste, et les outils de relance ne doivent fermer que le leur.
        racine: RACINE,
        // le numéro de CE moteur : après une mise à jour, la page attend qu'un AUTRE moteur réponde avant de se recharger
        moteur: process.pid
      }));
    });
    return;
  }

  /* Changer de modele. Le nouveau vaut pour la PROCHAINE demande : une
     generation deja lancee garde le sien, son processus est deja parti. */
  if (req.method === 'POST' && url === '/api/modele') {
    return corpsJson(req, 2048).then(d => {
      try { repondreJson(res, 200, { modele: poserModele(d.modele) }); }
      catch (e) { repondreJson(res, 400, { erreur: e.message || String(e) }); }
    }).catch(e => repondreJson(res, 400, { erreur: e.message || String(e) }));
  }

  // L'application.
  const rel = (url === '/' || url === '') ? 'semaine.html' : (url === '/editeur' || url === '/studio') ? 'index.html' : url.replace(/^\/+/, '');
  servirFichier(res, APP, rel);
}

/* Si le studio tourne déjà, on ne veut pas d'une trace technique :
   on le dit simplement et on laisse la fenêtre en place. */
serveur.on('error', e => {
  console.log('');
  if (e.code === 'EADDRINUSE') {
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log('  │   LE STUDIO TOURNE DÉJÀ                      │');
    console.log('  └──────────────────────────────────────────────┘');
    console.log('');
    console.log('  Inutile de le relancer : il est ouvert dans une autre fenêtre.');
    console.log('');
    console.log('  Ouvrez simplement :  http://127.0.0.1:' + PORT);
    console.log('');
    console.log('  Si vous voulez repartir de zéro, fermez l\'autre fenêtre noire');
    console.log('  du studio, puis relancez celle-ci.');
  } else {
    console.log('  Le studio n\'a pas pu démarrer.');
    console.log('');
    console.log('  ' + (e.message || e));
  }
  console.log('');
  process.exit(1);
});

/* Le dernier filet : une erreur imprévue est écrite dans la console, mais ne fait pas tomber le studio —
   sinon toutes les générations en cours seraient perdues avec lui. */
process.on('uncaughtException', e => console.error('  [erreur imprévue]', (e && e.stack) || e));
process.on('unhandledRejection', e => console.error('  [promesse rejetée]', (e && e.stack) || e));

serveur.listen(PORT, '127.0.0.1', () => {
  verifierDetourageLocal().catch(() => null);   // en arrière-plan : prête avant qu'on en ait besoin
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │   STORYMATIC — prêt                              │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  console.log('  Ouvrez :  http://127.0.0.1:' + PORT);
  console.log('');
  console.log(CLAUDE
    ? '  Claude Code : trouvé'
    : '  Claude Code : INTROUVABLE — le studio ne pourra pas rédiger.');
  console.log('');
  console.log('  Cette fenêtre fait tourner le studio : laissez-la ouverte,');
  console.log('  mais vous pouvez la RÉDUIRE, elle continuera de fonctionner.');
  console.log('');
  console.log('  Pour arrêter le studio en fin de journée : fermez la fenêtre.');
  console.log('');
});
