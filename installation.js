'use strict';
/* ============================================================
   L'INSTALLATION SANS TERMINAL (13 oct. 2026). Repris de MOSAIC STUDIO (installation.js du
   26 sept. 2026), réduit à ce dont Storymatic a besoin. Node.js est livré dans le zip (MOTEUR/node) ; le moteur démarre ;
   la page « Installation » (app/installation-ui.js) montre un voyant par pièce. Ce module fait le travail :

     claude       Claude Code, par son installateur officiel (claude.ai/install.ps1 · install.sh)
     compte       la connexion au compte Claude : `claude auth login` ouvre la page de connexion et attend ;
                  `claude auth status` dit si c'est fait (et l'abonnement : Pro ou Max)
     ffmpeg       gyan.dev (Windows), martin-riedl.de (Mac, arm64 ou Intel) — pour les stories qui bougent
     navigateur   seulement s'il n'y a ni Chrome ni Edge : Chrome for Testing, pour la mise en page et l'export
     raccourci    l'icône du Bureau (Windows : .lnk ; Mac : un lien vers Storymatic.app)
     detourage    FACULTATIF : « Supprimer le fond » sans crédit (Python, onnxruntime, le modèle BiRefNet ≈ 970 Mo)
     giphy        FACULTATIF : la clé GIPHY gratuite de la personne (ses GIF trouvés tout seuls)

   Rien n'est redistribué : chaque outil vient de sa source officielle, sur le poste de la personne, quand elle clique.
   Rien n'est payant. Les chemins s'écrivent dans reglages.json, que le code lit déjà.
   Pièges payés par MOSAIC (gardés ici) : un Claude lancé « caché » ouvre une fenêtre de navigateur fantôme — auth login
   part avec windowsHide: false ; Smart App Control (Windows 11) bloque un programme non signé vu la 1re fois — on
   réessaie ; sous Rosetta, un Mac à puce Apple se dit Intel — la vraie puce vient de hw.optional.arm64.
   ============================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), cp = require('child_process');

module.exports = function (D) {
  const { RACINE } = D;
  const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
  const X = WIN ? '.exe' : '';
  const ARCH = (() => {
    if (!MAC) return process.arch;
    try { return cp.execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1' ? 'arm64' : 'x64'; }
    catch (e) { return process.arch; }
  })();
  const MOTEUR = path.join(RACINE, 'MOTEUR');
  const PY = WIN ? path.join(MOTEUR, 'python', 'python.exe') : path.join(MOTEUR, 'python', 'bin', 'python3');
  const FFMPEG = path.join(MOTEUR, 'ffmpeg', 'ffmpeg' + X), FFPROBE = path.join(MOTEUR, 'ffmpeg', 'ffprobe' + X);
  const TAR = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const TEMP = path.join(MOTEUR, '_telechargements');
  // Windows : versions FIGÉES, essayées sous Smart App Control (celles de MOSAIC) ; Mac : la plus récente prête pour la puce
  const PAQUETS = WIN ? ['onnxruntime==1.30.0', 'numpy==2.5.3', 'pillow==12.3.0', 'protobuf==7.36.2', 'flatbuffers==25.12.19', 'packaging==26.3']
    : ['onnxruntime', 'numpy', 'pillow'];
  const PYTHON_WIN = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip';
  const GET_PIP = 'https://bootstrap.pypa.io/get-pip.py';
  const URL_BIREFNET = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx';
  const MD5_BIREFNET = '7a35a0141cbbc80de11d9c9a28f52697';
  const MODELE = path.join(os.homedir(), '.rembg', 'models', 'birefnet-general', 'birefnet-general.onnx');
  const MODELES = [MODELE, path.join(os.homedir(), '.u2net', 'birefnet-general.onnx')];
  const TAILLE_MODELE = 972e6;
  const JOURNAL = path.join(MOTEUR, 'installation-outils.log');
  const NOM_RACCOURCI = 'Storymatic';

  /* ---------------- petits outils ---------------- */
  const existe = p => { try { return fs.existsSync(p); } catch (e) { return false; } };
  const taille = p => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
  function lancer(bin, args, o) {
    o = o || {};
    return new Promise(ok => {
      let sortie = '', erreur = '', p;
      try { p = cp.spawn(bin, args, Object.assign({ windowsHide: true, cwd: RACINE, env: process.env }, o)); }
      catch (e) { return ok({ code: -1, sortie: '', erreur: e.message }); }
      const minuteur = o.delai ? setTimeout(() => { try { p.kill(); } catch (e) {} }, o.delai) : null;
      p.stdout && p.stdout.on('data', d => { sortie += d; if (o.surLigne) String(d).split(/\r?\n|\r/).forEach(l => l.trim() && o.surLigne(l.trim())); });
      p.stderr && p.stderr.on('data', d => { erreur += d; if (o.surLigne) String(d).split(/\r?\n|\r/).forEach(l => l.trim() && o.surLigne(l.trim())); });
      p.on('error', e => { if (minuteur) clearTimeout(minuteur); ok({ code: -1, sortie, erreur: erreur + e.message }); });
      p.on('close', code => { if (minuteur) clearTimeout(minuteur); ok({ code, sortie, erreur }); });
    });
  }
  // Un téléchargement suivi ; les redirections sont suivies ; « lent » (octets/s) : en dessous sur 25 s, on passe à la source suivante.
  function telecharger(url, dest, surProgres, n, lent) {
    n = n || 0;
    return new Promise((ok, ko) => {
      if (n > 8) return ko(new Error('trop de redirections'));
      const req = https.get(url, { headers: { 'User-Agent': 'Storymatic', 'Accept': '*/*' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return telecharger(new URL(res.headers.location, url).toString(), dest, surProgres, n + 1, lent).then(ok, ko);
        }
        if (res.statusCode !== 200) { res.resume(); return ko(new Error('téléchargement refusé (' + res.statusCode + ') : ' + url)); }
        const total = Number(res.headers['content-length']) || 0;
        let recu = 0, fini = false, fenetre = 0;
        const debut = Date.now();
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const f = fs.createWriteStream(dest + '.part');
        const abandonner = e => { if (fini) return; fini = true; clearInterval(garde); res.destroy(); f.destroy(); try { fs.unlinkSync(dest + '.part'); } catch (x) {} ko(e); };
        const garde = lent ? setInterval(() => {
          if (recu - fenetre < lent * 25) abandonner(new Error('trop lent (' + Math.round((recu - fenetre) / 25e3) + ' Ko/s)'));
          fenetre = recu;
        }, 25000) : null;
        res.on('data', b => { recu += b.length; if (surProgres) surProgres(recu, total, recu / Math.max(0.5, (Date.now() - debut) / 1000)); });
        res.pipe(f);
        f.on('finish', () => f.close(() => { if (fini) return; fini = true; clearInterval(garde); try { fs.renameSync(dest + '.part', dest); ok(dest); } catch (e) { ko(e); } }));
        f.on('error', abandonner); res.on('error', abandonner);
      });
      req.setTimeout(90000, () => req.destroy(new Error('le serveur ne répond plus')));
      req.on('error', ko);
    });
  }
  function lireJson(url) {
    return new Promise((ok, ko) => {
      https.get(url, { headers: { 'User-Agent': 'Storymatic', 'Accept': 'application/json' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return lireJson(new URL(res.headers.location, url).toString()).then(ok, ko); }
        let s = ''; res.on('data', d => s += d);
        res.on('end', () => { try { if (res.statusCode !== 200) throw new Error('réponse ' + res.statusCode); ok(JSON.parse(s)); } catch (e) { ko(e); } });
      }).on('error', ko);
    });
  }
  async function extraire(archive, dans) {
    fs.mkdirSync(dans, { recursive: true });
    const r = MAC && /\.zip$/i.test(archive) ? await lancer('ditto', ['-x', '-k', archive, dans]) : await lancer(TAR, ['-xf', archive, '-C', dans]);
    if (r.code !== 0) throw new Error('décompression impossible : ' + (r.erreur || r.sortie).slice(-300));
  }
  function trouverFichier(d, nom) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const t = trouverFichier(p, nom); if (t) return t; }
      else if (e.name.toLowerCase() === nom.toLowerCase()) return p;
    }
    return null;
  }
  const effacer = p => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} };
  const bloque = r => /contr[ôo]le d.application|application control|EACCES|WinError 4551/i.test((r.erreur || '') + ' ' + (r.sortie || ''));
  const BLOQUE = 'Windows a bloqué un fichier du détourage (Smart App Control). Le reste de Storymatic fonctionne ; le détourage gratuit, non. ' +
    'Ne désactivez pas Smart App Control. Le détail est dans MOTEUR/installation-outils.log.';
  function reglage(maj) { const r = D.lireReglages(); Object.assign(r, maj); D.ecrireReglages(r); }
  const mo = o => Math.round(o / 1e6) + ' Mo';
  const vitesse = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' Mo/s' : Math.round(v / 1e3) + ' Ko/s';
  const progresTelechargement = (dire, quoi, de, a) => (recu, total, debit) =>
    dire(quoi + ' — ' + mo(recu) + (total ? ' sur ' + mo(total) : '') + (debit ? ' · ' + vitesse(debit) : ''), total ? de + (a - de) * recu / total : null);

  /* ---------------- Claude Code ---------------- */
  const claude = () => D.cheminClaude();
  const argsClaude = a => D.prefixeClaude().concat(a);
  async function commandeClaude(a, o) {
    if (!claude()) return { code: -1, sortie: '', erreur: 'Claude Code introuvable' };
    return lancer(claude(), argsClaude(a), Object.assign({ delai: 60000 }, o || {}));
  }

  /* ---------------- LA DÉTECTION ---------------- */
  let cacheCompte = null;
  async function compte(frais) {
    if (!frais && cacheCompte && Date.now() - cacheCompte.t < 8000) return cacheCompte.v;
    const r = await commandeClaude(['auth', 'status', '--json'], { delai: 20000 });
    let v = { connecte: false };
    try { const j = JSON.parse(r.sortie.slice(r.sortie.indexOf('{'))); v = { connecte: !!j.loggedIn, email: j.email || '', abonnement: j.subscriptionType || '', methode: j.authMethod || '' }; } catch (e) {}
    cacheCompte = { t: Date.now(), v };
    return v;
  }
  async function ffmpegOk() {
    const r = D.lireReglages();
    for (const f of [r.ffmpeg, existe(FFMPEG) ? FFMPEG : null, 'ffmpeg'].filter(Boolean)) {
      const p = f === 'ffmpeg' ? 'ffprobe' : f === r.ffmpeg ? (r.ffprobe || path.join(path.dirname(f), 'ffprobe' + X)) : FFPROBE;
      const a = await lancer(f, ['-version'], { delai: 15000 }), b = await lancer(p, ['-version'], { delai: 15000 });
      if (a.code === 0 && b.code === 0) return f;
    }
    return null;
  }
  const modeleOk = () => MODELES.some(f => taille(f) > 0.9 * TAILLE_MODELE);
  function bureaux() {
    const l = [path.join(os.homedir(), 'Desktop')];
    if (WIN) { if (process.env.OneDrive) l.push(path.join(process.env.OneDrive, 'Desktop'), path.join(process.env.OneDrive, 'Bureau')); l.push(path.join(os.homedir(), 'Bureau')); }
    try { const m = JSON.parse(fs.readFileSync(path.join(MOTEUR, 'raccourci.json'), 'utf8')); if (m.dossier) l.unshift(m.dossier); } catch (e) {}
    return l;
  }
  const raccourci = () => bureaux().some(d => existe(path.join(d, NOM_RACCOURCI + (WIN ? '.lnk' : ''))));

  async function etat(frais) {
    const [co, ff, det] = await Promise.all([claude() ? compte(frais) : { connecte: false }, ffmpegOk(), D.verifierDetourage()]);
    const nav = !!D.trouverNavigateur();
    const pieces = {
      claude: { ok: !!claude(), chemin: claude() || null },
      compte: co,
      ffmpeg: { ok: !!ff },
      navigateur: { ok: nav },
      raccourci: { ok: raccourci() },
      detourage: { ok: !!det && modeleOk(), facultatif: true },
      giphy: { ok: D.giphyPose(), facultatif: true }
    };
    return {
      systeme: WIN ? 'windows' : MAC ? 'mac' : 'autre',
      pieces,
      pret: pieces.claude.ok && co.connecte && pieces.ffmpeg.ok && nav,
      taches: TACHES,
      connexions: publiques()
    };
  }

  /* ---------------- LES TÂCHES (une à la fois) ---------------- */
  const TACHES = {};
  let file = Promise.resolve();
  function tache(nom, travail) {
    if (TACHES[nom] && (TACHES[nom].etat === 'en-cours' || TACHES[nom].etat === 'attente')) return;
    TACHES[nom] = { etat: 'attente', progres: 0, detail: 'En attente…', erreur: '' };
    file = file.then(async () => {
      const t = TACHES[nom];
      Object.assign(t, { etat: 'en-cours', debut: Date.now(), detail: 'On commence…' });
      const dire = (detail, progres) => { t.detail = detail; if (progres != null) t.progres = Math.max(0, Math.min(100, Math.round(progres))); };
      try { await travail(dire); Object.assign(t, { etat: 'fini', progres: 100, detail: 'Terminé', fin: Date.now() }); }
      catch (e) { Object.assign(t, { etat: 'erreur', erreur: String((e && e.message) || e).slice(0, 600), fin: Date.now() }); }
      cacheCompte = null;
      D.oublierOutils();
    });
  }

  // 1. Claude Code, par son installateur officiel.
  async function installerClaude(dire) {
    if (claude()) { dire('Claude Code est déjà là.', 100); return; }
    dire('Installation de Claude Code (installateur officiel d\'Anthropic)…', 10);
    const r = WIN
      ? await lancer('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { delai: 15 * 60000 })
      : await lancer('/bin/bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], { delai: 15 * 60000 });
    D.redetecterClaude();
    if (!claude()) throw new Error('L\'installateur de Claude Code n\'a pas abouti. ' + (r.erreur || r.sortie).trim().split('\n').slice(-3).join(' '));
    dire('Claude Code est installé.', 100);
  }

  // 2. ffmpeg, dans MOTEUR/ffmpeg.
  async function installerFfmpeg(dire) {
    effacer(TEMP); fs.mkdirSync(path.join(MOTEUR, 'ffmpeg'), { recursive: true });
    if (WIN) {
      // le ffmpeg de gyan.dev, d'abord par sa copie officielle sur GitHub (bien plus rapide), puis gyan.dev, puis BtbN
      const sources = [];
      try {
        const j = await lireJson('https://api.github.com/repos/GyanD/codexffmpeg/releases/latest');
        const a = (j.assets || []).find(x => /essentials_build\.zip$/.test(x.name));
        if (a) sources.push(a.browser_download_url);
      } catch (e) { /* limite de GitHub : la version connue */ }
      if (!sources.length) sources.push('https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip');
      sources.push('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
                   'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip');
      let fait = false, derniere = null;
      for (let i = 0; i < sources.length; i++) {
        try {
          if (i) dire('Source trop lente ou indisponible : on essaie une autre adresse…', 0);
          const z = await telecharger(sources[i], path.join(TEMP, 'ffmpeg.zip'), progresTelechargement(dire, 'Téléchargement de ffmpeg', 0, 85), 0, i < sources.length - 1 ? 150e3 : 0);
          dire('Décompression…', 88);
          await extraire(z, path.join(TEMP, 'ffmpeg'));
          for (const n of ['ffmpeg.exe', 'ffprobe.exe']) {
            const f = trouverFichier(path.join(TEMP, 'ffmpeg'), n);
            if (!f) throw new Error(n + ' absent de l\'archive');
            fs.copyFileSync(f, path.join(MOTEUR, 'ffmpeg', n));
          }
          fait = true; break;
        } catch (e) { derniere = e; effacer(TEMP); }
      }
      if (!fait) throw derniere || new Error('ffmpeg n\'a pas pu être téléchargé');
    } else {
      const arch = ARCH === 'arm64' ? 'arm64' : 'amd64';
      const outils = ['ffmpeg', 'ffprobe'];
      for (let i = 0; i < outils.length; i++) {
        const n = outils[i];
        let fait = false, derniere = null;
        for (const canal of ['release', 'snapshot']) {
          try {
            const z = await telecharger('https://ffmpeg.martin-riedl.de/redirect/latest/macos/' + arch + '/' + canal + '/' + n + '.zip',
              path.join(TEMP, n + '.zip'), progresTelechargement(dire, 'Téléchargement de ' + n, i * 45, i * 45 + 42));
            await extraire(z, path.join(TEMP, n));
            const f = trouverFichier(path.join(TEMP, n), n);
            if (!f) throw new Error(n + ' absent de l\'archive');
            fs.copyFileSync(f, path.join(MOTEUR, 'ffmpeg', n)); fs.chmodSync(path.join(MOTEUR, 'ffmpeg', n), 0o755);
            fait = true; break;
          } catch (e) { derniere = e; }
        }
        if (!fait) throw derniere || new Error(n + ' n\'a pas pu être téléchargé');
      }
      await lancer('xattr', ['-dr', 'com.apple.quarantine', path.join(MOTEUR, 'ffmpeg')], { delai: 30000 });
    }
    effacer(TEMP);
    // Smart App Control bloque un programme non signé la PREMIÈRE fois qu'il le voit, puis l'accepte : quelques essais
    let v = null, w = null;
    for (let essai = 0; essai < 5; essai++) {
      v = await lancer(FFMPEG, ['-version'], { delai: 15000 }); w = await lancer(FFPROBE, ['-version'], { delai: 15000 });
      if (v.code === 0 && w.code === 0) break;
      dire('Windows vérifie les outils vidéo… (essai ' + (essai + 2) + ')', 96);
      await new Promise(r => setTimeout(r, 4000));
    }
    if (v.code !== 0 || w.code !== 0) throw new Error(WIN
      ? 'Windows bloque les outils vidéo (Smart App Control). Si un message « Une partie de cette application a été bloquée » s\'est affiché, attendez une minute puis cliquez « Réessayer ».'
      : 'ffmpeg ne se lance pas : ' + ((v.erreur || '') + (w.erreur || '')).slice(-200));
    reglage({ ffmpeg: FFMPEG, ffprobe: FFPROBE });
    dire('ffmpeg est prêt.', 100);
  }

  // 3. Un navigateur pour la mise en page et l'export, s'il n'y en a aucun : Chrome for Testing.
  async function installerNavigateur(dire) {
    if (D.trouverNavigateur()) { dire('Un navigateur est déjà là.', 100); return; }
    const plat = WIN ? 'win64' : ARCH === 'arm64' ? 'mac-arm64' : 'mac-x64';
    const j = await lireJson('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json');
    const d = ((((j.channels || {}).Stable || {}).downloads || {}).chrome || []).find(x => x.platform === plat);
    if (!d) throw new Error('Chrome for Testing introuvable pour cet ordinateur.');
    effacer(TEMP); effacer(path.join(MOTEUR, 'navigateur'));
    const z = await telecharger(d.url, path.join(TEMP, 'chrome.zip'), progresTelechargement(dire, 'Téléchargement du navigateur', 0, 90));
    dire('Décompression…', 92);
    await extraire(z, path.join(MOTEUR, 'navigateur'));
    effacer(TEMP);
    if (MAC) await lancer('xattr', ['-dr', 'com.apple.quarantine', path.join(MOTEUR, 'navigateur')], { delai: 30000 });
    if (!D.trouverNavigateur()) throw new Error('Le navigateur n\'a pas été trouvé après décompression.');
    dire('Le navigateur est prêt.', 100);
  }

  // 4. L'icône du Bureau.
  async function installerRaccourci(dire) {
    if (WIN) {
      const r = await lancer('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(RACINE, 'LANCEUR', 'raccourci-bureau.ps1')], { delai: 60000 });
      const dossier = (r.sortie.match(/BUREAU=(.+)/) || [])[1];
      if (r.code !== 0 || !dossier) throw new Error('Le raccourci n\'a pas pu être créé : ' + (r.erreur || r.sortie).slice(-300));
      fs.mkdirSync(MOTEUR, { recursive: true });
      fs.writeFileSync(path.join(MOTEUR, 'raccourci.json'), JSON.stringify({ dossier: dossier.trim() }));
    } else if (MAC) {
      const app = path.join(RACINE, 'Storymatic.app'), lien = path.join(os.homedir(), 'Desktop', NOM_RACCOURCI);
      if (!existe(app)) throw new Error('Storymatic.app est introuvable dans le dossier de Storymatic.');
      try { fs.unlinkSync(lien); } catch (e) {}
      fs.symlinkSync(app, lien);
    } else throw new Error('Pas d\'icône du Bureau sur ce système.');
    dire('L\'icône est sur le Bureau.', 100);
  }

  // 5. FACULTATIF — le détourage gratuit : un Python à lui (MOTEUR/python), onnxruntime, et le modèle BiRefNet.
  async function urlPythonMac() {
    const triple = ARCH === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    const re = new RegExp('^cpython-3\\.12\\.\\d+\\+\\d+-' + triple.replace(/[.]/g, '\\.') + '-install_only\\.tar\\.gz$');
    try {
      const j = await lireJson('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest');
      const a = (j.assets || []).find(x => re.test(x.name));
      if (a) return a.browser_download_url;
    } catch (e) { /* limite de GitHub : la version connue */ }
    return 'https://github.com/astral-sh/python-build-standalone/releases/download/20260924/cpython-3.12.14%2B20260924-' + triple + '-install_only.tar.gz';
  }
  async function installerDetourage(dire) {
    if (!WIN && !MAC) throw new Error('Le détourage gratuit s\'installe sur Windows et sur Mac.');
    const machine = existe(PY) ? await lancer(PY, ['-c', 'import platform; print(platform.machine())'], { delai: 30000 }) : null;
    const bonnePuce = !MAC || !machine || machine.code !== 0 || machine.sortie.trim() === (ARCH === 'arm64' ? 'arm64' : 'x86_64');
    if (!existe(PY) || !machine || machine.code !== 0 || !bonnePuce) {
      effacer(path.join(MOTEUR, 'python')); effacer(TEMP);
      if (WIN) {
        const a = await telecharger(PYTHON_WIN, path.join(TEMP, 'python.zip'), progresTelechargement(dire, 'Téléchargement de Python', 0, 6));
        dire('Décompression de Python…', 7);
        await extraire(a, path.join(MOTEUR, 'python'));
        for (const f of fs.readdirSync(path.join(MOTEUR, 'python')).filter(n => /\._pth$/i.test(n))) {
          const p = path.join(MOTEUR, 'python', f);
          fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^#\s*import site/m, 'import site'));
        }
        dire('Mise en place de pip…', 8);
        const g = await telecharger(GET_PIP, path.join(TEMP, 'get-pip.py'));
        const r = await lancer(PY, [g, '--no-warn-script-location', '--disable-pip-version-check'], { delai: 10 * 60000 });
        if (r.code !== 0) throw new Error('pip n\'a pas pu être installé : ' + (r.erreur || r.sortie).trim().split('\n').slice(-3).join(' '));
      } else {
        const a = await telecharger(await urlPythonMac(), path.join(TEMP, 'python.tar.gz'), progresTelechargement(dire, 'Téléchargement de Python', 0, 8));
        dire('Décompression de Python…', 9);
        await extraire(a, MOTEUR);
      }
      effacer(TEMP);
      if (!existe(PY)) throw new Error('Python n\'a pas été trouvé après décompression.');
      const v = await lancer(PY, ['-c', 'print(1)'], { delai: 30000 });
      if (v.code !== 0) throw new Error(bloque(v) ? BLOQUE : 'Python ne démarre pas : ' + (v.erreur || '').trim().slice(-200));
    }
    dire('Installation d\'onnxruntime, numpy et Pillow…', 12);
    let n = 0;
    const pip = await lancer(PY, ['-m', 'pip', 'install', '--only-binary=:all:', '--disable-pip-version-check', '--no-warn-script-location', '--progress-bar', 'off'].concat(PAQUETS), {
      delai: 30 * 60000, env: Object.assign({}, process.env, { PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' }),
      surLigne: l => { const m = l.match(/^(Collecting|Downloading)\s*(.*)$/); if (!m) return; if (m[1] === 'Collecting') n++; dire('Téléchargement : ' + m[2].split(/[\s(]/)[0].replace(/-\d.*$/, ''), Math.min(30, 12 + n * 2)); } });
    try { fs.writeFileSync(JOURNAL, [new Date().toISOString(), process.platform + ' ' + process.arch + ' (puce : ' + ARCH + ')', '', pip.sortie, '', pip.erreur].join('\n')); } catch (e) {}
    if (pip.code !== 0) throw new Error('L\'installation du détourage a échoué : ' + (pip.erreur || pip.sortie).trim().split('\n').slice(-3).join(' ') + ' (détail : MOTEUR/installation-outils.log)');
    const essai = await lancer(PY, ['-c', 'import numpy, PIL.Image, onnxruntime'], { delai: 120000 });
    if (essai.code !== 0) throw new Error(bloque(essai) ? BLOQUE : 'Les outils sont installés mais ne se chargent pas : ' + (essai.erreur || '').trim().split('\n').slice(-2).join(' '));
    if (!modeleOk()) {
      dire('Téléchargement du modèle de détourage (≈ 970 Mo)…', 32);
      await telecharger(URL_BIREFNET, MODELE, (recu, total) => dire('Modèle de détourage — ' + mo(recu) + ' sur ' + mo(total || TAILLE_MODELE), 32 + 64 * Math.min(1, recu / (total || TAILLE_MODELE))));
      dire('Vérification du modèle…', 97);
      const md5 = await new Promise((ok, ko) => { const h = require('crypto').createHash('md5'); fs.createReadStream(MODELE).on('data', b => h.update(b)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
      if (md5 !== MD5_BIREFNET) { effacer(MODELE); throw new Error('Le modèle de détourage est arrivé abîmé : cliquez à nouveau sur « Installer ».'); }
    }
    reglage({ pythonDetourage: PY });
    dire('Le détourage gratuit est prêt.', 100);
  }

  const INSTALLEURS = { claude: installerClaude, ffmpeg: installerFfmpeg, navigateur: installerNavigateur, raccourci: installerRaccourci, detourage: installerDetourage };

  // « Tout installer » : ce qui manque et s'installe seul, dans l'ordre (le détourage, facultatif, a son bouton à lui).
  async function toutInstaller() {
    const p = (await etat(true)).pieces, manque = [];
    if (!p.claude.ok) manque.push('claude');
    if (!p.ffmpeg.ok) manque.push('ffmpeg');
    if (!p.navigateur.ok) manque.push('navigateur');
    if (!p.raccourci.ok && (WIN || MAC)) manque.push('raccourci');
    manque.forEach(n => tache(n, INSTALLEURS[n]));
    return manque;
  }

  /* ---------------- LA CONNEXION AU COMPTE CLAUDE ----------------
     `claude auth login` ouvre lui-même la page de connexion du navigateur par défaut ; son lien de secours s'affiche
     aussi dans la page (copiable dans n'importe quel navigateur) ; si la page donne un code, la page le transmet.
     « Annuler » arrête l'attente ; une nouvelle connexion ferme d'abord tout Claude resté en attente. */
  const CONNEXIONS = {};
  function publiques() {
    const o = {};
    Object.keys(CONNEXIONS).forEach(k => { const c = CONNEXIONS[k]; o[k] = { etat: c.etat, url: c.url || '', erreur: c.erreur || '', depuis: c.debut }; });
    return o;
  }
  async function fermerAttentes(motif) {
    if (WIN) {
      await lancer('powershell.exe', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Where-Object { $_.CommandLine -match '" + motif + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { delai: 20000 });
    } else await lancer('pkill', ['-f', motif], { delai: 10000 });
  }
  function arreter(nom, etatFinal, erreur) {
    const c = CONNEXIONS[nom]; if (!c) return;
    clearTimeout(c.minuteur);
    if (c.proc) { try { c.proc.kill(); } catch (e) {} c.proc = null; }
    c.etat = etatFinal; c.erreur = erreur || '';
  }
  async function connecterCompte() {
    if (!claude()) throw new Error('Installez d\'abord Claude Code.');
    if (CONNEXIONS.compte) arreter('compte', 'annule');
    await fermerAttentes('auth login');
    const c = CONNEXIONS.compte = { etat: 'en-cours', url: '', erreur: '', debut: Date.now() };
    // windowsHide: false — sinon le navigateur ouvert par Claude hérite du réglage « caché » (fenêtre fantôme)
    const p = cp.spawn(claude(), argsClaude(['auth', 'login', '--claudeai']), { cwd: RACINE, windowsHide: false, env: process.env });
    c.proc = p;
    const lire = d => { const m = String(d).match(/https:\/\/\S+/); if (m && !c.url) c.url = m[0]; };
    p.stdout.on('data', lire); p.stderr.on('data', lire);
    p.on('error', e => { if (CONNEXIONS.compte === c) { c.etat = 'erreur'; c.erreur = e.message; } });
    p.on('close', async code => {
      if (CONNEXIONS.compte !== c || c.etat !== 'en-cours') return;
      c.proc = null; cacheCompte = null;
      const v = await compte(true);
      c.etat = v.connecte ? 'fini' : 'erreur';
      if (!v.connecte) c.erreur = code === 0 ? 'La connexion ne s\'est pas faite.' : 'La connexion a été interrompue.';
    });
    c.minuteur = setTimeout(() => { if (c.etat === 'en-cours') arreter('compte', 'erreur', 'Temps dépassé : cliquez à nouveau sur « Se connecter ».'); }, 15 * 60000);
    return publiques().compte;
  }
  function codeCompte(code) {
    const c = CONNEXIONS.compte;
    if (!c || !c.proc) throw new Error('Aucune connexion en cours : cliquez d\'abord sur « Se connecter ».');
    c.proc.stdin.write(String(code || '').trim() + '\n');
  }
  async function changerCompte() {
    if (!claude()) throw new Error('Installez d\'abord Claude Code.');
    await commandeClaude(['auth', 'logout'], { delai: 30000 });
    cacheCompte = null;
    return connecterCompte();
  }

  /* ---------------- LES ROUTES ---------------- */
  function routes(req, res, url) {
    if (!url.startsWith('/api/installation')) return false;
    const M = req.method;
    const repondre = p => p.then(v => D.repondreJson(res, 200, v)).catch(e => D.repondreJson(res, 500, { erreur: (e && e.message) || String(e) }));
    const u = new URL(req.url, 'http://x'), chemin = u.pathname;
    if (M === 'GET' && chemin === '/api/installation') { repondre(etat(u.searchParams.has('frais'))); return true; }
    // le résumé rapide : faut-il ouvrir la page au démarrage ?
    if (M === 'GET' && chemin === '/api/installation/resume') {
      repondre((async () => { const [co, ff] = await Promise.all([claude() ? compte() : { connecte: false }, ffmpegOk()]);
        return { pret: !!claude() && co.connecte && !!ff && !!D.trouverNavigateur() }; })());
      return true;
    }
    if (M === 'POST' && chemin === '/api/installation/tout') { repondre(toutInstaller().then(l => ({ lancees: l }))); return true; }
    const m = chemin.match(/^\/api\/installation\/installer\/(\w+)$/);
    if (M === 'POST' && m) {
      if (!INSTALLEURS[m[1]]) { D.repondreJson(res, 404, { erreur: 'inconnu' }); return true; }
      tache(m[1], INSTALLEURS[m[1]]); D.repondreJson(res, 200, { ok: true }); return true;
    }
    if (M === 'POST' && chemin === '/api/installation/compte') { repondre(connecterCompte()); return true; }
    if (M === 'POST' && chemin === '/api/installation/compte/code') { repondre(D.corpsJson(req, 1e4).then(d => { codeCompte(d && d.code); return { ok: true }; })); return true; }
    if (M === 'POST' && chemin === '/api/installation/compte/changer') { repondre(changerCompte()); return true; }
    if (M === 'POST' && chemin === '/api/installation/compte/annuler') { if (CONNEXIONS.compte) arreter('compte', 'annule'); D.repondreJson(res, 200, publiques()); return true; }
    D.repondreJson(res, 404, { erreur: 'inconnu' });
    return true;
  }

  return { routes, etat };
};
