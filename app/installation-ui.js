/* ============================================================
   LA PAGE « INSTALLATION » (13 oct. 2026, reprise de MOSAIC) — serveur : installation.js
   ------------------------------------------------------------
   Storymatic s'installe lui-même, sans terminal : un voyant par pièce ; « Tout installer » pour ce qui s'installe seul,
   un bouton pour le compte Claude. La page s'ouvre d'elle-même au démarrage tant que l'ordinateur n'est pas prêt
   (avant « Faisons connaissance »), puis depuis le menu du profil (« Installation de l'ordinateur »).
   window.ouvrirInstallation({ premier }) → une promesse, tenue quand on quitte la page.
   ============================================================ */
(function () {
  const PIECES = [
    { id: "claude", nom: "Claude Code", txt: "Le cerveau de Storymatic : c'est lui qui écrit tes stories et les met en page." },
    { id: "compte", nom: "Ton compte Claude", txt: "Storymatic travaille avec ton abonnement Claude (Pro ou Max). Une connexion, une seule fois." },
    { id: "ffmpeg", nom: "Les outils vidéo", txt: "Pour exporter les stories qui bougent : GIF, vidéos (ffmpeg, gratuit)." },
    { id: "navigateur", nom: "Le navigateur", txt: "Pour mettre en page et exporter tes stories. Ton ordinateur n'a ni Chrome ni Edge : Storymatic en installe un, rien que pour lui." },
    { id: "raccourci", nom: "L'icône sur le Bureau", txt: "Pour ouvrir Storymatic d'un double-clic, tous les jours." },
    { id: "detourage", nom: "Le détourage gratuit — facultatif", txt: "« Supprimer le fond » de tes photos et de tes éléments, sur ton ordinateur, sans rien payer. Environ 1 Go à télécharger." },
    { id: "giphy", nom: "GIPHY — facultatif", txt: "Pour que Storymatic trouve tout seul des GIF qui collent à tes stories. Il faut une clé gratuite, la tienne." }
  ];
  const E = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let ETAT = null, ERREUR = "", SONDE = null, FIN = null, PREMIER = false, CODE = "", CLE = "";

  const css = document.createElement("style");
  css.textContent = `
  .ins { position: fixed; inset: 0; z-index: 70; overflow-y: auto; background: radial-gradient(1100px 620px at 92% -12%, rgba(210,63,224,.19), transparent 62%), radial-gradient(900px 520px at -8% -10%, rgba(253,171,61,.08), transparent 60%), linear-gradient(165deg, #1A1029 0%, #120B1D 50%, #170B22 100%); }
  .ins-cadre { max-width: 860px; margin: 0 auto; padding: 26px 24px 80px; }
  .ins-tete { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
  .ins-sur { color: var(--o2); font: 700 12px/1 var(--corps); letter-spacing: .14em; text-transform: uppercase; margin: 0 0 10px; }
  .ins .lead { color: var(--texte-2); margin: 8px 0 22px; font-size: 15px; max-width: 680px; }
  .ins-bandeau { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .ins-jauge { flex: 1; min-width: 220px; display: flex; align-items: center; gap: 12px; color: var(--texte-2); font-size: 13px; font-weight: 600; }
  .ins-jauge > div { flex: 1; height: 8px; border-radius: 99px; background: var(--carte-2); overflow: hidden; }
  .ins-jauge i { display: block; height: 100%; background: var(--grad); border-radius: 99px; transition: width .4s; }
  .ins-liste { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .ins-piece { display: grid; grid-template-columns: 34px 1fr; gap: 14px; background: var(--carte); border: 1px solid var(--bord); border-radius: 16px; padding: 16px; }
  .ins-piece.ok { border-color: rgba(74,222,128,.35); }
  .ins-voyant { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--carte-2); color: var(--texte-2); border: 1px solid var(--bord-2); }
  .ins-piece.ok .ins-voyant { background: rgba(74,222,128,.16); color: var(--vert); border-color: rgba(74,222,128,.5); }
  .ins-piece.tourne .ins-voyant { border: 3px solid var(--bord-2); border-top-color: var(--o); animation: insT 1s linear infinite; }
  @keyframes insT { to { transform: rotate(360deg); } }
  .ins-ligne { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .ins-ligne b { font: 800 16px/1.25 var(--titre); letter-spacing: -.01em; }
  .ins-statut { margin-left: auto; font-size: 12.5px; color: var(--texte-3); font-weight: 600; }
  .ins-piece.ok .ins-statut { color: var(--vert); }
  .ins-txt { margin: 4px 0 0; color: var(--texte-2); font-size: 13.5px; }
  .ins-progres { margin-top: 10px; display: grid; gap: 6px; font-size: 12.5px; color: var(--texte-2); }
  .ins-progres > div { height: 6px; border-radius: 99px; background: var(--carte-2); overflow: hidden; }
  .ins-progres i { display: block; height: 100%; background: var(--grad); transition: width .4s; }
  .ins-erreur { margin: 10px 0 0; color: var(--rouge); font-size: 13px; }
  .ins-info { margin: 10px 0 0; color: var(--texte-2); font-size: 13px; }
  .ins-petit { margin: 8px 0 0; color: var(--texte-3); font-size: 12.5px; }
  .ins-petit a, .ins-info a { color: var(--o2); }
  .ins-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .ins-champ { display: flex; gap: 8px; margin-top: 10px; } .ins-champ input { flex: 1; padding: 10px 12px; }
  .ins-pouls { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--o); margin-right: 8px; animation: insP 1.2s ease-in-out infinite; }
  @keyframes insP { 50% { opacity: .25; } }
  .ins-lien { background: none; border: 0; color: var(--texte-3); text-decoration: underline; cursor: pointer; font-size: 12.5px; padding: 0; margin-top: 8px; }
  .ins-pied { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-top: 22px; }
  body.ins-manque-la { padding-top: 48px; } body.ins-manque-la .pf { top: 48px; }
  .ins-manque { position: fixed; top: 0; left: 0; right: 0; min-height: 48px; z-index: 65; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; background: rgba(40,14,22,.96); border-bottom: 1px solid rgba(255,122,122,.5); padding: 10px 22px; font-size: 13.5px; }
  .ins-manque b { color: #FF9EC0; }`;
  document.head.appendChild(css);

  const ok = (id, e) => id === "compte" ? !!e.pieces.compte.connecte : !!(e.pieces[id] && e.pieces[id].ok);
  const tourne = t => t && (t.etat === "en-cours" || t.etat === "attente");
  async function api(url, corps) {
    const r = await fetch(url, corps === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.erreur) throw new Error(j.erreur || ("Erreur " + r.status));
    return j;
  }
  async function charger(frais) {
    try { ETAT = await api("/api/installation" + (frais ? "?frais=1" : "")); ERREUR = ""; } catch (e) { ERREUR = e.message; }
    rendre();
  }
  const quelqueChoseTourne = () => ETAT && (Object.values(ETAT.taches || {}).some(tourne) || Object.values(ETAT.connexions || {}).some(c => c.etat === "en-cours"));
  function sonder() {
    clearTimeout(SONDE);
    SONDE = setTimeout(async () => { if (!document.getElementById("ins")) return; await charger(false); sonder(); }, quelqueChoseTourne() ? 1200 : 5000);
  }

  function rendre() {
    const box = document.getElementById("ins"); if (!box) return;
    const e = ETAT;
    // ce qu'on est en train de taper ne doit pas disparaître au rafraîchissement
    const actif = document.activeElement && document.activeElement.id;
    if (document.getElementById("ins-code")) CODE = document.getElementById("ins-code").value;
    if (document.getElementById("ins-cle")) CLE = document.getElementById("ins-cle").value;
    if (!e) { box.querySelector(".ins-liste").innerHTML = `<li class="ins-info">${ERREUR ? "Storymatic n'a pas pu faire le point : " + E(ERREUR) : "Storymatic regarde ce qui est déjà installé sur ton ordinateur…"}</li>`; return; }
    const visibles = PIECES.filter(p => (p.id !== "navigateur" || !e.pieces.navigateur.ok || tourne(e.taches.navigateur)) && (p.id !== "raccourci" || e.systeme !== "autre"));
    const obligatoires = visibles.filter(p => !(e.pieces[p.id] || {}).facultatif);
    const prets = obligatoires.filter(p => ok(p.id, e)).length;
    box.querySelector("#ins-bilan").textContent = prets + " sur " + obligatoires.length + " prêts";
    box.querySelector("#ins-jauge").style.width = Math.round(100 * prets / obligatoires.length) + "%";
    const auto = ["claude", "ffmpeg", "navigateur", "raccourci"].some(id => visibles.some(p => p.id === id) && !ok(id, e));
    const tt = Object.values(e.taches || {}).some(tourne);
    const bt = box.querySelector("#ins-tout");
    bt.hidden = !auto && !tt; bt.disabled = tt; bt.textContent = tt ? "Installation en cours…" : "Tout installer";
    box.querySelector("#ins-fin").hidden = !e.pret;
    box.querySelector("#ins-tard").hidden = e.pret;
    const l = box.querySelector(".ins-liste"); l.innerHTML = "";
    visibles.forEach((p, k) => l.appendChild(piece(p, k + 1, e)));
    if (actif && document.getElementById(actif)) { const x = document.getElementById(actif); x.focus(); try { x.setSelectionRange(x.value.length, x.value.length); } catch (er) {} }
  }

  function piece(p, n, e) {
    const o = ok(p.id, e), t = (e.taches || {})[p.id], tr = tourne(t);
    const li = document.createElement("li");
    li.className = "ins-piece " + (o ? "ok" : tr ? "tourne" : "");
    li.innerHTML = `<span class="ins-voyant">${o ? "✓" : tr ? "" : n}</span><div><div class="ins-ligne"><b>${E(p.nom)}</b><span class="ins-statut">${statut(p.id, o, t, e)}</span></div><p class="ins-txt">${E(p.txt)}</p></div>`;
    const c = li.lastElementChild;
    const html = h => c.insertAdjacentHTML("beforeend", h);
    const actions = document.createElement("div"); actions.className = "ins-actions";
    const bouton = (txt, fort, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn petit" + (fort ? " fort" : ""); b.textContent = txt; b.onclick = fn; actions.appendChild(b); return b; };
    if (tr) html(`<div class="ins-progres"><div><i style="width:${t.progres || 0}%"></i></div><span>${E(t.detail || "")}</span></div>`);
    else if (t && t.etat === "erreur" && !o) html(`<p class="ins-erreur">${E(t.erreur)}</p>`);

    if (p.id === "compte") {
      const cc = (e.connexions || {}).compte;
      if (o) {
        const ab = (e.pieces.compte.abonnement || "").toLowerCase();
        html(`<p class="ins-info">Connecté : <b>${E(e.pieces.compte.email || "")}</b>${ab ? " · abonnement " + E(ab.charAt(0).toUpperCase() + ab.slice(1)) : ""}</p>`);
        if (ab && !/pro|max|team|enterprise/.test(ab)) html(`<p class="ins-erreur">Ce compte n'a pas d'abonnement Pro ou Max : Storymatic ne pourra pas travailler. Prends un abonnement sur claude.ai, ou change de compte.</p>`);
        const ch = document.createElement("button"); ch.type = "button"; ch.className = "ins-lien"; ch.textContent = "Changer de compte";
        ch.onclick = () => { if (confirm("Storymatic se déconnecte de " + (e.pieces.compte.email || "ce compte") + ", puis ouvre la page de connexion pour le compte de ton choix.")) connecter("/api/installation/compte/changer"); };
        c.appendChild(ch);
      } else if (!e.pieces.claude.ok) html(`<p class="ins-info">D'abord Claude Code (juste au-dessus).</p>`);
      else if (cc && cc.etat === "en-cours") {
        html(`<p class="ins-info"><span class="ins-pouls"></span>Une page de connexion vient de s'ouvrir dans ton navigateur. Connecte-toi avec ton compte Claude, autorise l'accès, puis reviens ici : le voyant passera au vert tout seul.</p>` +
          (cc.url ? `<p class="ins-petit">Elle ne s'est pas ouverte ? <a href="${E(cc.url)}" target="_blank" rel="noopener">Ouvrir la page de connexion</a></p>` : "") +
          `<p class="ins-petit">La page te donne un code à recopier ? Colle-le ici :</p><div class="ins-champ"><input id="ins-code" type="text" placeholder="Le code de la page de connexion" autocomplete="off" value="${E(CODE)}"><button type="button" class="btn petit" id="ins-code-ok">Valider</button></div>`);
        setTimeout(() => { const b = document.getElementById("ins-code-ok"); if (b) b.onclick = envoyerCode; });
        if (cc.url) bouton("Copier le lien de connexion", false, ev => copier(cc.url, ev.target));
        bouton("Annuler", false, async () => { try { await api("/api/installation/compte/annuler", {}); } catch (er) {} charger(false); });
      } else {
        if (cc && cc.etat === "erreur") html(`<p class="ins-erreur">${E(cc.erreur || "La connexion n'a pas abouti.")}</p>`);
        bouton("Se connecter à Claude", true, () => connecter("/api/installation/compte"));
        html(`<p class="ins-petit">Pas encore d'abonnement ? <a href="https://claude.ai/upgrade" target="_blank" rel="noopener">claude.ai</a> — Pro suffit pour commencer.</p>`);
      }
    } else if (p.id === "detourage") {
      if (!o && !tr) bouton(t && t.etat === "erreur" ? "Réessayer" : "Installer le détourage", false, () => installer("detourage"));
    } else if (p.id === "giphy") {
      if (o) {
        const x = document.createElement("button"); x.type = "button"; x.className = "ins-lien"; x.textContent = "Retirer ma clé";
        x.onclick = async () => { try { await api("/api/gifs/giphy-cle", { cle: "" }); } catch (er) { alert(er.message); } charger(true); };
        c.appendChild(x);
      } else {
        html(`<p class="ins-petit">Sur <a href="https://developers.giphy.com/dashboard/" target="_blank" rel="noopener">developers.giphy.com</a> : crée un compte, clique « Create an API Key », choisis « API », donne un nom (ex. Storymatic), puis copie la clé et colle-la ici. Elle reste sur ton ordinateur.</p>` +
          `<div class="ins-champ"><input id="ins-cle" type="text" placeholder="Ta clé GIPHY" autocomplete="off" value="${E(CLE)}"><button type="button" class="btn petit" id="ins-cle-ok">Enregistrer</button></div>`);
        setTimeout(() => { const b = document.getElementById("ins-cle-ok"); if (b) b.onclick = async () => {
          const v = (document.getElementById("ins-cle").value || "").trim(); if (!v) return;
          try { await api("/api/gifs/giphy-cle", { cle: v }); CLE = ""; } catch (er) { alert(er.message); } charger(true); }; });
      }
    } else if (p.id === "raccourci") {
      if (!o && !tr) bouton(t && t.etat === "erreur" ? "Réessayer" : "Poser l'icône sur le Bureau", false, () => installer("raccourci"));
    } else if (!o && !tr && t && t.etat === "erreur") bouton("Réessayer", true, () => installer(p.id));
    if (actions.children.length) c.appendChild(actions);
    return li;
  }
  function statut(id, o, t, e) {
    if (o) return "Prêt";
    if (t && t.etat === "en-cours") return (t.progres || 0) + " %";
    if (t && t.etat === "attente") return "En attente";
    if (t && t.etat === "erreur") return "À refaire";
    if (id === "compte") return "À connecter";
    if ((e.pieces[id] || {}).facultatif) return "Facultatif";
    return "À installer";
  }
  async function installer(id) { try { await api("/api/installation/installer/" + id, {}); } catch (e) {} await charger(false); sonder(); }
  async function connecter(url) {
    try { await api(url, {}); } catch (e) { alert("La connexion n'a pas pu démarrer : " + e.message); }
    await charger(false); sonder();
  }
  async function envoyerCode() {
    const v = (document.getElementById("ins-code").value || "").trim(); if (!v) return;
    try { await api("/api/installation/compte/code", { code: v }); CODE = ""; } catch (e) { alert("Le code n'a pas pu être transmis : " + e.message); }
    charger(false);
  }
  async function copier(url, b) {
    try { await navigator.clipboard.writeText(url); } catch (e) { const z = document.createElement("textarea"); z.value = url; document.body.appendChild(z); z.select(); try { document.execCommand("copy"); } catch (x) {} z.remove(); }
    const t = b.textContent; b.textContent = "Lien copié ✓"; setTimeout(() => { b.textContent = t; }, 2000);
  }
  function fermer(plusTard) {
    clearTimeout(SONDE);
    if (plusTard) try { sessionStorage.setItem("ins-plus-tard", "1"); } catch (e) {}
    const b = document.getElementById("ins"); if (b) b.remove();
    const f = FIN; FIN = null; if (f) f(ETAT && ETAT.pret);
  }

  /** Ouvre la page. { premier: true } au démarrage. Tenue quand on la quitte (vrai si tout est prêt). */
  window.ouvrirInstallation = function (o) {
    PREMIER = !!(o && o.premier);
    if (document.getElementById("ins")) return new Promise(ok => { FIN = ok; });
    const box = document.createElement("div"); box.className = "ins"; box.id = "ins";
    box.innerHTML = `<div class="ins-cadre">
      <div class="ins-tete"><div class="logo"><img src="logo.png" alt=""><b style="font-weight:inherit">Story<span>matic</span></b><small>installation</small></div>
        ${PREMIER ? "" : `<button class="btn petit" id="ins-x" style="margin-left:auto">Fermer</button>`}</div>
      <p class="ins-sur">Installation de l'ordinateur</p>
      <h1>On installe tout, <em>une seule fois</em></h1>
      <p class="lead">Storymatic met ses outils en place tout seul : tu n'as qu'à connecter ton compte Claude. Rien n'est payant, à part ton abonnement Claude.</p>
      <div class="ins-bandeau"><button type="button" class="btn fort" id="ins-tout">Tout installer</button>
        <div class="ins-jauge"><div><i id="ins-jauge"></i></div><span id="ins-bilan"></span></div></div>
      <ol class="ins-liste"></ol>
      <div class="ins-pied"><button type="button" class="btn fort" id="ins-fin" hidden>Tout est prêt — ouvrir Storymatic →</button>
        <button type="button" class="ins-lien" id="ins-tard">Plus tard — aller à Storymatic</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector("#ins-tout").onclick = async ev => { ev.target.disabled = true; try { await api("/api/installation/tout", {}); } catch (e) {} await charger(false); sonder(); };
    box.querySelector("#ins-fin").onclick = () => fermer(false);
    box.querySelector("#ins-tard").onclick = () => fermer(true);
    if (box.querySelector("#ins-x")) box.querySelector("#ins-x").onclick = () => fermer(false);
    rendre(); charger(true); sonder();
    return new Promise(ok => { FIN = ok; });
  };

  /** Au démarrage : l'ordinateur est-il prêt ? Sinon la page s'ouvre (sauf « Plus tard » dans cette séance, où un bandeau
      la rappelle). Tenue quand on peut continuer. */
  window.verifierInstallation = async function () {
    let d = null; try { d = await api("/api/installation/resume"); } catch (e) { return; }
    if (!d || d.pret) return;
    let tard = false; try { tard = sessionStorage.getItem("ins-plus-tard") === "1"; } catch (e) {}
    if (!tard || /[?&]installation=1/.test(location.search)) { await window.ouvrirInstallation({ premier: true }); try { d = await api("/api/installation/resume"); } catch (e) {} }
    if (d && !d.pret && !document.getElementById("ins-manque")) {
      const b = document.createElement("div"); b.className = "ins-manque"; b.id = "ins-manque";
      b.innerHTML = `<span><b>Il manque des outils sur ton ordinateur</b> — sans eux, Storymatic ne peut pas écrire ni exporter tes stories.</span><button class="btn petit fort">Ouvrir l'installation</button>`;
      b.querySelector("button").onclick = async () => { await window.ouvrirInstallation({}); const r = await api("/api/installation/resume").catch(() => null); if (r && r.pret) { b.remove(); document.body.classList.remove("ins-manque-la"); } };
      document.body.prepend(b); document.body.classList.add("ins-manque-la");
    }
  };
})();
