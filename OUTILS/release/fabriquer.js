/* ============================================================
   LES ZIPS À TÉLÉCHARGER — Windows et Mac (13 oct. 2026, repris de MOSAIC : OUTILS/release/fabriquer-zips.js)

   node OUTILS/release/fabriquer.js            (depuis le dossier de Storymatic)

   Prépare Storymatic SANS aucune donnée personnelle (profils, semaines, DA, captures, vidéos, stickers, GIF, clés,
   réglages : rien de ce que .gitignore écarte), puis en fait DEUX zips dans _RELEASES/ :
     Storymatic-Windows_<date>.zip   + MOTEUR/node/node.exe
     Storymatic-Mac_<date>.zip       + MOTEUR/node/darwin-arm64/bin/node et darwin-x64/bin/node
   Node.js est LIVRÉ dedans (dernière LTS de nodejs.org, SHA-256 vérifié, gardée dans _RELEASES/_cache, licence MIT
   jointe) : la personne n'installe rien avant d'ouvrir Storymatic, qui installe lui-même le reste (page Installation).
   Ce sont ces deux zips qu'on joint à une « Release » GitHub.

   Le zip est écrit ICI, pas par tar : un zip fait sous Windows perd les droits d'exécution, et sur Mac l'application,
   les .command et node refuseraient de se lancer. Chaque entrée porte son mode Unix (0755 pour ce qui s'exécute).
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib'), https = require('https'), crypto = require('crypto'), cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const NOM = 'Storymatic';                                   // le dossier racine dans le zip
const SORTIE = path.join(RACINE, '_RELEASES'), CACHE = path.join(SORTIE, '_cache');
const d = new Date(), deux = n => String(n).padStart(2, '0');
const DATE = d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate());
const VERSION = DATE + '-' + deux(d.getHours()) + deux(d.getMinutes());
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/* ---------- CE QUI PART ---------- */
const FICHIERS = ['serveur.js', 'profil.js', 'semaine.js', 'apprendre.js', 'stickers.js', 'installation.js',
  'README.md', 'LICENSE', 'CLAUDE.md', 'OUVRIR STORYMATIC.vbs', 'OUVRIR STORYMATIC.command'];
const DOSSIERS = ['app', 'SAVOIR', 'Storymatic.app'];
// LANCEUR : les fichiers seuls (jamais profil-navigateur) ; OUTILS : les scripts seuls (jamais release, ni un Python)
const LANCEUR = () => fs.readdirSync(path.join(RACINE, 'LANCEUR'), { withFileTypes: true }).filter(e => e.isFile()).map(e => 'LANCEUR/' + e.name);
const OUTILS = () => fs.readdirSync(path.join(RACINE, 'OUTILS'), { withFileTypes: true }).filter(e => e.isFile() && /\.(py|js)$/.test(e.name)).map(e => 'OUTILS/' + e.name);
// les fichiers Mac gardent des fins de ligne LF
const MAC_LF = ['OUVRIR STORYMATIC.command', 'Storymatic.app/Contents/MacOS/lancer', 'Storymatic.app/Contents/Info.plist'];
// ce qui s'exécute sur Mac
const EXECUTABLE = n => /\.command$/.test(n) || /\.app\/Contents\/MacOS\//.test(n) || /\/bin\/node$/.test(n);

/* ---------- télécharger (redirections suivies) ---------- */
function telecharger(url, dest) {
  return new Promise((ok, ko) => {
    https.get(url, { headers: { 'User-Agent': 'Storymatic-build' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return telecharger(new URL(res.headers.location, url).toString(), dest).then(ok, ko); }
      if (res.statusCode !== 200) { res.resume(); return ko(new Error(res.statusCode + ' ' + url)); }
      const f = fs.createWriteStream(dest + '.part');
      res.pipe(f); f.on('finish', () => f.close(() => { fs.renameSync(dest + '.part', dest); ok(dest); })); f.on('error', ko);
    }).on('error', ko);
  });
}
const lireTexte = url => new Promise((ok, ko) => https.get(url, { headers: { 'User-Agent': 'Storymatic-build' } }, r => { let s = ''; r.on('data', x => s += x); r.on('end', () => ok(s)); }).on('error', ko));

/* ---------- Node.js : la dernière LTS, pour Windows et les deux Mac ---------- */
async function nodes() {
  fs.mkdirSync(CACHE, { recursive: true });
  const index = JSON.parse(await lireTexte('https://nodejs.org/dist/index.json'));
  const v = index.find(x => x.lts).version;
  const sommes = await lireTexte('https://nodejs.org/dist/' + v + '/SHASUMS256.txt');
  const cibles = { 'win-x64': 'node-' + v + '-win-x64.zip', 'darwin-arm64': 'node-' + v + '-darwin-arm64.tar.gz', 'darwin-x64': 'node-' + v + '-darwin-x64.tar.gz' };
  const out = {};
  for (const [cle, fichier] of Object.entries(cibles)) {
    const archive = path.join(CACHE, fichier), dossier = path.join(CACHE, fichier.replace(/\.(zip|tar\.gz)$/, ''));
    if (!fs.existsSync(archive)) { console.log('  téléchargement de ' + fichier + '…'); await telecharger('https://nodejs.org/dist/' + v + '/' + fichier, archive); }
    const attendu = (sommes.split('\n').find(l => l.endsWith('  ' + fichier)) || '').split(' ')[0];
    const vu = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (!attendu || attendu !== vu) { fs.unlinkSync(archive); throw new Error('empreinte fausse pour ' + fichier + ' : archive retirée, relancez'); }
    const base = path.basename(dossier), utiles = cle === 'win-x64' ? [base + '/node.exe', base + '/LICENSE'] : [base + '/bin/node', base + '/LICENSE'];
    if (!utiles.every(u => fs.existsSync(path.join(CACHE, u)))) {
      const r = cp.spawnSync(TAR, ['-xf', archive, '-C', CACHE].concat(utiles));
      if (r.status || !utiles.every(u => fs.existsSync(path.join(CACHE, u)))) throw new Error('décompression de ' + fichier + ' : ' + String(r.stderr || '').slice(0, 300));
    }
    out[cle] = dossier;
  }
  console.log('  Node.js ' + v + ' (LTS), empreintes vérifiées');
  return out;
}

/* ---------- le zip, écrit à la main (modes Unix compris) ---------- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { if (zlib.crc32) return zlib.crc32(b); let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function dosTemps(t) { return { heure: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1), jour: ((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate() }; }
function ecrireZip(sortie, entrees) {
  const fd = fs.openSync(sortie, 'w'); let pos = 0; const central = [];
  const ecrire = b => { fs.writeSync(fd, b); pos += b.length; };
  for (const e of entrees) {
    const nom = Buffer.from(e.nom, 'utf8');
    const brut = e.dossier ? Buffer.alloc(0) : (e.donnees || fs.readFileSync(e.source));
    const crc = e.dossier ? 0 : crc32(brut);
    let donnees = brut, methode = 0;
    if (!e.dossier && brut.length > 0) { const z = zlib.deflateRawSync(brut, { level: 9 }); if (z.length < brut.length) { donnees = z; methode = 8; } }
    const t = dosTemps(e.mtime || new Date()), debut = pos;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(methode, 8);
    loc.writeUInt16LE(t.heure, 10); loc.writeUInt16LE(t.jour, 12); loc.writeUInt32LE(crc >>> 0, 14);
    loc.writeUInt32LE(donnees.length, 18); loc.writeUInt32LE(brut.length, 22); loc.writeUInt16LE(nom.length, 26); loc.writeUInt16LE(0, 28);
    ecrire(loc); ecrire(nom); ecrire(donnees);
    const mode = e.dossier ? (0o040000 | 0o755) : (0o100000 | (e.executable ? 0o755 : 0o644));
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(methode, 10);
    c.writeUInt16LE(t.heure, 12); c.writeUInt16LE(t.jour, 14); c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(donnees.length, 20); c.writeUInt32LE(brut.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
    c.writeUInt32LE(((mode << 16) | (e.dossier ? 0x10 : 0)) >>> 0, 38); c.writeUInt32LE(debut, 42);
    central.push(Buffer.concat([c, nom]));
  }
  const debutCentral = pos; central.forEach(ecrire);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(pos - debutCentral, 12); fin.writeUInt32LE(debutCentral, 16);
  ecrire(fin); fs.closeSync(fd);
}

/* ---------- la liste des fichiers (chemins relatifs, avec « / ») ---------- */
function parcourir(rel, liste) {
  const abs = path.join(RACINE, rel);
  if (fs.statSync(abs).isDirectory()) {
    liste.push({ rel, dossier: true });
    for (const e of fs.readdirSync(abs)) { if (e === '_corbeille' || e === '.DS_Store') continue; parcourir(rel + '/' + e, liste); }
  } else liste.push({ rel, source: abs, mtime: fs.statSync(abs).mtime });
  return liste;
}
function entrees(filtre) {
  const l = [];
  const dossiersVus = new Set();
  const ajouterDossier = rel => { const p = rel.split('/'); for (let i = 1; i < p.length; i++) { const dd = p.slice(0, i).join('/'); if (!dossiersVus.has(dd)) { dossiersVus.add(dd); l.push({ nom: NOM + '/' + dd + '/', dossier: true }); } } };
  const tout = [];
  FICHIERS.concat(LANCEUR(), OUTILS()).forEach(f => tout.push({ rel: f, source: path.join(RACINE, f), mtime: fs.statSync(path.join(RACINE, f)).mtime }));
  DOSSIERS.forEach(dd => parcourir(dd, tout));
  for (const x of tout.filter(x => filtre(x.rel))) {
    if (x.dossier) { if (!dossiersVus.has(x.rel)) { ajouterDossier(x.rel + '/x'); } continue; }
    ajouterDossier(x.rel);
    const e = { nom: NOM + '/' + x.rel, source: x.source, mtime: x.mtime, executable: EXECUTABLE(x.rel) };
    if (MAC_LF.includes(x.rel)) e.donnees = Buffer.from(fs.readFileSync(x.source, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    l.push(e);
  }
  l.push({ nom: NOM + '/VERSION.json', donnees: Buffer.from(JSON.stringify({ version: VERSION, date: new Date().toISOString() }, null, 2) + '\n') });
  return [{ nom: NOM + '/', dossier: true }].concat(l);
}

(async () => {
  // garde-fous : tout ce qui doit partir est là, et rien de personnel dans ce qui part
  for (const f of FICHIERS.concat(DOSSIERS)) if (!fs.existsSync(path.join(RACINE, f))) throw new Error('manque : ' + f);
  const N = await nodes();
  fs.mkdirSync(SORTIE, { recursive: true });

  // WINDOWS : sans l'application Mac ni les .command
  const win = entrees(rel => !/^Storymatic\.app(\/|$)/.test(rel) && !/\.command$/.test(rel));
  win.push({ nom: NOM + '/MOTEUR/', dossier: true }, { nom: NOM + '/MOTEUR/node/', dossier: true },
           { nom: NOM + '/MOTEUR/node/node.exe', source: path.join(N['win-x64'], 'node.exe') },
           { nom: NOM + '/MOTEUR/node/LICENSE.txt', source: path.join(N['win-x64'], 'LICENSE') });
  const zw = path.join(SORTIE, 'Storymatic-Windows_' + DATE + '.zip');
  ecrireZip(zw, win);

  // MAC : sans ce qui ne sert qu'à Windows (.vbs, LANCEUR)
  const mac = entrees(rel => !/\.vbs$/i.test(rel) && !/^LANCEUR(\/|$)/.test(rel));
  mac.push({ nom: NOM + '/MOTEUR/', dossier: true }, { nom: NOM + '/MOTEUR/node/', dossier: true });
  for (const a of ['darwin-arm64', 'darwin-x64']) {
    mac.push({ nom: NOM + '/MOTEUR/node/' + a + '/', dossier: true }, { nom: NOM + '/MOTEUR/node/' + a + '/bin/', dossier: true },
             { nom: NOM + '/MOTEUR/node/' + a + '/bin/node', source: path.join(N[a], 'bin', 'node'), executable: true },
             { nom: NOM + '/MOTEUR/node/' + a + '/LICENSE', source: path.join(N[a], 'LICENSE') });
  }
  const zm = path.join(SORTIE, 'Storymatic-Mac_' + DATE + '.zip');
  ecrireZip(zm, mac);

  const mo = f => (fs.statSync(f).size / 1e6).toFixed(1) + ' Mo';
  console.log('  version ' + VERSION);
  console.log('  ' + path.basename(zw) + ' : ' + mo(zw) + ' (' + win.length + ' entrées)');
  console.log('  ' + path.basename(zm) + ' : ' + mo(zm) + ' (' + mac.length + ' entrées, ' + mac.filter(e => e.executable).length + ' exécutables)');
  console.log('  → à joindre à une Release sur GitHub (onglet « Releases » › « Draft a new release »).');
})().catch(e => { console.error('ÉCHEC : ' + (e.message || e)); process.exit(1); });
