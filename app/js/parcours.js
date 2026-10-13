/* ============================================================
   STORYMATIC — les parcours guidés

   On entre dans le studio par ce qu'on veut publier :
     - un Reel ou un TikTok  → qui joue, où, avec quel produit, la scène,
                               puis la page « Créer une vidéo » (js/video.js) ;
     - un carrousel          → le but, la DA, les médias, le plan, les slides ;
     - des stories           → le même chemin, en 9:16.

   Ce fichier ne réécrit rien de ce qui existe : le Reel RASSEMBLE les
   réponses, et la page « Créer une vidéo » les reprend telles quelles pour
   écrire le prompt et générer. Les créateurs d'avatar, de lieu et de
   packshot restent ceux du studio ; ouverts d'ici, ils ramènent à l'étape
   quittée (pgRetour).

   Le carrousel et les stories ne passent par aucune plateforme de
   génération : Claude écrit le plan, puis compose les slides en HTML à la
   DA de la marque. Le serveur les photographie en PNG. Aucun crédit.

   Un parcours laissé en route est gardé dans le navigateur, projet par
   projet, comme les brouillons de lieu et de packshot.
   ============================================================ */

const PG = {
  genre: null,        // "reel" | "carrousel" | "stories"
  etape: 0,
  d: null,            // les réponses du parcours en cours
  attente: null,      // { quoi: "avatar"|"lieu"|"packshot", genre, etape, depuis } : un créateur est ouvert
  occupe: "",         // ce que Claude est en train de faire, en clair ("" = rien)
  identites: [], polices: [],
  rendus: null,       // les images du projet, pour l'étape « Vos médias »
  pub: null,          // la publication telle que le serveur la connaît
  deck: null,         // sa mise en page
  exporte: null,      // le dernier export
  da: null,           // la DA en cours d'édition (étape 2), sinon null
  version: 0          // pour forcer le rechargement des aperçus
};

const PG_FORMATS = {
  reel:      { nom: "Créer un B-roll", un: "B-roll",   pas: 5 },   // l'ancien « Reel ou TikTok » : une vidéo en un seul plan
  carrousel: { nom: "Carrousel",      un: "carrousel", pas: 5, l: 1080, h: 1350, ratio: "4:5",  une: "slide", des: "slides", nb: [5, 7, 10], defaut: 7 },
  stories:   { nom: "Stories",        un: "stories",   pas: 5, l: 1080, h: 1920, ratio: "9:16", une: "story", des: "stories", nb: [3, 4, 5], defaut: 3 },
  // RETAKE (2 oct. 2026) : sa prise refaite par Seedance 2.5 — les étapes sont dans retake.js (3 à 5 selon ce qui change)
  retake:    { nom: "Retake",         un: "Retake",    pas: 5 }
};
const PG_TEINTES = ["#FDBA74", "#F97316", "#FB923C", "#E8E8EA", "#B9B9C0", "#8D8D96"];

const pgEstPub = () => (PG.genre === "stories");
/* Comment nommer le travail en cours et ses pièces. Vingt textes disaient « slide » et
   « carrousel » en dur : dans le parcours des stories, le studio parlait d'autre chose
   que de ce que la personne était en train de faire. */
const pgF = () => PG_FORMATS[PG.genre] || PG_FORMATS.carrousel;
const pgUne = () => pgF().une;            // « slide » · « story »
const pgDes = () => pgF().des;            // « slides » · « stories »
const pgMaj = m => m.charAt(0).toUpperCase() + m.slice(1);
const pgEl = (balise, classe, html) => { const e = document.createElement(balise); if (classe) e.className = classe; if (html != null) e.innerHTML = html; return e; };


/* ------------------------------------------------------------
   LES BROUILLONS — gardés dans le navigateur, par projet
   ------------------------------------------------------------ */

const pgCle = () => "studio-parcours-" + ((PROJET && PROJET.id) || "");
function pgLireTout() {
  try { return JSON.parse(localStorage.getItem(pgCle()) || "{}") || {}; } catch (e) { return {}; }
}
function pgSauver() {
  if (!PG.genre || !PG.d) return;
  const tout = pgLireTout();
  PG.d.etape = PG.etape;
  PG.d.maj = Date.now();
  /* Terminé, un travail n'est plus un brouillon : l'accueil ne propose pas de le « reprendre ».
     Pour une publication, cela se lit sur son export. Pour un Reel, c'est la personne qui l'a dit
     en cliquant « Validé » : l'écraser ici faisait réapparaître la bannière dès qu'on rouvrait
     un Reel pourtant validé. */
  PG.d.termine = pgEstPub() ? !!PG.exporte : !!PG.d.termine;
  tout[PG.genre] = PG.d;
  tout.dernier = PG.genre;
  try { localStorage.setItem(pgCle(), JSON.stringify(tout)); } catch (e) { /* stockage indisponible : on continue sans */ }
  ;   // la carte de « Vos Retakes » suit le brouillon
}
function pgOublier(genre) {
  const tout = pgLireTout();
  delete tout[genre];
  if (tout.dernier === genre) delete tout.dernier;
  try { localStorage.setItem(pgCle(), JSON.stringify(tout)); } catch (e) {}
}
function pgNeuf(genre) {
  ;
  ;
  return { but: "", sujet: "", forme: "", cible: "", appel: "", identiteId: undefined, medias: [], modele: [], distribution: [], modeleFidelite: "charpente", nb: PG_FORMATS[genre].defaut, pubId: null, sigPlan: null };
}


/* ------------------------------------------------------------
   OUVRIR, REPRENDRE, NAVIGUER
   ------------------------------------------------------------ */

async function pgOuvrir(genre, options) {
  let o = options || {};
  const tout = pgLireTout();
  /* Un Reel qui a déjà un prompt ou des vidéos rouvre à SA dernière étape — celle de la
     vidéo — même si la personne était ensuite revenue sur la scène : sinon on la reposait
     à l'étape 4 et elle ne retrouvait pas ses vidéos. */
  ;
  PG.genre = genre;
  PG.d = (!o.neuf && tout[genre]) ? tout[genre] : pgNeuf(genre);
  PG.etape = Number.isInteger(o.etape) ? o.etape : (o.neuf ? 0 : (PG.d.etape || 0));
  ;   // 3 à 5 étapes selon ce qui change
  PG.pub = null; PG.deck = null; PG.exporte = null; PG.occupe = "";
  PG.attente = null;
  PG.rendus = null;                 // une image générée ailleurs depuis la dernière visite doit apparaître
  aller("parcours");
  pgRendre();                       // l'ossature tout de suite, les données ensuite
  await pgCharger();
  pgRendre();
  if (o.lancer) o.lancer();
}

// Ce dont l'étape a besoin, relu sur le serveur.
async function pgCharger() {
  try {
    {
      const r = await (await fetch("/api/identites?genre=" + PG.genre)).json();
      PG.identites = r.identites || [];
      PG.polices = r.polices || [];
      PG.policesInfo = r.policesInfo || {};
      PG.policesAjoutees = r.policesAjoutees || [];
      const pretes = PG.identites.filter(i => !i.manque);
      if (PG.d.identiteId === undefined) PG.d.identiteId = pretes.length ? pretes[0].id : null;
      if (PG.d.identiteId && !pretes.some(i => i.id === PG.d.identiteId)) PG.d.identiteId = null;
      if (PG.d.pubId) await pgChargerPub();
    }
  } catch (e) { /* le parcours reste utilisable ; l'étape dira ce qui manque */ }
}
async function pgChargerPub() {
  try {
    const r = await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId));
    const p = await r.json();
    if (p.erreur) { PG.d.pubId = null; PG.pub = null; PG.deck = null; return; }
    PG.pub = p; PG.deck = p.deck || null;
    PG.exporte = p.export || null;          // déjà exportée : elle se rouvre terminée, ses fichiers à portée de main
    pgMediasDepuis(p);
  } catch (e) { /* on garde ce qu'on a */ }
}

/* Rouvrir le dernier parcours (bouton Retour du navigateur, reprise). */
function pgReprendre(viaHistorique) {
  const tout = pgLireTout();
  const genre = PG.genre || tout.dernier;
  if (!genre || !tout[genre]) return false;
  if (viaHistorique && PG.genre === genre && PG.d) { aller("parcours", true); pgRendre(); return true; }
  pgOuvrir(genre);
  return true;
}

function pgAllerEtape(n) {
  const max = pgEtapes().length - 1;   // le Retake a 3 à 5 étapes selon ce qui change
  PG.etape = Math.max(0, Math.min(max, n));
  pgDire("");
  pgSauver();
  pgRendre();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function pgDire(message) {
  const e = $("pg-erreur");
  e.textContent = message || "";
  e.hidden = !message;
}


/* ---------- Le détour par un créateur ---------- */



// Le module « Vos DA » ramène ici (da.js, damRevenir) : la DA gardée ou modifiée est cochée ; sans id, rien ne change.
function pgRetourDA(genre, etape, id) {
  const tout = pgLireTout(), d = tout[genre] || pgNeuf(genre);
  if (id) d.identiteId = id;
  d.etape = etape;
  tout[genre] = d; tout.dernier = genre;
  try { localStorage.setItem(pgCle(), JSON.stringify(tout)); } catch (e) {}
  pgOuvrir(genre, { etape: etape });
}



/* ------------------------------------------------------------
   LE RENDU D'UNE ÉTAPE
   ------------------------------------------------------------ */

function pgEtapes() {
  ;
  ;

  const F = PG_FORMATS[PG.genre], st = PG.genre === "stories";
  /* Storymatic : un jour arrive avec son but, sa DA et ses images réglés par la semaine. Les trois premières places restent
     (le code compte les étapes de 0 à 4 : 3 = le plan, 4 = les stories) mais ne s'affichent jamais. */
  const reglePar = nom => ({ nom, titre: nom, lead: "", rendu: () => {}, info: () => "", pret: () => "" });
  return [
    reglePar("Le but"), reglePar("La DA"), reglePar("Les images"),
    { nom: "Le plan", titre: st ? "Le plan, story par story" : "Le plan, slide par slide",
      lead: "Claude propose le déroulé et les textes. Tout se corrige ici, à la main ou en le lui demandant.",
      rendu: pgEPlan, info: () => { const n = PG.pub && PG.pub.plan ? PG.pub.plan.slides.length : PG.d.nb; return n + " " + (n > 1 ? F.des : F.une); },
      pret: () => PG.occupe ? "Claude travaille encore." : (PG.pub && PG.pub.plan && PG.pub.plan.slides.length ? "" : "Le plan n'est pas encore écrit.") },
    { nom: st ? "Les stories" : "Les slides", titre: st ? "Vos stories" : "Vos slides",
      lead: "Cliquez sur une " + F.une + " pour la retoucher à la main — texte, tailles, couleurs, place de chaque élément — ou en demander une autre version. L'export les numérote dans l'ordre.",
      rendu: pgESlides, info: () => PG.exporte ? "exportées ✓" : PG.deck ? "prêtes à exporter" : "à composer", pret: () => "" }
  ];
}
/* ---------- L'étape 5 du Reel, DANS le parcours ----------

   Elle vivait sur une page à part (« Créer une vidéo », trois colonnes) : on
   quittait le parcours au moment de générer, on perdait le fil des étapes, le
   panneau des références et le pied de page. Plutôt que de récrire cette page
   une seconde fois — l'écriture du prompt, l'estimation du coût, le flux de
   génération, les versions — on DÉPLACE sa colonne centrale ici, telle quelle.
   Les identifiants et les gestionnaires d'événements sont posés sur les
   éléments eux-mêmes : ils survivent au déménagement, et la page à part
   continue de servir à la création libre, avec les mêmes blocs. */

        // { centre, parent, avant } : d'où vient la colonne
       // idem pour le panneau du prompt (#vd-s-prompt)






function pgRendre() {
  if (!PG.genre || !PG.d) return;
  const etapes = pgEtapes(), n = etapes.length, e = etapes[PG.etape], F = PG_FORMATS[PG.genre];

  /* STORYMATIC (7 oct. 2026) :
     un jour arrive avec son but, sa DA et ses images déjà réglés par la semaine — seules restent les deux dernières étapes,
     le plan et les stories ; l'export se fait pour toute la semaine, depuis « Ma semaine ». */
  const sm = (PG.genre === "stories"), deb = sm ? 3 : 0;
  // Le fil des étapes
  const fil = $("pg-fil");
  fil.innerHTML = '<p class="pg-fil-titre">' + echapper(F.nom) + "</p>";
  etapes.forEach((x, i) => {
    if (i < deb) return;
    const b = pgEl("button", "pg-pas" + (i === PG.etape ? " ici" : i < PG.etape ? " fait" : ""));
    b.type = "button";
    b.innerHTML = '<span class="pg-pas-n">' + (i < PG.etape ? "✓" : i + 1 - deb) + '</span><span class="pg-pas-nom">' + echapper(x.nom) +
      '<span class="pg-pas-info">' + echapper(String(x.info())) + "</span></span>";
    b.onclick = () => pgVers(i);
    fil.appendChild(b);
  });
  const fini = pgEstPub() && !!PG.exporte;
  if (!sm) {
    const quitter = pgEl("button", "pg-quitter", fini ? "Fermer — la publication est terminée" : "Quitter — le brouillon est gardé");
    quitter.type = "button";
    quitter.onclick = () => { if (fini) pgTerminer(); else { pgSauver(); rendreAccueil(); } };
    fil.appendChild(quitter);
  }

  $("pg").classList.toggle("pg-avec-prompt", false);
  $("pg-sur").textContent = "Étape " + (PG.etape + 1 - deb) + " sur " + (n - deb);
  $("pg-titre").innerHTML = echapper(e.titre) + (e.fac ? '<span class="pg-facultatif">facultatif</span>' : "");
  $("pg-lead").textContent = e.lead;
  const corps = $("pg-corps");
  /* La colonne du constructeur vidéo est EMPRUNTÉE à l'autre page : on la rend avant de
     vider le corps, sinon innerHTML="" la détacherait et la page « Créer une vidéo »
     se retrouverait vide. */
  /* RESTER OÙ L'ON EST. Chaque clic redessine l'étape entière : le temps d'un instant, le corps vide
     n'a plus de hauteur, le navigateur remonte en haut de page, et rien ne l'y ramenait — ajouter une
     image en bas du storyboard renvoyait tout en haut (23 septembre 2026). Sur la MÊME étape, on remet
     la page (et la bande du storyboard) exactement où elle était ; un changement d'étape repart du haut. */
  const memeEtape = PG.rendueEtape === PG.etape && PG.rendueGenre === PG.genre;
  const y = window.scrollY, bandeAvant = corps.querySelector(".pg-sb-bande"), bx = bandeAvant ? bandeAvant.scrollLeft : 0;
  corps.style.minHeight = corps.offsetHeight + "px";      // pas d'effondrement pendant la reconstruction
  corps.innerHTML = "";
  e.rendu(corps);
  corps.style.minHeight = "";
  if (memeEtape) {
    window.scrollTo(0, y);
    const bande = corps.querySelector(".pg-sb-bande");
    if (bande) bande.scrollLeft = bx;
  }
  PG.rendueEtape = PG.etape; PG.rendueGenre = PG.genre;
  pgFenetreSlide();

  // Le pied : retour, passer, continuer
  $("pg-prec").textContent = PG.etape <= deb ? (sm ? "← Ma semaine" : "← Accueil") : "← Retour";
  $("pg-passer").hidden = !e.fac;
  const suiv = $("pg-suiv");
  suiv.hidden = false;
  suiv.disabled = !!PG.occupe;
  if (PG.etape === 3) suiv.textContent = PG.deck ? "Voir les " + F.des : "Valider le plan et créer les " + F.des;
  else if (PG.etape === 4) suiv.hidden = true;
  // En mode « reproduire », l'étape 1 mène elle-même aux slides : « Continuer » vers l'étape 2 n'aurait pas de sens.
  else suiv.textContent = "Continuer";
  $("pg-pied-note").textContent = sm ? "Enregistré au fur et à mesure · l'export se fait pour toute la semaine, depuis « Ma semaine »"
    : fini ? "Terminé · rangé dans « Vos carrousels et stories », sur l'accueil" : "Brouillon gardé · vous pouvez quitter et reprendre";

  pgRendreRecap();
}

// Avancer : l'étape dit elle-même ce qui lui manque.
async function pgVers(i) {
  if (PG.occupe) return;
  if (i > PG.etape) {
    const etapes = pgEtapes();
    for (let k = PG.etape; k < i; k++) {
      const manque = etapes[k].pret();
      if (manque) { if (k !== PG.etape) pgAllerEtape(k); pgDire(manque); return; }
    }
  }
  // La dernière étape du Reel se rend ICI, dans le parcours (pgEVideo).
  // Entrer dans le plan ou dans les slides suppose que le serveur connaisse la publication.
  if (pgEstPub() && i >= 3) {
    try { await pgSyncPub(); } catch (err) { pgDire("Le studio n'a pas pu enregistrer la publication : " + (err.message || err)); return; }
  }
  if (pgEstPub() && PG.etape === 3 && i === 4 && !PG.deck) {
    // Une image existe mais sa description a bougé : elle sera utilisée quand même. Seules celles qui n'existent pas du tout manquent.
    const jamais = pgIllustrationsAFaire().filter(v => !pgMediaIllu(v));
    const slidesDe = l => PG.pub.plan.slides.map((s, k) => pgVisuels(s).some(v => l.includes(v)) ? k + 1 : 0).filter(Boolean);
    const rangs = slidesDe(jamais);
    if (jamais.length && !await demander(null, { titre: jamais.length + " image" + (jamais.length > 1 ? "s ne sont pas générées" : " n'est pas générée"),
        html: "<p>" + pgMaj(rangs.length > 1 ? pgDes() : pgUne()) + " " + rangs.join(", ") + " : composée" + (rangs.length > 1 ? "s" : "") + " sans " + (jamais.length > 1 ? "ces images" : "cette image") + ". Vous pourrez les générer ensuite, mais il faudra refaire " + (rangs.length > 1 ? "ces " + pgDes() : "cette " + pgUne()) + " pour les y placer.</p>",
        ok: "Composer sans elles", annuler: "Revenir au plan" })) return;
  }
  const venaitDuPlan = pgEstPub() && PG.etape === 3 && i === 4;
  pgAllerEtape(i);
  if (pgEstPub() && i === 3 && !(PG.pub && PG.pub.plan)) pgEcrirePlan("");
  if (venaitDuPlan && !PG.deck) pgComposer();
}
$("pg-suiv").onclick = () => pgVers(PG.etape + 1);
$("pg-passer").onclick = () => {
  // Passer, c'est répondre « rien » : l'étape ne doit plus rien réclamer.
  ;
  ;
  pgVers(PG.etape + 1);
};
$("pg-prec").onclick = () => { if (PG.occupe) return; if (PG.etape === 0 || ((PG.genre === "stories") && PG.etape <= 3)) { pgSauver(); rendreAccueil(); } else pgAllerEtape(PG.etape - 1); };
;


/* ------------------------------------------------------------
   LES BRIQUES D'INTERFACE
   ------------------------------------------------------------ */

// Une grille de vignettes à cocher. `liste` : [{ id, nom, sous, image }].
/* ---------- Les listes qui grandissent ----------

   À l'étape 3, quatre listes s'allongent avec le projet : les avatars, les
   environnements, les packshots, et surtout les rendus du studio. À trois
   images chacune, tout tient à l'écran ; à soixante, l'étape devient un
   couloir qu'il faut dérouler pour trouver une vignette.

   On montre donc les PLUS RÉCENTS, et le reste s'ouvre dans une fenêtre.
   Tant qu'une liste est courte, rien ne change et il n'y a pas un clic de
   plus : le bouton « Voir tout » n'apparaît qu'au-delà du seuil. */

                 // combien de vignettes restent en ligne






let pgMinuteurSauver = null;
function pgSauverBientot() { clearTimeout(pgMinuteurSauver); pgMinuteurSauver = setTimeout(pgSauver, 500); }

const pgEtiquette = t => pgEl("p", "pg-etiquette", echapper(t));
const pgAstuce = html => pgEl("p", "pg-astuce", html);

// L'attente d'un travail de Claude : ce qu'il fait, et depuis combien de temps.
let pgChronoMinuteur = null;
function pgAttente(corps, sousTexte) {
  const b = pgEl("div", "pg-attente",
    '<div class="barre"><span></span></div><p class="pg-attente-txt" id="pg-attente-txt">' + echapper(PG.occupe) + "</p>" +
    '<p class="pg-attente-sous">' + echapper(sousTexte || "") + ' <span id="pg-attente-chrono"></span></p>');
  corps.appendChild(b);
}
function pgOccuper(texte) {
  PG.occupe = texte;
  const debut = Date.now();
  clearInterval(pgChronoMinuteur);
  pgChronoMinuteur = setInterval(() => {
    const c = $("pg-attente-chrono");
    if (c) { const s = Math.round((Date.now() - debut) / 1000); c.textContent = "· " + (s >= 60 ? Math.floor(s / 60) + " min " : "") + (s % 60) + " s"; }
  }, 1000);
}
function pgLiberer() { PG.occupe = ""; PG.occupeSous = ""; clearInterval(pgChronoMinuteur); }
function pgMajAttente(texte) { PG.occupe = texte; const t = $("pg-attente-txt"); if (t) t.textContent = texte; }

// Lire un fichier déposé en « data: ».
const pgLireFichier = (f, enTexte) => new Promise((ok, ko) => {
  const l = new FileReader();
  l.onload = () => ok(l.result);
  l.onerror = () => ko(new Error("lecture impossible"));
  if (enTexte) l.readAsText(f); else l.readAsDataURL(f);
});
/* ---------- Une photo déposée à une étape ----------

   Le fichier part dans IMPORTS/ et ne bouge plus. Ce qui compte ensuite, c'est
   son NOM : c'est l'étiquette que Claude lit à côté de la balise, dans « LES
   RÉFÉRENCES CHARGÉES ». « IMG_4821 » ne lui dit rien, « le couloir de mon
   appartement » si — d'où le bouton « Renommer », qui ne touche pas au disque. */





function pgChoisirFichiers(accept, plusieurs) {
  return new Promise(ok => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.multiple = !!plusieurs;
    i.onchange = () => ok(Array.from(i.files || []));
    i.click();
  });
}


/* ------------------------------------------------------------
   LE REEL — étapes 1 à 4 ; la cinquième est la page « Créer une vidéo »
   ------------------------------------------------------------ */







/* ------------------------------------------------------------
   LE CARROUSEL ET LES STORIES
   ------------------------------------------------------------ */


/* ============================================================
   REPRODUIRE UN CARROUSEL (OU DES STORIES) — l'étape 1, en mode « reproduire »

   Les slides du carrousel à refaire (rangées comme un modèle : pub.modele), la consigne en une
   phrase, les avatars et les produits à y mettre, la DA. Puis le DEVIS, gratuit : Claude regarde
   les slides et compte les images à générer ; le studio en demande le prix. Une fois le devis
   validé, Claude mène tout seul la suite (serveur : lancerReproduction) ; l'écran suit le journal
   et le compteur de crédits, et mène aux slides prêtes, à l'étape 5.
   ============================================================ */








/* Un carrousel qui vous inspire : Claude le REGARDE pour écrire, il ne le montre jamais. Ces images ne
   rejoignent ni vos médias, ni vos slides, ni l'export. */
/* Combien de slides. Libre, jusqu'à la limite d'Instagram (vingt) : un modèle de quatorze images
   se transpose mal en sept. Le choix se fait à la première étape, AVANT que le plan soit écrit. */
function pgNombreDe(c) {
  const F = PG_FORMATS[PG.genre];
  c.appendChild(pgEtiquette("Nombre de " + F.des));
  const ligne = pgEl("div", "pg-nombre");
  F.nb.forEach(v => {
    const b = pgEl("button", "pg-puce" + (Number(PG.d.nb) === v ? " on" : ""), v + " " + F.des); b.type = "button";
    b.onclick = () => { PG.d.nb = v; pgSauver(); pgRendre(); };
    ligne.appendChild(b);
  });
  const ou = pgEl("label", "pg-nombre-libre", "<span>ou</span>");
  const i = pgEl("input", "pg-champ"); i.type = "number"; i.min = 1; i.max = 20; i.value = PG.d.nb || F.defaut;
  i.oninput = () => { const v = Math.max(1, Math.min(20, Math.round(Number(i.value) || 0))); if (v) { PG.d.nb = v; pgSauverBientot(); } };
  i.onchange = () => pgRendre();
  ou.appendChild(i);
  ligne.appendChild(ou);
  c.appendChild(ligne);
  const n = (PG.d.modele || []).length;
  c.appendChild(pgAstuce((n ? "Votre exemple en compte <b>" + n + "</b> : au même nombre, chaque " + pgUne() + " en transpose une, et c'est là que le résultat lui ressemble le plus. " : "") +
    "Vingt au maximum, la limite d'Instagram. Au-delà de dix, la mise en page prend plusieurs minutes."));
}


/* ---------- La DA ---------- */


// Les polices proposées, pour l'aperçu : le navigateur ne télécharge que celles qu'il affiche.
function pgChargerPolices() {
  if (!PG.polices.length) return;
  /* La liste grandit quand on ajoute une police depuis la bibliothèque : le lien se refait alors, sans quoi
     les nouvelles polices s'afficheraient dans la police par défaut dans les menus. */
  poserPolicesLocales(document, "pg-polices-locales", PG.polices, PG.policesInfo);   // les polices de l'ordinateur : pas chez Google
  const cle = PG.polices.join("|"), ancien = $("pg-polices");
  if (ancien && ancien.dataset.cle === cle) return;
  if (ancien) ancien.remove();
  const l = document.createElement("link");
  l.id = "pg-polices"; l.rel = "stylesheet"; l.dataset.cle = cle;
  // Pour l'aperçu, deux graisses au plus — et seulement celles que la police possède (Bebas Neue n'a que 400).
  l.href = "https://fonts.googleapis.com/css2?" + PG.polices.filter(f => !estPoliceLocale(f, PG.policesInfo)).map(f => {
    const g = ((PG.policesInfo || {})[f] || {}).graisses || [500, 800];
    const pris = [500, 800].map(v => g.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a)).filter((x, i, a) => a.indexOf(x) === i);
    return "family=" + encodeURIComponent(f).replace(/%20/g, "+") + (g.length > 1 ? ":wght@" + pris.sort((a, b) => a - b).join(";") : "");
  }).join("&") + "&display=swap";
  document.head.appendChild(l);
}

/* ---------- Les médias ---------- */



/* ---------- La publication, côté serveur ---------- */

/* Seules les RÉPONSES de la personne comptent (29 sept. 2026 apparaissait après la
   génération des images, sans rien avoir touché) : les illustrations générées, les images des vidéos et un détourage
   (le fichier change, pas l'image choisie : avecFond) ne changent pas les réponses. */
const pgSignature = () => JSON.stringify([PG.d.but, PG.d.sujet, PG.d.identiteId, (PG.d.modele || []).map(m => m.fichier || m.nom), PG.d.modeleFidelite, PG.d.distribution, (PG.d.medias || []).filter(m => m.origine !== "plan" && !m.illustration && !m.videoId).map(m => (m.avecFond || m.fichier || m.rendu || "") + "|" + (m.note || "")), PG.d.nb]
  .concat(PG.d.forme || (PG.d.cible || "").trim() || (PG.d.appel || "").trim() ? [[PG.d.forme || "", PG.d.cible || "", PG.d.appel || ""]] : []));

// Envoie les réponses au serveur : crée la publication au besoin, range les médias.
async function pgSyncPub(plus) {
  const corps = Object.assign({
    id: PG.d.pubId || undefined, genre: PG.genre, but: PG.d.but || "", sujet: PG.d.sujet || "", forme: PG.d.forme || "", cible: PG.d.cible || "", appel: PG.d.appel || "", distribution: PG.d.distribution || [],
    identiteId: PG.d.identiteId || null, nb: PG.d.nb, modeleFidelite: PG.d.modeleFidelite || "charpente",
    modele: (PG.d.modele || []).map(m => ({ fichier: m.fichier, donnees: m.fichier ? undefined : m.donnees, nom: m.nom })),
    medias: (PG.d.medias || []).map(m => ({ fichier: m.fichier, rendu: m.fichier ? undefined : m.rendu, donnees: m.fichier ? undefined : m.donnees, nom: m.nom, note: m.note, refsSig: m.refsSig, cadre: m.cadre, origine: m.origine }))
  }, plus || {});
  const r = await fetch("/api/publications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  const p = await r.json();
  if (p.erreur) throw new Error(p.erreur);
  /* Un plan qu'on vient d'envoyer reste CELUI de l'écran : les champs du plan
     écrivent dans ces objets-là. Les remplacer par la copie du serveur ferait
     perdre, à l'enregistrement suivant, ce qui a été tapé entre-temps. */
  if (plus && plus.plan) p.plan = plus.plan;
  PG.pub = Object.assign({}, p, { deck: undefined });
  PG.d.pubId = p.id;
  PG.d.modele = (p.modele || []).map(m => ({ fichier: m.fichier, nom: m.nom }));
  PG.d.distribution = (p.distribution || []).map(r => ({ type: r.type, id: r.id }));
  if (p.modeleFidelite) PG.d.modeleFidelite = p.modeleFidelite;
  // Le serveur fait foi pour les médias : le navigateur ne garde que leurs noms.
  PG.d.medias = (p.medias || []).map(m => {
    const avant = (PG.d.medias || []).find(x => x.fichier === m.fichier) || {};
    return { fichier: m.fichier, nom: m.nom, note: m.note, rendu: avant.rendu || m.rendu, illustration: !!m.illustration, slideId: m.slideId, fond: m.fond, refsSig: m.refsSig, cadre: m.cadre,
             detoure: !!m.detoure, avecFond: m.avecFond, sansFond: m.sansFond, methodeFond: m.methodeFond, origine: m.origine, videoId: m.videoId };
  });
  // Un rendu déjà copié garde la trace de son origine, pour ne pas être reproposé.
  (corps.medias || []).forEach((m, k) => { if (m.rendu && PG.d.medias[k] && !PG.d.medias[k].rendu) PG.d.medias[k].rendu = m.rendu; });
  pgSauver();
  return p;
}

async function pgEcrirePlan(remarque, accorder) {
  if (PG.occupe) return;
  pgDire("");
  clearTimeout(pgMinuteurPlan);
  pgOccuper(accorder ? "Claude réaccorde les autres " + pgDes() + "…" : remarque ? "Claude reprend le plan…" : "Claude écrit le plan…");
  pgRendre();
  try {
    // Ce qu'on vient de taper part d'abord : c'est sur CE plan-là que Claude travaille.
    await pgSyncPub(PG.pub && PG.pub.plan ? { plan: PG.pub.plan, titre: PG.pub.titre } : undefined);
    const r = await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remarque: remarque || "", accorder: !!accorder }) });
    const p = await r.json();
    if (p.erreur) throw new Error(p.erreur);
    PG.pub = p;
    PG.d.aReaccorder = false;
    PG.d.sigPlan = pgSignature();
    pgSauver();
  } catch (err) { pgDire("Le plan n'a pas pu être écrit : " + (err.message || err)); }
  pgLiberer();
  if (PG.etape === 3) pgRendre();
}

/* La barre d'accord : dès qu'une slide est à soi (verrouillée) et qu'il en reste d'autres, on peut
   demander à Claude de réécrire ces autres-là d'après elle. Pas en temps réel : il lui faut une
   quinzaine de secondes, et il réécrirait la suite pendant qu'on tape encore. */
function pgMajAccord() {
  const b = $("pg-accord");
  const slides = (PG.pub && PG.pub.plan && PG.pub.plan.slides) || [];
  if (!b) return;
  const n = slides.filter(s => s.verrou).length, libres = slides.length - n;
  b.hidden = !n || !libres;
  if (b.hidden) return;
  const F = PG_FORMATS[PG.genre], neuf = !!PG.d.aReaccorder;
  b.className = "pg-accord" + (neuf ? " neuf" : "");
  b.innerHTML = "<span><b>" + n + " " + (n > 1 ? F.des + " verrouillées" : F.une + " verrouillée") + "</b> — " +
    (neuf ? "vous l'avez modifiée : la suite ne lui correspond peut-être plus." : "Claude n'y touche plus.") + "</span>";
  const go = pgEl("button", neuf ? "pg-btn pg-btn-go" : "pg-btn", libres > 1 ? "Réaccorder les " + libres + " autres" : "Réaccorder l'autre"); go.type = "button";
  go.title = "Claude réécrit les " + F.des + " non verrouillées — textes et illustrations — pour qu'elles découlent des vôtres";
  go.onclick = () => pgEcrirePlan("", true);
  b.appendChild(go);
}

let pgMinuteurPlan = null;
function pgSauverPlanBientot() {
  clearTimeout(pgMinuteurPlan);
  pgMinuteurPlan = setTimeout(async () => {
    if (!PG.pub || !PG.pub.plan) return;
    try { await pgSyncPub({ plan: PG.pub.plan, titre: PG.pub.titre }); pgRendreRecap(); }
    catch (err) { pgDire("Le plan n'a pas pu être enregistré : " + (err.message || err)); }
  }, 700);
}

function pgEPlan(c) {
  const F = PG_FORMATS[PG.genre], st = PG.genre === "stories";
  if (PG.occupe) {
    pgAttente(c, PG.occupeSous || "Une trentaine de secondes. Rien n'est dépensé : c'est Claude qui écrit.");
    if (PG.illuEnCours) {
      const stop = pgEl("button", "pg-btn", PG.illuStop ? "Arrêt demandé : le studio finit celle-ci" : "Ne plus en lancer"); stop.type = "button"; stop.disabled = PG.illuStop;
      stop.onclick = () => { PG.illuStop = true; stop.disabled = true; stop.textContent = "Arrêt demandé : le studio finit celle-ci"; };
      c.appendChild(stop);
    }
    return;
  }
  const plan = PG.pub && PG.pub.plan;
  if (!plan || !plan.slides.length) {
    const b = pgEl("button", "pg-btn pg-btn-go", "Écrire le plan"); b.type = "button";
    b.onclick = () => pgEcrirePlan("");
    c.appendChild(b);
    return;
  }

  if (PG.d.sigPlan && PG.d.sigPlan !== pgSignature()) {
    const a = pgEl("div", "pg-avis", "<span>Vos réponses ont changé depuis ce plan (but, sujet, DA, médias ou nombre de " + F.des + ").</span>");
    const b = pgEl("button", "btn-mini btn-mini-fort", "Réécrire le plan"); b.type = "button";
    b.onclick = async () => {
      if (!await demander(null, { titre: "Réécrire le plan ?", html: "<p>Claude repart de vos réponses actuelles. Les textes que vous avez corrigés à la main seront remplacés.</p>", ok: "Réécrire" })) return;
      PG.pub.plan = null; pgEcrirePlan("");
    };
    a.appendChild(b); c.appendChild(a);
  }

  // Le titre de la publication
  const titre = pgEl("input", "pg-champ pg-plan-titre"); titre.type = "text"; titre.maxLength = 120;
  titre.value = PG.pub.titre || ""; titre.placeholder = "Le nom de cette publication";
  titre.oninput = () => { PG.pub.titre = titre.value; pgSauverPlanBientot(); };
  c.appendChild(titre);

  const accord = pgEl("div", "pg-accord"); accord.id = "pg-accord";
  c.appendChild(accord);

  pgStoryboard(c);
  pgBlocIllustrations(c);
  c.appendChild(pgAstuce("Relisez chaque fait — un chiffre, une durée, une date, un prix. Claude a pour consigne de n'en inventer aucun, mais cette publication sort sous votre nom."));

  if (!st) {
    c.appendChild(pgEtiquette("La légende du post"));
    const leg = pgEl("textarea", "pg-champ"); leg.rows = 5; leg.maxLength = 2200; leg.value = plan.legende || "";
    leg.oninput = () => { plan.legende = leg.value; pgSauverPlanBientot(); };
    c.appendChild(leg);
  }

  pgMajAccord();

  // Demander un changement à Claude
  c.appendChild(pgEtiquette("Ou demandez le changement à Claude"));
  const dem = pgEl("div", "pg-demande");
  const rq = pgEl("input", "pg-champ"); rq.type = "text"; rq.maxLength = 1000;
  rq.placeholder = "Plus direct, moins de blabla · une " + pgUne() + " de plus sur le prix · finis sur un sondage…";
  rq.title = "Les " + pgDes() + " verrouillées ne sont pas réécrites";
  const env = pgEl("button", "pg-btn", "Reprendre le plan"); env.type = "button";
  env.onclick = () => { if (rq.value.trim()) pgEcrirePlan(rq.value.trim()); else rq.focus(); };
  rq.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); env.click(); } };
  dem.appendChild(rq); dem.appendChild(env);
  c.appendChild(dem);

  pgNombreDe(c);
  c.appendChild(pgEl("p", "pg-gratuit", "Gratuit jusqu'ici, et jusqu'au bout : le plan et les " + F.des + " sont écrits par Claude, sans crédit de génération."));

  if (pgDeckPerime()) {
    c.appendChild(pgAstuce("Les " + F.des + " déjà composées ne reflètent plus ce plan. À l'étape suivante, « Tout recomposer » les remet d'accord."));
  }
}

/* ---------- LE STORYBOARD (étape 4) ----------
   Mis au point dans LABO/storyboard-carrousel/ et installé le 23 septembre 2026. Le plan était devenu
   un long formulaire : chaque slide empilait son texte, une description d'image, des pastilles, deux
   boutons de cadre, des références et un bouton de génération — et on ne VOYAIT jamais le carrousel.

     · en haut, LA BANDE : tout le carrousel, en croquis tant qu'il n'est pas composé, puis en vraies
       slides (une slide dont le plan a changé depuis redevient un croquis) ;
     · en dessous, UNE SLIDE OUVERTE, réglée par trois questions : ce qu'elle dit, sa couleur, ce qu'on
       y voit — texte seul, ou des images, chacune générée ou importée, posée ou en plein cadre, avec
       QUI est dedans ;
     · en bas, UNE BARRE : ce qui reste à générer, et ce que ça coûte.

   Chaque choix vient d'abord de Claude, avec sa raison en une ligne (« pourquoi ») : on corrige, on ne
   remplit plus. Les croquis montrent une INTENTION — ce qui est dit, les couleurs, les images — pas la
   place exacte des éléments, que la composition décide d'après la DA. */

// Les deux fonds d'une slide : ceux de la DA, et eux seuls (27 sept. 2026). Un plan d'avant en « texte » ou « second » vaut « fond ».
const PG_COULEURS = [["fond", "le fond"], ["accent", "le fond accent"]];
const pgCleFond = s => s && s.couleur === "accent" ? "accent" : "fond";
const PG_VISUELS_MAX = 4;
function pgCouleursDA() {
  const da = (PG.identites || []).find(x => x.id === PG.d.identiteId);
  return Object.assign({ fond: "#0b0b0d", texte: "#f2f2f2", accent: "#f97316", second: "#fdba74" }, (da && da.couleurs) || {});
}
function pgPoliceTitres() {
  const da = (PG.identites || []).find(x => x.id === PG.d.identiteId);
  return (da && da.polices && da.polices.titres) || "Poppins";
}
const pgSombre = hex => { const n = parseInt(String(hex || "#000").slice(1, 7), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 150; };
const pgUrlPub = (sous, f) => "/pub/" + PROJET.id + "/" + PG.d.pubId + "/" + sous + "/" + encodeURIComponent(f);
const pgVisuels = s => (s.visuels = Array.isArray(s.visuels) ? s.visuels : []);
const pgIdNeuf = p => p + Math.random().toString(36).slice(2, 10);

/* L'image générée d'un visuel : son identifiant la relie à son média (slideId), comme celui d'une slide
   le faisait. Le cadre et la signature rangés avec l'image disent si elle est « à refaire » ; le même
   calcul vit dans serveur.js (cadreDeVisuel, signatureRefs). */
const pgMediaIllu = v => (PG.d.medias || []).find(m => m.illustration && m.slideId === v.id) || null;
const pgCadreDe = (s, v) => v.plein ? "plein" : pgVisuels(s).some(x => x.plein) ? "decor" : (s.couleur || "fond");
const pgSigRefs = v => JSON.stringify({ refs: v.refs || [], figurants: v.figurants || [] });
// "" : rien à générer · "afaire" · "changee" (la description, qui est dedans ou le cadre ont bougé depuis) · "faite"
function pgEtatIllu(s, v) {
  if (!v || true) return "";
  const t = (v.illustration || "").trim();
  if (!t) return "";
  const m = pgMediaIllu(v);
  if (!m) return "afaire";
  // Une image d'avant le storyboard a rangé ses seules références, en tableau : on compare ce qu'elle a rangé.
  const refsChangees = m.refsSig != null && (String(m.refsSig).charAt(0) === "["
    ? m.refsSig !== JSON.stringify(v.refs || []) || (v.figurants || []).length > 0
    : m.refsSig !== pgSigRefs(v));
  const cadre = pgCadreDe(s, v);
  const cadreChange = m.cadre != null && m.cadre !== cadre && !(m.cadre === "decor" && cadre !== "plein");
  /* Une ancienne version coupait la description rangée avec l'image à 200 caractères : une image dont
     la note fait exactement cette longueur et ouvre la description du plan est la bonne image. */
  const note = String(m.note || "").trim();
  const memeTexte = note === t || (note.length >= 195 && note.length <= 200 && t.startsWith(note));
  return (!memeTexte || refsChangees || cadreChange) ? "changee" : "faite";
}
function pgIllustrationsAFaire() {
  const l = [];
  ((PG.pub && PG.pub.plan && PG.pub.plan.slides) || []).forEach(s => pgVisuels(s).forEach(v => {
    const e = pgEtatIllu(s, v); if (e === "afaire" || e === "changee") l.push(v);
  }));
  return l;
}


/* ---------- Le croquis d'une slide ----------
   Tout en unités de conteneur : le même dessin sert en vignette dans la bande et en grand dans l'aperçu.
   Une image importée et POSÉE se montre toujours ENTIÈRE : un croquis ne doit jamais faire croire qu'elle
   sera coupée. Une image déjà générée se montre pour de vrai. */
function pgCroquis(s) {
  const co = pgCouleursDA(), fond = co[pgCleFond(s)], sombre = pgSombre(fond);
  const vis = pgVisuels(s), plein = vis.find(v => v.plein), posees = vis.filter(v => !v.plein);
  const c = pgEl("div", "pg-cq");
  c.style.background = fond; c.style.color = sombre ? "#f5efe7" : "#1d1410";
  // La texture de la DA (le tissu au logo), si sa couleur en a une : les slides composées la portent aussi.
  const da = (PG.identites || []).find(x => x.id === PG.d.identiteId), cleFond = pgCleFond(s) === "accent" ? "fond_accent" : "fond";
  const texture = cleFond && typeof daFondUrl === "function" ? daFondUrl(da, cleFond) : "";
  if (texture) c.style.background = fond + " url('" + texture + "') center/cover no-repeat";
  c.style.setProperty("--motif", sombre ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)");
  c.style.setProperty("--pg-cq-titres", '"' + pgPoliceTitres() + '", var(--titres)');
  const cq = pgEl("div", "pg-cq-in " + (plein ? "surfond" : vis.length ? "images" : "texte"));
  const role = pgEl("div", "pg-cq-role", echapper(s.role || ""));
  const titre = pgEl("div", "pg-cq-titre", echapper(s.titre || ""));
  const texte = pgEl("div", "pg-cq-texte", echapper(s.texte || ""));
  const fichierDe = v => v.source === "mienne" ? (v.fichier && pgMediaDeFichier(v.fichier) ? pgUrlPub("medias", v.fichier) : "")
                                                 : (pgMediaIllu(v) ? pgUrlPub("medias", pgMediaIllu(v).fichier) : "");
  const etiquette = v => v.source === "mienne" ? (v.fichier ? "" : "Votre image — à déposer")
    : ((v.illustration || "").split(/[,:;.]/)[0].slice(0, 60) || "Image à décrire");
  const puces = v => {
    const q = pgEl("div", "pg-cq-qui");
    return q;
    
    
    
    
  };
  const zone = (v, classe) => {
    const f = fichierDe(v), z = pgEl("div", classe + (f ? " fichier" : ""), f ? "" : "<span>" + echapper(etiquette(v)) + "</span>");
    if (f) z.style.setProperty("--img", "url('" + encodeURI(f) + "')");
    z.appendChild(puces(v));
    return z;
  };
  const grille = () => {
    const g = pgEl("div", "pg-cq-images"), n = posees.length;
    g.style.gridTemplateColumns = n >= 2 ? "1fr 1fr" : "1fr";
    posees.forEach((v, k) => {
      // Une image générée SEULE sur la couleur de la slide s'y fond ; à plusieurs, ou importée, c'est une photo posée.
      const z = zone(v, "pg-cq-img " + (("photo")));
      if (n === 3 && k === 0) z.style.gridRow = "span 2";
      g.appendChild(z);
    });
    return g;
  };
  // une slide VIDÉO : l'extrait tourne dans le croquis, en plein cadre ou posé
  const vidInfo = s.video && pgVideoInfo(s.video.id);
  if (vidInfo) {
    const z = pgEl("div", (s.video.plein ? "pg-cq-fond" : "pg-cq-img photo") + " fichier pg-cq-video",
      '<video src="' + pgUrlVideo(s.video.id, "extrait") + '" muted loop autoplay playsinline style="object-position:' + ((s.video.cadrage || {}).x ?? 50) + "% " + ((s.video.cadrage || {}).y ?? 50) + '%"></video><span class="pg-cq-duree">▶ ' + pgDuree(s.video.a - s.video.de) + "</span>");
    cq.className = "pg-cq-in " + (s.video.plein ? "surfond" : "images");
    if (s.video.plein) { cq.append(z, role); const bas = pgEl("div", "pg-cq-bas"); bas.append(titre, texte); cq.appendChild(bas); }
    else {
      const g = pgEl("div", "pg-cq-images"); g.style.gridTemplateColumns = "1fr"; g.appendChild(z); cq.append(role, titre, texte, g);
      // « Forme de la vidéo » : le croquis montre déjà le cadre aux proportions de la vidéo, entière (le réglage ne se voyait qu'une fois composé)
      if (s.video.forme === "video" && vidInfo.l && vidInfo.h) {
        g.classList.add("pg-cq-forme"); z.style.aspectRatio = vidInfo.l + " / " + vidInfo.h;
        // une vidéo en hauteur se cale sur la hauteur disponible, une vidéo en largeur sur la largeur
        if (vidInfo.l < vidInfo.h) { z.style.height = "100%"; z.style.width = "auto"; z.style.maxWidth = "100%"; }
      }
    }
  } else if (plein) {
    cq.appendChild(zone(plein, "pg-cq-fond"));
    cq.appendChild(role);
    if (posees.length) cq.appendChild(grille());
    const bas = pgEl("div", "pg-cq-bas"); bas.append(titre, texte); cq.appendChild(bas);
  } else if (vis.length) cq.append(role, titre, texte, grille());
  else cq.append(role, titre, texte);
  c.appendChild(cq);
  return c;
}

/* La slide telle qu'elle est composée, si elle correspond encore à son plan ; sinon, son croquis. */
const pgEmpreinteSlide = s => [s.titre, s.texte, s.sticker || "", s.couleur || "",
  (s.visuels || []).map(v => v.source + (v.plein ? "+" : "") + ":" + (v.fichier || v.id)).join(","),
  // une slide vidéo : seules la vidéo et sa place changent la mise en page (le moment gardé et le son, non)
  s.video ? "video" + (s.video.plein ? "+" : s.video.forme === "video" ? "=" : "") + ":" + s.video.id : ""].map(x => String(x == null ? "" : x).trim()).join("|");
function pgSlideAJour(k) {
  if (!PG.deck || !(PG.deck.slides || [])[k] || !PG.deck.plan) return false;
  let avant = [];
  try { avant = JSON.parse(PG.deck.plan); } catch (e) { return false; }
  const a = avant[k], s = PG.pub.plan.slides[k];
  if (!a || !s) return false;
  // Une composition d'avant le storyboard n'a rangé que les textes : on ne compare que ceux-là.
  if (!Array.isArray(a.visuels)) return [a.titre, a.texte, a.sticker || ""].join("|").trim() === [s.titre, s.texte, s.sticker || ""].join("|").trim();
  return pgEmpreinteSlide(a) === pgEmpreinteSlide(s);
}
function pgVueSlide(k, largeur) {
  const F = PG_FORMATS[PG.genre], s = PG.pub.plan.slides[k];
  const boite = pgEl("div", "pg-sb-vue");
  boite.style.width = largeur + "px"; boite.style.height = Math.round(largeur * F.h / F.l) + "px";
  if (pgSlideAJour(k)) {
    const e = largeur / F.l;
    // &video=1 : une slide vidéo y tourne en boucle (le serveur met l'extrait à la place de l'image de la vidéo)
    boite.innerHTML = '<iframe sandbox="allow-same-origin" loading="lazy" tabindex="-1" scrolling="no" src="' + pgUrlSlide(k + 1) + '&video=1" ' +
      'style="width:' + F.l + "px;height:" + F.h + "px;transform:scale(" + e + ')"></iframe>';
    boite.classList.add("composee");
  } else boite.appendChild(pgCroquis(s));
  return boite;
}

/* ---------- Le storyboard ---------- */
function pgStoryboard(c) {
  const F = PG_FORMATS[PG.genre], plan = PG.pub.plan;
  PG.sbN = Math.max(0, Math.min(plan.slides.length - 1, PG.sbN || 0));
  const sb = pgEl("div", "pg-sb");
  sb.style.setProperty("--pg-ratio", F.l + " / " + F.h);

  // La bande, et le rythme des fonds.
  const tete = pgEl("div", "pg-sb-tete", '<span class="pg-sb-h">La bande</span>');
  const rythme = pgEl("div", "pg-sb-rythme", "Le rythme ");
  const co = pgCouleursDA(), pleine = s => pgVisuels(s).some(v => v.plein) || !!(s.video && s.video.plein);
  plan.slides.forEach(s => { const i = pgEl("i"); i.style.background = pleine(s) ? "linear-gradient(90deg,#6b4a3a,#b08968)" : co[pgCleFond(s)]; rythme.appendChild(i); });
  /* Deux fonds seulement (ceux de la DA) : deux slides de suite sur le fond sont la règle, plus un défaut.
     On dit simplement la part de chacun. */
  const nAccent = plan.slides.filter(s => !pleine(s) && pgCleFond(s) === "accent").length, nFond = plan.slides.filter(s => !pleine(s) && pgCleFond(s) === "fond").length;
  rythme.appendChild(pgEl("span", "", "· " + nFond + " sur le fond, " + nAccent + " sur le fond accent"));
  tete.appendChild(rythme);
  sb.appendChild(tete);

  /* LA GRILLE : toutes les slides d'un coup, QUATRE PAR LIGNE, qui passent à la ligne — pas de bande à
     faire défiler (demande du 23 septembre 2026 : « imagine si on en a dix »). Cinq par ligne les
     rendait trop petites. La largeur d'une carte se calcule sur la colonne : la vue d'une slide composée
     est une iframe réduite, qui a besoin d'une taille en pixels. */
  const bande = pgEl("div", "pg-sb-bande");
  PG.sbCarte = Math.max(120, Math.floor(((c.clientWidth || 700) - 3 * 14) / 4));
  plan.slides.forEach((s, k) => {
    const carte = pgEl("button", "pg-sb-carte" + (PG.sbFen && k === PG.sbN ? " on" : "") + (s.verrou ? " verrou" : "")); carte.type = "button";
    carte.title = "Ouvrir cette " + F.une + " pour la régler";
    carte.appendChild(pgVueSlide(k, PG.sbCarte));
    /* L'ÉTAT des images, pas leur type. L'étiquette disait « 1 à générer » pour toute image que le
       studio fabrique, faite ou non : une slide dont l'image était générée depuis longtemps semblait
       en attendre une (relevé le 24 septembre 2026). */
    const gens = pgVisuels(s).filter(v => false), nm = pgVisuels(s).filter(v => v.source === "mienne").length;
    const etats = gens.map(v => pgEtatIllu(s, v));
    const nf = etats.filter(e => e === "faite").length, nc = etats.filter(e => e === "changee").length, na = gens.length - nf - nc;
    const bouts = [];
    if (nf) bouts.push('<span class="puce ok" title="Image générée, conforme à sa description">' + nf + " générée" + (nf > 1 ? "s" : "") + " ✓</span>");
    if (nc) bouts.push('<span class="puce refaire" title="La description, qui est dedans ou le cadre ont changé depuis : l\'image ne correspond plus">' + nc + " à refaire</span>");
    if (na) bouts.push('<span class="puce gen">' + na + " à générer</span>");
    if (nm) bouts.push('<span class="puce">' + nm + " à vous</span>");
    if (s.video) bouts.push('<span class="puce video">vidéo · ' + (s.video.plein ? "plein cadre" : "posée") + " · " + pgDuree(s.video.a - s.video.de) + "</span>");
    else if (!gens.length && !nm) bouts.push('<span class="puce">texte seul</span>');
    carte.appendChild(pgEl("span", "pg-sb-carte-sous", '<span class="n">' + String(k + 1).padStart(2, "0") + "</span><b>" + echapper(s.role || "—") + "</b>" + bouts.join("")));
    carte.onclick = () => { PG.sbN = k; PG.sbFen = true; PG.quiOuvert = null; pgRendre(); };
    bande.appendChild(carte);
  });
  if (plan.slides.length < 12) {
    const plus = pgEl("button", "pg-sb-carte pg-sb-plus", '<span class="pg-sb-vue" style="width:' + PG.sbCarte + 'px"><span>+</span></span><span class="pg-sb-carte-sous">Ajouter une ' + F.une + "</span>"); plus.type = "button";
    plus.onclick = () => {
      plan.slides.push({ id: pgIdNeuf("s"), role: "", titre: "", texte: "", sticker: "", couleur: "fond", visuels: [], pourquoi: "", verrou: false });
      PG.sbN = plan.slides.length - 1; PG.sbFen = true; pgSauverPlanBientot(); pgRendre();
    };
    bande.appendChild(plus);
  }
  sb.appendChild(bande);
  /* La phrase dit ce qu'on voit VRAIMENT : des croquis, des slides composées, ou les deux. Elle
     disait toujours « ce sont des croquis », même sous un carrousel entièrement composé. */
  const composees = plan.slides.filter((_, k) => pgSlideAJour(k)).length, total = plan.slides.length;
  const croquis = "ils montrent ce qui est dit, les couleurs et les images — qui est dedans, laquelle remplit la " + F.une +
    ". La place et la taille exactes de chaque élément se décident à la composition, d'après votre DA ; vos images importées y sont posées entières.";
  sb.appendChild(pgEl("p", "pg-sb-note", !composees
    ? "Ce sont des <b>croquis</b> : " + croquis
    : composees === total
      ? "Ce sont vos " + F.des + " <b>composées</b>, telles qu'elles sortiront. Une " + F.une + " que vous modifiez ici redevient un croquis, jusqu'à ce qu'elle soit recomposée."
      : composees + " " + (composees > 1 ? F.des + " sont composées et se montrent telles qu'elles sortiront" : F.une + " est composée et se montre telle qu'elle sortira") +
        " ; les autres sont des <b>croquis</b> — modifiées depuis, ou pas encore composées : " + croquis));

  c.appendChild(sb);
}

/* L'ÉDITEUR D'UNE SLIDE, DANS UNE FENÊTRE DU STUDIO. Il vivait sous la bande, sur la page ; il s'ouvre
   désormais par-dessus, au clic sur une slide de la grille. Tout s'enregistre au fil de l'eau : la grille
   se met à jour derrière.

   LE MÊME GESTE QU'À L'ÉTAPE 5 (23 septembre 2026) : la fenêtre prend la forme de la loupe — à gauche une
   SCÈNE EN COVER FLOW, la slide ouverte au centre et ses voisines couchées en perspective et floutées ; à
   droite le PANNEAU des trois questions. Mêmes réglages (PG_CF, validés au LABO), même règle qui retire des
   voisines quand la fenêtre est étroite. On change de slide par les flèches (écran ou clavier), un clic sur
   une voisine, ou les puces ; on ferme par la croix, Échap ou un clic à côté.

   pgRendre() l'appelle à chaque rendu. La SCÈNE est gardée d'un rendu à l'autre, et chaque slide n'y est
   remontée que si elle a changé : un clic dans le panneau ne recharge pas la vraie slide d'une publication
   composée, et changer de slide ANIME les cartes au lieu de tout redessiner. La fenêtre se retire d'elle-
   même quand on quitte le plan — ou le temps que Claude travaille, puis revient. */
function pgSbCFTaille() {
  const F = PG_FORMATS[PG.genre], large = window.innerWidth > 980;
  const place = Math.max(240, window.innerWidth - (large ? 460 + 24 : 0) - 48 - 90);
  const dispoH = Math.max(300, large ? window.innerHeight - 110 : window.innerHeight * 0.5);
  const kH = dispoH / F.h;
  let V = PG_CF.voisines, k = kH;
  for (; V > 0; V--) {
    k = Math.min(kH, place / pgCFEtendue(V) / F.l);
    if (k >= kH * 0.72) break;
  }
  if (V === 0) k = Math.min(kH, place / F.l);
  return { l: Math.round(F.l * k), h: Math.round(F.h * k), V: V };
}
function pgSbScene(scene) {
  const plan = PG.pub.plan, n = PG.sbN, total = plan.slides.length, t = pgSbCFTaille(), V = t.V;
  PG.sbCF = PG.sbCF || { montees: new Map() };
  const M = PG.sbCF.montees;
  let plateau = scene.querySelector(".pg-cf-plateau");
  if (!plateau) {
    scene.innerHTML = "";
    plateau = pgEl("div", "pg-cf-plateau"); scene.appendChild(plateau);
    const fleche = (sens, titre, d) => {
      const b = pgEl("button", "pg-cf-fleche pg-cf-" + sens, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>');
      b.type = "button"; b.title = titre; b.setAttribute("aria-label", titre);
      b.onclick = () => { const k = PG.sbN + (sens === "avant" ? -1 : 1); if (k >= 0 && k < PG.pub.plan.slides.length) { PG.sbN = k; PG.quiOuvert = null; PG.montreOuvert = null; pgRendre(); } };
      scene.appendChild(b);
    };
    fleche("avant", "Précédente (←)", "M15 5l-7 7 7 7");
    fleche("apres", "Suivante (→)", "M9 5l7 7-7 7");
    scene.appendChild(pgEl("div", "pg-cf-rang"));
    M.clear();
  }
  scene.style.perspective = PG_CF.perspective + "px";
  scene.style.height = t.h + "px";
  scene.style.width = Math.round(t.l * (V ? pgCFEtendue(V) : 1)) + "px";

  // Ce qui sort de la fenêtre de slides est démonté.
  [...M.keys()].forEach(k => { if (Math.abs(k - n) > V || k >= total) { M.get(k).cadre.remove(); M.delete(k); } });
  for (let k = Math.max(0, n - V); k <= Math.min(total - 1, n + V); k++) {
    // Une carte n'est refaite que si sa slide a changé (texte, couleur, images, composition) ou sa taille.
    const emp = pgEmpreinteSlide(plan.slides[k]) + "|" + pgSlideAJour(k) + "|" + t.l + "|" + (pgVisuels(plan.slides[k]).map(v => { const m = (null); return m ? m.fichier : ""; }).join(","));
    let e = M.get(k);
    if (!e || e.emp !== emp) {
      const cadre = pgEl("div", "pg-cf-slide");
      // Une carte qui vient d'être montée se pose directement à sa place, sans glisser depuis le centre.
      cadre.style.transition = "none";
      requestAnimationFrame(() => requestAnimationFrame(() => { cadre.style.transition = ""; }));
      cadre.appendChild(pgVueSlide(k, t.l));
      cadre.onclick = () => { if (PG.sbN !== k) { PG.sbN = k; PG.quiOuvert = null; PG.montreOuvert = null; pgRendre(); } };
      if (e) e.cadre.replaceWith(cadre); else plateau.appendChild(cadre);
      e = { cadre: cadre, emp: emp }; M.set(k, e);
    }
    const d = k - n, abs = Math.abs(d), sens = d > 0 ? 1 : -1;
    e.cadre.style.width = t.l + "px"; e.cadre.style.height = t.h + "px";
    e.cadre.classList.toggle("ici", d === 0);
    e.cadre.classList.toggle("cote", d !== 0);
    e.cadre.style.zIndex = String(10 - abs);
    e.cadre.style.transform = d === 0 ? "none" : "translateX(" + (sens * PG_CF.ecart * abs) + "%) translateZ(" + (-PG_CF.recul * abs) + "px)" +
      " rotateY(" + (-sens * PG_CF.angle) + "deg) scale(" + Math.pow(PG_CF.echelle, abs) + ")";
    e.cadre.style.filter = d === 0 ? "none" : "blur(" + (PG_CF.flou * abs) + "px)";
  }
  const rang = scene.querySelector(".pg-cf-rang");
  if (rang.children.length !== total) {
    rang.innerHTML = "";
    for (let i = 0; i < total; i++) { const p = pgEl("i"); p.onclick = () => { PG.sbN = i; PG.quiOuvert = null; PG.montreOuvert = null; pgRendre(); }; rang.appendChild(p); }
  }
  [...rang.children].forEach((p, i) => p.classList.toggle("ici", i === n));
  scene.querySelector(".pg-cf-avant").disabled = n <= 0;
  scene.querySelector(".pg-cf-apres").disabled = n >= total - 1;
  PG.sbCF.l = t.l;
}
function pgFenetreSlide() {
  let f = $("pg-sb-fenetre");
  const ouverte = PG.sbFen && PG.etape === 3 && pgEstPub() && !PG.occupe && PG.pub && PG.pub.plan && PG.pub.plan.slides.length;
  if (!ouverte) {
    if (f) { f.remove(); document.body.classList.remove("visionneuse-ouverte"); PG.sbCF = null; }
    return;
  }
  const plan = PG.pub.plan, F = PG_FORMATS[PG.genre];
  PG.sbN = Math.max(0, Math.min(plan.slides.length - 1, PG.sbN || 0));
  if (!f) {
    f = pgEl("div", "pg-sb-fenetre");
    f.id = "pg-sb-fenetre";
    f.innerHTML = '<div class="pg-sb-fenetre-voile"></div><div class="pg-sb-cadre" role="dialog" aria-modal="true">' +
      '<div class="pg-sb-scene"></div><div class="pg-sb-panneau"></div></div>';
    f.querySelector(".pg-sb-fenetre-voile").onclick = pgFermerFenetreSlide;
    document.body.appendChild(f);
    document.body.classList.add("visionneuse-ouverte");
    PG.sbCF = null;
  }
  pgSbScene(f.querySelector(".pg-sb-scene"));

  // Le panneau : rester où l'on est quand on y clique ; repartir du haut quand on change de slide.
  const panneau = f.querySelector(".pg-sb-panneau");
  const y = panneau.scrollTop, meme = PG.sbFenN === PG.sbN;
  panneau.innerHTML = "";
  const s = plan.slides[PG.sbN];
  const tete = pgEl("div", "pg-sb-panneau-tete", "<h3>" + pgMaj(F.une) + " " + (PG.sbN + 1) + " sur " + plan.slides.length + (s.role ? " <small>· " + echapper(s.role) + "</small>" : "") + "</h3>");
  const fermer = pgEl("button", "pg-sb-fenetre-fermer", "×"); fermer.type = "button"; fermer.title = "Fermer (Échap)"; fermer.setAttribute("aria-label", "Fermer");
  fermer.onclick = pgFermerFenetreSlide;
  tete.appendChild(fermer);
  panneau.appendChild(tete);
  panneau.appendChild(pgSlideOuverte(s, PG.sbN));
  panneau.scrollTop = meme ? y : 0;
  PG.sbFenN = PG.sbN;
}
function pgFermerFenetreSlide() {
  PG.sbFen = false; PG.quiOuvert = null; PG.montreOuvert = null; PG.inviteAttente = null; PG.sbCF = null;
  const f = $("pg-sb-fenetre");
  if (f) { f.remove(); document.body.classList.remove("visionneuse-ouverte"); }
  // La grille retire le liseré de la slide qu'on vient de fermer.
  document.querySelectorAll(".pg-sb-carte.on").forEach(x => x.classList.remove("on"));
}

// Échap ferme ; ← → changent de slide — sauf en tapant dans un champ, ou quand une autre fenêtre du studio est ouverte.
document.addEventListener("keydown", e => {
  if (!$("pg-sb-fenetre") || document.querySelector(".fen")) return;
  if (e.key === "Escape") { e.preventDefault(); pgFermerFenetreSlide(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;
  const n = PG.pub && PG.pub.plan ? PG.pub.plan.slides.length : 0;
  if (e.key === "ArrowLeft" && PG.sbN > 0) { e.preventDefault(); PG.sbN--; PG.quiOuvert = null; pgRendre(); }
  if (e.key === "ArrowRight" && PG.sbN < n - 1) { e.preventDefault(); PG.sbN++; PG.quiOuvert = null; pgRendre(); }
});

function pgSlideOuverte(s, k) {
  const F = PG_FORMATS[PG.genre], plan = PG.pub.plan, st = PG.genre === "stories", co = pgCouleursDA();
  const o = pgEl("div", "pg-sb-ouverte");

  // En tête du panneau : les outils de la slide, et la raison de Claude. L'aperçu et la navigation sont dans la scène.
  const ap = pgEl("div", "pg-sb-apercu");
  const outils = pgEl("div", "pg-sb-outils");
  const cadenas = pgEl("button", "pg-plan-outil pg-plan-cadenas" + (s.verrou ? " on" : ""),
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>');
  cadenas.type = "button";
  cadenas.title = s.verrou ? "Verrouillée : Claude n'y touchera plus. Cliquer pour la lui rendre." : "Verrouiller cette " + F.une + " : Claude la gardera mot pour mot";
  cadenas.onclick = () => { s.verrou = !s.verrou; if (s.verrou) PG.d.aReaccorder = true; pgSauverPlanBientot(); pgRendre(); };
  outils.appendChild(cadenas);
  [["↑", "Avancer d'une place", () => { if (k > 0) { plan.slides.splice(k - 1, 0, plan.slides.splice(k, 1)[0]); PG.sbN = k - 1; } }],
   ["↓", "Reculer d'une place", () => { if (k < plan.slides.length - 1) { plan.slides.splice(k + 1, 0, plan.slides.splice(k, 1)[0]); PG.sbN = k + 1; } }],
   ["×", "Retirer cette " + F.une, () => { if (plan.slides.length > 1) { plan.slides.splice(k, 1); PG.sbN = Math.max(0, k - 1); } }]].forEach(([signe, aide, action]) => {
    const b = pgEl("button", "pg-plan-outil", signe); b.type = "button"; b.title = aide; b.setAttribute("aria-label", aide);
    b.onclick = () => { action(); pgSauverPlanBientot(); pgRendre(); };
    outils.appendChild(b);
  });
  ap.appendChild(outils);
  if ((s.pourquoi || "").trim()) ap.appendChild(pgEl("div", "pg-sb-claude", "<b>Claude propose</b> — " + echapper(s.pourquoi)));
  o.appendChild(ap);

  const q = pgEl("div", "pg-sb-questions");
  const grandir = el => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  // Ce qu'on écrit soi-même est à soi : la slide se verrouille, et la suite pourra s'accorder à elle.
  const aMoi = () => { if (!s.verrou) { s.verrou = true; cadenas.classList.add("on"); } PG.d.aReaccorder = true; pgMajAccord(); };
  const majVues = () => {
    // La slide du centre de la scène se redessine à mesure qu'on tape.
    const ici = document.querySelector("#pg-sb-fenetre .pg-cf-slide.ici");
    if (ici && PG.sbCF) { const a = ici.querySelector(".pg-sb-vue"); if (a) a.replaceWith(pgVueSlide(k, PG.sbCF.l)); const e = PG.sbCF.montees.get(k); if (e) e.emp = ""; }
    const carte = document.querySelectorAll(".pg-sb-bande .pg-sb-carte")[k];
    if (carte) { const v = carte.querySelector(".pg-sb-vue"); if (v) v.replaceWith(pgVueSlide(k, PG.sbCarte || 150)); }
  };

  // 1. Ce qu'elle dit
  const q1 = pgEl("div", "pg-sb-q", "<h3>Ce qu'elle dit</h3>");
  const role = pgEl("input", "pg-plan-role"); role.type = "text"; role.maxLength = 40; role.value = s.role || ""; role.placeholder = "Rôle (Accroche, Étape 1, Appel…)";
  role.oninput = () => { s.role = role.value; pgSauverPlanBientot(); majVues(); };
  const t = pgEl("textarea", "pg-champ pg-sb-titre"); t.rows = 1; t.maxLength = 200; t.value = s.titre || ""; t.placeholder = "Le titre";
  const x = pgEl("textarea", "pg-champ"); x.rows = 2; x.maxLength = 600; x.value = s.texte || ""; x.placeholder = "Le texte (facultatif)";
  t.oninput = () => { s.titre = t.value; grandir(t); aMoi(); pgSauverPlanBientot(); majVues(); };
  x.oninput = () => { s.texte = x.value; grandir(x); aMoi(); pgSauverPlanBientot(); majVues(); };
  q1.append(role, t, x);
  if (st) {
    const stk = pgEl("input", "pg-champ"); stk.type = "text"; stk.maxLength = 80; stk.value = s.sticker || ""; stk.placeholder = "Sticker Instagram (sondage, question, lien…)";
    stk.oninput = () => { s.sticker = stk.value; pgSauverPlanBientot(); };
    q1.appendChild(stk);
  }
  requestAnimationFrame(() => { grandir(t); grandir(x); });

  /* 2. Sa couleur. Une image en PLEIN CADRE fait le fond : il n'y a plus de couleur à choisir, et en
     proposer une induirait Claude en erreur. La couleur d'avant est gardée, et revient avec le plein cadre retiré. */
  const q2 = pgEl("div", "pg-sb-q");
  if (s.video && s.video.plein) {
    q2.innerHTML = "<h3>Sa couleur</h3>";
    q2.appendChild(pgEl("p", "pg-sb-aide pg-sb-sans", "Aucune : la <b>vidéo en plein cadre</b> fait le fond de la " + F.une + ". Repassez-la en « Posée » pour choisir une couleur."));
  } else if (pgVisuels(s).some(v => v.plein)) {
    q2.innerHTML = "<h3>Sa couleur</h3>";
    q2.appendChild(pgEl("p", "pg-sb-aide pg-sb-sans", "Aucune : l'image en <b>plein cadre</b> fait le fond de la " + F.une + ". Les autres images s'y posent comme des photos, avec leur propre décor. Repassez-la en « Posée » pour choisir une couleur."));
  } else {
    q2.innerHTML = "<h3>Sa couleur <small>le fond de la " + F.une + " — et celui des images générées posées dessus</small></h3>";
    const cs = pgEl("div", "pg-sb-couleurs");
    PG_COULEURS.forEach(([cle, nom]) => {
      const tex = typeof daFondUrl === "function" ? daFondUrl((PG.identites || []).find(x => x.id === PG.d.identiteId), cle === "accent" ? "fond_accent" : "fond") : "";
      const b = pgEl("button", "pg-sb-couleur" + (pgCleFond(s) === cle ? " on" : ""), '<i style="background:' + co[cle] + (tex ? " url('" + tex + "') center/cover" : "") + '"></i>' + pgMaj(nom)); b.type = "button";
      b.title = co[cle] + (tex ? " avec sa texture" : "") + " — " + nom + " de la DA";
      b.onclick = () => { s.couleur = cle; pgSauverPlanBientot(); pgRendre(); };
      cs.appendChild(b);
    });
    q2.appendChild(cs);
  }

  /* 3. Ce qu'on y voit : texte seul, des images — chacune générée ou importée, posée ou en plein cadre —, ou UNE VIDÉO
     (27 sept. 2026 : Instagram accepte des vidéos dans un carrousel et dans les stories). Ce qu'on quitte est gardé de
     côté le temps de la séance : revenir au choix d'avant le retrouve. */
  const q3 = pgEl("div", "pg-sb-q", "<h3>Ce qu'on y voit</h3>");
  const vis = pgVisuels(s);
  const enVideo = !!s.video || PG.sbVideo === s.id;
  const seg = pgEl("div", "pg-sb-segments pg-sb-segments-3");
  const deCote = () => {
    PG.visuelsDeCote = PG.visuelsDeCote || {}; PG.videosDeCote = PG.videosDeCote || {};
    if (vis.length) { PG.visuelsDeCote[s.id] = vis.slice(); s.visuels = []; }
    if (s.video) { PG.videosDeCote[s.id] = s.video; delete s.video; }
  };
  [["texte", "Texte seul"], ["images", "Avec des images"], ["video", "Avec une vidéo"]].forEach(([cle, nom]) => {
    const on = cle === "video" ? enVideo : cle === "texte" ? !vis.length && !enVideo : !!vis.length;
    const b = pgEl("button", on ? "on" : "", nom); b.type = "button";
    b.onclick = () => {
      if (on) return;
      deCote();
      PG.sbVideo = cle === "video" ? s.id : null;
      if (cle === "images") s.visuels = (PG.visuelsDeCote && PG.visuelsDeCote[s.id]) || [{ id: pgIdNeuf("v"), source: "mienne", plein: false, fichier: null }];
      if (cle === "video" && PG.videosDeCote[s.id]) s.video = PG.videosDeCote[s.id];
      pgSauverPlanBientot(); pgRendre();
    };
    seg.appendChild(b);
  });
  q3.appendChild(seg);
  if (enVideo) {
    q3.appendChild(pgEl("p", "pg-sb-aide", "Une vidéo par " + F.une + " — c'est la règle d'Instagram. Elle vient de vos rendus ou de votre ordinateur : rien n'est généré, c'est gratuit. À l'export, cette " + F.une + " sort en MP4."));
    q3.appendChild(pgBlocVideo(s));
    q.append(q1, q2, q3);
    o.appendChild(q);
    return o;
  }
  q3.appendChild(pgEl("p", "pg-sb-aide", vis.length
    ? "Une à quatre images, de ta banque ou de ton ordinateur : chacune se pose dans la " + F.une + " ou la remplit en plein cadre."
    : "La " + F.une + " n'a pas d'image : le titre porte tout."));
  vis.forEach((v, j) => q3.appendChild(pgBlocVisuel(s, v, j)));
  if (vis.length && vis.length < PG_VISUELS_MAX) {
    const ajouts = pgEl("div", "pg-sb-ajouts");
    [["+ Une autre image", () => ({ id: pgIdNeuf("v"), source: "mienne", plein: false, fichier: null })]].forEach(([nom, faire]) => {
      const b = pgEl("button", "pg-sb-ajout", nom); b.type = "button";
      b.onclick = () => { const v = faire(); s.visuels.push(v); PG.focusIllu = v.id; pgSauverPlanBientot(); pgRendre(); };
      ajouts.appendChild(b);
    });
    q3.appendChild(ajouts);
  }
  q.append(q1, q2, q3);
  o.appendChild(q);
  return o;
}

/* Une image de la slide : sa source, son cadre, et selon la source, qui est dedans et sa description, ou
   le fichier importé et son nom. */
function pgBlocVisuel(s, v, j) {
  const F = PG_FORMATS[PG.genre];
  const b = pgEl("div", "pg-sb-image");
  const etat = pgEtatIllu(s, v), m = (v.fichier ? pgMediaDeFichier(v.fichier) : null);
  const tete = pgEl("div", "pg-sb-image-tete", "<span>Image " + (j + 1) +
    (('<span class="pg-sb-badge">la vôtre</span>')) +
    (v.plein ? '<span class="pg-sb-badge plein">plein cadre</span>' : "") +
    (etat ? '<span class="pg-plan-illu-etat ' + etat + '">' + (etat === "faite" ? "générée ✓" : etat === "changee" ? "modifiée depuis — à refaire" : "pas encore générée") + "</span>" : "") + "</span>");
  const ote = pgEl("button", "pg-plan-outil", "×"); ote.type = "button"; ote.title = "Retirer cette image de la " + F.une; ote.setAttribute("aria-label", ote.title);
  ote.onclick = async () => {
    ;
    s.visuels.splice(j, 1); pgSauverPlanBientot(); pgRendre();
  };
  tete.appendChild(ote);
  b.appendChild(tete);

  // Ses deux réglages : d'où elle vient, et comment elle se pose. Une seule image en plein cadre par slide.
  const regl = pgEl("div", "pg-sb-reglages");
  const mini = (options, valeur, choisir) => {
    const g = pgEl("div", "pg-sb-mini");
    options.forEach(([val, nom, aide]) => {
      const x = pgEl("button", val === valeur ? "on" : "", nom); x.type = "button"; if (aide) x.title = aide;
      x.onclick = () => { choisir(val); pgSauverPlanBientot(); pgRendre(); };
      g.appendChild(x);
    });
    return g;
  };
  regl.appendChild(mini([[false, "Posée", "Dans la " + F.une + ", à côté du titre"], [true, "Plein cadre", "Elle remplit la " + F.une + " ; le texte se pose dessus"]], !!v.plein,
    val => { if (val) s.visuels.forEach(x => { x.plein = false; }); v.plein = val; }));
  b.appendChild(regl);

  {
    b.appendChild(pgDeposerVisuel(s, v, m));
  }
  return b;
}


/* ---------- LA VIDÉO D'UNE SLIDE (27 sept. 2026 ; maquette LABO/slides-video) ----------
   Choisie dans les rendus du studio ou envoyée depuis l'ordinateur, elle est copiée dans la publication (serveur :
   ajouterVideoPub) avec trois dérivés : l'aperçu entier (la pellicule d'ici), l'extrait muet du moment gardé (les
   vignettes), et son image (que Claude place dans la slide). s.video = { id, de, a, plein, son }. */
const pgVideoInfo = id => ((PG.pub && PG.pub.videos) || []).find(v => v.id === id) || null;
const pgUrlVideo = (id, sorte) => pgUrlPub("videos", id + (sorte ? "-" + sorte : "") + ".mp4") + "?v=" + ((PG.videoV || {})[id] || 0);
const pgDuree = x => { x = Math.max(0, Math.round(x || 0)); return Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"); };
/* ---------- LES GIF (30 sept. 2026) : la bibliothèque du studio (GIFS/), l'import, la recherche GIPHY ----------
   Un GIF choisi devient une vidéo de la publication (serveur : ajouterVideoPub { gif }) et la slide porte « gif » : le nom de
   sa carte. Chaque GIF a un « quand l'utiliser » : Claude le lit pour en poser lui-même au plan. */
const pgUrlGif = f => "/gifs-fichier/" + encodeURIComponent(f);
function pgBlocGifs(s, recue, echec) {
  const z = pgEl("div", "pg-sb-gifs");
  z.appendChild(pgEl("p", "pg-sb-aide", "<b>Ou un GIF</b> — une réaction, posée dans sa carte « Toi.GIF » :"));
  const g = pgEl("div", "pg-sb-rendus-video pg-sb-gifs-grille"); z.appendChild(g);
  const poser = async (id, nom, recherche) => {
    PG.sbVideoEnvoi = nom || "Le GIF"; pgRendre();
    try { const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gif: id }) })).json();
      recue(r); s.video.forme = "video"; s.video.gif = (PG.giphyNoms || {})[s.id] || "Toi"; if (recherche) s.video.recherche = recherche; pgSauverPlanBientot(); pgRendre(); } catch (err) { echec(err); }
  };
  // les mots GIPHY de CETTE slide (7 oct. 2026) : ceux qui avaient trouvé son GIF, ou ceux que Claude propose d'après son texte
  PG.giphyQs = PG.giphyQs || {};
  const lire = () => PG.gifs ? Promise.resolve(PG.gifs) : fetch("/api/gifs").then(r => r.json()).then(j => (PG.gifs = j));
  lire().then(j => {
    (j.gifs || []).forEach(x => {
      const c = pgEl("div", "pg-sb-gif");
      const bt = pgEl("button", "", '<video src="' + pgUrlGif(x.fichier) + '" poster="' + pgUrlGif(x.image) + '" autoplay muted loop playsinline></video><small>' + echapper(x.nom.slice(0, 24)) + "</small>");
      bt.type = "button"; bt.title = x.quand ? "Quand : " + x.quand : "Pas encore de « quand l'utiliser »";
      bt.onclick = () => poser(x.id, x.nom);
      const ed = pgEl("button", "pg-sb-gif-ed", "✎"); ed.type = "button"; ed.title = "Quand l'utiliser (Claude le lit pour choisir)";
      ed.onclick = async () => { const q = await saisir("Quand utiliser « " + x.nom + " » ?", x.quand || "", { ok: "Enregistrer", exemple: "ex. quand on se moque gentiment du lecteur, la gêne, un choc", max: 300 }); if (q === null) return;
        const r = await (await fetch("/api/gifs/" + x.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quand: q }) })).json(); if (!r.erreur) { PG.gifs = null; pgRendre(); } };
      const ot = pgEl("button", "pg-sb-gif-x", "×"); ot.type = "button"; ot.title = "Retirer de la bibliothèque (le fichier est gardé)";
      ot.onclick = async () => { if (!await demander(null, { titre: "Retirer « " + x.nom + " » de vos GIF ?", html: "<p>Il ne sera plus proposé. Le fichier reste dans GIFS/ ; les slides qui l'emploient le gardent.</p>", ok: "Retirer" })) return;
        await fetch("/api/gifs/" + x.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retirer: true }) }); PG.gifs = null; pgRendre(); };
      c.appendChild(bt); c.appendChild(ed); c.appendChild(ot); g.appendChild(c);
    });
    // importer des GIF de l'ordinateur
    const imp = pgEl("button", "pg-sb-gif-plus", "<span>+</span><small>Importer des GIF</small>"); imp.type = "button";
    imp.onclick = async () => {
      const l = await pgChoisirFichiers(".gif,.mp4,.webm,.mov,image/gif,video/mp4,video/webm", true); if (!l.length) return;
      for (const f of l) { PG.sbVideoEnvoi = "Import de " + f.name; pgRendre();
        try { const r = await (await fetch("/api/gifs/deposer?nom=" + encodeURIComponent(f.name), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f })).json(); if (r.erreur) throw new Error(r.erreur); }
        catch (err) { pgDire("« " + f.name + " » n'a pas pu être importé : " + (err.message || err)); } }
      PG.sbVideoEnvoi = null; PG.gifs = null; pgDire("GIF importés ✓ — dites pour chacun quand l'utiliser (✎)."); pgRendre();
    };
    g.appendChild(imp);
    // GIPHY : la recherche, ou la clé à poser
    const gy = pgEl("div", "pg-sb-giphy");
    if (j.giphy) {
      const q = pgEl("input", "pg-champ"); q.type = "search"; q.placeholder = "Chercher sur GIPHY — en anglais : shocked, cringe, wow…"; q.value = PG.giphyQs[s.id] || "";
      const res = pgEl("div", "pg-sb-rendus-video pg-sb-gifs-grille");
      const chercher = async () => { PG.giphyQ = q.value.trim(); if (!PG.giphyQ) return; PG.giphyQs[s.id] = PG.giphyQ; res.innerHTML = '<p class="pg-sb-aide">Recherche…</p>';
        try { const r = await (await fetch("/api/gifs/giphy?q=" + encodeURIComponent(PG.giphyQ))).json(); if (r.erreur) throw new Error(r.erreur);
          res.innerHTML = ""; (r.resultats || []).forEach(x => { const c = pgEl("button", "", '<video src="' + echapper(x.apercu) + '" autoplay muted loop playsinline></video><small>' + echapper((x.titre || "").slice(0, 24)) + "</small>"); c.type = "button";
            c.title = "Ajouter à vos GIF et le poser sur cette " + PG_FORMATS[PG.genre].une;
            c.onclick = async () => { PG.sbVideoEnvoi = "GIPHY : " + (x.titre || "le GIF"); pgRendre();
              try { const a = await (await fetch("/api/gifs/giphy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: x.id, mp4: x.mp4, titre: x.titre, nom: PG.giphyQ, quand: PG.giphyQ }) })).json(); if (a.erreur) throw new Error(a.erreur);
                PG.gifs = null; await poser(a.gif.id, a.gif.nom, PG.giphyQs[s.id]); } catch (err) { echec(err); } };
            res.appendChild(c); });
          if (!(r.resultats || []).length) res.innerHTML = '<p class="pg-sb-aide">Rien trouvé.</p>'; } catch (err) { res.innerHTML = '<p class="pg-sb-aide">' + echapper(err.message || String(err)) + "</p>"; } };
      q.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); chercher(); } };
      // ✦ Claude lit la slide et écrit la recherche (les mots des autres slides à GIF lui sont donnés, pour ne pas les répéter)
      const auto = pgEl("button", "btn-mini", "✦ GIF pour cette " + PG_FORMATS[PG.genre].une); auto.type = "button";
      auto.title = "Claude lit le texte de cette " + PG_FORMATS[PG.genre].une + " et cherche les GIF qui vont avec (gratuit, une dizaine de secondes)";
      auto.onclick = async () => { auto.disabled = true; auto.textContent = "Claude lit la " + PG_FORMATS[PG.genre].une + "…";
        try { const autres = ((PG.pub && PG.pub.plan && PG.pub.plan.slides) || []).filter(x => x !== s && x.video && x.video.recherche).map(x => x.video.recherche).join(", ");
          const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/gif-mots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titre: s.titre || "", texte: s.texte || "", autres }) })).json();
          if (r.erreur) throw new Error(r.erreur); q.value = r.chercher; await chercher(); }
        catch (err) { pgDire(err.message || String(err)); }
        auto.disabled = false; auto.textContent = "✦ GIF pour cette " + PG_FORMATS[PG.genre].une; };
      const ligne = pgEl("div", "pg-sb-repro"); ligne.appendChild(q); ligne.appendChild(auto);
      gy.appendChild(ligne); gy.appendChild(res); gy.appendChild(pgEl("p", "pg-sb-aide pg-giphy-mention", "Powered by GIPHY — ces GIF viennent souvent de films et de séries : leurs droits ne sont pas les vôtres."));
      if (q.value) chercher();
    } else {
      gy.appendChild(pgEl("p", "pg-sb-aide", "Brancher <b>GIPHY</b> (des millions de GIF) : créez une clé gratuite sur developers.giphy.com (« Create an API Key »), puis collez-la ici. Elle reste sur cet ordinateur."));
      const cle = pgEl("input", "pg-champ"); cle.type = "password"; cle.placeholder = "Votre clé GIPHY"; cle.autocomplete = "off";
      const ok = pgEl("button", "btn-mini", "Brancher GIPHY"); ok.type = "button";
      ok.onclick = async () => { const r = await (await fetch("/api/gifs/giphy-cle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cle: cle.value }) })).json();
        if (r.erreur) { pgDire(r.erreur); return; } PG.gifs = null; pgRendre(); };
      const l = pgEl("div", "pg-sb-repro"); l.appendChild(cle); l.appendChild(ok); gy.appendChild(l);
    }
    z.appendChild(gy);
  }).catch(() => g.appendChild(pgEl("p", "pg-sb-aide", "Les GIF n'ont pas pu être lus.")));
  return z;
}
// un GIF posé : sa carte, son nom (« Toi.GIF »), et le changer
function pgBlocGifPose(s, v, info, b) {
  const tete = pgEl("div", "pg-sb-image-tete", "<span>GIF · " + echapper((info.nom || "").slice(0, 36)) + '<span class="pg-sb-badge">dans sa carte</span></span>');
  const ote = pgEl("button", "pg-plan-outil", "×"); ote.type = "button"; ote.title = "Changer de GIF"; ote.setAttribute("aria-label", ote.title);
  // changer de GIF : la recherche qui l'avait trouvé revient d'office, et le nom de la carte (« Toi ») est gardé
  ote.onclick = () => { PG.giphyQs = PG.giphyQs || {}; PG.giphyNoms = PG.giphyNoms || {};
    if (v.recherche) PG.giphyQs[s.id] = v.recherche; if (v.gif) PG.giphyNoms[s.id] = v.gif;
    delete s.video; PG.sbVideo = s.id; pgSauverPlanBientot(); pgRendre(); };
  tete.appendChild(ote); b.appendChild(tete);
  const carte = pgEl("div", "pg-gif-carte", '<b>' + echapper(v.gif || "GIF") + '.GIF</b><video src="' + pgUrlVideo(v.id, "extrait") + '" autoplay muted loop playsinline></video>');
  b.appendChild(carte);
  const l = pgEl("label", "pg-sb-aide", "Le nom sur la carte — qui réagit : ");
  const n = pgEl("input", "pg-champ"); n.maxLength = 40; n.value = v.gif || ""; n.placeholder = "Toi, Moi, MoiEnCeMoment…";
  n.oninput = () => { v.gif = n.value.trim() || "GIF"; carte.querySelector("b").textContent = v.gif + ".GIF"; pgSauverPlanBientot(); };
  l.appendChild(n); b.appendChild(l);
  return b;
}
function pgBlocVideo(s) {
  const F = PG_FORMATS[PG.genre], b = pgEl("div", "pg-sb-image pg-sb-video");
  const info = s.video && pgVideoInfo(s.video.id);
  // la vidéo reçue par le serveur : elle devient celle de la slide, sur ses 15 premières secondes
  const recue = r => {
    if (r.erreur) throw new Error(r.erreur);
    PG.pub.videos = r.pub.videos; pgMediasDepuis(r.pub);
    s.video = { id: r.video.id, de: r.video.de, a: r.video.a, plein: false, son: false };
    PG.sbVideo = null; PG.sbVideoEnvoi = null; pgSauverPlanBientot(); pgRendre();
  };
  const echec = err => { PG.sbVideoEnvoi = null; pgDire("Cette vidéo n'a pas pu être ajoutée : " + (err.message || err)); pgRendre(); };
  if (!info) {
    if (PG.sbVideoEnvoi) { b.appendChild(pgEl("p", "pg-sb-aide", "<b>" + echapper(PG.sbVideoEnvoi) + "</b> — le studio la copie dans la publication et prépare son aperçu. Quelques secondes (un peu plus pour une vidéo de téléphone)…")); return b; }
    // depuis l'ordinateur : envoyée telle quelle, convertie par le serveur (un .mov de téléphone passe en H.264)
    const depot = pgEl("label", "pg-sb-depot", "Déposez une vidéo ici, ou cliquez pour la choisir — mp4 ou mov, 500 Mo au plus.");
    const entree = pgEl("input"); entree.type = "file"; entree.accept = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm";
    const envoyer = async f => {
      if (!f) return;
      PG.sbVideoEnvoi = f.name; pgRendre();
      try { recue(await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/video?nom=" + encodeURIComponent(f.name), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f })).json()); }
      catch (err) { echec(err); }
    };
    entree.onchange = () => envoyer(entree.files[0]);
    depot.appendChild(entree);
    depot.ondragover = e => { e.preventDefault(); depot.classList.add("survol"); };
    depot.ondragleave = () => depot.classList.remove("survol");
    depot.ondrop = e => { e.preventDefault(); depot.classList.remove("survol"); envoyer(e.dataTransfer.files[0]); };
    b.appendChild(depot);
    // les vidéos déjà dans la publication (déposées à l'étape « Qui et quoi », ou pour une autre slide) : d'un clic, rien à recopier
    const deja = (PG.pub.videos || []);
    if (deja.length) {
      b.appendChild(pgEl("p", "pg-sb-aide", "Les vidéos de cette publication :"));
      const gd = pgEl("div", "pg-sb-rendus-video");
      deja.forEach(x => {
        const c = pgEl("button", "", '<video src="' + pgUrlVideo(x.id, "extrait") + '" preload="metadata" muted playsinline></video><span>' + pgDuree(x.duree) + "</span><small>" + echapper((x.note || x.nom || "").slice(0, 26)) + "</small>");
        c.type = "button"; c.title = x.note || x.nom || "";
        c.onclick = () => { s.video = { id: x.id, de: 0, a: Math.min(x.duree, 15), plein: false, son: false }; PG.sbVideo = null; pgSauverPlanBientot(); pgRendre(); };
        gd.appendChild(c);
      });
      b.appendChild(gd);
    }
    // OU UN GIF (30 sept. 2026) : la bibliothèque du studio, l'import, GIPHY — il se pose dans sa carte « Toi.GIF »
    b.appendChild(pgBlocGifs(s, recue, echec));
    return b;
  }
  const v = s.video;
  if (v.gif != null) return pgBlocGifPose(s, v, info, b);
  const tete = pgEl("div", "pg-sb-image-tete", "<span>" + echapper((info.nom || "Vidéo").slice(0, 40)) +
    '<span class="pg-sb-badge">' + pgDuree(v.a - v.de) + " gardées sur " + pgDuree(info.duree) + "</span>" + (v.plein ? '<span class="pg-sb-badge plein">plein cadre</span>' : "") + "</span>");
  const ote = pgEl("button", "pg-plan-outil", "×"); ote.type = "button"; ote.title = "Changer de vidéo"; ote.setAttribute("aria-label", ote.title);
  ote.onclick = () => { PG.videosDeCote = PG.videosDeCote || {}; delete s.video; PG.sbVideo = s.id; pgSauverPlanBientot(); pgRendre(); };
  tete.appendChild(ote);
  b.appendChild(tete);
  const regl = pgEl("div", "pg-sb-reglages");
  const mini = (options, valeur, choisir) => {
    const g = pgEl("div", "pg-sb-mini");
    options.forEach(([val, nom, aide, off]) => {
      const x = pgEl("button", val === valeur ? "on" : "", nom); x.type = "button"; if (aide) x.title = aide; if (off) x.disabled = true;
      x.onclick = () => { choisir(val); pgSauverPlanBientot(); pgRendre(); };
      g.appendChild(x);
    });
    return g;
  };
  regl.appendChild(mini([[false, "Posée", "Dans la mise en page, comme une photo : rien ne passe dessus"], [true, "Plein cadre", "Elle remplit la " + F.une + " ; le texte se pose dessus"]], !!v.plein, val => { v.plein = val; }));
  regl.appendChild(mini([[false, "Muet", "Instagram lance les carrousels sans le son"], [true, "Garder le son", info.son ? "Pour une voix ou une démo" : "Cette vidéo n'a pas de son", !info.son]], !!v.son, val => { v.son = val; }));
  b.appendChild(regl);
  /* LA FORME DU CADRE (posée) — (27 sept. 2026) : « la vidéo entière, pas coupée sur les côtés ».
     « Libre » : Claude choisit le cadre, la vidéo s'y recadre. « Forme de la vidéo » : le cadre prend ses proportions exactes
     (coins arrondis gardés) — la slide déjà composée est recomposée par Claude, elle seule (une minute, gratuit). */
  if (!v.plein) {
    const k = PG.pub.plan.slides.indexOf(s), composee = !!(PG.deck && (PG.deck.slides || [])[k]);
    const forme = pgEl("div", "pg-sb-reglages pg-sb-forme", '<span class="pg-sb-forme-etq">Le cadre</span>');
    if (PG.sbRecompose === s.id) forme.appendChild(pgEl("span", "pg-sb-aide", "Claude recompose cette " + F.une + " autour de la vidéo… (une minute environ)"));
    else forme.appendChild(mini([["libre", "Libre", "Claude choisit le cadre ; la vidéo s'y recadre (glissez le rectangle)"], ["video", "Forme de la vidéo", "Le cadre prend les proportions de la vidéo : elle se voit entière, coins arrondis gardés"]],
      v.forme === "video" ? "video" : "libre", val => {
        v.forme = val;
        if (!composee) return;
        PG.sbRecompose = s.id;
        (async () => {
          try {
            await pgSyncPub({ plan: PG.pub.plan, titre: PG.pub.titre });
            const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/slides/" + (k + 1), { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ remarque: val === "video" ? "Le cadre de la vidéo prend EXACTEMENT les proportions de la vidéo, pour qu'elle se voie entière ; coins arrondis. Le reste de la slide s'organise autour." : "Le cadre de la vidéo reprend la forme qui sert le mieux la composition ; coins arrondis." }) })).json();
            if (r.erreur) throw new Error(r.erreur);
            PG.deck = r.deck; PG.exporte = null; PG.version++;
          } catch (err) { pgDire("La " + F.une + " n'a pas pu être recomposée : " + (err.message || err)); }
          PG.sbRecompose = null; pgRendre();
        })();
      }));
    b.appendChild(forme);
  }
  b.appendChild(pgPellicule(s, info));
  return b;
}
/* Le moment gardé : la pellicule (des images de la vidéo), une fenêtre à glisser et ses deux bords à tirer, et l'aperçu qui
   ne joue que ce moment. Relâcher : le serveur refait l'extrait et l'image (couperVideoPub), puis le plan s'enregistre. */
function pgPellicule(s, info) {
  const v = s.video, z = pgEl("div", "pg-sb-pellicule");
  const ap = pgEl("video", "pg-sb-pel-apercu"); ap.src = pgUrlVideo(v.id, "apercu"); ap.muted = true; ap.playsInline = true; ap.autoplay = true;
  const film = pgEl("div", "pg-sb-film", '<canvas width="960" height="96"></canvas><i class="g"></i><i class="d"></i><b><span class="pg"></span><span class="pd"></span></b><em></em>');
  const temps = pgEl("div", "pg-sb-temps");
  z.append(pgCadrage(s, ap), film, temps);
  const D = info.duree, pct = x => (x / D * 100) + "%";
  const maj = () => {
    film.querySelector("i.g").style.width = pct(v.de); film.querySelector("i.d").style.left = pct(v.a);
    const f = film.querySelector("b"); f.style.left = pct(v.de); f.style.width = pct(v.a - v.de);
    temps.innerHTML = "<span>début <b>" + v.de.toFixed(1) + " s</b></span><span>gardé <b>" + (v.a - v.de).toFixed(1) + " s</b> <small>(60 s au plus ; 15 s conseillées)</small></span><span>fin <b>" + v.a.toFixed(1) + " s</b></span>";
  };
  maj();
  // la pellicule : douze images tirées de l'aperçu (même origine : le canvas se lit sans souci)
  const cv = film.querySelector("canvas"), ctx = cv.getContext("2d"), tireur = document.createElement("video");
  tireur.src = pgUrlVideo(v.id, "apercu"); tireur.muted = true; tireur.preload = "auto";
  tireur.onloadedmetadata = async () => {
    const n = 12, w = cv.width / n;
    for (let i = 0; i < n; i++) {
      await new Promise(ok => { tireur.onseeked = ok; tireur.currentTime = (i + 0.5) / n * tireur.duration; });
      const r = tireur.videoWidth / tireur.videoHeight, ww = cv.height * r;
      ctx.drawImage(tireur, (i * w) + (w - ww) / 2, 0, ww, cv.height);
    }
  };
  // l'aperçu boucle sur le moment gardé ; la tête de lecture suit
  const tete = film.querySelector("em");
  const boucle = () => { if (!z.isConnected) return; if (ap.currentTime < v.de || ap.currentTime >= v.a) ap.currentTime = v.de; tete.style.left = pct(ap.currentTime); requestAnimationFrame(boucle); };
  ap.onloadedmetadata = () => { ap.currentTime = v.de; requestAnimationFrame(boucle); };
  let prise = null;
  film.onpointerdown = ev => {
    const r = film.getBoundingClientRect(), t = (ev.clientX - r.left) / r.width * D;
    prise = ev.target.classList.contains("pg") ? { k: "de" } : ev.target.classList.contains("pd") ? { k: "a" } : ev.target.tagName === "B" ? { k: "tout", dt: t - v.de } : null;
    if (prise) { film.setPointerCapture(ev.pointerId); ev.preventDefault(); }
  };
  film.onpointermove = ev => {
    if (!prise) return;
    const r = film.getBoundingClientRect(), t = Math.max(0, Math.min(D, (ev.clientX - r.left) / r.width * D)), arr = x => Math.round(x * 10) / 10;
    if (prise.k === "de") { v.de = arr(Math.min(t, v.a - 0.5)); if (v.a - v.de > 60) v.a = v.de + 60; }
    else if (prise.k === "a") { v.a = arr(Math.max(t, v.de + 0.5)); if (v.a - v.de > 60) v.de = v.a - 60; }
    else { const d = v.a - v.de; v.de = arr(Math.max(0, Math.min(D - d, t - prise.dt))); v.a = arr(v.de + d); }
    maj(); ap.currentTime = v.de;
  };
  film.onpointerup = async () => {
    if (!prise) return; prise = null;
    temps.insertAdjacentHTML("beforeend", '<span class="pg-sb-temps-maj">mise à jour de l\'aperçu…</span>');
    try {
      const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/video-couper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id, de: v.de, a: v.a }) })).json();
      if (r.erreur) throw new Error(r.erreur);
      v.de = r.de; v.a = r.a;
      PG.videoV = PG.videoV || {}; PG.videoV[v.id] = Date.now();   // les vignettes relisent l'extrait
    } catch (err) { pgDire("L'aperçu n'a pas pu suivre : " + (err.message || err)); }
    pgSauverPlanBientot(); pgRendre();
  };
  return z;
}

/* LE CADRAGE (27 sept. 2026, demandé par ) : la vidéo
   entière, et par-dessus un rectangle aux proportions de son cadre dans la slide, qu'on glisse. s.video.cadrage = { x, y }
   en % (object-position) : les vignettes et la grande vue suivent en direct ; l'export recadre pareil (exporterSlideVideo). */
function pgRatioCadre(s) {
  const F = PG_FORMATS[PG.genre], k = PG.pub.plan.slides.indexOf(s), id = s.video.id;
  if (s.video.plein) return F.l / F.h;
  // la slide composée : le cadre réel de la vidéo, lu dans la page de la slide (même origine)
  for (const f of document.querySelectorAll('#pg-sb-fenetre iframe[src*="/slide/' + (k + 1) + '?"]')) {
    try { const e = f.contentDocument && f.contentDocument.querySelector('video[src*="' + id + '-extrait"]'); if (e) { const r = e.getBoundingClientRect(); if (r.width && r.height) return r.width / r.height; } } catch (err) {}
  }
  const c = document.querySelector("#pg-sb-fenetre .pg-cf-slide.ici .pg-cq-video");   // le croquis
  if (c) { const r = c.getBoundingClientRect(); if (r.width && r.height) return r.width / r.height; }
  return 1;
}
function pgAppliquerCadrage(s) {
  const k = PG.pub.plan.slides.indexOf(s), id = s.video.id, c = s.video.cadrage || { x: 50, y: 50 }, pos = c.x + "% " + c.y + "%";
  document.querySelectorAll('iframe[src*="/slide/' + (k + 1) + '?"]').forEach(f => {
    try { const e = f.contentDocument && f.contentDocument.querySelector('video[src*="' + id + '-extrait"]'); if (e) e.style.setProperty("object-position", pos, "important"); } catch (err) {}
  });
  document.querySelectorAll('.pg-cq-video video[src*="' + id + '-extrait"]').forEach(e => { e.style.objectPosition = pos; });
}
function pgCadrage(s, ap) {
  const v = s.video, boite = pgEl("div", "pg-sb-cadrage"), rect = pgEl("div", "pg-sb-recadre"), aide = pgEl("p", "pg-sb-aide pg-sb-cadrage-aide", "");
  v.cadrage = v.cadrage || { x: 50, y: 50 };
  boite.append(ap, rect);
  const tout = pgEl("div", "pg-sb-cadrage-zone"); tout.append(boite, aide);
  let G = null;   // la géométrie : taille affichée de la vidéo, taille du rectangle, sens du déplacement
  const poser = () => {
    if (!G) return;
    rect.style.width = G.w + "px"; rect.style.height = G.h + "px";
    rect.style.left = (G.W - G.w) * v.cadrage.x / 100 + "px"; rect.style.top = (G.H - G.h) * v.cadrage.y / 100 + "px";
  };
  const mesurer = () => {
    if (!ap.videoWidth || !boite.isConnected) return;
    const rv = ap.videoWidth / ap.videoHeight, rf = pgRatioCadre(s);
    const H = Math.min(240, Math.round((boite.parentNode.clientWidth || 300) / rv)), W = Math.round(H * rv);
    ap.style.width = W + "px"; ap.style.height = H + "px"; boite.style.width = W + "px"; boite.style.height = H + "px";
    if (Math.abs(rf - rv) < 0.02) { G = null; rect.hidden = true; aide.textContent = "La vidéo a déjà les proportions de son cadre : elle se voit en entier, rien à recadrer."; return; }
    rect.hidden = false;
    G = rf > rv ? { W, H, w: W, h: Math.round(W / rf), sens: "y" } : { W, H, w: Math.round(H * rf), h: H, sens: "x" };
    aide.innerHTML = "<b>Le cadrage</b> — glissez le rectangle " + (G.sens === "y" ? "vers le haut ou le bas" : "vers la gauche ou la droite") + " : c'est la partie de la vidéo qui se verra dans la slide.";
    poser();
  };
  ap.addEventListener("loadedmetadata", () => { mesurer(); setTimeout(mesurer, 900); setTimeout(mesurer, 2500); });   // la slide composée se charge après
  let prise = null;
  rect.onpointerdown = ev => { if (!G) return; prise = { x: ev.clientX, y: ev.clientY, cx: v.cadrage.x, cy: v.cadrage.y }; rect.setPointerCapture(ev.pointerId); ev.preventDefault(); };
  rect.onpointermove = ev => {
    if (!prise || !G) return;
    if (G.sens === "y") v.cadrage.y = Math.max(0, Math.min(100, Math.round(prise.cy + (ev.clientY - prise.y) / (G.H - G.h) * 100)));
    else v.cadrage.x = Math.max(0, Math.min(100, Math.round(prise.cx + (ev.clientX - prise.x) / (G.W - G.w) * 100)));
    poser(); pgAppliquerCadrage(s);
  };
  rect.onpointerup = () => { if (!prise) return; prise = null; pgSauverPlanBientot(); };
  return tout;
}

/* Une image importée : la déposer (ou reprendre une image déjà déposée), puis la nommer. Elle rejoint
   les médias de la publication — marquée « plan », pour ne pas passer pour une réponse du parcours. */
function pgDeposerVisuel(s, v, m) {
  const zone = pgEl("div", "pg-sb-mienne");
  const envoyer = async f => {
    if (!f || !/^image\//.test(f.type)) return;
    zone.classList.add("envoi");
    try {
      const avant = (PG.d.medias || []).map(x => x.fichier);
      PG.d.medias.push({ nom: pgNomImporte(f.name), note: "", donnees: await pgLireFichier(f), origine: "plan" });
      await pgSyncPub({ plan: PG.pub.plan, titre: PG.pub.titre });
      const neuf = (PG.d.medias || []).find(x => !x.illustration && !avant.includes(x.fichier));
      if (neuf) v.fichier = neuf.fichier;
      pgSauverPlanBientot(); pgDire("");
    } catch (err) {
      PG.d.medias = (PG.d.medias || []).filter(x => !x.donnees);
      pgDire("Cette image n'a pas pu être ajoutée : " + (err.message || err));
    }
    pgRendre();
  };
  const entree = () => { const i = pgEl("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp"; i.onchange = () => envoyer(i.files[0]); return i; };
  if (m && m.fichier) {
    // Le NOM de l'image se modifie sur place : un nom de fichier d'appareil ou de plateforme ne dit rien.
    const d = pgEl("div", "pg-sb-depose", '<i class="' + (m.detoure ? "pg-damier" : "") + '"></i>');
    d.querySelector("i").style.setProperty("--img", "url('" + pgUrlPub("medias", m.fichier) + "')");
    const nom = pgEl("input", "pg-champ pg-sb-nom"); nom.type = "text"; nom.maxLength = 60; nom.value = m.nom || ""; nom.placeholder = "Le nom de cette image"; nom.title = "Renommer cette image";
    nom.oninput = () => { m.nom = nom.value; pgSauverPlanBientot(); };
    nom.onblur = () => { if (!nom.value.trim()) { m.nom = "Mon image"; nom.value = m.nom; pgSauverPlanBientot(); } };
    const l = pgEl("label", "pg-sb-lien", "Changer"); l.appendChild(entree());
    d.append(nom, l, pgBoutonFond(m));
    zone.appendChild(d);
    return zone;
  }
  if (v.fichier) zone.appendChild(pgEl("p", "pg-sb-aide", "Cette image n'est plus dans la publication : déposez-la de nouveau, ou choisissez-en une autre."));
  const depot = pgEl("label", "pg-sb-depot", "Déposez votre image ici, ou cliquez pour la choisir — gratuite, rien à générer.");
  depot.appendChild(entree());
  depot.ondragover = e => { e.preventDefault(); depot.classList.add("survol"); };
  depot.ondragleave = () => depot.classList.remove("survol");
  depot.ondrop = e => { e.preventDefault(); depot.classList.remove("survol"); envoyer(e.dataTransfer.files[0]); };
  zone.appendChild(depot);
  // Les images déjà déposées dans la publication : on les reprend d'un clic.
  const deja = (PG.d.medias || []).filter(x => !x.illustration && !x.videoId && x.fichier);
  if (deja.length) {
    zone.appendChild(pgEl("p", "pg-sb-aide", "Ou reprenez une image déjà déposée :"));
    const g = pgEl("div", "pg-sb-deja");
    deja.forEach(x => {
      const b = pgEl("button", "", '<i style="background-image:url(\'' + pgUrlPub("medias", x.fichier) + '\')"></i><span>' + echapper((x.nom || "").slice(0, 28)) + "</span>"); b.type = "button";
      b.onclick = () => { v.fichier = x.fichier; pgSauverPlanBientot(); pgRendre(); };
      g.appendChild(b);
    });
    zone.appendChild(g);
  }
  return zone;
}
// Un nom lisible par défaut : sans extension ; un nom de caméra ou de plateforme devient « Mon image N ».
function pgNomImporte(fichier) {
  const base = String(fichier || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim();
  const machinal = /\d{6,}|[0-9a-f]{8}\s?[0-9a-f]{4}|^(img|dsc|pxl|photo|image|screenshot|capture)\b/i.test(base) || base.length > 40;
  if (!base || machinal) return "Mon image " + ((PG.d.medias || []).filter(x => x.origine === "plan").length + 1);
  return base.charAt(0).toUpperCase() + base.slice(1);
}






/* La barre du bas : les images de la publication (Storymatic ne génère rien : ta banque, ta matière, tes captures). */
function pgBlocIllustrations(c) {
  const slides = PG.pub.plan.slides;
  const miennes = slides.reduce((a, s) => a + pgVisuels(s).filter(v => v.source === "mienne").length, 0);
  const manquent = slides.reduce((a, s) => a + pgVisuels(s).filter(v => v.source === "mienne" && !(v.fichier && pgMediaDeFichier(v.fichier))).length, 0);
  const barre = pgEl("div", "pg-sb-barre");
  barre.appendChild(pgEl("p", "pg-sb-barre-txt", miennes ? miennes + " de tes images" + (manquent ? " (" + manquent + " à déposer)" : "") : "Aucune image : le texte porte tout."));
  c.appendChild(barre);
}



/* SUPPRIMER LE FOND d'une image (un personnage, un produit) : il n'en reste que le sujet, en PNG transparent,
   et la slide n'a plus ni carré ni bord à fondre. Higgsfield le fait, contre des crédits : le prix est
   demandé puis confirmé. L'image d'origine est gardée — « Remettre le fond » et un second « Supprimer le
   fond » sont gratuits. `dire(message)` reçoit l'avancement ; rend le média à jour, ou null. */
const pgMediaDeFichier = f => (PG.d.medias || []).find(m => m.fichier === f) || null;
function pgMediaDeSrc(src) {
  let f = String(src || "").split("?")[0].split("/").pop();
  try { f = decodeURIComponent(f); } catch (_) {}
  return pgMediaDeFichier(f);
}
function pgApresFond(r) {
  PG.pub = r.pub; if (r.deck) PG.deck = r.deck;
  pgMediasDepuis(r.pub); PG.exporte = null; PG.version++;
  pgSauver();
}
async function pgBasculerFond(fichier, mode) {
  const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/fond", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fichier: fichier, mode: mode }) })).json();
  if (!r || r.erreur || !r.pub) throw new Error((r && r.erreur) || "Le studio n'a pas répondu.");
  const avant = pgMediaDeFichier(fichier), rang = avant ? PG.d.medias.indexOf(avant) : -1;
  pgApresFond(r);
  return rang >= 0 ? PG.d.medias[rang] : null;
}
/* `methode` ('uni' ou 'ia') : REFAIRE sur l'ordinateur avec une méthode imposée, sans fenêtre de choix et
   sans reprendre la version détourée gardée. Sinon le serveur choisit tout seul (fond uni si les bords de
   l'image sont d'une couleur, sinon l'IA). */
async function pgDetourer(fichier, dire, methode) {
  const m = pgMediaDeFichier(fichier);
  if (!m || PG.detourage) return null;
  dire = dire || (() => {});
  if (m.sansFond && !methode) return pgBasculerFond(fichier, "sans");        // déjà payé une fois : la version détourée existe
  PG.detourage = true;
  try {
    // Storymatic : toujours sur l'ordinateur, gratuit (aucune plateforme payante)
    dire("Suppression du fond sur votre ordinateur…");
    let fin = null;
    await pgLireFlux("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/detourer", ev => {
      if (ev.t === "etape") dire(ev.message);
      if (ev.t === "fin") fin = ev;
    }, { fichier: fichier, methode: methode || undefined });
    if (!fin || !fin.pub) throw new Error("Le détourage n'a pas abouti.");
    const rang = PG.d.medias.indexOf(m);
    pgApresFond(fin);
    dire("");
    return PG.d.medias[rang] || null;
  } finally { PG.detourage = false; }
}
/* REFAIRE LE DÉTOURAGE AVEC L'AUTRE MÉTHODE (27 sept. 2026) : « fond uni » est exact pour un objet ou une
   carte posés sur une seule couleur, l'IA pour un sujet sur un vrai décor ; le choix automatique peut se
   tromper. On remet l'image d'origine, puis on recalcule sur l'ordinateur (gratuit). Rend le média neuf. */
const pgAutreMethodeFond = m => m && m.methodeFond === "uni" ? "ia" : "uni";
function pgLibelleAutreFond(m) {
  return pgAutreMethodeFond(m) === "ia" ? "Refaire par l'IA" : "Refaire en fond uni";
}
function pgTitreAutreFond(m) {
  return pgAutreMethodeFond(m) === "ia"
    ? "Recalculer avec l'IA, qui cherche le sujet de la photo : pour une personne ou un objet devant un vrai décor. Gratuit, sur votre ordinateur."
    : "Recalculer en retirant la couleur unie qui touche les bords (le blanc autour d'un objet ou d'une carte) : net, sans halo. Gratuit, sur votre ordinateur.";
}
async function pgRefaireFond(m, dire) {
  const methode = pgAutreMethodeFond(m);
  let cible = m;
  if (m.detoure) cible = await pgBasculerFond(m.fichier, "avec");
  if (!cible) throw new Error("L'image d'origine est introuvable.");
  return pgDetourer(cible.fichier, dire, methode);
}
// Le bouton, à l'étape des médias et dans le plan : « Supprimer le fond » ou « Remettre le fond ».
function pgBoutonFond(m) {
  const b = pgEl("button", "btn-mini", m.detoure ? "Remettre le fond" : "Supprimer le fond"); b.type = "button";
  b.title = m.detoure ? "Revenir à l'image d'origine (gratuit)"
          : m.sansFond ? "La version détourée existe déjà : gratuit"
          : "Ne garder que le personnage ou l'objet, sur fond transparent. Gratuit, sur votre ordinateur.";
  if (!m.fichier || PG.detourage) b.disabled = true;
  const dire = msg => { if (msg) { if (PG.occupe) pgMajAttente(msg); else { PG.occupeSous = "Moins d'une minute en général."; pgOccuper(msg); pgRendre(); } } else if (PG.occupe) { pgLiberer(); pgRendre(); } };
  b.onclick = async () => {
    if (PG.occupe) return;
    try {
      if (m.detoure) await pgBasculerFond(m.fichier, "avec");
      else await pgDetourer(m.fichier, dire);
      pgLiberer(); pgDire("");
    } catch (err) { pgLiberer(); pgDire("Le fond n'a pas pu être " + (m.detoure ? "remis" : "supprimé") + " : " + (err.message || err)); }
    pgRendre();
  };
  // Détouré sur l'ordinateur ou par Higgsfield : on peut refaire avec l'autre méthode, gratuitement.
  if (!(m.detoure && DETOURAGE_LOCAL)) return b;
  const r = pgEl("button", "btn-mini", pgLibelleAutreFond(m)); r.type = "button";
  r.title = pgTitreAutreFond(m);
  if (PG.detourage) r.disabled = true;
  r.onclick = async () => {
    if (PG.occupe) return;
    try { await pgRefaireFond(m, dire); pgLiberer(); pgDire(""); }
    catch (err) { pgLiberer(); pgDire("Le détourage n'a pas pu être refait : " + (err.message || err)); }
    pgRendre();
  };
  const frag = document.createDocumentFragment();
  frag.append(b, r);
  return frag;
}

// Après une génération, le serveur fait foi : les médias du brouillon sont ceux de la publication.
function pgMediasDepuis(pub) {
  PG.d.medias = (pub.medias || []).map(m => {
    const avant = (PG.d.medias || []).find(x => x.fichier === m.fichier) || {};
    return { fichier: m.fichier, nom: m.nom, note: m.note, rendu: avant.rendu || m.rendu, illustration: !!m.illustration, slideId: m.slideId, fond: m.fond, refsSig: m.refsSig, cadre: m.cadre,
             detoure: !!m.detoure, avecFond: m.avecFond, sansFond: m.sansFond, methodeFond: m.methodeFond, origine: m.origine, videoId: m.videoId };
  });
}

/* ---------- Les slides ---------- */

// Les slides composées reflètent-elles encore le plan ? On compare les textes,
// sans s'arrêter à une espace en trop.
function pgDeckPerime() {
  if (!PG.deck || !PG.deck.plan || !PG.pub || !PG.pub.plan) return false;
  let avant = [];
  try { avant = JSON.parse(PG.deck.plan); } catch (e) { return false; }
  if (avant.length !== PG.pub.plan.slides.length) return true;
  return PG.pub.plan.slides.some((_, k) => !pgSlideAJour(k));
}

// Lit un flux d'événements du serveur (data: {...}) jusqu'à sa fin.
async function pgLireFlux(adresse, surEvenement, corps, signal) {
  const r = await fetch(adresse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps || {}), signal: signal });
  if (!r.ok || !r.body) throw new Error("Le studio n'a pas répondu.");
  const lecteur = r.body.getReader(), dec = new TextDecoder();
  let reste = "";
  while (true) {
    const { done, value } = await lecteur.read();
    if (done) break;
    reste += dec.decode(value, { stream: true });
    const morceaux = reste.split("\n\n");
    reste = morceaux.pop();
    for (const mo of morceaux) {
      const ligne = mo.split("\n").find(x => x.startsWith("data: "));
      if (!ligne) continue;
      let ev; try { ev = JSON.parse(ligne.slice(6)); } catch (_) { continue; }
      if (ev.t === "erreur") { const e = new Error(ev.message || "Erreur"); e.refus = !!ev.refus; throw e; }
      surEvenement(ev);
    }
  }
}

async function pgComposer() {
  if (PG.occupe) return;
  const F = PG_FORMATS[PG.genre];
  pgDire("");
  pgOccuper("Claude prépare la mise en page…");
  pgRendre();
  try {
    await pgSyncPub({ plan: PG.pub.plan, titre: PG.pub.titre });
    PG.annuler = new AbortController();
    await pgLireFlux("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/composer", ev => {
      if (ev.t === "activite") pgMajAttente(ev.message);
      if (ev.t === "avancee") pgMajAttente(ev.fait >= ev.total ? "Dernières finitions…" : "Claude compose la " + F.une + " " + (ev.fait + 1) + " sur " + ev.total + "…");
      if (ev.t === "fin") { PG.deck = ev.deck; PG.exporte = null; PG.version++; }
    }, {}, PG.annuler.signal);
  } catch (err) { pgDire(err && err.name === "AbortError" ? "Mise en page annulée. Votre plan et vos images sont intacts." : "La mise en page n'a pas abouti : " + (err.message || err)); }
  PG.annuler = null;
  pgLiberer();
  if (PG.etape === 4) pgRendre();
}

async function pgExporter() {
  if (PG.occupe) return;
  const F = PG_FORMATS[PG.genre];
  pgDire("");
  pgOccuper("Le studio photographie les " + F.des + "…");
  pgRendre();
  try {
    await pgLireFlux("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/exporter", ev => {
      if (ev.t === "avancee") pgMajAttente("Le studio photographie la " + F.une + " " + ev.fait + " sur " + ev.total + "…");
      if (ev.t === "fin") PG.exporte = ev.export;
    });
  } catch (err) { pgDire("L'export n'a pas abouti : " + (err.message || err)); }
  pgLiberer();
  if (PG.etape === 4) pgRendre();
}

const pgUrlSlide = n => "/pub/" + PROJET.id + "/" + PG.d.pubId + "/slide/" + n + "?v=" + PG.version;

// Une slide, en vignette : la vraie page, réduite. Un voile prend le clic.
function pgVignetteSlide(n, largeur) {
  const F = PG_FORMATS[PG.genre], k = largeur / F.l;
  const b = pgEl("button", "pg-slide");
  b.type = "button";
  b.style.width = largeur + "px"; b.style.height = Math.round(F.h * k) + "px";
  b.innerHTML = '<iframe sandbox="allow-same-origin" loading="lazy" tabindex="-1" scrolling="no" src="' + pgUrlSlide(n) + '" ' +
    'style="width:' + F.l + "px;height:" + F.h + "px;transform:scale(" + k + ')"></iframe>' +
    (PG.genre === "stories" ? '<span class="pg-zone pg-zone-h"></span><span class="pg-zone pg-zone-b"></span>' : "") +
    '<span class="pg-slide-voile"><span>' + String(n).padStart(2, "0") + " · corriger</span></span>";
  b.onclick = () => pgOuvrirLoupe(n);
  return b;
}

function pgESlides(c) {
  const F = PG_FORMATS[PG.genre], st = PG.genre === "stories";
  if (PG.occupe) {
    pgAttente(c, PG.occupeSous ? PG.occupeSous : PG.occupe.indexOf("photographie") >= 0 ? "Quelques secondes." : "Deux à cinq minutes : Claude dessine chaque " + F.une + " à votre DA. Aucun crédit n'est dépensé. L'écran dit ce qu'il fait ; s'il se tait quatre minutes, le studio l'arrête de lui-même.");
    if (PG.annuler) {
      const stop = pgEl("button", "pg-btn", "Annuler la mise en page"); stop.type = "button";
      stop.onclick = () => { if (PG.annuler) PG.annuler.abort(); };
      c.appendChild(stop);
    }
    return;
  }
  if (!PG.deck || !(PG.deck.slides || []).length) {
    const n = PG.pub && PG.pub.plan ? PG.pub.plan.slides.length : 0;
    const b = pgEl("button", "pg-btn pg-btn-go", "Créer les " + n + " " + F.des); b.type = "button";
    b.disabled = !n;
    b.onclick = pgComposer;
    c.appendChild(b);
    c.appendChild(pgEl("p", "pg-gratuit", "Aucun crédit de génération : les " + F.des + " sont composées par Claude, à votre DA."));
    return;
  }

  const perime = pgDeckPerime();
  if (perime || PG.deck.avertissement) {
    const a = pgEl("div", "pg-avis", "<span>" + echapper(perime ? "Le plan a changé depuis cette mise en page." : PG.deck.avertissement) + "</span>");
    c.appendChild(a);
  }
  /* Le contrôle géométrique a mesuré les slides dans un vrai navigateur. Quand il reste un
     défaut après la passe de correction, on le dit : mieux vaut une phrase franche qu'une
     slide illisible découverte à l'export. */
  if (PG.deck.controle && PG.deck.controle !== "ok") {
    c.appendChild(pgEl("div", "pg-avis", "<span>" + echapper(PG.deck.controle) + "</span>"));
  }

  const planche = pgEl("div", "pg-planche");
  PG.deck.slides.forEach((_, k) => planche.appendChild(pgVignetteSlide(k + 1, st ? 150 : 190)));
  c.appendChild(planche);
  if (st) c.appendChild(pgAstuce("Les bandes hachurées sont celles que l'interface d'Instagram recouvre : elles n'apparaissent pas à l'export, et le studio n'y place jamais de texte."));

  const actions = pgEl("div", "pg-slides-actions");
  const sm = true;   // Storymatic : l'export se fait pour la semaine entière (« Ma semaine »), pas jour par jour
  if (!sm) {
    const exp = pgEl("button", "pg-btn pg-btn-go", PG.exporte ? "Exporter à nouveau" : "Exporter les images"); exp.type = "button";
    exp.onclick = pgExporter;
    actions.appendChild(exp);
  }
  const refaire = pgEl("button", "pg-btn", "Tout recomposer"); refaire.type = "button";
  refaire.onclick = async () => {
    if (!await demander(null, { titre: "Tout recomposer ?", html: "<p>Claude redessine toutes les " + F.des + " à partir du plan. Les corrections faites à la main dans les " + F.des + " actuelles seront perdues ; le plan, lui, ne change pas.</p>", ok: "Recomposer" })) return;
    pgComposer();
  };
  actions.appendChild(refaire);
  c.appendChild(actions);

  if (PG.exporte && !sm) {
    const e = pgEl("div", "pg-export");
    e.innerHTML = '<span class="pg-export-titre">' + (st ? "Vos stories sont terminées" : "Votre carrousel est terminé") + " ✓</span>" +
      "<span><b>" + PG.exporte.images.length + " image" + (PG.exporte.images.length > 1 ? "s" : "") + "</b>" +
      ((PG.exporte.videos || []).length ? " et <b>" + PG.exporte.videos.length + " vidéo" + (PG.exporte.videos.length > 1 ? "s" : "") + "</b> (MP4, muettes sauf si vous gardez le son)" : "") +
      " en " + F.l + " × " + F.h + " px, numérotées dans l'ordre de publication" +
      (PG.exporte.date ? ", exportées le " + new Date(PG.exporte.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " à " + new Date(PG.exporte.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "") +
      ". Une retouche la remet en cours : il suffira d'exporter à nouveau.</span>";
    const ligne = pgEl("div", "pg-puces");
    const zip = pgEl("a", "pg-btn pg-btn-go", "Télécharger le .zip"); zip.href = PG.exporte.zip; zip.download = PG.exporte.nomZip;
    const dossier = pgEl("button", "pg-btn", "Ouvrir le dossier"); dossier.type = "button";
    dossier.onclick = () => fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/ouvrir-dossier", { method: "POST" });
    ligne.appendChild(zip); ligne.appendChild(dossier);
    const leg = PG.pub && PG.pub.plan && PG.pub.plan.legende;
    if (leg) {
      const cp = pgEl("button", "pg-btn", "Copier la légende"); cp.type = "button";
      cp.onclick = async () => { try { await navigator.clipboard.writeText(leg); cp.textContent = "Légende copiée ✓"; } catch (err) { informer(leg, { titre: "La légende du post" }); } };
      ligne.appendChild(cp);
    }
    e.appendChild(ligne);
    const suite = pgEl("div", "pg-puces");
    const finir = pgEl("button", "pg-btn", "Terminer et revenir à l'accueil"); finir.type = "button";
    finir.onclick = pgTerminer;
    const autre = pgEl("button", "pg-btn pg-btn-fantome", st ? "Créer d'autres stories" : "Créer un autre carrousel"); autre.type = "button";
    autre.onclick = () => { const g = PG.genre; pgOublier(g); pgOuvrir(g, { neuf: true }); };
    suite.appendChild(finir); suite.appendChild(autre);
    e.appendChild(suite);
    c.insertBefore(e, c.firstChild);          // la fin d'abord : c'est ce qu'on vient chercher
  }
}

// La publication est exportée : son brouillon n'a plus lieu d'être, elle vit dans « Vos carrousels et stories ».
function pgTerminer() { pgOublier(PG.genre); rendreAccueil(); }

/* ---------- La loupe : une slide en grand ---------- */

/* La slide qu'on retouche est au centre, nette et droite. Ses voisines se
   rangent de part et d'autre, couchées en perspective et floutées : on voit
   d'où l'on vient et où l'on va sans quitter l'éditeur. Mis au point dans
   LABO/carrousel-3d/, famille « Cover Flow », réglages validés le 22 sept. 2026.

   DEUX VOISINES DE CHAQUE CÔTÉ, pas plus, et montées à la demande : un
   carrousel peut aller jusqu'à vingt slides, et chaque slide est une iframe.
   Celles qui sortent de la fenêtre sont démontées ; celles qui y entrent sont
   fabriquées une fois et gardées, pour qu'un aller-retour ne recharge rien. */
const PG_CF = { voisines: 2, angle: 38, ecart: 54, recul: 190, echelle: .78, flou: 3.4, ombre: .55, perspective: 1700 };

let pgLoupeN = 0;
let pgCF = { montees: new Map(), plateau: null, liee: null };   // numéro → { cadre, iframe }

function pgOuvrirLoupe(n) {
  $("pg-loupe").hidden = false;
  document.body.classList.add("visionneuse-ouverte");

  const scene = $("pg-loupe-scene");
  scene.innerHTML = "";
  scene.classList.add("pg-cf");
  pgCF = { montees: new Map(), plateau: pgEl("div", "pg-cf-plateau"), liee: null };
  scene.appendChild(pgCF.plateau);

  const fleche = (sens, titre, d) => {
    const b = pgEl("button", "pg-cf-fleche pg-cf-" + sens,
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>');
    b.type = "button"; b.title = titre; b.setAttribute("aria-label", titre);
    b.onclick = () => pgLoupeAller(pgLoupeN + (sens === "avant" ? -1 : 1));
    scene.appendChild(b);
    return b;
  };
  pgCF.avant = fleche("avant", "Précédente (←)", "M15 5l-7 7 7 7");
  pgCF.apres = fleche("apres", "Suivante (→)", "M9 5l7 7-7 7");

  pgCF.rang = pgEl("div", "pg-cf-rang");
  PG.deck.slides.forEach((_, i) => {
    const p = pgEl("i");
    p.onclick = () => pgLoupeAller(i + 1);
    pgCF.rang.appendChild(p);
  });
  scene.appendChild(pgCF.rang);

  /* On pose la slide DIRECTEMENT, sans passer par pgLoupeAller : celle-ci demande
     « changer sans enregistrer ? » si l'éditeur se dit modifié. Après un « Fermer sans
     enregistrer », il le restait : la loupe se rouvrait sur cette question, VIDE, et un
     « Rester ici » la laissait sans slide, le panneau figé sur l'ancienne (23 sept. 2026). */
  pgEdOublier();
  pgLoupeN = n;
  pgLoupePanneau();
  pgCFPlacer();
}

// L'éditeur lâche la slide qu'il tenait : plus rien de « modifié », plus de sélection.
function pgEdOublier() {
  if (typeof ED === "undefined") return;
  Object.assign(ED, { cadre: null, doc: null, win: null, sec: null, sel: null, texte: null, glisse: null, taille: null,
                      rotation: null, pile: null, annuler: [], retablir: [], modifie: false });
  if (typeof edRendreCalques === "function") edRendreCalques();     // la colonne des calques se vide avec
}

/* Des retouches non enregistrées, et on s'apprête à quitter la slide : trois issues.
   Rend true si on peut partir (enregistré, ou abandonné), false si on reste. */
async function pgLoupeQuitterSlide(quoi) {
  if (typeof ED === "undefined" || !ED.modifie) return true;
  const fermer = quoi === "fermer";
  const r = await demander(null, {
    titre: fermer ? "Enregistrer avant de fermer ?" : "Enregistrer avant de changer de " + pgUne() + " ?",
    html: "<p>Vos retouches sur cette " + pgUne() + " ne sont pas enregistrées.</p>",
    ok: "Enregistrer", tiers: fermer ? "Fermer sans enregistrer" : "Changer sans enregistrer",
    annuler: fermer ? "Continuer à modifier" : "Rester ici", danger: false });
  if (r === "tiers") return true;
  if (r === true) return await pgLoupeEnregistrer();
  return false;
}

/* Changer de slide SANS PERDRE LES RETOUCHES : on demande, comme à la fermeture.
   Sans cette question, une flèche effacerait un quart d'heure de travail. */
async function pgLoupeAller(n) {
  const total = PG.deck.slides.length;
  if (n < 1 || n > total || n === pgLoupeN) return;
  if (!await pgLoupeQuitterSlide("changer")) return;
  pgLoupeN = n;
  pgLoupePanneau();
  pgCFPlacer();
}

// Le panneau de droite : tout ce qui décrit la slide qu'on tient.
function pgLoupePanneau() {
  const n = pgLoupeN, F = PG_FORMATS[PG.genre];
  $("pg-loupe-h").textContent = (PG.genre === "stories" ? "Story " : "Slide ") + n + " sur " + PG.deck.slides.length;
  $("pg-loupe-remarque").value = "";
  $("pg-loupe-erreur").hidden = true;
  $("pg-loupe-enregistrer").disabled = true;
  $("pg-loupe-enregistrer").textContent = "Enregistrer les modifications";
  $("pg-loupe-refaire").disabled = false;
  $("pg-loupe-refaire").textContent = "Refaire cette " + F.une;
}

/* Ce que le Cover Flow occupe en largeur, en multiples d'UNE slide : la slide
   du centre, plus l'écartement de la voisine la plus lointaine, plus sa demi-
   largeur. C'est cette étendue — et non la largeur d'une slide — qui doit tenir
   dans la place disponible. Sans ce calcul, la voisine du bord passait SOUS le
   panneau de droite : on la voyait dépasser, et le panneau semblait transparent. */
function pgCFEtendue(V) {
  /* La voisine la plus lointaine : son centre est a « ecart x V » de l'axe, et sa
     demi-largeur vaut « echelle puissance V », retrecie par la rotation (le cosinus
     de l'angle). Compter une slide ENTIERE en plus, comme je l'avais fait d'abord,
     volait inutilement de la place a la slide qu'on retouche. */
  const demi = PG_CF.ecart / 100 * V + Math.pow(PG_CF.echelle, V) * Math.cos(PG_CF.angle * Math.PI / 180) / 2;
  return 2 * demi;
}

/* La place que la loupe laisse à la scène. Au-delà de 820 px le panneau des
   outils est à côté (320 px et la gouttière) ; en dessous il passe dessous,
   et la scène a toute la largeur. */
function pgCFPlace() {
  const marge = 48 + 40;                                   // les marges de la loupe, et le dégagement des flèches
  // La colonne des calques, à gauche, n'existe qu'au-delà de 1180 px (voir .pg-calques).
  const calques = window.innerWidth > 1180 ? 250 + 24 : 0;
  return Math.max(240, window.innerWidth - (window.innerWidth > 820 ? 320 + 24 : 0) - calques - marge);
}

/* La taille d'une slide au centre, ET combien de voisines on montre.

   LA SLIDE QU'ON RETOUCHE PASSE AVANT LE DÉCOR. Sur une fenêtre étroite, deux
   voisines de chaque côté la réduisaient à 253 px : illisible, et impossible à
   retoucher. On en retire donc une, puis deux, tant que le centre perd plus de
   28 % de ce que la hauteur seule lui permettrait. À zéro voisine, la loupe
   redevient ce qu'elle était avant le Cover Flow — ce qui est exactement ce
   qu'il faut sur un petit écran. */
function pgCFTaille() {
  const F = PG_FORMATS[PG.genre];
  const dispoH = Math.max(320, window.innerHeight - 150);
  const kH = dispoH / F.h;                       // ce que la hauteur permet, seule
  const place = pgCFPlace();
  let V = PG_CF.voisines, k = kH;
  for (; V > 0; V--) {
    k = Math.min(kH, place / pgCFEtendue(V) / F.l);
    if (k >= kH * 0.72) break;
  }
  if (V === 0) k = Math.min(kH, place / F.l);
  return { k: k, l: Math.round(F.l * k), h: Math.round(F.h * k), V: V };
}

// Monter une slide (et une seule fois) : son cadre, son iframe.
function pgCFMonter(n) {
  if (pgCF.montees.has(n)) return pgCF.montees.get(n);
  const F = PG_FORMATS[PG.genre], t = pgCFTaille();
  const cadre = pgEl("div", "pg-cf-slide");
  cadre.style.width = t.l + "px"; cadre.style.height = t.h + "px";
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-same-origin");
  f.setAttribute("scrolling", "no");
  f.setAttribute("tabindex", "-1");
  f.style.cssText = "width:" + F.l + "px;height:" + F.h + "px;transform:scale(" + t.k + ")";
  f.onload = () => { if (n === pgLoupeN) pgCFLier(n); };
  f.src = pgUrlSlide(n);
  cadre.appendChild(f);
  cadre.onclick = () => { if (n !== pgLoupeN) pgLoupeAller(n); };
  pgCF.plateau.appendChild(cadre);
  const e = { cadre: cadre, iframe: f };
  pgCF.montees.set(n, e);
  return e;
}

/* Donner la slide du centre à l'éditeur. On ne le refait pas si c'est déjà
   la sienne : edOuvrir remet à zéro l'historique d'annulation. */
function pgCFLier(n) {
  const e = pgCF.montees.get(n);
  if (!e || pgCF.liee === e.iframe) return;
  if (typeof edOuvrir !== "function") return;
  edOuvrir(e.iframe);
  /* edOuvrir renonce en silence tant que la page n'est pas chargée. Retenir la
     liaison malgré cet échec bloquait la seconde tentative — celle du onload —
     et la slide du centre restait inerte : on ne pouvait plus rien y retoucher.
     On ne la retient donc que si l'éditeur a vraiment pris la main. */
  if (ED.cadre === e.iframe) pgCF.liee = e.iframe;
}

function pgCFPlacer() {
  const n = pgLoupeN, total = PG.deck.slides.length;
  const scene = $("pg-loupe-scene"), t = pgCFTaille(), V = t.V;
  /* Les slides sont en position absolue : elles ne donnent aucune taille à la
     scène, qui s'effondrerait dans la colonne « auto » de la loupe. On la
     dimensionne donc nous-mêmes — la hauteur d'une slide, et toute la largeur
     laissée par le panneau de droite, pour que les voisines aient la place. */
  scene.style.perspective = PG_CF.perspective + "px";
  scene.style.height = t.h + "px";
  scene.style.width = Math.round(t.l * (V ? pgCFEtendue(V) : 1)) + "px";

  // Ce qui sort de la fenêtre est démonté : une iframe de moins à faire vivre.
  [...pgCF.montees.keys()].forEach(k => {
    if (Math.abs(k - n) > V) {
      const e = pgCF.montees.get(k);
      if (e.iframe === pgCF.liee) pgCF.liee = null;
      e.cadre.remove();
      pgCF.montees.delete(k);
    }
  });

  for (let k = Math.max(1, n - V); k <= Math.min(total, n + V); k++) {
    const e = pgCFMonter(k), d = k - n, abs = Math.abs(d), sens = d > 0 ? 1 : -1;
    e.cadre.classList.toggle("ici", d === 0);
    e.cadre.classList.toggle("cote", d !== 0);
    e.cadre.style.zIndex = String(10 - abs);
    if (d === 0) {
      e.cadre.style.transform = "none";
      e.cadre.style.filter = "none";
      e.iframe.style.pointerEvents = "auto";
      pgCFLier(k);                                  // déjà chargée : on la lie tout de suite
    } else {
      e.cadre.style.transform = "translateX(" + (sens * PG_CF.ecart * abs) + "%) translateZ(" + (-PG_CF.recul * abs) + "px)" +
        " rotateY(" + (-sens * PG_CF.angle) + "deg) scale(" + Math.pow(PG_CF.echelle, abs) + ")";
      e.cadre.style.filter = "blur(" + (PG_CF.flou * abs) + "px)";
      // Une voisine ne se clique pas DANS sa page : c'est son cadre qui reçoit le clic.
      e.iframe.style.pointerEvents = "none";
    }
  }

  [...pgCF.rang.children].forEach((p, i) => p.classList.toggle("ici", i + 1 === n));
  pgCF.avant.disabled = n <= 1;
  pgCF.apres.disabled = n >= total;
}

/* LA FENÊTRE CHANGE DE TAILLE. Les slides sont dimensionnées en pixels au
   moment où on les monte : sans ce rattrapage, agrandir ou réduire la fenêtre
   laissait une slide trop grande qui débordait, ou trop petite qui flottait.
   On redonne sa taille à chaque cadre, puis on replace.

   L'éditeur est relié de nouveau à la même page : edOuvrir y garde l'historique
   d'annulation, le drapeau « modifié » et la sélection, et remesure ses poignées. */
let pgCFMinuteur = null;
function pgCFRedimensionner() {
  if ($("pg-loupe").hidden || !pgCF.plateau) return;
  const F = PG_FORMATS[PG.genre], t = pgCFTaille();
  /* L'observateur voit TOUT changement de hauteur de la page — un simple pgRendre() derrière la loupe
     après « Enregistrer » suffisait à rebrancher l'éditeur. On ne fait rien si la taille des slides
     n'a pas bougé. */
  const cle = t.l + "x" + t.h + "x" + t.k;
  if (pgCF.cleTaille === cle) return;
  pgCF.cleTaille = cle;
  pgCF.montees.forEach(e => {
    e.cadre.style.width = t.l + "px";
    e.cadre.style.height = t.h + "px";
    e.iframe.style.transform = "scale(" + t.k + ")";
  });
  pgCFPlacer();
  /* Rebranchée sur la MÊME page, l'éditeur garde son historique, son état « modifié » et sa sélection
     (edOuvrir) : on peut donc le faire même au milieu d'une retouche — sans quoi ses poignées gardaient
     l'ancienne échelle et tombaient à côté de l'élément. */
  if (typeof ED !== "undefined" && pgCF.liee) {
    pgCF.liee = null;
    pgCFLier(pgLoupeN);            // les poignées de l'éditeur se remesurent sur la nouvelle taille
  }
}
/* On OBSERVE la taille plutot que d'ecouter « resize » : l'evenement ne part
   pas dans tous les cas (une emulation d'ecran, un volet qui s'ouvre a cote),
   alors qu'un ResizeObserver voit tout changement de mise en page reel. */
const pgCFSurTaille = () => { clearTimeout(pgCFMinuteur); pgCFMinuteur = setTimeout(pgCFRedimensionner, 150); };
if (typeof ResizeObserver === "function") new ResizeObserver(pgCFSurTaille).observe(document.documentElement);
window.addEventListener("resize", pgCFSurTaille);

function pgFermerLoupe() {
  $("pg-loupe").hidden = true;
  document.body.classList.remove("visionneuse-ouverte");
  $("pg-loupe-scene").innerHTML = "";
  $("pg-loupe-scene").classList.remove("pg-cf");
  pgCF = { montees: new Map(), plateau: null, liee: null };
  pgEdOublier();
}

/* Les flèches du clavier changent de slide — SAUF quand l'éditeur tient un
   élément : là, elles le déplacent, et c'est lui qui les reçoit dans sa page. */
document.addEventListener("keydown", e => {
  if ($("pg-loupe").hidden || document.querySelector(".fen")) return;
  if (typeof ED !== "undefined" && ED.sel) return;
  if (/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "")) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); pgLoupeAller(pgLoupeN - 1); }
  if (e.key === "ArrowRight") { e.preventDefault(); pgLoupeAller(pgLoupeN + 1); }
});
function pgLoupeDire(m) { const e = $("pg-loupe-erreur"); e.textContent = m || ""; e.hidden = !m; }

// Fermer la loupe : des retouches non enregistrées ne se perdent pas sans le dire.
async function pgFermerLoupeDemande() {
  if (!await pgLoupeQuitterSlide("fermer")) return;
  pgFermerLoupe();
}
$("pg-loupe-fermer").onclick = pgFermerLoupeDemande;
$("pg-loupe-voile").onclick = pgFermerLoupeDemande;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("pg-loupe").hidden && !document.querySelector(".fen")) { e.stopImmediatePropagation(); pgFermerLoupeDemande(); }
}, true);

/* Enregistrer NE FERME PLUS la loupe : on reste dans le Cover Flow, sur la même slide,
   l'historique d'annulation intact, et on enchaîne sur la suivante. La page derrière se
   redessine pour montrer la slide à jour. Rend true si c'est enregistré. */
async function pgLoupeEnregistrer() {
  const html = typeof edHtmlPropre === "function" ? edHtmlPropre() : "";
  if (!html) return false;
  const b = $("pg-loupe-enregistrer");
  b.disabled = true; b.textContent = "Enregistrement…";
  try {
    const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/slides/" + pgLoupeN, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: html }) })).json();
    if (r.erreur) throw new Error(r.erreur);
    PG.deck = r.deck;
    // Rien n'a bougé dans la slide : la publication reste ce qu'elle est, export compris.
    if (!r.inchangee) { PG.exporte = null; PG.version++; }
    ED.modifie = false;
    pgLoupeDire("");
    b.textContent = "Enregistré ✓";
    pgRendre();
    return true;
  } catch (err) { pgLoupeDire("Les modifications n'ont pas pu être enregistrées : " + (err.message || err)); b.disabled = false; b.textContent = "Réessayer"; return false; }
}
$("pg-loupe-enregistrer").onclick = () => pgLoupeEnregistrer();

$("pg-loupe-refaire").onclick = async () => {
  if (ED.modifie && !await demander(null, { titre: "Refaire cette " + pgUne() + " ?", html: "<p>Claude la recompose : vos retouches à la main sur cette " + pgUne() + ", enregistrées ou non, seront remplacées.</p>", ok: "Refaire" })) return;
  ED.modifie = false;
  const b = $("pg-loupe-refaire");
  b.disabled = true; b.textContent = "Claude refait cette " + PG_FORMATS[PG.genre].une + "… (une minute environ)";
  pgLoupeDire("");
  try {
    const r = await (await fetch("/api/publications/" + encodeURIComponent(PG.d.pubId) + "/slides/" + pgLoupeN, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remarque: $("pg-loupe-remarque").value.trim() }) })).json();
    if (r.erreur) throw new Error(r.erreur);
    PG.deck = r.deck; PG.exporte = null; PG.version++;
    pgRendre();
    pgOuvrirLoupe(pgLoupeN);          // la nouvelle version, sous les yeux
  } catch (err) { pgLoupeDire("Cette " + PG_FORMATS[PG.genre].une + " n'a pas pu être refaite : " + (err.message || err)); b.disabled = false; b.textContent = "Réessayer"; }
};


/* ------------------------------------------------------------
   À DROITE : la mosaïque de ce qui est rassemblé
   ------------------------------------------------------------ */

function pgRendreRecap() {
  if (!PG.genre || !PG.d) return;
  const d = PG.d, F = PG_FORMATS[PG.genre];
  let pieces = [], lignes = [], note = "";

  {
    $("pg-recap-h").textContent = PG.genre === "stories" ? "Vos stories" : "Votre carrousel";
    $("pg-recap-p").textContent = "Ce que le studio sait déjà.";
    const da = PG.identites.find(x => x.id === d.identiteId);
    if (d.but) pieces.push({ nom: d.but });
    if (da) pieces.push({ nom: da.nom, couleur: da.couleurs.accent });
    (d.medias || []).filter(m => !m.videoId).forEach(m => pieces.push({ nom: m.note || m.nom, image: m.fichier && d.pubId ? "/pub/" + PROJET.id + "/" + d.pubId + "/medias/" + m.fichier : (m.url || "") }));
    const n = PG.pub && PG.pub.plan ? PG.pub.plan.slides.length : d.nb;
    lignes = [["But", d.but || "—"], ["DA", da ? da.nom : "palette du studio"], ["Images", (d.medias || []).length || "aucune"], ["Format", n + " " + (n > 1 ? F.des : F.une) + " · " + F.ratio]];
    note = "Aucun crédit de génération : Claude écrit le plan, puis compose les " + F.des + " à votre DA.";
  }

  const m = $("pg-mosaique");
  m.innerHTML = "";
  for (let i = 0; i < Math.max(6, Math.ceil(pieces.length / 3) * 3); i++) {
    const t = pgEl("div", "pg-tesselle");
    const p = pieces[i];
    if (p) {
      t.classList.add("pleine");
      if (p.image) { t.classList.add("image"); t.style.backgroundImage = "url('" + encodeURI(p.image) + "')"; }
      else t.style.background = p.couleur || PG_TEINTES[i % PG_TEINTES.length];
      t.innerHTML = (("")) + "<span>" + echapper(p.nom) + "</span>";
    }
    m.appendChild(t);
  }
  $("pg-recap-lignes").innerHTML = lignes.map(([a, b]) => "<div><span>" + echapper(a) + "</span><b>" + echapper(String(b)) + "</b></div>").join("");
  $("pg-recap-note").textContent = note;
}


/* ------------------------------------------------------------
   L'ACCUEIL : les portes, la reprise, les publications du projet
   ------------------------------------------------------------ */


;
;
;
;

/* VOS OUTILS (26 sept. 2026) : les cartes de l'accueil ouvrent ce qu'ouvraient les boutons de la barre du haut,
   désormais cachés — on déclenche le bouton lui-même, ses gestionnaires restent la seule vérité. */



/* Les Reels et TikTok du projet. Un reel n'a pas de dossier comme une publication :
   sa fiche (REELS/reels.json) ne fait que nommer les vidéos qu'il a produites, qui,
   elles, vivent dans Rendus. La vignette est donc la vidéo elle-même, arrêtée sur
   sa première demi-seconde. */
/* Un nom de rendu porte son sous-dossier (« videos/2026-… .mp4 »). encodeURIComponent
   transformerait la barre oblique en %2F et le serveur ne trouverait plus rien : on encode
   segment par segment, comme le fait déjà la couverture des projets. */
const pgUrlRendu = f => "/RENDUS/" + String(f || "").split("/").map(encodeURIComponent).join("/");



// Rouvrir une publication : ses réponses redeviennent le brouillon du genre.
function pgOuvrirPub(p) {
  const tout = pgLireTout();
  tout[p.genre] = { but: p.but || "", sujet: p.sujet || "", forme: p.forme || "", cible: p.cible || "", appel: p.appel || "", identiteId: p.identiteId || null,
                    modele: (p.modele || []).map(m => ({ fichier: m.fichier, nom: m.nom })),
                    distribution: (p.distribution || []).map(r => ({ type: r.type, id: r.id })), modeleFidelite: p.modeleFidelite || "charpente",
                    medias: (p.medias || []).map(m => ({ fichier: m.fichier, nom: m.nom, note: m.note, illustration: !!m.illustration, slideId: m.slideId, fond: m.fond, refsSig: m.refsSig, cadre: m.cadre, detoure: !!m.detoure, avecFond: m.avecFond, sansFond: m.sansFond, methodeFond: m.methodeFond, origine: m.origine })),
                    nb: p.nb || (p.plan ? p.plan.slides.length : PG_FORMATS[p.genre].defaut), pubId: p.id,
                    sigPlan: null, etape: p.compose ? 4 : (p.plan ? 3 : 0), maj: Date.now() };
  tout.dernier = p.genre;
  try { localStorage.setItem(pgCle(), JSON.stringify(tout)); } catch (e) {}
  pgOuvrir(p.genre).then(() => { PG.d.sigPlan = pgSignature(); pgSauver(); });
}
/* Storymatic (6 oct. 2026) : « Ma semaine » ouvre un jour dans l'éditeur des stories par « /editeur?pub=<id> », et un
   bouton ramène à la semaine. */
(function () {
  const q = new URLSearchParams(location.search), id = q.get("pub");
  if (!id) return;
  const retour = document.createElement("a");
  retour.href = "/" + (q.get("semaine") ? "?semaine=" + encodeURIComponent(q.get("semaine")) : "");
  retour.textContent = "← Ma semaine";
  retour.className = "sc-retour";
  // dès que la page est lue et le catalogue chargé (SM_PRET, app.js) — sans attendre les images ni les polices
  document.addEventListener("DOMContentLoaded", async () => {
    document.body.appendChild(retour);
    try {
      await window.SM_PRET;
      const r = await fetch("/api/publications/" + encodeURIComponent(id));
      if (r.ok) { const p = await r.json(); p.compose = !!(p.deck && p.deck.slides && p.deck.slides.length); pgOuvrirPub(p); }
      else if (window.smVersSemaine) window.smVersSemaine();   // le jour n'existe plus : retour à la semaine
    } catch (e) {}
  });
})();

/* ---------- LES FONDS DE LA DA STORY ----------
   Deux fonds : « fond » et « fond accent ». Sans image, l'aplat de la couleur de la DA avec un grain ; sinon une IMAGE importée
   (Storymatic ne génère rien). `da` : { id, nom, couleurs, fonds, genre } ; `surChange(fonds)` après coup. */
const DA_FONDS = [["fond", "Le fond", "sous la plupart des stories"], ["fond_accent", "Le fond accent", "l'aplat de couleur qui fait respirer la suite"]];
const daFondUrl = (da, cle) => da && da.fonds && da.fonds[cle] ? encodeURI("/IDENTITES/" + da.id + "/" + da.fonds[cle]) : "";
// une vignette de fond : l'image de la DA, sinon sa couleur
function daFondStyle(da, cle) {
  const u = daFondUrl(da, cle), c = da && da.couleurs ? (cle === "fond" ? da.couleurs.fond : da.couleurs.accent) : "#111113";
  return u ? `background:${c} url('${u}') center/cover` : `background-color:${c}`;
}
function daFonds(conteneur, da, surChange) {
  const sous = da.genre || "story", q_ = "?sous=" + sous;
  const etat = {};   // par fond : { enCours, message }
  const dessiner = () => {
    conteneur.innerHTML = `<div class="daf">${DA_FONDS.map(([cle, nom, aide]) => { const s = etat[cle] || (etat[cle] = {}), image = !!(da.fonds && da.fonds[cle]);
      return `<div class="daf-ligne" data-cle="${cle}">
        <div class="daf-vignette ${image ? "" : "daf-grain"}" style="${daFondStyle(da, cle)}"></div>
        <div class="daf-texte"><b>${nom}</b> <small>${aide}</small>
          <span class="daf-etat">${image ? "Une image, gardée dans la DA." : "L'aplat de la couleur " + (cle === "fond" ? "« Fond »" : "« Accent »") + " de la DA, avec un grain."}</span>
          <div class="daf-actions"><button type="button" class="btn-mini daf-importer" ${s.enCours ? "disabled" : ""}>Importer une image</button>
            ${image ? `<button type="button" class="btn-mini daf-retirer" ${s.enCours ? "disabled" : ""}>Revenir à l'aplat</button>` : ""}</div>
          ${s.message ? `<span class="daf-message">${echapper(s.message)}</span>` : ""}
        </div></div>`; }).join("")}</div>`;
    conteneur.querySelectorAll(".daf-ligne").forEach(l => {
      const cle = l.dataset.cle, s = etat[cle], q = x => l.querySelector(x);
      const poser = r => { if (r.erreur) throw new Error(r.erreur); da.fonds = (r.sous && r.sous[sous] ? r.sous[sous].fonds : r.fonds) || {}; if (surChange) surChange(da.fonds); };
      const envoyer = async (quoi, corps) => (await fetch(`/api/identites/${encodeURIComponent(da.id)}/fonds/${cle}/${quoi}${q_}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps || {}) })).json();
      q(".daf-importer").onclick = async () => {
        const f = (await pgChoisirFichiers("image/png,image/jpeg,image/webp"))[0]; if (!f) return;
        s.enCours = true; s.message = "Import…"; dessiner();
        try { poser(await envoyer("importer", { donnees: await pgLireFichier(f) })); s.message = "Image importée."; } catch (err) { s.message = "L'import a échoué : " + err.message; }
        s.enCours = false; dessiner(); };
      if (q(".daf-retirer")) q(".daf-retirer").onclick = async () => {
        try { poser(await envoyer("retirer")); s.message = "Retour à l'aplat."; } catch (err) { s.message = err.message; } dessiner(); };
    });
  };
  dessiner();
}
