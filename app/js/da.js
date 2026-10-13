/* ============================================================
   VOS DA — le module des directions artistiques (27 sept. 2026 ; maquette LABO/module-da, pistes B et C)
   LES TROIS SOUS-DA (30 sept. 2026 ; maquette LABO/module-da-v2, validée) : une DA = un nom + UNE façon
   de parler (commune, demandée en premier) + trois sous-DA INDÉPENDANTES — DA Reel, DA Carrousel, DA Story. Pas de socle,
   pas d'héritage : chacune a ses couleurs, ses polices, son logo, ses fonds… Pas de sous-DA = pas de contenu de ce genre.

   Les écrans dans #step-das :
   · la GALERIE : chaque DA montre ses trois sous-DA (« ✓ » ou « à créer ») ;
   · la DA : sa façon de parler (le bandeau orange), puis ses trois sous-DA côte à côte, chacune dans ses couleurs ;
   · la PLANCHE d'une sous-DA, dans ses propres couleurs et polices : seulement ce qui sert à ce genre. Chaque tuile
     s'ouvre dans un tiroir ; tout s'enregistre au fil de l'eau ;
   · la CRÉATION d'une DA : le nom et la façon de parler, puis la DA s'ouvre avec ses trois cartes « à créer » ;
   · la CRÉATION d'une sous-DA : cinq départs (phrase, images, Reel, au hasard, une de mes DA) → TROIS propositions ; ou,
     pour le carrousel et la story, « Glisser mon dossier » (apprendre.js : le studio apprend le style d'un dossier).
   Les DA vivent dans IDENTITES/ (serveur.js : lireIdentite, lireDA, enregistrerIdentite). Chaque module reçoit SA
   sous-DA « à plat » (/api/identites?genre=…). Elles restent SÉPARÉES des avatars (décision de l'auteur).
   Ouvert depuis la carte de l'accueil, ou depuis un module (retour) : le carrousel, les stories, le Reel — le module y
   ramène ensuite, la DA choisie.
   ============================================================ */

const DAM = { das: [], gifs: [], polices: [], policesInfo: {}, vue: "galerie", id: null, sous: null, plat: null, eclaire: null, retour: null, tiroir: null, etat: "",
  cree: { pas: 1, depart: "phrase", phrase: "", images: [], daId: null, props: null, choix: 0, occupe: false, erreur: "" },
  neuve: { nom: "", parole: "", paroleExemples: "", erreur: "" } };
const DAM_SOUS = ["reel", "carrousel", "story"];
const DAM_LIB = {
  reel: { ico: "🎬", nom: "DA Reel", court: "Reel", pluriel: "Reels", sert: "Un Reel monté de A à Z : cartes, textes géants, montage CapCut et After Effects" },
  carrousel: { ico: "🖼️", nom: "DA Carrousel", court: "carrousel", pluriel: "carrousels", sert: "tes carrousels" },
  story: { ico: "📱", nom: "DA Story", court: "story", pluriel: "stories", sert: "tes stories" }
};
const DAM_MONTAGE = {
  motFort: [["accent", "couleur accent"], ["second", "couleur seconde"]],
  contour: [["aucun", "aucun"], ["fin", "fin"], ["normal", "normal"], ["epais", "épais"]],
  titres: [["couleur", "en couleur"], ["blanc", "en blanc"]]
};
const DAM_STUDIO = { fond: "#0b0b0d", texte: "#f2f2f2", accent: "#f97316", second: "#fdba74" };
const damUrl = (d, f) => f ? encodeURI("/IDENTITES/" + d.id + "/" + f) : "";
const damMontage = d => Object.assign({ motFort: "accent", contour: "normal", titres: "couleur", police: "studio" }, d.montage || {});
// la police des sous-titres dans CapCut : Poppins Bold (le style du studio), ou l'une des deux polices de la DA Reel
const damPoliceSt = d => { const p = damMontage(d).police; return p === "titres" || p === "texte" ? d.polices[p] : "Poppins"; };
const damPolicesSt = d => [["studio", "Poppins Bold (le studio)"], ["titres", d.polices.titres + " (titres)"], ["texte", d.polices.texte + " (texte)"]];
const damVars = d => `--f:${d.couleurs.fond};--t:${d.couleurs.texte};--a:${d.couleurs.accent};--s:${d.couleurs.second};--ft:'${d.polices.titres}';--fx:'${d.polices.texte}'`;
const damCourant = () => DAM.das.find(d => d.id === DAM.id);
// une sous-DA « à plat », comme le serveur la donne aux modules (lireDA) — ou null si elle n'existe pas
function damSous(d, g) {
  const s = d && d.sous && d.sous[g];
  if (!s) return null;
  return Object.assign({ couleurs: Object.assign({}, DAM_STUDIO), polices: { titres: "Sora", texte: "Inter" }, ton: "", illustration: "", logo: null, visuels: [], fonds: {}, elements: [], design: null },
    JSON.parse(JSON.stringify(s)), { id: d.id, nom: d.nom, parole: d.parole || "", paroleExemples: d.paroleExemples || "", genre: g });
}
// la sous-DA en cours d'édition : le même objet tant qu'on reste dessus (le tiroir y écrit)
function damPlat() {
  const d = damCourant();
  if (!d || !DAM.sous || !d.sous || !d.sous[DAM.sous]) return null;
  if (!DAM.plat || DAM.plat.id !== d.id || DAM.plat.genre !== DAM.sous) DAM.plat = damSous(d, DAM.sous);
  return DAM.plat;
}

/* ---------- ouvrir ---------- */
/* STORYMATIC (7 oct. 2026) : ici, une seule DA à
   régler — la DA Story du profil. Ni galerie, ni page de la DA (Reel, Carrousel), ni création : on y revient toujours. */
// la DA de la personne : celle de son profil (profil.js), connue au démarrage (app.js : window.SM_DA)
const DAM_SEULE = { get id() { return window.SM_DA || "ma-da"; }, sous: "story" };
// Storymatic : quoi qu'on demande, c'est la DA Story du profil qui s'ouvre
async function ouvrirDAs(o) {
  DAM.retour = (o && o.retour) || null; DAM.tiroir = null; DAM.etat = ""; DAM.eclaire = null; DAM.plat = null;
  await damCharger();
  Object.assign(DAM, { vue: "sous", id: DAM_SEULE.id, sous: DAM_SEULE.sous });
  aller("das");
  damRendre();
}
async function damCharger() {
  try { const r = await (await fetch("/api/identites")).json(); DAM.das = r.identites || []; DAM.polices = r.polices || []; DAM.policesInfo = r.policesInfo || {}; }
  catch (e) { DAM.das = DAM.das || []; }
  // la bibliothèque de GIF (commune) : chaque sous-DA Carrousel / Story y coche les siens (1er oct. 2026)
  // GIPHY branché (clé posée sur CET ordinateur) : Claude y cherche le GIF de chaque story ; la tuile le dit (13 oct. 2026)
  try { const r = await (await fetch("/api/gifs")).json(); DAM.gifs = r.gifs || []; DAM.giphy = !!r.giphy; } catch (e) { DAM.gifs = DAM.gifs || []; }
  damPolices();
}
// les polices des menus et des DA : le navigateur ne télécharge que celles qu'il affiche (deux graisses au plus)
function damPolices() {
  const desDA = DAM.das.flatMap(d => DAM_SOUS.flatMap(g => d.sous && d.sous[g] && d.sous[g].polices ? [d.sous[g].polices.titres, d.sous[g].polices.texte] : []));
  const tous = [...new Set(DAM.polices.concat(desDA).concat(["Poppins"]))].filter(Boolean);
  poserPolicesLocales(document, "dam-polices-locales", tous, DAM.policesInfo);   // les polices de l'ordinateur : pas chez Google
  const l = tous.filter(f => !estPoliceLocale(f, DAM.policesInfo));
  const cle = l.join("|"), ancien = $("dam-polices");
  if (ancien && ancien.dataset.cle === cle) return;
  if (ancien) ancien.remove();
  const k = document.createElement("link"); k.id = "dam-polices"; k.rel = "stylesheet"; k.dataset.cle = cle;
  k.href = "https://fonts.googleapis.com/css2?" + l.map(f => {
    const g = ((DAM.policesInfo || {})[f] || {}).graisses || [500, 800];
    const pris = [500, 800].map(v => g.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a)).filter((x, i, a) => a.indexOf(x) === i);
    return "family=" + encodeURIComponent(f).replace(/%20/g, "+") + (g.length > 1 ? ":wght@" + pris.sort((a, b) => a - b).join(";") : "");
  }).join("&") + "&display=swap";
  document.head.appendChild(k);
}
// le genre d'où l'on vient (les stories) → la sous-DA qu'il emploie
const damSousDuRetour = r => !r ? null : r.genre === "stories" ? "story" : null;
// revenir aux stories qui nous ont envoyés, la DA choisie — ou sans rien changer (id vide) ; sinon, la semaine
async function damRevenir(id) {
  const r = DAM.retour; DAM.retour = null;
  if (r && r.vers === "parcours") { pgRetourDA(r.genre, r.etape, id); return; }
  rendreAccueil();
}

/* ---------- les aperçus : une sous-DA posée sur son support (dessinés ici, sans crédit) ---------- */
function damApercu(d, sorte, legende) {
  const v = d.visuels || [], m = damMontage(d);
  const logo = d.logo ? `<div class="dap-logo" style="background-image:url('${damUrl(d, d.logo)}')"></div>` : "";
  const fond = d.fonds && d.fonds.fond ? `<div class="dap-fond" style="background-image:url('${damUrl(d, d.fonds.fond)}')"></div>` : "";
  const repli = `linear-gradient(160deg, ${d.couleurs.second}, ${d.couleurs.fond})`;
  const img = i => v[i] ? `url('${damUrl(d, v[i])}')` : repli;
  let h = "";
  if (sorte === "slide") h = `<div class="dap-vis" style="background-image:${img(0)}"></div>${logo}<div class="dap-titre">Voilà ton <em>titre</em></div><div class="dap-txt">Une phrase de texte, dans la police du corps.</div><div class="dap-fleche">→</div>`;
  else if (sorte === "story") h = `${fond || `<div class="dap-halo"></div>`}<div class="dap-lab">/// TA SÉRIE</div><div class="dap-titre">C'est quoi ta <em>question</em> ?</div><div class="dap-txt">Réponds en message, je lis tout.</div><div class="dap-bouton"><span>Réponds ici</span><span>↑</span></div>${logo}`;
  else if (sorte === "carte") h = `${fond}<div class="dap-geant" style="color:${m.titres === "blanc" ? "#fff" : "var(--a)"}">ÉTAPE 1</div><div class="dap-objet" style="background-image:${img(1 < v.length ? 1 : 0)}"></div>`;
  else if (sorte === "sous") {
    // ce que CapCut recevra : la police choisie (Poppins Bold par défaut), les petits mots en blanc, le mot fort en couleur
    const fort = m.motFort === "second" ? "var(--s)" : "var(--a)";
    h = `<div class="dap-video" style="background-image:${img(0)}"></div><div class="dap-st c-${m.contour}" style="font-family:'${damPoliceSt(d)}',sans-serif"><span>et là tout</span><b style="color:${fort}">CHANGE</b></div>`;
  }
  return `<div class="dap ${sorte} ${sorte === "carte" && !fond ? "dap-grain" : ""}" style="${damVars(d)}">${h}${legende ? `<span class="dap-leg">${legende}</span>` : ""}</div>`;
}

/* ---------- le rendu ---------- */
function damRendre() {
  const hote = $("dam"); if (!hote) return;
  const r = DAM.retour;
  const bandeau = r ? `<div class="dam-retour"><span>Vous choisissez la DA de votre <b>${echapper(r.nom || "création")}</b>${damSousDuRetour(r) ? " : il lui faut sa <b>" + DAM_LIB[damSousDuRetour(r)].nom + "</b>" : ""}. Gardez-en une, et le studio vous y ramène.</span>
    <button type="button" class="btn-mini" id="dam-revenir">← Revenir sans rien changer</button></div>` : "";
  // Storymatic : deux vues — la DA Story, et « Apprendre mon style » ; toute autre demande ramène à la DA Story
  if (DAM.vue !== "apprendre") Object.assign(DAM, { vue: "sous", id: DAM_SEULE.id, sous: DAM_SEULE.sous });
  if (DAM.vue === "sous" && !damPlat()) { hote.innerHTML = '<p class="dam-vide">La DA Story est introuvable.</p>'; return; }
  hote.innerHTML = bandeau + (DAM.vue === "apprendre" ? apRendre() : damPlanche());
  if ($("dam-revenir")) $("dam-revenir").onclick = () => damRevenir(null);
  if (DAM.vue === "apprendre") apBrancher(); else damBrancherPlanche();
}
const damAller = (vue, o) => { Object.assign(DAM, { vue, tiroir: null, eclaire: null }, o || {}); if (vue !== "sous") DAM.plat = null; damRendre(); window.scrollTo({ top: 0 }); };



/* ---------- LA PLANCHE d'une sous-DA ---------- */
function damPlanche() {
  const s = damPlat(), d = damCourant(), g = s.genre, L = DAM_LIB[g], v = s.visuels || [], m = damMontage(s);
  const tuile = (cle, cls, etq, corps, style) => `<div class="dpl-tuile ${cls}" data-t="${cle}" tabindex="0" role="button" ${style ? `style="${style}"` : ""}><span class="dpl-crayon">Modifier</span>${etq ? `<span class="dpl-etq">${etq}</span>` : ""}${corps}</div>`;
  const lib = (l, x) => (l.find(y => y[0] === x) || [, x])[1];
  const r = DAM.retour, utile = r && damSousDuRetour(r) === g;
  const palette = tuile("palette", "dpl-palette", "01 · La palette", `<div class="dpl-sw">${[["fond", "Fond"], ["texte", "Texte"], ["accent", "Accent"], ["second", "Seconde"]].map(([k, n]) => `<div style="background:${s.couleurs[k]};color:${k === "texte" || k === "accent" ? s.couleurs.fond : s.couleurs.texte}">${n}<span>${s.couleurs[k]}</span></div>`).join("")}</div>`);
  const polices = tuile("polices", "dpl-typo", g === "reel" ? "02 · Les polices" : "02 · Les polices", `<div class="dpl-grand">A<em>a</em></div><div class="dpl-typo-bas"><span><b style="font-family:var(--ft)">${echapper(s.polices.titres)}</b><small>TITRES</small></span><span style="text-align:right">${echapper(s.polices.texte)}<small>TEXTE</small></span></div>`);
  const ton = tuile("ton", "dpl-ton", "03 · Le style", `<p>${echapper(s.ton || "Pas encore décrit — un clic pour l'écrire.")}</p>`, g === "reel" ? "" : "grid-column:span 3");
  const logo = tuile("logo", "dpl-logo", "", s.logo ? `<div style="background-image:url('${damUrl(s, s.logo)}')"></div>` : `<span class="dpl-etq">+ logo</span>`);
  // les fonds au format de leur support : 9:16 pour le Reel et la story, 4:5 pour le carrousel (30 sept. 2026)
  const fonds = tuile("fonds", "dpl-fonds " + (g === "carrousel" ? "dsd-45" : "dsd-916"), "", ["fond", "fond_accent"].map(k => s.fonds && s.fonds[k] ? `<div style="background-image:url('${damUrl(s, s.fonds[k])}')">${k === "fond" ? "fond" : "accent"}</div>` : `<div class="vide" style="background:${k === "fond" ? s.couleurs.fond : s.couleurs.accent}">${k === "fond" ? "fond" : "fond accent"}<small>aplat</small></div>`).join(""));
  const images = tuile("images", "dpl-illu", "", `<div class="dpl-vis">${[0, 1, 2].map(i => `<div class="${v[i] ? "" : "vide"}" style="${v[i] ? `background-image:url('${damUrl(s, v[i])}')` : ""}"></div>`).join("")}</div>
      <div><span class="dpl-etq">05 · Les images</span><p>${echapper(s.illustration || "Le style des illustrations n'est pas encore décrit.")}</p>${s.design ? `<small class="dpl-design">+ fichier de design : ${echapper(s.designNom || "")}</small>` : ""}</div>`);
  let corps;
  if (g === "reel") {
    corps = palette + polices
      + tuile("montage", "dpl-montage", "04 · Les sous-titres et les cartes", `<div class="dpl-regles">
          <div><span>Mots importants</span><b>${lib(DAM_MONTAGE.motFort, m.motFort)}</b></div>
          <div><span>Contour des sous-titres</span><b>${lib(DAM_MONTAGE.contour, m.contour)}</b></div>
          <div><span>Titres d'étape</span><b>${lib(DAM_MONTAGE.titres, m.titres)}</b></div>
          <div><span>Police des sous-titres</span><b>${echapper(lib(damPolicesSt(s), m.police))}</b></div></div>
        <div class="dpl-supports">${damApercu(s, "sous", "sous-titre")}${damApercu(s, "carte", "carte de Reel")}</div>`)
      + fonds + logo + ton
      + `<div class="dpl-tuile dsd-bientot"><span>🔒</span><div><b>Bientôt : apprendre de tes Reels</b><br><small>Glisse 3 de tes Reels, le studio apprend tes sous-titres, tes cartes et ton rythme.</small></div></div>`;
  } else {
    const els = s.elements || [], ex = s.exemples || [];
    const apprise = s.apprise ? `✓ Appris le ${new Date(s.apprise.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} d'après ${s.apprise.n > 1 ? s.apprise.n + " " + L.pluriel : "ton " + L.court}` : `Pas encore appris : ta ${L.nom} n'a que ses couleurs et ses polices.`;
    corps = `<div class="dpl-tuile dsd-apprendre">
        <div><span class="dpl-etq">✦ Apprendre mon style</span><h3>Glisse ton dossier, le studio fait le reste.</h3>
          <p>Tes ${L.pluriel} d'exemple et tout ce que tu veux qu'il utilise : patchs, stickers, flèches, polices, GIF. Il écrit ta charte, nomme tes éléments, reconnaît tes polices et se teste sur 2 ${g === "story" ? "stories" : "slides"}. Gratuit.</p>
          <div class="dsd-appris">${apprise}</div></div>
        <div class="dsd-depot" data-apprendre="${g}" role="button" tabindex="0"><span class="ico">📁</span><b>${s.apprise ? "Glisser un nouveau dossier" : "Glisser mon dossier"}</b><span>ou clique pour le choisir</span></div></div>`
      + palette + polices + ton
      + tuile("design", "dsd-charte", "04 · Ta charte", s.design ? `<p><b>${echapper(s.designNom || "Fichier de design")}</b></p><p class="dsd-petit">Claude la lit en entier pour chaque ${L.court} : elle passe avant les règles générales.</p>`
        : `<p class="dsd-petit">Pas encore de charte. Glisse ton dossier : le studio l'écrit pour toi. Tu peux aussi importer la tienne.</p>`)
      + (ex.length ? tuile("exemples", "dsd-exemples", "05 · Tes slides d'exemple", `<div>${ex.map(f => `<img src="${damUrl(s, f)}" alt="">`).join("")}</div>`) + fonds + logo : images + fonds)
      + tuile("elements", "dpl-elements", "06 · Les éléments", els.length
        ? `<div class="dpl-el">${els.slice(0, 16).map(e => `<span title="${echapper(e.nom)}" style="background-image:url('${damUrl(s, e.fichier)}')"></span>`).join("")}${els.length > 16 ? `<b>+${els.length - 16}</b>` : ""}</div><p>${els.length} élément${els.length > 1 ? "s" : ""} — patchs, stickers, cadres : Claude les pose tels quels dans tes ${L.pluriel}.</p>`
        : `<p>Tes patchs, stickers, cadres et matières : Claude les posera tels quels dans tes ${L.pluriel}. Un clic pour en importer.</p>`, ex.length ? "grid-column:span 4" : "grid-column:span 3")
      + (() => { const mes = DAM.gifs.filter(x => (s.gifs || []).includes(x.id));
          return tuile("gifs", "dsd-gifs", "08 · Tes GIF", mes.length ? `<div>${mes.slice(0, 6).map(x => `<span title="${echapper(x.nom)}" style="background-image:url('/gifs-fichier/${encodeURIComponent(x.image)}')"></span>`).join("")}</div><p class="dsd-petit">${DAM.giphy ? `${mes.length} GIF à toi : Claude les pose quand leur « quand l'utiliser » colle à la phrase ; sinon, il trouve le bon sur GIPHY.` : `${mes.length} GIF : Claude ne propose que ceux-là dans tes ${L.pluriel} (GIPHY n'est pas branché).`}</p>`
            : `<p class="dsd-petit">${DAM.giphy ? `Claude trouve sur GIPHY le GIF qui va avec chaque ${L.court}. Un clic pour ajouter aussi les tiens.` : `Aucun GIF : Claude n'en mettra pas dans tes ${L.pluriel}. Un clic pour choisir les tiens, ou brancher GIPHY.`}</p>`); })()
      + (ex.length ? images.replace("05 · Les images", "07 · Les images").replace('class="dpl-tuile dpl-illu"', 'class="dpl-tuile dpl-illu" style="grid-column:span 6"') : logo);
    // Storymatic : la façon de parler (au niveau de la DA, dont la page n'existe pas ici) a sa tuile dans la planche
    corps += tuile("parole", "dpl-ton", "09 · Ta façon de parler", `<p>${echapper(d.parole || "Pas encore écrite — un clic pour la régler.")}</p><p class="dsd-petit">${(d.paroleExemples || "").trim() ? "+ " + d.paroleExemples.length.toLocaleString("fr-FR") + " caractères de tes textes : Claude imite ta voix dans chaque story." : "Colle des textes à toi : c'est ce qui fait sonner comme toi."}</p>`, "grid-column:span 6");
  }
  return `<div class="dpl" style="${damVars(s)}">
    <div class="dpl-haut"><button type="button" class="dpl-retour" id="dam-da">← ${("Ma semaine")}</button>
      <h1 class="dpl-nom dsd-nom">${(L.ico + " Ma DA Story<small>le style de toutes tes stories</small>")}</h1>
      <span class="dpl-etat">${echapper(DAM.etat)}</span>
      ${("")}
      ${utile ? `<button type="button" class="pg-btn pg-btn-go" id="dam-utiliser">Utiliser pour votre ${echapper(r.nom || "création")} →</button>` : ""}</div>
    <div class="dpl-bento">${corps}
      <div class="dpl-tuile dpl-branche"><span class="dpl-etq">Branchée sur</span><span><i></i>${g === "reel" ? "Un Reel monté de A à Z : cartes, textes géants, montage CapCut / After Effects" : "Chaque " + L.court + " fait avec " + echapper(d.nom) + ", et rien d'autre"}</span><span><i></i>+ la façon de parler de ${echapper(d.nom)}</span></div>
    </div></div>
    <div class="dpl-tiroir ${DAM.tiroir ? "ouvert" : ""}" id="dam-tiroir"></div>`;
}
function damBrancherPlanche() {
  const s = damPlat(), d = damCourant();
  $("dam-da").onclick = () => (rendreAccueil());
  document.querySelectorAll(".dpl [data-t]").forEach(t => {
    const ouvrir = () => { DAM.tiroir = t.dataset.t === "exemples" ? "exemples" : t.dataset.t; damRendre(); };
    t.onclick = ouvrir; t.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ouvrir(); } };
  });
  document.querySelectorAll(".dpl [data-apprendre]").forEach(b => {
    const go = () => { if (typeof ouvrirApprendre === "function") ouvrirApprendre(d.id, s.genre); else informer("« Apprendre mon style » arrive bientôt."); };
    b.onclick = go; b.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } };
  });
  ;
  if ($("dam-utiliser")) $("dam-utiliser").onclick = () => damRevenir(d.id);
  if (DAM.tiroir) damTiroir(s, d);
}

/* ---------- enregistrer ---------- */
// une sous-DA : ses réglages (le serveur garde ce qu'on n'envoie pas), plus les fichiers qui changent
let damMinuteur = null;
function damSauverPlusTard(s) { DAM.etat = "…"; damMajEtat(); clearTimeout(damMinuteur); damMinuteur = setTimeout(() => damSauver(s), 700); }
async function damSauver(s, fichiers) {
  clearTimeout(damMinuteur);
  DAM.etat = "Enregistrement…"; damMajEtat();
  try {
    const corps = { id: s.id, sous: s.genre, couleurs: s.couleurs, polices: s.polices, ton: s.ton || "", illustration: s.illustration || "" };
    ;
    const r = await (await fetch("/api/identites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign(corps, fichiers || {})) })).json();
    if (r.erreur) throw new Error(r.erreur);
    damAPris(r);
    // la sous-DA éditée reste le même objet (le tiroir y écrit) : on n'y reprend du serveur que ce qu'il a fait des fichiers
    const n = r.sous && r.sous[s.genre];
    if (n) ["logo", "visuels", "design", "designNom", "fonds", "montage", "elements", "exemples", "apprise", "gifs"].forEach(k => { s[k] = n[k]; });
    s.policeCapcut = r.policeCapcut || null;
    DAM.etat = "Enregistré ✓"; damPolices();
    return r;
  } catch (err) { DAM.etat = "Pas enregistré : " + (err.message || err); return null; }
  finally { damMajEtat(); }
}
// le niveau de la DA : son nom, sa façon de parler (communs aux trois sous-DA)
let damMinuteurDA = null;
function damSauverDAPlusTard(d) { DAM.etat = "…"; damMajEtat(); clearTimeout(damMinuteurDA); damMinuteurDA = setTimeout(() => damSauverDA(d), 700); }
async function damSauverDA(d) {
  clearTimeout(damMinuteurDA);
  DAM.etat = "Enregistrement…"; damMajEtat();
  try {
    const r = await (await fetch("/api/identites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id, nom: d.nom, parole: d.parole || "", paroleExemples: d.paroleExemples || "" }) })).json();
    if (r.erreur) throw new Error(r.erreur);
    ["nom", "parole", "paroleExemples", "maj"].forEach(k => { d[k] = r[k]; });
    if (DAM.plat && DAM.plat.id === d.id) Object.assign(DAM.plat, { nom: r.nom, parole: r.parole, paroleExemples: r.paroleExemples });
    DAM.etat = "Enregistré ✓"; return r;
  } catch (err) { DAM.etat = "Pas enregistré : " + (err.message || err); return null; }
  finally { damMajEtat(); }
}
// la fiche renvoyée par le serveur remplace celle de la liste (sans casser l'objet en cours d'édition)
function damAPris(r) {
  const i = DAM.das.findIndex(x => x.id === r.id);
  if (i > -1) { const x = DAM.das[i]; x.sous = r.sous; x.maj = r.maj; } else DAM.das.push(r);
}
const damMajEtat = () => document.querySelectorAll(".dpl-etat, .dtr-etat, .dsd-etat-sauve").forEach(x => { x.textContent = DAM.etat; });
// redessiner la planche (ou la DA) derrière le tiroir, sans fermer le tiroir ni perdre la saisie en cours
function damMajPlanche() {
  const vieux = document.querySelector(DAM.vue === "sous" ? ".dpl" : ".dsd-parole"); if (!vieux) return;
  if (DAM.vue === "sous") {
    const tmp = document.createElement("div"); tmp.innerHTML = damPlanche();
    vieux.replaceWith(tmp.querySelector(".dpl"));
    const tiroir = DAM.tiroir; DAM.tiroir = null; damBrancherPlanche(); DAM.tiroir = tiroir;
  } else {
    const d = damCourant(), p = vieux.querySelector("p"); if (p) p.textContent = d.parole || "Pas encore écrite : un clic pour la régler.";
    const h = document.querySelector(".dsd-haut h1"); if (h) h.textContent = d.nom;
  }
}

/* ---------- le tiroir : une tuile à la fois ---------- */
function damTiroir(s, d) {
  const t = $("dam-tiroir"), cle = DAM.tiroir;
  const titres = { nom: "Le nom", palette: "La palette", polices: "Les polices", ton: "Le style", parole: "La façon de parler", logo: "Le logo", images: "Les images",
    fonds: "Les fonds", montage: "Les sous-titres et les cartes", elements: "Les éléments", design: "Ta charte", exemples: "Tes slides d'exemple", gifs: "Tes GIF" };
  const champ = (id, val, rows, ph, max) => `<textarea class="pg-champ" id="${id}" rows="${rows}" maxlength="${max}" placeholder="${echapper(ph)}">${echapper(val || "")}</textarea>`;
  const choix = k => `<div class="dtr-choix" data-cle="${k}">${(k === "police" ? damPolicesSt(s) : DAM_MONTAGE[k]).map(([v, n]) => `<button type="button" class="${damMontage(s)[k] === v ? "on" : ""}" data-v="${v}">${n}</button>`).join("")}</div>`;
  const L = s ? DAM_LIB[s.genre] : null;
  const corps = {
    nom: `<input class="pg-champ" id="dtr-nom" maxlength="60" value="${echapper(d.nom)}"><p class="dtr-aide">Le nom de la DA entière : ses trois sous-DA le portent.</p>`,
    parole: champ("dtr-parole", d.parole, 5, "Tutoiement, phrases courtes, un peu provoc, des mots de tous les jours ; jamais de jargon.", 800) + ((`<p class="dtr-aide">Elle part avec chaque story : les mots, le registre, ce qu'il faut éviter.</p>`)) + `
      <label class="dtr-etq">Tes phrases à toi <small>facultatif — c'est ce qui fait vraiment sonner comme toi</small></label>` +
      champ("dtr-parole-ex", d.paroleExemples, 9, "Collez 2 ou 3 textes à vous, tels quels : une légende que vous avez écrite, un message à un client, la transcription d'une de vos vidéos…", 16000) +
      `<p class="dtr-aide">Claude imite leur voix — vos expressions, la longueur de vos phrases, votre humour — sans en recopier les phrases ni les faits.</p>`
  };
  if (s) Object.assign(corps, {
    palette: `<div class="dtr-couleurs">${[["fond", "Fond"], ["texte", "Texte"], ["accent", "Accent"], ["second", "Seconde"]].map(([k, n]) => `<button type="button" class="dtr-coul" data-c="${k}"><i style="background:${s.couleurs[k]}"></i><b>${n}</b><code>${s.couleurs[k]}</code></button>`).join("")}</div>
      <p class="dtr-aide">Les couleurs de la ${L.nom} seulement. Le texte doit se lire parfaitement sur le fond ; l'accent attire l'œil.</p>`,
    polices: ["titres", "texte"].map(k => `<label class="dtr-police"><span>${k === "titres" ? "Titres" : "Texte"}</span><select data-p="${k}">${DAM.polices.concat(DAM.polices.includes(s.polices[k]) ? [] : [s.polices[k]]).map(f => `<option ${f === s.polices[k] ? "selected" : ""} style="font-family:'${f}'">${echapper(f)}</option>`).join("")}</select>
      <span class="dtr-spec" style="font-family:'${s.polices[k]}';font-weight:${k === "titres" ? 800 : 400}">Aa Bb 123</span></label>`).join("") + `<button type="button" class="btn-mini" id="dtr-plus-polices">+ Plus de polices (Google Fonts)</button> <button type="button" class="btn-mini" id="dtr-police-locale" title="Une police installée ou achetée, en fichier .otf, .ttf, .woff : elle reste sur cet ordinateur">+ Une police de mon ordinateur</button>`
      + (("")),
    ton: champ("dtr-ton", s.ton, 7, "Minimal et contrasté, gros titres, beaucoup de vide. Pas d'emoji.", 600) + `<p class="dtr-aide">Claude le lit pour ${("composer tes " + L.pluriel)} : l'allure des visuels et l'attitude.</p>`,
    logo: `<div class="dtr-logo" style="${s.logo ? `background-image:url('${damUrl(s, s.logo)}')` : ""}">${s.logo ? "" : "aucun logo"}</div><div class="dtr-ligne"><button type="button" class="btn-mini" id="dtr-logo">${s.logo ? "Changer" : "Choisir un logo (PNG transparent de préférence)"}</button>${s.logo ? `<button type="button" class="btn-mini" id="dtr-logo-x">Retirer</button>` : ""}</div>`,
    images: `${(`<label class="dtr-etq">Le style des illustrations générées</label>${champ("dtr-illu", s.illustration, 4, "Objets 3D mats, noir et vert lime, éclairage de studio, fond uni.", 500)}`)}
      <label class="dtr-etq">Des visuels qui représentent la ${L.nom} <small>${(s.visuels || []).length}/8</small></label>
      <div class="dtr-visuels">${(s.visuels || []).map(f => `<span style="background-image:url('${damUrl(s, f)}')"><button type="button" data-x="${echapper(f)}" title="Retirer">×</button></span>`).join("")}${(s.visuels || []).length < 8 ? `<button type="button" id="dtr-vis-plus">+</button>` : ""}</div>`,
    design: `<p class="dtr-aide">La charte (ou feuille de styles) de tes ${L.pluriel} : Claude la lit EN ENTIER comme un cahier des charges, elle passe avant les règles générales. « Apprendre mon style » l'écrit pour toi d'après tes ${L.pluriel}.</p>
      <div class="dtr-ligne">${s.design ? `<span class="dtr-fichier">${echapper(s.designNom || "fichier de design")}</span>` : ""}<button type="button" class="btn-mini" id="dtr-design">${s.design ? "Remplacer" : "Choisir (.html, .css, .md, .json, .txt)"}</button>${s.design ? `<a class="btn-mini" href="${damUrl(s, s.design)}" target="_blank" rel="noopener">Lire</a><button type="button" class="btn-mini" id="dtr-design-x">Retirer</button>` : ""}</div>`,
    exemples: `<p class="dtr-aide">Les slides que Claude regarde avant de composer : elles montrent le STYLE (on n'en recopie ni les phrases ni les images). Choisies par « Apprendre mon style ».</p>
      <div class="dtr-visuels">${(s.exemples || []).map(f => `<span style="background-image:url('${damUrl(s, f)}')"></span>`).join("")}</div>`,
    fonds: `<div id="dtr-fonds"></div>`,
    gifs: `<p class="dtr-aide">La bibliothèque de GIF est commune au studio. Coche ceux de ta ${L.nom} : quand il écrit un ${L.court}, Claude ne propose QUE ceux-là. Les GIF de ton dossier « Apprendre mon style » y sont cochés d'office.</p>
      <div class="dtr-gifs">${DAM.gifs.map(x => `<label class="dtr-gif ${(s.gifs || []).includes(x.id) ? "on" : ""}"><input type="checkbox" data-gif="${x.id}" ${(s.gifs || []).includes(x.id) ? "checked" : ""}><span style="background-image:url('/gifs-fichier/${encodeURIComponent(x.image)}')"></span><b>${echapper(x.nom)}</b><small>${echapper(x.quand || "")}</small></label>`).join("") || "<p class='dtr-aide'>La bibliothèque est vide.</p>"}</div>`,
    elements: `<p class="dtr-aide">De vraies images de ta marque — patchs brodés, stickers, cadres, matières. Dis pour chacune <b>quand l'utiliser</b> (une émotion, un sujet, une place) : Claude choisit d'après ça et les pose telles quelles.</p>
      <div class="dtr-ligne"><button type="button" class="btn-mini btn-mini-fort" id="dtr-el-plus">+ Importer des éléments</button>${s.genre === "story" && typeof ouvrirStickers === "function" ? `<button type="button" class="btn-mini btn-mini-fort" id="dtr-el-stickers" title="Une image de stickers qui te plaît : Claude les redessine en français, en PNG transparent">✦ Refaire des stickers d'après une image</button>` : ""}
        <label class="dtr-el-det"><input type="checkbox" id="dtr-el-detourer" ${DAM.elDetourer === false ? "" : "checked"}> Supprimer leur fond (sur l'ordinateur, gratuit)</label></div>
      <div class="dtr-el-liste">${(s.elements || []).map(e => `<div class="dtr-el" data-e="${e.id}"><span class="${e.detoure ? "pg-damier" : ""}" style="background-image:url('${damUrl(s, e.fichier)}')"></span>
        <div><input class="pg-champ dtr-el-nom" maxlength="60" value="${echapper(e.nom)}"><textarea class="pg-champ dtr-el-quand" rows="2" maxlength="300" placeholder="Quand l'utiliser — ex. quand on se moque, sur une slide de vanne">${echapper(e.quand || "")}</textarea></div>
        <button type="button" class="dtr-el-x" title="Retirer (gardé dans la corbeille de la DA)">×</button></div>`).join("")}</div>`,
    montage: `<label class="dtr-etq">La police des sous-titres</label>${choix("police")}
      ${s.policeCapcut ? `<p class="dcr-erreur">${echapper(s.policeCapcut)}</p>` : ""}
      <label class="dtr-etq">Les mots importants des sous-titres</label>${choix("motFort")}
      <label class="dtr-etq">Le contour noir des sous-titres</label>${choix("contour")}
      <label class="dtr-etq">Les titres d'étape</label>${choix("titres")}
      <p class="dtr-aide">Ces réglages partent dans CapCut avec chaque Reel de cette DA, avec ses fonds. Les petits mots restent blancs pour se lire sur la vidéo. Une police de la DA est prise chez Google Fonts (gratuite, usage commercial) et rangée dans le projet CapCut.</p>
      <div class="dtr-apercu">${damApercu(s, "sous")}${damApercu(s, "carte")}</div>`
  });
  t.innerHTML = `<div class="dtr-tete"><h3>${titres[cle] || ""}</h3><button type="button" id="dtr-fermer" aria-label="Fermer">×</button></div>${corps[cle] || ""}<span class="dtr-etat">${echapper(DAM.etat)}</span>`;
  t.classList.add("ouvert");
  $("dtr-fermer").onclick = () => { DAM.tiroir = null; t.classList.remove("ouvert"); };
  // le niveau de la DA : le nom, la façon de parler
  if ($("dtr-nom")) { $("dtr-nom").focus(); $("dtr-nom").oninput = ev => { if (ev.target.value.trim()) { d.nom = ev.target.value; damSauverDAPlusTard(d); damMajPlanche(); } }; }
  ;
  ;
  if (!s) return;
  const texte = (id, k) => { if ($(id)) $(id).oninput = ev => { s[k] = ev.target.value; damSauverPlusTard(s); damMajPlanche(); }; };
  texte("dtr-ton", "ton"); texte("dtr-illu", "illustration");
  t.querySelectorAll(".dtr-coul").forEach(b => b.onclick = () => {
    const k = b.dataset.c, avant = s.couleurs[k];
    const poser = c => { s.couleurs[k] = c; b.querySelector("i").style.background = c; b.querySelector("code").textContent = c; damMajPlanche(); };
    nuancier(b, avant, { titre: "Couleur « " + b.querySelector("b").textContent + " »", surChange: c => { poser(c); damSauverPlusTard(s); }, surAnnule: () => { poser(avant); damSauverPlusTard(s); } });
  });
  t.querySelectorAll("select[data-p]").forEach(x => x.onchange = async () => { s.polices[x.dataset.p] = x.value; damPolices(); await damSauver(s); damRendre(); });
  if ($("dtr-plus-polices")) $("dtr-plus-polices").onclick = () => ouvrirBibliothequePolices({ texte: d.nom, surFermer: async () => { await damCharger(); damRendre(); } });
  if ($("dtr-police-locale")) $("dtr-police-locale").onclick = async () => { if (await importerPolicesLocales()) { DAM.etat = "Police ajoutée ✓ — choisissez-la dans la liste"; await damCharger(); damRendre(); } };
  const fichier = async (corpsF, message) => { const r = await damSauver(s, corpsF); if (r) { DAM.etat = message; damRendre(); } };
  if ($("dtr-logo")) $("dtr-logo").onclick = async () => { const f = (await pgChoisirFichiers("image/png,image/jpeg,image/webp"))[0]; if (f) fichier({ logo: { nom: f.name, donnees: await pgLireFichier(f) } }, "Logo posé ✓"); };
  if ($("dtr-logo-x")) $("dtr-logo-x").onclick = () => fichier({ retirerLogo: true }, "Logo retiré (gardé dans la corbeille de la DA)");
  // les éléments : import (détouré ou non), nom et « quand » au fil de l'eau, retrait vers la corbeille — dans CETTE sous-DA
  if ($("dtr-el-detourer")) $("dtr-el-detourer").onchange = ev => { DAM.elDetourer = ev.target.checked; };
  if ($("dtr-el-stickers")) $("dtr-el-stickers").onclick = () => ouvrirStickers({ surAjout: async () => { await damCharger(); damRendre(); } });
  if ($("dtr-el-plus")) $("dtr-el-plus").onclick = async () => {
    const l = await pgChoisirFichiers("image/png,image/jpeg,image/webp", true); if (!l.length) return;
    const det = $("dtr-el-detourer") ? $("dtr-el-detourer").checked : true;
    for (let i = 0; i < l.length; i++) {
      DAM.etat = "Import " + (i + 1) + "/" + l.length + (det ? " (détourage…)" : "") + "…"; damMajEtat();
      const nom = l[i].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      try { const r = await (await fetch("/api/identites/" + encodeURIComponent(d.id) + "/elements", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sous: s.genre, nom, quand: "", detourer: det, donnees: await pgLireFichier(l[i]) }) })).json();
        if (r.erreur) throw new Error(r.erreur); damAPris(r.identite); s.elements = r.identite.sous[s.genre].elements; } catch (err) { informer(err.message || String(err)); break; }
    }
    DAM.etat = "Éléments importés ✓ — dites quand les utiliser"; damRendre();
  };
  const majEl = async (eid, corpsE) => { const r = await (await fetch("/api/identites/" + encodeURIComponent(d.id) + "/elements/" + eid, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ sous: s.genre }, corpsE)) })).json(); if (r.erreur) { informer(r.erreur); return null; } damAPris(r); s.elements = r.sous[s.genre].elements; return r; };
  t.querySelectorAll(".dtr-el").forEach(b => {
    const eid = b.dataset.e; let min = null;
    const sauver = () => { clearTimeout(min); DAM.etat = "Enregistrement…"; damMajEtat(); min = setTimeout(async () => { await majEl(eid, { nom: b.querySelector(".dtr-el-nom").value, quand: b.querySelector(".dtr-el-quand").value }); DAM.etat = "Enregistré ✓"; damMajEtat(); }, 600); };
    b.querySelector(".dtr-el-nom").oninput = sauver; b.querySelector(".dtr-el-quand").oninput = sauver;
    b.querySelector(".dtr-el-x").onclick = async () => { if (await majEl(eid, { retirer: true })) { DAM.etat = "Élément retiré (gardé dans la corbeille de la DA)"; damRendre(); } };
  });
  if ($("dtr-vis-plus")) $("dtr-vis-plus").onclick = async () => {
    const l = await pgChoisirFichiers("image/png,image/jpeg,image/webp", true), place = 8 - (s.visuels || []).length;
    const vis = []; for (const f of l.slice(0, place)) vis.push({ nom: f.name, donnees: await pgLireFichier(f) });
    if (vis.length) fichier({ visuels: vis }, vis.length + " visuel" + (vis.length > 1 ? "s ajoutés" : " ajouté") + " ✓");
  };
  t.querySelectorAll(".dtr-visuels [data-x]").forEach(b => b.onclick = () => fichier({ retirerVisuels: [b.dataset.x] }, "Visuel retiré (gardé dans la corbeille de la DA)"));
  if ($("dtr-design")) $("dtr-design").onclick = async () => {
    const f = (await pgChoisirFichiers(".html,.htm,.css,.md,.txt,.json,.svg"))[0]; if (!f) return;
    if (f.size > 400000) { informer("Ce fichier est trop lourd : 400 Ko au plus. Gardez la feuille de styles ou la charte, pas les images."); return; }
    fichier({ design: { nom: f.name, texte: await pgLireFichier(f, true) } }, "Fichier de design posé ✓");
  };
  if ($("dtr-design-x")) $("dtr-design-x").onclick = () => fichier({ retirerDesign: true }, "Fichier de design retiré");
  if ($("dtr-fonds")) daFonds($("dtr-fonds"), s, f => { s.fonds = f; const x = damCourant(); if (x && x.sous[s.genre]) x.sous[s.genre].fonds = f; damMajPlanche(); });
  t.querySelectorAll("[data-gif]").forEach(c => c.onchange = async () => {
    const l = new Set(s.gifs || []); if (c.checked) l.add(c.dataset.gif); else l.delete(c.dataset.gif);
    s.gifs = [...l]; c.closest(".dtr-gif").classList.toggle("on", c.checked); await damSauver(s, { gifs: s.gifs }); damMajPlanche();
  });
  t.querySelectorAll(".dtr-choix button").forEach(b => b.onclick = async () => { s.montage = Object.assign(damMontage(s), { [b.parentNode.dataset.cle]: b.dataset.v }); await damSauver(s); damRendre(); });
}



;
