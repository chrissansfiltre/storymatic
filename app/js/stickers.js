/* ============================================================
   « REFAIRE DES STICKERS » (13 oct. 2026) — la fenêtre ; le travail est dans stickers.js (serveur).
   Une image de stickers qui plaît → Claude les redessine en français, en PNG transparent → la personne garde ceux
   qu'elle veut : ils entrent dans les éléments de sa DA Story. Ouverte depuis le tiroir « Les éléments » (da.js).
   ============================================================ */
const STK = { id: null, session: null, minuteur: null, choix: new Set(), surAjout: null, image: null, options: { textes: "traduire", couleurs: "image" } };

(function () {
  const css = `
  #stk-fond{position:fixed;inset:0;z-index:900;background:rgba(10,6,18,.72);display:flex;align-items:center;justify-content:center;padding:24px}
  #stk{width:min(1100px,100%);max-height:100%;overflow:auto;background:var(--panneau);border:1px solid var(--bord-clair);border-radius:18px;padding:22px 24px 24px;color:var(--texte)}
  #stk h2{margin:0;font-family:var(--titres);font-size:22px}
  #stk .stk-tete{display:flex;align-items:center;gap:12px;margin-bottom:6px}
  #stk .stk-tete button{margin-left:auto;background:none;border:0;color:var(--texte-2);font-size:26px;cursor:pointer}
  #stk .stk-lead{color:var(--texte-2);margin:0 0 18px;font-size:14px;line-height:1.5}
  #stk .stk-depot{border:2px dashed var(--bord-clair);border-radius:14px;min-height:220px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;cursor:pointer;color:var(--texte-2);text-align:center;padding:16px;background:var(--panneau-2)}
  #stk .stk-depot.survol{border-color:var(--accent);color:var(--texte)}
  #stk .stk-depot img{max-height:320px;max-width:100%;border-radius:8px}
  #stk .stk-opts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}
  #stk .stk-opt b{display:block;font-size:13px;margin-bottom:6px;color:var(--texte-2)}
  #stk .stk-seg{display:flex;gap:6px;flex-wrap:wrap}
  #stk .stk-seg button{flex:1;min-width:140px;padding:10px 12px;border-radius:10px;border:1px solid var(--bord-clair);background:var(--panneau-2);color:var(--texte-2);cursor:pointer;font:inherit;font-size:13px;text-align:left}
  #stk .stk-seg button.on{border-color:var(--accent);color:var(--texte);background:rgba(244,75,123,.12)}
  #stk .stk-seg small{display:block;color:var(--texte-3);margin-top:2px}
  #stk textarea{width:100%;box-sizing:border-box;background:var(--panneau-2);border:1px solid var(--bord-clair);border-radius:10px;color:var(--texte);padding:10px 12px;font:inherit;font-size:14px;resize:vertical}
  #stk .stk-go{margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  #stk .stk-btn{padding:12px 20px;border-radius:12px;border:0;background:var(--pms-grad);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  #stk .stk-btn:disabled{opacity:.5;cursor:default}
  #stk .stk-etat{display:flex;gap:14px;align-items:center;background:var(--panneau-2);border-radius:12px;padding:12px 14px;margin-bottom:16px}
  #stk .stk-etat img{width:64px;height:64px;object-fit:cover;border-radius:8px}
  #stk .stk-etat .stk-rond{width:18px;height:18px;border-radius:50%;border:3px solid var(--bord-clair);border-top-color:var(--accent);animation:stkt 1s linear infinite;flex:none}
  @keyframes stkt{to{transform:rotate(360deg)}}
  #stk .stk-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  #stk .stk-carte{background:var(--panneau-2);border:2px solid transparent;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px}
  #stk .stk-carte.on{border-color:var(--accent)}
  #stk .stk-img{height:190px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;
    background:repeating-conic-gradient(#3a2d52 0 25%,#2c2140 0 50%) 0 0/18px 18px}
  #stk .stk-img img{max-width:92%;max-height:92%}
  #stk .stk-img .stk-coche{position:absolute;top:8px;left:8px;width:24px;height:24px;border-radius:7px;background:rgba(0,0,0,.45);border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px}
  #stk .stk-carte.on .stk-coche{background:var(--accent);border-color:var(--accent)}
  #stk .stk-img .stk-rond{width:28px;height:28px;border-radius:50%;border:3px solid var(--bord-clair);border-top-color:var(--accent);animation:stkt 1s linear infinite}
  #stk .stk-nom{font-weight:700;font-size:14px}
  #stk .stk-txt{font-size:12px;color:var(--texte-2);line-height:1.4}
  #stk .stk-garde{font-size:12px;color:var(--ok)}
  #stk .stk-err{font-size:12px;color:var(--alerte)}
  #stk .stk-ret{display:flex;flex-direction:column;gap:6px}
  #stk .stk-pied{position:sticky;bottom:-24px;margin:18px -24px -24px;padding:14px 24px;background:var(--panneau);border-top:1px solid var(--bord);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  #stk .stk-passees{margin-top:22px}
  #stk .stk-passees b{font-size:13px;color:var(--texte-2)}
  #stk .stk-passees div{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
  #stk .stk-passees button{background:var(--panneau-2);border:1px solid var(--bord-clair);border-radius:10px;padding:6px;cursor:pointer;color:var(--texte-2);font-size:11px;display:flex;flex-direction:column;align-items:center;gap:4px}
  #stk .stk-passees img{width:84px;height:84px;object-fit:cover;border-radius:6px}
  @media (max-width:700px){#stk .stk-opts{grid-template-columns:1fr}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
})();

const stkEch = t => (typeof echapper === "function" ? echapper(t) : String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
async function stkApi(url, corps) {
  const r = await fetch(url, corps ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) } : {});
  const j = await r.json().catch(() => ({ erreur: "Réponse illisible." }));
  if (j.erreur) throw new Error(j.erreur);
  return j;
}

// l'image, réduite à 2000 px au plus (Claude n'en voit pas plus, et l'envoi reste léger)
function stkReduire(f) {
  return new Promise((ok, ko) => {
    const u = URL.createObjectURL(f), i = new Image();
    i.onload = () => { const k = Math.min(1, 2000 / Math.max(i.width, i.height)), c = document.createElement("canvas");
      c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); ok(c.toDataURL(f.type === "image/png" ? "image/png" : "image/jpeg", .92)); };
    i.onerror = () => { URL.revokeObjectURL(u); ko(new Error("Cette image est illisible.")); };
    i.src = u;
  });
}

window.ouvrirStickers = function (o) {
  STK.surAjout = (o && o.surAjout) || null;
  if (!document.getElementById("stk-fond")) {
    const f = document.createElement("div"); f.id = "stk-fond";
    f.innerHTML = '<div id="stk" role="dialog" aria-label="Refaire des stickers"></div>';
    f.addEventListener("mousedown", e => { if (e.target === f) stkFermer(); });
    document.body.appendChild(f);
  }
  stkRendre();
};
function stkFermer() { clearTimeout(STK.minuteur); const f = document.getElementById("stk-fond"); if (f) f.remove(); }

async function stkRendre() {
  const b = document.getElementById("stk"); if (!b) return;
  const s = STK.session;
  const tete = `<div class="stk-tete"><h2>✦ Refaire des stickers</h2><button type="button" id="stk-x" aria-label="Fermer">×</button></div>`;
  if (!s) {
    let passees = [];
    try { passees = (await stkApi("/api/stickers")).sessions || []; } catch (e) {}
    b.innerHTML = tete + `<p class="stk-lead">Dépose l'image d'une planche de stickers qui te plaît (Pinterest, une capture…). Claude les redessine un par un, avec des textes en français, en PNG à fond transparent. Tu gardes ceux que tu veux : ils rejoignent tes éléments, et Claude les pose dans tes stories. Gratuit, aucun crédit.</p>
      <div class="stk-depot" id="stk-depot">${STK.image ? `<img src="${STK.image}" alt="">` : `<span style="font-size:34px">🖼️</span><b>Glisse ton image ici</b><span>ou clique pour la choisir</span>`}</div>
      <div class="stk-opts">
        <div class="stk-opt"><b>Les textes</b><div class="stk-seg" data-o="textes">
          <button type="button" data-v="traduire">Traduits en français<small>même humour, même longueur</small></button>
          <button type="button" data-v="adapter">Adaptés à mon univers<small>réécrits pour ta niche et ta cible</small></button></div></div>
        <div class="stk-opt"><b>Les couleurs</b><div class="stk-seg" data-o="couleurs">
          <button type="button" data-v="image">Celles de l'image<small>la planche telle quelle</small></button>
          <button type="button" data-v="da">Celles de ma DA<small>tes couleurs et tes polices</small></button></div></div>
      </div>
      <textarea id="stk-consigne" rows="2" maxlength="800" placeholder="Une demande en plus ? (facultatif) — ex. « que des stickers sur le sport », « remplace le café par du thé », « tutoie »">${stkEch(STK.consigne || "")}</textarea>
      <div class="stk-go"><button type="button" class="stk-btn" id="stk-lancer" ${STK.image ? "" : "disabled"}>Refaire ces stickers</button><span class="stk-txt">Compte 3 à 8 minutes selon le nombre de stickers.</span></div>
      ${passees.length ? `<div class="stk-passees"><b>Mes planches refaites</b><div>${passees.map(p => `<button type="button" data-s="${p.id}"><img src="${p.modele}" alt=""><span>${p.etat === "travail" ? "en cours…" : p.nb + " sticker" + (p.nb > 1 ? "s" : "")}</span></button>`).join("")}</div></div>` : ""}`;
    b.querySelectorAll(".stk-seg").forEach(g => g.querySelectorAll("button").forEach(x => {
      x.classList.toggle("on", STK.options[g.dataset.o] === x.dataset.v);
      x.onclick = () => { STK.options[g.dataset.o] = x.dataset.v; g.querySelectorAll("button").forEach(y => y.classList.toggle("on", y === x)); };
    }));
    b.querySelector("#stk-consigne").oninput = e => { STK.consigne = e.target.value; };
    const depot = b.querySelector("#stk-depot");
    const prendre = async f => { if (!f || !/^image\//.test(f.type)) return; try { STK.image = await stkReduire(f); stkRendre(); } catch (e) { stkInformer(e.message); } };
    depot.onclick = async () => prendre((await pgChoisirFichiers("image/png,image/jpeg,image/webp"))[0]);
    depot.ondragover = e => { e.preventDefault(); depot.classList.add("survol"); };
    depot.ondragleave = () => depot.classList.remove("survol");
    depot.ondrop = e => { e.preventDefault(); depot.classList.remove("survol"); prendre(e.dataTransfer.files[0]); };
    b.querySelector("#stk-lancer").onclick = async ev => {
      ev.target.disabled = true;
      try { STK.session = await stkApi("/api/stickers", { donnees: STK.image, textes: STK.options.textes, couleurs: STK.options.couleurs, consigne: b.querySelector("#stk-consigne").value });
        STK.image = null; STK.consigne = ""; STK.choix = new Set(); stkRendre(); stkSuivre(); }
      catch (e) { ev.target.disabled = false; stkInformer(e.message); }
    };
    b.querySelectorAll(".stk-passees [data-s]").forEach(x => x.onclick = async () => { try { STK.session = await stkApi("/api/stickers/" + x.dataset.s); STK.choix = new Set(); stkRendre(); stkSuivre(); } catch (e) { stkInformer(e.message); } });
  } else {
    const prets = s.stickers.filter(x => x.png), enCours = s.etat === "travail", occupe = enCours || s.stickers.some(x => x.travail);
    // d'office, tout ce qui est prêt et pas encore gardé est choisi
    prets.forEach(x => { if (!x.garde && !STK.choix.has("vu" + x.n)) { STK.choix.add(x.n); STK.choix.add("vu" + x.n); } });
    const nb = prets.filter(x => STK.choix.has(x.n) && !x.garde).length;
    b.innerHTML = tete + `
      <div class="stk-etat"><img src="${s.modele}" alt="">${enCours ? `<span class="stk-rond"></span><div><b>${stkEch(s.message || "Au travail…")}</b><div class="stk-txt">Tu peux fermer cette fenêtre : le travail continue, tu le retrouves dans « Mes planches refaites ».</div></div>`
        : s.etat === "erreur" ? `<div class="stk-err">${stkEch(s.erreur)}</div>` : `<div><b>${prets.length} sticker${prets.length > 1 ? "s" : ""} prêt${prets.length > 1 ? "s" : ""}</b><div class="stk-txt">Clique un sticker pour le choisir ou non. « Retoucher » : change son texte ou dis ce qui ne va pas.</div></div>`}</div>
      <div class="stk-grille">${s.stickers.map(x => `<div class="stk-carte ${STK.choix.has(x.n) && x.png && !x.garde ? "on" : ""}" data-n="${x.n}">
        <div class="stk-img">${x.png && !x.travail ? `<img src="${x.png}" alt="${stkEch(x.nom)}">${x.garde ? "" : `<span class="stk-coche">${STK.choix.has(x.n) ? "✓" : ""}</span>`}` : x.erreur && !enCours ? "" : `<span class="stk-rond"></span>`}</div>
        <div class="stk-nom">${stkEch(x.nom)}</div><div class="stk-txt">${stkEch(x.texte)}</div>
        ${x.garde ? `<div class="stk-garde">✓ dans tes éléments</div>` : ""}${x.erreur ? `<div class="stk-err">${stkEch(x.erreur)}</div>` : ""}
        ${x.png && !occupe ? `<button type="button" class="btn-mini stk-retoucher">Retoucher</button>` : ""}</div>`).join("")}</div>
      <div class="stk-pied">${!enCours && prets.length ? `<button type="button" class="stk-btn" id="stk-garder" ${nb ? "" : "disabled"}>Ajouter ${nb ? nb + " sticker" + (nb > 1 ? "s" : "") : "les stickers choisis"} à mes éléments</button>` : ""}
        ${s.dossier ? `<button type="button" class="btn-mini" id="stk-dossier">Ouvrir le dossier</button>` : ""}
        <button type="button" class="btn-mini" id="stk-neuf" style="margin-left:auto">Nouvelle planche</button></div>`;
    b.querySelectorAll(".stk-carte").forEach(c => {
      const n = Number(c.dataset.n), x = s.stickers.find(y => y.n === n);
      c.querySelector(".stk-img").onclick = () => { if (!x.png || x.garde) return; STK.choix.has(n) ? STK.choix.delete(n) : STK.choix.add(n); stkRendre(); };
      const r = c.querySelector(".stk-retoucher");
      if (r) r.onclick = () => {
        r.outerHTML = `<div class="stk-ret"><textarea rows="2" class="stk-ret-texte" maxlength="400" placeholder="Son texte">${stkEch(x.texte)}</textarea>
          <textarea rows="2" class="stk-ret-consigne" maxlength="600" placeholder="Ce qui ne va pas — ex. « le texte dépasse », « plus gros », « mets-le en violet »"></textarea>
          <button type="button" class="btn-mini btn-mini-fort stk-ret-go">Refaire ce sticker</button></div>`;
        c.querySelector(".stk-ret-go").onclick = async () => {
          try { STK.session = await stkApi("/api/stickers/" + s.id + "/retoucher/" + n, { texte: c.querySelector(".stk-ret-texte").value, consigne: c.querySelector(".stk-ret-consigne").value });
            STK.choix.delete("vu" + n); stkRendre(); stkSuivre(); } catch (e) { stkInformer(e.message); }
        };
      };
    });
    const g = b.querySelector("#stk-garder");
    if (g) g.onclick = async () => {
      g.disabled = true; g.textContent = "Ajout…";
      try { STK.session = await stkApi("/api/stickers/" + s.id + "/garder", { numeros: prets.filter(x => STK.choix.has(x.n) && !x.garde).map(x => x.n) });
        stkRendre(); if (STK.surAjout) STK.surAjout(); stkInformer("Stickers ajoutés à tes éléments ✓ — Claude les posera dans tes stories quand ils collent au propos."); }
      catch (e) { g.disabled = false; stkInformer(e.message); }
    };
    if (b.querySelector("#stk-dossier")) b.querySelector("#stk-dossier").onclick = () => stkApi("/api/stickers/" + s.id + "/dossier", {}).catch(e => stkInformer(e.message));
    b.querySelector("#stk-neuf").onclick = () => { clearTimeout(STK.minuteur); STK.session = null; stkRendre(); };
  }
  b.querySelector("#stk-x").onclick = stkFermer;
}

// tant que Claude travaille : on relit la planche toutes les 2,5 s
function stkSuivre() {
  clearTimeout(STK.minuteur);
  const s = STK.session;
  if (!s || !(s.etat === "travail" || s.stickers.some(x => x.travail))) return;
  STK.minuteur = setTimeout(async () => {
    if (!document.getElementById("stk") || !STK.session) return;
    try { STK.session = await stkApi("/api/stickers/" + STK.session.id); stkRendre(); } catch (e) {}
    stkSuivre();
  }, 2500);
}
function stkInformer(t) { if (typeof informer === "function") informer(t); else alert(t); }
