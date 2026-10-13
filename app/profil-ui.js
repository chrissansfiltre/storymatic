/* ============================================================
   « FAISONS CONNAISSANCE » — le profil de la personne (13 oct. 2026)
   ------------------------------------------------------------
   Au premier lancement, Storymatic pose ses questions avant d'ouvrir le calendrier ; ensuite, « Mon profil » rouvre le même
   parcours pour tout retoucher. Sept étapes : toi · ce que tu vends · ta voix · ton rythme · ta semaine type · ton style ·
   tes éléments. Serveur : profil.js (/api/profil, /api/profil/voix, /api/profil/semaine-type[/proposer]).
   ============================================================ */
(function () {
  const ETAPES = [
    { id: "toi", nom: "Toi", titre: "Faisons connaissance", lead: "Quelques questions pour que tes stories parlent comme toi, à tes abonnés, de ce que tu fais. Tout se retouche plus tard dans « Mon profil »." },
    { id: "vends", nom: "Ce que tu vends", titre: "Ce que tu proposes", lead: "Tes stories font avancer tes abonnés vers ton offre, sans forcer. Dis ce que tu vends, ta ressource gratuite, et les mots qu'on te répond pour recevoir le lien." },
    { id: "voix", nom: "Ta voix", titre: "Ta façon de parler", lead: "Claude écrit chaque story avec tes mots à toi. Plus tu lui donnes de textes à toi, plus ça sonne comme toi." },
    { id: "rythme", nom: "Ton rythme", titre: "Ton rythme", lead: "Combien de stories par jour, et quels jours tu postes." },
    { id: "semaine", nom: "Ta semaine type", titre: "Ta semaine type", lead: "Chaque jour a un rôle : vendre, prouver, créer du lien, apprendre, donner… Claude te propose une semaine adaptée à ta niche ; retouche chaque jour comme tu veux." },
    { id: "style", nom: "Ton style", titre: "Ton style", lead: "Un style de départ est prêt. Pour que tes stories te ressemblent vraiment, fais-le apprendre à partir de tes anciennes stories, ou règle tes couleurs, tes polices et tes éléments." },
    { id: "elements", nom: "Tes éléments", titre: "Tes photos, tes captures, tes vidéos", lead: "Ce que l'outil pose dans tes stories : tes photos de fond, les captures de ton produit, tes vidéos. Tu pourras en ajouter chaque semaine." }
  ];
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const NOMS = { lundi: "Lundi", mardi: "Mardi", mercredi: "Mercredi", jeudi: "Jeudi", vendredi: "Vendredi", samedi: "Samedi", dimanche: "Dimanche" };
  const E = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let P = null, K = 0, PREMIER = false, OCCUPE = false, GIPHY = false, COMPTES = { banque: 0, captures: 0, videos: 0 };

  const css = document.createElement("style");
  css.textContent = `
  .pf { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: radial-gradient(1100px 620px at 92% -12%, rgba(210,63,224,.19), transparent 62%), radial-gradient(900px 520px at -8% -10%, rgba(253,171,61,.08), transparent 60%), linear-gradient(165deg, #1A1029 0%, #120B1D 50%, #170B22 100%); }
  .pf-cadre { max-width: 980px; margin: 0 auto; padding: 26px 24px 110px; }
  .pf-tete { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
  .pf-tete .x { margin-left: auto; }
  .pf-fil { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 26px; }
  .pf-fil button { border: 1px solid var(--bord-2); background: var(--carte); color: var(--texte-2); border-radius: 999px; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .pf-fil button.on { background: var(--grad); color: #0A0A0B; border-color: transparent; }
  .pf-fil button.fait { color: var(--texte); border-color: rgba(74,222,128,.5); }
  .pf h1 { margin-bottom: 8px; } .pf .lead { color: var(--texte-2); max-width: 720px; margin: 0 0 26px; font-size: 15px; }
  .pf-grille { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .pf-champ { display: grid; gap: 6px; } .pf-champ.large { grid-column: 1 / -1; }
  .pf-champ b { font: 700 13.5px/1.2 var(--corps); } .pf-champ small { color: var(--texte-3); font-size: 12px; }
  .pf input[type=text], .pf input:not([type]), .pf select { padding: 11px 13px; font-size: 14px; width: 100%; }
  .pf-cartes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .pf-carte { text-align: left; border: 1px solid var(--bord-2); background: var(--carte); border-radius: 16px; padding: 14px 15px; cursor: pointer; color: var(--texte); }
  .pf-carte b { display: block; font: 800 15px/1.2 var(--titre); margin-bottom: 4px; } .pf-carte span { color: var(--texte-2); font-size: 12.5px; }
  .pf-carte.on { border-color: var(--o); box-shadow: 0 0 0 1px var(--o), 0 12px 30px -16px rgba(244,75,123,.9); background: var(--carte-2); }
  .pf-mots { display: grid; gap: 8px; } .pf-mot { display: grid; grid-template-columns: 170px 1fr 34px; gap: 8px; }
  .pf-jours { display: flex; gap: 8px; flex-wrap: wrap; }
  .pf-jours button { border: 1px solid var(--bord-2); background: var(--carte); color: var(--texte-2); border-radius: 12px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
  .pf-jours button.on { background: rgba(244,75,123,.16); color: var(--texte); border-color: var(--o); }
  .pf-sem { display: grid; gap: 12px; margin-top: 18px; }
  .pf-jour { background: var(--carte); border: 1px solid var(--bord); border-radius: 16px; padding: 14px; display: grid; grid-template-columns: 110px 1fr; gap: 12px; }
  .pf-jour > b { font: 800 16px/1.2 var(--titre); padding-top: 9px; } .pf-jour input { font-weight: 700; margin-bottom: 8px; }
  .pf-jour.off { opacity: .45; }
  .pf-pied { position: fixed; left: 0; right: 0; bottom: 0; z-index: 51; background: rgba(18,11,29,.92); backdrop-filter: blur(10px); border-top: 1px solid var(--bord); }
  .pf-pied > div { max-width: 980px; margin: 0 auto; padding: 14px 24px; display: flex; gap: 10px; align-items: center; }
  .pf-pied .note { color: var(--texte-3); font-size: 12.5px; margin-right: auto; }
  .pf-boite { background: var(--carte); border: 1px solid var(--bord); border-radius: 18px; padding: 18px; }
  .pf-boite + .pf-boite { margin-top: 14px; }
  .pf-boite h3 { margin: 0 0 6px; font: 800 16px/1.2 var(--titre); } .pf-boite p { margin: 0 0 12px; color: var(--texte-2); font-size: 13.5px; }
  .pf-ok { color: var(--vert); font-weight: 700; }
  .pf-attente { display: flex; align-items: center; gap: 10px; color: var(--texte-2); padding: 12px 0; }
  .pf-menu { position: fixed; z-index: 60; min-width: 250px; background: var(--carte-2); border: 1px solid var(--bord-2); border-radius: 14px; padding: 6px; box-shadow: 0 24px 50px -20px rgba(0,0,0,.9); }
  .pf-menu button { display: flex; width: 100%; align-items: center; gap: 10px; text-align: left; background: none; border: 0; color: var(--texte); padding: 9px 11px; border-radius: 10px; cursor: pointer; font-size: 13.5px; }
  .pf-menu button:hover { background: var(--carte); } .pf-menu button.on { font-weight: 800; } .pf-menu button.on::after { content: "✓"; margin-left: auto; color: var(--vert); }
  .pf-menu small { color: var(--texte-3); font-size: 11.5px; } .pf-menu hr { border: 0; border-top: 1px solid var(--bord); margin: 5px 4px; }
  .pf-menu .rouge { color: var(--rouge); }
  @media (max-width: 800px) { .pf-grille, .pf-cartes { grid-template-columns: 1fr; } .pf-jour { grid-template-columns: 1fr; } .pf-mot { grid-template-columns: 1fr; } }`;
  document.head.appendChild(css);

  async function api(url, corps, brut) {
    const o = corps === undefined ? {} : brut ? { method: "POST", body: corps } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) };
    const r = await (await fetch(url, o)).json(); if (r && r.erreur) throw new Error(r.erreur); return r;
  }
  const v = id => { const x = document.getElementById(id); return x ? x.value : ""; };

  /* ---------- ce que chaque étape enregistre ---------- */
  async function enregistrer() {
    const id = ETAPES[K].id;
    if (id === "toi") P = await api("/api/profil", { prenom: v("pf-prenom"), compte: v("pf-compte"), niche: v("pf-niche"), cible: v("pf-cible"), presence: P.presence });
    if (id === "vends") P = await api("/api/profil", { offre: { nom: v("pf-o-nom"), quoi: v("pf-o-quoi"), prix: v("pf-o-prix"), lien: v("pf-o-lien") },
      ressource: { nom: v("pf-r-nom"), quoi: v("pf-r-quoi"), lien: v("pf-r-lien") },
      mots: [...document.querySelectorAll(".pf-mot")].map(l => ({ mot: l.querySelector(".m").value, envoie: l.querySelector(".e").value })) });
    if (id === "voix") P = await api("/api/profil/voix", { parole: v("pf-parole"), paroleExemples: v("pf-textes") });
    if (id === "rythme") P = await api("/api/profil", { rythme: { min: +v("pf-min"), max: +v("pf-max"), jours: P.rythme.jours }, gifChaqueStory: document.getElementById("pf-gif").checked });
    if (id === "semaine" && document.querySelector(".pf-jour")) {
      const jours = {}; document.querySelectorAll(".pf-jour[data-j]").forEach(x => { jours[x.dataset.j] = { role: x.querySelector("input").value, texte: x.querySelector("textarea").value }; });
      P = await api("/api/profil/semaine-type", { jours });
    }
    if (id === "style") P = await api("/api/profil", { captures: v("pf-captures"), videos: v("pf-videos"), recette: v("pf-recette") });
  }

  /* ---------- les étapes ---------- */
  function corps() {
    const id = ETAPES[K].id;
    if (id === "toi") return `<div class="pf-grille">
      <label class="pf-champ"><b>Ton prénom</b><input id="pf-prenom" value="${E(P.prenom)}" placeholder="ex. Sarah"></label>
      <label class="pf-champ"><b>Ton compte Instagram</b><input id="pf-compte" value="${E(P.compte)}" placeholder="@ton.compte"></label>
      <label class="pf-champ large"><b>Ta niche</b><small>De quoi parle ton compte, en une phrase.</small><input id="pf-niche" value="${E(P.niche)}" placeholder="ex. la nutrition pour les sportifs du dimanche ; créer des Reels avec l'IA ; l'immobilier locatif"></label>
      <label class="pf-champ large"><b>Ta cible</b><small>À qui parlent tes stories : qui ils sont, ce qu'ils vivent, ce qu'ils veulent.</small><textarea id="pf-cible" rows="2" placeholder="ex. des mamans entrepreneuses qui manquent de temps et veulent vendre en ligne sans y passer leurs soirées">${E(P.cible)}</textarea></label>
      <div class="pf-champ large"><b>Comment tu apparais dans tes stories</b>
        <div class="pf-cartes" id="pf-presence">${[["jamais", "Jamais", "Tu ne te montres pas : du texte, tes captures, et des photos de ton quotidien sans toi dessus."], ["visage", "Avec ta tête", "Tes vraies photos et vidéos portent tes stories."], ["avatar", "Avec ton avatar IA", "Les images de ton avatar IA portent tes stories."]]
          .map(([k, n, d]) => `<button type="button" class="pf-carte ${P.presence === k ? "on" : ""}" data-p="${k}"><b>${n}</b><span>${d}</span></button>`).join("")}</div></div></div>`;
    if (id === "vends") return `<div class="pf-boite"><h3>Ce que tu vends</h3><p>Ton offre principale : un produit, une formation, un service, un coaching…</p><div class="pf-grille">
        <label class="pf-champ"><b>Son nom</b><input id="pf-o-nom" value="${E(P.offre.nom)}" placeholder="ex. Mon coaching 30 jours"></label>
        <label class="pf-champ"><b>Son prix</b><small>facultatif</small><input id="pf-o-prix" value="${E(P.offre.prix)}" placeholder="ex. 147 €"></label>
        <label class="pf-champ large"><b>Ce que c'est, ce que ça change</b><textarea id="pf-o-quoi" rows="2" placeholder="ex. un programme qui t'apprend à cuisiner en 20 minutes des repas qui tiennent jusqu'au soir">${E(P.offre.quoi)}</textarea></label>
        <label class="pf-champ large"><b>Son lien</b><small>facultatif</small><input id="pf-o-lien" value="${E(P.offre.lien)}" placeholder="ex. monsite.com"></label></div></div>
      <div class="pf-boite"><h3>Ta ressource gratuite</h3><p>Un guide, une vidéo, un mini-cours… ce que tu offres pour créer la confiance. Facultatif.</p><div class="pf-grille">
        <label class="pf-champ"><b>Son nom</b><input id="pf-r-nom" value="${E(P.ressource.nom)}" placeholder="ex. le guide des 10 recettes express"></label>
        <label class="pf-champ"><b>Son lien</b><input id="pf-r-lien" value="${E(P.ressource.lien)}" placeholder="facultatif"></label>
        <label class="pf-champ large"><b>Ce qu'on y trouve</b><input id="pf-r-quoi" value="${E(P.ressource.quoi)}" placeholder="facultatif"></label></div></div>
      <div class="pf-boite"><h3>Tes mots à répondre</h3><p>La dernière story d'un jour dit « Réponds MOT » ; une réponse automatique (ManyChat par exemple) envoie le lien. Un mot court, en majuscules.</p>
        <div class="pf-mots" id="pf-mots">${(P.mots.length ? P.mots : [{ mot: "", envoie: "" }]).map(ligneMot).join("")}</div>
        <p style="margin:10px 0 0"><button type="button" class="btn petit" id="pf-mot-plus">+ Un mot</button></p></div>`;
    if (id === "voix") return `<div class="pf-grille">
      <label class="pf-champ large"><b>Ta façon de parler</b><small>Tutoiement ou vouvoiement, phrases courtes ou longues, tes expressions, ton humour, ce que tu ne dis jamais.</small>
        <textarea id="pf-parole" rows="3" placeholder="ex. je tutoie, phrases courtes, un peu provoc, des mots de tous les jours, jamais de jargon ; je dis souvent « bref » et « franchement »">${E(P.voix.parole)}</textarea></label>
      <label class="pf-champ large"><b>Des textes à toi</b><small>Colle tes légendes, tes anciennes stories, un mail à ta liste… Claude imite ta voix sans recopier tes phrases.</small>
        <textarea id="pf-textes" rows="9" placeholder="Colle ici quelques textes que tu as écrits…">${E(P.voix.paroleExemples)}</textarea></label></div>`;
    if (id === "rythme") return `<div class="pf-grille">
      <label class="pf-champ"><b>Au moins</b><select id="pf-min">${[1, 2, 3, 4, 5, 6].map(n => `<option ${P.rythme.min === n ? "selected" : ""}>${n}</option>`).join("")}</select><small>stories par jour posté</small></label>
      <label class="pf-champ"><b>Au plus</b><select id="pf-max">${[1, 2, 3, 4, 5, 6].map(n => `<option ${P.rythme.max === n ? "selected" : ""}>${n}</option>`).join("")}</select><small>stories par jour posté</small></label>
      <div class="pf-champ large"><b>Les jours où tu postes</b><div class="pf-jours" id="pf-jours">${JOURS.map(j => `<button type="button" class="${P.rythme.jours[j] ? "on" : ""}" data-j="${j}">${NOMS[j]}</button>`).join("")}</div></div>
      <label class="pf-champ large" style="grid-template-columns:auto 1fr;align-items:center"><input type="checkbox" id="pf-gif" ${P.gifChaqueStory ? "checked" : ""} style="width:18px;height:18px"><span><b>Un GIF sur chaque story</b> <small>(sinon, deux par jour au plus)</small></span></label></div>`;
    if (id === "semaine") {
      const J = P.semaine.jours, a = Object.keys(J).length;
      return `<div class="pf-boite"><h3>${a ? "Ta semaine type" : "Claude te propose ta semaine type"}</h3><p>${a ? "Retouche le rôle et le déroulé de chaque jour. Pour tout refaire, donne une idée et redemande." : "D'après ta niche, ton offre et ton rythme (≈ une minute, gratuit)."}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="pf-envie" style="flex:1;min-width:260px" placeholder="facultatif — ex. « plus de coulisses », « pas de vente le week-end »"><button type="button" class="btn ${a ? "" : "fort"}" id="pf-proposer">${a ? "Redemander à Claude" : "✦ Proposer ma semaine type"}</button></div>
        <div id="pf-sem-attente"></div></div>
        <div class="pf-sem">${JOURS.map(j => J[j] ? `<div class="pf-jour" data-j="${j}"><b>${NOMS[j]}</b><div><input value="${E(J[j].role)}"><textarea rows="5">${E(J[j].texte)}</textarea></div></div>`
          : (a ? `<div class="pf-jour off"><b>${NOMS[j]}</b><div style="padding-top:9px;color:var(--texte-3)">${P.rythme.jours[j] ? "pas de rôle" : "tu ne postes pas ce jour-là"}</div></div>` : "")).join("")}</div>`;
    }
    if (id === "style") return `<div class="pf-boite"><h3>Apprendre ton style</h3><p>Glisse un dossier de tes anciennes stories (et tes stickers, tes polices, tes GIF) : Storymatic en tire ta charte, tes couleurs, tes polices et tes éléments. Gratuit.</p>
        <a class="btn fort" href="/editeur?da=story">Ouvrir ma DA Story →</a></div>
      <div class="pf-boite"><h3>GIPHY</h3><p>${GIPHY ? '<span class="pf-ok">✓ Branché</span> — Claude trouve le bon GIF pour chaque story.' : "Pour que Claude trouve des GIF de réaction : crée une clé gratuite sur developers.giphy.com (« Create an API Key »), puis colle-la ici. Elle reste sur ton ordinateur."}</p>
        ${GIPHY ? "" : `<div style="display:flex;gap:8px"><input id="pf-giphy" style="flex:1" placeholder="ta clé GIPHY"><button type="button" class="btn" id="pf-giphy-ok">Brancher</button></div>`}</div>
      <div class="pf-boite"><h3>En détail <small style="color:var(--texte-3);font-weight:500">— facultatif</small></h3><div class="pf-grille">
        <label class="pf-champ"><b>Ce que montrent tes captures</b><input id="pf-captures" value="${E(P.captures)}" placeholder="ex. mon appli, mon site, mes outils"></label>
        <label class="pf-champ"><b>Ce que montrent tes vidéos</b><input id="pf-videos" value="${E(P.videos)}" placeholder="ex. mes Reels, les résultats de mes clients"></label>
        <label class="pf-champ large"><b>La recette d'une story</b><small>Comment une story est construite (titre, texte, punchline…). Vide : la recette de départ.</small><textarea id="pf-recette" rows="3" placeholder="${E(P.recetteDefaut)}">${E(P.recette)}</textarea></label></div></div>`;
    if (id === "elements") return `<div class="pf-cartes">${[["banque", "Mes photos", "Les photos de fond de tes stories (ton quotidien, ton travail…)", "image/*"], ["captures", "Mes captures", "Ton produit, tes outils, tes écrans", "image/*"], ["videos", "Mes vidéos", "Tes Reels, tes résultats, tes démos", "video/*"]]
        .map(([k, n, d, acc]) => `<div class="pf-carte" style="cursor:default"><b>${n}</b><span>${d}</span><p style="margin:12px 0 10px;font-weight:700">${COMPTES[k]} fichier${COMPTES[k] > 1 ? "s" : ""}</p><button type="button" class="btn petit" data-ajouter="${k}" data-accept="${acc}">+ Ajouter</button></div>`).join("")}</div>
      <p class="lead" style="margin-top:18px;font-size:13.5px">Claude les décrit ensuite d'un clic dans « Préparer la semaine » (Ma banque, Mes captures, Mes vidéos), pour savoir sur quelle story poser chacun. Tes stickers, tes patchs et tes éléments graphiques se rangent dans ta DA Story (« Les éléments »).</p>`;
    return "";
  }
  const ligneMot = m => `<div class="pf-mot"><input class="m" value="${E(m.mot)}" placeholder="MOT"><input class="e" value="${E(m.envoie)}" placeholder="ce qu'il envoie — ex. le lien de mon coaching"><button type="button" class="btn petit" data-retirer-mot title="Retirer">×</button></div>`;

  function brancher() {
    document.querySelectorAll("#pf-presence [data-p]").forEach(b => b.onclick = () => { P.presence = b.dataset.p; document.querySelectorAll("#pf-presence [data-p]").forEach(x => x.classList.toggle("on", x === b)); });
    const plus = document.getElementById("pf-mot-plus"); if (plus) plus.onclick = () => document.getElementById("pf-mots").insertAdjacentHTML("beforeend", ligneMot({ mot: "", envoie: "" }));
    document.querySelectorAll("[data-retirer-mot]").forEach(b => b.onclick = () => b.closest(".pf-mot").remove());
    document.querySelectorAll("#pf-jours [data-j]").forEach(b => b.onclick = () => { P.rythme.jours[b.dataset.j] = !P.rythme.jours[b.dataset.j]; b.classList.toggle("on"); });
    const pr = document.getElementById("pf-proposer"); if (pr) pr.onclick = async () => {
      if (OCCUPE) return; OCCUPE = true; pr.disabled = true;
      document.getElementById("pf-sem-attente").innerHTML = `<div class="pf-attente"><span class="rond"></span> Claude écrit ta semaine type d'après ton profil (≈ une minute)…</div>`;
      try { P = await api("/api/profil/semaine-type/proposer", { envie: v("pf-envie") }); } catch (e) { alert(e.message); }
      OCCUPE = false; rendre();
    };
    const gk = document.getElementById("pf-giphy-ok"); if (gk) gk.onclick = async () => {
      try { await api("/api/gifs/giphy-cle", { cle: v("pf-giphy").trim() }); GIPHY = true; rendre(); } catch (e) { alert(e.message); } };
    document.querySelectorAll("[data-ajouter]").forEach(b => b.onclick = () => {
      const i = document.createElement("input"); i.type = "file"; i.accept = b.dataset.accept; i.multiple = true;
      i.onchange = async () => { b.disabled = true; b.textContent = "Envoi…"; const k = b.dataset.ajouter;
        for (const f of i.files) { const l = await api(k === "banque" ? `/api/banque/deposer?nom=${encodeURIComponent(f.name)}` : `/api/${k}/deposer?nom=${encodeURIComponent(f.name)}`, f, true).catch(e => { alert(e.message); return null; }); if (l) COMPTES[k] = l.length; }
        rendre(); };
      i.click(); });
  }

  function rendre() {
    let el = document.getElementById("pf");
    if (!el) { el = document.createElement("div"); el.id = "pf"; el.className = "pf"; document.body.appendChild(el); }
    const x = ETAPES[K], dernier = K === ETAPES.length - 1;
    const sansSemaine = x.id === "semaine" && !Object.keys(P.semaine.jours).length;
    el.innerHTML = `<div class="pf-cadre">
      <div class="pf-tete"><div class="logo"><img src="logo.png" alt=""><b style="font-weight:inherit">Story<span>matic</span></b><small>${PREMIER ? "Bienvenue" : "Mon profil"}</small></div>
        ${PREMIER ? ((P.profils || []).length > 1 ? `<button class="btn petit x" id="pf-annuler">Annuler ce profil</button>` : "") : `<button class="btn petit x" id="pf-fermer">Fermer</button>`}</div>
      <div class="pf-fil">${ETAPES.map((e, i) => `<button type="button" class="${i === K ? "on" : i < K ? "fait" : ""}" data-k="${i}">${i + 1}. ${e.nom}</button>`).join("")}</div>
      <h1>${E(x.titre)}</h1><p class="lead">${E(x.lead)}</p>
      ${corps()}</div>
      <div class="pf-pied"><div><span class="note">${PREMIER ? "Étape " + (K + 1) + " sur " + ETAPES.length + " · tout se retouche ensuite dans « Mon profil »" : "Chaque étape s'enregistre quand tu passes à une autre."}</span>
        ${K ? `<button class="btn" id="pf-prec">← Retour</button>` : ""}
        <button class="btn fort" id="pf-suiv" ${sansSemaine && PREMIER ? "disabled" : ""}>${dernier ? (PREMIER ? "C'est parti →" : "Enregistrer et fermer") : "Continuer →"}</button></div></div>`;
    el.scrollTop = 0;
    brancher();
    const aller = async k => { try { await enregistrer(); } catch (e) { alert(e.message); return; } K = k; rendre(); };
    document.querySelectorAll(".pf-fil [data-k]").forEach(b => b.onclick = () => aller(+b.dataset.k));
    const prec = document.getElementById("pf-prec"); if (prec) prec.onclick = () => aller(K - 1);
    const f = document.getElementById("pf-fermer"); if (f) f.onclick = async () => { try { await enregistrer(); } catch (e) {} fermer(); };
    const an = document.getElementById("pf-annuler"); if (an) an.onclick = async () => {
      if (!confirm("Abandonner ce nouveau profil ?")) return;
      try { await api("/api/profils/retirer", { id: P.id }); } catch (e) { alert(e.message); return; }
      location.href = "/"; };
    document.getElementById("pf-suiv").onclick = async () => {
      if (!dernier) return aller(K + 1);
      try { await enregistrer(); P = await api("/api/profil", { complet: true }); } catch (e) { alert(e.message); return; }
      fermer();
    };
  }
  function fermer() { const el = document.getElementById("pf"); if (el) el.remove(); location.href = "/" + location.search; }

  /* ---------- LE SÉLECTEUR DE PROFILS (13 oct. 2026) : un compte Instagram = un profil ---------- */
  window.menuProfils = async function (bouton) {
    const vieux = document.getElementById("pf-menu"); if (vieux) { vieux.remove(); return; }
    let L; try { L = await api("/api/profils"); } catch (e) { alert(e.message); return; }
    const m = document.createElement("div"); m.id = "pf-menu"; m.className = "pf-menu";
    const nom = x => E(x.compte || x.prenom || "Nouveau profil") + (x.complet ? "" : " <small>(à terminer)</small>");
    m.innerHTML = L.profils.map(x => `<button data-choisir="${E(x.id)}" class="${x.id === L.actif ? "on" : ""}">${nom(x)}</button>`).join("") +
      `<hr><button data-nouveau>+ Nouveau profil <small>un autre compte</small></button>` +
      (L.profils.length > 1 ? `<button data-retirer class="rouge">Retirer ce profil…</button>` : "") +
      (window.ouvrirInstallation ? `<hr><button data-installation>Installation de l'ordinateur <small>Claude, outils</small></button>` : "");
    document.body.appendChild(m);
    const r = bouton.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 10) + "px";
    m.style.left = Math.max(10, Math.min(r.left, innerWidth - m.offsetWidth - 10)) + "px";
    const fermerMenu = e => { if (!m.contains(e.target) && e.target !== bouton) { m.remove(); document.removeEventListener("mousedown", fermerMenu); } };
    setTimeout(() => document.addEventListener("mousedown", fermerMenu));
    m.querySelectorAll("[data-choisir]").forEach(b => b.onclick = async () => {
      if (b.dataset.choisir === L.actif) { m.remove(); return; }
      try { await api("/api/profils/choisir", { id: b.dataset.choisir }); location.href = "/"; } catch (e) { alert(e.message); } });
    const ins = m.querySelector("[data-installation]"); if (ins) ins.onclick = () => { m.remove(); window.ouvrirInstallation({}); };
    m.querySelector("[data-nouveau]").onclick = async () => { try { await api("/api/profils/nouveau", {}); location.href = "/"; } catch (e) { alert(e.message); } };
    const ret = m.querySelector("[data-retirer]"); if (ret) ret.onclick = async () => {
      const a = L.profils.find(x => x.id === L.actif) || {};
      if (!confirm("Retirer le profil « " + (a.compte || a.prenom || a.id) + " » ? Ses réponses partent dans la corbeille ; ses semaines, sa DA et ses fichiers restent sur l'ordinateur.")) return;
      try { await api("/api/profils/retirer", { id: L.actif }); location.href = "/"; } catch (e) { alert(e.message); } };
  };

  /** Ouvre le parcours : { premier: true } au premier lancement (pas de bouton Fermer). */
  window.ouvrirProfil = async function (o) {
    PREMIER = !!(o && o.premier); K = 0;
    P = await api("/api/profil");
    try { GIPHY = !!(await api("/api/gifs")).giphy; } catch (e) {}
    try { const [b, c, vi] = await Promise.all([api("/api/banque"), api("/api/captures"), api("/api/videos")]); COMPTES = { banque: b.length, captures: c.length, videos: vi.length }; } catch (e) {}
    rendre();
  };
})();
