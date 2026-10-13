/* ============================================================
   « REFAIRE DES STICKERS » (13 oct. 2026, après le test du LABO/stickers-fr : « ça c'est incroyable, intègre-le »)
   La personne dépose l'image d'une planche de stickers qui lui plaît (Pinterest, une capture…). Claude la REGARDE et
   REDESSINE chaque sticker en vectoriel (SVG), avec des textes en français — traduits, ou réécrits pour son univers —,
   aux couleurs de l'image ou de sa DA. Le navigateur du poste les photographie en PNG transparent (×3), Claude relit
   le résultat et corrige ce qui déborde (un tour), puis la personne garde ceux qu'elle veut : ils entrent dans les
   éléments de sa DA Story, que Claude pose dans ses stories. Rien n'est généré par une IA d'image : aucun crédit.
     1. l'inventaire : chaque sticker décrit, son texte final, son nom, « quand » le poser (demanderJson, Read) ;
     2. le dessin : trois stickers par demande, trois demandes à la fois (interroger, Read) ;
     3. la photographie : une page par sticker (/stickers-page/…, sans script), PNG rogné au plus près ;
     4. la relecture : Claude regarde la planche des rendus à côté de l'original → ceux à corriger, redessinés une fois.
   Les sessions vivent dans CACHE/stickers/<id>/ ; les PNG finis sont copiés dans MES STICKERS/<profil>/<date>/.
   ============================================================ */
const fs = require('fs'), path = require('path'), zlib = require('zlib');

module.exports = function (D) {
  const DOSSIER = path.join(D.DOSSIER_CACHE, 'stickers');
  const SESSIONS = new Map();
  const ECHELLE = 3, MARGE = 50, MAX = 24, PAR_LOT = 3;
  const sansOutils = { outils: ['Read'], args: ['--strict-mcp-config'] };
  const GRATUIT = "Ce travail ne dépense AUCUN crédit : n'appelle aucun outil de génération, seulement Read.";
  const idOk = x => /^k[a-z0-9]{6,20}$/.test(String(x || ''));
  const dossierDe = id => path.join(DOSSIER, id);
  const fSession = id => path.join(dossierDe(id), 'session.json');
  const maintenant = () => new Date().toISOString();
  const txt = (x, n) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, n);

  /* Les polices permises : gratuites (Google Fonts), décrites pour que Claude choisisse la plus proche de l'image.
     [nom, morceau du lien Google Fonts, description] */
  const POLICES = [
    ['Archivo', 'Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900', 'grotesque, graisses 100 à 900, italique ; largeur variable : style="font-stretch:75%" la rend étroite (titres massifs condensés, souvent en italique 900)'],
    ['Anton', 'Anton', 'capitales très étroites et très grasses (affiche)'],
    ['Bebas Neue', 'Bebas+Neue', 'capitales étroites, droites, moins grasses qu\'Anton'],
    ['Space Grotesk', 'Space+Grotesk:wght@400;500;700', 'grotesque géométrique un peu technique, 400 à 700'],
    ['Inter', 'Inter:wght@400;600;800;900', 'sans neutre, 400 à 900'],
    ['Bricolage Grotesque', 'Bricolage+Grotesque:wght@400;600;800', 'grotesque à caractère, très ronde en 800'],
    ['Courier Prime', 'Courier+Prime:ital,wght@0,400;0,700;1,400;1,700', 'machine à écrire, normal et italique, 400 et 700'],
    ['Instrument Serif', 'Instrument+Serif:ital@0;1', 'serif fin et élégant, normal et italique (400 seulement)'],
    ['DM Serif Display', 'DM+Serif+Display:ital@0;1', 'serif gras à fort contraste, normal et italique (400 seulement : il est déjà gras)'],
    ['Fraunces', 'Fraunces:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900', 'serif doux et rond, 400 à 900, italique'],
    ['Shrikhand', 'Shrikhand', 'display rétro très gras, italique de nature'],
    ['Caveat', 'Caveat:wght@400;700', 'écriture à la main naturelle, 400 et 700'],
    ['Permanent Marker', 'Permanent+Marker', 'écrit au gros feutre, capitales'],
    ['Pacifico', 'Pacifico', 'script rond et liée (style surf, années 50)'],
    ['VT323', 'VT323', 'police pixel d\'écran (terminal, jeu vidéo)']
  ];

  /* LA BOÎTE À OUTILS commune à tous les stickers (dans la page, hors du dessin de Claude) : le grain, la découpe
     (liseré blanc arrondi + ombre douce), la découpe à fond crème organique, l'étincelle, les deux curseurs. */
  const KIT = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
   <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>
   <feColorMatrix in="n" type="saturate" values="0" result="g"/>
   <feComposite in="SourceGraphic" in2="g" operator="arithmetic" k1="0" k2="1" k3="0.34" k4="-0.17" result="m"/>
   <feComposite in="m" in2="SourceAlpha" operator="in"/></filter>
  <filter id="cut" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
   <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="d0"/><feGaussianBlur in="d0" stdDeviation="4.5" result="b0"/>
   <feComponentTransfer in="b0" result="d"><feFuncA type="linear" slope="22" intercept="-1.4"/></feComponentTransfer>
   <feFlood flood-color="#FFFDF8"/><feComposite in2="d" operator="in" result="w"/>
   <feGaussianBlur in="d" stdDeviation="3.5" result="sb"/><feOffset in="sb" dy="2.5" result="so"/>
   <feFlood flood-color="#2A1A10" flood-opacity=".22"/><feComposite in2="so" operator="in" result="sh"/>
   <feMerge><feMergeNode in="sh"/><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="cutBlob" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
   <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="b0"/>
   <feComponentTransfer in="b0" result="bl"><feFuncA type="linear" slope="14" intercept="-0.7"/></feComponentTransfer>
   <feFlood flood-color="#F7F0E4"/><feComposite in2="bl" operator="in" result="cr"/>
   <feMorphology in="bl" operator="dilate" radius="6" result="d"/><feFlood flood-color="#FFFDF8"/><feComposite in2="d" operator="in" result="w"/>
   <feGaussianBlur in="d" stdDeviation="3.5" result="sb"/><feOffset in="sb" dy="2.5" result="so"/>
   <feFlood flood-color="#2A1A10" flood-opacity=".22"/><feComposite in2="so" operator="in" result="sh"/>
   <feMerge><feMergeNode in="sh"/><feMergeNode in="w"/><feMergeNode in="cr"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <path id="spk" d="M0,-10 C1.2,-2 2,-1.2 10,0 C2,1.2 1.2,2 0,10 C-1.2,2 -2,1.2 -10,0 C-2,-1.2 -1.2,-2 0,-10Z"/>
  <path id="cursor" d="M0 0 L0 46 L12 35 L21 55 L30 51 L21 31 L37 31 Z"/>
  <path id="pixcur" d="M0,0 H1 V1 H2 V2 H3 V3 H4 V4 H5 V5 H6 V6 H7 V7 H8 V8 H9 V9 H10 V10 H11 V11 H12 V12 H8 V13 H9 V15 H10 V17 H8 V18 H7 V16 H6 V14 H5 V13 H4 V14 H3 V15 H2 V16 H1 V17 H0 Z"/>
 </defs></svg>`;

  const REGLES_DESSIN = [
    'Tu redessines des stickers (autocollants) en SVG, d\'après une image, pour des stories Instagram. Ils doivent ressembler à l\'original au plus près : même forme, même composition, mêmes décors et icônes, même rendu (dégradés, grain, contours, liseré blanc), polices les plus proches possible. Seul le TEXTE change : tu écris le texte final donné.',
    '',
    'FORMAT — tu réponds UNIQUEMENT les balises <svg>, l\'une après l\'autre, sans texte autour ni bloc de code :',
    '<svg class="st" data-n="<numéro>" viewBox="0 0 L H" width="L" height="H"> … </svg>',
    '- L et H entre 200 et 620 ; laisse AU MOINS 30 unités de marge vide tout autour du dessin (le liseré s\'y dessine).',
    '- Tout le dessin dans UN <g filter="url(#cut)"> : il pose le liseré blanc arrondi et l\'ombre autour de la silhouette. Pour un sticker SANS forme de fond (des éléments et des mots qui flottent, posés sur un fond crème organique dans l\'original), prends filter="url(#cutBlob)" : il ajoute ce fond crème.',
    '- Tes dégradés, clipPath, masques, motifs dans un <defs> DANS le svg, avec des id préfixés par « s<numéro>- » (ex. s3-grad) : jamais deux fois le même id.',
    '- INTERDIT : <script>, <image>, <foreignObject>, <style>, les attributs on…, tout lien externe (href seulement vers « #… »), url() autre que « url(#…) ».',
    '',
    'LA BOÎTE À OUTILS (déjà dans la page, à employer par leur id) :',
    '- filter="url(#grain)" sur une forme remplie d\'un dégradé : le grain pointillé des stickers imprimés. Sur les grands aplats dégradés seulement, pas sur le texte.',
    '- <use href="#spk" transform="translate(x y) scale(s)" fill="…"/> : une étincelle à 4 branches de rayon 10 (scale 1 = 20 unités de large). En contour : fill="none" stroke="…" stroke-width="1.3".',
    '- <use href="#cursor" …/> : la flèche de souris (37 × 55, la pointe en 0,0). <use href="#pixcur" transform="… scale(4)" fill="#fff" stroke="#000" stroke-width=".85"/> : le curseur en pixels (12 × 18).',
    '- <path data-star="cx,cy,branches,R,r,graine"/> : une étoile / explosion irrégulière (R rayon des pointes, r du creux ; ex. 13 branches, R 165, r 118). Ajoute fill, filter…',
    '- <path data-zig="x1,y1,x2,y2,dent"/> : une feuille de papier (ticket) au bord bas dentelé, du coin (x1,y1) au coin (x2,y2).',
    '',
    'LES POLICES (seulement celles-ci, en attribut font-family="…" avec font-weight, font-style et style="font-stretch:…%" si besoin) :',
    '%POLICES%',
    '',
    'LE TEXTE :',
    '- Écris EXACTEMENT le texte final donné, avec ses accents et sa ponctuation française (espace avant « : » « ; » « ! » « ? » et « % »).',
    '- Il doit TENIR dans sa forme, avec de l\'air : estime sa largeur avant de choisir la taille (en largeur de caractère moyenne : étroite ≈ 0,45 × la taille, normale ≈ 0,58, machine à écrire ≈ 0,6, manuscrite ≈ 0,45). Un texte plus long que l\'original : plus petit, ou une ligne de plus — jamais hors de la forme, jamais par-dessus une icône.',
    '- Un texte sur une courbe : <textPath href="#s<n>-arc">, le chemin dans le <defs>.',
    '- Jamais de texte en <foreignObject> : seulement <text> / <tspan> / <textPath>.'
  ].join('\n');

  // les sessions
  function lire(id) {
    if (!idOk(id)) return null;
    if (SESSIONS.has(id)) return SESSIONS.get(id);
    try {
      const s = JSON.parse(fs.readFileSync(fSession(id), 'utf8'));
      if (s.etat === 'travail') { s.etat = s.stickers && s.stickers.some(x => x.png) ? 'fini' : 'erreur'; s.erreur = s.etat === 'erreur' ? 'Le studio a été relancé pendant le travail : relancez-le.' : ''; s.message = ''; }
      SESSIONS.set(id, s); return s;
    } catch (e) { return null; }
  }
  const ecrire = s => { fs.mkdirSync(dossierDe(s.id), { recursive: true }); D.ecrireJsonSurement(fSession(s.id), s); };
  const vue = s => ({ id: s.id, cree: s.cree, etat: s.etat, message: s.message, erreur: s.erreur, options: s.options, dossier: !!s.sortie,
    modele: '/stickers-fichier/' + s.id + '/' + s.modele,
    stickers: (s.stickers || []).map(x => ({ n: x.n, nom: x.nom, quand: x.quand, texte: x.texte, original: x.original, garde: !!x.garde, erreur: x.erreur || '',
      travail: !!x.travail, png: x.png ? '/stickers-fichier/' + s.id + '/' + x.png + '?v=' + (x.version || 0) : null })) });

  function liste() {
    let noms = []; try { noms = fs.readdirSync(DOSSIER); } catch (e) {}
    return noms.filter(idOk).map(lire).filter(s => s && s.profil === D.profil.id())
      .sort((a, b) => String(b.cree).localeCompare(String(a.cree))).slice(0, 12)
      .map(s => ({ id: s.id, cree: s.cree, etat: s.etat, nb: (s.stickers || []).filter(x => x.png).length, modele: '/stickers-fichier/' + s.id + '/' + s.modele }));
  }

  function creer(d) {
    const m = String(d.donnees || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!m) throw new Error('Déposez une image (PNG, JPEG ou WebP).');
    const daId = D.profil.da();
    if (!daId || !D.lireIdentite(daId)) throw new Error('Votre DA est introuvable : ouvrez « Ma DA Story » une fois, puis recommencez.');
    const id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    fs.mkdirSync(dossierDe(id), { recursive: true });
    const modele = 'modele.' + (m[1].toLowerCase() === 'png' ? 'png' : m[1].toLowerCase() === 'webp' ? 'webp' : 'jpg');
    fs.writeFileSync(path.join(dossierDe(id), modele), Buffer.from(m[2], 'base64'));
    const s = { id, cree: maintenant(), profil: D.profil.id(), daId, modele, etat: 'travail', message: 'Claude regarde l\'image…', erreur: '',
      options: { textes: d.textes === 'adapter' ? 'adapter' : 'traduire', couleurs: d.couleurs === 'da' ? 'da' : 'image', consigne: txt(d.consigne, 800) }, stickers: [] };
    SESSIONS.set(id, s); ecrire(s);
    travailler(s).catch(e => { s.etat = 'erreur'; s.erreur = e.message || String(e); s.message = ''; ecrire(s); });
    return s;
  }

  // les couleurs et polices de la DA, quand la personne les demande
  function charteDA(s) {
    const da = D.lireDA(s.daId, 'story');
    if (!da) return null;
    const c = da.couleurs || {}, p = da.polices || {};
    return { couleurs: c, polices: [p.titres, p.texte].filter((x, i, a) => x && a.indexOf(x) === i) };
  }
  function lignesPolices(s) {
    const l = POLICES.map(p => '- ' + p[0] + ' — ' + p[2]);
    const ch = s.options.couleurs === 'da' ? charteDA(s) : null;
    if (ch) ch.polices.filter(f => !POLICES.some(p => p[0] === f)).forEach(f => l.push('- ' + f + ' — une police de SA DA (graisses courantes)'));
    return l.join('\n');
  }
  function consignesCouleurs(s) {
    if (s.options.couleurs !== 'da') return 'LES COULEURS : celles de l\'image, relevées avec précision (#hex).';
    const ch = charteDA(s), c = (ch && ch.couleurs) || {};
    return 'LES COULEURS : celles de SA DA à la place de celles de l\'image, en gardant les mêmes RÔLES (le dégradé principal, le noir des contours et des formes sombres, le crème des fonds clairs) : fond ' + (c.fond || '?') + ', texte ' + (c.texte || '?') + ', accent ' + (c.accent || '?') + ', second ' + (c.second || '?') +
      '. Les dégradés vont de l\'accent au second (ou vers une teinte voisine) ; le texte reste lisible sur sa forme. Ses polices (' + ((ch && ch.polices) || []).join(', ') + ') remplacent celles de l\'image quand elles ont le même rôle.';
  }

  async function parLots(l, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, l.length) }, async () => { while (i < l.length) { const k = i++; await fn(l[k], k); } }));
  }
  const etape = (s, message) => { s.message = message; ecrire(s); };
  const cheminModele = s => path.join(dossierDe(s.id), s.modele);

  async function travailler(s) {
    // 1. l'inventaire
    const profil = D.profil.lire();
    const q = [
      `Ouvre avec Read l'image ${cheminModele(s)}. Elle montre des stickers (autocollants) qu'une personne veut refaire pour ses stories Instagram.`,
      `Relève CHAQUE sticker séparé, dans l'ordre de lecture (de gauche à droite, ligne par ligne), ${MAX} au plus. Décris-le assez précisément pour qu'un illustrateur le redessine sans voir l'image : la forme de la silhouette, la composition, chaque décor et icône (et sa place), les dégradés (couleurs #hex et sens), le grain, les contours, l'angle, la police de chaque texte (serif ou sans, étroite, graisse, italique, manuscrite, machine à écrire…) et sa taille relative.`,
      s.options.textes === 'adapter'
        ? 'LES TEXTES : réécris chacun pour l\'univers de cette personne (plus bas), en français parlé, avec LA MÊME MÉCANIQUE d\'humour que l\'original (le même type de vanne, d\'aveu, de jeu sur les mots) et une longueur proche. Ce qui se dit pareil partout (ctrl + z, OK) reste tel quel.\n\nLA PERSONNE :\n' + D.profil.enClair(profil)
        : 'LES TEXTES : traduis chacun en français, naturel et parlé, en gardant l\'humour : un jeu de mots intraduisible devient un équivalent drôle en français. Ce qui se dit pareil en français (ctrl + z, OK, un anglicisme courant comme « deadline ») peut rester. Longueur proche de l\'original.',
      s.options.consigne ? 'CE QUE LA PERSONNE DEMANDE (c\'est un ordre, il passe avant tout le reste) : ' + s.options.consigne : '',
      'Réponds ce JSON : {"style":"<2 à 4 phrases : la palette (#hex), le grain, les contours, le liseré, les polices>","stickers":[{"n":1,"description":"…","original":"<son texte tel quel, lignes séparées par / >","texte":"<le texte final, lignes séparées par / , avec la place de chaque morceau si le sticker en a plusieurs>","nom":"<nom court en français, 2 à 4 mots>","quand":"<quand le poser dans une story : l\'émotion, le sujet, le moment — une phrase>"}]}'
    ].filter(Boolean).join('\n\n');
    const inv = await D.demanderJson(q + '\n\n' + GRATUIT, 10 * 60000, sansOutils);
    const l = (inv && Array.isArray(inv.stickers) ? inv.stickers : []).slice(0, MAX);
    if (!l.length) throw new Error('Claude n\'a reconnu aucun sticker sur cette image. Essayez une image plus nette, où les stickers sont bien séparés.');
    s.style = txt(inv.style, 1200);
    s.stickers = l.map((x, i) => ({ n: i + 1, description: txt(x.description, 1500), original: txt(x.original, 300), texte: txt(x.texte, 400),
      nom: txt(x.nom, 60) || 'sticker ' + (i + 1), quand: txt(x.quand, 300), svg: '', png: '', version: 0 }));
    ecrire(s);

    // 2. le dessin, 3. la photographie
    const lots = []; for (let i = 0; i < s.stickers.length; i += PAR_LOT) lots.push(s.stickers.slice(i, i + PAR_LOT));
    let faits = 0;
    etape(s, 'Dessin des stickers : 0 / ' + s.stickers.length);
    await parLots(lots, 3, async lot => {
      try { await dessiner(s, lot); } catch (e) { lot.forEach(x => { x.erreur = e.message || String(e); }); }
      faits += lot.length; etape(s, 'Dessin des stickers : ' + faits + ' / ' + s.stickers.length);
    });
    await photographierTout(s, s.stickers.filter(x => x.svg));
    if (!s.stickers.some(x => x.png)) throw new Error('Aucun sticker n\'a pu être dessiné. ' + (s.stickers.find(x => x.erreur) || {}).erreur);

    // 4. la relecture
    etape(s, 'Claude relit les stickers…');
    try {
      const corr = await relire(s);
      if (corr.length) {
        etape(s, 'Corrections : ' + corr.length + ' sticker' + (corr.length > 1 ? 's' : ''));
        await parLots(corr, 3, async c => { try { await dessiner(s, [c.x], c.probleme); } catch (e) {} });
        await photographierTout(s, corr.map(c => c.x));
      }
    } catch (e) { /* la relecture est un bonus : les stickers restent */ }
    copierDansMesStickers(s);
    s.etat = 'fini'; s.message = ''; ecrire(s);
  }

  // Claude dessine un lot de stickers (ou en corrige un : `probleme`, avec son dessin actuel)
  async function dessiner(s, lot, probleme) {
    const q = [
      `Ouvre avec Read l'image ${cheminModele(s)} : la planche de stickers d'origine. Regarde de près ${lot.length > 1 ? 'les stickers' : 'le sticker'} ${lot.map(x => 'n° ' + x.n).join(', ')}.`,
      s.style ? 'LE STYLE DE LA PLANCHE : ' + s.style : '',
      consignesCouleurs(s),
      s.options.consigne ? 'CE QUE LA PERSONNE DEMANDE (c\'est un ordre) : ' + s.options.consigne : '',
      lot.map(x => `STICKER n° ${x.n} — « ${x.nom} »\n  ce qu'il montre : ${x.description}\n  texte d'origine : ${x.original || '(aucun)'}\n  TEXTE FINAL à écrire : ${x.texte || '(aucun texte)'}` +
        (probleme ? `\n  TON DESSIN ACTUEL (à corriger, pas à refaire de zéro) :\n${x.svg}\n  CE QUI NE VA PAS (corrige-le) : ${probleme}` : '')).join('\n\n'),
      `Réponds ${lot.length > 1 ? 'les ' + lot.length + ' <svg>, dans cet ordre' : 'le <svg>'}, avec data-n = le numéro du sticker.`
    ].filter(Boolean).join('\n\n');
    const sys = REGLES_DESSIN.replace('%POLICES%', lignesPolices(s)) + '\n\n' + GRATUIT;
    const r = await D.interroger(q, sys, null, 40, 12 * 60000, sansOutils);
    const blocs = String(r.texte || '').match(/<svg\b[\s\S]*?<\/svg>/gi) || [];
    if (!blocs.length) throw new Error('Claude n\'a rendu aucun dessin.');
    blocs.forEach((b, i) => {
      const n = Number((b.match(/\bdata-n="(\d+)"/) || [])[1]) || (lot[i] && lot[i].n);
      const x = lot.find(y => y.n === n); if (!x) return;
      const propre = nettoyerSvg(b, n);
      if (propre) { x.svg = propre; x.erreur = ''; }
    });
    lot.filter(x => !x.svg).forEach(x => { x.erreur = 'Pas de dessin pour ce sticker.'; });
  }

  /* Le dessin de Claude, rendu sûr : rien qui s'exécute, rien qui sort de la page. La page est de toute façon servie
     sans script (CSP), au navigateur sans fenêtre du poste. Les raccourcis data-star / data-zig deviennent des chemins. */
  function nettoyerSvg(b, n) {
    let t = String(b)
      .replace(/<(script|style|foreignObject)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<(script|style|foreignObject|image|iframe|object|embed)\b[^>]*\/?>/gi, '')
      .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
      .replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none').replace(/@import/gi, '').replace(/javascript:/gi, '');
    const vb = (t.match(/viewBox="\s*([\d.\-]+)[\s,]+([\d.\-]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/) || []);
    const L = Number(vb[3]), H = Number(vb[4]);
    if (!(L >= 60 && L <= 1200 && H >= 60 && H <= 1200)) return null;
    t = t.replace(/<path\b([^>]*?)\bdata-star="([^"]+)"([^>]*)>/gi, (tout, a, v, z) => '<path' + a + 'd="' + etoile(v) + '"' + z.replace(/\sd="[^"]*"/, '') + '>')
      .replace(/<path\b([^>]*?)\bdata-zig="([^"]+)"([^>]*)>/gi, (tout, a, v, z) => '<path' + a + 'd="' + dentele(v) + '"' + z.replace(/\sd="[^"]*"/, '') + '>');
    // la taille : posée par la page (×3), pas par Claude
    t = t.replace(/^<svg\b[^>]*>/i, m => m.replace(/\s(width|height|style|class|data-n)="[^"]*"/gi, '').replace(/^<svg/i, '<svg class="st" data-n="' + n + '" data-l="' + L + '" data-h="' + H + '"'));
    return t;
  }
  function hasard(graine) { let s = Math.max(1, Math.floor(graine) || 1); return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  function etoile(v) {
    const [cx, cy, n, R, r, g] = String(v).split(',').map(Number); if (![cx, cy, n, R, r].every(isFinite) || n < 3 || n > 40) return '';
    const h = hasard(g); let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n + (h() - .5) * 0.14, rad = i % 2 ? r * (0.92 + h() * 0.1) : R * (0.8 + h() * 0.22);
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rad).toFixed(1) + ' ' + (cy + Math.sin(a) * rad).toFixed(1);
    }
    return d + 'Z';
  }
  function dentele(v) {
    const [x1, y1, x2, y2, t] = String(v).split(',').map(Number); if (![x1, y1, x2, y2, t].every(isFinite) || t <= 2) return '';
    let d = `M${x1} ${y1} L${x2} ${y1 - 3} L${x2} ${y2}`, haut = false;
    for (let x = x2 - t / 2; x > x1; x -= t / 2) { d += ` L${x.toFixed(1)} ${haut ? y2 : y2 + t * 0.6}`; haut = !haut; }
    return d + ` L${x1} ${y2} Z`;
  }

  // la page d'un sticker, à la taille d'export : ce que le navigateur photographie
  function page(s, x) {
    const L = Number((x.svg.match(/data-l="([\d.]+)"/) || [])[1]), H = Number((x.svg.match(/data-h="([\d.]+)"/) || [])[1]);
    const ch = s.options.couleurs === 'da' ? charteDA(s) : null, da = ((ch && ch.polices) || []).filter(f => !POLICES.some(p => p[0] === f));
    const google = POLICES.map(p => 'family=' + p[1]).concat(da.filter(f => !D.estPoliceLocale(f)).map(D.familleGoogle)).join('&');
    const locales = D.cssPolicesLocales(da);
    const svg = x.svg.replace(/^<svg\b/i, `<svg width="${L * ECHELLE}" height="${H * ECHELLE}" style="position:absolute;left:${MARGE * ECHELLE}px;top:${MARGE * ECHELLE}px;overflow:visible"`);
    return { l: Math.ceil((L + 2 * MARGE) * ECHELLE), h: Math.ceil((H + 2 * MARGE) * ECHELLE),
      html: '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + google + '&display=block">' +
        (locales ? '<style>' + locales + '</style>' : '') + '<style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>' + KIT + svg + '</body></html>' };
  }

  // un par un : le navigateur d'export garde un seul profil, deux à la fois se marcheraient dessus
  async function photographierTout(s, l) {
    const nav = D.trouverNavigateur();
    if (!nav) throw new Error('Chrome ou Edge est introuvable sur ce poste : il sert à photographier les stickers.');
    let k = 0;
    for (const x of l) {
      etape(s, 'Photographie des stickers : ' + (++k) + ' / ' + l.length);
      try {
        const p = page(s, x), brut = path.join(dossierDe(s.id), 'brut-' + x.n + '.png');
        try { fs.unlinkSync(brut); } catch (e) {}
        await D.photographier(nav, 'http://127.0.0.1:' + D.port() + '/stickers-page/' + s.id + '/' + x.n, brut, p.l, p.h, true);
        const nom = String(x.n).padStart(2, '0') + '.png';
        if (!rogner(brut, path.join(dossierDe(s.id), nom))) fs.copyFileSync(brut, path.join(dossierDe(s.id), nom));
        try { fs.unlinkSync(brut); } catch (e) {}
        x.png = nom; x.version = (x.version || 0) + 1; x.erreur = '';
      } catch (e) { x.erreur = e.message || String(e); }
      ecrire(s);
    }
  }

  // la relecture : la planche des rendus (numérotés) à côté de l'original → ce qui est à corriger
  async function relire(s) {
    const faits = s.stickers.filter(x => x.png);
    const planche = path.join(dossierDe(s.id), 'relecture.png');
    await faireplanche(faits.map(x => path.join(dossierDe(s.id), x.png)), planche);
    const q = [
      `Ouvre avec Read l'image d'origine ${cheminModele(s)}, puis la planche ${planche} : les stickers redessinés, ${faits.length} cases numérotées dans l'ordre de lecture, qui sont dans l'ordre les stickers n° ${faits.map(x => x.n).join(', ')}.`,
      'Ouvre aussi chaque sticker en grand quand la planche ne suffit pas : ' + faits.map(x => 'n° ' + x.n + ' = ' + path.join(dossierDe(s.id), x.png)).join(' ; ') + '.',
      'Pour chacun, cherche les DÉFAUTS VISIBLES seulement : un texte qui déborde de sa forme ou qui est coupé, deux éléments qui se chevauchent alors qu\'ils ne devraient pas (texte sur une icône, sur une étincelle, sur un curseur), une forme cassée ou méconnaissable, un élément important de l\'original oublié, un texte illisible sur son fond. Pas de goût : ce qui est propre ne bouge pas.',
      'Les textes attendus : ' + faits.map(x => 'n° ' + x.n + ' « ' + x.texte + ' »').join(' ; '),
      'Réponds ce JSON : {"corriger":[{"n":<numéro>,"probleme":"<le défaut et la correction précise : quoi bouger, de combien, quelle taille>"}]} — une liste vide si tout est propre.'
    ].join('\n\n');
    const r = await D.demanderJson(q + '\n\n' + GRATUIT, 8 * 60000, sansOutils);
    return ((r && r.corriger) || []).map(c => ({ x: s.stickers.find(y => y.n === Number(c.n) && y.svg), probleme: txt(c.probleme, 600) }))
      .filter(c => c.x && c.probleme).slice(0, MAX);
  }

  // la planche de relecture : chaque rendu dans une case de 320 px sur un gris moyen, 4 par ligne (ordre de lecture)
  async function faireplanche(fichiers, sortie) {
    const tmp = sortie + '-cases'; fs.mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < fichiers.length; i++) {
      await D.executer(D.ffmpeg(), ['-v', 'error', '-y', '-i', fichiers[i], '-f', 'lavfi', '-i', 'color=c=0x8a8a8a:s=320x320', '-filter_complex',
        '[0:v]scale=300:300:force_original_aspect_ratio=decrease[a];[1:v][a]overlay=(W-w)/2:(H-h)/2:format=auto', '-frames:v', '1', path.join(tmp, String(i + 1).padStart(3, '0') + '.png')], 60000);
    }
    const col = Math.min(4, fichiers.length), lig = Math.ceil(fichiers.length / col);
    await D.executer(D.ffmpeg(), ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, '%03d.png'), '-vf', 'tile=' + col + 'x' + lig + ':padding=8:margin=8:color=0x303030', '-frames:v', '1', sortie], 120000);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }

  // une retouche demandée par la personne, sur un sticker
  async function retoucher(s, n, consigne) {
    const x = s.stickers.find(y => y.n === n);
    if (!x || !x.svg) throw new Error('Sticker introuvable.');
    if (s.etat === 'travail') throw new Error('Un travail est déjà en cours sur cette planche.');
    if (x.travail) throw new Error('Ce sticker est déjà en retouche.');
    x.travail = true; ecrire(s);
    (async () => {
      try {
        if (consigne.texte) x.texte = txt(consigne.texte, 400);
        await dessiner(s, [x], txt(consigne.consigne, 600) || 'Refais-le plus fidèle à l\'original.');
        await photographierTout(s, [x]);
        copierDansMesStickers(s);
      } catch (e) { x.erreur = e.message || String(e); }
      x.travail = false; s.message = ''; ecrire(s);
    })();
    return s;
  }

  // les PNG finis, rangés là où la personne les retrouve
  function copierDansMesStickers(s) {
    try {
      if (!s.sortie) {
        const d = new Date(s.cree), deux = v => String(v).padStart(2, '0');
        s.sortie = path.join('MES STICKERS', s.profil, d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate()) + ' ' + deux(d.getHours()) + 'h' + deux(d.getMinutes()));
      }
      const dest = path.join(D.RACINE, s.sortie);
      fs.mkdirSync(dest, { recursive: true });
      fs.readdirSync(dest).filter(f => f.endsWith('.png')).forEach(f => { try { fs.unlinkSync(path.join(dest, f)); } catch (e) {} });
      s.stickers.filter(x => x.png).forEach(x => fs.copyFileSync(path.join(dossierDe(s.id), x.png), path.join(dest, nomFichier(x))));
    } catch (e) {}
  }
  const nomFichier = x => String(x.n).padStart(2, '0') + '-' + (String(x.nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sticker') + '.png';

  // garder : les stickers choisis entrent dans les éléments de la DA Story
  async function garder(s, numeros) {
    const l = s.stickers.filter(x => numeros.includes(x.n) && x.png && !x.garde);
    if (!l.length) throw new Error('Choisissez au moins un sticker.');
    for (const x of l) {
      const b = fs.readFileSync(path.join(dossierDe(s.id), x.png));
      await D.ajouterElementDA(s.daId, { sous: 'story', nom: x.nom, quand: x.quand || ('sticker « ' + x.texte + ' »'), detourer: false, donnees: 'data:image/png;base64,' + b.toString('base64') });
      x.garde = true; ecrire(s);
    }
    return s;
  }

  /* ---------- Le PNG, lu et écrit sans outil (zlib suffit) : rogner au plus près du dessin ---------- */
  function lirePng(f) {
    const b = fs.readFileSync(f); let p = 8, w = 0, h = 0, prof = 0, type = 0, entrel = 0; const idat = [];
    while (p < b.length) {
      const n = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8), dt = b.slice(p + 8, p + 8 + n);
      if (t === 'IHDR') { w = dt.readUInt32BE(0); h = dt.readUInt32BE(4); prof = dt[8]; type = dt[9]; entrel = dt[12]; }
      else if (t === 'IDAT') idat.push(dt); else if (t === 'IEND') break;
      p += 12 + n;
    }
    if (prof !== 8 || (type !== 6 && type !== 2) || entrel) return null;
    const bpp = type === 6 ? 4 : 3, ligne = w * bpp, brut = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4);
    let avant = Buffer.alloc(ligne);
    for (let y = 0; y < h; y++) {
      const f0 = brut[y * (ligne + 1)], cur = Buffer.from(brut.slice(y * (ligne + 1) + 1, (y + 1) * (ligne + 1)));
      for (let i = 0; i < ligne; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, u = avant[i], c = i >= bpp ? avant[i - bpp] : 0;
        let v = cur[i];
        if (f0 === 1) v += a; else if (f0 === 2) v += u; else if (f0 === 3) v += (a + u) >> 1;
        else if (f0 === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? u : c; }
        cur[i] = v & 255;
      }
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, k = x * bpp; px[o] = cur[k]; px[o + 1] = cur[k + 1]; px[o + 2] = cur[k + 2]; px[o + 3] = bpp === 4 ? cur[k + 3] : 255; }
      avant = cur;
    }
    return { w, h, px };
  }
  const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function ecrirePng(f, w, h, px) {
    const brut = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) px.copy(brut, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const morceau = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    fs.writeFileSync(f, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', ihdr), morceau('IDAT', zlib.deflateSync(brut, { level: 9 })), morceau('IEND', Buffer.alloc(0))]));
  }
  function rogner(entree, sortie) {
    const im = lirePng(entree); if (!im) return false;
    let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.px[(y * im.w + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) throw new Error('Le sticker est sorti vide.');
    const m = 12; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(im.w - 1, x1 + m); y1 = Math.min(im.h - 1, y1 + m);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) im.px.copy(px, y * w * 4, ((y + y0) * im.w + x0) * 4, ((y + y0) * im.w + x0 + w) * 4);
    ecrirePng(sortie, w, h, px);
    return true;
  }

  /* ---------- Les routes ---------- */
  function routes(req, res, url) {
    const M = req.method; let m;
    const echec = e => D.repondreJson(res, 400, { erreur: e.message || String(e) });
    if (M === 'GET' && url === '/api/stickers') { D.repondreJson(res, 200, { sessions: liste() }); return true; }
    if (M === 'POST' && url === '/api/stickers') { D.corpsJson(req, 3e7).then(d => D.repondreJson(res, 200, vue(creer(d || {})))).catch(echec); return true; }
    if ((m = url.match(/^\/api\/stickers\/(k[a-z0-9]+)(?:\/([a-z]+)(?:\/(\d+))?)?$/))) {
      const s = lire(m[1]), quoi = m[2], n = Number(m[3]);
      if (!s || s.profil !== D.profil.id()) { echec(new Error('Planche inconnue.')); return true; }
      if (M === 'GET' && !quoi) { D.repondreJson(res, 200, vue(s)); return true; }
      if (M === 'POST' && quoi === 'garder') { D.corpsJson(req, 1e4).then(d => garder(s, (d.numeros || []).map(Number))).then(x => D.repondreJson(res, 200, vue(x))).catch(echec); return true; }
      if (M === 'POST' && quoi === 'retoucher' && n) { D.corpsJson(req, 1e4).then(d => retoucher(s, n, d || {})).then(x => D.repondreJson(res, 200, vue(x))).catch(echec); return true; }
      if (M === 'POST' && quoi === 'dossier') { if (s.sortie) D.ouvrirDossier(path.join(D.RACINE, s.sortie)); D.repondreJson(res, 200, { ok: true }); return true; }
      return false;
    }
    // la page d'un sticker : pour le navigateur d'export (aucun script)
    if (M === 'GET' && (m = url.match(/^\/stickers-page\/(k[a-z0-9]+)\/(\d+)$/))) {
      const s = lire(m[1]), x = s && s.stickers.find(y => y.n === Number(m[2]));
      if (!x || !x.svg) { res.writeHead(404).end('Introuvable'); return true; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'none'; frame-ancestors 'none'" });
      res.end(page(s, x).html);
      return true;
    }
    if (M === 'GET' && (m = url.match(/^\/stickers-fichier\/(k[a-z0-9]+)\/([a-z0-9.-]+)$/))) {
      if (!lire(m[1])) { res.writeHead(404).end(); return true; }
      D.servirFichier(res, dossierDe(m[1]), m[2], { 'Cache-Control': 'no-cache' });
      return true;
    }
    return false;
  }

  return { routes };
};
