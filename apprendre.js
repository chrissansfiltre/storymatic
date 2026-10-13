/* ============================================================
   « APPRENDRE MON STYLE » (30 sept. 2026 ; maquette LABO/module-da-v2, validée)
   Dans une sous-DA Carrousel ou Story, la personne glisse UN dossier : ses publications d'exemple (un sous-dossier par
   carrousel), ses éléments (patchs, stickers, flèches…), ses polices, ses GIF, son fond. La PAGE trie (app/js/apprendre.js :
   dimensions, transparence, extension) et envoie ; le serveur fait le reste, sans aucun crédit (Claude, Read seul,
   --strict-mcp-config) :
     1. Claude REGARDE chaque carrousel (3 à la fois) → une fiche : rôle et texte de chaque slide, blocs, fond, typo ;
     2. il fait la SYNTHÈSE → couleurs, style, polices décrites + candidates, 5 slides d'exemple, le nom et le « quand »
        de chaque élément et de chaque GIF (planches photographiées), et ce qu'il voit sans en avoir le fichier ;
     3. il ÉCRIT la charte (SAVOIR/charte-modele.md, sur un modèle de charte réelle) ;
     4. il COMPOSE 2 slides test avec cette charte, que le navigateur du poste photographie ;
     5. il les COMPARE à leurs originales et corrige la charte (un tour) ;
     6. le texte lu sur les slides devient une proposition pour « Tes phrases à toi ».
   Rien n'entre dans la DA avant « Enregistrer » : la personne valide ou corrige rubrique par rubrique (sa correction est un
   ORDRE qui passe avant les règles). Les sessions vivent dans CACHE/apprendre/<session>/ (copies de travail).
   ============================================================ */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

module.exports = function (D) {
  const DOSSIER = path.join(D.DOSSIER_CACHE, 'apprendre');
  const SESSIONS = new Map();   // id → la session en mémoire (le travail en cours)
  const RAYONS = ['slides', 'elements', 'fonds', 'gifs', 'polices'];
  const sansOutils = { outils: ['Read'], args: ['--strict-mcp-config'] };
  const GRATUIT = "Ce travail ne dépense AUCUN crédit : n'appelle aucun outil de génération (Magnific, Higgsfield…), seulement Read.";
  const idOk = x => /^a[a-z0-9]{6,20}$/.test(String(x || ''));
  const dossierDe = id => path.join(DOSSIER, id);
  const fSession = id => path.join(dossierDe(id), 'session.json');
  const maintenant = () => new Date().toISOString();

  function lire(id) {
    if (!idOk(id)) return null;
    if (SESSIONS.has(id)) return SESSIONS.get(id);
    try {
      const s = JSON.parse(fs.readFileSync(fSession(id), 'utf8'));
      if (s.etat === 'travail') { s.etat = 'erreur'; s.erreur = 'Le studio a été relancé pendant l\'apprentissage : relancez-le.'; }
      if (s.etat === 'enregistrement') { s.etat = 'fini'; s.erreurEnreg = 'Le studio a été relancé pendant l\'enregistrement : une partie est peut-être déjà dans la DA. Relancez-le pour finir.'; }
      SESSIONS.set(id, s); return s;
    } catch (e) { return null; }
  }
  const ecrire = s => { fs.mkdirSync(dossierDe(s.id), { recursive: true }); D.ecrireJsonSurement(fSession(s.id), s); };
  // ce que la page voit : pas les chemins du disque
  const vue = s => {
    // les éléments que la sous-DA a DÉJÀ (au moment où on regarde) : « remplacer les éléments actuels » se propose alors
    if (s.resultat) { try { const d = D.lireIdentite(s.daId); s.resultat.dejaEls = s.etat === 'enregistre' ? 0 : ((d && d.sous[s.sous] && d.sous[s.sous].elements) || []).length; } catch (e) {} }
    return Object.assign({}, s, { resultat: s.resultat || null });
  };

  function creer(d) {
    const g = D.sousDA(d.sous);
    if (g !== 'carrousel' && g !== 'story') throw new Error('« Apprendre mon style » sert aux carrousels et aux stories.');
    if (!D.lireIdentite(d.daId)) throw new Error('DA inconnue.');
    const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const s = { id, daId: d.daId, sous: g, cree: maintenant(), etat: 'depot', fichiers: { slides: [], elements: [], fonds: [], gifs: [], polices: [] },
      carrousels: [], etapes: [], pas: 0, message: '', resultat: null, erreur: '' };
    RAYONS.forEach(r => fs.mkdirSync(path.join(dossierDe(id), r), { recursive: true }));
    SESSIONS.set(id, s); ecrire(s);
    return s;
  }
  // un fichier reçu tel quel (corps brut), rangé dans son rayon ; les slides arrivent en JPEG 1080 (la page les réduit)
  function recevoir(req, id, q) {
    return new Promise((ok, ko) => {
      const s = lire(id); if (!s) return ko(new Error('Session inconnue.'));
      if (s.etat === 'travail') return ko(new Error('L\'apprentissage est en cours.'));
      const rayon = q.get('rayon'); if (!RAYONS.includes(rayon)) return ko(new Error('Rayon inconnu.'));
      const nom = String(q.get('nom') || 'fichier').replace(/[\\\/:*?"<>|]+/g, ' ').trim().slice(0, 90) || 'fichier';
      const ext = (nom.match(/\.[a-z0-9]{2,5}$/i) || [''])[0].toLowerCase();
      const k = s.fichiers[rayon].length + 1;
      const fichier = String(k).padStart(3, '0') + (ext || '.bin');
      const f = path.join(dossierDe(id), rayon, fichier);
      const out = fs.createWriteStream(f); let taille = 0, casse = false;
      req.on('data', c => { taille += c.length; if (taille > 60e6 && !casse) { casse = true; req.destroy(); out.destroy(); ko(new Error('Fichier trop lourd (60 Mo au plus).')); } });
      req.pipe(out);
      out.on('finish', () => {
        if (casse) return;
        const e = { fichier, nom: nom.replace(/\.[a-z0-9]{2,5}$/i, '') };
        if (rayon === 'slides') Object.assign(e, { car: Math.max(0, parseInt(q.get('car'), 10) || 0), n: parseInt(q.get('n'), 10) || k, video: q.get('video') === '1' });
        if (rayon === 'elements') e.transp = q.get('transp') === '1';
        if (rayon === 'slides') { const c = Math.max(0, parseInt(q.get('car'), 10) || 0); s.carrousels[c] = s.carrousels[c] || { nom: String(q.get('carNom') || 'Carrousel ' + (c + 1)).slice(0, 90) }; }
        s.fichiers[rayon].push(e); ecrire(s); ok(e);
      });
      out.on('error', ko);
    });
  }

  /* ---------- les polices de l'ordinateur : le NOM DE FAMILLE lu dans le fichier (table « name ») ----------
     Le registre de Windows ne donne que des noms techniques (« GaramondITCbyBT-BookNarrow ») : le vrai nom de famille
     (« ITC Garamond Book Narrow ») est dans la police elle-même. */
  function nomsPolice(f) {
    try {
      const fd = fs.openSync(f, 'r'); const t = Buffer.alloc(12); fs.readSync(fd, t, 0, 12, 0);
      let base = 0;
      if (t.toString('latin1', 0, 4) === 'ttcf') { const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 12); base = b.readUInt32BE(0); fs.readSync(fd, t, 0, 12, base); }
      const n = t.readUInt16BE(4), dir = Buffer.alloc(n * 16); fs.readSync(fd, dir, 0, n * 16, base + 12);
      let off = -1, len = 0;
      for (let i = 0; i < n; i++) if (dir.toString('latin1', i * 16, i * 16 + 4) === 'name') { off = dir.readUInt32BE(i * 16 + 8); len = dir.readUInt32BE(i * 16 + 12); }
      if (off < 0) { fs.closeSync(fd); return null; }
      const nt = Buffer.alloc(Math.min(len, 200000)); fs.readSync(fd, nt, 0, nt.length, off); fs.closeSync(fd);
      const nb = nt.readUInt16BE(2), stock = nt.readUInt16BE(4), r = {};
      for (let i = 0; i < nb; i++) {
        const o = 6 + i * 12, plat = nt.readUInt16BE(o), lang = nt.readUInt16BE(o + 4), nid = nt.readUInt16BE(o + 6), l = nt.readUInt16BE(o + 8), p = nt.readUInt16BE(o + 10);
        if (![1, 2, 4, 16, 17].includes(nid)) continue;
        const b = nt.slice(stock + p, stock + p + l);
        let v = '';
        if (plat === 3 || plat === 0) { for (let j = 0; j + 1 < b.length; j += 2) v += String.fromCharCode(b.readUInt16BE(j)); if (plat === 3 && lang !== 0x409 && r[nid]) continue; }
        else if (plat === 1) { if (r[nid]) continue; v = b.toString('latin1'); }
        else continue;
        r[nid] = v.trim();
      }
      const famille = r[16] || r[1], style = r[17] || r[2] || '';
      return famille ? { famille, style, italique: /italic|oblique/i.test(style) } : null;
    } catch (e) { return null; }
  }
  let posteMemo = null;
  function policesDuPoste() {
    if (posteMemo) return posteMemo;
    const dossiers = process.platform === 'win32'
      ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')]
      : process.platform === 'darwin' ? ['/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts'), '/System/Library/Fonts', '/System/Library/Fonts/Supplemental']
      : ['/usr/share/fonts', path.join(os.homedir(), '.fonts')];
    const par = new Map();
    for (const d of dossiers) {
      let l = []; try { l = fs.readdirSync(d); } catch (e) { continue; }
      for (const x of l) {
        if (!/\.(ttf|otf|ttc)$/i.test(x)) continue;
        const f = path.join(d, x), n = nomsPolice(f); if (!n) continue;
        const p = par.get(n.famille) || { nom: n.famille, fichiers: {} };
        const cle = n.italique ? 'italique' : /^(regular|book|normal|roman|medium)?$/i.test(n.style.replace(/\s+/g, '')) || !p.fichiers.normal ? 'normal' : null;
        if (cle && (!p.fichiers[cle] || /^(regular|book|roman)$/i.test(n.style))) p.fichiers[cle] = f;
        par.set(n.famille, p);
      }
    }
    posteMemo = [...par.values()].filter(p => p.fichiers.normal || p.fichiers.italique);
    setTimeout(() => { posteMemo = null; }, 10 * 60000);
    return posteMemo;
  }

  /* ---------- les outils du travail ---------- */
  const tailleImage = f => { try { const r = cp.spawnSync(D.ffprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8', windowsHide: true });
    const [l, h] = String(r.stdout || '').trim().split(',').map(Number); return l && h ? { l, h } : null; } catch (e) { return null; } };
  async function parLots(l, n, fn) {
    const r = new Array(l.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, l.length) }, async () => { while (i < l.length) { const k = i++; r[k] = await fn(l[k], k); } }));
    return r;
  }
  // une planche : les images en cases de 200 px sur un gris moyen, 8 par ligne (ordre de lecture) — Claude la REGARDE
  async function planche(fichiers, sortie) {
    const tmp = sortie + '-cases'; fs.mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < fichiers.length; i++) {
      await D.executer(D.ffmpeg(), ['-v', 'error', '-y', '-i', fichiers[i], '-f', 'lavfi', '-i', 'color=c=0x8a8a8a:s=200x200', '-filter_complex',
        '[0:v]scale=184:184:force_original_aspect_ratio=decrease[a];[1:v][a]overlay=(W-w)/2:(H-h)/2:format=auto', '-frames:v', '1', path.join(tmp, String(i + 1).padStart(3, '0') + '.png')], 60000);
    }
    const col = Math.min(8, fichiers.length), lig = Math.ceil(fichiers.length / col);
    await D.executer(D.ffmpeg(), ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, '%03d.png'), '-vf', 'tile=' + col + 'x' + lig + ':padding=8:margin=8:color=0x303030', '-frames:v', '1', sortie], 120000);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    return { col, lig };
  }
  const demander = (q, delai) => D.demanderJson(q + '\n\n' + GRATUIT, delai || 8 * 60000, sansOutils);
  const texte = (q, sys, delai) => D.interroger(q, sys + ' ' + GRATUIT, null, 20, delai || 8 * 60000, sansOutils).then(r => String(r.texte || '').trim());
  const url = (s, rayon, f) => '/apprendre-fichier/' + s.id + '/' + rayon + '/' + encodeURIComponent(f);
  const chemin = (s, rayon, f) => path.join(dossierDe(s.id), rayon, f);

  // 1. une fiche par carrousel
  async function regarder(s, c, i) {
    const slides = s.fichiers.slides.filter(x => x.car === i).sort((a, b) => a.n - b.n);
    const q = [
      `Voici les ${slides.length} ${s.sous === 'story' ? 'stories' : 'slides'} d'un ${s.sous === 'story' ? 'enchaînement de stories' : 'carrousel'} Instagram publié par un créateur (« ${c.nom} »), dans l'ordre. Ouvre CHACUNE avec l'outil Read, sans en sauter.`,
      slides.map((x, k) => `- ${s.sous === 'story' ? 'story' : 'slide'} ${k + 1}${x.video ? ' (c\'est l\'image d\'une slide VIDÉO)' : ''} : ${chemin(s, 'slides', x.fichier)}`).join('\n'),
      'Relève son STYLE avec précision (tu décris, tu n\'inventes rien) : ce qu\'on voit, où, à quelle taille (en px sur une image de 1080 de large), dans quelles couleurs (#hex), quelles polices (décris-les : serif ou sans, étroite, graisse, italique, casse).',
      'Réponds ce JSON : {"titre":"<le texte de l\'accroche>","slides":[{"n":1,"role":"accroche|corps|fin","texte":"<TOUT le texte lu sur la slide, dans l\'ordre, blocs séparés par \' / \'>","mise_en_page":"<2 à 4 phrases : où est chaque bloc, tailles, alignements, marges, ce qui reste vide>","blocs":["<type (titre, paragraphe, encadré, bulle, étiquette, carte GIF, photo, patch, flèche, dossier, fenêtre…) : son allure exacte — fond, bordure, arrondi, ombre, police, taille, couleur>"],"elements":["<objet graphique reconnaissable qui a l\'air d\'une image de la marque (patch brodé, sticker, flèche peinte, logo, cadre) : description courte, place>"]}],"fond":"<le fond : couleur, texture>","typo":"<les polices et la mise en valeur des mots>","couleurs":["#hex"],"remarques":"<ce qui revient d\'une slide à l\'autre>"}'
    ].join('\n\n');
    const r = await demander(q, 10 * 60000);
    return Object.assign({ nom: c.nom, slides: [] }, r || {});
  }

  async function travailler(s) {
    const d = dossierDe(s.id), L = s.fichiers, stories = s.sous === 'story', F = stories ? { l: 1080, h: 1920 } : { l: 1080, h: 1350 };
    const etape = (k, message) => { s.etapes.forEach((e, i) => { e.etat = i < k ? 'fait' : i === k ? 'en-cours' : ''; }); s.pas = k; s.message = message || ''; ecrire(s); };
    const cars = s.carrousels.map((c, i) => ({ c, i })).filter(x => x.c && L.slides.some(y => y.car === x.i));
    // 1. regarder
    etape(0, '0 / ' + cars.length);
    let faits = 0;
    const fiches = await parLots(cars, 3, async x => { const f = await regarder(s, x.c, x.i).catch(e => ({ nom: x.c.nom, erreur: e.message, slides: [] })); faits++; s.message = faits + ' / ' + cars.length; ecrire(s); return Object.assign(f, { car: x.i }); });
    if (!fiches.some(f => (f.slides || []).length)) throw new Error('Claude n\'a pu lire aucun carrousel : ' + (fiches[0] && fiches[0].erreur || 'réponse vide'));
    // 2. la synthèse : couleurs, style, polices, exemples, éléments, GIF, manquants
    etape(1);
    const fEl = L.elements.map(e => chemin(s, 'elements', e.fichier)), fGif = [];
    for (const g of L.gifs) {   // la première image de chaque GIF
      const o = path.join(d, 'gifs', g.fichier + '-image.png');
      try { await D.executer(D.ffmpeg(), ['-v', 'error', '-y', '-i', chemin(s, 'gifs', g.fichier), '-frames:v', '1', o], 60000); fGif.push(o); } catch (e) { fGif.push(null); }
    }
    let plEl = null, plGif = null;
    if (fEl.length) { plEl = path.join(d, 'planche-elements.png'); try { plEl = Object.assign({ f: plEl }, await planche(fEl, plEl)); } catch (e) { plEl = null; } }
    if (fGif.filter(Boolean).length) { plGif = path.join(d, 'planche-gifs.png'); try { plGif = Object.assign({ f: plGif }, await planche(fGif.filter(Boolean), plGif)); } catch (e) { plGif = null; } }
    const poste = policesDuPoste(), studio = D.policesConnues();
    const deposees = L.polices.map(p => Object.assign({ fichier: p.fichier }, nomsPolice(chemin(s, 'polices', p.fichier)) || { famille: p.nom })).filter(p => p.famille);
    const da = D.lireIdentite(s.daId), sd = da && da.sous[s.sous];
    const qMeta = [
      `Un créateur a publié ces ${stories ? 'stories' : 'carrousels'} Instagram. Voici ce que tu as relevé en les regardant, carrousel par carrousel (les slides sont désignées « <carrousel>/<slide> ») :`,
      JSON.stringify(fiches.map((f, k) => ({ carrousel: k + 1, nom: f.nom, fond: f.fond, typo: f.typo, couleurs: f.couleurs, remarques: f.remarques, slides: (f.slides || []).map(x => ({ n: x.n, role: x.role, texte: String(x.texte || '').slice(0, 400), mise_en_page: x.mise_en_page, blocs: x.blocs, elements: x.elements })) }))),
      'Les slides elles-mêmes, si tu veux en revoir (Read) : ' + cars.map((x, k) => (k + 1) + ' = ' + L.slides.filter(y => y.car === x.i).sort((a, b) => a.n - b.n).map((y, j) => (j + 1) + ':' + chemin(s, 'slides', y.fichier)).join(' ; ')).join('\n'),
      plEl ? `SES ÉLÉMENTS (ses fichiers, à nommer) : ouvre avec Read la planche ${plEl.f} — ${fEl.length} cases de ${plEl.col} par ligne, numérotées de 1 à ${fEl.length} dans l'ordre de lecture (de gauche à droite, ligne par ligne). Leurs noms de fichier, dans l'ordre : ${L.elements.map((e, k) => (k + 1) + '=' + e.nom).join(', ')}.` : 'Aucun fichier d\'élément fourni.',
      plGif ? `SES GIF : ouvre avec Read la planche ${plGif.f} (la première image de chacun, ${plGif.col} par ligne). Leurs noms de fichier : ${L.gifs.map((g, k) => (k + 1) + '=' + g.nom).join(', ')}.` : '',
      `LES POLICES : sur ${os.platform() === 'darwin' ? 'son Mac' : 'son PC'} sont installées : ${poste.map(p => p.nom).slice(0, 600).join(', ')}.` + (deposees.length ? ` IL A MIS SES POLICES DANS SON DOSSIER : ${deposees.map(p => p.famille + (p.italique ? ' (italique)' : '')).join(', ')}. Ce SONT ses polices : chacune est la PREMIÈRE candidate du rôle où elle sert (titres, mots mis en valeur ou petits textes), même si une autre te paraît plus proche.` : '') + ` Déjà dans le studio : ${studio.join(', ')}. Tu peux aussi proposer n'importe quelle police de Google Fonts (nom exact).`,
      'Réponds ce JSON : {"couleurs":{"fond":"#hex","texte":"#hex","accent":"#hex","second":"#hex"},"style":"<2 phrases concrètes : le style visuel de ses slides>","illustration":"<1 phrase : le style de ses images (photos, illustrations…), ou chaîne vide>",' +
      '"polices":{"titres":{"description":"<la police des titres, décrite>","candidats":["<nom exact, la plus proche d\'abord>","…","…"]},"appui":{"description":"<la police des mots mis en valeur, si elle diffère des titres>","candidats":["…"]} ou null,"texte":{"description":"<la police des petits textes, encadrés>","candidats":["…","…"]}},' +
      '"exemples":["<carrousel>/<slide>", …5 : l\'accroche la plus typique, 2 slides du corps qui montrent les blocs, une qui montre un élément ou un composant rare, la dernière slide],' +
      '"elements":[{"k":<numéro de la case>,"nom":"<nom court et parlant, ex. Patch Heureux (tortue), Flèche orange>","quand":"<quand l\'utiliser, d\'après ce que tu vois dans ses slides : l\'émotion, le sujet, la place, la taille>"}],' +
      '"gifs":[{"k":<numéro>,"nom":"<nom court>","quand":"<quand l\'utiliser : la réaction qu\'il exprime>"}],' +
      '"manquants":[{"nom":"<un élément vu sur ses slides mais ABSENT des fichiers fournis>","description":"<à quoi il ressemble>","vu_sur":"<carrousel>/<slide>"}]}',
      'Pour les candidats : une police INSTALLÉE ou déjà dans le studio passe avant une police de Google qui lui ressemble. « couleurs » : fond = la couleur de fond de ses slides, texte = celle de son texte, accent = sa couleur qui attire l\'œil, second = une couleur d\'appoint vue sur ses slides.'
    ].filter(Boolean).join('\n\n');
    const meta = await demander(qMeta, 10 * 60000);
    // les polices : chaque candidat est vérifié — dans le studio, sur l'ordinateur, dans le dossier, ou chez Google
    etape(2);
    let catalogue = [];
    try { catalogue = ((await D.cataloguePolices()).liste || []).map(x => x[0]); } catch (e) {}
    const trouver = nom => {
      const n = String(nom || '').trim(), m = x => x.toLowerCase() === n.toLowerCase();
      const st = studio.find(m); if (st) return { nom: st, source: 'studio' };
      const go = catalogue.find(m); if (go) return { nom: go, source: 'google' };
      const dp = deposees.find(p => m(p.famille)); if (dp) return { nom: dp.famille, source: 'dossier', fichier: dp.fichier };
      const po = poste.find(p => m(p.nom)); if (po) return { nom: po.nom, source: 'ordinateur' };
      return null;
    };
    const polices = {};
    for (const role of ['titres', 'appui', 'texte']) {
      const p = meta.polices && meta.polices[role]; if (!p) continue;
      const vus = new Set(), l = [];
      (p.candidats || []).forEach(n => { const t = trouver(n); if (t && !vus.has(t.nom)) { vus.add(t.nom); l.push(t); } });
      if (!l.length && role !== 'appui') l.push({ nom: role === 'titres' ? 'Sora' : 'Inter', source: 'studio' });
      if (l.length) polices[role] = { description: String(p.description || ''), candidats: l.slice(0, 4), choix: 0 };
    }
    placerPolicesDuDossier(polices, deposees);
    // les exemples : « c/n » → le fichier de la slide
    const slideDe = cn => { const [c, n] = String(cn || '').split('/').map(x => parseInt(x, 10)); const x = cars[c - 1]; if (!x) return null;
      const l = L.slides.filter(y => y.car === x.i).sort((a, b) => a.n - b.n); return l[n - 1] ? { fichier: l[n - 1].fichier, cn: c + '/' + n } : null; };
    let exemples = (meta.exemples || []).map(slideDe).filter(Boolean).filter((x, i, a) => a.findIndex(y => y.fichier === x.fichier) === i).slice(0, 5);
    if (!exemples.length) exemples = L.slides.slice(0, 5).map(x => ({ fichier: x.fichier }));
    const elements = L.elements.map((e, k) => { const m = (meta.elements || []).find(x => +x.k === k + 1) || {};
      return { fichier: e.fichier, nom: String(m.nom || e.nom).slice(0, 60), quand: String(m.quand || '').slice(0, 300), transp: !!e.transp, garder: true }; });
    const gifs = L.gifs.map((g, k) => { const m = (meta.gifs || []).find(x => +x.k === k + 1) || {};
      // déjà dans la bibliothèque ? mêmes dimensions (à 1 px près : la conversion en MP4 les rend paires), même durée (à 0,12 s près) : pas gardé d'office
      let deja = null; try { const i = D.sonderVideo(chemin(s, 'gifs', g.fichier)); deja = D.lireGifs().find(x => Math.abs(x.l - i.l) <= 1 && Math.abs(x.h - i.h) <= 1 && Math.abs((x.duree || 0) - i.duree) < 0.12) || null; } catch (e) {}
      return { fichier: g.fichier, image: fGif[k] ? path.basename(fGif[k]) : null, nom: String(m.nom || g.nom).slice(0, 60), quand: String(m.quand || '').slice(0, 300), garder: true, deja: deja ? deja.nom : null, dejaId: deja ? deja.id : null }; });
    const manquants = (meta.manquants || []).slice(0, 8).map(m => ({ nom: String(m.nom || '').slice(0, 60), description: String(m.description || '').slice(0, 300), vu: slideDe(m.vu_sur) })).filter(m => m.nom);
    const couleurs = Object.assign({}, D.COULEURS_STUDIO, meta.couleurs || {});
    Object.keys(couleurs).forEach(k => { if (!/^#[0-9a-f]{6}$/i.test(couleurs[k])) couleurs[k] = D.COULEURS_STUDIO[k]; });
    // 3. la charte
    etape(3);
    const modele = fs.readFileSync(path.join(D.RACINE, 'SAVOIR', 'charte-modele.md'), 'utf8');
    const nomPol = r => polices[r] ? polices[r].candidats[0].nom : null;
    const contexteCharte = [
      'LA MARCHE À SUIVRE :\n' + modele,
      `CE QUE TU AS RELEVÉ SUR SES ${fiches.length} ${stories ? 'SUITES DE STORIES' : 'CARROUSELS'} :\n` + JSON.stringify(fiches.map((f, k) => ({ carrousel: k + 1, fond: f.fond, typo: f.typo, remarques: f.remarques, slides: (f.slides || []).map(x => ({ n: x.n, role: x.role, texte: String(x.texte || '').slice(0, 300), mise_en_page: x.mise_en_page, blocs: x.blocs, elements: x.elements })) }))),
      `SES COULEURS (celles de sa DA) : ${JSON.stringify(couleurs)}. SES POLICES : titres = ${nomPol('titres')} (police « titres » de la DA), texte = ${nomPol('texte')} (police « texte » de la DA)` + (nomPol('appui') ? `, mots mis en valeur = ${nomPol('appui')}` : '') + '.',
      elements.length ? 'LES ÉLÉMENTS DE SA DA (des images, à nommer tels quels dans la charte) :\n' + elements.map(e => `- « ${e.nom} » : ${e.quand}`).join('\n') : '',
      gifs.length ? 'SES GIF : ' + gifs.map(g => `« ${g.nom} » (${g.quand})`).join(' ; ') : '',
      L.fonds.length ? `SON FOND : il a mis dans son dossier une image de fond (« ${L.fonds[0].nom} », à regarder avec Read : ${chemin(s, 'fonds', L.fonds[0].fichier)}). Elle devient la texture « fond » de sa DA : la charte dit qu'elle est posée derrière ses slides (sur la <section>, background … center/cover), et sur lesquelles.` : '',
      manquants.length ? 'VUS SUR SES SLIDES, SANS FICHIER (à décrire comme des composants, ou à poser par leur image s\'ils arrivent) : ' + manquants.map(m => m.nom + ' — ' + m.description).join(' ; ') : '',
      'Ses slides, à revoir (Read) si besoin : ' + exemples.map(x => chemin(s, 'slides', x.fichier)).join(' ; ')
    ].filter(Boolean).join('\n\n');
    const nomDA = (da && da.nom) || 'la personne';
    let charte = await texte(contexteCharte + `\n\nÉcris maintenant LA CHARTE DES ${stories ? 'STORIES' : 'CARROUSELS'} de « ${nomDA} », en Markdown, selon la marche à suivre. Réponds UNIQUEMENT la charte.`,
      'Tu es directeur artistique : tu écris le cahier des charges exact du style d\'un créateur.', 10 * 60000);
    charte = charte.replace(/^```(?:markdown|md)?\s*|\s*```$/g, '').trim();
    if (charte.length < 800) throw new Error('La charte écrite par Claude est trop courte.');
    // 4. le test : deux slides composées avec cette charte, photographiées
    etape(4);
    const acc = exemples[0] ? L.slides.find(x => x.fichier === exemples[0].fichier) : L.slides[0];
    const corpsSlide = (exemples[1] && L.slides.find(x => x.fichier === exemples[1].fichier)) || L.slides.find(x => x !== acc) || acc;
    const texteDe = x => { const c = cars.findIndex(y => y.i === x.car), f = fiches[c] || {}, l = L.slides.filter(y => y.car === x.car).sort((a, b) => a.n - b.n);
      const sl = (f.slides || [])[l.indexOf(x)] || {}; return String(sl.texte || ''); };
    const tests = [acc, corpsSlide].filter(Boolean).slice(0, 2);
    const polCss = await cssPolicesTest(s, polices);
    const elUrls = elements.map(e => { const t = tailleImage(chemin(s, 'elements', e.fichier)); return `- « ${e.nom} » (${t ? t.l + ' × ' + t.h + ' px' : 'image'}) : ${url(s, 'elements', e.fichier)} — quand : ${e.quand}`; }).join('\n');
    const fond = L.fonds[0] ? url(s, 'fonds', L.fonds[0].fichier) : (sd && sd.fonds && sd.fonds.fond ? '/IDENTITES/' + s.daId + '/' + encodeURIComponent(sd.fonds.fond) : null);
    const composer = async (charteX) => {
      const q = [
        `Compose ${tests.length} ${stories ? 'stories' : 'slides'} HTML de ${F.l} × ${F.h} px qui REPRODUISENT deux ${stories ? 'stories' : 'slides'} de ce créateur, en suivant SA CHARTE à la lettre. Regarde d'abord les originales (Read) :`,
        tests.map((x, k) => `- ${k + 1} : ${chemin(s, 'slides', x.fichier)} — son texte, à reprendre MOT POUR MOT : « ${texteDe(x)} »`).join('\n'),
        'SA CHARTE :\n' + charteX,
        `SES COULEURS : ${JSON.stringify(couleurs)}. SES POLICES (déjà chargées, à écrire telles quelles dans font-family) : titres '${nomPol('titres')}', texte '${nomPol('texte')}'` + (nomPol('appui') ? `, mots mis en valeur '${nomPol('appui')}'` : '') + '.',
        fond ? `SON FOND (une image, sur la <section>) : ${fond}` : '',
        elUrls ? 'LES IMAGES DE SA DA (à poser par <img src> exactement, jamais redessinées) :\n' + elUrls : '',
        'Les photos et les captures d\'écran des originales ne sont pas disponibles : remplace chacune par un rectangle gris #2a2a2a de la même place, avec le mot « image ».',
        `Réponds UNIQUEMENT : un bloc <style> (le CSS commun ; chaque slide est une <section class="slide"> de ${F.l} × ${F.h} px en position:relative, overflow:hidden), puis les ${tests.length} <section class="slide">. Aucun script. Aucun texte hors du HTML.`
      ].filter(Boolean).join('\n\n');
      const h = await texte(q, 'Tu es intégrateur : tu écris du HTML et du CSS exacts.', 10 * 60000);
      const css = ((h.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '').replace(/<\/?script[^>]*>/gi, '');
      const secs = (h.match(/<section[\s\S]*?<\/section>/gi) || []).map(x => x.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, ''));
      if (!secs.length) throw new Error('Claude n\'a pas composé les slides test.');
      const nav = D.trouverNavigateur(); if (!nav) return [];
      const sorties = [];
      for (let k = 0; k < Math.min(secs.length, tests.length); k++) {
        const page = `<!doctype html><html><head><meta charset="utf-8"><style>${polCss.css}html,body{margin:0;background:#000}.slide{position:relative;width:${F.l}px;height:${F.h}px;overflow:hidden}${css}</style>${polCss.lien}</head><body>${secs[k]}</body></html>`;
        fs.writeFileSync(path.join(d, 'test-' + (k + 1) + '.html'), page, 'utf8');
        const png = path.join(d, 'test-' + (k + 1) + '-' + Date.now().toString(36) + '.png');
        await D.photographier(nav, 'http://127.0.0.1:' + D.port() + '/apprendre-test/' + s.id + '/' + (k + 1), png, F.l, F.h);
        sorties.push(path.basename(png));
      }
      return sorties;
    };
    let photos = [];
    try { photos = await composer(charte); } catch (e) { s.avertissement = 'Le test n\'a pas pu se faire : ' + e.message; }
    // 5. comparer et corriger
    etape(5);
    let corrections = [];
    if (photos.length) {
      const q = [
        'Voici des slides d\'un créateur et, à côté, les mêmes slides refaites par le studio d\'après la charte ci-dessous. Ouvre-les TOUTES avec Read :',
        tests.slice(0, photos.length).map((x, k) => `- originale ${k + 1} : ${chemin(s, 'slides', x.fichier)}\n- refaite ${k + 1} : ${path.join(d, photos[k])}`).join('\n'),
        'LA CHARTE :\n' + charte,
        'Relève ce qui DIFFÈRE dans le style (pas dans les photos, remplacées par des rectangles gris) : fond, tailles, polices, couleurs des mots, blocs, marges, éléments mal posés ou redessinés. Puis corrige la charte pour que la prochaine fois, ce soit juste : précise, ajoute des « jamais », corrige les chiffres.',
        'Réponds EXACTEMENT sous cette forme :\nCORRECTIONS:\n- <ce qui différait et ce que tu as corrigé, en une ligne>\n- …\n=== CHARTE ===\n<la charte entière, corrigée, en Markdown>'
      ].join('\n\n');
      try {
        const r = await texte(q, 'Tu es directeur artistique : tu compares et tu corriges un cahier des charges.', 10 * 60000);
        const [a, b] = r.split(/^=== CHARTE ===\s*$/m);
        if (b && b.trim().length > 800) { charte = b.replace(/^```(?:markdown|md)?\s*|\s*```$/g, '').trim(); corrections = (a.match(/^\s*-\s+.+$/gm) || []).map(x => x.replace(/^\s*-\s+/, '').trim()).slice(0, 8); }
      } catch (e) { /* la charte d'avant le test reste */ }
    }
    // 6. la voix : le texte lu sur ses slides
    etape(6);
    const voix = fiches.map(f => 'CARROUSEL « ' + String(f.titre || f.nom || '').slice(0, 80) + ' »\n' + (f.slides || []).map(x => String(x.texte || '').trim()).filter(Boolean).join('\n')).join('\n\n').slice(0, 16000);
    const dejaEls = sd && (sd.elements || []).length || 0;
    s.resultat = { dejaEls, policesCharte: { titres: nomPol('titres'), appui: nomPol('appui'), texte: nomPol('texte') }, couleurs, style: String(meta.style || '').slice(0, 600), illustration: String(meta.illustration || '').slice(0, 500), polices, charte, corrections,
      exemples, elements, gifs, fonds: L.fonds.map(f => ({ fichier: f.fichier, nom: f.nom })), manquants, voix: { texte: voix, n: fiches.length },
      tests: tests.slice(0, photos.length).map((x, k) => ({ original: x.fichier, test: photos[k] })), n: fiches.length, fait: maintenant() };
    s.etapes.forEach(e => { e.etat = 'fait'; });
    s.etat = 'fini'; s.message = ''; ecrire(s);
  }
  /* Les polices que la personne a mises dans son dossier passent en tête de leur rôle (là où Claude les a mises, sinon : une
     italique → les mots mis en valeur, une autre → les titres), et sont choisies d'office. */
  function placerPolicesDuDossier(polices, deposees) {
    for (const p of deposees) {
      const c = { nom: p.famille, source: 'dossier', fichier: p.fichier };
      let role = Object.keys(polices).find(r => polices[r].candidats.some(x => x.nom.toLowerCase() === p.famille.toLowerCase()));
      if (!role) { role = p.italique ? 'appui' : 'titres'; if (!polices[role]) polices[role] = { description: 'la police de ton dossier', candidats: [], choix: 0 }; }
      const l = polices[role].candidats.filter(x => x.nom.toLowerCase() !== p.famille.toLowerCase());
      polices[role].candidats = [c].concat(l).slice(0, 5); polices[role].choix = 0;
    }
  }
  // les polices des slides test : @font-face pour celles de l'ordinateur / du dossier / du studio, un lien pour Google
  async function cssPolicesTest(s, polices) {
    let css = '', google = [];
    for (const role of Object.keys(polices)) {
      const c = polices[role].candidats[polices[role].choix || 0]; if (!c) continue;
      if (c.source === 'google') google.push(c.nom);
      else if (c.source === 'studio') {
        if (D.estPoliceLocale(c.nom)) css += D.cssPolicesLocales([c.nom]); else google.push(c.nom);
      } else ['normal', 'italique'].forEach(st => { css += `@font-face{font-family:'${c.nom.replace(/'/g, '')}';src:url('/api/apprendre/${s.id}/police?nom=${encodeURIComponent(c.nom)}&style=${st}');font-style:${st === 'italique' ? 'italic' : 'normal'}}`; });
    }
    const lien = google.length ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${[...new Set(google)].map(f => D.familleGoogle(f)).join('&')}&display=block">` : '';
    return { css, lien };
  }
  // le fichier d'une police de l'ordinateur ou du dossier (pour l'aperçu et le test)
  function fichierPolice(s, nom, style) {
    const dp = s.fichiers.polices.find(p => { const n = nomsPolice(chemin(s, 'polices', p.fichier)); return n && n.famille === nom && (style === 'italique') === !!n.italique; })
      || s.fichiers.polices.find(p => { const n = nomsPolice(chemin(s, 'polices', p.fichier)); return n && n.famille === nom; });
    if (dp) return chemin(s, 'polices', dp.fichier);
    const po = policesDuPoste().find(p => p.nom === nom);
    return po ? (po.fichiers[style] || po.fichiers.normal || po.fichiers.italique) : null;
  }

  function lancer(id) {
    const s = lire(id); if (!s) throw new Error('Session inconnue.');
    if (s.etat === 'travail') return s;
    if (!s.fichiers.slides.length) throw new Error('Il faut au moins un ' + (s.sous === 'story' ? 'enchaînement de stories' : 'carrousel') + ' dans le dossier.');
    s.etapes = ['Je regarde tes ' + (s.sous === 'story' ? 'stories' : 'carrousels'), 'Je relève tes couleurs, tes polices, tes éléments', 'Je reconnais tes polices', "J'écris ta charte",
      'Je fais 2 ' + (s.sous === 'story' ? 'stories' : 'slides') + ' test', 'Je compare et je corrige ma charte', 'Je lis tes textes pour ta façon de parler'].map(t => ({ t, etat: '' }));
    Object.assign(s, { etat: 'travail', erreur: '', resultat: null, debut: maintenant() }); ecrire(s);
    travailler(s).catch(e => { Object.assign(s, { etat: 'erreur', erreur: e.message || String(e) }); ecrire(s); });
    return s;
  }

  /* ---------- corriger une rubrique : l'idée de la personne est un ORDRE ---------- */
  async function corriger(id, d) {
    const s = lire(id); if (!s || !s.resultat) throw new Error('Rien à corriger.');
    const R = s.resultat, ordre = String(d.texte || '').trim().slice(0, 1500); if (!ordre) throw new Error('Dites ce qui ne va pas.');
    const q = [
      `La charte du style d'un créateur, écrite d'après ses publications. Il la relit rubrique par rubrique ; sur « ${String(d.rubrique || 'la charte').slice(0, 60)} », il dit :`,
      '« ' + ordre + ' »',
      'C\'est un ORDRE : il passe avant tout ce que tu as vu et avant toute règle. Applique-le, et garde tout le reste tel quel.',
      'SES COULEURS : ' + JSON.stringify(R.couleurs) + '\nSON STYLE : ' + R.style,
      'LA CHARTE :\n' + R.charte,
      'Ses slides, si tu veux les revoir (Read) : ' + R.exemples.map(x => chemin(s, 'slides', x.fichier)).join(' ; '),
      'Réponds EXACTEMENT : une première ligne JSON {"couleurs":{"fond":"#hex","texte":"#hex","accent":"#hex","second":"#hex"},"style":"<le style, retouché ou tel quel>"}, puis une ligne « === CHARTE === », puis la charte entière en Markdown.'
    ].join('\n\n');
    const r = await texte(q, 'Tu es directeur artistique : tu corriges un cahier des charges selon la demande du créateur.', 8 * 60000);
    const [a, b] = r.split(/^=== CHARTE ===\s*$/m);
    if (!b || b.trim().length < 800) throw new Error('Claude n\'a pas rendu la charte corrigée.');
    try { const j = JSON.parse(D.premierObjetJson(a) || '{}'); if (j.couleurs) Object.keys(R.couleurs).forEach(k => { if (/^#[0-9a-f]{6}$/i.test(j.couleurs[k] || '')) R.couleurs[k] = j.couleurs[k]; }); if (j.style) R.style = String(j.style).slice(0, 600); } catch (e) {}
    R.charte = b.replace(/^```(?:markdown|md)?\s*|\s*```$/g, '').trim();
    (R.ordres = R.ordres || []).push({ rubrique: d.rubrique, texte: ordre, date: maintenant() });
    ecrire(s); return vue(s);
  }
  /* ---------- découper un élément vu sur une slide (sans fichier) ---------- */
  async function decouper(id, d) {
    const s = lire(id); if (!s || !s.resultat) throw new Error('Session inconnue.');
    const m = s.resultat.manquants[+d.k]; if (!m || !m.vu) throw new Error('Élément introuvable.');
    const f = chemin(s, 'slides', m.vu.fichier), t = tailleImage(f) || { l: 1080, h: 1350 };
    const r = await demander(`Ouvre avec Read cette image (${t.l} × ${t.h} px) : ${f}\nOn y voit « ${m.nom} » (${m.description}). Donne le rectangle qui l'entoure au plus près, en pixels de l'image, avec 6 px de marge. Réponds ce JSON : {"x":<gauche>,"y":<haut>,"l":<largeur>,"h":<hauteur>}`, 4 * 60000);
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)), l = Math.min(t.l - x, Math.round(r.l)), h = Math.min(t.h - y, Math.round(r.h));
    if (!(l > 8 && h > 8)) throw new Error('Claude n\'a pas trouvé l\'élément sur la slide.');
    const brut = path.join(dossierDe(id), 'elements', 'decoupe-' + Date.now().toString(36) + '-brut.png'), net = brut.replace('-brut.png', '.png');
    await D.executer(D.ffmpeg(), ['-v', 'error', '-y', '-i', f, '-vf', `crop=${l}:${h}:${x}:${y}`, '-frames:v', '1', brut], 60000);
    let fichier = path.basename(brut), transp = false;
    try { await D.detourerEnLocal(brut, net, 'auto'); fichier = path.basename(net); transp = true; } catch (e) {}
    s.fichiers.elements.push({ fichier, nom: m.nom, transp });
    s.resultat.elements.push({ fichier, nom: m.nom, quand: m.description, transp, garder: true, decoupe: true });
    s.resultat.manquants.splice(+d.k, 1);
    ecrire(s); return vue(s);
  }
  /* ---------- ajouter les fichiers qui manquaient (après coup) ---------- */
  function ajouterManquant(id, k, fichier, nom, transp) {
    const s = lire(id); if (!s || !s.resultat) throw new Error('Session inconnue.');
    const m = s.resultat.manquants[+k];
    s.resultat.elements.push({ fichier, nom: (m && m.nom) || nom, quand: (m && m.description) || '', transp: !!transp, garder: true });
    if (m) s.resultat.manquants.splice(+k, 1);
    ecrire(s); return vue(s);
  }

  /* ---------- ENREGISTRER dans la sous-DA ---------- */
  const dataUrl = f => { const ext = path.extname(f).toLowerCase(); const t = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.otf' ? 'font/otf' : /\.(ttf|ttc)$/.test(ext) ? 'font/ttf' : ext === '.woff' ? 'font/woff' : ext === '.woff2' ? 'font/woff2' : 'image/jpeg';
    return 'data:' + t + ';base64,' + fs.readFileSync(f).toString('base64'); };
  async function enregistrer(id, d) {
    const s = lire(id); if (!s || !s.resultat) throw new Error('Rien à enregistrer.');
    const R = s.resultat, g = s.sous, daId = s.daId;
    if (!D.lireIdentite(daId)) throw new Error('La DA a disparu.');
    // les choix de la page : polices, couleurs, éléments et GIF gardés (noms et « quand » retouchés), la voix
    const choix = d.polices || {};
    Object.keys(R.polices).forEach(r => { if (Number.isInteger(choix[r]) && R.polices[r].candidats[choix[r]]) R.polices[r].choix = choix[r]; });
    if (d.couleurs) Object.keys(R.couleurs).forEach(k => { if (/^#[0-9a-f]{6}$/i.test(d.couleurs[k] || '')) R.couleurs[k] = d.couleurs[k]; });
    (d.elements || []).forEach((x, i) => { const e = R.elements[i]; if (!e) return; if (typeof x.nom === 'string' && x.nom.trim()) e.nom = x.nom.trim().slice(0, 60); if (typeof x.quand === 'string') e.quand = x.quand.slice(0, 300); e.garder = x.garder !== false; });
    (d.gifs || []).forEach((x, i) => { const e = R.gifs[i]; if (!e) return; if (typeof x.nom === 'string' && x.nom.trim()) e.nom = x.nom.trim().slice(0, 60); if (typeof x.quand === 'string') e.quand = x.quand.slice(0, 300); e.garder = x.garder !== false; });
    // 1. les polices entrent dans le studio (Google : la bibliothèque ; ordinateur ou dossier : une police locale)
    const nomPolice = {};
    for (const role of Object.keys(R.polices)) {
      const c = R.polices[role].candidats[R.polices[role].choix || 0]; if (!c) continue;
      if (c.source === 'google' && !D.policesConnues().includes(c.nom)) { try { await D.ajouterPolice(c.nom); } catch (e) {} }
      if (c.source === 'ordinateur' || c.source === 'dossier') {
        const fN = fichierPolice(s, c.nom, 'normal'), fI = fichierPolice(s, c.nom, 'italique'), nI = fI && nomsPolice(fI);
        const poser = (st, f) => { try { D.ajouterPoliceLocale({ nom: c.nom, style: st, donnees: dataUrl(f) }); } catch (e) { if (!/déjà une police de Google/.test(e.message)) throw e; } };
        if (fN) poser('normal', fN);
        if (fI && fI !== fN && nI && nI.italique) poser('italique', fI);
      }
      nomPolice[role] = c.nom;
      // la charte a été écrite avec la police proposée en premier : si une autre est cochée, son nom change dans la charte
      const avant = (R.policesCharte || {})[role];
      if (avant && avant !== c.nom) R.charte = R.charte.split(avant).join(c.nom);
    }
    // 2. la sous-DA : couleurs, polices, style, illustration, charte (créée si elle n'existait pas)
    const titres = nomPolice.titres || 'Sora', corpsP = nomPolice.texte || titres;
    D.enregistrerIdentite({ id: daId, sous: g, couleurs: R.couleurs, polices: { titres, texte: corpsP }, ton: R.style, illustration: R.illustration,
      design: { nom: 'Charte apprise de ' + (R.n > 1 ? 'tes ' + R.n + ' ' + (g === 'story' ? 'stories' : 'carrousels') : (g === 'story' ? 'tes stories' : 'ton carrousel')), texte: R.charte } });
    // 3. les slides d'exemple, le fond, la trace de l'apprentissage
    const dossierDA = path.join(D.DOSSIER_IDENTITES, daId), t = Date.now().toString(36);
    const exemples = R.exemples.map((x, k) => { const f = 'exemple-' + g + '-' + t + '-' + (k + 1) + '.jpg'; fs.copyFileSync(chemin(s, 'slides', x.fichier), path.join(dossierDA, f)); return f; });
    let fondF = null;
    if (R.fonds[0] && d.fond !== false) { fondF = 'fond-' + g + '-' + t + path.extname(R.fonds[0].fichier).toLowerCase(); fs.copyFileSync(chemin(s, 'fonds', R.fonds[0].fichier), path.join(dossierDA, fondF)); }
    D.modifierFicheDA(daId, (fiche, dossier) => {
      const sd = fiche.sous[g];
      const anciens = (sd.exemples || []).slice();
      sd.exemples = exemples; sd.apprise = { date: maintenant(), n: R.n };
      if (fondF) { const a = (sd.fonds || {}).fond; sd.fonds = Object.assign({}, sd.fonds || {}, { fond: fondF }); if (a && a !== fondF) D.ecarterFichierDA(dossier, fiche, a); }
      anciens.forEach(f => D.ecarterFichierDA(dossier, fiche, f));
    });
    // 4. les éléments (détourés sur l'ordinateur s'ils ne sont pas déjà transparents) ; réapprendre peut remplacer les anciens
    if (d.remplacerElements) {
      const ancien = (D.lireIdentite(daId).sous[g].elements || []).slice();
      for (const e of ancien) { try { D.majElementDA(daId, e.id, { sous: g, retirer: true }); } catch (err) {} }
    }
    let nEl = 0; const aGarder = R.elements.filter(x => x.garder);
    for (const e of aGarder) {
      s.message = 'Élément ' + (nEl + 1) + ' / ' + aGarder.length + (e.transp ? '' : ' (détourage sur ton ordinateur)') + '…'; ecrire(s);
      try { await D.ajouterElementDA(daId, { sous: g, nom: e.nom, quand: e.quand, detourer: !e.transp, donnees: dataUrl(chemin(s, 'elements', e.fichier)) }); nEl++; }
      catch (err) { if (/au plus/.test(err.message)) break; }
    }
    // 5. les GIF rejoignent la bibliothèque du studio
    let nGif = 0; const idsGif = [];
    for (const x of R.gifs.filter(y => y.garder)) {
      if (x.dejaId) { idsGif.push(x.dejaId); nGif++; continue; }   // déjà dans la bibliothèque : relié, pas copié une 2e fois
      s.message = 'GIF ' + (nGif + 1) + '…'; ecrire(s);
      try { const gg = await D.ajouterGif(chemin(s, 'gifs', x.fichier), { nom: x.nom, quand: x.quand }); idsGif.push(gg.id); nGif++; } catch (e) {}
    }
    if (idsGif.length) D.modifierFicheDA(daId, fiche => { const sd = fiche.sous[g]; sd.gifs = [...new Set((sd.gifs || []).concat(idsGif))]; });
    // 6. la voix : le texte de ses slides rejoint « Tes phrases à toi » (commun aux trois sous-DA)
    if (d.voix && R.voix && R.voix.texte) {
      const da = D.lireIdentite(daId), avant = String(da.paroleExemples || '').trim();
      D.enregistrerIdentite({ id: daId, paroleExemples: (avant ? avant + '\n\n' : '') + R.voix.texte });
    }
    s.etat = 'enregistre'; s.enregistre = maintenant(); s.message = ''; s.bilan = { elements: nEl, gifs: nGif }; ecrire(s);
    return { ok: true, elements: nEl, gifs: nGif };
  }

  /* ---------- les routes ---------- */
  function routes(req, res, url) {
    const M = req.method, q = new URLSearchParams(req.url.split('?')[1] || ''); let m;
    const echec = e => D.repondreJson(res, 400, { erreur: e.message || String(e) });
    if (M === 'POST' && url === '/api/apprendre') { D.corpsJson(req, 1e4).then(d => D.repondreJson(res, 200, vue(creer(d || {})))).catch(echec); return true; }
    if ((m = url.match(/^\/api\/apprendre\/(a[a-z0-9]+)(?:\/([a-z-]+))?$/))) {
      const [, id, quoi] = m;
      if (M === 'GET' && !quoi) { const s = lire(id); if (!s) { echec(new Error('Session inconnue.')); return true; } D.repondreJson(res, 200, vue(s)); return true; }
      if (M === 'GET' && quoi === 'police') {
        const s = lire(id), f = s && fichierPolice(s, String(q.get('nom') || ''), q.get('style') === 'italique' ? 'italique' : 'normal');
        if (!f) { res.writeHead(404).end(); return true; }
        res.writeHead(200, { 'Content-Type': 'font/' + (path.extname(f).slice(1).toLowerCase() || 'otf'), 'Cache-Control': 'no-cache' }); fs.createReadStream(f).pipe(res); return true;
      }
      if (M !== 'POST') return false;
      if (quoi === 'fichier') { recevoir(req, id, q).then(r => D.repondreJson(res, 200, r)).catch(echec); return true; }
      if (quoi === 'police-ajout') {
        recevoir(req, id, new URLSearchParams({ rayon: 'polices', nom: q.get('nom') || 'police.ttf' })).then(e => {
          const s = lire(id); if (!s || !s.resultat) throw new Error('Session inconnue.');
          const n = nomsPolice(chemin(s, 'polices', e.fichier)); if (!n) throw new Error('Ce fichier ne ressemble pas à une police (.ttf, .otf).');
          const role = ['titres', 'appui', 'texte'].includes(q.get('role')) ? q.get('role') : (n.italique ? 'appui' : 'titres');
          const P = s.resultat.polices; if (!P[role]) P[role] = { description: 'ta police', candidats: [], choix: 0 };
          P[role].candidats = [{ nom: n.famille, source: 'dossier', fichier: e.fichier }].concat(P[role].candidats.filter(x => x.nom !== n.famille)).slice(0, 5); P[role].choix = 0;
          ecrire(s); D.repondreJson(res, 200, vue(s));
        }).catch(echec); return true;
      }
      if (quoi === 'manquant') { recevoir(req, id, new URLSearchParams({ rayon: 'elements', nom: q.get('nom') || 'élément', transp: q.get('transp') || '0' }))
        .then(e => D.repondreJson(res, 200, ajouterManquant(id, q.get('k'), e.fichier, e.nom, e.transp))).catch(echec); return true; }
      D.corpsJson(req, 2e6).then(async d => {
        d = d || {};
        if (quoi === 'lancer') return vue(lancer(id));
        if (quoi === 'corriger') return corriger(id, d);
        if (quoi === 'decouper') return decouper(id, d);
        if (quoi === 'enregistrer') {
          const s = lire(id); if (!s || !s.resultat) throw new Error('Rien à enregistrer.');
          if (s.etat === 'enregistrement') return vue(s);
          Object.assign(s, { etat: 'enregistrement', message: 'La charte, les polices, les couleurs…', erreurEnreg: '' }); ecrire(s);
          enregistrer(id, d).catch(e => { Object.assign(s, { etat: 'fini', message: '', erreurEnreg: e.message || String(e) }); ecrire(s); });
          return vue(s);
        }
        throw new Error('Action inconnue.');
      }).then(r => D.repondreJson(res, 200, r)).catch(echec);
      return true;
    }
    // les fichiers d'une session (vignettes, slides test) et la page d'une slide test (photographiée par le navigateur)
    if (M === 'GET' && (m = url.match(/^\/apprendre-fichier\/(a[a-z0-9]+)\/([a-z]+)\/([^\/]+)$/))) {
      if (!lire(m[1])) { res.writeHead(404).end(); return true; }
      const rayon = m[2] === 'racine' ? '' : m[2]; if (rayon && !RAYONS.includes(rayon)) { res.writeHead(404).end(); return true; }
      D.servirFichier(res, path.join(dossierDe(m[1]), rayon), m[3]); return true;
    }
    if (M === 'GET' && (m = url.match(/^\/apprendre-test\/(a[a-z0-9]+)\/(\d)$/))) {
      const f = path.join(dossierDe(m[1]), 'test-' + m[2] + '.html');
      if (!lire(m[1]) || !fs.existsSync(f)) { res.writeHead(404).end(); return true; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'none'" });
      res.end(fs.readFileSync(f, 'utf8')); return true;
    }
    return false;
  }
  return { routes, policesDuPoste, nomsPolice };
};
