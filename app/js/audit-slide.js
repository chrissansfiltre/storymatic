/* ------------------------------------------------------------
   LE CONTRÔLE D'UNE SLIDE COMPOSÉE

   Claude écrit les slides en positions absolues, sans jamais voir le résultat.
   Sur une slide à deux blocs ça passe ; à quatre, les boîtes se recouvrent et
   un titre finit sous une image. Le 21 septembre 2026, la slide 2 d'un
   carrousel avait son titre recouvert à 83 % par la photo, et peint dessous.

   Ce script est injecté dans la slide par le serveur, dans un navigateur sans
   fenêtre (route /pub/<projet>/<pub>/audit/<n>). Il mesure ce qui ne peut se
   mesurer qu'une fois la page rendue — où le texte retombe, ce qui le recouvre
   — et rend son verdict en base64 dans #pg-audit, que le serveur relit.

   DEUX PARTIS PRIS, chèrement acquis :

   1. On mesure les RECTANGLES DU TEXTE, pas les boîtes des éléments. Un <p> de
      900px de large qui contient « Étape 1 » n'occupe que 120px : juger sur sa
      boîte ferait dire n'importe quoi au contrôle, dans les deux sens.

   2. Pour savoir ce qui recouvre quoi, on interroge le navigateur lui-même
      (elementFromPoint) plutôt que de croiser des rectangles : lui seul connaît
      l'ORDRE D'EMPILEMENT réel. Un texte dont la moitié des points rend un
      autre élément est enterré, et c'est vrai quelle qu'en soit la raison.
   ------------------------------------------------------------ */
(function () {
  "use strict";

  const REGLAGES = window.PG_AUDIT || {};
  const MARGE = REGLAGES.marge || 90;              // la marge de sécurité, en px
  const BANDES = REGLAGES.bandes || null;          // stories : { haut: 250, bas: 340 }
  const COUVERTURE_TOLEREE = 0.12;                 // un coin qui dépasse n'est pas un enterrement
  const TEXTE_COURT = 15;                          // « 2/6 », « Glisse », « → » : de la signalétique

  const texteDe = e => [].slice.call(e.childNodes)
    .filter(n => n.nodeType === 3)
    .map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim();

  const classeDe = e => {
    const c = e.getAttribute && e.getAttribute("class");
    return c ? "." + String(c).trim().split(/\s+/).join(".") : e.tagName.toLowerCase();
  };

  const court = t => "« " + t.slice(0, 34) + (t.length > 34 ? "…" : "") + " »";

  function nomDe(e, sec) {
    if (!e || e === sec) return "le fond de la slide";
    if (e.tagName === "IMG") return "l'image " + classeDe(e.parentElement || e);
    const t = (e.textContent || "").trim();
    if (t) return "le texte " + court(t) + " (" + classeDe(e) + ")";
    return "le bloc " + classeDe(e);
  }

  /* Les rectangles que les LETTRES occupent vraiment, ligne par ligne. */
  function rectsTexte(e) {
    const r = [];
    [].slice.call(e.childNodes).forEach(n => {
      if (n.nodeType !== 3 || !n.textContent.trim()) return;
      const plage = document.createRange();
      plage.selectNodeContents(n);
      [].slice.call(plage.getClientRects()).forEach(b => {
        if (b.width > 1 && b.height > 1) r.push(b);
      });
    });
    return r;
  }

  function mesurer() {
    const sec = document.querySelector(".slide");
    if (!sec) return { erreur: "aucune slide dans la page" };

    const sb = sec.getBoundingClientRect();
    const W = Math.round(sb.width), H = Math.round(sb.height);
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;

    // Une enveloppe en coordonnées de slide, autour d'une liste de rectangles d'écran.
    const enveloppe = rects => {
      const x1 = Math.min.apply(null, rects.map(b => b.left)) - sb.left;
      const y1 = Math.min.apply(null, rects.map(b => b.top)) - sb.top;
      const x2 = Math.max.apply(null, rects.map(b => b.right)) - sb.left;
      const y2 = Math.max.apply(null, rects.map(b => b.bottom)) - sb.top;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };
    const boite = e => {
      const b = e.getBoundingClientRect();
      return { x: b.left - sb.left, y: b.top - sb.top, w: b.width, h: b.height };
    };

    const visible = e => {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
      const b = e.getBoundingClientRect();
      return b.width > 2 && b.height > 2;
    };
    /* LES ORNEMENTS (data-decor) : un mot géant posé en fond, volontairement coupé par les bords. Le
       contrôle le prenait pour un texte qui déborde, et la « réparation » le rapetissait jusqu'à tuer
       l'effet voulu — relevé le 23 septembre 2026 sur des affiches où « Chess » et « cup » géants
       encadraient un cavalier. Un ornement n'est ni contrôlé, ni compté comme recouvrant un texte. */
    const decor = e => !!(e.closest && e.closest("[data-decor]"));
    const tous = [].slice.call(sec.querySelectorAll("*")).filter(visible).filter(e => !decor(e));

    // Chaque porteur de texte, avec ses lettres mesurées.
    const textes = [];
    tous.forEach(e => {
      const t = texteDe(e);
      if (!t) return;
      const rects = rectsTexte(e);
      if (!rects.length) return;
      textes.push({ el: e, t: t, rects: rects, b: enveloppe(rects) });
    });

    const soucis = [];
    const dire = (el, gravite, texte) => soucis.push({ gravite: gravite, texte: texte, cls: el ? classeDe(el) : "" });
    const enterres = [];        // pour ne pas répéter le même défaut sur un texte et son <span>

    /* ---- 1. Ce qui sort du cadre, et ce qui frôle les bords ---- */
    textes.forEach(o => {
      const b = o.b;
      const dehors = [];
      if (b.x < -2) dehors.push("de " + Math.round(-b.x) + "px à gauche");
      if (b.y < -2) dehors.push("de " + Math.round(-b.y) + "px en haut");
      if (b.x + b.w > W + 2) dehors.push("de " + Math.round(b.x + b.w - W) + "px à droite");
      if (b.y + b.h > H + 2) dehors.push("de " + Math.round(b.y + b.h - H) + "px en bas");
      if (dehors.length) {
        dire(o.el, "grave", "Le texte " + court(o.t) + " (" + classeDe(o.el) + ") SORT DU CADRE " +
          dehors.join(" et ") + " : il est coupé. Ses lettres occupent " + Math.round(b.w) + "×" + Math.round(b.h) +
          "px en " + Math.round(b.x) + "," + Math.round(b.y) + ". Réduis sa police, élargis sa boîte, ou donne-lui une autre bande.");
        return;
      }
      // La marge ne vaut que pour le texte de lecture : la pagination et la flèche vivent au bord, c'est leur place.
      if (o.t.length < TEXTE_COURT) return;
      const serre = [];
      if (b.x < MARGE - 2) serre.push("gauche " + Math.round(b.x) + "px");
      if (b.y < MARGE - 2) serre.push("haut " + Math.round(b.y) + "px");
      if (W - (b.x + b.w) < MARGE - 2) serre.push("droite " + Math.round(W - b.x - b.w) + "px");
      if (H - (b.y + b.h) < MARGE - 2) serre.push("bas " + Math.round(H - b.y - b.h) + "px");
      if (serre.length) {
        dire(o.el, "moyen", "Le texte " + court(o.t) + " (" + classeDe(o.el) + ") est trop près du bord (" +
          serre.join(", ") + ") : il faut " + MARGE + "px au moins.");
      }
    });

    /* ---- 2. Les bandes d'interface des stories ---- */
    if (BANDES) {
      textes.forEach(o => {
        const b = o.b;
        if (b.y < BANDES.haut) dire(o.el, "grave", "Le texte " + court(o.t) + " commence à " + Math.round(b.y) +
          "px du haut : l'interface d'Instagram recouvre les " + BANDES.haut + " premiers px.");
        else if (b.y + b.h > H - BANDES.bas) dire(o.el, "grave", "Le texte " + court(o.t) + " descend jusqu'à " +
          Math.round(H - b.y - b.h) + "px du bas : l'interface d'Instagram recouvre les " + BANDES.bas + " derniers px.");
      });
    }

    /* ---- La pile réelle en un point ----
       elementFromPoint ne rend que le dessus, et le dessus est souvent un conteneur
       TRANSPARENT qui ne cache rien : un .head sans fond posé sur un numéro géant
       le faisait déclarer « recouvert ». elementsFromPoint rend la pile entière ;
       reste à savoir lesquels de ses éléments PEIGNENT vraiment quelque chose ici. */
    const remplit = couleur => {
      if (!couleur || couleur === "transparent") return false;
      const m = /rgba?\(\s*\d+,\s*\d+,\s*\d+(?:,\s*([\d.]+))?\s*\)/.exec(couleur);
      return !m || m[1] === undefined || parseFloat(m[1]) > 0.25;
    };
    const rectsDe = new Map();
    textes.forEach(o => rectsDe.set(o.el, o.rects));
    const dedans = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    // Ce que cet élément pose à l'écran en (x, y) : "image", "fond", "lettres" — ou rien.
    function peint(e, x, y) {
      if (decor(e)) return null;            // un ornement de fond ne cache aucun texte
      if (e.tagName === "IMG") return "image";
      const s = getComputedStyle(e);
      if (/gradient|url\(/i.test(s.backgroundImage || "")) return "fond";
      if (remplit(s.backgroundColor)) return "fond";
      /* Un voile est souvent un ::before, que la pile des éléments ne contient pas : c'est son
         hôte qui le peint. Sans ce détour, un titre parfaitement voilé passait pour posé à nu. */
      for (const pseudo of ["::before", "::after"]) {
        const q = getComputedStyle(e, pseudo);
        if (!q || q.content === "none" || q.display === "none") continue;
        if (/gradient|url\(/i.test(q.backgroundImage || "") || remplit(q.backgroundColor)) return "fond";
      }
      const r = rectsDe.get(e);
      if (r && r.some(b => dedans(b, x, y))) return "lettres";
      return null;
    }

    /* ---- 3. Ce qui est ENTERRÉ ----
       On échantillonne les lettres elles-mêmes, et pour chaque point on cherche, AU-DESSUS
       du texte, le premier élément qui peint quelque chose. Les points hors de la FENÊTRE ne
       comptent pas : elementFromPoint n'y répond pas, et les garder au dénominateur ferait
       passer un texte entièrement enterré pour à moitié visible. */
    const points = o => {
      const pts = [];
      o.rects.forEach(r => {
        const nx = Math.max(2, Math.min(6, Math.round(r.width / 60)));
        const ny = Math.max(1, Math.min(4, Math.round(r.height / 30)));
        for (let i = 1; i <= nx; i++) for (let j = 1; j <= ny; j++) {
          const x = r.left + (r.width * i) / (nx + 1), y = r.top + (r.height * j) / (ny + 1);
          if (x >= 0 && x < vw && y >= 0 && y < vh) pts.push([x, y]);
        }
      });
      return pts;
    };

    textes.forEach(o => {
      const pts = points(o);
      if (pts.length < 3) return;
      const dessus = {};
      let couverts = 0;
      pts.forEach(([x, y]) => {
        const pile = [].slice.call(document.elementsFromPoint(x, y));
        const i = pile.indexOf(o.el);
        if (i < 0) return;
        for (let k = i - 1; k >= 0; k--) {
          const h = pile[k];
          if (h === o.el || o.el.contains(h) || h.contains(o.el)) continue;
          if (!peint(h, x, y)) continue;
          couverts++;
          const cle = nomDe(h, sec);
          dessus[cle] = (dessus[cle] || 0) + 1;
          break;
        }
      });
      const part = couverts / pts.length;
      if (part <= COUVERTURE_TOLEREE) return;
      const coupable = Object.keys(dessus).sort((a, c) => dessus[c] - dessus[a])[0];
      enterres.push(o.el);
      // Un <span> dans un titre déjà signalé ne se signale pas deux fois.
      if (enterres.some(x => x !== o.el && x.contains(o.el))) return;
      const b = o.b;
      dire(o.el, part > 0.35 ? "grave" : "moyen",
        "Le texte " + court(o.t) + " (" + classeDe(o.el) + ") est RECOUVERT sur " + Math.round(part * 100) +
        "% de sa surface par " + coupable + ", qui se peint PAR-DESSUS lui : on ne le lit pas. Ses lettres " +
        "occupent " + Math.round(b.w) + "×" + Math.round(b.h) + "px en " + Math.round(b.x) + "," + Math.round(b.y) +
        ". Donne-lui une bande libre, place-le APRÈS l'image dans le HTML, ou déplace ce qui le recouvre.");
    });

    /* ---- 4. Un texte posé sur une image sans rien pour le porter ----
       Le texte est au-dessus (il n'est donc pas enterré), mais la photo défile derrière ses
       lettres. Le voile est presque toujours un FRÈRE du texte, pas un ancêtre : chercher
       un fond sur la lignée du texte ne le trouvait jamais et criait au loup sur des slides
       parfaitement lisibles. On regarde donc ce qu'il y a SOUS les lettres, dans la pile. */
    const images = tous.filter(e => e.tagName === "IMG");
    textes.forEach(o => {
      if (enterres.indexOf(o.el) >= 0) return;                     // déjà dit, et plus grave
      if (enterres.some(x => x.contains(o.el))) return;
      if (o.t.length < TEXTE_COURT) return;                        // la pagination, la flèche : pas du texte de lecture
      const s = getComputedStyle(o.el);
      if (s.textShadow && s.textShadow !== "none") return;
      const pts = points(o);
      if (pts.length < 3) return;
      let nus = 0;
      pts.forEach(([x, y]) => {
        const pile = [].slice.call(document.elementsFromPoint(x, y));
        const i = pile.indexOf(o.el);
        if (i < 0) return;
        for (let k = i + 1; k < pile.length; k++) {
          const b = pile[k];
          if (o.el.contains(b)) continue;
          const quoi = peint(b, x, y);
          if (!quoi) continue;
          if (quoi === "image") nus++;                             // la photo est le premier à peindre : rien ne porte le texte
          break;                                                   // un fond s'est interposé : c'est le voile, tout va bien
        }
      });
      if (nus / pts.length > 0.5) {
        dire(o.el, "moyen", "Le texte " + court(o.t) + " (" + classeDe(o.el) +
          ") est posé À MÊME une image, sans voile ni cartouche derrière lui : il devient illisible dès que la " +
          "photo est contrastée. Ajoute un dégradé sombre sous le texte, un aplat plein, ou sors-le de l'image.");
      }
    });

    /* ---- Le relevé des boîtes : Claude en a besoin pour corriger juste ---- */
    const plan = [];
    textes.slice(0, 30).forEach(o => plan.push(classeDe(o.el) + " (texte) : lettres " +
      Math.round(o.b.w) + "×" + Math.round(o.b.h) + "px en " + Math.round(o.b.x) + "," + Math.round(o.b.y) +
      " — boîte " + Math.round(boite(o.el).w) + "×" + Math.round(boite(o.el).h) + "px en " +
      Math.round(boite(o.el).x) + "," + Math.round(boite(o.el).y)));
    images.slice(0, 10).forEach(im => {
      const b = boite(im);
      plan.push(classeDe(im.parentElement || im) + " (image) : " + Math.round(b.w) + "×" + Math.round(b.h) +
        "px en " + Math.round(b.x) + "," + Math.round(b.y) + " (jusqu'à " + Math.round(b.x + b.w) + "," + Math.round(b.y + b.h) + ")");
    });

    return { taille: { l: W, h: H }, soucis: soucis, boites: plan };
  }

  function rendre(r) {
    const pre = document.createElement("pre");
    pre.id = "pg-audit";
    let t = "";
    try { t = btoa(unescape(encodeURIComponent(JSON.stringify(r)))); }
    catch (e) { t = btoa('{"erreur":"encodage"}'); }
    pre.textContent = "@@AUDIT@@" + t + "@@FIN@@";
    document.body.appendChild(pre);
  }

  function lancer() {
    // Les polices Google arrivent après le load : mesurer avant fausserait toutes les hauteurs.
    const attendre = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    attendre.then(() => setTimeout(() => {
      let r;
      try { r = mesurer(); } catch (e) { r = { erreur: String(e && e.message || e) }; }
      rendre(r);
    }, 300));
  }

  if (document.readyState === "complete") lancer();
  else window.addEventListener("load", lancer);
})();
