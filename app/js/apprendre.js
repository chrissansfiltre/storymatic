/* ============================================================
   « APPRENDRE MON STYLE » — la page (30 sept. 2026 ; maquette LABO/module-da-v2, validée)
   Dans une sous-DA Carrousel ou Story (da.js) : on glisse UN dossier, la page le TRIE (dimensions, transparence,
   extension — rien ne part avant « Apprendre mon style »), l'envoie, suit le travail du serveur (apprendre.js), puis
   montre ce que le studio a appris, rubrique par rubrique : « C'est bon » ou « Corriger » (un ordre pour Claude).
   Rien n'entre dans la DA avant « Enregistrer ». Préfixe ap / AP ; écran dessiné dans #dam (DAM.vue = "apprendre").
   ============================================================ */
const AP = { daId: null, sous: null, etape: "depot", tri: null, session: null, envoi: null, valide: {}, corrige: {}, occupe: "", erreur: "", sondage: null };
const apCle = () => "apprendre:" + AP.daId + ":" + AP.sous;
const apLib = () => DAM_LIB[AP.sous] || DAM_LIB.carrousel;
const apUrl = (rayon, f) => "/apprendre-fichier/" + AP.session.id + "/" + rayon + "/" + encodeURIComponent(f);

async function ouvrirApprendre(daId, sous) {
  Object.assign(AP, { daId, sous, etape: "depot", tri: null, session: null, envoi: null, valide: {}, corrige: {}, occupe: "", erreur: "" });
  clearInterval(AP.sondage);
  DAM.id = daId; DAM.sous = sous; DAM.vue = "apprendre"; DAM.tiroir = null;
  // une session déjà lancée pour cette sous-DA (on était parti ailleurs pendant le travail) : on la reprend
  let sid = null; try { sid = localStorage.getItem(apCle()); } catch (e) {}
  if (sid) {
    try {
      const s = await (await fetch("/api/apprendre/" + sid)).json();
      if (!s.erreur && ["travail", "fini", "erreur"].includes(s.etat)) { AP.session = s; AP.etape = s.etat === "fini" ? "resultats" : "travail"; if (s.etat === "travail") apSuivre(); if (s.etat === "fini") apPreparerResultats(); }
    } catch (e) {}
  }
  damRendre(); window.scrollTo({ top: 0 });
}

/* ---------- le tri, dans la page ---------- */
const apPropre = n => n.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+GIF$/i, "").trim();
const apNumero = n => { const m = n.match(/\d+/); return m ? +m[0] : null; };
async function apLireDepot(dt) {
  const out = [], racines = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const marcher = async (e, chemin) => {
    if (e.isFile) { const f = await new Promise((ok, ko) => e.file(ok, ko)); out.push({ f, chemin: chemin + f.name }); return; }
    const r = e.createReader(); let lot;
    do { lot = await new Promise((ok, ko) => r.readEntries(ok, ko)); for (const x of lot) await marcher(x, chemin + e.name + "/"); } while (lot.length);
  };
  for (const e of racines) await marcher(e, "");
  return out;
}
function apImage(url) { return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("image illisible")); i.src = url; }); }
async function apAnalyser(f) {
  const url = URL.createObjectURL(f), img = await apImage(url);
  const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement("canvas");
  c.width = 64; c.height = Math.max(1, Math.round(64 * h / w));
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data; let tr = 0, som = 0, som2 = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 245) tr++; const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; som += l; som2 += l * l; }
  const n = d.length / 4, ecart = Math.sqrt(Math.max(0, som2 / n - (som / n) ** 2));
  // ecart : l'écart de luminosité — un fond (une matière, une texture) est presque uni ; un objet sur fond blanc ne l'est pas
  return { url, w, h, transp: tr / n, ecart };
}
// l'image d'une vidéo (une slide vidéo) : prise à 0,5 s par la page
function apImageDeVideo(f) {
  return new Promise((ok, ko) => {
    const v = document.createElement("video"), url = URL.createObjectURL(f);
    v.muted = true; v.preload = "auto"; v.src = url;
    v.onerror = () => ko(new Error("vidéo illisible"));
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      c.toBlob(b => { URL.revokeObjectURL(url); b ? ok(b) : ko(new Error("vidéo illisible")); }, "image/jpeg", 0.9);
    };
  });
}
async function apTrier(liste) {
  const racine = (liste[0] && liste[0].chemin.includes("/")) ? liste[0].chemin.split("/")[0] : "ton dossier";
  const t = { nom: racine, carrousels: [], elements: [], fonds: [], gifs: [], polices: [], ignores: [] };
  const slidesPar = {}, videosPar = {};
  for (const { f, chemin } of liste) {
    const ext = (f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase(), dossier = chemin.split("/").slice(0, -1).join("/") || ".";
    if (f.name.startsWith(".") || /^(thumbs\.db|desktop\.ini)$/i.test(f.name)) continue;
    if ([".otf", ".ttf", ".woff", ".woff2"].includes(ext)) { t.polices.push({ f, nom: apPropre(f.name) }); continue; }
    if (ext === ".pdf") { t.ignores.push({ nom: chemin, pourquoi: "un PDF : le studio lit les slides en image" }); continue; }
    if (ext === ".gif") { t.gifs.push({ f, nom: apPropre(f.name), url: URL.createObjectURL(f) }); continue; }
    if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) { (videosPar[dossier] = videosPar[dossier] || []).push({ f, nom: f.name, vid: URL.createObjectURL(f) }); continue; }
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) { t.ignores.push({ nom: chemin, pourquoi: "un type de fichier que le studio ne lit pas" }); continue; }
    let a; try { a = await apAnalyser(f); } catch (e) { t.ignores.push({ nom: chemin, pourquoi: "image illisible" }); continue; }
    const r = a.w / a.h, formatSlide = AP.sous === "story" ? (r > 0.5 && r < 0.62) : ((r > 0.74 && r < 0.86) || (r > 0.95 && r < 1.05));
    const nomFond = /(^|[^a-z])(fond|background|bg|texture|arri[eè]re[ -]?plan)([^a-z]|$)/i.test(apPropre(f.name));
    if (nomFond && a.transp <= 0.02) t.fonds.push({ f, nom: apPropre(f.name), url: a.url });
    else if (a.transp > 0.02) t.elements.push({ f, nom: apPropre(f.name), url: a.url, transp: true });
    else if (formatSlide) (slidesPar[dossier] = slidesPar[dossier] || []).push({ f, nom: f.name, url: a.url, n: apNumero(f.name), w: a.w, h: a.h, ecart: a.ecart });
    else if (r > 2.2) t.ignores.push({ nom: chemin, pourquoi: "une bande très large : plusieurs slides collées en une image" });
    else if (a.w >= 1000 && (a.ecart < 28 || /fond|background|texture|arri[eè]re|papier|tissu/i.test(f.name))) t.fonds.push({ f, nom: apPropre(f.name), url: a.url });
    else t.elements.push({ f, nom: apPropre(f.name), url: a.url, transp: false });
  }
  for (const [dossier, sl] of Object.entries(slidesPar)) {
    const vids = videosPar[dossier] || [];
    /* Un dossier d'images au format d'une slide n'est un CARROUSEL que si ses images sont numérotées (« 1.png », « Slide 3 »)
       ou toutes de la taille d'une slide exportée (1000 à 1500 px de large) — et si son nom ne dit pas le contraire.
       Des patchs brodés sont des PNG opaques en 4:5 (1856 × 2304), nommés « angoisse », « heureux » : des éléments. */
    const numerotes = sl.filter(s => s.n != null).length / sl.length;
    const memeTaille = new Set(sl.map(s => s.w + "x" + s.h)).size === 1 && sl.every(s => s.w >= 1000 && s.w <= 1500);
    const nomD = dossier.split("/").pop();
    const carrousel = !/patch|sticker|[ée]l[ée]ment|asset|logo|ic[oô]ne|badge|emoji|gif/i.test(nomD) && (numerotes >= 0.6 || memeTaille) && (sl.length >= 2 || vids.length);
    if (!carrousel) { sl.forEach(s => (s.ecart < 28 ? t.fonds : t.elements).push({ f: s.f, nom: apPropre(s.nom), url: s.url, transp: false })); continue; }
    delete videosPar[dossier];
    const slides = sl.map(s => ({ f: s.f, url: s.url, n: s.n }));
    // une vidéo au même numéro qu'une slide en est la partie animée ; sinon c'est une slide vidéo (on en prend l'image)
    vids.forEach(v => { const k = apNumero(v.nom), s = slides.find(x => x.n != null && x.n === k); if (s) s.anim = true; else slides.push({ f: v.f, vid: v.vid, n: k, video: true }); });
    slides.sort((a, b) => (a.n == null ? 999 : a.n) - (b.n == null ? 999 : b.n));
    const nom = dossier === "." ? "Tes " + apLib().pluriel : dossier.split("/").pop().replace(/\s*\((car+ou?s+el|stor(y|ies))\)\s*/i, "").trim();
    t.carrousels.push({ nom, slides });
  }
  for (const vs of Object.values(videosPar)) vs.forEach(v => t.gifs.push({ f: v.f, nom: apPropre(v.nom), vid: v.vid }));
  return t;
}
const apNSlides = t => t.carrousels.reduce((a, c) => a + c.slides.length, 0);

/* ---------- l'envoi : les slides réduites en JPEG 1080, le reste tel quel ---------- */
async function apJpeg(source, largeur) {
  const url = source instanceof Blob ? URL.createObjectURL(source) : source, img = await apImage(url);
  const l = Math.min(largeur, img.naturalWidth), h = Math.round(l * img.naturalHeight / img.naturalWidth), c = document.createElement("canvas");
  c.width = l; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, l, h); x.drawImage(img, 0, 0, l, h);
  return new Promise(ok => c.toBlob(ok, "image/jpeg", 0.9));
}
async function apEnvoyer() {
  const t = AP.tri, L = apLib();
  if (!t.carrousels.length) { AP.erreur = "Il faut au moins un " + (AP.sous === "story" ? "enchaînement de stories" : "carrousel") + " dans le dossier."; damRendre(); return; }
  const total = apNSlides(t) + t.elements.length + t.fonds.length + t.gifs.length + t.polices.length;
  AP.etape = "envoi"; AP.envoi = { fait: 0, total }; AP.erreur = ""; damRendre();
  try {
    const s = await (await fetch("/api/apprendre", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ daId: AP.daId, sous: AP.sous }) })).json();
    if (s.erreur) throw new Error(s.erreur);
    AP.session = s; try { localStorage.setItem(apCle(), s.id); } catch (e) {}
    const poser = async (params, corps) => {
      const r = await (await fetch("/api/apprendre/" + s.id + "/fichier?" + new URLSearchParams(params), { method: "POST", body: corps })).json();
      if (r.erreur) throw new Error(r.erreur);
      AP.envoi.fait++; const b = $("ap-barre"); if (b) { b.style.width = Math.round(100 * AP.envoi.fait / AP.envoi.total) + "%"; $("ap-envoi-n").textContent = AP.envoi.fait + " / " + AP.envoi.total; }
    };
    for (let c = 0; c < t.carrousels.length; c++) {
      const C = t.carrousels[c];
      for (let k = 0; k < C.slides.length; k++) {
        const x = C.slides[k], img = x.video ? await apImageDeVideo(x.f) : x.f;
        await poser({ rayon: "slides", nom: "slide-" + (k + 1) + ".jpg", car: c, carNom: C.nom, n: k + 1, video: x.video ? 1 : 0 }, await apJpeg(img, 1080));
      }
    }
    for (const e of t.elements) await poser({ rayon: "elements", nom: e.f.name, transp: e.transp ? 1 : 0 }, e.f);
    for (const e of t.fonds) await poser({ rayon: "fonds", nom: e.f.name }, e.f);
    for (const e of t.gifs) await poser({ rayon: "gifs", nom: e.f.name }, e.f);
    for (const e of t.polices) await poser({ rayon: "polices", nom: e.f.name }, e.f);
    const r = await (await fetch("/api/apprendre/" + s.id + "/lancer", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    if (r.erreur) throw new Error(r.erreur);
    AP.session = r; AP.etape = "travail"; damRendre(); apSuivre();
  } catch (err) { AP.etape = "tri"; AP.erreur = "L'envoi a échoué : " + (err.message || err); damRendre(); }
}
function apSuivre() {
  clearInterval(AP.sondage);
  AP.sondage = setInterval(async () => {
    if (!AP.session) return;
    try {
      const s = await (await fetch("/api/apprendre/" + AP.session.id)).json(); if (s.erreur) throw new Error(s.erreur);
      AP.session = s;
      if (s.etat !== "travail") { clearInterval(AP.sondage); AP.etape = s.etat === "fini" ? "resultats" : "travail"; if (s.etat === "fini") apPreparerResultats(); }
      if (etat.etape === "das" && DAM.vue === "apprendre") damRendre();
      else if (s.etat === "fini") informer("Le studio a fini d'apprendre ton style : rouvre ta " + apLib().nom + " pour vérifier ce qu'il a appris.");
    } catch (e) { /* on réessaie */ }
  }, 2500);
}

/* ---------- les résultats ---------- */
function apPreparerResultats() {
  const R = AP.session && AP.session.resultat; if (!R) return;
  AP.pol = {}; Object.keys(R.polices || {}).forEach(k => { AP.pol[k] = R.polices[k].choix || 0; });
  AP.couleurs = Object.assign({}, R.couleurs);
  AP.voix = true;
  apChargerPolices();
}
// les polices proposées, à comparer à l'œil : Google par un lien, celles de l'ordinateur ou du dossier par @font-face
function apChargerPolices() {
  const R = AP.session.resultat, google = [], css = [];
  Object.values(R.polices || {}).forEach(p => p.candidats.forEach(c => {
    if (c.source === "google" || (c.source === "studio" && !estPoliceLocale(c.nom, DAM.policesInfo))) google.push(c.nom);
    else if (c.source !== "studio") ["normal", "italique"].forEach(st => css.push(`@font-face{font-family:'${c.nom.replace(/'/g, "")}';src:url('/api/apprendre/${AP.session.id}/police?nom=${encodeURIComponent(c.nom)}&style=${st}');font-style:${st === "italique" ? "italic" : "normal"}}`));
  }));
  let st = $("ap-polices-css"); if (!st) { st = document.createElement("style"); st.id = "ap-polices-css"; document.head.appendChild(st); } st.textContent = css.join("");
  let l = $("ap-polices-lien"); if (l) l.remove();
  if (google.length) { l = document.createElement("link"); l.id = "ap-polices-lien"; l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?" + [...new Set(google)].map(f => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":ital@0;1").join("&") + "&display=swap"; document.head.appendChild(l); }
  poserPolicesLocales(document, "ap-polices-locales", Object.values(R.polices || {}).flatMap(p => p.candidats.filter(c => c.source === "studio").map(c => c.nom)), DAM.policesInfo);
}
// un Markdown simple (titres, gras, code, listes) → HTML échappé
function apMarkdown(md) {
  const e = x => echapper(x).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  let h = "", liste = false;
  for (const l of String(md || "").split(/\r?\n/)) {
    const m = l.match(/^(#{1,4})\s+(.*)$/), li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (!li && liste) { h += "</ul>"; liste = false; }
    if (m) h += `<h${Math.min(4, m[1].length + 2)}>${e(m[2])}</h${Math.min(4, m[1].length + 2)}>`;
    else if (li) { if (!liste) { h += "<ul>"; liste = true; } h += "<li>" + e(li[1]) + "</li>"; }
    else if (l.trim()) h += "<p>" + e(l) + "</p>";
  }
  return h + (liste ? "</ul>" : "");
}

// une couleur claire (le texte posé dessus passe en noir)
const apClaire = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return false; const n = parseInt(m[1], 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) > 160; };

/* ---------- le rendu ---------- */
function apRendre() {
  const d = damCourant(), L = apLib();
  const haut = `<div class="dsd-haut"><button type="button" class="dpl-retour dsd-retour" id="ap-retour">← ${L.nom} de ${echapper(d ? d.nom : "")}</button><h1 class="ap-titre">✦ Apprendre mon style</h1></div>`;
  if (AP.etape === "depot") return haut + `<div class="ap-cadre"><div class="ap-depot" id="ap-depot">
      <span class="ico">📁</span><h2>Glisse ici ton dossier</h2>
      <p>Un seul dossier, en vrac : tes ${L.pluriel} (un sous-dossier par ${L.court}, ou juste les slides) et tout ce que tu veux que le studio utilise. <b>Il trie tout seul, tu vérifies.</b> Rien ne part tant que tu n'as pas cliqué « Apprendre mon style ».</p>
      <div class="ap-ligne"><label class="pg-btn pg-btn-go">Choisir un dossier<input type="file" id="ap-choisir" webkitdirectory multiple hidden></label><label class="pg-btn">ou des fichiers<input type="file" id="ap-fichiers" multiple hidden></label></div>
      <div class="ap-exemple">
        <div><b>🖼️ Tes ${L.pluriel}</b>PNG, JPG, et même les slides vidéo (MP4). 5 à 10, c'est l'idéal.</div>
        <div><b>✂️ Tes éléments</b>patchs, stickers, flèches, logos, cadres. En PNG détouré si tu l'as.</div>
        <div><b>🔤 Tes polices</b>.otf, .ttf : elles restent sur ton ordinateur.</div>
        <div><b>🎞️ Tes GIF</b>.gif ou petites vidéos : ils rejoignent ta bibliothèque.</div></div>
      ${AP.occupe ? `<p class="ap-occupe">${echapper(AP.occupe)}</p>` : ""}${AP.erreur ? `<p class="dcr-erreur">${echapper(AP.erreur)}</p>` : ""}</div></div>`;
  if (AP.etape === "tri") {
    const t = AP.tri, sec = (titre, sous, corps) => `<div class="ap-sec"><div class="ap-sec-t"><h3>${titre}</h3><small>${sous}</small></div>${corps}</div>`;
    const vign = s => `<div class="ap-vign">${s.vid ? `<video src="${s.vid}#t=0.5" muted preload="metadata"></video>` : `<img src="${s.url}" alt="" loading="lazy">`}${s.video ? "<i>▶ vidéo</i>" : s.anim ? "<i>+ anim.</i>" : ""}</div>`;
    const opts = [["elements", "élément"], ["fonds", "fond"], ["gifs", "GIF"], ["ignores", "ne pas utiliser"]];
    const item = (x, rayon, i) => `<div class="ap-item ${rayon !== "elements" ? "plein" : ""}">${x.vid ? `<span><video src="${x.vid}#t=0.5" muted preload="metadata"></video></span>` : `<span style="background-image:url('${x.url}')"></span>`}<em title="${echapper(x.nom)}">${echapper(x.nom)}</em>
      <select data-rayon="${rayon}" data-i="${i}">${opts.map(([k, n]) => `<option value="${k}" ${k === rayon ? "selected" : ""}>${n}</option>`).join("")}</select></div>`;
    return haut + `<div class="ap-cadre">
      <div class="ap-sec-t"><h3 class="ap-grand">📁 ${echapper(t.nom)} — voilà comment j'ai rangé ton dossier</h3></div>
      <div class="ap-resume"><span><b>${t.carrousels.length}</b> ${L.pluriel}</span><span><b>${apNSlides(t)}</b> slides</span><span><b>${t.elements.length}</b> éléments</span><span><b>${t.gifs.length}</b> GIF</span><span><b>${t.fonds.length}</b> fond${t.fonds.length > 1 ? "s" : ""}</span>${t.polices.length ? `<span><b>${t.polices.length}</b> polices</span>` : ""}<span><b>${t.ignores.length}</b> mis de côté</span></div>
      ${sec(`🖼️ Tes ${L.pluriel} d'exemple`, "un sous-dossier = un " + L.court + " · « + anim. » : la partie animée d'une slide, trouvée à côté", t.carrousels.length ? t.carrousels.map((c, k) => `<div class="ap-car"><div><b>${echapper(c.nom)}</b><small>${c.slides.length} slides</small><button type="button" class="ap-x" data-retirer-car="${k}" title="Ne pas utiliser ce ${L.court}">×</button></div><div class="ap-bande">${c.slides.map(vign).join("")}</div></div>`).join("")
        : `<p class="dtr-aide">Aucun ${L.court} trouvé : ajoute au moins 3 ${L.pluriel} (des images au format ${AP.sous === "story" ? "9:16" : "4:5 ou carré"}).</p>`)}
      ${t.elements.length ? sec("✂️ Tes éléments", "détourés sur ton ordinateur si besoin, puis nommés par Claude · mal rangé ? change-le de place", `<div class="ap-tas">${t.elements.map((x, i) => item(x, "elements", i)).join("")}</div>`) : ""}
      ${t.fonds.length ? sec("🟫 Ton fond de slide", "une grande image unie, posée derrière tes slides", `<div class="ap-tas">${t.fonds.map((x, i) => item(x, "fonds", i)).join("")}</div>`) : ""}
      ${t.gifs.length ? sec("🎞️ Tes GIF", "ajoutés à ta bibliothèque, Claude dira quand les utiliser", `<div class="ap-tas">${t.gifs.map((x, i) => item(x, "gifs", i)).join("")}</div>`) : ""}
      ${t.polices.length ? sec("🔤 Tes polices", "ajoutées au studio, sur ton ordinateur seulement", `<div class="ap-resume">${t.polices.map(p => `<span>${echapper(p.nom)}</span>`).join("")}</div>`) : ""}
      ${t.ignores.length ? sec("Mis de côté", "le studio n'en a pas besoin", `<div class="ap-ignores">${t.ignores.map(x => `<div><code>${echapper(x.nom)}</code><span>${echapper(x.pourquoi)}</span></div>`).join("")}</div>`) : ""}
      ${AP.erreur ? `<p class="dcr-erreur">${echapper(AP.erreur)}</p>` : ""}
      <div class="ap-pied"><p><b>Tout est bien rangé ?</b> Le studio va regarder ${t.carrousels.length > 1 ? "tes " + t.carrousels.length + " " + L.pluriel : "ton " + L.court}, écrire ta charte et se tester.<br>Gratuit (ton abonnement Claude) · environ 5 à 10 minutes · ta ${L.nom} n'est pas touchée avant ton accord.</p>
        <button type="button" class="pg-btn" id="ap-changer">Changer de dossier</button><button type="button" class="pg-btn pg-btn-go" id="ap-lancer">✦ Apprendre mon style</button></div></div>`;
  }
  if (AP.etape === "envoi") return haut + `<div class="ap-cadre ap-attente"><h2>J'envoie ton dossier au studio…</h2><p>Les slides partent réduites (1080 px) ; rien ne quitte ton ordinateur.</p>
    <div class="ap-jauge"><i id="ap-barre" style="width:${Math.round(100 * AP.envoi.fait / Math.max(1, AP.envoi.total))}%"></i></div><p id="ap-envoi-n">${AP.envoi.fait} / ${AP.envoi.total}</p></div>`;
  const s = AP.session || {};
  if (AP.etape === "travail") return haut + `<div class="ap-cadre"><div class="ap-attente"><h2>${s.etat === "erreur" ? "L'apprentissage s'est arrêté" : "J'apprends ton style…"}</h2>
      <p>${s.etat === "erreur" ? echapper(s.erreur || "") : "5 à 10 minutes. Tu peux aller ailleurs dans le studio : ça continue, et ta " + L.nom + " te montrera le résultat."}</p></div>
    <div class="ap-etapes">${(s.etapes || []).map((e, i) => `<div class="ap-etape ${e.etat}"><i>${e.etat === "fait" ? "✓" : ""}</i><div>${echapper(e.t)}${e.etat === "en-cours" && s.message ? `<small>${echapper(s.message)}</small>` : ""}</div><small>${e.etat === "fait" ? "fait" : e.etat === "en-cours" ? "en cours" : ""}</small></div>`).join("")}</div>
    ${s.etat === "erreur" ? `<p style="text-align:center;margin-top:16px"><button type="button" class="pg-btn pg-btn-go" id="ap-relancer">Relancer l'apprentissage</button> <button type="button" class="pg-btn" id="ap-recommencer">Recommencer avec un autre dossier</button></p>` : ""}</div>`;
  return haut + apResultats();
}
function apResultats() {
  const s = AP.session, R = s.resultat, L = apLib(), d = damCourant();
  if (!R) return `<div class="ap-cadre"><p>Aucun résultat.</p></div>`;
  const img = (rayon, f, cls) => `<img class="${cls || ""}" src="${apUrl(rayon, f)}" alt="" loading="lazy">`;
  const pol = (k, titre, ech, style) => { const p = R.polices[k]; if (!p) return "";
    return `<div class="ap-etq">${titre}</div><p class="ap-petit">${echapper(p.description || "")}</p><div class="ap-polices">${p.candidats.map((c, i) => `<label class="ap-pol ${AP.pol[k] === i ? "on" : ""}"><input type="radio" name="ap-pol-${k}" data-pol="${k}" data-i="${i}" ${AP.pol[k] === i ? "checked" : ""}>
      <span class="ech" style="font-family:'${echapper(c.nom)}';${style || ""}">${echapper(ech)}<small>${echapper(c.nom)}</small></span><span class="src ${c.source === "ordinateur" || c.source === "dossier" || c.source === "studio" ? "local" : ""}">${{ google: "Google Fonts, gratuite", ordinateur: "sur ton ordinateur ✓", dossier: "dans ton dossier ✓", studio: "déjà dans le studio ✓" }[c.source] || ""}</span></label>`).join("")}</div>
      <button type="button" class="btn-mini ap-pol-plus" data-pol-ajout="${k}">Ma police n'est pas là : choisir son fichier (.ttf, .otf)</button>`; };
  const RUBS = [
    { id: "couleurs", titre: "Tes couleurs", quoi: "celles de tes slides — un clic pour en changer une",
      corps: `<div class="ap-sw">${[["fond", "Fond"], ["texte", "Texte"], ["accent", "Accent"], ["second", "Seconde"]].map(([k, n]) => `<button type="button" class="ap-coul ${apClaire(AP.couleurs[k]) ? "claire" : ""}" data-c="${k}" style="background:${AP.couleurs[k]}"><span>${n}<code>${AP.couleurs[k]}</code></span></button>`).join("")}</div><p class="ap-petit">${echapper(R.style || "")}</p>`, corriger: true },
    { id: "polices", titre: "Tes polices", quoi: "les plus proches que j'ai trouvées : choisis à l'œil", vis: R.exemples[0] ? img("slides", R.exemples[0].fichier, "ap-orig") + `<p class="ap-petit">ton original</p>` : "",
      corps: pol("titres", "Titres et paragraphes", "Cette vidéo a trompé tout le monde.", "font-size:26px") + pol("appui", "Les mots mis en valeur", "tout le monde.", "font-style:italic;font-size:26px") + pol("texte", "Les petits textes, les encadrés", "Tu passes 20 minutes sur ton image.", "font-size:17px") },
    { id: "charte", titre: "Ta charte", quoi: "le cahier des charges de ton style, écrit par Claude. Il le lit en entier pour chaque " + L.court,
      corps: `<div class="ap-charte ${AP.charteOuverte ? "ouverte" : ""}">${apMarkdown(R.charte)}</div><button type="button" class="btn-mini" id="ap-charte-plus">${AP.charteOuverte ? "Replier" : "Lire toute la charte"}</button>`, corriger: true },
    { id: "exemples", titre: "Tes slides d'exemple", quoi: "Claude les regarde avant chaque mise en page : elles montrent le style",
      corps: `<div class="ap-exemples">${R.exemples.map(x => img("slides", x.fichier)).join("")}</div>` },
    { id: "elements", titre: "Tes éléments", quoi: `${R.elements.length} trouvés dans ton dossier, nommés par Claude. Décoche ceux à ne pas garder.`,
      corps: R.elements.length ? `<div class="ap-els">${R.elements.slice(0, AP.tousEls ? 999 : 8).map((e, i) => `<div class="ap-el ${e.garder ? "" : "off"}"><span class="${e.transp ? "pg-damier" : ""}" style="background-image:url('${apUrl("elements", e.fichier)}')"></span>
          <div><input class="pg-champ" data-el="${i}" data-k="nom" maxlength="60" value="${echapper(e.nom)}"><textarea class="pg-champ" data-el="${i}" data-k="quand" rows="2" maxlength="300">${echapper(e.quand)}</textarea></div>
          <label title="Garder"><input type="checkbox" data-el="${i}" data-k="garder" ${e.garder ? "checked" : ""}></label></div>`).join("")}</div>${R.dejaEls ? `<label class="ap-coche" style="margin-top:10px"><input type="checkbox" id="ap-remplacer" ${AP.remplacer !== false ? "checked" : ""}> <span>Remplacer les ${R.dejaEls} éléments actuels de ta ${L.nom} <small>(ils partent dans la corbeille de la DA ; décoché, les nouveaux s'ajoutent)</small></span></label>` : ""}${R.elements.length > 8 ? `<button type="button" class="btn-mini" id="ap-tous-els" style="margin-top:8px">${AP.tousEls ? "Replier" : "Voir les " + R.elements.length + " éléments"}</button>` : ""}` : `<p class="ap-petit">Aucun élément dans ton dossier.</p>` },
    ...(R.manquants.length ? [{ id: "manquants", titre: "Il en manque ?", quoi: "vus sur tes slides, mais pas dans ton dossier",
      corps: `<div class="ap-manq">${R.manquants.map((m, k) => `<div><b>${echapper(m.nom)}</b><span>${echapper(m.description)}</span>
        <button type="button" class="btn-mini" data-manq-fichier="${k}">Ajouter son fichier</button>${m.vu ? `<button type="button" class="btn-mini" data-manq-decouper="${k}">Le découper dans mes slides</button>` : ""}</div>`).join("")}</div>
        <p class="ap-petit">Découpé dans une slide, il est moins propre qu'un vrai fichier : tu pourras le remplacer plus tard.</p>` }] : []),
    ...(R.gifs.length ? [{ id: "gifs", titre: "Tes GIF", quoi: `${R.gifs.length} pour ta bibliothèque de GIF`,
      corps: `<div class="ap-els">${R.gifs.map((g, i) => `<div class="ap-el ${g.garder ? "" : "off"}"><span style="background-image:url('${g.image ? apUrl("gifs", g.image) : ""}');background-size:cover"></span>
          <div><input class="pg-champ" data-gif="${i}" data-k="nom" maxlength="60" value="${echapper(g.nom)}"><textarea class="pg-champ" data-gif="${i}" data-k="quand" rows="2" maxlength="300">${echapper(g.quand)}</textarea></div>
          <label title="Garder"><input type="checkbox" data-gif="${i}" data-k="garder" ${g.garder ? "checked" : ""}></label>${g.deja ? `<small class="ap-deja">déjà dans ta bibliothèque (« ${echapper(g.deja)} ») : il sera relié à ta DA, pas copié une 2e fois</small>` : ""}</div>`).join("")}</div>` }] : []),
    { id: "voix", titre: "Ta voix", quoi: "le texte de tes " + L.pluriel,
      corps: `<p>J'ai lu le texte de tes ${R.voix.n} ${L.pluriel} : <b>${(R.voix.texte || "").length.toLocaleString("fr-FR")} caractères</b>, tes expressions, ta longueur de phrase, tes vannes.</p>
        <label class="ap-coche"><input type="checkbox" id="ap-voix" ${AP.voix ? "checked" : ""}> <span>Les ajouter à « Tes phrases à toi » de ${echapper(d ? d.nom : "")}. <small>C'est commun : tes Reels, tes carrousels et tes stories parleront pareil.</small></span></label>` },
    ...((R.tests || []).length ? [{ id: "test", titre: "Le test", quoi: "des slides faites avec ta charte, à côté de tes vraies slides",
      corps: `<div class="ap-deux">${R.tests.map(x => `<figure>${img("slides", x.original)}<figcaption>ton original</figcaption></figure><figure>${img("racine", x.test)}<figcaption>le studio, avec ta charte</figcaption></figure>`).join("")}</div>
        ${(R.corrections || []).length ? `<p><b>Après le test, j'ai corrigé ma charte :</b></p><ul class="ap-corr">${R.corrections.map(c => `<li>${echapper(c)}</li>`).join("")}</ul>` : ""}`, corriger: true }] : [])
  ];
  const fait = RUBS.filter(r => AP.valide[r.id]).length;
  return `<div class="ap-tete"><h2>Voilà ce que j'ai appris de ${R.n > 1 ? "tes " + R.n + " " + L.pluriel : "ton " + L.court}</h2><p>Vérifie chaque rubrique. Ce que tu écris dans « Corriger » passe avant tout le reste : je refais la charte d'après toi.${s.avertissement ? " " + echapper(s.avertissement) : ""}</p></div>
    ${RUBS.map(r => `<div class="ap-rub ${AP.valide[r.id] ? "ok" : ""}" id="ap-rub-${r.id}"><div><h3>${r.titre}</h3><div class="ap-quoi">${r.quoi}</div>${r.vis ? `<div class="ap-vis">${r.vis}</div>` : ""}</div>
      <div class="ap-corps">${r.corps}</div>
      <div class="ap-act"><button type="button" class="pg-btn ${AP.valide[r.id] ? "ap-ok" : ""}" data-ok="${r.id}">${AP.valide[r.id] ? "✓ Validé" : "C'est bon"}</button>${r.corriger ? `<button type="button" class="pg-btn dsd-fantome" data-corr="${r.id}">Corriger</button>` : ""}</div>
      ${r.corriger ? `<div class="ap-corrige ${AP.corrige[r.id] ? "on" : ""}"><textarea class="pg-champ" id="ap-corr-${r.id}" rows="3" placeholder="Dis ce qui ne va pas, avec tes mots. Ex. « la bulle, c'est seulement sur la dernière slide »"></textarea><div><button type="button" class="pg-btn pg-btn-go" data-envoyer="${r.id}" ${AP.occupe ? "disabled" : ""}>${AP.occupe === r.id ? "Claude corrige…" : "Envoyer à Claude"}</button></div></div>` : ""}</div>`).join("")}
    ${AP.erreur ? `<p class="dcr-erreur">${echapper(AP.erreur)}</p>` : ""}
    <div class="ap-pied"><span class="ap-compte"><b>${fait}</b> / ${RUBS.length} rubriques vérifiées</span><p>Rien n'est encore dans ta ${L.nom}.</p>
      <button type="button" class="pg-btn" id="ap-recommencer">Recommencer avec un autre dossier</button>
      <button type="button" class="pg-btn pg-btn-go" id="ap-enregistrer" ${AP.occupe ? "disabled" : ""}>${AP.occupe === "enregistrer" ? "Enregistrement…" : "Enregistrer dans la " + L.nom}</button></div>`;
}

/* ---------- les gestes ---------- */
function apBrancher() {
  const q = id => $(id);
  q("ap-retour").onclick = () => { clearInterval(AP.sondage); damAller(damCourant() && damCourant().sous[AP.sous] ? "sous" : "da", { sous: AP.sous }); if (AP.session && AP.session.etat === "travail") apSuivre(); };
  const trier = async l => { if (!l.length) return; AP.occupe = "Je trie ton dossier…"; damRendre(); try { AP.tri = await apTrier(l); AP.etape = "tri"; } catch (e) { AP.erreur = "Le tri a échoué : " + (e.message || e); } AP.occupe = ""; damRendre(); };
  const depot = q("ap-depot");
  if (depot) {
    ["dragenter", "dragover"].forEach(e => depot.addEventListener(e, ev => { ev.preventDefault(); depot.classList.add("survol"); }));
    depot.addEventListener("dragleave", () => depot.classList.remove("survol"));
    depot.addEventListener("drop", async ev => { ev.preventDefault(); depot.classList.remove("survol"); trier(await apLireDepot(ev.dataTransfer)); });
  }
  if (q("ap-choisir")) q("ap-choisir").onchange = ev => trier([...ev.target.files].map(f => ({ f, chemin: f.webkitRelativePath || f.name })));
  if (q("ap-fichiers")) q("ap-fichiers").onchange = ev => trier([...ev.target.files].map(f => ({ f, chemin: f.name })));
  document.querySelectorAll(".ap-cadre select[data-rayon]").forEach(s => s.onchange = () => {
    const de = s.dataset.rayon, i = +s.dataset.i, x = AP.tri[de].splice(i, 1)[0];
    if (s.value === "ignores") AP.tri.ignores.push({ nom: x.nom, pourquoi: "mis de côté par toi" }); else { if (s.value === "elements" && x.transp == null) x.transp = false; AP.tri[s.value].push(x); }
    damRendre();
  });
  document.querySelectorAll("[data-retirer-car]").forEach(b => b.onclick = () => { const c = AP.tri.carrousels.splice(+b.dataset.retirerCar, 1)[0]; AP.tri.ignores.push({ nom: c.nom, pourquoi: "mis de côté par toi" }); damRendre(); });
  if (q("ap-changer")) q("ap-changer").onclick = () => { AP.tri = null; AP.etape = "depot"; AP.erreur = ""; damRendre(); };
  if (q("ap-lancer")) q("ap-lancer").onclick = apEnvoyer;
  const recommencer = () => { try { localStorage.removeItem(apCle()); } catch (e) {} Object.assign(AP, { etape: "depot", tri: null, session: null, valide: {}, corrige: {}, erreur: "" }); damRendre(); };
  if (q("ap-recommencer")) q("ap-recommencer").onclick = recommencer;
  if (q("ap-relancer")) q("ap-relancer").onclick = async () => {
    const r = await (await fetch("/api/apprendre/" + AP.session.id + "/lancer", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    if (r.erreur) { informer(r.erreur); return; } AP.session = r; damRendre(); apSuivre();
  };
  // les résultats
  if (!AP.session || !AP.session.resultat) return;
  const R = AP.session.resultat;
  document.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => { AP.valide[b.dataset.ok] = !AP.valide[b.dataset.ok]; damRendre(); });
  document.querySelectorAll("[data-corr]").forEach(b => b.onclick = () => { AP.corrige[b.dataset.corr] = !AP.corrige[b.dataset.corr]; damRendre(); });
  document.querySelectorAll("[data-envoyer]").forEach(b => b.onclick = async () => {
    const r = b.dataset.envoyer, t = (q("ap-corr-" + r).value || "").trim(); if (!t) return;
    AP.occupe = r; damRendre();
    try { const x = await (await fetch("/api/apprendre/" + AP.session.id + "/corriger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rubrique: r, texte: t }) })).json();
      if (x.erreur) throw new Error(x.erreur); AP.session = x; AP.couleurs = Object.assign({}, x.resultat.couleurs); AP.corrige[r] = false; AP.valide[r] = false; AP.erreur = ""; }
    catch (err) { AP.erreur = "La correction a échoué : " + (err.message || err); }
    AP.occupe = ""; damRendre();
    const x = q("ap-rub-" + r); if (x) x.scrollIntoView({ block: "center" });
  });
  document.querySelectorAll("[data-pol]").forEach(x => x.onchange = () => { AP.pol[x.dataset.pol] = +x.dataset.i; damRendre(); });
  // « Ma police n'est pas là » : son fichier rejoint la session, en tête du rôle, choisi d'office (1er oct. 2026)
  document.querySelectorAll("[data-pol-ajout]").forEach(b => b.onclick = async () => {
    const f = (await pgChoisirFichiers(".ttf,.otf,.woff,.woff2"))[0]; if (!f) return;
    const role = b.dataset.polAjout; b.disabled = true; b.textContent = "Ajout…";
    try { const x = await (await fetch("/api/apprendre/" + AP.session.id + "/police-ajout?" + new URLSearchParams({ role, nom: f.name }), { method: "POST", body: f })).json();
      if (x.erreur) throw new Error(x.erreur); AP.session = x; AP.pol[role] = 0; apChargerPolices(); }
    catch (err) { informer("La police n'a pas pu être ajoutée : " + (err.message || err)); }
    damRendre();
  });
  document.querySelectorAll(".ap-coul").forEach(b => b.onclick = () => {
    const k = b.dataset.c, avant = AP.couleurs[k];
    nuancier(b, avant, { titre: "Couleur « " + k + " »", surChange: c => { AP.couleurs[k] = c; b.style.background = c; b.querySelector("code").textContent = c; }, surAnnule: () => { AP.couleurs[k] = avant; damRendre(); } });
  });
  if (q("ap-charte-plus")) q("ap-charte-plus").onclick = () => { AP.charteOuverte = !AP.charteOuverte; damRendre(); };
  if (q("ap-tous-els")) q("ap-tous-els").onclick = () => { AP.tousEls = !AP.tousEls; damRendre(); };
  const champ = (attr, liste) => document.querySelectorAll("[" + attr + "]").forEach(x => {
    const i = +x.getAttribute(attr), k = x.dataset.k;
    if (k === "garder") x.onchange = () => { liste[i].garder = x.checked; damRendre(); };
    else x.oninput = () => { liste[i][k] = x.value; };
  });
  champ("data-el", R.elements); champ("data-gif", R.gifs);
  if (q("ap-voix")) q("ap-voix").onchange = ev => { AP.voix = ev.target.checked; };
  if (q("ap-remplacer")) q("ap-remplacer").onchange = ev => { AP.remplacer = ev.target.checked; };
  document.querySelectorAll("[data-manq-fichier]").forEach(b => b.onclick = async () => {
    const f = (await pgChoisirFichiers("image/png,image/jpeg,image/webp"))[0]; if (!f) return;
    let transp = false; try { transp = (await apAnalyser(f)).transp > 0.02; } catch (e) {}
    const k = b.dataset.manqFichier, m = R.manquants[+k];
    const x = await (await fetch("/api/apprendre/" + AP.session.id + "/manquant?" + new URLSearchParams({ k, nom: f.name, transp: transp ? 1 : 0 }), { method: "POST", body: f })).json();
    if (x.erreur) { informer(x.erreur); return; } AP.session = x; damRendre();
  });
  document.querySelectorAll("[data-manq-decouper]").forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = "Claude le cherche sur la slide…";
    try { const x = await (await fetch("/api/apprendre/" + AP.session.id + "/decouper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: +b.dataset.manqDecouper }) })).json();
      if (x.erreur) throw new Error(x.erreur); AP.session = x; }
    catch (err) { informer("Le découpage a échoué : " + (err.message || err)); }
    damRendre();
  });
  if (q("ap-enregistrer")) q("ap-enregistrer").onclick = async () => {
    AP.occupe = "enregistrer"; damRendre();
    try {
      let x = await (await fetch("/api/apprendre/" + AP.session.id + "/enregistrer", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polices: AP.pol, couleurs: AP.couleurs, voix: AP.voix, remplacerElements: !!R.dejaEls && AP.remplacer !== false, elements: R.elements.map(e => ({ nom: e.nom, quand: e.quand, garder: e.garder })), gifs: R.gifs.map(g => ({ nom: g.nom, quand: g.quand, garder: g.garder })) }) })).json();
      if (x.erreur) throw new Error(x.erreur);
      // l'enregistrement tourne sur le serveur (le détourage de chaque élément prend quelques secondes) : on le suit
      while (x.etat === "enregistrement") {
        await new Promise(r => setTimeout(r, 1500));
        x = await (await fetch("/api/apprendre/" + AP.session.id)).json(); if (x.erreur) throw new Error(x.erreur);
        const b = $("ap-enregistrer"); if (b) b.textContent = x.message || "Enregistrement…";
      }
      if (x.etat !== "enregistre") throw new Error(x.erreurEnreg || "l'enregistrement s'est arrêté");
      x = x.bilan || { elements: 0, gifs: 0 };
      try { localStorage.removeItem(apCle()); } catch (e) {}
      AP.occupe = ""; await damCharger();
      DAM.etat = "Style appris ✓ — " + x.elements + " élément" + (x.elements > 1 ? "s" : "") + (x.gifs ? ", " + x.gifs + " GIF" : "") + ", la charte et tes slides d'exemple";
      damAller("sous", { sous: AP.sous });
    } catch (err) { AP.occupe = ""; AP.erreur = "L'enregistrement a échoué : " + (err.message || err); damRendre(); }
  };
}
