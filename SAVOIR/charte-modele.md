# Écrire la charte d'un créateur d'après ses carrousels (ou ses stories)

Tiré d'une vraie charte de carrousels (30 sept. 2026), écrite à la main puis
vérifiée sur des slides composées par le studio. « Apprendre mon style » (apprendre.js) s'en sert pour écrire la charte
d'une sous-DA Carrousel ou Story à partir des publications que la personne a glissées.

La charte est lue EN ENTIER par Claude à chaque plan et à chaque mise en page : elle fait autorité sur la mise en page et
passe avant les règles générales. Elle doit donc être PRÉCISE (des px, des #hex, des CSS copiables) et ne rien dire de faux.

## Ce qu'elle contient, dans cet ordre

1. **Un titre et deux lignes** : « La charte des carrousels de <nom> », d'après combien de publications, le format
   (1080 × 1350 px pour un carrousel, 1080 × 1920 px pour une story), et la phrase : « Elle fait autorité sur la mise en
   page ; les couleurs et les polices viennent de la DA. »
2. **Le fond** : ce qu'il y a derrière TOUTES les slides (couleur, texture de la DA si la personne en a une), et ce qui
   n'y est JAMAIS (dégradé, voile, fond d'une autre couleur, grand chiffre ou mot géant pâle en décor…). Au plan,
   « couleur » vaut « fond » ou « accent » : dire lequel sert, et quand.
3. **Les polices et les tailles** : pour chaque rôle (titre de la slide 1, titre des autres slides, paragraphe, encadrés,
   petits textes), la police (celle de la DA : « police titres » / « police texte »), la graisse, la taille en px (une
   fourchette), l'alignement, l'interligne, la casse. Les MOTS MIS EN VALEUR : comment (italique d'une autre police,
   couleur, surlignage, graisse), combien par phrase. La couleur de chaque texte. Un effet (ombre, relief, contour) en
   CSS exact s'il existe.
4. **Les composants** : chaque bloc qui revient, numéroté, avec son RÔLE (quand l'employer), sa construction en CSS
   copiable (fond, bordure, arrondi, marges internes, police, taille, couleur, ombre, largeur max) et sa place.
   Exemples de composants : encadré, bulle de BD, carte GIF (bandeau + image), fenêtre d'application, étiquette, badge,
   cadre photo, liste numérotée, flèche. Un composant qui est une IMAGE de la DA (un élément : patch, sticker, flèche
   peinte, logo) se pose TOUJOURS par son image, jamais redessiné en CSS, en SVG ou en caractère : le dire. Si du texte
   se pose SUR une image (une bulle en papier, une carte en tissu), l'image porte l'attribut `data-decor` et la charte
   donne la zone exacte du texte (left/right/top/bottom en px ou en %).
5. **La grammaire d'une slide du corps** : de haut en bas, l'ordre des blocs, les marges (px), l'espace entre blocs,
   l'alignement, ce qui peut remplacer quoi. Combien de place reste vide.
6. **La slide 1 (l'accroche)** : sa construction exacte, bloc par bloc, et ce que son « texte » doit porter au plan.
7. **La dernière slide** : sa construction exacte, l'appel, et la SIGNATURE de la personne si elle revient (une phrase,
   une bulle, un GIF) — recopiée mot pour mot.
8. **Le texte** : les habitudes d'écriture visibles sur les slides (censure des gros mots, emoji ou non, ponctuation,
   chiffres en chiffres, capitales, tutoiement).

## Les règles pour l'écrire

- Tout ce qui est écrit doit se VOIR sur les slides regardées. Rien d'inventé : un composant vu une seule fois est dit
  « parfois », un réglage incertain est donné en fourchette. Jamais « à peu près » sans chiffre.
- Des mesures : en px sur la slide entière (1080 de large). Des couleurs : en #hex. Des CSS : copiables tels quels.
- Nommer les éléments de la DA par leur NOM EXACT (celui de la liste des éléments), entre guillemets : « Flèche orange »,
  « Patch Heureux (tortue) ». Dire pour chacun sa place et sa taille.
- Ce qui n'apparaît JAMAIS est aussi important que ce qui apparaît : les couleurs qui ne servent qu'à un détail, les
  ornements absents, les mots jamais colorés… Un « jamais » évite les fautes les plus fréquentes du studio (fond de la
  couleur d'accent, mots en couleur, flèche dessinée, grand chiffre décoratif, texte qui déborde d'une image).
- On n'y recopie aucune phrase des slides, sauf la signature de la personne et les étiquettes fixes (« SPOILER »,
  « Commente : »), qui font partie du style.
- Français, phrases courtes, en Markdown (titres ##, listes). 5 000 à 12 000 caractères.
