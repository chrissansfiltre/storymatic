/* ============================================================
   STORYMATIC — la bibliothèque de polices

   Tout Google Fonts pour l'alphabet latin, chaque police écrite AVEC le texte de la personne,
   la recherche, les familles, le tri. Cliquer une carte l'ESSAIE (surEssai) ; « Ajouter » la
   range dans les polices du studio, communes à tout le studio comme les DA (serveur :
   ajouterPolice, IDENTITES/polices-ajoutees.json) — elle vaut alors partout : les DA, l'éditeur,
   la page des slides et l'export. Mise au point dans LABO/bibliotheque-polices/, installée le
   23 septembre 2026.

   Les aperçus ne se téléchargent qu'au moment où la carte entre à l'écran, et seulement avec
   les lettres du texte (paramètre « text » de Google Fonts) : quelques ko par police.

   ouvrirBibliothequePolices({ texte, courante, surEssai(nom, fiche), surFermer(essai), surChange() })
   ============================================================ */

const BP_CATS = [["", "Toutes"], ["s", "Sans empattement"], ["e", "Avec empattement"], ["a", "Affiche"], ["m", "Manuscrite"], ["t", "Machine à écrire"]];
const BP_NOMS_CAT = { s: "sans empattement", e: "avec empattement", a: "affiche", m: "manuscrite", t: "machine à écrire" };
const BP_PAR_PAGE = 48;
let bpCatalogue = null;          // [nom, catégorie, popularité, "graisses", italique, année], gardé le temps de la session
const bpChargees = new Set();

// La fiche d'une police du catalogue.
function bpFiche(nom) {
  const x = (bpCatalogue || []).find(f => f[0] === nom);
  return x ? { nom: x[0], cat: x[1], graisses: x[3].split(",").map(Number).filter(Boolean), italique: !!x[4] } : null;
}
// La pile CSS d'une police : son nom, puis la famille générique qui lui ressemble.
function bpPile(nom, cat) {
  const c = cat || ((typeof PG !== "undefined" && PG.policesInfo && PG.policesInfo[nom]) || bpFiche(nom) || {}).cat;
  return '"' + nom + '", ' + (c === "e" ? "serif" : c === "m" ? "cursive" : c === "t" ? "monospace" : "sans-serif");
}
// Un aperçu : une graisse, et les seules lettres du texte.
function bpChargerApercu(nom, texte, doc) {
  doc = doc || document;
  const cle = nom + "|" + texte;
  if (doc === document && bpChargees.has(cle)) return;
  if (doc === document) bpChargees.add(cle);
  const f = bpFiche(nom), g = f ? f.graisses : [400];
  let famille = "family=" + encodeURIComponent(nom).replace(/%20/g, "+");
  if (g.length > 1) famille += ":wght@" + (g.includes(400) ? 400 : g[0]);
  famille += "&text=" + encodeURIComponent([...new Set(texte + nom)].join(""));
  const l = doc.createElement("link");
  l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?" + famille + "&display=swap";
  doc.head.appendChild(l);
}
// Les polices du studio ont changé : l'application garde la liste que rend le serveur.
function bpMajPolices(etat) {
  if (typeof PG === "undefined" || !etat) return;
  PG.polices = etat.polices || PG.polices;
  PG.policesInfo = etat.policesInfo || PG.policesInfo;
  PG.policesAjoutees = etat.policesAjoutees || [];
}

/* LES POLICES DE L'ORDINATEUR (30 sept. 2026) : un fichier rangé par le studio (IDENTITES/_polices-locales), chargé par
   @font-face — pas par Google Fonts. `infos` : la fiche des polices (policesInfo), qui dit « locale » et ses fichiers. */
function policesLocalesCss(noms, infos) {
  return (noms || []).filter(f => (infos || {})[f] && infos[f].locale).map(f => Object.entries(infos[f].fichiers || {}).map(([st, fi]) =>
    "@font-face{font-family:'" + String(f).replace(/['\\]/g, "") + "';src:url('/polices-locales/" + encodeURIComponent(fi) + "');font-style:" + (st === "italique" ? "italic" : "normal") + ";font-weight:400;font-display:swap}").join("")).join("");
}
function poserPolicesLocales(doc, id, noms, infos) {
  const css = policesLocalesCss(noms, infos); let s = doc.getElementById(id);
  if (!css) { if (s) s.remove(); return; }
  if (!s) { s = doc.createElement("style"); s.id = id; doc.head.appendChild(s); }
  if (s.textContent !== css) s.textContent = css;
}
const estPoliceLocale = (f, infos) => !!((infos || {})[f] || {}).locale;
// importer une police de l'ordinateur (un ou plusieurs fichiers : le style se lit dans le nom — « Italic », « Oblique »)
async function importerPolicesLocales() {
  const fichiers = await pgChoisirFichiers(".otf,.ttf,.woff,.woff2", true);
  if (!fichiers.length) return null;
  const devine = fichiers[0].name.replace(/\.[^.]+$/, "").replace(/[-_ ]*(regular|italic|oblique|ital|book)\b/gi, " ").replace(/\s+/g, " ").trim();
  const nom = await saisir("Le nom de cette police", devine, { ok: "Ajouter", exemple: "ex. ITC Garamond Book Narrow", max: 60 });
  if (nom === null || !nom.trim()) return null;
  let r = null;
  for (const f of fichiers) {
    const style = /ital|oblique/i.test(f.name) ? "italique" : "normal";
    r = await (await fetch("/api/polices/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: nom.trim(), style, donnees: await pgLireFichier(f) }) })).json();
    if (r.erreur) { informer(r.erreur); return null; }
  }
  return r;
}
async function ouvrirBibliothequePolices(o) {
  o = o || {};
  document.querySelectorAll(".bp").forEach(x => x.remove());
  let apercu = String(o.texte || "").replace(/\s+/g, " ").trim().slice(0, 80) || "Quelle lumière façonne l'image ?";
  let cat = "", tri = "pop", recherche = "", taille = 36, montrees = 0, resultat = [], essai = null;

  const el = document.createElement("div");
  el.className = "bp";
  el.innerHTML =
    '<div class="bp-voile"></div>' +
    '<div class="bp-boite" role="dialog" aria-modal="true" aria-label="Plus de polices">' +
      '<div class="bp-tete"><div><h2>Plus de polices</h2><p>Les polices de Google Fonts : gratuites, et elles s\'affichent pareil sur tous les ordinateurs — y compris à l\'export.</p></div>' +
        '<button type="button" class="bp-fermer" title="Fermer (Échap)" aria-label="Fermer">×</button></div>' +
      '<div class="bp-outils">' +
        '<div class="bp-ligne"><label class="bp-cherche"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
          '<input type="search" class="bp-q" placeholder="Chercher une police : Bebas, Garamond, Space…" autocomplete="off"></label>' +
          '<select class="bp-tri"><option value="pop">Les plus utilisées d\'abord</option><option value="neuf">Les plus récentes d\'abord</option><option value="az">De A à Z</option></select></div>' +
        '<div class="bp-puces bp-cats"></div>' +
        '<div class="bp-ligne"><label class="bp-apercu-bloc"><input class="bp-apercu" maxlength="80" placeholder="Votre texte d\'aperçu"></label>' +
          '<label class="bp-taille">Taille <input type="range" min="18" max="72" value="36"></label></div>' +
        '<div class="bp-ajoutees"></div>' +
      '</div>' +
      '<div class="bp-liste"><p class="bp-compte">Chargement du catalogue de Google Fonts…</p><div class="bp-grille"></div><div class="bp-sentinelle"></div></div>' +
    '</div>';
  document.body.appendChild(el);
  const q = s => el.querySelector(s);
  q(".bp-apercu").value = apercu;

  const fermer = () => {
    document.removeEventListener("keydown", clavier, true);
    el.remove();
    if (o.surFermer) o.surFermer(essai);
  };
  const clavier = e => { if (e.key === "Escape" && !document.querySelector(".fen")) { e.preventDefault(); e.stopImmediatePropagation(); fermer(); } };
  document.addEventListener("keydown", clavier, true);
  q(".bp-fermer").onclick = fermer;
  q(".bp-voile").onclick = fermer;

  try {
    if (!bpCatalogue) { const r = await (await fetch("/api/polices/catalogue")).json(); if (r.erreur) throw new Error(r.erreur); bpCatalogue = r.liste || []; }
  } catch (err) { q(".bp-compte").textContent = err.message || String(err); return; }
  if (!el.isConnected) return;

  const studio = () => (typeof PG !== "undefined" && PG.polices) || [];
  const ajoutees = () => (typeof PG !== "undefined" && PG.policesAjoutees) || [];
  const base = () => studio().filter(n => !ajoutees().includes(n));
  const sansAccent = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // L'aperçu ne se charge qu'à l'écran : le catalogue entier ferait des centaines de téléchargements pour rien.
  const vue = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const c = e.target, nom = c.dataset.nom, ap = c.querySelector(".bp-carte-apercu");
    bpChargerApercu(nom, apercu);
    document.fonts.load("20px " + bpPile(nom, c.dataset.cat), apercu).then(() => ap.classList.remove("attend"), () => ap.classList.remove("attend"));
    vue.unobserve(c);
  }), { root: q(".bp-liste"), rootMargin: "200px" });
  new IntersectionObserver(es => { if (es[0].isIntersecting && montrees < resultat.length) suite(); }, { root: q(".bp-liste"), rootMargin: "600px" }).observe(q(".bp-sentinelle"));

  async function ajouter(nom, b) {
    b.disabled = true;
    try {
      const r = await (await fetch("/api/polices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: nom }) })).json();
      if (r.erreur) throw new Error(r.erreur);
      bpMajPolices(r);
      b.className = "bp-ajouter fait"; b.textContent = "Ajoutée ✓";
      rendreAjoutees();
      if (o.surChange) o.surChange();
    } catch (err) { b.textContent = "Échec"; b.title = err.message || String(err); }
    b.disabled = false;
  }
  async function retirer(nom) {
    try {
      const r = await (await fetch("/api/polices/" + encodeURIComponent(nom), { method: "DELETE" })).json();
      if (r.erreur) throw new Error(r.erreur);
      bpMajPolices(r);
    } catch (err) { /* la liste reste ce qu'elle était */ }
    rendreAjoutees(); filtrer();
    if (o.surChange) o.surChange();
  }

  function carte(x) {
    const [nom, c, , gs, it] = x, n = gs.split(",").filter(Boolean).length;
    const d = document.createElement("div");
    d.className = "bp-carte" + (nom === (essai || o.courante) ? " essai" : "");
    d.dataset.nom = nom; d.dataset.cat = c;
    d.title = o.surEssai ? "Cliquer pour l'essayer" : "";
    const dejaBase = base().includes(nom), dejaAjoutee = ajoutees().includes(nom);
    d.innerHTML =
      '<div class="bp-carte-nom"><b>' + echapper(nom) + "</b><span>" + BP_NOMS_CAT[c] + "</span></div>" +
      '<div class="bp-carte-apercu attend">' + echapper(apercu || nom) + "</div>" +
      '<div class="bp-carte-pied"><small>' + (n > 1 ? n + " graisses" : "1 graisse") + (it ? " · italique" : "") + "</small>" +
      '<button type="button" class="bp-ajouter' + (dejaBase ? " studio" : dejaAjoutee ? " fait" : "") + '">' +
        (dejaBase ? "Déjà dans le studio" : dejaAjoutee ? "Ajoutée ✓" : "Ajouter") + "</button></div>";
    /* La police et la taille se posent sur l'élément, pas dans le HTML : echapper() ne protège pas les
       guillemets, et « font-family:"Bebas Neue" » écrit dans un attribut style="…" le coupait net. */
    const apE = d.querySelector(".bp-carte-apercu");
    apE.style.fontFamily = bpPile(nom, c); apE.style.fontSize = taille + "px";
    d.onclick = ev => {
      if (ev.target.closest(".bp-ajouter") || !o.surEssai) return;
      el.querySelectorAll(".bp-carte.essai").forEach(z => z.classList.remove("essai"));
      d.classList.add("essai");
      essai = nom;
      o.surEssai(nom, bpFiche(nom));
    };
    const b = d.querySelector(".bp-ajouter");
    b.onclick = () => {
      if (dejaBase || ajoutees().includes(nom)) return;
      ajouter(nom, b);
      if (o.surEssai) { el.querySelectorAll(".bp-carte.essai").forEach(z => z.classList.remove("essai")); d.classList.add("essai"); essai = nom; o.surEssai(nom, bpFiche(nom)); }
    };
    vue.observe(d);
    return d;
  }
  function suite() {
    const g = q(".bp-grille");
    resultat.slice(montrees, montrees + BP_PAR_PAGE).forEach(x => g.appendChild(carte(x)));
    montrees = Math.min(resultat.length, montrees + BP_PAR_PAGE);
  }
  function filtrer() {
    const t = sansAccent(recherche.trim());
    resultat = bpCatalogue.filter(f => (!cat || f[1] === cat) && (!t || sansAccent(f[0]).includes(t)));
    if (tri === "az") resultat.sort((a, b) => a[0].localeCompare(b[0]));
    else if (tri === "neuf") resultat.sort((a, b) => (b[5] || "").localeCompare(a[5] || "") || a[2] - b[2]);
    else resultat.sort((a, b) => a[2] - b[2]);
    q(".bp-grille").innerHTML = ""; montrees = 0; q(".bp-liste").scrollTop = 0;
    q(".bp-compte").textContent = resultat.length ? resultat.length.toLocaleString("fr-FR") + " police" + (resultat.length > 1 ? "s" : "") + (cat ? " · " + BP_CATS.find(c => c[0] === cat)[1].toLowerCase() : "") : "";
    if (!resultat.length) { q(".bp-grille").innerHTML = '<p class="bp-vide">Aucune police ne porte ce nom. Essayez un autre mot, ou une autre famille.</p>'; return; }
    suite();
  }
  function rendreCats() {
    const z = q(".bp-cats"); z.innerHTML = "";
    BP_CATS.forEach(([v, nom]) => {
      const n = v ? bpCatalogue.filter(f => f[1] === v).length : bpCatalogue.length;
      const b = document.createElement("button"); b.type = "button"; b.className = "bp-puce" + (cat === v ? " on" : "");
      b.innerHTML = echapper(nom) + "<b>" + n.toLocaleString("fr-FR") + "</b>";
      b.onclick = () => { cat = v; rendreCats(); filtrer(); };
      z.appendChild(b);
    });
  }
  function rendreAjoutees() {
    const z = q(".bp-ajoutees"); z.innerHTML = "";
    const l = ajoutees();
    if (!l.length) { z.textContent = "Vos polices ajoutées apparaîtront ici, et dans le menu des polices — pour vos slides comme pour vos DA."; return; }
    z.appendChild(document.createTextNode("Vos polices ajoutées :"));
    l.forEach(n => {
      bpChargerApercu(n, n);
      const s = document.createElement("span"); s.className = "bp-puce bp-puce-ajoutee"; s.style.fontFamily = bpPile(n); s.textContent = n;
      const x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.title = "Retirer « " + n + " » des polices du studio (les slides qui l'emploient la gardent)";
      x.onclick = () => retirer(n);
      s.appendChild(x); z.appendChild(s);
    });
  }

  let minuteur = null;
  q(".bp-q").oninput = e => { recherche = e.target.value; clearTimeout(minuteur); minuteur = setTimeout(filtrer, 150); };
  q(".bp-tri").onchange = e => { tri = e.target.value; filtrer(); };
  q(".bp-apercu").oninput = e => { apercu = e.target.value; clearTimeout(minuteur); minuteur = setTimeout(filtrer, 350); };
  q(".bp-taille input").oninput = e => { taille = Number(e.target.value); el.querySelectorAll(".bp-carte-apercu").forEach(a => a.style.fontSize = taille + "px"); };
  rendreCats(); rendreAjoutees(); filtrer();
  setTimeout(() => q(".bp-q").focus(), 50);
}
