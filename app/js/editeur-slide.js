/* ============================================================
   STORYMATIC — l'éditeur de slide

   Dans la loupe, une slide composée par Claude se retouche à la main,
   comme dans un outil de mise en page :
     - un clic sélectionne CE QU'ON VOIT sous le curseur ;
     - un second clic au même endroit, ou Alt+clic, descend dans la pile ;
     - on le GLISSE pour le déplacer, avec magnétisme et repères verts ;
       les flèches le poussent d'un pixel, Alt désactive l'aimant ;
     - huit poignées le redimensionnent ; un coin sur du texte fait
       grandir la police avec la boîte ; la poignée ronde le fait tourner,
       et le cadre tourne avec lui ;
     - les parties transparentes d'une image détourée laissent passer le clic ;
     - un double-clic entre dans son texte ; Entrée y coupe une ligne ;
     - un mot sélectionné dans ce texte reçoit à lui seul les réglages de
       CARACTÈRE (couleur, taille, graisse, espacement, casse, fond) ;
     - le panneau règle sa taille, sa graisse, son interligne, ses couleurs,
       sa largeur, ses marges, son arrondi, sa rotation, son opacité, son
       ordre d'empilement, son miroir ; on peut le dupliquer (la copie sort
       toujours du flux : dans une grille, rien d'autre ne bouge), le masquer,
       le supprimer ;
     - Ctrl+Z annule, Ctrl+Y rétablit.

   QUATRE PIÈGES, chèrement appris le 21 septembre 2026 :

   1. e.target rend l'élément le plus haut, et c'est souvent un CONTENEUR
      TRANSPARENT. On croyait attraper le paragraphe qu'on voit, on attrapait
      la boîte invisible de 900px qui l'englobe — et le geste suivant
      déplaçait tout autre chose. D'où edPileEn() : on ne retient de la pile
      que ce qui PEINT vraiment au point cliqué.

   2. La loupe réduit la slide avec transform:scale, mais une iframe ainsi
      réduite rend ses événements dans SES pixels à elle : les deltas de
      souris sont déjà en pixels de slide. Les diviser par l'échelle
      multipliait chaque déplacement par quatre.

   3. Entrée, dans un contenteditable "plaintext-only", n'insère pas un <br>
      mais un simple \n. Le navigateur passe l'élément en white-space:pre-wrap
      tant qu'on l'édite, donc la coupure se voit ; dès qu'on en sort on
      revient à white-space:normal et le \n se réduit à une espace. La ligne
      semblait « ne pas s'enregistrer » alors qu'elle l'était : elle ne rendait
      simplement rien. D'où edFigerRetours(), et l'aplatissement à l'entrée.

   4. Le panneau écrivait toujours sur l'élément entier : on sélectionnait un
      mot, on cliquait une couleur, et tout le bloc changeait. Les réglages de
      CARACTÈRE vont maintenant dans un <span data-pg-mot> autour de la
      sélection ; ceux de BOÎTE restent sur l'élément.

   Rien n'est regénéré : tout s'écrit en style sur l'élément, dans le HTML
   de la slide, que le serveur nettoie et enregistre. La page de la slide
   n'exécute aucun script (sa politique l'interdit) : c'est cette page-ci,
   de même origine, qui pilote son contenu de l'extérieur. Le calque des
   poignées (#pg-ed-ui) vit dans le <body>, HORS de la <section> : ce qui
   s'enregistre est la section seule, il n'y entre donc jamais.
   ============================================================ */

const ED = {
  cadre: null, doc: null, win: null, sec: null,
  sel: null,            // l'élément sélectionné
  texte: null,          // l'élément dont on édite le texte, sinon null
  annuler: [], retablir: [], dernierGeste: "", dernierTemps: 0,
  glisse: null,         // un déplacement en cours
  taille: null,         // un redimensionnement en cours
  rotation: null,       // une rotation à la souris en cours
  ui: null,             // le calque des poignées et des repères, hors de la slide
  echelle: 1,           // la loupe réduit la slide : les poignées compensent
  pile: null,           // le clic répété au même endroit descend dans la pile
  minuteurSel: null,    // le panneau se redessine peu après un changement de sélection
  modifie: false
};
const ED_ATTRS = ["data-pg-sel", "data-pg-survol", "contenteditable", "spellcheck"];
const ED_AIMANT = 6;    // la distance, en px de slide, à laquelle un bord s'aimante

/* ---------- Ouvrir sur une slide chargée ---------- */

function edOuvrir(cadre) {
  let doc; try { doc = cadre.contentDocument; } catch (e) { return; }
  const sec = doc && doc.querySelector(".slide");
  if (!sec) return;
  /* La MÊME page rebranchée (la fenêtre a changé de taille, les poignées se remesurent) garde son
     historique d'annulation et son état « modifié » : seule une autre slide repart de zéro. */
  const meme = ED.doc === doc;
  /* Rebranchée, elle garde aussi ce qui était sélectionné et le texte en cours d'écriture : un simple
     changement de taille de la fenêtre (une barre de défilement qui apparaît) désélectionnait tout,
     au milieu d'une frappe — on se retrouvait hors du texte sans rien avoir touché (27 sept. 2026). */
  const garde = el => meme && el && sec.contains(el) ? el : null;
  Object.assign(ED, { cadre: cadre, doc: doc, win: cadre.contentWindow, sec: sec, sel: garde(ED.sel), texte: garde(ED.texte),
                      annuler: meme ? ED.annuler : [], retablir: meme ? ED.retablir : [], dernierGeste: "",
                      glisse: null, taille: null, pile: meme ? ED.pile : null, modifie: meme ? !!ED.modifie : false });
  /* La loupe affiche la slide réduite (transform:scale). Les poignées vivent DANS cette
     page : sans compensation elles seraient réduites d'autant et deviendraient invisibles. */
  const large = cadre.getBoundingClientRect().width;
  ED.echelle = large > 0 ? large / (sec.offsetWidth || 1080) : 1;
  const k = 1 / (ED.echelle || 1);

  // Les repères de l'éditeur : posés dans la page de la slide, jamais enregistrés.
  // Rebranchée, la page perd ceux d'avant : ils portaient l'ancienne échelle.
  doc.querySelectorAll("style[data-pg-ed], #pg-ed-ui").forEach(x => x.remove());
  const st = doc.createElement("style");
  st.setAttribute("data-pg-ed", "");
  st.textContent =
    ".slide, .slide * { cursor: default; }" +
    // Rien ne défile, même si le CSS de la slide remet overflow:hidden (voir serveur.js, pageDeSlide).
    "html, body, .slide { overflow: clip !important; }" +
    "[data-pg-survol] { outline: " + (2 * k) + "px solid rgba(244,75,123,.55) !important; outline-offset: " + (3 * k) + "px; }" +
    "[data-pg-sel] { cursor: move !important; }" +
    "[contenteditable] { outline: " + (3 * k) + "px solid #F44B7B !important; outline-offset: " + (5 * k) + "px; cursor: text !important; }" +
    ".slide img { -webkit-user-drag: none; user-select: none; }" +
    "#pg-ed-ui { position: absolute; inset: 0; pointer-events: none; z-index: 2147483000; }" +
    // Un contour et non une bordure : les poignées, enfants du cadre, tombent pile sur ses coins.
    "#pg-ed-ui .pged-cadre { position: absolute; outline: " + (2 * k) + "px solid #F44B7B; pointer-events: none; transform-origin: 50% 50%; }" +
    "#pg-ed-ui .pged-sv { position: absolute; outline: " + (2 * k) + "px solid rgba(244,75,123,.55); outline-offset: " + (3 * k) + "px; pointer-events: none; }" +
    "#pg-ed-ui .pged-r { position: absolute; width: " + (26 * k) + "px; height: " + (26 * k) + "px; margin: " + (-13 * k) + "px 0 0 " + (-13 * k) + "px;" +
      " border-radius: 50%; background: #F44B7B; border: " + (2 * k) + "px solid #fff; color: #fff; font: 700 " + (17 * k) + "px/" + (22 * k) + "px system-ui, sans-serif;" +
      " text-align: center; box-sizing: border-box; box-shadow: 0 " + k + "px " + (4 * k) + "px rgba(0,0,0,.35); pointer-events: auto; cursor: grab; user-select: none; }" +
    "#pg-ed-ui .pged-r:hover { background: #fb8a3c; }" +
    "#pg-ed-ui .pged-r.pged-m { cursor: move; }" +
    "#pg-ed-ui .pged-angle { position: absolute; margin: " + (18 * k) + "px 0 0 " + (18 * k) + "px; padding: " + (3 * k) + "px " + (8 * k) + "px; border-radius: " + (6 * k) + "px;" +
      " background: #111; color: #fff; font: 600 " + (14 * k) + "px system-ui, sans-serif; white-space: nowrap; pointer-events: none; }" +
    "#pg-ed-ui .pged-p { position: absolute; width: " + (11 * k) + "px; height: " + (11 * k) + "px; margin: " + (-6 * k) + "px 0 0 " + (-6 * k) + "px;" +
      " background: #fff; border: " + (2 * k) + "px solid #F44B7B; border-radius: " + (3 * k) + "px; pointer-events: auto; }" +
    "#pg-ed-ui .pged-g { position: absolute; background: #12d6a0; pointer-events: none; }" +
    "#pg-ed-ui .pged-g.pged-v { width: " + Math.max(1, k) + "px; top: 0; bottom: 0; }" +
    "#pg-ed-ui .pged-g.pged-h { height: " + Math.max(1, k) + "px; left: 0; right: 0; }";
  doc.head.appendChild(st);

  /* Les classes du calque portent le préfixe « pged- » : une slide de Claude nomme volontiers ses
     paragraphes « p » ou ses boîtes « cadre », et une règle de la slide non rangée sous .slide
     aurait habillé les poignées (voir edAppui : la même collision a déjà coûté cher). */
  const ui = doc.createElement("div");
  ui.id = "pg-ed-ui";
  doc.body.appendChild(ui);
  ED.ui = ui;

  /* Les écouteurs ne se posent qu'UNE fois par page : une slide quittée puis retrouvée (elle reste montée
     tant qu'elle est voisine) les aurait empilés, et chaque frappe aurait tout recalculé autant de fois. */
  if (doc.pgEdBranche) { edMajUI(); edRendrePanneau(); return; }
  doc.pgEdBranche = true;
  doc.addEventListener("mousemove", edSurvol);
  doc.addEventListener("mouseleave", () => { ED.survole = null; ED.survolXY = null; edMarquer("data-pg-survol", null); edSurvolCadre(null); });
  doc.addEventListener("mousedown", edAppui);
  doc.addEventListener("dblclick", edDoubleClic);
  doc.addEventListener("keydown", edTouche);
  doc.addEventListener("input", () => { edSale(); edMajUI(); });
  doc.addEventListener("dragstart", e => e.preventDefault());
  /* Garde-fou : si quoi que ce soit fait malgré tout défiler la page ou la slide (le curseur
     d'un mot qui déborde), on remet tout en place — sinon la slide entière semble décalée. */
  doc.addEventListener("scroll", ev => {
    const t = ev.target && ev.target.nodeType === 1 ? ev.target : doc.scrollingElement;
    if (t && (t.scrollLeft || t.scrollTop)) { t.scrollLeft = 0; t.scrollTop = 0; edMajUI(); }
  }, true);
  /* Sélectionner un mot change ce que le panneau va modifier : il doit le dire, et
     montrer les valeurs de ce mot. Rien ne l'en avertissait — le panneau restait
     muet et affichait celles du bloc. On attend un court instant : pendant qu'on
     traîne la souris sur le texte, l'événement part à chaque caractère. */
  doc.addEventListener("selectionchange", () => {
    if (!ED.texte) return;
    clearTimeout(ED.minuteurSel);
    ED.minuteurSel = setTimeout(edRendrePanneau, 140);
  });
  edRendrePanneau();
}

function edMarquer(attr, el) {
  ED.doc.querySelectorAll("[" + attr + "]").forEach(x => x.removeAttribute(attr));
  if (el) el.setAttribute(attr, "");
}
const edDansSlide = el => el && el.nodeType === 1 && ED.sec.contains(el);

/* ---------- Ce qu'on désigne vraiment en un point ----------

   Le navigateur rend l'élément le plus haut sous le curseur, et c'est souvent un
   CONTENEUR TRANSPARENT qui ne montre rien : on croit attraper le paragraphe qu'on
   voit, on attrape la boîte invisible de 900px qui l'englobe — et le geste suivant
   déplace tout autre chose. On demande donc la pile complète, et on n'en retient que
   ce qui PEINT vraiment à cet endroit : une image, un fond, des lettres. */

const edRemplit = c => {
  if (!c || c === "transparent") return false;
  const m = /rgba?\(\s*\d+,\s*\d+,\s*\d+(?:,\s*([\d.]+))?\s*\)/.exec(c);
  return !m || m[1] === undefined || parseFloat(m[1]) > 0.12;
};
// Les rectangles des lettres propres d'un élément (pas celles de ses enfants).
function edRectsTexte(el) {
  const r = [];
  [].slice.call(el.childNodes).forEach(n => {
    if (n.nodeType !== 3 || !n.textContent.trim()) return;
    const p = ED.doc.createRange();
    p.selectNodeContents(n);
    [].slice.call(p.getClientRects()).forEach(b => { if (b.width > 1 && b.height > 1) r.push(b); });
  });
  return r;
}
/* ---------- La géométrie vraie d'un élément ----------
   Un élément tourné n'a plus pour boîte le rectangle que rend getBoundingClientRect :
   celui-là est le rectangle DROIT qui l'englobe. On reconstitue donc son centre, sa
   taille de mise en page et son angle — le sien et celui de ses parents. */

function edDeg(v) {
  if (!v || v === "none") return 0;
  const m = /(-?[\d.]+)\s*(deg|turn|rad|grad)?/.exec(v);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] === "turn" ? n * 360 : m[2] === "rad" ? n * 180 / Math.PI : m[2] === "grad" ? n * .9 : n;
}
function edEchelleProp(v) {
  if (!v || v === "none") return [1, 1];
  const t = v.trim().split(/\s+/).map(parseFloat);
  return [isNaN(t[0]) ? 1 : t[0], t.length > 1 && !isNaN(t[1]) ? t[1] : (isNaN(t[0]) ? 1 : t[0])];
}
// L'angle et l'échelle qu'un seul élément ajoute (sa propriété rotate, son transform, son scale).
function edPropre(x) {
  const s = ED.win.getComputedStyle(x);
  const [sx, sy] = edEchelleProp(s.scale);
  let angle = edDeg(s.rotate), ech = 1, miroir = sx * sy < 0;
  if (s.transform && s.transform !== "none") {
    try {
      const m = new ED.win.DOMMatrix(s.transform), det = m.a * m.d - m.b * m.c;
      if (det < 0) { miroir = !miroir; angle -= Math.atan2(-m.b, m.a) * 180 / Math.PI; } else angle += Math.atan2(m.b, m.a) * 180 / Math.PI;
      ech = Math.sqrt(Math.abs(det)) || 1;
    } catch (e) { /* un transform illisible : on l'ignore */ }
  }
  return { angle: angle, ech: ech, sx: sx, sy: sy, miroir: miroir };
}
function edGeo(el) {
  const b = edBoiteSlide(el), p = edPropre(el);
  let anc = 0, echAnc = 1;
  for (let x = el.parentElement; x && x !== ED.sec && ED.sec.contains(x); x = x.parentElement) {
    const q = edPropre(x); anc += q.angle; echAnc *= q.ech * Math.sqrt(Math.abs(q.sx * q.sy));
  }
  const total = anc + p.angle, droit = Math.abs(((total % 360) + 360) % 360) < .01 || Math.abs(((total % 360) + 360) % 360 - 360) < .01;
  const lw = el.offsetWidth != null ? el.offsetWidth : b.w, lh = el.offsetHeight != null ? el.offsetHeight : b.h;
  const k = echAnc * p.ech;
  return {
    cx: b.x + b.w / 2, cy: b.y + b.h / 2,
    // La taille du cadre : celle qu'on voit, une fois l'élément redressé.
    w: droit ? b.w : lw * k * Math.abs(p.sx), h: droit ? b.h : lh * k * Math.abs(p.sy),
    lw: lw, lh: lh, k: k, sx: p.sx, sy: p.sy, miroir: p.miroir,
    angle: droit ? 0 : total, propre: p.angle, anc: anc, echAnc: echAnc, droit: droit, b: b
  };
}
// Tourner un vecteur de a degrés.
function edTourne(x, y, a) {
  const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/* ---------- Une image détourée ne se prend que par ce qu'elle montre ----------
   Un cavalier détouré de 1180px couvre toute la slide : ses parties transparentes
   capturaient chaque clic, et plus rien d'autre n'était atteignable. On lit donc la
   transparence du pixel visé (object-fit, object-position, rotation, miroir compris). */

const ED_ALPHA = new WeakMap();
// L'image, lue une fois dans un canevas réduit (700 px au plus) : sa transparence se consulte ensuite sans frais.
function edAlpha(img) {
  if (!img.complete || !img.naturalWidth) return null;
  let t = ED_ALPHA.get(img);
  if (!t || t.src !== img.currentSrc) {
    const nw = img.naturalWidth, nh = img.naturalHeight, r = Math.min(1, 700 / Math.max(nw, nh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(nw * r)); c.height = Math.max(1, Math.round(nh * r));
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    t = { src: img.currentSrc, g: g, r: r, w: c.width, h: c.height, boite: undefined };
    ED_ALPHA.set(img, t);
  }
  return t;
}
// Le rectangle de ce que l'image MONTRE, en pixels de l'image d'origine (null si rien n'est opaque).
function edBoiteAlpha(t) {
  if (t.boite !== undefined) return t.boite;
  const d = t.g.getImageData(0, 0, t.w, t.h).data;
  let x0 = t.w, y0 = t.h, x1 = -1, y1 = -1;
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (d[(y * t.w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  t.boite = x1 < 0 ? null : { x0: x0 / t.r, y0: y0 / t.r, x1: (x1 + 1) / t.r, y1: (y1 + 1) / t.r };
  return t.boite;
}
/* Où l'image se dessine dans sa boîte : object-fit et object-position appliqués.
   Le pixel (ix, iy) de l'image tombe en (ox + ix × kx, oy + iy × ky) dans la boîte de contenu. */
function edMiseImage(img, lw, lh) {
  const cs = ED.win.getComputedStyle(img), nw = img.naturalWidth, nh = img.naturalHeight;
  const bl = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), bt = parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const cw = lw - bl - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
  const ch = lh - bt - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom);
  if (cw <= 0 || ch <= 0 || !nw || !nh) return null;
  const fit = cs.objectFit;
  let kx = cw / nw, ky = ch / nh;
  if (fit === "contain" || fit === "scale-down") { kx = ky = Math.min(cw / nw, ch / nh); if (fit === "scale-down") kx = ky = Math.min(1, kx); }
  else if (fit === "cover") kx = ky = Math.max(cw / nw, ch / nh);
  else if (fit === "none") kx = ky = 1;
  const pos = (cs.objectPosition || "50% 50%").split(/\s+/);
  const place = (v, libre) => /%$/.test(v) ? libre * parseFloat(v) / 100 : (parseFloat(v) || 0);
  return { bl: bl, bt: bt, cw: cw, ch: ch, kx: kx, ky: ky, nw: nw, nh: nh,
           ox: place(pos[0] || "50%", cw - nw * kx), oy: place(pos[1] || "50%", ch - nh * ky) };
}

function edImageOpaque(img, x, y) {
  try {
    const t = edAlpha(img);
    if (!t) return true;
    // Le point, dans le repère de l'image redressée.
    const s = ED.sec.getBoundingClientRect(), geo = edGeo(img);
    let [lx, ly] = edTourne(x - s.left - geo.cx, y - s.top - geo.cy, -geo.angle);
    lx /= geo.k * (geo.sx || 1); ly /= geo.k * (geo.sy || 1);
    const m = edMiseImage(img, geo.lw, geo.lh);
    if (!m) return true;
    const ix = (lx + geo.lw / 2 - m.bl - m.ox) / m.kx, iy = (ly + geo.lh / 2 - m.bt - m.oy) / m.ky;
    if (ix < 0 || iy < 0 || ix >= m.nw || iy >= m.nh) return false;
    const px = Math.min(t.w - 1, Math.floor(ix * t.r)), py = Math.min(t.h - 1, Math.floor(iy * t.r));
    return t.g.getImageData(px, py, 1, 1).data[3] > 24;
  } catch (e) { return true; }   // une image d'ailleurs, illisible : on la prend entière
}

/* ---------- LES MASQUES EN DÉGRADÉ (27 septembre 2026) ----------
   Claude fond volontiers une illustration dans la slide : mask-image:radial-gradient(circle,#000 58%,
   transparent 72%), ou un linear-gradient qui l'efface vers le bas. L'éditeur ne lisait que la
   transparence du fichier : un clic dans les coins effacés prenait l'image, et son cadre entourait
   toute sa boîte, bien plus grande que ce qu'on voit (relevé sur une slide réelle : une image
   agrandie à 1149 px dont on ne voyait qu'un rond). On calcule donc l'opacité du masque en un point
   de la boîte (x, y en pixels de mise en page, 0 à w, 0 à h). Un masque qu'on ne sait pas lire
   (une image, un dégradé répété) laisse tout visible, comme avant. */
function edDecouper(s) {
  const r = []; let prof = 0, d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") prof++; else if (c === ")") prof--;
    else if (c === "," && !prof) { r.push(s.slice(d, i).trim()); d = i + 1; }
  }
  r.push(s.slice(d).trim());
  return r.filter(Boolean);
}
function edAlphaCouleur(c) {
  c = c.trim().toLowerCase();
  if (c === "transparent") return 0;
  let m = /^(?:rgba?|hsla?)\((.*)\)$/.exec(c);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 4) return 1;
    return /%$/.test(p[3]) ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
  }
  m = /^#([0-9a-f]{8}|[0-9a-f]{4})$/.exec(c);
  if (m) { const h = m[1]; return h.length === 8 ? parseInt(h.slice(6), 16) / 255 : parseInt(h[3] + h[3], 16) / 255; }
  return 1;
}
// L'opacité d'une couche de masque au point (x, y) d'une boîte w × h ; null si on ne sait pas la lire.
function edCoucheAlpha(couche, x, y, w, h) {
  const m = /^(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)$/.exec(couche.trim());
  if (!m || m[1] || w <= 0 || h <= 0) return null;
  const parts = edDecouper(m[3]);
  const lineaire = m[2] === "linear";
  const tete = parts[0] || "";
  const geom = lineaire ? /^(to\s|[-\d.]+(deg|turn|rad|grad)\b)/.test(tete)
                        : /^(circle|ellipse|closest|farthest|at\s|[-\d.]+(px|%))/.test(tete);
  if (geom) parts.shift();
  let pos, L;                                   // pos : la place du point sur le rayon (0 à 1), L : la longueur du rayon en px
  if (lineaire) {
    let dx = 0, dy = 1;                         // vers le bas, par défaut
    if (geom && /^to\s/.test(tete)) {
      const sx = /right/.test(tete) ? 1 : /left/.test(tete) ? -1 : 0, sy = /bottom/.test(tete) ? 1 : /top/.test(tete) ? -1 : 0;
      if (sx && sy) { dx = sx * h; dy = sy * w; } else { dx = sx; dy = sy; }
    } else if (geom) {
      const a = edDeg(tete) * Math.PI / 180;
      dx = Math.sin(a); dy = -Math.cos(a);
    }
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    L = Math.abs(w * dx) + Math.abs(h * dy);
    pos = ((x - w / 2) * dx + (y - h / 2) * dy) / (L || 1) + .5;
  } else {
    const g = geom ? tete : "";
    const morceaux = g.split(/\bat\b/).map(s => (s || "").trim()), forme = morceaux[0] || "", lieu = morceaux[1] || "";
    const cercle = /circle/.test(forme) || /^[\d.]+px$/.test(forme);
    const coord = (v, taille, axe) => {
      if (v === "center" || v == null) return taille / 2;
      if (v === (axe ? "top" : "left")) return 0;
      if (v === (axe ? "bottom" : "right")) return taille;
      return /%$/.test(v) ? taille * parseFloat(v) / 100 : parseFloat(v) || 0;
    };
    let lt = (lieu || "center").split(/\s+/);
    if (lt[0] === "top" || lt[0] === "bottom") lt = [lt[1] || "center", lt[0]];
    const cx = coord(lt[0], w, 0), cy = coord(lt[1] || "center", h, 1);
    const dl = cx, dr = w - cx, dt = cy, db = h - cy;
    const taille = (forme.match(/closest-side|closest-corner|farthest-side|farthest-corner/) || ["farthest-corner"])[0];
    const long = forme.replace(/circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner/g, "").trim().split(/\s+/).filter(Boolean);
    let rx, ry;
    if (long.length) {
      rx = /%$/.test(long[0]) ? w * parseFloat(long[0]) / 100 : parseFloat(long[0]);
      ry = long[1] ? (/%$/.test(long[1]) ? h * parseFloat(long[1]) / 100 : parseFloat(long[1])) : rx;
    } else if (cercle) {
      const coins = [Math.hypot(dl, dt), Math.hypot(dr, dt), Math.hypot(dl, db), Math.hypot(dr, db)];
      rx = ry = taille === "closest-side" ? Math.min(dl, dr, dt, db) : taille === "farthest-side" ? Math.max(dl, dr, dt, db)
        : taille === "closest-corner" ? Math.min(...coins) : Math.max(...coins);
    } else {
      const k = /corner/.test(taille) ? Math.SQRT2 : 1, pres = /closest/.test(taille);
      rx = (pres ? Math.min(dl, dr) : Math.max(dl, dr)) * k; ry = (pres ? Math.min(dt, db) : Math.max(dt, db)) * k;
    }
    if (!(rx > 0) || !(ry > 0)) return null;
    L = rx;
    pos = Math.hypot((x - cx) / rx, (y - cy) / ry);
  }
  // Les arrêts de couleur : leur opacité, leur place (en % ou en px du rayon) ; les places manquantes se répartissent.
  const arrets = [];
  parts.forEach(p => {
    const mm = /^((?:[a-z-]+\([^)]*\))|\S+)\s*(.*)$/i.exec(p);
    if (!mm) return;
    const a = edAlphaCouleur(mm[1]);
    const places = mm[2].split(/\s+/).filter(Boolean).map(v => /%$/.test(v) ? parseFloat(v) / 100 : /px$/.test(v) ? parseFloat(v) / (L || 1) : NaN);
    if (!places.length) arrets.push({ a: a, t: NaN });
    places.forEach(tt => arrets.push({ a: a, t: tt }));
  });
  if (!arrets.length) return null;
  if (isNaN(arrets[0].t)) arrets[0].t = 0;
  if (isNaN(arrets[arrets.length - 1].t)) arrets[arrets.length - 1].t = 1;
  for (let i = 1; i < arrets.length; i++) {
    if (!isNaN(arrets[i].t)) { arrets[i].t = Math.max(arrets[i].t, arrets[i - 1].t); continue; }
    let j = i; while (isNaN(arrets[j].t)) j++;
    for (let k = i; k < j; k++) arrets[k].t = arrets[i - 1].t + (arrets[j].t - arrets[i - 1].t) * (k - i + 1) / (j - i + 1);
  }
  if (pos <= arrets[0].t) return arrets[0].a;
  for (let i = 1; i < arrets.length; i++) {
    if (pos <= arrets[i].t) {
      const a = arrets[i - 1], b = arrets[i], d = b.t - a.t;
      return d > 0 ? a.a + (b.a - a.a) * (pos - a.t) / d : b.a;
    }
  }
  return arrets[arrets.length - 1].a;
}
const edMasqueDe = el => {
  const cs = ED.win.getComputedStyle(el);
  const mi = cs.maskImage || cs.webkitMaskImage || cs.getPropertyValue("-webkit-mask-image");
  return mi && mi !== "none" && /gradient\(/.test(mi) ? mi : null;
};
// L'opacité du masque au point (x, y) de la boîte (w × h) : les couches s'additionnent.
function edMasqueAlpha(mi, x, y, w, h) {
  let a = 0;
  for (const c of edDecouper(mi)) { const v = edCoucheAlpha(c, x, y, w, h); if (v == null) return 1; a += v; }
  return Math.min(1, a);
}
// L'opacité du masque d'un élément au point (x, y) de la page de la slide (1 sans masque).
function edMasqueEn(el, x, y) {
  const mi = edMasqueDe(el);
  if (!mi) return 1;
  try {
    const s = ED.sec.getBoundingClientRect(), geo = edGeo(el);
    let [lx, ly] = edTourne(x - s.left - geo.cx, y - s.top - geo.cy, -geo.angle);
    lx /= geo.k * (geo.sx || 1); ly /= geo.k * (geo.sy || 1);
    return edMasqueAlpha(mi, lx + geo.lw / 2, ly + geo.lh / 2, geo.lw, geo.lh);
  } catch (e) { return 1; }
}
// Le rectangle de la boîte que le masque laisse voir (en px de mise en page), ou null sans masque.
const ED_MASQUES = new Map();
function edMasqueBoite(el, w, h) {
  const mi = edMasqueDe(el);
  if (!mi || w <= 0 || h <= 0) return null;
  const cle = mi + "|" + Math.round(w) + "|" + Math.round(h);
  if (ED_MASQUES.has(cle)) return ED_MASQUES.get(cle);
  const N = 64;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = w * i / N, y = h * j / N;
    if (edMasqueAlpha(mi, x, y, w, h) > .15) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  const r = x1 >= x0 ? { x0: Math.max(0, x0 - w / N), y0: Math.max(0, y0 - h / N), x1: Math.min(w, x1 + w / N), y1: Math.min(h, y1 + h / N) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  if (ED_MASQUES.size > 200) ED_MASQUES.clear();
  ED_MASQUES.set(cle, r);
  return r;
}

/* ---------- Le cadre épouse ce que l'image montre ----------
   Une image détourée garde sa grande boîte transparente : le cadre orange, ses poignées et
   le survol entouraient un carré vide bien plus grand que le cavalier (relevé le 24 septembre
   2026). On les pose sur le rectangle des pixels opaques, dans le repère de l'image —
   rotation et miroir compris. */
function edZoneVisible(el, g) {
  if (!el || el === ED.sec) return null;
  const image = el.tagName === "IMG", mk = edMasqueBoite(el, g.lw, g.lh);
  if (!image && !mk) return null;
  try {
    // En pixels de mise en page de la boîte (bordure comprise) : d'abord toute la boîte.
    let X0 = 0, Y0 = 0, X1 = g.lw, Y1 = g.lh;
    if (image) {
      const t = edAlpha(el), b = t && edBoiteAlpha(t), m = t && edMiseImage(el, g.lw, g.lh);
      if (t && !b) return null;                                   // rien d'opaque : on garde la boîte
      if (b && m) {
        X0 = m.bl + Math.max(0, m.ox + b.x0 * m.kx); X1 = m.bl + Math.min(m.cw, m.ox + b.x1 * m.kx);
        Y0 = m.bt + Math.max(0, m.oy + b.y0 * m.ky); Y1 = m.bt + Math.min(m.ch, m.oy + b.y1 * m.ky);
      }
    }
    // Ce que le masque en dégradé laisse voir.
    if (mk) { X0 = Math.max(X0, mk.x0); Y0 = Math.max(Y0, mk.y0); X1 = Math.min(X1, mk.x1); Y1 = Math.min(Y1, mk.y1); }
    if (X1 <= X0 || Y1 <= Y0) return null;
    if ((X1 - X0) * (Y1 - Y0) > .94 * g.lw * g.lh) return null;     // l'élément remplit sa boîte : rien à resserrer
    const ex = g.k * (g.sx || 1), ey = g.k * (g.sy || 1);
    return { dx: ((X0 + X1) / 2 - g.lw / 2) * ex, dy: ((Y0 + Y1) / 2 - g.lh / 2) * ey,
             w: (X1 - X0) * Math.abs(ex), h: (Y1 - Y0) * Math.abs(ey) };
  } catch (e) { return null; }
}
/* ---------- Le cadre d'un GROUPE entoure ce qu'il montre ----------
   Un groupe (la colonne transparente qui tient un paragraphe) garde sa boîte à la place où Claude
   l'a posé, même quand son contenu a été déplacé ailleurs : le cadre orange entourait un rectangle
   VIDE, loin du texte, et l'on croyait le texte sorti de son bloc (27 septembre
   2026, slide 6). Le cadre, le survol et l'aimant d'un groupe droit se posent donc sur le rectangle
   qui englobe ce que ses éléments peignent — plus sa propre boîte s'il a un fond ou une bordure. */
function edUnionVue(el, prof) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const prendre = b => { if (!b || b.w < 1 || b.h < 1) return; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
  const cs = ED.win.getComputedStyle(el);
  if (edAUnFond(el) || (parseFloat(cs.borderTopWidth) > 0 && edRemplit(cs.borderTopColor)) || (cs.boxShadow && cs.boxShadow !== "none")) prendre(edBoiteSlide(el));
  [...el.children].filter(edCalqueVisible).forEach(x => {
    const s = ED.win.getComputedStyle(x);
    if (s.display === "none" || s.visibility === "hidden") return;
    if (edEstGroupe(x) && prof < 6) { const u = edUnionVue(x, prof + 1); if (u) prendre(u); }
    else prendre(edBoiteVue(x));
  });
  return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
// Le cadre tel qu'on le montre : la boîte de l'élément, ce que l'image montre vraiment, ou ce que le groupe contient.
function edCadreVu(el, geo) {
  const g = geo || edGeo(el);
  if (g.droit && el !== ED.sec && edEstGroupe(el)) {
    const u = edUnionVue(el, 0);
    if (u) return { cx: u.x + u.w / 2, cy: u.y + u.h / 2, w: u.w, h: u.h, angle: 0, vis: false, groupe: true };
  }
  /* Un texte qui déborde de sa boîte (une hauteur figée plus courte que ses lignes) : le cadre englobe
     aussi ses lettres, sans quoi la dernière ligne sortait du cadre et semblait ne plus lui appartenir. */
  if (g.droit && el !== ED.sec && el.tagName !== "IMG" && edRectsTexte(el).length) {
    const r = ED.doc.createRange(); r.selectNodeContents(el);
    const b = r.getBoundingClientRect(), s = ED.sec.getBoundingClientRect(), o = g.b;
    if (b.width > 1 && b.height > 1) {
      const x0 = Math.min(o.x, b.left - s.left), y0 = Math.min(o.y, b.top - s.top);
      const x1 = Math.max(o.x + o.w, b.right - s.left), y1 = Math.max(o.y + o.h, b.bottom - s.top);
      if (x1 - x0 > o.w + .5 || y1 - y0 > o.h + .5) return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, angle: 0, vis: false, deborde: true };
    }
  }
  const v = edZoneVisible(el, g);
  if (!v) return { cx: g.cx, cy: g.cy, w: g.w, h: g.h, angle: g.angle, vis: false };
  const [ax, ay] = edTourne(v.dx, v.dy, g.angle);
  return { cx: g.cx + ax, cy: g.cy + ay, w: v.w, h: v.h, angle: g.angle, vis: true };
}
// Le rectangle droit qui englobe ce cadre, en pixels de slide : pour l'aimant.
function edBoiteVue(el) {
  if (el.tagName !== "IMG" && !edEstGroupe(el)) return edBoiteSlide(el);
  const c = edCadreVu(el);
  if (c.groupe) return { x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h };
  if (!c.vis) return edBoiteSlide(el);
  const r = c.angle * Math.PI / 180;
  const W = Math.abs(c.w * Math.cos(r)) + Math.abs(c.h * Math.sin(r)), H = Math.abs(c.w * Math.sin(r)) + Math.abs(c.h * Math.cos(r));
  return { x: c.cx - W / 2, y: c.cy - H / 2, w: W, h: H };
}

function edPeint(el, x, y) {
  if (edMasqueEn(el, x, y) < .15) return false;                  // effacé là par son masque en dégradé
  if (el.tagName === "IMG") return edImageOpaque(el, x, y);
  const s = ED.win.getComputedStyle(el);
  if (/gradient|url\(/i.test(s.backgroundImage || "") || edRemplit(s.backgroundColor)) return true;
  if (s.borderTopWidth !== "0px" && edRemplit(s.borderTopColor)) return true;
  return edRectsTexte(el).some(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
}
// La pile des éléments qui peignent en (x, y), du dessus vers le dessous.
function edPileEn(x, y) {
  const brute = ED.doc.elementsFromPoint ? [].slice.call(ED.doc.elementsFromPoint(x, y)) : [];
  return brute.filter(el => edDansSlide(el) && el !== ED.sec && edPeint(el, x, y));
}

function edSurvol(e) {
  if (ED.rotation) { edTourner(e); return; }
  if (ED.taille) { edRedimensionner(e); return; }
  if (ED.glisse) { edGlisser(e); return; }
  if (ED.texte) return;
  /* Le survol seul (glisser, tourner et redimensionner restent immédiats, plus haut) : chaque mouvement
     de souris refaisait toute la recherche — pile d'éléments, styles, pixels d'image. Une fois par image
     affichée suffit, avec la dernière position connue. */
  ED.survolXY = [e.clientX, e.clientY];
  if (ED.survolPrevu) return;
  ED.survolPrevu = true;
  enPeinture(() => {
    ED.survolPrevu = false;
    if (ED.texte || ED.glisse || ED.taille || ED.rotation || !ED.survolXY || !ED.doc) return;
    edSurvolEn(ED.survolXY[0], ED.survolXY[1]);
  }, ED.win);
}
function edSurvolEn(x, y) {
  const pile = edPileEn(x, y);
  const el = pile[0] && pile[0] !== ED.sel ? pile[0] : null;
  // Toujours le même élément (hors image, dont le cadre suit le sujet) : rien à refaire.
  if (el === ED.survole && !(el && el.tagName === "IMG")) return;
  ED.survole = el;
  // Une image détourée : le survol entoure le sujet, pas sa boîte transparente.
  const c = el && (el.tagName === "IMG" || edEstGroupe(el)) ? edCadreVu(el) : null;
  edMarquer("data-pg-survol", c && (c.vis || c.groupe) ? null : el);
  edSurvolCadre(c && (c.vis || c.groupe) ? c : null);
}
function edSurvolCadre(c) {
  if (!ED.ui) return;
  const ancien = ED.ui.querySelector(".pged-sv");
  if (ancien) ancien.remove();
  if (!c) return;
  const d = ED.doc.createElement("div");
  d.className = "pged-sv";
  d.style.cssText = "left:" + (c.cx - c.w / 2) + "px;top:" + (c.cy - c.h / 2) + "px;width:" + c.w + "px;height:" + c.h + "px;" +
    (c.angle ? "transform:rotate(" + c.angle + "deg)" : "");
  ED.ui.appendChild(d);
}

/* ---------- Sélectionner, déplacer ---------- */

function edSelectionner(el) {
  if (ED.texte && ED.texte !== el) edFinTexte();
  ED.sel = el && edDansSlide(el) ? el : null;
  edMarquer("data-pg-sel", ED.sel);
  edMarquer("data-pg-survol", null);
  edMajUI();
  edRendrePanneau();
}

/* Descendre d'un cran dans la pile, là où on a cliqué : deux blocs qui se recouvrent
   s'atteignent l'un après l'autre, sans avoir à deviner lequel est devant. */
function edDessous() {
  const p = ED.pile;
  if (!p || !p.liste.length) return;
  p.i = (p.i + 1) % p.liste.length;
  edSelectionner(p.liste[p.i]);
}

function edAppui(e) {
  if (typeof fermerNuancier === "function") fermerNuancier();
  if (e.button !== 0) return;
  /* Une poignée, ou tout ce qui vit dans le calque de l'éditeur. PIÈGE PAYÉ (27 septembre 2026) : on les
     reconnaissait à leur classe « p »… que Claude donne aussi aux PARAGRAPHES de ses slides. Tout clic sur
     un paragraphe passait pour une prise de poignée et s'arrêtait là : rien de sélectionné, rien de
     déplacé, et le navigateur sélectionnait les lettres à la place. On regarde donc OÙ est la cible. */
  if (ED.ui && ED.ui.contains(e.target)) return;
  if (ED.texte && ED.texte.contains(e.target)) return;          // on place le curseur dans le texte
  e.preventDefault();
  if (!edDansSlide(e.target)) { ED.pile = null; edSelectionner(null); return; }

  const pile = edPileEn(e.clientX, e.clientY);
  /* Rien ne peint là, mais c'est DANS le cadre de ce qui est sélectionné (l'entre-deux des lignes d'un
     paragraphe, le vide entre les éléments d'un groupe) : on garde la sélection, et on la glisse. */
  if (!pile.length && ED.sel && ED.sel !== ED.sec && edDansCadre(ED.sel, e.clientX, e.clientY)) {
    ED.pile = null;
    edCommencerGlisse(e);
    return;
  }
  /* Le vide d'une image détourée n'est pas l'image, et le vide d'un GROUPE transparent n'est pas le
     groupe : le clic y désélectionne. Sans quoi un clic à l'endroit d'où l'on avait sorti un texte
     prenait la colonne invisible restée là, et le geste suivant déplaçait tout autre chose. */
  const cible = pile[0] || (e.target !== ED.sec && e.target.tagName !== "IMG" && !edEstGroupe(e.target) ? e.target : null);
  if (!cible) { ED.pile = null; edSelectionner(null); return; }

  /* Un clic répété au MÊME endroit descend dans la pile, comme un outil de mise en page.
     Alt fait la même chose d'un seul clic.
     PIÈGE PAYÉ (27 septembre 2026) : on clique sur un texte pour le prendre, puis on presse AU MÊME
     ENDROIT pour le glisser — et c'était l'image du dessous qui partait. Le second appui garde donc
     ce qui est sélectionné et le glisse ; on ne descend d'un cran que s'il est relâché SANS avoir
     bougé (un vrai clic), ou tout de suite avec Alt. */
  const memeEndroit = ED.pile && Math.abs(ED.pile.x - e.clientX) < 4 && Math.abs(ED.pile.y - e.clientY) < 4;
  const tenu = ED.sel && ED.sel !== ED.sec && (pile.indexOf(ED.sel) >= 0 || (ED.sel !== cible && ED.sel.contains(cible)));
  let choisi, auClic = null;
  /* Un GROUPE est sélectionné (depuis la colonne des calques) et l'on clique sur l'un de ses
     éléments : c'est le groupe entier qu'on veut glisser. Le clic suivant AU MÊME ENDROIT, ou
     Alt+clic, entre dans le groupe ; le double-clic entre directement dans un texte. */
  if (!memeEndroit && !e.altKey && ED.sel && ED.sel !== ED.sec && ED.sel !== cible && ED.sel.contains(cible)) {
    choisi = ED.sel;
    ED.pile = { x: e.clientX, y: e.clientY, liste: pile, i: -1 };
  } else if ((memeEndroit || e.altKey) && ED.sel && (pile.length > 1 || (tenu && ED.sel !== cible))) {
    const i = pile.indexOf(ED.sel), suivant = pile[(i + 1) % pile.length] || cible;
    if (e.altKey || !tenu) { choisi = suivant; ED.pile = { x: e.clientX, y: e.clientY, liste: pile, i: pile.indexOf(suivant) }; }
    else { choisi = ED.sel; auClic = suivant; ED.pile = { x: e.clientX, y: e.clientY, liste: pile, i: i }; }
  } else {
    choisi = cible;
    ED.pile = { x: e.clientX, y: e.clientY, liste: pile, i: Math.max(0, pile.indexOf(cible)) };
  }
  if (choisi !== ED.sel) edSelectionner(choisi);
  edCommencerGlisse(e);
  if (ED.glisse && auClic && auClic !== ED.sel) ED.glisse.auClic = auClic;
}
function edCommencerGlisse(e) {
  if (!ED.sel || ED.sel === ED.sec) return;
  const t = edTranslation(ED.sel);
  ED.glisse = { x0: e.clientX, y0: e.clientY, dx0: t.x, dy0: t.y, bouge: false };
  ED.doc.addEventListener("mouseup", edLacher, { once: true });
}
// Le point (en pixels de la page de la slide) tombe-t-il dans le cadre montré de cet élément ?
function edDansCadre(el, x, y) {
  const c = edCadreVu(el), s = ED.sec.getBoundingClientRect();
  const [lx, ly] = edTourne(x - s.left - c.cx, y - s.top - c.cy, -c.angle);
  return Math.abs(lx) <= c.w / 2 && Math.abs(ly) <= c.h / 2;
}
function edTranslation(el) {
  const m = /^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(el.style.translate || "");
  return { x: m ? parseFloat(m[1]) : 0, y: m && m[2] ? parseFloat(m[2]) : 0 };
}
// Une boîte « en ligne » (un <span>) n'accepte ni déplacement, ni largeur, ni rotation : on en fait un bloc en ligne.
function edRendreBloc(el) {
  if (ED.win.getComputedStyle(el).display === "inline") el.style.display = "inline-block";
}
/* ---------- Le calque : cadre de sélection, poignées, repères ---------- */

const ED_POIGNEES = [["nw", 0, 0], ["n", .5, 0], ["ne", 1, 0], ["e", 1, .5],
                     ["se", 1, 1], ["s", .5, 1], ["sw", 0, 1], ["w", 0, .5]];

function edBoiteSlide(el) {
  const b = el.getBoundingClientRect(), s = ED.sec.getBoundingClientRect();
  return { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height };
}

const ED_SENS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/* Le cadre suit l'élément tel qu'on le voit : tourné avec lui. Les poignées sont ses
   enfants et tournent donc aussi ; leur curseur suit l'angle. La poignée ronde, elle,
   se pose hors du cadre, du premier côté qui reste DANS la slide — une image de 1300px
   qui déborde partout aurait sinon sa poignée hors de vue. */
function edMajUI() {
  const ui = ED.ui;
  if (!ui) return;
  ui.innerHTML = "";
  if (!ED.sel || ED.sel === ED.sec) return;
  if (ED.texte === ED.sel) { edPoigneeDeplacer(); return; }
  /* Une image pas encore chargée (juste après un Ctrl+Z, qui recrée la slide) ne dit pas
     encore ce qu'elle montre : on redessine le cadre dès qu'elle arrive. */
  if (ED.sel.tagName === "IMG" && !ED.sel.complete) { const el = ED.sel; el.addEventListener("load", () => { if (ED.sel === el) edMajUI(); }, { once: true }); }
  const g = edCadreVu(ED.sel);
  const cadre = ED.doc.createElement("div");
  cadre.className = "pged-cadre";
  cadre.style.cssText = "left:" + (g.cx - g.w / 2) + "px;top:" + (g.cy - g.h / 2) + "px;width:" + g.w + "px;height:" + g.h + "px;" +
    (g.angle ? "transform:rotate(" + g.angle + "deg)" : "");
  ui.appendChild(cadre);
  const cran = Math.round(g.angle / 45);
  // Une image détourée ne se redimensionne que par ses coins, en gardant ses proportions.
  ED_POIGNEES.filter(([nom]) => !(g.vis || edEstGroupe(ED.sel)) || nom.length === 2).forEach(([nom, fx, fy]) => {
    const p = ED.doc.createElement("div");
    p.className = "pged-p pged-p-" + nom;
    p.style.left = (fx * 100) + "%";
    p.style.top = (fy * 100) + "%";
    p.style.cursor = ED_SENS[(((ED_SENS.indexOf(nom) + cran) % 8) + 8) % 8] + "-resize";
    p.addEventListener("mousedown", ev => edPrendrePoignee(ev, nom));
    cadre.appendChild(p);
  });

  const k = 1 / (ED.echelle || 1), ecart = g.h / 2 + 40 * k, ecartL = g.w / 2 + 40 * k;
  const s = ED.sec.getBoundingClientRect(), marge = 16 * k;
  const dedans = ([x, y]) => x >= marge && y >= marge && x <= s.width - marge && y <= s.height - marge;
  const essais = [[0, -ecart], [0, ecart], [ecartL, 0], [-ecartL, 0]].map(([x, y]) => { const [a, b] = edTourne(x, y, g.angle); return [g.cx + a, g.cy + b]; });
  let pos = essais.find(dedans);
  if (!pos) pos = [Math.min(s.width - marge, Math.max(marge, essais[0][0])), Math.min(s.height - marge, Math.max(marge, essais[0][1]))];
  const r = ED.doc.createElement("div");
  r.className = "pged-r";
  r.title = "Tourner (Maj : par pas de 15°, Alt : sans aimant)";
  r.textContent = "↻";
  r.style.left = pos[0] + "px"; r.style.top = pos[1] + "px";
  r.addEventListener("mousedown", edPrendreRotation);
  ui.appendChild(r);
}

/* ---------- En mode texte, on déplace encore ----------
   Dans le texte, presser et glisser sélectionne des lettres : c'est ce qu'on attend quand on
   écrit, mais le bloc devenait impossible à déplacer à la souris sans d'abord savoir qu'Échap
   fait sortir. Une poignée ✥, posée hors du bloc comme la poignée ronde, le glisse sans
   quitter le texte. */
function edPoigneeDeplacer() {
  const g = edCadreVu(ED.sel), k = 1 / (ED.echelle || 1);
  const s = ED.sec.getBoundingClientRect(), marge = 22 * k, ecart = g.h / 2 + 34 * k, ecartL = g.w / 2 + 34 * k;
  const dedans = ([x, y]) => x >= marge && y >= marge && x <= s.width - marge && y <= s.height - marge;
  const essais = [[0, ecart], [0, -ecart], [-ecartL, 0], [ecartL, 0]].map(([x, y]) => { const [a, b] = edTourne(x, y, g.angle); return [g.cx + a, g.cy + b]; });
  let pos = essais.find(dedans);
  if (!pos) pos = [Math.min(s.width - marge, Math.max(marge, essais[0][0])), Math.min(s.height - marge, Math.max(marge, essais[0][1]))];
  const m = ED.doc.createElement("div");
  m.className = "pged-r pged-m";
  m.title = "Glisser pour déplacer le bloc (sans quitter le texte)";
  m.textContent = "✥";
  m.style.left = pos[0] + "px"; m.style.top = pos[1] + "px";
  m.addEventListener("mousedown", ev => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    ED.doc.documentElement.style.cursor = "grabbing";
    edCommencerGlisse(ev);
    ED.doc.addEventListener("mouseup", () => ED.doc.documentElement.style.removeProperty("cursor"), { once: true });
  });
  ED.ui.appendChild(m);
}

/* ---------- Tourner à la souris ----------
   On tourne autour du centre de l'élément (l'origine par défaut de la rotation CSS),
   qui ne bouge donc pas pendant le geste. L'angle s'écrit dans la propriété rotate —
   celle que règle aussi le champ « Rotation ° » du panneau. Il s'aimante sur les
   multiples de 45° ; Maj tourne par pas de 15°, Alt coupe l'aimant. */

function edPrendreRotation(e) {
  if (e.button !== 0 || !ED.sel || ED.sel === ED.sec) return;
  e.preventDefault(); e.stopPropagation();
  edAvant("rotation-" + Date.now());
  edRendreBloc(ED.sel);
  const g = edGeo(ED.sel), s = ED.sec.getBoundingClientRect();
  const cx = s.left + g.cx, cy = s.top + g.cy;
  ED.rotation = { cx: cx, cy: cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), r0: edDeg(ED.sel.style.rotate), autres: g.angle - edDeg(ED.sel.style.rotate) };
  ED.doc.documentElement.style.cursor = "grabbing";
  ED.doc.addEventListener("mouseup", edLacherRotation, { once: true });
}
function edTourner(e) {
  const t = ED.rotation;
  let a = t.r0 + (Math.atan2(e.clientY - t.cy, e.clientX - t.cx) - t.a0) * 180 / Math.PI;
  a = ((a + 180) % 360 + 360) % 360 - 180;
  // L'aimant porte sur l'angle VU : un bloc déjà penché par Claude se redresse aussi.
  const vu = a + t.autres;
  if (e.shiftKey) a = Math.round(vu / 15) * 15 - t.autres;
  else if (!e.altKey) { const c = Math.round(vu / 45) * 45; if (Math.abs(c - vu) < 3) a = c - t.autres; }
  a = Math.round(a * 10) / 10;
  if (Math.abs(a) < .05) ED.sel.style.removeProperty("rotate"); else ED.sel.style.rotate = a + "deg";
  edMajUI();
  const b = ED.doc.createElement("div");
  b.className = "pged-angle";
  let vuFinal = ((Math.round((a + t.autres) * 10) / 10 + 180) % 360 + 360) % 360 - 180;
  b.textContent = (Math.round(vuFinal * 10) / 10) + "°";
  const s = ED.sec.getBoundingClientRect();
  b.style.left = (e.clientX - s.left) + "px"; b.style.top = (e.clientY - s.top) + "px";
  ED.ui.appendChild(b);
}
function edLacherRotation() {
  ED.rotation = null;
  ED.doc.documentElement.style.removeProperty("cursor");
  edSale(); edMajUI(); edRendrePanneau();
}

/* ---------- Le miroir ----------
   Il retourne l'élément (image, texte, forme) par la propriété scale, qui se compose
   avec rotate et transform sans les écraser. Un second clic le remet à l'endroit. */
function edMiroir(axe) {
  const el = ED.sel;
  if (!el || el === ED.sec) return;
  edAvant("miroir-" + Date.now());
  edRendreBloc(el);
  let [sx, sy] = edEchelleProp(ED.win.getComputedStyle(el).scale);
  if (axe === "h") sx = -sx; else sy = -sy;
  if (sx === 1 && sy === 1) el.style.removeProperty("scale"); else el.style.scale = sx + " " + sy;
  edSale(); edMajUI(); edRendrePanneau();
}

function edRepères(lignes) {
  const ui = ED.ui;
  if (!ui) return;
  [].slice.call(ui.querySelectorAll(".pged-g")).forEach(g => g.remove());
  lignes.forEach(([sens, v]) => {
    const g = ED.doc.createElement("div");
    g.className = "pged-g pged-" + sens;
    if (sens === "v") g.style.left = v + "px"; else g.style.top = v + "px";
    ui.appendChild(g);
  });
}

/* Les valeurs où un bord s'aimante : les bords et le centre de la slide, sa marge
   de sécurité, et les bords et centres des autres éléments visibles. */
function edAimants() {
  const s = ED.sec.getBoundingClientRect();
  const W = s.width, H = s.height, M = Math.round(W * 0.0833);   // 90px sur 1080
  const vx = [0, M, W / 2, W - M, W], vy = [0, M, H / 2, H - M, H];
  [].slice.call(ED.sec.querySelectorAll("*")).forEach(el => {
    if (el === ED.sel || ED.sel.contains(el) || el.contains(ED.sel)) return;
    // Une image détourée aimante par ce qu'elle montre, pas par sa boîte transparente.
    const b = edBoiteVue(el);
    if (b.w < 4 || b.h < 4) return;
    vx.push(b.x, b.x + b.w / 2, b.x + b.w);
    vy.push(b.y, b.y + b.h / 2, b.y + b.h);
  });
  return { x: vx, y: vy };
}
// Le décalage à ajouter pour que l'un des trois bords tombe sur un aimant.
function edColler(bords, valeurs) {
  let mieux = null;
  bords.forEach(b => valeurs.forEach(v => {
    const d = v - b;
    if (Math.abs(d) <= ED_AIMANT && (!mieux || Math.abs(d) < Math.abs(mieux.d))) mieux = { d: d, v: v };
  }));
  return mieux;
}

function edGlisser(e) {
  const g = ED.glisse;
  /* Une iframe réduite par transform:scale rend ses événements dans SES pixels à elle, pas
     dans ceux de l'écran : le delta est déjà en pixels de slide. Le diviser par l'échelle
     multipliait chaque déplacement par quatre. */
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.bouge) {
    if (Math.abs(dx) + Math.abs(dy) < 4) return;                // un clic n'est pas un déplacement
    g.bouge = true;
    edAvant("deplacer-" + Date.now());
    edRendreBloc(ED.sel);
    g.depart = edBoiteVue(ED.sel);
    g.aimants = edAimants();
    const geo = edGeo(ED.sel);
    g.anc = Math.abs(geo.anc) > .01 ? geo.anc : 0; g.echAnc = geo.echAnc;
  }
  // Maj : on reste sur un axe.
  let x = e.shiftKey && Math.abs(dy) > Math.abs(dx) ? 0 : dx;
  let y = e.shiftKey && Math.abs(dx) >= Math.abs(dy) ? 0 : dy;
  // Le magnétisme : les bords et le centre du bloc cherchent une ligne remarquable.
  const d = g.depart, reperes = [];
  if (!e.altKey) {
    const cx = edColler([d.x + x, d.x + d.w / 2 + x, d.x + d.w + x], g.aimants.x);
    const cy = edColler([d.y + y, d.y + d.h / 2 + y, d.y + d.h + y], g.aimants.y);
    if (cx) { x += cx.d; reperes.push(["v", cx.v]); }
    if (cy) { y += cy.d; reperes.push(["h", cy.v]); }
  }
  // Dans un parent tourné (la grille penchée de la slide 3), translate suit SES axes.
  if (g.anc) { const [a, b] = edTourne(x, y, -g.anc); x = a / (g.echAnc || 1); y = b / (g.echAnc || 1); }
  ED.sel.style.translate = Math.round(g.dx0 + x) + "px " + Math.round(g.dy0 + y) + "px";
  edMajUI();
  edRepères(reperes);
}

function edLacher() {
  const g = ED.glisse;
  ED.glisse = null;
  edRepères([]);
  if (g && g.bouge) { ED.finGlisse = Date.now(); edSale(); edMajUI(); edRendrePanneau(); }
  // Relâché sans avoir bougé, au même endroit que le clic d'avant : on descend d'un cran dans la pile.
  else if (g && g.auClic && edDansSlide(g.auClic)) {
    edSelectionner(g.auClic);
    if (ED.pile) ED.pile.i = ED.pile.liste.indexOf(g.auClic);
  }
}

/* ---------- Redimensionner ----------
   Une poignée de côté change la largeur ou la hauteur ; une poignée de coin change
   les deux, et sur un TEXTE elle change la taille de police avec — sans quoi on
   étirerait une boîte vide pendant que les lettres restent de la même taille. */

function edPrendrePoignee(e, nom) {
  if (e.button !== 0 || !ED.sel) return;
  e.preventDefault();
  e.stopPropagation();
  const b = edBoiteSlide(ED.sel);
  const s = ED.win.getComputedStyle(ED.sel);
  edAvant("taille-" + Date.now());
  edRendreBloc(ED.sel);
  /* Les images de slide portent max-width:100% (pageDeSlide) : une image plus large que la
     slide y est plafonnée à 1080 px, quelle que soit sa largeur écrite. Tirer une poignée ne
     faisait alors grandir que la hauteur. On lève le plafond en figeant la largeur RÉELLE :
     rien ne bouge à l'écran, mais la suite du geste est respectée. */
  if (ED.sel.tagName === "IMG" && ED.win.getComputedStyle(ED.sel).maxWidth !== "none") {
    ED.sel.style.width = ED.sel.offsetWidth + "px";
    ED.sel.style.maxWidth = "none";
  }
  ED.taille = {
    nom: nom, x0: e.clientX, y0: e.clientY, b: b,
    police: parseFloat(s.fontSize) || 0,
    // Le déplacement de DÉPART : recalculé à chaque mouvement, il s'accumulerait sur lui-même.
    t0: edTranslation(ED.sel),
    texte: !!edRectsTexte(ED.sel).length,
    aimants: edAimants(),
    geo: edGeo(ED.sel)
  };
  ED.taille.cadre = edCadreVu(ED.sel, ED.taille.geo);
  /* Un TEXTE ne prend plus une hauteur figée par les poignées du haut et du bas : plus courte que ses
     lignes, elle les laissait déborder du cadre (la dernière ligne semblait sortie de son bloc) ; on
     écrit une hauteur MINIMALE, jamais en dessous de ce que ses lignes demandent. */
  if (ED.taille.texte) {
    const st = ED.sel.style, h0 = st.height, m0 = st.minHeight;
    st.height = "auto"; st.minHeight = "0px";
    ED.taille.hTexte = ED.sel.offsetHeight;
    st.height = h0; st.minHeight = m0;
  }
  ED.taille.groupe = edEstGroupe(ED.sel);
  ED.taille.echelle0 = edEchelleProp(ED.win.getComputedStyle(ED.sel).scale);
  ED.doc.addEventListener("mouseup", edLacherPoignee, { once: true });
}

function edRedimensionner(e) {
  if (ED.taille.groupe) { edRedimensionnerGroupe(e); return; }
  if (ED.taille.cadre.vis) { edRedimensionnerVisible(e); return; }
  if (!ED.taille.geo.droit) { edRedimensionnerTourne(e); return; }
  const t = ED.taille, b = t.b;
  const dx = e.clientX - t.x0, dy = e.clientY - t.y0;   // déjà en pixels de slide, voir edGlisser
  const gauche = /w$/.test(t.nom), droite = /e$/.test(t.nom);
  const haut = /^n/.test(t.nom), bas = /^s/.test(t.nom);
  const coin = t.nom.length === 2;

  let l = b.w + (droite ? dx : gauche ? -dx : 0);
  let h = b.h + (bas ? dy : haut ? -dy : 0);
  const reperes = [];
  if (!e.altKey) {
    if (droite) { const c = edColler([b.x + l], t.aimants.x); if (c) { l += c.d; reperes.push(["v", c.v]); } }
    if (gauche) { const c = edColler([b.x + b.w - l], t.aimants.x); if (c) { l -= c.d; reperes.push(["v", c.v]); } }
    if (bas) { const c = edColler([b.y + h], t.aimants.y); if (c) { h += c.d; reperes.push(["h", c.v]); } }
    if (haut) { const c = edColler([b.y + b.h - h], t.aimants.y); if (c) { h -= c.d; reperes.push(["h", c.v]); } }
  }
  l = Math.max(16, Math.round(l));
  h = Math.max(t.texte && !coin ? t.hTexte || 16 : 16, Math.round(h));

  if (droite || gauche) ED.sel.style.width = l + "px";
  if ((bas || haut) && !(coin && t.texte)) edHauteur(h, t.texte);
  // Un coin sur du texte : la police suit la largeur, les lettres grandissent pour de vrai.
  if (coin && t.texte && t.police && b.w > 0) {
    ED.sel.style.fontSize = Math.max(8, Math.round(t.police * (l / b.w))) + "px";
    ED.sel.style.removeProperty("height");
  }
  // Une poignée qui tire vers la gauche ou vers le haut déplace aussi le bloc.
  const nx = t.t0.x + (gauche ? b.w - l : 0);
  const ny = t.t0.y + (haut && !(coin && t.texte) ? b.h - h : 0);
  ED.sel.style.translate = Math.round(nx) + "px " + Math.round(ny) + "px";
  edMajUI();
  edRepères(reperes);
}

/* Un élément tourné : la souris est ramenée dans SON repère, et le bord opposé à la
   poignée reste où il est. La mise en page, elle, agrandit la boîte depuis son coin haut
   gauche NON tourné : on corrige par le déplacement la différence entre ce centre-là et
   celui qu'on veut. Pas d'aimant ici : les repères sont droits, le bloc ne l'est pas. */
function edRedimensionnerTourne(e) {
  const t = ED.taille, g = t.geo;
  const [dxl, dyl] = edTourne(e.clientX - t.x0, e.clientY - t.y0, -g.angle);
  const gauche = /w$/.test(t.nom), droite = /e$/.test(t.nom);
  const haut = /^n/.test(t.nom), bas = /^s/.test(t.nom);
  const coin = t.nom.length === 2, police = coin && t.texte;
  const k = g.k || 1, w0 = g.lw, h0 = g.lh;
  const l = Math.max(16, Math.round(w0 + (droite ? dxl : gauche ? -dxl : 0) / (k * Math.abs(g.sx || 1))));
  const h = Math.max(t.texte && !police ? t.hTexte || 16 : 16, Math.round(h0 + (bas ? dyl : haut ? -dyl : 0) / (k * Math.abs(g.sy || 1))));
  if (droite || gauche) ED.sel.style.width = l + "px";
  if ((bas || haut) && !police) edHauteur(h, t.texte);
  if (police && t.police && w0 > 0) {
    ED.sel.style.fontSize = Math.max(8, Math.round(t.police * (l / w0))) + "px";
    ED.sel.style.removeProperty("height");
  }
  const dW = (droite || gauche) ? l - w0 : 0, dH = (bas || haut) && !police ? h - h0 : 0;
  // Le glissement voulu du centre, dans le repère du parent (miroir et échelle propres compris).
  const [vx, vy] = edTourne((droite ? 1 : gauche ? -1 : 0) * dW / 2 * Math.abs(g.sx || 1), (bas ? 1 : haut ? -1 : 0) * dH / 2 * Math.abs(g.sy || 1), g.propre);
  ED.sel.style.translate = Math.round(t.t0.x + vx - dW / 2) + "px " + Math.round(t.t0.y + vy - dH / 2) + "px";
  edMajUI();
}

/* Une image détourée, tirée par un coin de SON cadre (celui du sujet) : elle grandit en
   gardant ses proportions, et le coin opposé du sujet reste exactement où il est. La boîte
   de l'image grandit d'autant, depuis son coin haut gauche : translate rattrape l'écart. */
// Tiré par un coin de son cadre : le facteur d'agrandissement, et le coin opposé qui reste fixe.
function edFacteurCoin(e) {
  const t = ED.taille, c = t.cadre;
  const [fx, fy] = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[t.nom];
  const [qx, qy] = edTourne(fx * c.w / 2, fy * c.h / 2, c.angle);
  const P = [c.cx - qx, c.cy - qy];                              // le coin qui ne bouge pas
  const vx = 2 * qx, vy = 2 * qy;                                // de ce coin au coin tiré
  const mx = vx + (e.clientX - t.x0), my = vy + (e.clientY - t.y0);
  const f = (mx * vx + my * vy) / (vx * vx + vy * vy);
  return { f: Math.max(16 / Math.max(1, Math.min(c.w, c.h)), f), P: P };
}
// Le déplacement du centre qui garde P fixe, ramené dans le repère du parent (pour translate).
function edGlissementCentre(P, f) {
  const g = ED.taille.geo;
  let dx = P[0] + f * (g.cx - P[0]) - g.cx, dy = P[1] + f * (g.cy - P[1]) - g.cy;
  if (Math.abs(g.anc) > .01) [dx, dy] = edTourne(dx, dy, -g.anc);
  return [dx / (g.echAnc || 1), dy / (g.echAnc || 1)];
}

/* Un GROUPE, tiré par un coin : tout ce qu'il contient grandit ensemble — textes compris —
   par la propriété scale (celle du miroir, dont le signe est gardé). Élargir sa boîte n'aurait
   rien agrandi : les lettres gardaient leur taille et se replaçaient autrement. Le coin opposé
   reste fixe ; scale agit autour du centre, sans changer la mise en page. */
function edRedimensionnerGroupe(e) {
  const t = ED.taille, { f, P } = edFacteurCoin(e);
  const [sx, sy] = t.echelle0, r = v => Math.round(v * 1000) / 1000;
  const nx = r(sx * f), ny = r(sy * f);
  if (nx === 1 && ny === 1) ED.sel.style.removeProperty("scale"); else ED.sel.style.scale = nx + " " + ny;
  const [dx, dy] = edGlissementCentre(P, f);
  ED.sel.style.translate = Math.round(t.t0.x + dx) + "px " + Math.round(t.t0.y + dy) + "px";
  edMajUI();
}

function edRedimensionnerVisible(e) {
  const t = ED.taille, g = t.geo, { f, P } = edFacteurCoin(e);
  const l = g.lw * f, h = g.lh * f;
  ED.sel.style.width = Math.round(l * 10) / 10 + "px";
  ED.sel.style.height = Math.round(h * 10) / 10 + "px";
  // Le centre de l'élément va en P + f × (C − P) ; translate compense la croissance depuis le coin haut gauche.
  const [dx, dy] = edGlissementCentre(P, f);
  ED.sel.style.translate = Math.round(t.t0.x + dx - (l - g.lw) / 2) + "px " + Math.round(t.t0.y + dy - (h - g.lh) / 2) + "px";
  edMajUI();
}

// La hauteur tirée à la poignée : figée pour une forme ou une image, minimale pour un texte.
function edHauteur(h, texte) {
  if (texte) { ED.sel.style.removeProperty("height"); ED.sel.style.minHeight = h + "px"; }
  else ED.sel.style.height = h + "px";
}
function edLacherPoignee() {
  ED.taille = null;
  edRepères([]);
  edSale(); edMajUI(); edRendrePanneau();
}

/* ---------- Le texte ---------- */

function edDoubleClic(e) {
  if (!edDansSlide(e.target) || e.target === ED.sec) return;
  /* Cliquer pour sélectionner, puis presser aussitôt pour glisser : le navigateur compte ces deux
     clics comme un DOUBLE-CLIC, à la fin du glissé, et l'on se retrouvait dans le texte sans l'avoir
     voulu — le glissé suivant sélectionnait des lettres au lieu de déplacer le bloc (27 septembre 2026). Un double-clic qui suit un déplacement n'est donc pas une entrée. */
  if (Date.now() - (ED.finGlisse || 0) < 700) return;
  // On édite l'élément qui PORTE le texte cliqué.
  let el = e.target;
  if (![...el.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())) return;
  edAvant("texte-" + Date.now());
  edSelectionner(el);
  ED.texte = el;
  /* Claude met des retours à la ligne dans son HTML pour l'aérer. Ils ne se voient pas
     (white-space:normal les réduit à une espace), mais si on les laissait, edFigerRetours
     les prendrait pour des coupures voulues et les figerait en <br>. On les aplatit avant
     d'entrer : tout \n encore là en sortant vient forcément d'une touche Entrée. */
  const marche = ED.doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let t;
  while ((t = marche.nextNode())) if (/[\r\n]/.test(t.textContent)) t.textContent = t.textContent.replace(/[\r\n]+/g, " ");
  el.removeAttribute("data-pg-sel");
  el.setAttribute("contenteditable", "plaintext-only");
  el.setAttribute("spellcheck", "false");
  el.focus();
  edMajUI();                       // le cadre à poignées laisse place à la poignée de déplacement
  edRendrePanneau();
}
/* Les retours à la ligne tapés pendant l'édition ne survivent pas seuls.

   Entrée, dans un contenteditable "plaintext-only", insère un simple caractère \n.
   Le navigateur passe l'élément en white-space:pre-wrap tant qu'on l'édite, si bien
   que la coupure se voit ; dès qu'on en sort, on revient à white-space:normal et le
   \n se réduit à une espace. Mesuré le 21 septembre 2026 : 45px de haut en édition,
   22px après. On fige donc chaque \n en <br>, qui, lui, tient dans le HTML enregistré. */
function edFigerRetours(el) {
  const textes = [];
  const marche = ED.doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let n;
  while ((n = marche.nextNode())) if (n.textContent.indexOf("\n") >= 0) textes.push(n);
  if (!textes.length) return false;
  textes.forEach((t, k) => {
    let contenu = t.textContent;
    /* Le navigateur ajoute un \n de plus à la toute fin pour rendre la dernière coupure
       visible : le garder ferait une ligne vide de trop une fois l'édition terminée. */
    if (k === textes.length - 1 && /\n\n$/.test(contenu)) contenu = contenu.slice(0, -1);
    const morceaux = contenu.split("\n");
    const bloc = ED.doc.createDocumentFragment();
    morceaux.forEach((m, i) => {
      if (i) bloc.appendChild(ED.doc.createElement("br"));
      if (m) bloc.appendChild(ED.doc.createTextNode(m));
    });
    t.replaceWith(bloc);
  });
  return true;
}

/* Les espaces tapées à la barre subissent le même sort que les retours : en édition
   (pre-wrap) elles se voient toutes ; dès qu'on sort (white-space:normal), plusieurs
   espaces n'en font plus qu'une, et celles d'un début ou d'une fin de ligne disparaissent
   — « battle<br>   zone » revenait à « battle<br>zone ». On les fige en espaces
   insécables ; au milieu d'une suite, la dernière reste normale pour que la ligne
   puisse encore se couper là. */
const ED_INSECABLE = String.fromCharCode(160);
function edFigerEspaces(el) {
  let change = false;
  const marche = ED.doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let n;
  while ((n = marche.nextNode())) {
    const t = n.textContent;
    const neuf = t.replace(/ +/g, (run, i) => {
      const bord = i === 0 || i + run.length === t.length;
      if (bord) return run.length === 1 && !(i === 0 && edDebutDeLigne(n)) && !(i + run.length === t.length && edFinDeLigne(n)) ? run : ED_INSECABLE.repeat(run.length);
      return run.length === 1 ? run : ED_INSECABLE.repeat(run.length - 1) + " ";
    });
    if (neuf !== t) { n.textContent = neuf; change = true; }
  }
  return change;
}
// Rien de visible avant ce texte sur sa ligne : le début de l'élément, ou un <br>.
function edDebutDeLigne(n) {
  for (let x = n; x && x !== ED.texte; x = x.parentNode) {
    let p = x.previousSibling;
    while (p && p.nodeType === 3 && !p.textContent.length) p = p.previousSibling;
    if (p) return p.nodeName === "BR";
  }
  return true;
}
function edFinDeLigne(n) {
  for (let x = n; x && x !== ED.texte; x = x.parentNode) {
    let p = x.nextSibling;
    while (p && p.nodeType === 3 && !p.textContent.length) p = p.nextSibling;
    if (p) return p.nodeName === "BR";
  }
  return true;
}

function edFinTexte() {
  const el = ED.texte;
  if (!el) return;
  if (edFigerRetours(el)) edSale();
  if (edFigerEspaces(el)) edSale();
  ED.texte = null;
  el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck");
  if (ED.sel === el) el.setAttribute("data-pg-sel", "");
  edMajUIBientot();                // le cadre à poignées revient (les lignes ont pu changer)
}

/* ---------- Le clavier ---------- */

function edTouche(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === "z") { if (!ED.texte) { e.preventDefault(); edAnnuler(); } return; }
  if (ctrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { if (!ED.texte) { e.preventDefault(); edRetablir(); } return; }
  if (e.key === "Escape") {
    e.preventDefault();
    if (ED.texte) { edFinTexte(); edRendrePanneau(); } else if (ED.sel) edSelectionner(null); else if (typeof pgFermerLoupe === "function") pgFermerLoupeDemande();
    return;
  }
  if (ED.texte || !ED.sel || ED.sel === ED.sec) return;
  const pas = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key];
  if (d) {
    e.preventDefault();
    edAvant("fleches");
    edRendreBloc(ED.sel);
    const t = edTranslation(ED.sel);
    ED.sel.style.translate = (t.x + d[0]) + "px " + (t.y + d[1]) + "px";
    edSale();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); edSupprimer(); }
}

/* ---------- Annuler, rétablir ---------- */

function edInstantane() {
  const c = ED.sec.cloneNode(true);
  c.querySelectorAll("*").forEach(x => ED_ATTRS.forEach(a => x.removeAttribute(a)));
  ED_ATTRS.forEach(a => c.removeAttribute(a));
  return c.outerHTML;
}
/* À appeler AVANT un changement. Les réglages d'un même geste (un curseur qu'on
   traîne, des flèches qu'on répète) ne font qu'une seule marche arrière. */
function edAvant(geste) {
  const t = Date.now();
  if (geste && geste === ED.dernierGeste && t - ED.dernierTemps < 900) { ED.dernierTemps = t; return; }
  ED.dernierGeste = geste || ""; ED.dernierTemps = t;
  ED.annuler.push(edInstantane());
  if (ED.annuler.length > 60) ED.annuler.shift();
  ED.retablir = [];
}
function edRemettre(html) {
  const gabarit = ED.doc.createElement("template");
  gabarit.innerHTML = html;
  const neuf = gabarit.content.firstElementChild;
  if (!neuf) return;
  ED.sec.replaceWith(neuf);
  ED.sec = neuf; ED.sel = null; ED.texte = null; ED.dernierGeste = ""; ED.pile = null;
  edSale();
  edMajUI();
  edRendrePanneau();
}
// Le chemin d'un élément dans la slide (les rangs depuis la section), pour le retrouver après une annulation.
function edChemin(el) {
  const ch = [];
  for (let x = el; x && x !== ED.sec && x.parentElement; x = x.parentElement) ch.unshift([...x.parentElement.children].indexOf(x));
  return ch;
}
function edDepuisChemin(ch) {
  let x = ED.sec;
  for (const i of ch || []) { x = x && x.children[i]; if (!x) return null; }
  return x;
}
function edAnnuler() { if (!ED.annuler.length) return; ED.retablir.push(edInstantane()); edRemettre(ED.annuler.pop()); }
function edRetablir() { if (!ED.retablir.length) return; ED.annuler.push(edInstantane()); edRemettre(ED.retablir.pop()); }

function edSale() {
  ED.modifie = true;
  const b = $("pg-loupe-enregistrer");
  if (b) { b.disabled = false; b.textContent = "Enregistrer les modifications"; }
}
// Le HTML à enregistrer : la slide, sans les repères de l'éditeur.
function edHtmlPropre() { edFinTexte(); return ED.sec ? edInstantane() : ""; }

/* ---------- Les actions sur l'élément ---------- */

/* ---------- Styler UN MOT plutôt que tout le bloc ----------

   Le panneau écrivait toujours sur l'élément entier : on sélectionnait « GOLOSA »
   dans un bouton, on cliquait une couleur, et c'est tout le bouton qui changeait.
   Quand une partie du texte est sélectionnée, les réglages de CARACTÈRE s'appliquent
   maintenant à elle seule, enveloppée dans un <span> — comme dans un traitement de
   texte. Les réglages de BOÎTE (largeur, marge, arrondi, place, opacité, alignement,
   interligne) restent sur l'élément : ils n'ont pas de sens sur trois lettres. */

const ED_PROPS_MOT = ["color", "font-size", "font-weight", "letter-spacing",
                      "text-transform", "font-style", "text-decoration", "background", "font-family"];

/* ---------- LA POLICE D'UN TEXTE ----------
   Les polices proposées sont celles du studio (PG.polices, les mêmes que pour une DA), celles de la DA en
   tête. Choisir une police qui n'est pas celle de la DA : la page de la slide ne l'a pas chargée, on lui
   ajoute donc le lien Google Fonts — et le serveur, lui, la chargera désormais à chaque affichage et à
   l'export, puisqu'elle figure dans le HTML (pageDeSlide). */
const ED_POLICES_SERIF = ["Playfair Display", "DM Serif Display", "Fraunces", "Cormorant Garamond", "Lora"];
const ED_POLICES_MAIN = ["Caveat", "Permanent Marker"];
const edPileDePolice = f => ED_POLICES_SERIF.includes(f) ? '"' + f + '", serif' : ED_POLICES_MAIN.includes(f) ? '"' + f + '", cursive'
  : typeof bpPile === "function" ? bpPile(f) : '"' + f + '", sans-serif';
// Ce que la police possède (PG.policesInfo, envoyé par le serveur) ; une police inconnue garde les réglages d'avant.
const edInfoPolice = f => ((typeof PG !== "undefined" && PG.policesInfo) || {})[f] || { graisses: [400, 500, 600, 700, 800], italique: true, inconnue: true };
const ED_NOMS_GRAISSE = { 100: "Ultra-fin", 200: "Extra-fin", 300: "Fin", 400: "Normal", 500: "Moyen", 600: "Demi-gras", 700: "Gras", 800: "Très gras", 900: "Noir" };
const edGraisseProche = (g, liste) => liste.reduce((a, b) => Math.abs(b - g) < Math.abs(a - g) ? b : a, liste[0]);
// Le lien Google, qui ne demande que les graisses et l'italique existants (le même calcul que familleGoogle, côté serveur).
function edFamilleGoogle(f) {
  const i = edInfoPolice(f), nom = "family=" + encodeURIComponent(f).replace(/%20/g, "+");
  if (i.graisses.length === 1 && !i.italique) return nom;
  if (i.graisses.length === 1) return nom + ":ital@0;1";
  if (!i.italique) return nom + ":wght@" + i.graisses.join(";");
  return nom + ":ital,wght@" + i.graisses.map(g => "0," + g).concat(i.graisses.map(g => "1," + g)).join(";");
}
function edChargerPolice(f) {
  if (!ED.doc || !f) return;
  const id = "pg-ed-police-" + f.replace(/\W+/g, "-");
  if (ED.doc.getElementById(id)) return;
  if (edInfoPolice(f).locale) { poserPolicesLocales(ED.doc, id, [f], { [f]: edInfoPolice(f) }); return; }   // une police de l'ordinateur
  const l = ED.doc.createElement("link");
  l.id = id; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?" + edFamilleGoogle(f) + "&display=swap";
  ED.doc.head.appendChild(l);
}
// La première police réellement nommée dans une pile CSS (« "Inter", sans-serif » → Inter).
const edPremierePolice = pile => String(pile || "").split(",")[0].trim().replace(/^["']|["']$/g, "");

// La sélection en cours, si elle ne couvre qu'une PARTIE du texte de l'élément.
function edSelectionMot() {
  if (!ED.sel) return null;
  const s = ED.win.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0);
  if (r.collapsed || !String(r).trim()) return null;
  if (!ED.sel.contains(r.commonAncestorContainer)) return null;
  // Tout le texte sélectionné : autant styler l'élément, ça évite un <span> inutile.
  const tout = ED.doc.createRange();
  tout.selectNodeContents(ED.sel);
  if (String(r).trim() === String(tout).trim()) return null;
  return r;
}

/* Le <span> de l'éditeur que cette sélection couvre EXACTEMENT, s'il existe déjà.
   Deux formes à reconnaître : la sélection peut porter sur le TEXTE (quand elle vient
   de la souris) ou sur le CONTENU DU SPAN lui-même (quand c'est nous qui l'avons
   reposée après un premier réglage). Ne reconnaître que la première imbriquait un
   span de plus à chaque réglage enchaîné sur le même mot. */
function edSpanDuMot(r) {
  const n = r.startContainer;
  if (n !== r.endContainer) return null;
  if (n.nodeType === 1) {
    return n !== ED.sel && n.hasAttribute && n.hasAttribute("data-pg-mot") &&
           r.startOffset === 0 && r.endOffset === n.childNodes.length ? n : null;
  }
  if (n.nodeType !== 3) return null;
  if (r.startOffset !== 0 || r.endOffset !== n.textContent.length) return null;
  const p = n.parentElement;
  return p && p !== ED.sel && p.hasAttribute("data-pg-mot") && p.childNodes.length === 1 ? p : null;
}

function edStylerMot(prop, valeur, geste, r) {
  edAvant(geste || prop);
  /* Sans réemploi, chaque clic sur une pastille empilerait un <span> de plus
     autour du même mot : trois couleurs d'affilée, trois niveaux d'imbrication. */
  let span = edSpanDuMot(r);
  if (!span) {
    span = ED.doc.createElement("span");
    span.setAttribute("data-pg-mot", "");
    try { r.surroundContents(span); }
    catch (e) { span.appendChild(r.extractContents()); r.insertNode(span); }
  }
  if (valeur === "" || valeur == null) span.style.removeProperty(prop); else span.style.setProperty(prop, valeur);
  // Le mot reste sélectionné : on enchaîne la couleur, la taille, la graisse.
  const neuf = ED.doc.createRange();
  neuf.selectNodeContents(span);
  const s = ED.win.getSelection();
  s.removeAllRanges(); s.addRange(neuf);
  edSale();
  edMajUIBientot();
}

function edStyle(prop, valeur, geste) {
  if (!ED.sel) return;
  if (ED_PROPS_MOT.indexOf(prop) >= 0) {
    const r = edSelectionMot();
    if (r) { edStylerMot(prop, valeur, geste, r); return; }
  }
  edAvant(geste || prop);
  if (valeur === "" || valeur == null) ED.sel.style.removeProperty(prop); else ED.sel.style.setProperty(prop, valeur);
  edSale();
  /* Le cadre suit : un décalage, une largeur, une taille tapés dans le panneau déplaçaient l'élément
     et laissaient le cadre orange à son ancienne place (27 septembre 2026). */
  edMajUIBientot();
}
let edMajUIPrevue = false;
function edMajUIBientot() {
  if (edMajUIPrevue || !ED.win) return;
  edMajUIPrevue = true;
  enPeinture(() => { edMajUIPrevue = false; if (!ED.glisse && !ED.taille && !ED.rotation) edMajUI(); }, ED.win);
}
function edSupprimer() {
  if (!ED.sel || ED.sel === ED.sec) return;
  edAvant("supprimer-" + Date.now());
  const parent = ED.sel.parentElement;
  ED.sel.remove();
  edSale();
  edSelectionner(parent && parent !== ED.sec ? parent : null);
}
function edDupliquer() {
  if (!ED.sel || ED.sel === ED.sec) return;
  edAvant("dupliquer-" + Date.now());
  const c = ED.sel.cloneNode(true);
  ED_ATTRS.forEach(a => c.removeAttribute(a));
  edRendreBloc(ED.sel);
  const t = edTranslation(ED.sel), pos = ED.win.getComputedStyle(ED.sel).position;
  /* Un élément pris dans une grille ou dans le flux (les carrés de la slide 3) : sa copie,
     insérée juste après lui, prenait une case et décalait TOUTES les suivantes — on
     croyait en avoir dupliqué plusieurs. La copie sort donc du flux, posée exactement
     sur l'original ; rien d'autre ne bouge. */
  if (pos !== "absolute" && pos !== "fixed") {
    const o = ED.sel;
    Object.assign(c.style, { position: "absolute", left: o.offsetLeft + "px", top: o.offsetTop + "px",
      right: "auto", bottom: "auto", width: o.offsetWidth + "px", height: o.offsetHeight + "px",
      margin: "0", boxSizing: "border-box" });
  }
  ED.sel.after(c);
  edRendreBloc(c);
  c.style.translate = (t.x + 30) + "px " + (t.y + 30) + "px";
  edSale();
  edSelectionner(c);
}
/* ---------- Le panneau ---------- */

const edPx = v => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 10) / 10; };
function edHex(couleur) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(couleur || "");
  if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return null;
  return "#" + [m[1], m[2], m[3]].map(x => Number(x).toString(16).padStart(2, "0")).join("");
}
function edNomDe(el) {
  if (el === ED.sec) return "La slide (son fond)";
  const tag = el.tagName.toLowerCase();
  if (tag === "img") return "Image";
  const t = [...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent.trim()).join(" ").trim();
  if (t) return "Texte « " + t.slice(0, 28) + (t.length > 28 ? "…" : "") + " »";
  return el.children.length ? "Bloc (" + el.children.length + " élément" + (el.children.length > 1 ? "s" : "") + ")" : "Forme";
}

/* ============================================================
   LES CALQUES — la colonne de gauche de la loupe

   La slide peint ses éléments dans un ordre qu'on ne voyait nulle part : celui du
   HTML, corrigé par les z-index. La colonne le montre, du DESSUS (en haut) au
   DESSOUS (en bas), comme dans un outil de mise en page. Un clic sélectionne, le
   survol montre l'élément sur la slide, l'œil le masque (visibility:hidden, qui
   s'enregistre), et on GLISSE une ligne pour changer l'ordre.

   L'ordre vrai, pour des frères : d'abord les positionnés à z-index négatif, puis
   ceux du flux (static), puis les positionnés à z-index auto ou 0, puis les z-index
   positifs ; à égalité, l'ordre du HTML. Les enfants d'une grille ou d'un flex
   acceptent un z-index sans être positionnés.

   Réordonner écrit un z-index à CHAQUE frère (1, 2, 3… depuis le dessous) : la liste
   dit alors exactement ce que la slide peint. Un élément du flux n'accepte un
   z-index qu'une fois positionné ; on le passe en position:relative — sauf s'il
   contient lui-même des éléments positionnés, dont il deviendrait le repère et
   qui bougeraient : celui-là ne se déplace pas dans la liste.
   ============================================================ */

ED.calquesOuverts = new WeakSet();
ED.calquesGlisse = null;

const edCalqueVisible = el => el.nodeType === 1 && !/^(BR|STYLE|SCRIPT|TEMPLATE|WBR)$/.test(el.tagName) && !el.hasAttribute("data-pg-mot");
// Un conteneur pur : des enfants, pas de texte à lui. Un titre avec son <span> de point orange n'en est pas un.
const edEstGroupe = el => el.tagName !== "IMG" && [...el.children].some(edCalqueVisible) &&
  ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

function edPeutZ(el) {
  const cs = ED.win.getComputedStyle(el);
  if (cs.position !== "static") return true;
  const p = el.parentElement && ED.win.getComputedStyle(el.parentElement).display;
  return /flex|grid/.test(p || "");
}
// Les enfants d'un élément, du dessus au dessous.
function edEnfantsPile(parent) {
  return [...parent.children].filter(edCalqueVisible).map((el, i) => {
    const z = parseInt(ED.win.getComputedStyle(el).zIndex, 10), zz = isNaN(z) ? 0 : z;
    const palier = edPeutZ(el) ? (zz < 0 ? zz * 1000 - 500 : zz * 1000) : -250;
    return { el: el, palier: palier, i: i };
  }).sort((a, b) => (b.palier - a.palier) || (b.i - a.i)).map(x => x.el);
}

// Peut-il changer de place parmi ses frères ? Pas s'il est du flux ET sert de repère à des éléments positionnés.
const edMobileDansPile = el => edPeutZ(el) || ![...el.querySelectorAll("*")].some(x => ED.win.getComputedStyle(x).position !== "static");
function edNomCalque(el) {
  if (el.tagName === "IMG") {
    const f = decodeURIComponent((el.getAttribute("src") || "").split("/").pop().split("?")[0] || "");
    return el.classList.contains("bg") ? "Image de fond" : "Image" + (f ? " · " + f.replace(/\.[a-z0-9]+$/i, "").slice(0, 14) : "");
  }
  // Un groupe se nomme par son texte s'il en a (« event 1 Check-ers ») : « Groupe · 2 éléments » ne dit rien.
  if (edEstGroupe(el) && !(el.innerText || "").trim()) return "Groupe · " + [...el.children].filter(edCalqueVisible).length + " éléments";
  // innerText et non textContent : un <br> y devient un espace (« Lola filiale », pas « Lolafiliale »).
  const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  if (t) return "« " + t.slice(0, 30) + (t.length > 30 ? "…" : "") + " »";
  // Une forme qui ne peint rien (les cases transparentes d'une grille) : le dire.
  const cs = ED.win.getComputedStyle(el);
  const peint = edRemplit(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== "none") || (parseFloat(cs.borderTopWidth) > 0 && edRemplit(cs.borderTopColor));
  if (peint) return "Forme";
  return edEstGrille(el.parentElement) ? "Case vide · tient la place" : "Forme vide";
}
function edVignette(el) {
  const v = document.createElement("span");
  v.className = "pg-ck-vig";
  if (el.tagName === "IMG") {
    const i = document.createElement("img"); i.src = el.currentSrc || el.src; i.alt = ""; v.appendChild(i);
    return v;
  }
  const cs = ED.win.getComputedStyle(el);
  if (edEstGroupe(el)) { v.textContent = "▦"; return v; }
  if ((el.textContent || "").trim()) {
    // Le T prend la couleur du texte, sur un fond qui le laisse lire (clair si le texte est sombre).
    v.textContent = "T"; v.style.color = cs.color;
    const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(cs.color);
    if (m && (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) < 110) v.style.background = "#e9e6e1";
    return v;
  }
  // Une forme : sa couleur, son arrondi.
  const peint = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : cs.backgroundColor;
  v.style.background = peint; v.style.borderRadius = parseFloat(cs.borderTopLeftRadius) > 20 ? "8px" : "4px";
  return v;
}
const ED_OEIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ED_OEIL_FERME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function edRendreCalques() {
  const box = $("pg-calques");
  if (!box) return;
  if (ED.calquesGlisse) return;                           // pas pendant qu'on glisse une ligne
  if (!ED.sec) { box.innerHTML = ""; return; }
  const y = box.scrollTop;
  box.innerHTML = "";
  const tete = document.createElement("div"); tete.className = "pg-ck-tete";
  tete.innerHTML = "<h3>Calques</h3>";
  box.appendChild(tete);
  const aide = document.createElement("p"); aide.className = "pg-ck-aide";
  aide.textContent = "Le haut de la liste passe devant. Glissez une ligne pour changer l'ordre.";
  box.appendChild(aide);

  // Les ancêtres de la sélection s'ouvrent d'eux-mêmes : on la voit toujours dans la liste.
  for (let x = ED.sel && ED.sel.parentElement; x && x !== ED.sec; x = x.parentElement) ED.calquesOuverts.add(x);

  const bord = t => { const d = document.createElement("div"); d.className = "pg-ck-bord"; d.textContent = t; box.appendChild(d); };
  bord("Devant");
  let n = 0;
  const ligne = (el, prof) => {
    n++;
    const cs = ED.win.getComputedStyle(el);
    const cache = cs.visibility === "hidden" || cs.display === "none";
    const groupe = edEstGroupe(el), ouvert = groupe && ED.calquesOuverts.has(el);
    const l = document.createElement("div");
    l.className = "pg-ck-ligne" + (el === ED.sel ? " on" : "") + (cache ? " cache" : "");
    l.style.paddingLeft = (6 + prof * 14) + "px";
    l.title = edNomDe(el);
    const chev = document.createElement(groupe ? "button" : "span");
    chev.className = "pg-ck-chev";
    if (groupe) {
      chev.type = "button"; chev.textContent = ouvert ? "▾" : "▸"; chev.title = ouvert ? "Replier" : "Déplier";
      chev.onclick = e => { e.stopPropagation(); if (ouvert) ED.calquesOuverts.delete(el); else ED.calquesOuverts.add(el); edRendreCalques(); };
    }
    l.appendChild(chev);
    l.appendChild(edVignette(el));
    const nom = document.createElement("span"); nom.className = "pg-ck-nom"; nom.textContent = edNomCalque(el);
    l.appendChild(nom);
    if (el.hasAttribute("data-decor")) { const t = document.createElement("span"); t.className = "pg-ck-tag"; t.textContent = "décor"; t.title = "Un ornement de fond : le contrôle de la mise en page ne le mesure pas"; l.appendChild(t); }
    const oeil = document.createElement("button");
    oeil.type = "button"; oeil.className = "pg-ck-oeil";
    oeil.innerHTML = cache ? ED_OEIL_FERME : ED_OEIL;
    oeil.title = cache ? "Afficher" : "Masquer";
    oeil.onclick = e => {
      e.stopPropagation();
      edAvant("oeil-" + Date.now());
      if (cache) { el.style.removeProperty("visibility"); if (ED.win.getComputedStyle(el).visibility === "hidden") el.style.visibility = "visible"; }
      else el.style.visibility = "hidden";
      edSale(); edMajUI(); edRendreCalques();
    };
    l.appendChild(oeil);

    l.onclick = () => { ED.pile = null; edSelectionner(el); };
    l.onmouseenter = () => {
      if (el === ED.sel) return;
      const c = el.tagName === "IMG" || edEstGroupe(el) ? edCadreVu(el) : null;
      edMarquer("data-pg-survol", c && (c.vis || c.groupe) ? null : el);
      edSurvolCadre(c && (c.vis || c.groupe) ? c : null);
    };
    l.onmouseleave = () => { edMarquer("data-pg-survol", null); edSurvolCadre(null); };

    /* Glisser pour réordonner parmi ses frères — ou pour le SORTIR de son groupe (le poser à côté d'une ligne d'un
       autre niveau), ou le faire entrer dans un autre groupe (27 sept. 2026). */
    const mobile = edMobileDansPile(el);
    l.draggable = true;
    if (!mobile) l.title += " — il sert de repère aux éléments qu'il contient : il ne change pas de place parmi ses frères, mais peut changer de groupe";
    l.ondragstart = e => { ED.calquesGlisse = el; l.classList.add("glisse"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", ""); } catch (x) {} };
    l.ondragend = () => { ED.calquesGlisse = null; edRendreCalques(); };
    // Où peut-on le poser ? À côté d'un frère (réordonner), ou à côté d'une ligne d'un autre groupe (changer de groupe).
    const posable = g => g && g !== el && !g.contains(el) &&
      (g.parentElement === el.parentElement ? edMobileDansPile(g) : (edDansSlide(el.parentElement) || el.parentElement === ED.sec));
    l.ondragover = e => {
      const g = ED.calquesGlisse;
      if (!posable(g)) return;
      e.preventDefault();
      const b = l.getBoundingClientRect(), haut = e.clientY < b.top + b.height / 2;
      box.querySelectorAll(".avant, .apres").forEach(x => x.classList.remove("avant", "apres"));
      l.classList.add(haut ? "avant" : "apres");
    };
    l.ondragleave = () => l.classList.remove("avant", "apres");
    l.ondrop = e => {
      const g = ED.calquesGlisse;
      if (!posable(g)) return;
      e.preventDefault();
      const b = l.getBoundingClientRect(), haut = e.clientY < b.top + b.height / 2;
      ED.calquesGlisse = null;
      if (g.parentElement === el.parentElement) {
        const ordre = edEnfantsPile(el.parentElement).filter(x => x !== g);
        ordre.splice(ordre.indexOf(el) + (haut ? 0 : 1), 0, g);
        edReordonner(ordre);
        return;
      }
      // Un autre groupe : il change de parent SANS bouger à l'écran, puis prend sa place dans la pile.
      edAvant("groupe-" + Date.now());
      const parent = el.parentElement;
      edChangerDeParent(g, parent, haut ? el.nextSibling : el);
      const ordre = edEnfantsPile(parent).filter(x => x !== g);
      ordre.splice(ordre.indexOf(el) + (haut ? 0 : 1), 0, g);
      edReordonner(ordre, true);
      edSelectionner(g);
    };
    box.appendChild(l);
    if (ouvert) {
      edEnfantsPile(el).forEach(x => ligne(x, prof + 1));
      if (edAUnFond(el)) ligneFond(el, prof + 1);
    }
  };
  /* LE FOND D'UN GROUPE. La couleur de fond d'un conteneur (l'orange de la grille, le papier d'une
     note) n'est pas un élément à part : c'est une propriété du groupe. Dépliée, la liste des enfants
     ne la montrait donc nulle part, alors que masquer le groupe la faisait disparaître (relevé le
     24 septembre 2026). Une ligne à elle, sous les enfants — c'est là qu'elle est peinte — la montre,
     sélectionne le groupe au clic, et la masque seule à l'œil. Masquée, la valeur d'avant est gardée
     dans data-fond-masque pour revenir telle quelle. */
  const ligneFond = (el, prof) => {
    const cs = ED.win.getComputedStyle(el), masque = el.hasAttribute("data-fond-masque");
    const l = document.createElement("div");
    l.className = "pg-ck-ligne pg-ck-fond" + (masque ? " cache" : "");
    l.style.paddingLeft = (6 + prof * 14) + "px";
    l.appendChild(document.createElement("span")).className = "pg-ck-chev";
    const v = document.createElement("span"); v.className = "pg-ck-vig";
    v.style.background = masque ? "repeating-conic-gradient(#3a3a40 0 25%, #26262b 0 50%) 50% / 8px 8px"
      : (cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : cs.backgroundColor);
    l.appendChild(v);
    const nom = document.createElement("span"); nom.className = "pg-ck-nom"; nom.textContent = "Fond du groupe";
    l.appendChild(nom);
    l.title = "La couleur de fond du groupe : elle se règle dans le panneau de droite, groupe sélectionné";
    const oeil = document.createElement("button");
    oeil.type = "button"; oeil.className = "pg-ck-oeil";
    oeil.innerHTML = masque ? ED_OEIL_FERME : ED_OEIL;
    oeil.title = masque ? "Afficher le fond" : "Masquer le fond seul";
    oeil.onclick = e => { e.stopPropagation(); edAvant("fond-groupe-" + Date.now()); edMasquerFond(el, !masque); edSale(); edRendreCalques(); };
    l.appendChild(oeil);
    l.onclick = () => { ED.pile = null; edSelectionner(el); };
    l.onmouseenter = () => { if (el !== ED.sel) edMarquer("data-pg-survol", el); };
    l.onmouseleave = () => edMarquer("data-pg-survol", null);
    box.appendChild(l);
  };
  edEnfantsPile(ED.sec).forEach(el => ligne(el, 0));
  /* Le fond de la slide ferme la liste : un clic le sélectionne (sa couleur se règle à droite). */
  const fin = document.createElement("div");
  fin.className = "pg-ck-ligne pg-ck-fond" + (ED.sel === ED.sec ? " on" : "");
  const vs = document.createElement("span"); vs.className = "pg-ck-vig"; vs.style.background = ED.win.getComputedStyle(ED.sec).backgroundColor;
  fin.appendChild(document.createElement("span")).className = "pg-ck-chev";
  fin.appendChild(vs);
  const ns = document.createElement("span"); ns.className = "pg-ck-nom"; ns.textContent = "Fond de la " + (typeof pgUne === "function" ? pgUne() : "slide");
  fin.appendChild(ns);
  fin.title = "Le fond de la slide : sa couleur se règle dans le panneau de droite";
  fin.onclick = () => { ED.pile = null; edSelectionner(ED.sec); };
  box.appendChild(fin);
  bord("Derrière");
  tete.querySelector("h3").insertAdjacentHTML("afterend", "<span>" + n + "</span>");
  box.scrollTop = y;
  const on = box.querySelector(".pg-ck-ligne.on");
  if (on) { const b = on.getBoundingClientRect(), c = box.getBoundingClientRect(); if (b.top < c.top || b.bottom > c.bottom) on.scrollIntoView({ block: "nearest" }); }
}

// Un conteneur qui peint un fond à lui (couleur ou image), ou dont le fond est masqué par l'œil.
function edAUnFond(el) {
  if (el.hasAttribute("data-fond-masque")) return true;
  const cs = ED.win.getComputedStyle(el);
  return edRemplit(cs.backgroundColor) || (!!cs.backgroundImage && cs.backgroundImage !== "none");
}
function edMasquerFond(el, masquer) {
  if (masquer) {
    el.setAttribute("data-fond-masque", el.style.getPropertyValue("background") || el.style.getPropertyValue("background-color") || "");
    el.style.setProperty("background", "transparent");
  } else {
    const avant = el.getAttribute("data-fond-masque");
    el.removeAttribute("data-fond-masque");
    el.style.removeProperty("background");
    if (avant) el.style.setProperty("background", avant);
  }
}

/* ---------- SORTIR D'UN GROUPE, ou entrer dans un autre (27 sept. 2026) ----------
   L'élément change de parent SANS BOUGER À L'ÉCRAN : il passe en position absolue dans son nouveau
   parent, à l'endroit exact où il était, avec sa largeur figée (un texte garde ses coupures de ligne).
   Et il garde son ALLURE : les règles de la slide qui le visaient par son ancien groupe (« .carte .p
   { font-size:40px; color:#fff } ») ne l'atteignent plus ; ce qu'elles lui donnaient est recopié sur
   lui (et ses enfants) avant le déplacement. Son décalage, sa rotation, son miroir restent tels quels. */
const ED_PROPS_ALLURE = ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "color",
  "text-transform", "text-align", "text-decoration-line", "text-shadow", "white-space", "word-spacing", "opacity"];
function edChangerDeParent(el, parent, avant) {
  const win = ED.win, tous = [el, ...el.querySelectorAll("*")];
  const allure = tous.map(x => { const cs = win.getComputedStyle(x); return ED_PROPS_ALLURE.map(p => cs.getPropertyValue(p)); });
  // La boîte de mise en page, sans son décalage ni sa rotation (qu'on remet ensuite tels quels).
  const garde = { translate: el.style.translate, rotate: el.style.rotate, scale: el.style.scale };
  el.style.translate = "none"; el.style.rotate = "none"; el.style.scale = "none";
  const r = el.getBoundingClientRect(), l = el.offsetWidth, h = el.offsetHeight, image = el.tagName === "IMG";
  /* RIEN D'AUTRE NE BOUGE : une carte dimensionnée par le texte qu'on en sort se tassait en une bande (relevé
     en testant, slide 3), et les éléments qui le suivaient dans son groupe remontaient. On mesure tout avant ;
     après, l'ancien groupe (et ses parents) gardent leur taille, et ce qui s'est déplacé est ramené par un
     décalage. */
  const autres = [...ED.sec.querySelectorAll("*")].filter(x => x !== el && !el.contains(x) && edCalqueVisible(x));
  const avantR = new Map(autres.map(x => [x, x.getBoundingClientRect()]));
  const ancetres = [];
  for (let x = el.parentElement; x && x !== ED.sec && ED.sec.contains(x); x = x.parentElement) ancetres.push([x, x.offsetWidth, x.offsetHeight]);
  parent.insertBefore(el, avant || null);
  Object.assign(el.style, { position: "absolute", right: "auto", bottom: "auto", margin: "0", boxSizing: "border-box", width: l + "px", maxWidth: "none" });
  if (image) el.style.height = h + "px";
  const cb = el.offsetParent || ED.sec, rc = cb.getBoundingClientRect();
  el.style.left = Math.round((r.left - rc.left - cb.clientLeft) * 10) / 10 + "px";
  el.style.top = Math.round((r.top - rc.top - cb.clientTop) * 10) / 10 + "px";
  ["translate", "rotate", "scale"].forEach(p => { if (garde[p]) el.style[p] = garde[p]; else el.style.removeProperty(p); });
  ancetres.forEach(([x, w, hh]) => {
    if (Math.abs(x.offsetHeight - hh) > .5) x.style.height = hh + "px";
    if (Math.abs(x.offsetWidth - w) > .5) x.style.width = w + "px";
  });
  const ramenes = [];
  autres.forEach(x => {
    if (!x.isConnected || ramenes.some(a => a.contains(x))) return;
    const a = avantR.get(x), b = x.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
    edRendreBloc(x);
    const t0 = edTranslation(x);
    x.style.translate = Math.round((t0.x + dx) * 10) / 10 + "px " + Math.round((t0.y + dy) * 10) / 10 + "px";
    ramenes.push(x);
  });

  // L'allure perdue en quittant le groupe est recopiée, propriété par propriété, là où elle a changé.
  tous.forEach((x, i) => {
    const cs = win.getComputedStyle(x);
    ED_PROPS_ALLURE.forEach((p, k) => { if (cs.getPropertyValue(p) !== allure[i][k]) x.style.setProperty(p, allure[i][k]); });
  });
}
// « Sortir du groupe » : l'élément passe juste au-dessus de son groupe, dans le parent de celui-ci.
function edSortirDuGroupe() {
  const el = ED.sel, groupe = el && el.parentElement;
  if (!el || el === ED.sec || !groupe || groupe === ED.sec || !ED.sec.contains(groupe)) return;
  edAvant("sortir-" + Date.now());
  const parent = groupe.parentElement;
  edChangerDeParent(el, parent, groupe.nextSibling);
  // Il passe DEVANT son ancien groupe dans la pile (sinon un groupe à fond le cacherait).
  const ordre = edEnfantsPile(parent).filter(x => x !== el);
  ordre.splice(Math.max(0, ordre.indexOf(groupe)), 0, el);
  edReordonner(ordre, true);
  edSale();
  edSelectionner(el);
}

// Donner à des frères l'ordre voulu : « ordre » va du dessus au dessous.
function edReordonner(ordre, sansAvant) {
  if (!sansAvant) edAvant("calques-" + Date.now());
  const n = ordre.length;
  ordre.forEach((el, k) => {
    if (!edPeutZ(el)) {
      if ([...el.querySelectorAll("*")].some(x => ED.win.getComputedStyle(x).position !== "static")) return;
      el.style.position = "relative";
    }
    el.style.zIndex = String(n - k);
  });
  edSale(); edMajUI(); edRendrePanneau();
}

/* ============================================================
   LES GRILLES À TROUS

   Claude écrivait un damier en listant TOUTES ses cases, les trous compris : des cases
   transparentes qui tiennent la place, sans quoi, dans une grille automatique, chaque case
   suivante glisserait d'un cran. Dans l'éditeur, ce sont des calques invisibles et intouchables
   (relevé le 24 septembre 2026 : 7 « formes vides » sur la slide 3, que l'œil ne faisait pas
   disparaître). Et les carrés ajoutés par « Dupliquer » y flottaient en position absolue, à
   quelques pixels de leur case.

   Nettoyer la grille : chaque case reçoit sa place explicite (grid-column, grid-row), les cases
   vides partent sans que rien ne bouge, et une copie qui recouvre une case y est rangée pour de
   bon — alignée au pixel, et redevenue une vraie case. La consigne de mise en page (5 ter)
   interdit désormais à Claude d'écrire ces cases vides.
   ============================================================ */

const edEstGrille = el => !!el && el.nodeType === 1 && /^(inline-)?grid$/.test(ED.win.getComputedStyle(el).display);

// Un élément qui ne montre rien : ni texte, ni enfant, ni fond, ni bordure, ni ombre.
function edEstVide(el) {
  if (el.tagName === "IMG" || el.children.length || (el.textContent || "").trim()) return false;
  const cs = ED.win.getComputedStyle(el);
  return !edRemplit(cs.backgroundColor) && (!cs.backgroundImage || cs.backgroundImage === "none") &&
    !(parseFloat(cs.borderTopWidth) > 0 && edRemplit(cs.borderTopColor)) && (!cs.boxShadow || cs.boxShadow === "none");
}

// Les pistes d'une grille (colonnes ou lignes) : où chacune commence, et sa taille.
function edPistes(liste, ecart, depart) {
  const tailles = String(liste || "").trim().split(/\s+/).map(parseFloat).filter(x => !isNaN(x));
  let x = depart;
  return tailles.map(t => { const p = { debut: x, taille: t }; x += t + ecart; return p; });
}
// La piste qui commence là (à un quart de piste près), ou -1.
function edPisteEn(pistes, v) {
  let mieux = -1, d = Infinity;
  pistes.forEach((p, i) => { const e = Math.abs(p.debut - v); if (e < d) { d = e; mieux = i; } });
  return mieux >= 0 && d <= pistes[mieux].taille / 4 ? mieux : -1;
}

// Ce que contient la grille : ses cases vides, ses copies à la main, et la case de chacun.
function edBilanGrille(g) {
  const cs = ED.win.getComputedStyle(g);
  const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
  const cols = edPistes(cs.gridTemplateColumns, parseFloat(cs.columnGap) || 0, pl);
  const lignes = edPistes(cs.gridTemplateRows, parseFloat(cs.rowGap) || 0, pt);
  const cases = [], vides = [], copies = [];
  [...g.children].filter(edCalqueVisible).forEach(el => {
    if (edEstVide(el)) { vides.push(el); return; }
    const t = edTranslation(el), abs = ED.win.getComputedStyle(el).position === "absolute";
    const c = edPisteEn(cols, el.offsetLeft + t.x), r = edPisteEn(lignes, el.offsetTop + t.y);
    if (c < 0 || r < 0) return;                       // hors de toute case : on n'y touche pas
    cases.push({ el: el, c: c, r: r, abs: abs });
    if (abs) copies.push(el);
  });
  return { vides: vides, copies: copies, cases: cases };
}

function edNettoyerGrille(g) {
  const b = edBilanGrille(g);
  if (!b.vides.length && !b.copies.length) return;
  edAvant("grille-" + Date.now());
  // D'abord TOUTES les places, pendant que les cases vides tiennent encore la leur.
  b.cases.forEach(x => {
    x.el.style.gridColumn = String(x.c + 1);
    x.el.style.gridRow = String(x.r + 1);
    if (x.abs) ["position", "inset", "left", "top", "right", "bottom", "width", "height", "margin", "box-sizing"].forEach(p => x.el.style.removeProperty(p));
    x.el.style.removeProperty("translate");            // la case EST la place : plus de décalage
  });
  b.vides.forEach(el => el.remove());
  edSale(); edMajUI(); edRendrePanneau();
}

let edCalquesPrevus = false;
function edRendrePanneau() {
  if (!edCalquesPrevus) {
    edCalquesPrevus = true;
    enPeinture(() => { edCalquesPrevus = false; edRendreCalques(); });
  }
  const p = $("pg-ed");
  if (!p) return;
  p.innerHTML = "";
  const el = ED.sel;
  const bouton = (texte, clic, o) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn-mini" + (o && o.fort ? " btn-mini-fort" : "") + (o && o.danger ? " btn-mini-danger" : "");
    b.textContent = texte; b.onclick = clic; if (o && o.inactif) b.disabled = true; if (o && o.titre) b.title = o.titre; return b;
  };
  const rangee = (...enfants) => { const d = document.createElement("div"); d.className = "pg-ed-rangee"; enfants.forEach(x => x && d.appendChild(x)); return d; };

  p.appendChild(rangee(
    bouton("↶ Annuler", edAnnuler, { inactif: !ED.annuler.length, titre: "Ctrl+Z" }),
    bouton("↷ Rétablir", edRetablir, { inactif: !ED.retablir.length, titre: "Ctrl+Y" })));

  if (!el) {
    const aide = document.createElement("div"); aide.className = "pg-ed-aide";
    aide.innerHTML = "<b>Cliquez sur un élément</b> de la slide pour le modifier.<ul>" +
      "<li><b>Glissez-le</b> pour le déplacer — les flèches le poussent d'un pixel (Maj : dix).</li>" +
      "<li>La <b>poignée ronde ↻</b> le fait tourner (Maj : par pas de 15°).</li>" +
      "<li><b>Double-clic</b> pour changer son texte.</li>" +
      "<li>Le panneau règle sa taille, ses couleurs, son interligne, son ordre…</li>" +
      "<li><b>Suppr</b> le retire, <b>Ctrl+Z</b> annule.</li></ul>";
    p.appendChild(aide);
    return;
  }

  const cs = ED.win.getComputedStyle(el), estSlide = el === ED.sec, estImage = el.tagName.toLowerCase() === "img";
  /* Une partie du texte est sélectionnée : les réglages de caractère iront sur elle seule.
     Le panneau lit alors les valeurs de CE mot — sinon il afficherait celles du bloc et
     mentirait sur ce qu'on s'apprête à changer. La boîte, elle, reste celle de l'élément. */
  const plageMot = edSelectionMot();
  const spanMot = plageMot && edSpanDuMot(plageMot);
  const csT = ED.win.getComputedStyle(spanMot || el);
  const titre = document.createElement("p"); titre.className = "pg-ed-titre"; titre.textContent = edNomDe(el);
  p.appendChild(titre);
  if (ED.texte) { const t = document.createElement("p"); t.className = "pg-ed-note"; t.textContent = "Vous modifiez le texte. Échap, ou un clic ailleurs, pour en sortir."; p.appendChild(t); }
  if (plageMot) {
    const t = document.createElement("p"); t.className = "pg-ed-note";
    t.textContent = "« " + String(plageMot).trim().slice(0, 24) + " » est sélectionné : la couleur, la taille, la graisse, l'espacement, la casse et le fond ne changeront QUE ces mots-là.";
    p.appendChild(t);
  }

  if (!estSlide) {
    p.appendChild(rangee(
      bouton("↑ Le bloc parent", () => edSelectionner(el.parentElement), { titre: "Sélectionner ce qui contient cet élément" }),
      el.parentElement && el.parentElement !== ED.sec ? bouton("⇱ Sortir du groupe", edSortirDuGroupe, { titre: "Le sortir de son groupe, sans qu'il bouge à l'écran : il se déplace ensuite seul. (Dans la colonne des calques, on peut aussi glisser sa ligne hors du groupe.)" }) : null,
      /* Deux blocs qui se recouvrent : celui de dessous s'atteint d'ici, ou en recliquant
         au même endroit, ou par Alt+clic. Sans quoi il est tout simplement inatteignable. */
      bouton("↓ L'élément dessous", edDessous, { inactif: !ED.pile || ED.pile.liste.length < 2,
        titre: "Passer à ce qui se trouve sous cet élément, au point cliqué (Alt+clic, ou recliquer au même endroit)" })));
    p.appendChild(rangee(
      bouton("Dupliquer", edDupliquer),
      bouton("Supprimer", edSupprimer, { danger: true })));
    // Une grille qui contient des cases vides, ou des copies posées à la main : on peut la ranger.
    const bilan = edEstGrille(el) ? edBilanGrille(el) : null;
    if (bilan && (bilan.vides.length || bilan.copies.length)) {
      const n = document.createElement("p"); n.className = "pg-ed-note";
      n.textContent = "Cette grille contient " + [bilan.vides.length ? bilan.vides.length + " case" + (bilan.vides.length > 1 ? "s" : "") + " vide" + (bilan.vides.length > 1 ? "s" : "") + " (des calques invisibles qui tiennent la place)" : "",
        bilan.copies.length ? bilan.copies.length + " copie" + (bilan.copies.length > 1 ? "s" : "") + " posée" + (bilan.copies.length > 1 ? "s" : "") + " à la main" : ""].filter(Boolean).join(" et ") + ".";
      p.appendChild(n);
      p.appendChild(rangee(bouton("Nettoyer la grille", () => edNettoyerGrille(el), { fort: true,
        titre: "Chaque case est fixée à sa place, les cases vides sont retirées, les copies rangées exactement dans leur case. Rien ne bouge à l'écran, sauf les copies qui s'alignent." })));
    }
  }

  /* Une image de la publication : on peut en supprimer le fond (Higgsfield, prix annoncé avant), ou le remettre.
     Le serveur change le fichier dans toutes les slides ; ici, l'image sélectionnée prend tout de suite la
     nouvelle version, et perd le rognage et le fondu qui servaient à cacher son carré. */
  const media = estImage && typeof pgMediaDeSrc === "function" ? pgMediaDeSrc(el.getAttribute("src")) : null;
  if (media) {
    const etat = document.createElement("p"); etat.className = "pg-ed-note"; etat.hidden = true;
    const dire = msg => { etat.textContent = msg || ""; etat.hidden = !msg; };
    // L'image sélectionnée prend tout de suite la version rendue (détourée, ou d'origine).
    const appliquer = neuf => {
      if (!neuf || ED.sel !== el) return;
      edAvant("fond");
      el.setAttribute("src", "/pub/" + PROJET.id + "/" + PG.d.pubId + "/medias/" + encodeURIComponent(neuf.fichier));
      if (neuf.detoure) { el.style.setProperty("-webkit-mask-image", "none"); el.style.maskImage = "none"; el.style.objectFit = "contain"; }
      else { el.style.removeProperty("-webkit-mask-image"); el.style.removeProperty("mask-image"); el.style.removeProperty("object-fit"); }
      edSale(); edMajUIBientot();
    };
    const b = bouton(media.detoure ? "Remettre le fond" : "Supprimer le fond", async () => {
      b.disabled = true;
      try { appliquer(media.detoure ? await pgBasculerFond(media.fichier, "avec") : await pgDetourer(media.fichier, dire)); }
      catch (err) { dire("Le fond n'a pas pu être " + (media.detoure ? "remis" : "supprimé") + " : " + (err.message || err)); b.disabled = false; return; }
      edRendrePanneau();
    }, { fort: !media.detoure, titre: media.detoure ? "Revenir à l'image d'origine (gratuit)"
        : media.sansFond ? "La version détourée existe déjà : gratuit"
        : DETOURAGE_LOCAL ? "Ne garder que le personnage ou l'objet. Au choix : gratuitement sur votre ordinateur, ou avec Higgsfield."
        : "Ne garder que le personnage ou l'objet. Le prix est annoncé avant." });
    /* Le résultat ne va pas (une image grise, un morceau mangé) : on refait avec l'AUTRE méthode, gratuitement.
       « Fond uni » pour un objet ou une carte posés sur une seule couleur, l'IA pour un sujet devant un décor. */
    let refaire = null;
    if (media.detoure && DETOURAGE_LOCAL) {
      refaire = bouton(pgLibelleAutreFond(media), async () => {
        refaire.disabled = b.disabled = true;
        try { appliquer(await pgRefaireFond(media, dire)); dire(""); }
        catch (err) { dire("Le détourage n'a pas pu être refait : " + (err.message || err)); refaire.disabled = b.disabled = false; return; }
        edRendrePanneau();
      }, { titre: pgTitreAutreFond(media) });
    }
    p.appendChild(rangee(b, refaire));
    p.appendChild(etat);
  }

  // Un champ numérique : il lit la valeur calculée, écrit un style.
  const nombre = (libelle, prop, valeur, o) => {
    const l = document.createElement("label"); l.className = "pg-ed-champ";
    l.innerHTML = "<span>" + libelle + "</span>";
    const i = document.createElement("input"); i.type = "number"; i.value = valeur; i.step = o.pas || 1;
    if (o.min != null) i.min = o.min; if (o.max != null) i.max = o.max;
    i.oninput = () => { if (i.value === "") return; if (o.bloc) edRendreBloc(el); edStyle(prop, (o.ecrire || (v => v + "px"))(i.value), prop); };
    l.appendChild(i);
    if (o.moinsPlus) {
      const pas = o.moinsPlus;
      [["−", -pas], ["+", pas]].forEach(([s, d]) => { const b = bouton(s, () => { i.value = Math.max(o.min != null ? o.min : -9999, Math.round((parseFloat(i.value || 0) + d) * 100) / 100); i.oninput(); }); b.classList.add("pg-ed-pm"); l.appendChild(b); });
    }
    return l;
  };
  const groupe = nom => { const h = document.createElement("p"); h.className = "pg-ed-groupe"; h.textContent = nom; p.appendChild(h); };
  const grille = (...enfants) => { const d = document.createElement("div"); d.className = "pg-ed-grille"; enfants.forEach(x => x && d.appendChild(x)); p.appendChild(d); return d; };

  // Les couleurs : celles de la DA d'abord, puis une couleur libre.
  const da = PG.identites.find(x => x.id === PG.d.identiteId), co = (da && da.couleurs) || { fond: "#0b0b0d", texte: "#f2f2f2", accent: "#f97316", second: "#fdba74" };
  const couleurs = (libelle, prop, actuelle, avecAucune) => {
    const d = document.createElement("div"); d.className = "pg-ed-couleurs";
    d.innerHTML = "<span>" + libelle + "</span>";
    const pastilles = document.createElement("div");
    [co.fond, co.texte, co.accent, co.second, "#000000", "#ffffff"].filter((x, i, a) => a.indexOf(x) === i).forEach(c => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pg-pastille-fond" + (actuelle && actuelle.toLowerCase() === c.toLowerCase() ? " on" : ""); b.style.background = c; b.title = c;
      b.onclick = () => { edStyle(prop, c, prop + Date.now()); edRendrePanneau(); };
      pastilles.appendChild(b);
    });
    // Une autre couleur : le nuancier du studio, qui applique en direct. Une seule marche arrière pour toute la séance.
    const proposees = [co.fond, co.texte, co.accent, co.second, "#000000", "#ffffff"].map(x => String(x).toLowerCase());
    const perso = !!actuelle && proposees.indexOf(actuelle.toLowerCase()) < 0;
    pastilles.appendChild(boutonAutreCouleur(actuelle, perso, ancre => {
      const geste = "nuancier-" + prop + Date.now();
      nuancier(ancre, actuelle || "#ffffff", {
        titre: libelle,
        // Toute la séance ne fait qu'UNE marche arrière : le geste reste le même et ne vieillit pas.
        surChange: c => { ED.dernierTemps = Date.now(); edStyle(prop, c, geste); const i = ancre.querySelector(".nu-anneau i"); if (i) i.style.background = c; },
        // Annuler défait toute la séance d'un coup, et garde l'élément sélectionné (edAnnuler recrée la slide).
        surAnnule: () => { const ch = edChemin(ED.sel); edAnnuler(); edSelectionner(edDepuisChemin(ch)); },
        surFin: (c, change) => { if (change) edRendrePanneau(); }
      });
    }));
    if (avecAucune) pastilles.appendChild(bouton("aucun", () => { edStyle(prop, "transparent", prop + Date.now()); edRendrePanneau(); }));
    d.appendChild(pastilles);
    p.appendChild(d);
  };

  if (!estSlide && !estImage) {
    groupe("Le texte");
    // La police : celles de la DA d'abord, puis toutes celles du studio, chacune écrite dans sa police.
    const polices = (typeof PG !== "undefined" && PG.polices) || [];
    if (polices.length) {
      if (typeof pgChargerPolices === "function") pgChargerPolices();
      const daP = (da && da.polices) || {}, actuelle = edPremierePolice(csT.fontFamily);
      const lp = document.createElement("label"); lp.className = "pg-ed-champ pg-ed-large"; lp.innerHTML = "<span>Police</span>";
      const sel = document.createElement("select"); sel.className = "pg-plan-media pg-ed-police";
      const option = (f, libelle) => { const o = document.createElement("option"); o.value = f; o.textContent = libelle || f; o.style.fontFamily = edPileDePolice(f); return o; };
      const tete = [daP.titres, daP.texte].filter((x, i, a) => x && a.indexOf(x) === i);
      if (tete.length) {
        const g = document.createElement("optgroup"); g.label = "Votre DA";
        tete.forEach(f => g.appendChild(option(f, f + (f === daP.titres ? " — titres" : "") + (f === daP.texte && f !== daP.titres ? " — texte" : ""))));
        sel.appendChild(g);
      }
      // Les polices ajoutées depuis la bibliothèque, puis celles du studio.
      const ajoutees = ((typeof PG !== "undefined" && PG.policesAjoutees) || []).filter(f => !tete.includes(f));
      if (ajoutees.length) {
        const ga = document.createElement("optgroup"); ga.label = "Vos polices ajoutées";
        ajoutees.forEach(f => ga.appendChild(option(f)));
        sel.appendChild(ga);
      }
      const g2 = document.createElement("optgroup"); g2.label = "Les polices du studio";
      polices.filter(f => !tete.includes(f) && !ajoutees.includes(f)).forEach(f => g2.appendChild(option(f)));
      sel.appendChild(g2);
      if (!polices.includes(actuelle) && actuelle) sel.insertBefore(option(actuelle, actuelle + " (actuelle)"), sel.firstChild);
      sel.value = actuelle;
      sel.style.fontFamily = edPileDePolice(actuelle);
      sel.onchange = () => {
        const f = sel.value, geste = "police" + Date.now(), info = edInfoPolice(f);
        edChargerPolice(f);
        edStyle("font-family", edPileDePolice(f), geste);
        const g = parseInt(csT.fontWeight, 10) || 400;
        if (!info.graisses.includes(g)) { ED.dernierTemps = Date.now(); edStyle("font-weight", String(edGraisseProche(g, info.graisses)), geste); }
        if (!info.italique && csT.fontStyle === "italic") { ED.dernierTemps = Date.now(); edStyle("font-style", "normal", geste); }
        edRendrePanneau();
        setTimeout(edMajUI, 400);
      };
      lp.appendChild(sel); p.appendChild(lp);

      /* PLUS DE POLICES : la bibliothèque de Google Fonts, écrite avec le texte de cet élément. Cliquer une
         carte l'essaie ici même ; toute la séance ne fait qu'une marche arrière. Une police ESSAYÉE et gardée
         sur la slide rejoint d'office les polices du studio en fermant : sinon, la page de la slide ne la
         connaîtrait pas, et elle disparaîtrait à l'export. */
      const plusP = document.createElement("button"); plusP.type = "button"; plusP.className = "pg-ed-plus-polices";
      plusP.innerHTML = "+ Plus de polices"; plusP.title = "Toute la bibliothèque Google Fonts";
      plusP.onclick = () => {
        const cible = el, geste = "bibliotheque" + Date.now();
        ouvrirBibliothequePolices({
          texte: (cible.innerText || cible.textContent || "").trim(), courante: actuelle,
          surEssai: (nom, fiche) => {
            if (!ED.sel || !fiche) return;
            if (PG.policesInfo && !PG.policesInfo[nom]) PG.policesInfo[nom] = { graisses: fiche.graisses, italique: fiche.italique, cat: fiche.cat };
            edChargerPolice(nom);
            ED.dernierTemps = Date.now(); edStyle("font-family", edPileDePolice(nom), geste);
            const g = parseInt(ED.win.getComputedStyle(ED.sel).fontWeight, 10) || 400;
            if (!fiche.graisses.includes(g)) { ED.dernierTemps = Date.now(); edStyle("font-weight", String(edGraisseProche(g, fiche.graisses)), geste); }
            setTimeout(edMajUI, 500);
          },
          surFermer: async essai => {
            const pris = essai && ED.sel && edPremierePolice(ED.win.getComputedStyle(ED.sel).fontFamily) === essai;
            if (pris && !((PG && PG.polices) || []).includes(essai)) {
              try { const r = await (await fetch("/api/polices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: essai }) })).json(); if (!r.erreur) bpMajPolices(r); }
              catch (e) { /* elle reste employée ; le studio la chargera s'il la connaît */ }
            }
            if (typeof pgChargerPolices === "function") pgChargerPolices();
            edRendrePanneau();
          }
        });
      };
      p.appendChild(plusP);
    }
    grille(
      nombre("Taille", "font-size", edPx(csT.fontSize), { min: 8, max: 600, moinsPlus: 4 }),
      nombre("Interligne", "line-height", cs.lineHeight === "normal" ? 1.2 : Math.round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) * 100) / 100, { min: .6, max: 3, pas: .05, moinsPlus: .05, ecrire: v => v }),
      nombre("Espacement", "letter-spacing", csT.letterSpacing === "normal" ? 0 : edPx(csT.letterSpacing), { min: -20, max: 80, pas: .5 }));
    const lg = document.createElement("div"); lg.className = "pg-ed-rangee";
    /* LES GRAISSES DE CETTE POLICE, et elles seules : Bebas Neue n'a que « Normal », Inter va d'Ultra-fin à Noir.
       Une seule graisse : le menu est remplacé par une mention, il n'y a rien à choisir. */
    const infoP = edInfoPolice(edPremierePolice(csT.fontFamily));
    const gActuelle = parseInt(csT.fontWeight, 10) || 400;
    if (infoP.graisses.length > 1) {
      const graisse = document.createElement("select"); graisse.className = "pg-plan-media";
      graisse.title = "Les graisses de cette police";
      infoP.graisses.forEach(v => { const o = document.createElement("option"); o.value = String(v); o.textContent = (ED_NOMS_GRAISSE[v] || v) + " · " + v; o.style.fontWeight = v; graisse.appendChild(o); });
      graisse.value = String(edGraisseProche(gActuelle, infoP.graisses));
      graisse.onchange = () => edStyle("font-weight", graisse.value, "graisse" + Date.now());
      lg.appendChild(graisse);
    } else {
      lg.appendChild(Object.assign(document.createElement("span"), { className: "pg-ed-une-graisse", textContent: "Une seule graisse", title: "Cette police n'existe qu'en une graisse" }));
    }
    // L'italique, seulement si la police en a un : sinon le navigateur penche les lettres de lui-même, et c'est laid.
    const ital = csT.fontStyle === "italic";
    lg.appendChild(bouton("I", () => { edStyle("font-style", ital ? "normal" : "italic", "italique" + Date.now()); edRendrePanneau(); },
      { fort: ital, inactif: !infoP.italique && !ital, titre: infoP.italique ? "Italique" : "Cette police n'a pas d'italique" }));
    [["left", "⇤"], ["center", "↔"], ["right", "⇥"]].forEach(([v, s]) => { const b = bouton(s, () => { edRendreBloc(el); edStyle("text-align", v, "align" + Date.now()); edRendrePanneau(); }, { fort: cs.textAlign === v || (v === "left" && cs.textAlign === "start"), titre: "Aligner : " + v }); lg.appendChild(b); });
    lg.appendChild(bouton("Aa", () => { edStyle("text-transform", csT.textTransform === "uppercase" ? "none" : "uppercase", "casse" + Date.now()); edRendrePanneau(); }, { fort: csT.textTransform === "uppercase", titre: "Majuscules" }));
    p.appendChild(lg);
    couleurs("Couleur du texte", "color", edHex(csT.color));
  }

  groupe(estSlide ? "Le fond de la slide" : "Le fond et la boîte");
  couleurs("Fond", "background", edHex(cs.backgroundColor), !estSlide);
  if (!estSlide) {
    const auto = bouton("Largeur auto", () => { edStyle("width", "", "largeur" + Date.now()); edRendrePanneau(); });
    grille(
      nombre("Largeur", "width", edPx(cs.width), { min: 4, max: 2000, bloc: true, moinsPlus: 10 }),
      nombre(estImage ? "Hauteur" : "Marge int.", estImage ? "height" : "padding", estImage ? edPx(cs.height) : edPx(cs.paddingTop), { min: 0, max: 2000, bloc: true }),
      nombre("Arrondi", "border-radius", edPx(cs.borderTopLeftRadius), { min: 0, max: 999, bloc: true }));
    p.appendChild(rangee(auto));

    groupe("La place");
    const t = edTranslation(el);
    grille(
      nombre("Décalage →", "translate", t.x, { bloc: true, ecrire: v => v + "px " + edTranslation(el).y + "px" }),
      nombre("Décalage ↓", "translate", t.y, { bloc: true, ecrire: v => edTranslation(el).x + "px " + v + "px" }),
      nombre("Rotation °", "rotate", parseFloat(el.style.rotate) || 0, { min: -180, max: 180, bloc: true, ecrire: v => v + "deg" }));
    const op = document.createElement("label"); op.className = "pg-ed-champ pg-ed-large"; op.innerHTML = "<span>Opacité</span>";
    const curseur = document.createElement("input"); curseur.type = "range"; curseur.min = 0; curseur.max = 100; curseur.value = Math.round(parseFloat(cs.opacity) * 100);
    curseur.oninput = () => edStyle("opacity", String(curseur.value / 100), "opacity");
    op.appendChild(curseur); p.appendChild(op);
    const [mx, my] = edEchelleProp(cs.scale);
    p.appendChild(rangee(
      bouton("⇋ Miroir", () => edMiroir("h"), { fort: mx < 0, titre: "Retourner de gauche à droite (recliquer pour annuler)" }),
      bouton("⇅ Miroir", () => edMiroir("v"), { fort: my < 0, titre: "Retourner de haut en bas (recliquer pour annuler)" })));
    // L'ordre des plans se règle dans la colonne des calques (glisser), plus ici.
  }
}

// Depuis le panneau aussi, Ctrl+Z annule — sauf dans un champ de saisie de texte libre.
document.addEventListener("keydown", e => {
  if ($("pg-loupe").hidden || !ED.sec) return;
  const ctrl = e.ctrlKey || e.metaKey, dansTexte = e.target && e.target.tagName === "TEXTAREA";
  if (dansTexte || !ctrl) return;
  if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); edAnnuler(); }
  else if (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z")) { e.preventDefault(); edRetablir(); }
});
