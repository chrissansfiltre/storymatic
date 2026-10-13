/* ============================================================
   INTERFACE — navigation, demande, résultat
   ------------------------------------------------------------
   L'application ne rédige rien elle-même : elle transmet la demande
   au serveur local, qui la confie à Claude Code. La réflexion se fait
   là, avec le profil de l'avatar et les lois de production.

   Dans le code, un avatar s'appelle encore « marque » (marqueId,
   MARQUES…) : le studio est né d'un studio de marques et ces
   identifiants sont restés. Un avatar = une marque.
   ============================================================ */


/* ------------------------------------------------------------
   LE SIGNE
   Le panneau de tesselles est écrit une seule fois, dans un
   <symbol> en tête de page, et posé par <use> à chaque endroit
   qui en a besoin. Mais une feuille de style n'entre pas dans
   l'arbre fantôme que <use> fabrique : les tesselles n'y
   recevraient ni transition ni déplacement au survol. On recopie
   donc le contenu du symbole dans chaque <svg>, ce qui donne de
   vrais éléments, coiffés par le CSS.

   À faire avant tout le reste : l'intro mesure la largeur du signe
   de l'en-tête pour calculer son trajet.
   ------------------------------------------------------------ */
function poserLesSignes() {
  document.querySelectorAll("svg > use").forEach(u => {
    const src = document.getElementById((u.getAttribute("href") || "").slice(1));
    if (!src) return;
    const svg = u.parentNode;
    svg.setAttribute("viewBox", src.getAttribute("viewBox"));
    for (const n of src.children) svg.appendChild(n.cloneNode(true));
    u.remove();
  });
}
poserLesSignes();


/* Le projet en cours (PROJET) et la liste des projets. Tout ce que l'on crée
   vit dans le projet en cours : le serveur le lit dans le cookie « projet ».
   Les avatars, eux, sont communs à tous les projets. */
let PROJET = null;
let PROJETS = [];


let etat = { etape: "marque", marqueId: null, marqueIds: [], refs: [], demande: "", imports: [] };
let projetsEnCours = null;       // voir chargerProjets()


      // le texte cherché dans les références
    // les sous-sections repliées, par « Groupe/Sous-groupe »

const $ = id => document.getElementById(id);

/* Faire un travail d'affichage une seule fois pour la prochaine image affichée. Si la fenêtre ne se dessine
   pas (réduite, cachée derrière une autre), il se fait quand même au plus tard 80 ms après. */
function enPeinture(fn, fenetre) {
  let fait = false;
  const go = () => { if (!fait) { fait = true; fn(); } };
  (fenetre || window).requestAnimationFrame(go);
  setTimeout(go, 80);
}

/* ------------------------------------------------------------
   NAVIGATION
   ------------------------------------------------------------ */

const SM_ECRANS = ["parcours", "das"];
function smVersSemaine() {
  const s = new URLSearchParams(location.search).get("semaine");
  location.href = "/" + (s ? "?semaine=" + encodeURIComponent(s) : "");
}
window.smVersSemaine = smVersSemaine;

/* `viaHistorique` vaut true quand c'est le bouton Retour du navigateur qui
   nous amène : dans ce cas on ne réempile rien, sinon on tournerait en rond. */
function aller(etape, viaHistorique) {
  if ((!SM_ECRANS.includes(etape))) { smVersSemaine(); return; }
  document.documentElement.classList.remove("sm-attente");   // l'écran de Storymatic est là : on montre la page
  etat.etape = etape;
  SM_ECRANS.forEach(v => { const el = $("step-" + v); if (el) el.hidden = (v !== etape); });
  // les deux écrans de Storymatic : trois colonnes, donc une page plus large
  document.body.classList.add("mode-parcours");
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (viaHistorique) return;
  const dejaLa = history.state && history.state.etape;
  if (dejaLa === etape) return;               // on y est déjà, rien à empiler
  const entree = { etape: etape };
  if (dejaLa) history.pushState(entree, "", "#" + etape);
  else history.replaceState(entree, "", "#" + etape);
}

/* Le bouton Retour du navigateur, et Alt+flèche gauche.

   Un écran peut avoir besoin d'un état qui n'existe plus — revenir sur
   « demande » sans avatar choisie, ou sur « prompt » sans prompt écrit.
   Dans ces cas on remonte à un écran atteignable plutôt que d'afficher
   une page vide. */
window.addEventListener("popstate", e => {
  const cible = (e.state && e.state.etape) || "accueil";
  if (!SM_ECRANS.includes(cible)) { smVersSemaine(); return; }
  // un parcours se rouvre où il en était, la DA se rouvre ; sinon, la semaine
  if (cible === "parcours") { if (pgReprendre(true)) return; smVersSemaine(); return; }
  if (cible === "das") { ouvrirDAs(); return; }
  aller(cible, true);
});


/* ------------------------------------------------------------
   L'ACCUEIL
   ------------------------------------------------------------ */


async function rendreAccueil() {
  { smVersSemaine(); return; }   // Storymatic : pas d'accueil de studio, c'est « Ma semaine »
  
  // La fenêtre d'une slide du storyboard ne survit pas au retour à l'accueil.
  
  // Le catalogue est relu à chaque retour à l'accueil : un avatar créé, une
  // image déposée dans un dossier apparaissent sans recharger la page.
  
  
  // Le parcours laissé en route, et les carrousels et stories du projet.
  

  // Ce que la bibliothèque contient : un chiffre concret plutôt qu'un slogan.
  
  
  

  // Le nombre de rendus déjà produits : il arrive après coup pour ne pas
  // retarder l'affichage du hero, et ne s'ajoute que s'il y en a.
  

}

/* ------------------------------------------------------------
   ÉTAT DE CLAUDE CODE
   ------------------------------------------------------------ */

/* Le modèle sur lequel tourne le studio. Vide = celui de Claude Code, c'est-à-dire
   le réglage du compte : c'était le seul comportement possible avant, et ça reste
   le défaut d'une installation neuve. */
let CLAUDE_MODELES = [], CLAUDE_MODELE = "";
/* Vrai si le poste a de quoi supprimer un fond sans rien dépenser (Python + rembg).
   Sinon le studio passe par Higgsfield, qui coûte un crédit. */
let DETOURAGE_LOCAL = false;

let CLAUDE_ABSENT = false;   // pas de Claude Code sur le poste : la pastille ouvre la page Installation
async function verifierClaude() {
  const el = $("etat-claude");
  try {
    const r = await fetch("/api/etat");
    const d = await r.json();
    // Le serveur tourne-t-il encore sur le code qu'il a chargé ?
    $("bandeau-perime").hidden = !d.perime;

    CLAUDE_MODELES = d.modeles || [];
    CLAUDE_MODELE = d.modele || "";
    DETOURAGE_LOCAL = !!d.detourageLocal;

    if (d.claude) {
      const m = CLAUDE_MODELES.find(x => x.id === CLAUDE_MODELE);
      el.innerHTML = '<span class="pastille-ok"></span> Claude Code' +
        (CLAUDE_MODELE ? ' · <b class="etat-modele">' + echapper(m ? m.nom : CLAUDE_MODELE) + "</b>" : " connecté") +
        '<span class="etat-chev" aria-hidden="true">▾</span>';
      el.className = "etat ok";
      el.disabled = false;
      el.title = "Le modèle sur lequel tourne le studio — cliquez pour en changer";
    } else {
      // Pas de Claude Code : la pastille mène à la page Installation, qui l'installe.
      el.innerHTML = '<span class="pastille-ko"></span> Claude Code à installer';
      el.className = "etat ko";
      el.disabled = false;
      el.title = "Ouvrir la page Installation";
    }
    CLAUDE_ABSENT = !d.claude;
  } catch (e) {
    el.innerHTML = '<span class="pastille-ko"></span> Serveur non lancé';
    el.className = "etat ko";
    el.disabled = true;
    el.title = "Fermez cette page et démarrez le studio avec l'icône Storymatic du Bureau";
  }
}

/* ---------- Changer de modèle ----------

   Le studio appelle Claude Code en ligne de commande, sans jamais préciser de
   modèle : il prenait donc celui du compte, qui n'est pas le même d'un poste à
   l'autre. Le choix est ici, à côté de la pastille, parce que c'est là qu'on
   lit déjà l'état de Claude Code.

   Les formules Pro et Max donnent les mêmes modèles, avec des limites d'usage
   différentes : choisir Opus ne se refuse pas, ça consomme plus vite. Si un
   modèle est hors d'atteinte malgré tout, c'est Claude Code qui le dira, à la
   demande suivante — le studio ne le sait pas d'avance. */

function fermerMenuModeles() {
  $("menu-modeles").hidden = true;
  $("etat-claude").setAttribute("aria-expanded", "false");
}

function rendreMenuModeles() {
  const m = $("menu-modeles");
  m.innerHTML =
    '<div class="menu-projets-titre">Le modèle du studio</div>' +
    CLAUDE_MODELES.map(x =>
      '<button type="button" class="menu-projets-item' + (x.id === CLAUDE_MODELE ? " courant" : "") + '" data-id="' + echapper(x.id) + '">' +
        '<span class="menu-projets-coche" aria-hidden="true">' + (x.id === CLAUDE_MODELE ? "✓" : "") + "</span>" +
        '<span class="menu-projets-nom">' + echapper(x.nom) + "</span>" +
        '<span class="menu-projets-n">' + echapper(x.sous || "") + "</span></button>").join("") +
    '<div class="menu-projets-sep"></div>' +
    '<p class="menu-modeles-note">Le changement vaut pour la demande suivante. Un travail ' +
      "déjà lancé garde le modèle avec lequel il est parti.</p>";
  m.querySelectorAll("[data-id]").forEach(b => b.onclick = () => choisirModele(b.dataset.id));
}


async function choisirModele(id) {
  fermerMenuModeles();
  if (id === CLAUDE_MODELE) return;
  try {
    const r = await fetch("/api/modele", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modele: id }) });
    const d = await r.json();
    if (d.erreur) throw new Error(d.erreur);
    await verifierClaude();
  } catch (e) {
    informer("Le modèle n'a pas pu être changé : " + (e.message || e));
  }
}

$("etat-claude").onclick = e => {
  e.stopPropagation();
  if ($("etat-claude").disabled) return;
  if (CLAUDE_ABSENT) { location.href = "/?installation=1"; return; }   // la page Installation vit sur l'accueil
  if (!CLAUDE_MODELES.length) return;
  if (!$("menu-modeles").hidden) { fermerMenuModeles(); return; }
  rendreMenuModeles();
  $("menu-modeles").hidden = false;
  $("etat-claude").setAttribute("aria-expanded", "true");
};
document.addEventListener("click", e => {
  if (!$("menu-modeles").hidden && !e.target.closest("#etat-choix")) fermerMenuModeles();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") fermerMenuModeles(); });

/* ------------------------------------------------------------
   INSTALLER LE STUDIO COMME APPLICATION

   Chrome et Edge proposent d'installer une page qui a un manifeste : elle
   s'ouvre alors dans sa propre fenêtre, avec l'icône du studio dans la
   barre des tâches ou le Dock. Le bouton n'apparaît que dans un navigateur
   classique, quand l'installation est possible — jamais dans l'application
   déjà installée, ni dans Safari (qui passe par Fichier > Ajouter au Dock).
   ------------------------------------------------------------ */



;

/* ------------------------------------------------------------
   ÉTAPE 1 — L'AVATAR
   ------------------------------------------------------------ */



/* ------------------------------------------------------------
   ÉTAPE 2 — LA DEMANDE
   ------------------------------------------------------------ */


/* ------------------------------------------------------------
   LES IMAGES DÉPOSÉES
   ------------------------------------------------------------ */



/* ------------------------------------------------------------
   MODÈLE, DURÉE, QUALITÉ

   Ces trois réglages partent vers Claude Code : ils servent à
   écrire le prompt (la durée commande le découpage du dialogue)
   ET à lancer la génération sur Magnific (le modèle et la qualité
   décident du coût). Les listes viennent de data/modeles.js,
   relevé sur le compte du groupe.
   ------------------------------------------------------------ */







/* ------------------------------------------------------------
   ÉTAPE 3 — LA GÉNÉRATION
   ------------------------------------------------------------ */






/* ------------------------------------------------------------
   L'HISTORIQUE
   ------------------------------------------------------------ */



function echapper(t) {
  const d = document.createElement("div");
  d.textContent = t || "";
  return d.innerHTML;
}


/* ------------------------------------------------------------
   LA GALERIE DES RENDUS

   Tout ce qui a été généré, lu depuis le journal du serveur. Le
   fichier local en est la copie durable : les URLs de Magnific
   sont signées et expirent, donc la galerie n'affiche que du
   disque, jamais du distant.
   ------------------------------------------------------------ */

       // l'avatar filtrée, "" pour toutes
    // le rendu dont la suppression attend confirmation




const vgFile = [], vgVus = new Set();









/* ------------------------------------------------------------
   DÉMARRAGE
   ------------------------------------------------------------ */

;
;
;
;
;   // définie dans son.js, chargé après ce fichier


// La recherche des références : elle filtre à la frappe.
;
;
;
;
;
;
$("brand").onclick = rendreAccueil;
;
;
;
;
;
// La plateforme change la liste des modèles disponibles.
;

// Les balises affichées sur les références suivent la plateforme.
;
;


// Le dépôt d'images : au clic comme au glisser-déposer.
;
;


;

/* ------------------------------------------------------------
   LA GÉNÉRATION DIRECTE

   Le prompt est déjà écrit et relu. Ici on l'envoie à Magnific.
   Deux garde-fous : le coût est estimé et affiché AVANT, et un
   clic ne suffit pas — il faut confirmer.
   ------------------------------------------------------------ */

   // ce qu'il faut pour relancer la même génération





   // la plateforme changée à la main dans le volet













/* ---------- Le branchement ---------- */

// Changer un réglage relance l'estimation : le chiffre affiché doit
// toujours correspondre à ce qui partira.
;
;
;
;
;

;
;
;
;
;
;
;



/* ------------------------------------------------------------
   LE LANCEMENT
   Un curseur entre par le bas et vient cliquer à l'endroit exact où
   le logo va naître. Le signe apparaît sous la pointe, puis l'onde de
   pixels du bouton « Générer l'avatar » s'en échappe et écrit le mot
   dans son sillage, lettre par lettre. Le bloc rejoint ensuite sa
   place dans l'en-tête : le trajet n'est pas écrit en dur, on mesure
   les deux positions et on anime de l'une à l'autre, pour que ça
   tombe juste quelle que soit la taille de la fenêtre.

   Trois animations ont ici un fill « forwards » et non « both », et
   ce n'est pas un détail : en « both », leur première image
   s'appliquerait AVANT leur tour et écraserait ce qui se joue à ce
   moment-là — le curseur resterait collé sur sa cible au lieu
   d'arriver, et l'anneau du clic traînerait à l'écran dès la
   première image.
   ------------------------------------------------------------ */



/* ------------------------------------------------------------
   LA DISCUSSION
   Parler à Claude Code sans passer par la production : une
   question, une idée, un raté à comprendre. Le fil est gardé
   dans le navigateur pour survivre à un rechargement.
   ------------------------------------------------------------ */

        // les messages de la conversation ouverte
          // son identifiant côté serveur, null si pas encore née

         // la dernière liste reçue du serveur
        // le texte cherché dans les conversations






/* Un rendu markdown volontairement minimal : ce qui sert vraiment dans une
   réponse de chat. Le texte est échappé AVANT toute mise en forme, donc
   rien de ce qui arrive ne peut injecter de balise. */
function md(txt) {
  const lignes = echapper(txt).split("\n");
  const sortie = [];
  let liste = null;        // "ul" ou "ol" quand une liste est ouverte
  let bloc = false;        // dans un ``` ... ```
  let tampon = [];

  const fermerListe = () => { if (liste) { sortie.push("</" + liste + ">"); liste = null; } };

  for (const l of lignes) {
    if (/^\s*```/.test(l)) {
      if (bloc) { sortie.push("<pre><code>" + tampon.join("\n") + "</code></pre>"); tampon = []; bloc = false; }
      else { fermerListe(); bloc = true; }
      continue;
    }
    if (bloc) { tampon.push(l); continue; }

    const enligne = t => t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(«"'])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    const titre = l.match(/^#{2,4}\s+(.*)$/);
    const puce = l.match(/^\s*[-*+]\s+(.*)$/);
    const num = l.match(/^\s*\d+[.)]\s+(.*)$/);

    if (titre) { fermerListe(); sortie.push("<h3>" + enligne(titre[1]) + "</h3>"); }
    else if (puce) {
      if (liste !== "ul") { fermerListe(); sortie.push("<ul>"); liste = "ul"; }
      sortie.push("<li>" + enligne(puce[1]) + "</li>");
    }
    else if (num) {
      if (liste !== "ol") { fermerListe(); sortie.push("<ol>"); liste = "ol"; }
      sortie.push("<li>" + enligne(num[1]) + "</li>");
    }
    else if (!l.trim()) { fermerListe(); }
    else { fermerListe(); sortie.push("<p>" + enligne(l) + "</p>"); }
  }
  if (bloc && tampon.length) sortie.push("<pre><code>" + tampon.join("\n") + "</code></pre>");
  fermerListe();
  return sortie.join("");
}

/* Les deux signes des bulles.

   Celui de Claude est son étoile, tracée en SVG : elle reste nette à toutes
   les tailles, là où l'ancienne image se contentait d'un PNG de 32 pixels —
   qui d'ailleurs n'existait plus depuis que les icônes ont été renommées.

   Celui du créateur est une silhouette plutôt que le mot « Moi ». Elle est
   volontairement sobre : l'orange de l'étoile doit rester le seul point de
   couleur du fil, sinon les deux signes se disputent le regard. */
const SIGNE_CLAUDE =
  '<svg class="signe-claude" viewBox="0 0 100 100" aria-hidden="true"><path d="' +
    'M28.3 2L32.2 2.2L34.6 3.9L40.4 17.4L49 34.1L50.5 38.7L51.2 38.4L53.9 8.8L55.3 5.1' +
    'L58 3.4L58.7 3.4L60.9 4.7L62.3 6.8L62.3 8.5L57.5 35.8L58.4 35.8L59.4 34.8L69.8 21.3' +
    'L76.5 14.1L78.5 12.6L82.3 12.6L85.5 17.2L84.3 21.5L71.2 38.4L68.1 44.2L68.8 44.7' +
    'L94.1 39.6L97.5 41.3L97.8 43L96.6 45.9L89.1 47.8L79.7 49.5L65.4 53.1L65.7 53.6' +
    'L73.6 54.3L83.5 54.3L92.9 55.1L96.6 57.5L98 59.4L97.8 61.6L93.2 64L66.2 57.5L65 57.7' +
    'L70 63L87.6 79.2L87.9 81.6L87.4 82.3L86.7 83L84.7 82.3L77 76.5L65.4 66.6L65 66.9' +
    'L65.2 68.1L75.6 83.3L76.3 85.5L76.5 88.6L75.6 90L73.4 90.8L71 90.3L64.7 81.4L59.4 73.4' +
    'L55.8 66.9L55.1 65.9L54.6 66.2L51.7 95.6L50.5 97L47.8 98L45.2 96.1L44 93.2L48.1 74.4' +
    'L49.3 65.4L50 63.5L49.3 63L34.8 82.8L28.8 89.3L26.6 90.8L23.5 89.6L23.7 86.7L24.7 85.2' +
    'L39.6 65.9L44.5 60.4L44.2 59.6L18.4 76.3L14.1 76.8L12.1 75.1L12.4 72.2L13.1 71.2' +
    'L20.8 65.9L39.1 55.8L40.1 54.8L39.6 53.6L6.8 52.4L4.4 51.9L2 49L2.2 47.8L3.9 46.6' +
    'L28.8 48.1L38.2 49.3L40.4 49L40.4 48.3L38.2 46.6L11.4 28.5L10 26.6L9.5 22.7L10.7 21.3' +
    'L12.1 19.8L16.2 20.3L38.4 37.2L39.1 37.7L39.9 37L24.9 10.4L24.2 6.6L27.1 2.5Z' +
  '"/></svg>';

const SIGNE_MOI =
  '<svg class="signe-moi" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8.2" r="3.5"/>' +
    '<path d="M5.2 19.6c0-3.5 3-5.6 6.8-5.6s6.8 2.1 6.8 5.6"/>' +
  "</svg>";

// Une bulle. `enAttente` affiche les trois points au lieu du texte.
function bulle(role, contenu, enAttente) {
  const el = document.createElement("div");
  el.className = "msg msg-" + (role === "moi" ? "moi" : "claude");
  const signe = '<span class="msg-signe">' +
    (role === "moi" ? SIGNE_MOI : SIGNE_CLAUDE) + "</span>";
  const corps = enAttente
    ? '<div class="msg-attente"><span></span><span></span><span></span></div>'
    : md(contenu);
  el.innerHTML = signe + '<div class="msg-bulle">' + corps + '</div>';
  return el;
}








/* ------------------------------------------------------------
   L'ATELIER — l'écran en trois zones

   À gauche les conversations, au centre le fil et son composeur,
   à droite la préparation : l'avatar, les références, les
   images déposées et les réglages. Les outils ont gardé les
   identifiants de l'ancien formulaire : rendreDemande(),
   majModeles() et le dépôt d'images fonctionnent sans changement.
   ------------------------------------------------------------ */



/* ---------- Le panneau de préparation ---------- */



/* ---------- L'avatar ---------- */




/* ---------- Les réglages, en boutons ---------- */



/* ---------- Ce que le prochain message emportera ---------- */






/* ------------------------------------------------------------
   LE PROMPT DANS LE FIL
   ------------------------------------------------------------ */



/* La place d'origine des trois panneaux que le volet emprunte. Elle est
   relevée au démarrage, pendant qu'ils sont encore chez eux : un jalon
   invisible marque la place de chacun et ne bouge jamais. */






/* ---------- Les rendus dans la conversation ---------- */

/* Le journal des rendus, partagé entre les écrans : le fil de l'atelier se redessine deux fois par message,
   l'accueil le lit pour un simple nombre. Une lecture sert 5 secondes ; « frais » force une relecture
   (la galerie qu'on ouvre, un rendu qu'on attend, une suppression). */
let rendusCache = null, rendusCacheDate = 0, rendusCacheEnCours = null;

        // le journal des rendus, tel que relu en dernier
     // le suivi de la génération en cours, s'il y en a une





/* ---------- Importer un rendu comme image déposée ----------

   Un rendu qu'on vient de générer sert souvent de référence à la demande
   suivante — un personnage validé, un décor, un packaging. Plutôt que de
   l'afficher parmi les références de l'avatar (la colonne deviendrait
   illisible), on le choisit dans une fenêtre, et il rejoint « Mes images »
   avec un champ de rôle, comme une photo déposée. */


function fermerChoixRendu() {
  $("choix-rendu").hidden = true;
  document.body.classList.remove("visionneuse-ouverte");
}





;
$("choix-rendu-fermer").onclick = fermerChoixRendu;
$("choix-rendu-voile").onclick = fermerChoixRendu;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("choix-rendu").hidden) { e.stopImmediatePropagation(); fermerChoixRendu(); }
}, true);

/* ---------- La visionneuse ---------- */


function fermerVisionneuse() {
  const v = $("visionneuse");
  if (v.hidden) return;
  v.hidden = true;
  $("visionneuse-media").innerHTML = "";      // arrête une vidéo en cours
  document.body.classList.remove("visionneuse-ouverte");
}

$("visionneuse-voile").onclick = fermerVisionneuse;
$("visionneuse-x").onclick = fermerVisionneuse;
$("visionneuse-fermer").onclick = fermerVisionneuse;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("visionneuse").hidden) { e.stopImmediatePropagation(); fermerVisionneuse(); }
}, true);




/* ---------- Le branchement ---------- */

;
;

;

;

// Entrée envoie, Maj+Entrée va à la ligne.
;

// La zone de saisie grandit avec le texte.
;

/* ---------- Les savoir-faire, en boutons d'amorce ----------

   Chaque savoir-faire du dossier SAVOIR/savoir-faire/ porte un début de
   phrase (« Fais-moi un ref sheet de »). Le bouton l'écrit dans le champ,
   règle le média qui va avec, et laisse l'équipe finir la demande : c'est
   ainsi qu'elle apprend le mot qui déclenche le savoir-faire. */






;

// La recherche dans les conversations.
;

/* ---------- Les jetons du composeur et le panneau ---------- */

;
;
;
;
;

;
;
;
;

// Les sections repliables du panneau.


// Le volet de génération.
;
;
document.addEventListener("keydown", e => {
  ;
});

// Le sélecteur d'avatar d'origine, s'il est réglé ailleurs.

/* Le résumé de la barre suit les réglages. On ajoute un écouteur au lieu
   de remplacer les gestionnaires existants : majModeles() doit s'exécuter
   avant, pour que le résumé lise des valeurs à jour. */




/* ------------------------------------------------------------
   DÉMARRAGE

   marques.js est chargé d'abord, en dur : l'interface s'affiche
   immédiatement même si le serveur tarde. Puis on demande au
   serveur la version augmentée du scan des dossiers, et on remet
   à jour. Une image déposée dans AVATARS/<avatar>/ apparaît donc
   au simple rechargement de la page.
   ------------------------------------------------------------ */




/* ------------------------------------------------------------
   L'AVATAR — le builder (création et modification)

   Trois colonnes : vos avatars à gauche, l'aperçu au centre, les options
   à droite. Chaque option est une tuile ; l'état des tuiles vit dans
   `avChoix`, et tout ce qui se voit (tuiles actives, résumés de section,
   étiquettes de l'aperçu) se redessine à partir de lui.

   Le formulaire écrit la fiche AVATARS/<id>/avatar.json par le serveur,
   et range les photos déposées dans les sous-dossiers de l'avatar. Le
   character sheet, lui, se génère ensuite dans l'atelier, comme
   n'importe quelle image — puis on fait du rendu la planche officielle.
   ------------------------------------------------------------ */

   // les photos déposées, en dataURL
                            // groupe → valeur choisie
                 // « creer » de zéro, ou « importer » un avatar existant
                    // l'avatar en brouillon, créé à la première génération
                         // les planches générées : { fichier, url, promptId }
                   // l'index de celle qui deviendra le character sheet
                         // les photos déjà rangées que l'on a retirées : elles quitteront le dossier













;
;








// Une tuile cliquée : on remonte au groupe, on choisit, on redessine.

// La couleur libre : le nuancier du studio, en direct ; Annuler remet celle d'avant.
;
// L'âge tapé à la main désaccorde les tuiles, sauf s'il tombe juste.
;
// Tout champ texte modifié rafraîchit les résumés et l'aperçu.


// Composer une apparence au hasard, sans toucher au nom ni aux photos.
;

;


;

;

// Fermer quitte la page sans rien jeter : un brouillon reste à reprendre.
;



;


;
// Un clic sur l'image de l'aperçu l'ouvre en grand, dans la visionneuse du studio.
;
;
;
;

;


;
;

/* Le démarrage de Storymatic : ni intro, ni accueil, ni catalogue d'avatars — le projet se charge, puis editeur-stories.js (ou le
   lien d'un jour, parcours.js) ouvre directement son écran ; SM_PRET dit quand le projet est là. */
verifierClaude();
window.SM_PRET = Promise.all([chargerProjets().catch(() => {}),
  fetch("/api/profil").then(r => r.json()).then(p => { window.SM_DA = p.da; window.SM_PROFIL = p; }).catch(() => {})]);



/* ------------------------------------------------------------
   LES FENÊTRES DU STUDIO

   Les confirmations et les messages s'affichent dans une fenêtre aux
   couleurs du studio, jamais dans la boîte grise du navigateur. Elles
   passent une par une : un message qui arrive pendant qu'une autre est
   ouverte attend son tour.
     demander(texte, options)  → Promise<true|false>
     informer(texte, options)  → Promise (se ferme sur OK)
   Options : titre, html (à la place du texte), ok, annuler, danger.
   ------------------------------------------------------------ */

const fenFile = [];
let fenOuverte = false;

/* ============================================================
   LE NUANCIER DU STUDIO

   Remplace le sélecteur de couleur du système (<input type="color">), qui ouvrait une
   petite fenêtre de Windows sans rapport avec l'interface — et dont le déclencheur, un rond
   de la couleur actuelle, ne disait pas qu'il servait à choisir une autre couleur (relevé le
   24 septembre 2026). Un carré saturation / luminosité, une barre de teinte, le code hexa,
   la pipette de l'écran quand le navigateur la connaît, et les dernières couleurs employées.
   La couleur s'applique EN DIRECT (surChange) ; Échap, un clic à côté ou « OK » referment.

   nuancier(ancre, couleur, { titre, surChange, surFin }) — un seul ouvert à la fois.
   boutonAutreCouleur(couleur, estPerso, ouvrir) — le déclencheur : une pastille à anneau
   arc-en-ciel et le mot « Autre ».
   ============================================================ */

const NUANCIER_RECENTES = "studio-couleurs-recentes";
let nuancierOuvert = null;

const nuHex = c => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (m) { let h = m[1]; if (h.length === 3) h = h.replace(/./g, x => x + x); return "#" + h.toLowerCase(); }
  const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(c || ""));
  return r ? "#" + [r[1], r[2], r[3]].map(x => Number(x).toString(16).padStart(2, "0")).join("") : null;
};
function nuVersHsv(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function nuDepuisHsv(h, s, v) {
  const f = k => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return "#" + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}
function nuRecentes() { try { return JSON.parse(localStorage.getItem(NUANCIER_RECENTES) || "[]").filter(nuHex).slice(0, 8); } catch (e) { return []; } }
function nuRetenir(hex) {
  try { localStorage.setItem(NUANCIER_RECENTES, JSON.stringify([hex, ...nuRecentes().filter(x => x !== hex)].slice(0, 8))); } catch (e) { /* le navigateur refuse : tant pis */ }
}

function fermerNuancier() { if (nuancierOuvert) nuancierOuvert.fermer(); }

function nuancier(ancre, couleur, o) {
  fermerNuancier();
  o = o || {};
  let hex = nuHex(couleur) || "#f97316";
  let { h, s, v } = nuVersHsv(hex);
  const depart = hex;

  const el = document.createElement("div");
  el.className = "nu";
  el.setAttribute("role", "dialog");
  el.innerHTML =
    '<div class="nu-tete"><span>' + echapper(o.titre || "Couleur personnalisée") + '</span></div>' +
    '<div class="nu-sv"><i class="nu-curseur"></i></div>' +
    '<div class="nu-teinte"><i class="nu-curseur"></i></div>' +
    '<div class="nu-ligne"><span class="nu-apercu"></span><input class="nu-hexa" maxlength="7" spellcheck="false" aria-label="Code de la couleur">' +
      (window.EyeDropper ? '<button type="button" class="nu-pipette" title="Prendre une couleur à l\'écran"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/></svg></button>' : "") +
    '</div>' +
    '<div class="nu-recentes-bloc"><span>Récentes</span><div class="nu-recentes"></div></div>' +
    '<div class="nu-pied"><button type="button" class="btn-mini nu-annuler">Annuler</button><button type="button" class="btn-mini btn-mini-fort nu-ok">OK</button></div>';
  document.body.appendChild(el);

  const sv = el.querySelector(".nu-sv"), svC = sv.querySelector(".nu-curseur");
  const te = el.querySelector(".nu-teinte"), teC = te.querySelector(".nu-curseur");
  const champ = el.querySelector(".nu-hexa"), apercu = el.querySelector(".nu-apercu");

  const dessiner = (depuisChamp) => {
    sv.style.background = "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, " + nuDepuisHsv(h, 1, 1) + ")";
    svC.style.left = (s * 100) + "%"; svC.style.top = ((1 - v) * 100) + "%"; svC.style.background = hex;
    teC.style.left = (h / 360 * 100) + "%"; teC.style.background = nuDepuisHsv(h, 1, 1);
    apercu.style.background = hex;
    if (!depuisChamp) champ.value = hex.toUpperCase();
  };
  let touche = false;
  const appliquer = (depuisChamp) => { dessiner(depuisChamp); touche = true; if (o.surChange) o.surChange(hex); };

  // Glisser dans le carré, ou sur la barre de teinte.
  const glisser = (zone, fn) => zone.addEventListener("pointerdown", e => {
    e.preventDefault(); zone.setPointerCapture(e.pointerId);
    const bouge = ev => { const b = zone.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height))); appliquer(); };
    bouge(e);
    zone.onpointermove = bouge;
    zone.onpointerup = () => { zone.onpointermove = null; zone.onpointerup = null; };
  });
  glisser(sv, (x, y) => { s = x; v = 1 - y; hex = nuDepuisHsv(h, s, v); });
  glisser(te, x => { h = Math.min(359.9, x * 360); hex = nuDepuisHsv(h, s, v); });

  champ.addEventListener("input", () => {
    const c = nuHex(champ.value.startsWith("#") ? champ.value : "#" + champ.value);
    if (!c || champ.value.replace("#", "").length < 6) return;
    hex = c; ({ h, s, v } = nuVersHsv(hex)); appliquer(true);
  });
  champ.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); fermer(true); } });

  const pip = el.querySelector(".nu-pipette");
  if (pip) pip.onclick = async () => {
    try { const r = await new window.EyeDropper().open(); const c = nuHex(r.sRGBHex); if (c) { hex = c; ({ h, s, v } = nuVersHsv(hex)); appliquer(); } }
    catch (e) { /* Échap pendant la pipette : rien */ }
  };

  const rec = el.querySelector(".nu-recentes"), recentes = nuRecentes();
  el.querySelector(".nu-recentes-bloc").hidden = !recentes.length;
  recentes.forEach(c => {
    const b = document.createElement("button"); b.type = "button"; b.className = "nu-pastille"; b.style.background = c; b.title = c.toUpperCase();
    b.onclick = () => { hex = c; ({ h, s, v } = nuVersHsv(hex)); appliquer(); };
    rec.appendChild(b);
  });

  // Placer la fenêtre contre son déclencheur, sans sortir de l'écran.
  const placer = () => {
    const a = ancre.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    let x = a.left + a.width / 2 - w / 2, y = a.bottom + 10;
    if (y + hh > innerHeight - 12) y = Math.max(12, a.top - hh - 10);
    el.style.left = Math.round(Math.min(innerWidth - w - 12, Math.max(12, x))) + "px";
    el.style.top = Math.round(y) + "px";
  };

  function fermer(garder) {
    if (nuancierOuvert !== ctl) return;
    nuancierOuvert = null;
    window.removeEventListener("keydown", clavier, true);
    window.removeEventListener("pointerdown", dehors, true);
    window.removeEventListener("resize", placer);
    if (garder === false) { if (touche) { if (o.surAnnule) o.surAnnule(); else if (o.surChange) o.surChange(depart); } hex = depart; }
    else if (hex !== depart) nuRetenir(hex);
    el.classList.add("nu-sort");
    setTimeout(() => el.remove(), 110);
    if (o.surFin) o.surFin(hex, hex !== depart);
  }
  const clavier = e => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fermer(false); } };
  const dehors = e => { if (!el.contains(e.target) && !ancre.contains(e.target)) fermer(true); };
  el.querySelector(".nu-ok").onclick = () => fermer(true);
  el.querySelector(".nu-annuler").onclick = () => fermer(false);
  window.addEventListener("keydown", clavier, true);
  setTimeout(() => window.addEventListener("pointerdown", dehors, true), 0);
  window.addEventListener("resize", placer);

  const ctl = { fermer: fermer, el: el };
  nuancierOuvert = ctl;
  dessiner();
  placer();
  return ctl;
}

// Le déclencheur : il DIT qu'il ouvre une autre couleur. Une couleur perso en cours se voit au centre.
function boutonAutreCouleur(couleur, estPerso, ouvrir) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "nu-autre" + (estPerso ? " on" : "");
  b.title = "Choisir une couleur personnalisée";
  b.innerHTML = '<span class="nu-anneau"><i></i></span>Autre';
  if (estPerso && couleur) b.querySelector(".nu-anneau i").style.background = couleur;
  b.onclick = () => ouvrir(b);
  return b;
}

function fenetreStudio(o) {
  return new Promise(resolve => { fenFile.push({ o: o, resolve: resolve }); fenSuivante(); });
}

function fenSuivante() {
  if (fenOuverte || !fenFile.length) return;
  const { o, resolve } = fenFile.shift();
  fenOuverte = true;

  // Un texte sans titre : sa première ligne devient le titre.
  let titre = o.titre || "";
  let texte = o.texte == null ? "" : String(o.texte);
  if (!titre && !o.html) {
    const i = texte.indexOf("\n");
    if (i > 0 && i < 90) { titre = texte.slice(0, i); texte = texte.slice(i).trim(); }
    else if (texte.length < 90) { titre = texte; texte = ""; }
  }
  const danger = o.danger != null ? o.danger : /^Supprimer/i.test(titre);

  const el = document.createElement("div");
  el.className = "fen";
  el.innerHTML =
    '<div class="fen-voile"></div>' +
    '<div class="fen-boite" role="dialog" aria-modal="true">' +
      (titre ? '<h3 class="fen-titre"></h3>' : "") +
      '<div class="fen-texte"></div>' +
      '<div class="fen-actions">' +
        (o.annuler === false ? "" : '<button type="button" class="fen-bouton fen-non"></button>') +
        (o.tiers ? '<button type="button" class="fen-bouton fen-non fen-tiers"></button>' : "") +
        '<button type="button" class="fen-bouton fen-oui' + (danger ? " fen-danger" : "") + '"></button>' +
      "</div>" +
    "</div>";
  if (titre) el.querySelector(".fen-titre").textContent = titre;
  const zone = el.querySelector(".fen-texte");
  if (o.html) zone.innerHTML = o.html; else zone.textContent = texte;
  zone.hidden = !o.html && !texte && !o.prepare;
  el.querySelector(".fen-oui").textContent = o.ok || "OK";
  const non = el.querySelector(".fen-non:not(.fen-tiers)");
  if (non) non.textContent = o.annuler || "Annuler";
  /* Une TROISIÈME issue, quand la question n'est pas oui/non mais « par quel
     chemin ? ». Elle rend la chaîne "tiers" : ni true, ni false. */
  const tiers = el.querySelector(".fen-tiers");
  if (tiers) { tiers.textContent = o.tiers; tiers.onclick = () => fermer("tiers"); }

  const clavier = e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fermer(o.annuler === false); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); fermer(true); }
  };
  const fermer = valeur => {
    document.removeEventListener("keydown", clavier, true);
    el.classList.add("fen-sort");
    setTimeout(() => el.remove(), 120);
    fenOuverte = false;
    resolve(valeur);
    fenSuivante();
  };
  el.querySelector(".fen-oui").onclick = () => fermer(true);
  if (non) non.onclick = () => fermer(false);
  el.querySelector(".fen-voile").onclick = () => fermer(o.annuler === false);
  document.addEventListener("keydown", clavier, true);
  document.body.appendChild(el);
  /* Une fenêtre qui demande un mot garnit elle-même sa zone de texte et rend le
     champ à mettre sous le curseur — sinon c'est le bouton « OK » qui l'a. */
  const aFocus = typeof o.prepare === "function" ? o.prepare(zone) : null;
  (aFocus || el.querySelector(".fen-oui")).focus();
}

function demander(texte, o) {
  return fenetreStudio(Object.assign({ texte: texte, ok: "Confirmer", annuler: "Annuler" }, o || {}));
}
function informer(texte, o) {
  return fenetreStudio(Object.assign({ texte: texte, ok: "OK", annuler: false }, o || {}));
}

/* Demander un mot, sans le prompt() du navigateur : rend la chaîne saisie, ou
   null si on annule ou si on la vide. `o` : { texte, ok, exemple, max }. */
function saisir(titre, valeur, o) {
  let champ = null;
  return fenetreStudio(Object.assign({ titre: titre, ok: "Valider", annuler: "Annuler" }, o || {}, {
    prepare: zone => {
      champ = document.createElement("input");
      champ.type = "text";
      champ.className = "fen-champ";
      champ.value = valeur == null ? "" : String(valeur);
      champ.maxLength = (o && o.max) || 120;
      if (o && o.exemple) champ.placeholder = o.exemple;
      zone.appendChild(champ);
      requestAnimationFrame(() => champ.select());
      return champ;
    }
  })).then(ok => {
    const v = champ ? champ.value.trim() : "";
    return ok && v ? v : null;
  });
}

/* ============================================================
   LES ENVIRONNEMENTS — la page « Créer un environnement »

   La réplique du builder d'avatar, pour le savoir-faire Environnement.
   Un lieu n'appartient à AUCUN avatar : une fois enregistré, il rejoint la
   bibliothèque commune ENVIRONNEMENTS/ et apparaît dans l'atelier, section
   Environnements, quel que soit l'avatar choisi. Tout est borné à #lieu-form : les tuiles, les sections
   et les résumés ne se mêlent jamais à ceux du builder d'avatar.

   Le travail en cours (choix, inspirations envoyées, versions générées) est
   gardé dans le navigateur : on le retrouve après avoir fermé le studio.
   ------------------------------------------------------------ */

          // groupe → valeur choisie
         // les inspirations : { cle, nom, donnees|url, description, fichier? }
       // les versions générées : { fichier, url, promptId } (existant : l'image enregistrée)
      // { id, auto } quand on rouvre un lieu enregistré
let lxGenEnCours = false, lxEnCours = false;
const lx = sel => document.querySelector("#lieu-form " + sel);
;

// L'aperçu du lieu s'agrandit d'un clic, comme celui de l'avatar.
;



/* ---------- Les tuiles ---------- */





/* ---------- L'aperçu, les versions, la liste ---------- */




/* ---------- Les inspirations ---------- */






/* ---------- L'état : le lieu, les boutons, la mémoire ---------- */




;
;
;


/* ---------- Ouvrir la page ---------- */






/* ---------- Les tuiles, au clic ---------- */




// Au hasard : un lieu complet, dans l'espace choisi s'il y en a un.
;

;

;

/* ---------- Générer ---------- */

;
;

/* ---------- Enregistrer, supprimer ---------- */

;

;

;

/* ------------------------------------------------------------
   LES PROJETS

   Un projet est un espace de travail fermé : l'atelier, l'historique, les
   rendus, les imports et les environnements lui appartiennent (le serveur
   range tout dans PROJETS/<projet>/). Les avatars sont communs. Changer de
   projet recharge la page : tout l'état du navigateur repart de zéro, sans
   l'intro.
   ------------------------------------------------------------ */

          // l'identifiant du projet en cours de réglage, null pour un nouveau

function poserCookieProjet(id) {
  document.cookie = "projet=" + encodeURIComponent(id) + "; path=/; max-age=31536000; samesite=lax";
}

// Même règle que synchroniserMarques : un second appel pendant le premier le rejoint (projetsEnCours : en tête du fichier).
function chargerProjets() {
  if (!projetsEnCours) projetsEnCours = chargerProjetsVraiment().finally(() => { projetsEnCours = null; });
  return projetsEnCours;
}
async function chargerProjetsVraiment() {
  try {
    const d = await (await fetch("/api/projets")).json();
    if (!d || d.erreur) throw new Error(d && d.erreur);
    PROJETS = Array.isArray(d.projets) ? d.projets : [];
    PROJET = PROJETS.find(p => p.id === d.actif) || PROJETS[0] || null;
    // Le projet vu par le serveur devient celui du navigateur : il ne dérive plus.
    if (PROJET) poserCookieProjet(PROJET.id);
  } catch (e) { /* le studio reste utilisable, sans liste de projets */ }
  rendreProjetChoisi();
  return PROJETS;
}

function rendreProjetChoisi() {
  ;
  ;
}






/* ---------- Le menu du sélecteur ---------- */



;
document.addEventListener("click", e => {
  ;
});


/* ---------- La page d'un projet ---------- */



;
;

;

;




/* ------------------------------------------------------------
   LA PAGE « PACKSHOTS »

   La réplique du builder pour le savoir-faire Packshot : une photo de
   produit mise en scène. Le produit est décrit (et son étiquette écrite mot
   pour mot) ou donné en photo ; la mise en scène se compose en tuiles. Les
   versions vont dans RENDUS/packshots/ ; celle qu'on garde rejoint les
   packshots du projet et devient une référence produit dans l'atelier.
   Tout est borné à #packshot-form. Le travail en cours est gardé dans le
   navigateur, projet par projet.
   ------------------------------------------------------------ */

           // groupe → valeur choisie
         // les photos du vrai produit : { cle, nom, donnees|url, description, fichier? }
          // les inspirations
        // les versions générées : { fichier, url, promptId } (existant : l'image gardée)
       // { id } quand on rouvre un packshot gardé
let pxGenEnCours = false, pxEnCours = false;
const px = sel => document.querySelector("#packshot-form " + sel);
;

// L'aperçu s'agrandit d'un clic.
;






/* ---------- L'aperçu, les versions, la liste ---------- */





/* ---------- Les photos du produit et les inspirations ---------- */






/* ---------- L'état : le packshot, les boutons, la mémoire ---------- */




;
;
;


/* ---------- Ouvrir la page ---------- */






/* ---------- Les tuiles, au clic ---------- */




// Au hasard : une mise en scène complète (le produit, lui, reste à vous).
;

;

;

/* ---------- Générer ---------- */

;
;

/* ---------- Garder, supprimer ---------- */

;

;

;

/* ------------------------------------------------------------
   LES RÉGLAGES DE GÉNÉRATION DES BUILDERS

   Chaque .rg-tuile habille un <select> : un bouton (icône, intitulé,
   valeur) et un menu aux couleurs du studio, avec la note de chaque
   option (data-note). Le select reste la source de vérité : on lit ses
   options, on écrit sa valeur et on déclenche « change ». Le code qui
   remplit ou change ces selects n'a donc pas bougé — la tuile suit,
   même quand il écrit .value directement.

   Le menu est posé au-dessus de toute la page (position fixe, dans
   <body>) : la colonne centrale des builders défile et le couperait.
   ------------------------------------------------------------ */

          // la tuile dont le menu est ouvert


// Un clic ailleurs, Échap, un défilement ou un redimensionnement ferment le menu.







/* ------------------------------------------------------------
   LE HASARD, AUSSI DANS LES ZONES DE TEXTE

   Le bouton « flèches croisées » des builders tire les tuiles ; ces
   fonctions remplissent ensuite les champs de texte, ACCORDÉS aux tuiles
   tirées : un prénom qui suit le genre, une signature qui suit le style,
   un nom de lieu et une phrase faits du type, du style, du moment et de
   la lumière, un produit inventé complet et cohérent. Tout est local :
   le tirage est instantané et ne coûte rien.
   ------------------------------------------------------------ */


/* ---------- L'avatar ---------- */



/* ---------- L'environnement ---------- */



/* ---------- Le packshot : un produit inventé, complet et cohérent ---------- */



/* ------------------------------------------------------------
   LES ZONES DE TEXTE DES BUILDERS GRANDISSENT AVEC LEUR TEXTE

   Tout ce qui est écrit se voit en entier, sans barre de défilement : la
   hauteur suit le contenu, qu'il soit tapé, tiré au hasard ou rempli par
   le code (rouvrir un avatar, un lieu, un packshot). Les champs « une
   phrase » (.bs-phrase) restent un seul paragraphe : Entrée n'y ajoute
   pas de ligne.
   ------------------------------------------------------------ */





// Une section qu'on ouvre, une page qui s'affiche, une fenêtre qui change de taille.





/* ------------------------------------------------------------
   « VOS ENVIRONNEMENTS » ET « VOS PACKSHOTS »

   Les galeries du projet, bâties comme « Vos avatars » : les boutons
   Environnements et Packshots de la barre du haut y mènent. Une carte
   s'ouvre dans sa page pour être modifiée ; la croix la met à la
   corbeille du projet (rien n'est effacé). Le travail en cours, gardé
   dans le navigateur, apparaît comme un brouillon qu'on reprend d'un clic.
   ------------------------------------------------------------ */




/* ---------- Les environnements ---------- */



/* ---------- Les packshots ---------- */





;
;
;
;


