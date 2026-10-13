/* STORYMATIC (ex Storymatic, 7 oct. 2026) — l'éditeur de stories de l'outil (page /editeur).
   On n'y entre que par « Ma semaine » : un jour (?pub=<id>, ouvert par parcours.js) ou la DA Story (?da=story). Sans l'un des
   deux, on revient à la semaine. app.js ne laisse paraître que ces deux écrans (SM_ECRANS) ; tout le reste ramène à la semaine. */
(function () {
  const q = new URLSearchParams(location.search);
  const semaine = q.get("semaine");
  const versSemaine = "/" + (semaine ? "?semaine=" + encodeURIComponent(semaine) : "");
  if (!q.get("pub") && !q.get("da")) { location.replace(versSemaine); return; }

  // tout ce qui ramenait à l'accueil du studio ramène à la semaine
  window.rendreAccueil = () => { location.href = versSemaine; };
  const brand = document.getElementById("brand");
  if (brand) brand.onclick = e => { e.preventDefault(); location.href = versSemaine; };

  // la DA des stories : sa planche, dès que le catalogue est chargé (le lien d'un jour pose son propre bouton de retour)
  if (q.get("da")) document.addEventListener("DOMContentLoaded", async () => {
    const a = document.createElement("a");
    a.className = "sc-retour"; a.href = versSemaine; a.textContent = "← Ma semaine";
    document.body.appendChild(a);
    try { await window.SM_PRET; await ouvrirDAs({ id: window.SM_DA, sous: "story" }); } catch (e) {}
  });
})();
