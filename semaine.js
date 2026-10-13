/* ============================================================
   MA SEMAINE DE STORIES — côté serveur
   ------------------------------------------------------------
   La semaine type de la personne (MON-PROFIL/semaine-type.md, profil.js) donne un RÔLE à chaque jour posté ; elle écrit
   l'actu de la semaine et dépose sa matière (captures, preuves) ; Claude écrit le brief de chaque jour (une seule demande),
   puis chaque jour devient une suite de stories (publication « stories », à SA DA) dont le plan et la mise en page sont
   faits par l'éditeur. Aucune image n'est générée : les photos viennent de SA BANQUE, de ses captures et de ses vidéos.

   Tout vit dans le projet du profil (« mes-stories ») :
     SEMAINES/<semaine>/semaine.json   l'actu, les briefs, les publications de chaque jour, la tâche en cours
     RENDUS/semaines/<semaine>/        la matière de la semaine (servie comme un rendu, donc donnable aux stories)
     RENDUS/banque/                    la banque d'images de l'avatar, et banque.json (leurs descriptions)
   Ce qui part sur Instagram est rangé à la racine de l'outil : A POSTER/<compte>/Semaine du <lundi>/<n - Jour>/ + programme.txt.
   Rien ici ne dépense un crédit : Claude (Read seul, sans MCP) et le navigateur du poste.
   ============================================================ */
const fs = require('fs'), path = require('path');

module.exports = function creerSemaine(D) {
  // le projet et la DA viennent du profil (profil.js) ; ROLES : les rôles de sa semaine type
  const P = D.profil, PROJET = () => P.projet(), DA = () => P.assurerDA();
  const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const NOMS = { lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi', vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche' };
  const ROLES = () => { const j = P.jours(); return Object.fromEntries(JOURS.map(x => [x, (j[x] && j[x].role) || 'Libre'])); };
  const IMAGES = ['.png', '.jpg', '.jpeg', '.webp'];
  const TACHES = new Map();   // semaine → true pendant qu'une tâche tourne

  const projet = () => path.join(D.RACINE, 'PROJETS', PROJET());
  const dossierSemaines = () => path.join(projet(), 'SEMAINES');
  const dossierSemaine = s => path.join(dossierSemaines(), s);
  const fichierSemaine = s => path.join(dossierSemaine(s), 'semaine.json');
  const dossierMatiere = s => path.join(projet(), 'RENDUS', 'semaines', s);
  const dossierBanque = () => path.join(projet(), 'RENDUS', 'banque');
  const fichierBanque = () => path.join(dossierBanque(), 'banque.json');
  const idSemaine = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
  const enProjet = fn => D.enProjet(PROJET(), fn);

  /* Le projet existe d'office (au premier lancement) : c'est le seul de l'outil. */
  function assurerProjet() {
    if (!fs.existsSync(path.join(projet(), 'projet.json'))) {
      const p = P.lire();
      D.creerProjet({ nom: 'Mes stories', avatars: [],
        brief: 'Les stories Instagram de ' + (p.prenom || 'la personne') + (p.compte ? ' (' + p.compte + ')' : '') + ', une semaine à la fois, d\'après sa semaine type.' }, PROJET());
    }
    [dossierSemaines(), dossierBanque()].forEach(d => fs.mkdirSync(d, { recursive: true }));
  }

  // ---- la date : une semaine commence un lundi, on la nomme par sa date (AAAA-MM-JJ)
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function lundiDe(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function dateDuJour(semaine, jour) {
    const [a, m, j] = semaine.split('-').map(Number), d = new Date(a, m - 1, j + JOURS.indexOf(jour));
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ---- la banque d'images de l'avatar
  function lireBanque() {
    let liste = [];
    try { liste = JSON.parse(fs.readFileSync(fichierBanque(), 'utf8')); } catch (e) {}
    let fichiers = [];
    try { fichiers = fs.readdirSync(dossierBanque()).filter(f => IMAGES.includes(path.extname(f).toLowerCase())); } catch (e) {}
    // une image déposée à la main dans le dossier y entre d'office, sans description
    const vues = liste.filter(x => fichiers.includes(x.fichier));
    fichiers.filter(f => !vues.some(x => x.fichier === f)).forEach(f => vues.push({ fichier: f, description: '' }));
    return vues;
  }
  const ecrireBanque = l => D.ecrireJsonSurement(fichierBanque(), l);

  /* ---- SES CAPTURES : le dossier « MES CAPTURES » à la racine de l'outil (son produit, ses outils, ses écrans), rempli par la
     page (glisser-déposer) ou à la main. captures.json décrit chacune (Claude les décrit d'un clic) ; une capture sans
     description est nommée par son fichier. Claude les pose (jamais en fond) sur les stories qui en parlent : clés C1… */
  const dossierCaptures = () => path.join(D.RACINE, 'MES CAPTURES', P.id());   // un sous-dossier par profil
  function lireCaptures() {
    let liste = [], fichiers = [];
    try { liste = JSON.parse(fs.readFileSync(path.join(dossierCaptures(), 'captures.json'), 'utf8')); } catch (e) {}
    try { fichiers = fs.readdirSync(dossierCaptures()).filter(f => IMAGES.includes(path.extname(f).toLowerCase())).sort(); } catch (e) {}
    return fichiers.map(f => ({ fichier: f, description: ((liste.find(x => x.fichier === f) || {}).description) || path.basename(f, path.extname(f)).replace(/[-_]+/g, ' ') }));
  }
  /* ---- SES VIDÉOS (Reels, résultats, démos) : le dossier « MES VIDEOS », décrit par videos.json. Clés V1… : posées en grand sur
     la story qui en parle (une story vidéo, exportée en MP4). Jamais une story qui annonce une preuve sans la montrer. */
  const dossierVideos = () => path.join(D.RACINE, 'MES VIDEOS', P.id());
  function lireVideos() {
    let liste = [], fichiers = [];
    try { liste = JSON.parse(fs.readFileSync(path.join(dossierVideos(), 'videos.json'), 'utf8')); } catch (e) {}
    try { fichiers = fs.readdirSync(dossierVideos()).filter(f => ['.mp4', '.mov', '.webm', '.m4v'].includes(path.extname(f).toLowerCase())).sort(); } catch (e) {}
    return fichiers.map(f => ({ fichier: f, description: ((liste.find(x => x.fichier === f) || {}).description) || path.basename(f, path.extname(f)).replace(/[-_]+/g, ' ') }));
  }
  function captureEnDonnees(f) {
    const ext = path.extname(f).toLowerCase(), type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return 'data:' + type + ';base64,' + fs.readFileSync(path.join(dossierCaptures(), f)).toString('base64');
  }

  const VIDEOS_EXT = ['.mp4', '.mov', '.webm', '.m4v'];
  const fichierRayon = r => path.join(r === 'captures' ? dossierCaptures() : dossierVideos(), r === 'captures' ? 'captures.json' : 'videos.json');
  function lireDescriptions(r) { try { return JSON.parse(fs.readFileSync(fichierRayon(r), 'utf8')); } catch (e) { return []; } }
  /** Retoucher la description d'une capture ou d'une vidéo, ou la retirer (vers _corbeille). */
  function majRayon(r, fichier, d) {
    const dos = path.dirname(fichierRayon(r)), l = lireDescriptions(r).filter(x => x && x.fichier);
    if (!fichier || fichier.includes('/') || fichier.includes('\\') || !fs.existsSync(path.join(dos, fichier))) throw new Error('Fichier introuvable.');
    if (d.retirer) { const c = path.join(dos, '_corbeille'); fs.mkdirSync(c, { recursive: true }); fs.renameSync(path.join(dos, fichier), path.join(c, fichier)); D.ecrireJsonSurement(fichierRayon(r), l.filter(x => x.fichier !== fichier)); return; }
    const e = l.find(x => x.fichier === fichier); const desc = String(d.description || '').trim().slice(0, 300);
    if (e) e.description = desc; else l.push({ fichier, description: desc });
    D.ecrireJsonSurement(fichierRayon(r), l);
  }
  /** Claude décrit les captures (il les regarde) ou les vidéos (trois images de chacune) qui n'ont pas de description. */
  async function decrireRayon(r) {
    const capt = r === 'captures', dos = path.dirname(fichierRayon(r)), connues = lireDescriptions(r).filter(x => x && x.fichier && x.description);
    const liste = (capt ? lireCaptures() : lireVideos()).filter(x => !connues.some(y => y.fichier === x.fichier));
    if (!liste.length) return capt ? lireCaptures() : lireVideos();
    const images = {};
    if (capt) liste.forEach(x => { images[x.fichier] = [path.join(dos, x.fichier)]; });
    else {
      const t = path.join(D.RACINE, 'CACHE', 'videos-' + Date.now().toString(36)); fs.mkdirSync(t, { recursive: true });
      for (const x of liste) {
        images[x.fichier] = [];
        for (const k of [0.15, 0.5, 0.85]) {
          const j = path.join(t, x.fichier.replace(/[^a-zA-Z0-9]/g, '_') + '-' + k + '.jpg');
          try { await D.imageDeVideo(path.join(dos, x.fichier), k, j); images[x.fichier].push(j); } catch (e) {}
        }
      }
    }
    const p = P.lire();
    const consigne = [
      'Tu décris ' + (capt ? 'des CAPTURES D\'ÉCRAN' : 'des VIDÉOS (trois images de chacune : début, milieu, fin)') + ' de ' + (p.prenom || 'la personne') + (p.offre.nom ? ', qui vend ' + p.offre.nom : '') + ', pour qu\'un rédacteur de stories Instagram sache quand les montrer.',
      '- Ici RIEN ne se génère : tu n\'appelles aucun outil, tu ne dépenses aucun crédit. Tu ouvres les images (Read), c\'est tout.',
      '- Pour chacune, UNE phrase en français, 200 caractères au plus : ce qu\'on y voit et à quoi ça sert (« l\'écran où on choisit son avatar », « un Reel fini : une mamie qui casse un pare-brise »).',
      'Tu réponds UNIQUEMENT du JSON strict, sur une ligne : {"fichiers":[{"fichier":"…","description":"…"}]}'
    ].join('\n');
    const q = 'À DÉCRIRE :\n' + liste.map(x => '  - ' + x.fichier + ' : ' + images[x.fichier].join(' ; ')).join('\n');
    const rep = await D.interroger(q, consigne, null, 1, D.DELAI_MAX, { args: ['--strict-mcp-config'] });
    let j = null; try { j = JSON.parse(D.premierObjetJson(rep.texte || '')); } catch (e) {}
    const l = lireDescriptions(r).filter(x => x && x.fichier);
    ((j && j.fichiers) || []).forEach(x => { if (!x || !x.description || !liste.some(y => y.fichier === x.fichier)) return;
      const e = l.find(y => y.fichier === x.fichier); if (e) e.description = String(x.description).slice(0, 300); else l.push({ fichier: x.fichier, description: String(x.description).slice(0, 300) }); });
    D.ecrireJsonSurement(fichierRayon(r), l);
    return capt ? lireCaptures() : lireVideos();
  }

  async function decrireBanque() {
    const l = lireBanque(), sans = l.filter(x => !x.description);
    if (!sans.length) return l;
    const consigne = [
      'Tu décris les photos de ' + (P.lire().prenom || 'la personne') + ' (' + ({ jamais: 'des scènes de sa vie de tous les jours, sans personne visible', visage: 'sa vie, son travail, parfois elle-même', avatar: 'son avatar IA et son quotidien' }[P.lire().presence] || 'son quotidien') + '), pour qu\'un rédacteur choisisse la bonne photo de fond pour une story Instagram.',
      '- Ici RIEN ne se génère : tu n\'appelles aucun outil de Magnific ni de Higgsfield, tu ne dépenses aucun crédit. Tu lis (Read), c\'est tout.',
      '- Ouvre chaque image avec Read. Pour chacune, UNE phrase en français, 160 caractères au plus : le lieu, le moment de la journée, ce qu\'on voit, la lumière, l\'humeur (« matin », « soir », « pluie », « ordi »…).',
      'Tu réponds UNIQUEMENT du JSON strict, sur une ligne : {"images":[{"fichier":"…","description":"…"}]}'
    ].join('\n');
    const q = 'LES IMAGES À DÉCRIRE :\n' + sans.map(x => '  - ' + x.fichier + ' : ' + path.join(dossierBanque(), x.fichier)).join('\n');
    const r = await D.interroger(q, consigne, null, 1, D.DELAI_MAX, { args: ['--strict-mcp-config'] });
    let j = null; try { j = JSON.parse(D.premierObjetJson(r.texte || '')); } catch (e) {}
    (j && j.images || []).forEach(x => { const e = l.find(y => y.fichier === x.fichier); if (e && x.description) e.description = String(x.description).slice(0, 200); });
    ecrireBanque(l);
    return l;
  }

  // ---- une semaine
  function semaineVide(s) {
    return { id: s, cree: new Date().toISOString(), actu: '', matiere: [],
      jours: (() => { const R = ROLES(), p = P.lire(), J = P.jours(); return JOURS.map(j => ({ jour: j, role: R[j], brief: '', nb: p.rythme.jours[j] && J[j] ? Math.round((p.rythme.min + p.rythme.max) / 2) : 0, medias: [], appel: '', heure: '', pubId: null, etat: 'vide', erreur: '' })); })() };
  }
  function lireSemaine(s) {
    if (!idSemaine(s)) return null;
    try { return JSON.parse(fs.readFileSync(fichierSemaine(s), 'utf8')); } catch (e) { return null; }
  }
  function ecrireSemaine(sem) { fs.mkdirSync(dossierSemaine(sem.id), { recursive: true }); D.ecrireJsonSurement(fichierSemaine(sem.id), sem); return sem; }
  function listeSemaines() {
    let l = [];
    try { l = fs.readdirSync(dossierSemaines()).filter(idSemaine); } catch (e) {}
    // le calendrier (7 oct. 2026) colore chaque semaine : faite (exportée, ou tous ses jours prêts), commencée, ou vide
    return l.sort().reverse().map(s => { const x = lireSemaine(s); if (!x) return null;
      const aFaire = x.jours.filter(j => j.nb > 0), prets = aFaire.filter(j => j.etat === 'pret').length;
      return { id: s, prets: prets, aFaire: aFaire.length, verrous: x.jours.filter(j => j.verrou).length, briefs: x.jours.filter(j => j.brief).length,
        exporte: !!x.exporte, faite: !!x.exporte || (aFaire.length > 0 && prets === aFaire.length) }; }).filter(Boolean);
  }
  // ce que la page voit d'une semaine : la fiche, plus un résumé de la publication de chaque jour
  function semainePublique(sem) {
    const r = JSON.parse(JSON.stringify(sem));
    r.tache = TACHES.has(sem.id) ? sem.tache || { message: 'En cours…' } : (sem.tache && sem.tache.fini ? sem.tache : null);
    r.jours.forEach(j => {
      j.date = dateDuJour(sem.id, j.jour);
      const pub = j.pubId && enProjet(() => D.lirePub(j.pubId));
      if (!pub) { j.pub = null; return; }
      const deck = enProjet(() => D.lireDeck(pub.id));
      j.pub = { id: pub.id, titre: pub.titre || '', slides: (pub.plan && pub.plan.slides || []).map(s => ({ titre: s.titre, texte: s.texte, sticker: s.sticker || '' })),
        composees: deck && deck.slides ? deck.slides.length : 0 };
    });
    return r;
  }

  // ---- la matière de la semaine : captures, preuves, photos (servies comme des rendus du projet)
  function ajouterMatiere(s, nom, tmp) {
    const sem = lireSemaine(s); if (!sem) throw new Error('Semaine introuvable.');
    const ext = path.extname(nom).toLowerCase();
    if (!IMAGES.includes(ext)) throw new Error('Seules les images passent ici (PNG, JPG, WEBP).');
    fs.mkdirSync(dossierMatiere(s), { recursive: true });
    const fichier = 'm' + Date.now().toString(36) + ext;
    fs.copyFileSync(tmp, path.join(dossierMatiere(s), fichier));
    sem.matiere.push({ fichier: fichier, nom: path.basename(nom, ext).slice(0, 60), note: '' });
    return ecrireSemaine(sem);
  }

  /* ---- LE PLAN DE LA SEMAINE : Claude lit la semaine type, l'actu, la matière et la banque, et écrit le brief de chaque
     jour. Les faits ne viennent que de ce que la personne a écrit ou déposé : la publication sort sous son nom. */
  async function ecrireBriefs(sem) {
    const type = P.lireSemaineType(), p = P.lire(), qui = p.prenom || 'la personne';
    const da = D.lireDA(DA(), 'stories');
    const postes = JOURS.filter(j => p.rythme.jours[j] && P.jours()[j]);
    const banque = lireBanque(), captures = lireCaptures(), videos = lireVideos();
    const consigne = [
      'Tu es le stratège des stories Instagram de ' + qui + (p.compte ? ' (' + p.compte + ')' : '') + '. Tu prépares SA SEMAINE de stories, jour par jour, d\'après SA SEMAINE TYPE (plus bas).',
      '- Ici RIEN ne se génère : tu n\'appelles aucun outil de Magnific ni de Higgsfield, tu ne dépenses aucun crédit. Tu lis (Read) et tu écris, c\'est tout.',
      '- Pour chaque jour, tu écris le BRIEF de sa suite de stories : ce qu\'elle raconte, story par story, dans l\'esprit du rôle du jour. Un rédacteur en fera les stories : donne-lui la matière, pas des phrases finies. 600 caractères au plus par brief.',
      '- AUCUN FAIT INVENTÉ. Tout chiffre, résultat, témoignage, nom, date, nouveauté, palier vient de L\'ACTU DE LA SEMAINE ou de LA MATIÈRE, mot pour mot. Un jour qui demande un fait que ' + qui + ' n\'a pas donné (une preuve, un palier) se rabat sur ce que dit la semaine type pour ce cas — jamais sur un fait inventé. Le brief REPREND les faits qu\'il utilise, tels quels : le rédacteur ne verra que lui.',
      '- Ouvre la matière avec Read (captures, preuves) avant de choisir. Chaque image de la matière sert au jour où elle a le plus de sens ; une preuve va au jour de la preuve.',
      '- « medias » : les images à montrer dans les stories du jour, par leur clé — B1… (les photos du quotidien de la banque, d\'après leur description) et M1… (la matière). Les photos de la banque sont des FONDS de story : environ la MOITIÉ des stories du jour en ont une (2 pour 4 stories, 2 ou 3 pour 5), chacune choisie pour coller au moment qu\'elle illustre ; deux jours ne prennent jamais la même photo. Le brief dit sur quelle story va chaque photo.',
      '- C1… : SES CAPTURES (' + (p.captures || 'son produit, ses outils, ses écrans') + ', d\'après leur description). Elles se POSENT sur une story (jamais en fond), quand la story parle de ce qu\'elles montrent : surtout le jour de l\'offre, celui de la valeur pour illustrer une astuce, celui des coulisses pour une nouveauté. Une ou deux par jour concerné au plus, jamais la même deux fois dans la semaine. Elles comptent EN PLUS des photos de fond.',
      "- V1… : SES VIDÉOS (" + (p.videos || 'ses Reels, ses résultats, ses démos') + ", d'après leur description). Dès qu'une story parle de ce qu'une vidéo montre (un résultat, un avant / après, « regarde ça »), elle la MONTRE : mets sa clé dans « medias » et le brief dit sur quelle story elle va. Une vidéo au plus par jour (deux pour un avant / après), jamais la même deux jours de suite.",
      '- « nb » : ' + p.rythme.min + ' à ' + p.rythme.max + ' stories par jour posté (' + postes.map(j => NOMS[j]).join(', ') + ') ; 0 pour les autres jours. Un jour « Libre » : 0 si ' + qui + ' n\'a rien donné pour lui (sinon 1 à 3).',
      '- « appel » : le mot à répondre de la dernière story quand le rôle en a un' + (p.mots.length ? ' (' + p.mots.map(m => '« Réponds ' + m.mot + ' »').join(', ') + ' — seulement ceux-là)' : ' (aucun mot n\'est défini : laisse vide)') + ', sinon chaîne vide. Le brief le mentionne aussi.',
      '- « heure » : l\'heure de publication conseillée (HH:MM), entre 08:00 et 21:00, en évitant deux jours à la même heure si ça n\'a pas de sens.',
      '- Si ' + qui.toUpperCase() + ' A DONNÉ UNE CONSIGNE pour un jour, elle passe avant tout le reste.',
      '',
      'Tu réponds UNIQUEMENT du JSON strict, sur une seule ligne, sans bloc de code :',
      '{"jours":[{"jour":"lundi","nb":4,"brief":"…","medias":["B1","C3"],"appel":"' + (p.mots[0] ? 'Réponds ' + p.mots[0].mot : '') + '","heure":"12:30"}, … les 7 jours de lundi à dimanche]}',
      '',
      '# QUI ELLE EST', '', P.enClair(p),
      '',
      '# SA SEMAINE TYPE', '', type,
      D.voixDeLaDA(da) ? '\n# SA FAÇON DE PARLER (pour le ton des briefs)\n' + D.voixDeLaDA(da) : ''
    ].join('\n');
    const q = [
      'LA SEMAINE DU ' + dateDuJour(sem.id, 'lundi') + ' AU ' + dateDuJour(sem.id, 'dimanche') + '.',
      '', 'L\'ACTU DE LA SEMAINE (écrite par ' + qui + ') :', sem.actu ? sem.actu : '(rien d\'écrit)',
      '', 'LA MATIÈRE (déposée par ' + qui + ') :',
      sem.matiere.length ? sem.matiere.map((m, i) => '  M' + (i + 1) + '. ' + m.nom + (m.note ? ' — ' + m.note : '') + '\n      fichier : ' + path.join(dossierMatiere(sem.id), m.fichier)).join('\n') : '  (aucune)',
      '', 'SA BANQUE DE PHOTOS :',
      banque.length ? banque.map((b, i) => '  B' + (i + 1) + '. ' + (b.description || '(sans description)') + (b.description ? '' : '\n      fichier : ' + path.join(dossierBanque(), b.fichier))).join('\n') : '  (vide : aucune photo, les stories se font en texte et avec la matière)',
      '', 'SES VIDÉOS :',
      videos.length ? videos.map((v, i) => '  V' + (i + 1) + '. ' + v.description).join('\n') : '  (aucune)',
      '', 'SES CAPTURES :',
      captures.length ? captures.map((c, i) => '  C' + (i + 1) + '. ' + c.description).join('\n') : '  (aucune)',
      '', sem.jours.some(j => j.consigne) ? 'LES CONSIGNES DE ' + qui.toUpperCase() + ' PAR JOUR :\n' + sem.jours.filter(j => j.consigne).map(j => '  - ' + NOMS[j.jour] + ' : ' + j.consigne).join('\n') : '',
      '', 'Écris la semaine.'
    ].filter(x => x !== '').join('\n');
    const r = await D.interroger(q, consigne, null, 1, D.DELAI_MAX, { args: ['--strict-mcp-config'] });
    let j = null; try { j = JSON.parse(D.premierObjetJson(r.texte || '')); } catch (e) {}
    if (!j || !Array.isArray(j.jours)) throw new Error("Claude n'a pas rendu de semaine lisible. Réessayez.");
    const frais = lireSemaine(sem.id) || sem;
    JOURS.forEach(nom => {
      const x = j.jours.find(y => y && String(y.jour).toLowerCase() === nom), d = frais.jours.find(y => y.jour === nom);
      if (!x || !d || d.verrou) return;   // un jour verrouillé (validé par la personne) ne se réécrit plus
      d.role = ROLES()[nom];
      d.brief = String(x.brief || '').trim().slice(0, 1200);
      d.nb = Math.max(0, Math.min(6, Number(x.nb) || 0));
      d.medias = (Array.isArray(x.medias) ? x.medias : []).map(String).filter(k => /^[BMCV]\d{1,2}$/.test(k)).slice(0, 6);
      d.appel = String(x.appel || '').trim().slice(0, 60);
      d.heure = /^\d{2}:\d{2}$/.test(String(x.heure || '')) ? x.heure : '';
      d.etat = d.nb ? 'brief' : 'repos';
    });
    return ecrireSemaine(frais);
  }

  /* ---- UN JOUR : sa publication « stories » (créée ou reprise), son plan, sa mise en page. */
  /* Deux jours se préparent en même temps : chaque changement relit la fiche, la modifie et l'écrit d'un trait (sans attente
     entre les deux), sans quoi un jour effacerait l'état de l'autre. */
  function majJour(s, nom, fn) {
    const f = lireSemaine(s), j = f && f.jours.find(x => x.jour === nom);
    if (j) { fn(j); ecrireSemaine(f); }
  }
  async function faireJour(s, nom, remarque) {
    const sem = lireSemaine(s), d = sem.jours.find(x => x.jour === nom);
    if (!d || !d.nb || !d.brief || d.verrou) return;
    const banque = lireBanque(), captures = lireCaptures();
    const medias = d.medias.map(k => {
      const n = Number(k.slice(1)) - 1;
      if (k[0] === 'B' && banque[n]) return { rendu: 'banque/' + banque[n].fichier, nom: 'Photo du quotidien ' + k, note: banque[n].description || '' };
      if (k[0] === 'C' && captures[n]) return { donnees: captureEnDonnees(captures[n].fichier), nom: 'Capture ' + k, note: captures[n].description };
      if (k[0] === 'M' && sem.matiere[n]) return { rendu: 'semaines/' + s + '/' + sem.matiere[n].fichier, nom: sem.matiere[n].nom, note: sem.matiere[n].note || '' };
      return null;
    }).filter(Boolean);
    const sujet = [d.brief, d.appel ? 'La dernière story se termine par : « ' + d.appel + ' » (le lien part en réponse automatique).' : ''].filter(Boolean).join('\n');
    await enProjet(async () => {
      let pub = d.pubId && D.lirePub(d.pubId);
      if (!pub || remarque === null) {
        pub = D.creerOuMajPub({ genre: 'stories', identiteId: DA(), but: NOMS[nom] + ' — ' + d.role, sujet: sujet, nb: d.nb, medias: medias,
          titre: NOMS[nom] + ' ' + s.slice(8) + '/' + s.slice(5, 7) + ' — ' + d.role });
      } else {
        pub = D.creerOuMajPub({ id: pub.id, sujet: sujet, nb: d.nb, but: NOMS[nom] + ' — ' + d.role });
      }
      pub.sansGen = true;                       // la banque à la place des images générées (voir ecrirePlanPub)
      pub = D.ecrirePub(pub);
      const id = pub.id;
      const vids = lireVideos();
      for (const k of d.medias.filter(k => k[0] === 'V')) {
        const v = vids[Number(k.slice(1)) - 1], deja = (D.lirePub(id).videos || []).some(x => x.nom === v.description.slice(0, 80));
        if (v && !deja) { try { await D.ajouterVideoPub(D.lirePub(id), { fichier: path.join(dossierVideos(), v.fichier), nom: v.description.slice(0, 80) }); } catch (e) {} }
      }
      majJour(s, nom, j => { j.pubId = id; j.etat = 'plan'; j.erreur = ''; });
      tache(s, NOMS[nom] + ' : Claude écrit les stories…');
      await D.ecrirePlanPub(D.lirePub(id), remarque || '', !!remarque);
      majJour(s, nom, j => { j.etat = 'compo'; });
      tache(s, NOMS[nom] + ' : mise en page à ta DA…');
      await D.composerPub(D.lirePub(id), null, m => tache(s, NOMS[nom] + ' : ' + m), {});
    });
    majJour(s, nom, j => { j.etat = 'pret'; j.erreur = ''; });
  }

  function tache(s, message, fini) {
    const sem = lireSemaine(s); if (!sem) return;
    sem.tache = { message: message, fini: !!fini, le: new Date().toISOString() };
    ecrireSemaine(sem);
  }
  function lancer(s, travail) {
    if (TACHES.has(s)) throw new Error('Une préparation tourne déjà pour cette semaine.');
    TACHES.set(s, true);
    (async () => {
      try { await travail(); tache(s, 'Terminé.', true); }
      catch (e) { tache(s, 'Erreur : ' + ((e && e.message) || e), true); }
      finally { TACHES.delete(s); }
    })();
  }
  // les jours un par un (deux à la fois : la mise en page d'un jour prend 2 à 4 min)
  async function fairesJours(s, liste) {
    const file = liste.slice();
    const ouvrier = async () => {
      while (file.length) {
        const nom = file.shift();
        try { await faireJour(s, nom, null); }
        catch (e) { majJour(s, nom, j => { j.etat = 'erreur'; j.erreur = (e && e.message) || String(e); }); }
      }
    };
    await Promise.all([ouvrier(), ouvrier()]);
  }

  /* ---- LA SEMAINE À POSTER : chaque jour exporté (PNG, ou MP4 pour une story vidéo), rangé par jour, et le programme. */
  /* ---- LE GUIDE DES STICKERS (7 oct. 2026) :
     pour chaque jour, une image « _GUIDE (ne pas poster).png » dans son dossier : les stories du jour en vignettes et, sur
     chaque story qui demande un sticker, un cadre orange à l'endroit libre où le poser, avec son texte. Claude regarde chaque
     story (Read) et choisit la place : ni sur un texte, ni sur une carte GIF, une vidéo, une capture ou le patch. Gratuit. */
  async function guideDuJour(s, d, pub, dj) {
    const nav = D.trouverNavigateur(); if (!nav) return;
    const slides = (pub.plan && pub.plan.slides) || [], travail = path.join(D.RACINE, 'CACHE', 'guide-' + pub.id);
    fs.rmSync(travail, { recursive: true, force: true }); fs.mkdirSync(travail, { recursive: true });
    const images = [];
    for (let i = 0; i < slides.length; i++) {
      const f = path.join(travail, 'story-' + (i + 1) + '.png');
      try { await D.photographier(nav, 'http://127.0.0.1:' + D.port() + '/pub/' + PROJET() + '/' + pub.id + '/slide/' + (i + 1), f, 1080, 1920); images.push(f); }
      catch (e) { images.push(null); }
    }
    const aSticker = slides.map((x, i) => x.sticker ? i + 1 : 0).filter(Boolean);
    const zones = {};
    if (aSticker.length) {
      const consigne = [
        'Tu places des stickers Instagram (sondage, question, compte à rebours…) sur des stories déjà faites. Pour chaque story donnée, tu choisis la ZONE LIBRE où la personne posera le sticker à la main dans Instagram.',
        '- Ici RIEN ne se génère : tu n\'appelles aucun outil de Magnific ni de Higgsfield. Tu ouvres chaque image (Read), c\'est tout.',
        '- La story fait 1080 × 1920 px. La zone : un rectangle {x, y, w, h} en px, 560 à 760 px de large et 220 à 380 px de haut (la taille d\'un sticker sondage ou question), ENTIER entre y = 260 et y = 1560 (en dessous, Instagram met le champ de réponse).',
        '- Elle ne couvre AUCUN texte (titre, encadré, punchline), ni carte GIF, ni vidéo ou capture posée, ni le patch brodé. Sur une photo de fond ou le fond tissu, c\'est bon. Si rien n\'est tout à fait libre, prends la zone qui cache le moins (de préférence un bout de photo ou de fond), et dis-le dans « conseil ».',
        '- « conseil » : une phrase courte pour la personne (« sous la punchline, à droite de la carte GIF »).',
        'Tu réponds UNIQUEMENT du JSON strict, sur une ligne : {"stories":[{"n":1,"x":0,"y":0,"w":0,"h":0,"conseil":"…"}]}'
      ].join('\n');
      const q = 'LES STORIES À STICKER :\n' + aSticker.map(n => '  - story ' + n + ' (sticker : ' + slides[n - 1].sticker + ') : ' + images[n - 1]).join('\n');
      try {
        const r = await D.interroger(q, consigne, null, 1, D.DELAI_MAX, { args: ['--strict-mcp-config'] });
        const j = JSON.parse(D.premierObjetJson(r.texte || '') || '{}');
        (j.stories || []).forEach(z => {
          const n = Number(z.n); if (!aSticker.includes(n)) return;
          const w = Math.max(400, Math.min(800, Number(z.w) || 600)), h = Math.max(180, Math.min(420, Number(z.h) || 280));
          const x = Math.max(20, Math.min(1080 - w - 20, Number(z.x) || 240)), y = Math.max(260, Math.min(1560 - h, Number(z.y) || 1000));
          zones[n] = { x, y, w, h, conseil: (c => c.length > 260 ? c.slice(0, 260).replace(/\s+\S*$/, '') + '…' : c)(String(z.conseil || '').trim()) };
        });
      } catch (e) {}
      aSticker.forEach(n => { if (!zones[n]) zones[n] = { x: 240, y: 1100, w: 600, h: 280, conseil: 'Place à vérifier à l\'œil : je n\'ai pas pu la choisir.' }; });
    }
    // la page du guide, photographiée en PNG (vignettes au tiers : 360 × 640)
    const { pathToFileURL } = require('url'), k = 1 / 3, L = 360, Hh = 640;
    const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const cartes = slides.map((x, i) => {
      const z = zones[i + 1], src = images[i] ? pathToFileURL(images[i]).href : '';
      return '<div class="c"><div class="v">' + (src ? '<img src="' + src + '">' : '') + '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
        (z ? '<div class="z" style="left:' + Math.round(z.x * k) + 'px;top:' + Math.round(z.y * k) + 'px;width:' + Math.round(z.w * k) + 'px;height:' + Math.round(z.h * k) + 'px"><b>STICKER ICI</b></div>' : '') +
        '</div><div class="t">' + (x.sticker ? '<b>Sticker :</b> ' + esc(x.sticker) + (z && z.conseil ? '<br><i>' + esc(z.conseil) + '</i>' : '') : '<span class="r">Pas de sticker</span>') + '</div></div>';
    }).join('');
    const largeur = Math.max(900, slides.length * (L + 24) + 56), hauteur = 900;
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0b0b0d;color:#f4f4f5;font:15px/1.4 Segoe UI,Arial,sans-serif;width:' + largeur + 'px;height:' + hauteur + 'px}' +
      '.h{padding:22px 28px 6px;font:800 30px/1.1 Segoe UI,Arial}.h span{color:#f97316}.s{padding:0 28px 16px;color:#a8a8b1}.l{display:flex;gap:24px;padding:0 28px}' +
      '.c{width:' + L + 'px}.v{position:relative;width:' + L + 'px;height:' + Hh + 'px;border-radius:14px;overflow:hidden;background:#000}.v img{width:100%;height:100%;display:block}' +
      '.n{position:absolute;left:10px;top:10px;background:#f97316;color:#0b0b0d;font:800 16px/1 Segoe UI;padding:5px 9px;border-radius:8px}' +
      '.z{position:absolute;border:4px dashed #f97316;background:rgba(249,115,22,.22);border-radius:12px;display:grid;place-items:center}.z b{background:#f97316;color:#0b0b0d;font:800 13px/1 Segoe UI;padding:4px 8px;border-radius:6px}' +
      '.t{margin-top:10px;font-size:14px}.t i{color:#fdba74}.r{color:#707079}</style></head><body>' +
      '<div class="h">' + NOMS[d.jour].toUpperCase() + ' <span>· ' + esc(d.role) + '</span></div>' +
      '<div class="s">' + esc(dateDuJour(s, d.jour)) + (d.heure ? ' · à poster à ' + d.heure : '') + (d.appel ? ' · dernière story : « ' + esc(d.appel) + ' » (réponse automatique active ?)' : '') + ' · le guide ne se poste pas</div>' +
      '<div class="l">' + cartes + '</div></body></html>';
    const page = path.join(travail, 'guide.html');
    fs.writeFileSync(page, html, 'utf8');
    try { await D.photographier(nav, pathToFileURL(page).href, path.join(dj, '_GUIDE (ne pas poster).png'), largeur, hauteur); } catch (e) {}
    return zones;
  }

  async function exporterSemaine(s) {
    const sem = lireSemaine(s);
    // un dossier par profil : A POSTER/<compte>/Semaine du …
    const pr = P.lire(), qui = String(pr.compte || pr.prenom || P.id()).replace(/^@/, '').replace(/[\/:*?"<>|]/g, ' ').trim() || P.id();
    const sortie = path.join(D.RACINE, 'A POSTER', qui, 'Semaine du ' + s);
    fs.mkdirSync(sortie, { recursive: true });
    const lignes = ['MES STORIES — semaine du ' + dateDuJour(s, 'lundi') + ' au ' + dateDuJour(s, 'dimanche'), '',
      'À programmer dans Meta Business Suite (Planificateur › Story), une suite par jour, dans l\'ordre des fichiers.',
      'Les stories fixes sont en PNG, celles qui bougent (GIF, Reel) en MP4, toutes en 1080 × 1920. Dans chaque dossier, « _GUIDE (ne pas poster).png » montre où poser les stickers.', ''];
    for (const d of sem.jours) {
      const nom = (JOURS.indexOf(d.jour) + 1) + ' - ' + NOMS[d.jour];
      if (!d.pubId || d.etat !== 'pret') { lignes.push(nom.toUpperCase() + ' : rien à poster.', ''); continue; }
      tache(s, 'Export : ' + NOMS[d.jour] + '…');
      const pub = enProjet(() => D.lirePub(d.pubId));
      const r = await enProjet(() => D.exporterPub(pub));
      const dj = path.join(sortie, nom);
      fs.rmSync(dj, { recursive: true, force: true });
      fs.mkdirSync(dj, { recursive: true });
      const fichiers = fs.readdirSync(r.dossier).filter(f => /\.(png|mp4)$/i.test(f)).sort();
      fichiers.forEach((f, i) => fs.copyFileSync(path.join(r.dossier, f), path.join(dj, String(i + 1).padStart(2, '0') + path.extname(f).toLowerCase())));
      const slides = (pub.plan && pub.plan.slides) || [];
      lignes.push(nom.toUpperCase() + ' — ' + d.role + ' — ' + dateDuJour(s, d.jour) + (d.heure ? ', à ' + d.heure : ''));
      tache(s, 'Guide des stickers : ' + NOMS[d.jour] + '…');
      let zones = {};
      try { zones = (await enProjet(() => guideDuJour(s, d, pub, dj))) || {}; } catch (e) {}
      slides.forEach((x, i) => { if (x.sticker) lignes.push('  story ' + (i + 1) + ' : ajouter le sticker « ' + x.sticker + ' »' + (zones[i + 1] && zones[i + 1].conseil ? ' — ' + zones[i + 1].conseil : '') + ' (voir le guide)'); });
      if (d.appel) lignes.push('  dernière story : « ' + d.appel + ' » — vérifier que la réponse automatique (ManyChat ou autre) est active.');
      lignes.push('');
    }
    fs.writeFileSync(path.join(sortie, 'programme.txt'), lignes.join('\r\n'), 'utf8');
    const frais = lireSemaine(s); frais.exporte = new Date().toISOString(); frais.dossierExport = sortie; ecrireSemaine(frais);
    D.ouvrirDossier(sortie);
  }

  // ---- les routes
  function routes(req, res, url) {
    const M = req.method, echec = e => D.repondreJson(res, 400, { erreur: (e && e.message) || String(e) });
    let m;
    // les images de la banque et de la matière, pour les vignettes de la page
    if (M === 'GET' && (m = url.match(/^\/semaine-fichier\/banque\/([^/]+)$/))) { D.servirFichier(res, dossierBanque(), decodeURIComponent(m[1])); return true; }
    if (M === 'GET' && (m = url.match(/^\/semaine-fichier\/matiere\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/))) { D.servirFichier(res, dossierMatiere(m[1]), decodeURIComponent(m[2])); return true; }
    if (M === 'GET' && (m = url.match(/^\/semaine-fichier\/captures\/([^/]+)$/))) { D.servirFichier(res, dossierCaptures(), decodeURIComponent(m[1])); return true; }
    if (M === 'GET' && url === '/api/captures') { D.repondreJson(res, 200, lireCaptures()); return true; }
    if (M === 'GET' && (m = url.match(/^\/semaine-fichier\/videos\/([^/]+)$/))) { D.servirFichier(res, dossierVideos(), decodeURIComponent(m[1])); return true; }
    if (M === 'GET' && url === '/api/videos') { D.repondreJson(res, 200, lireVideos()); return true; }
    if (M === 'POST' && url === '/api/videos/ouvrir') { fs.mkdirSync(dossierVideos(), { recursive: true }); D.ouvrirDossier(dossierVideos()); D.repondreJson(res, 200, { ok: true }); return true; }
    if (M === 'POST' && url === '/api/captures/ouvrir') { fs.mkdirSync(dossierCaptures(), { recursive: true }); D.ouvrirDossier(dossierCaptures()); D.repondreJson(res, 200, { ok: true }); return true; }
    // SES CAPTURES ET SES VIDÉOS, depuis la page : déposer (corps brut, ?nom=), décrire (Claude), retirer, retoucher la description
    if (M === 'POST' && (m = url.match(/^\/api\/(captures|videos)\/deposer/))) {
      const capt = m[1] === 'captures', dos = capt ? dossierCaptures() : dossierVideos();
      const nom = new URLSearchParams(req.url.split('?')[1] || '').get('nom') || (capt ? 'capture.png' : 'video.mp4'), ext = path.extname(nom).toLowerCase();
      if (!(capt ? IMAGES : VIDEOS_EXT).includes(ext)) { req.resume(); D.repondreJson(res, 400, { erreur: capt ? 'Seules les images passent ici (PNG, JPG, WEBP).' : 'Seules les vidéos passent ici (MP4, MOV, WEBM).' }); return true; }
      fs.mkdirSync(dos, { recursive: true });
      const base = path.basename(nom, ext).replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').trim().slice(0, 50) || (capt ? 'capture' : 'video');
      let f = base + ext, k = 2; while (fs.existsSync(path.join(dos, f))) f = base + '-' + (k++) + ext;
      const ecrit = fs.createWriteStream(path.join(dos, f)); req.pipe(ecrit);
      ecrit.on('close', () => D.repondreJson(res, 200, capt ? lireCaptures() : lireVideos()));
      return true;
    }
    if (M === 'POST' && (m = url.match(/^\/api\/(captures|videos)\/decrire$/))) { decrireRayon(m[1]).then(l => D.repondreJson(res, 200, l)).catch(echec); return true; }
    if (M === 'POST' && (m = url.match(/^\/api\/(captures|videos)\/fichier$/))) {
      D.corpsJson(req, 1e4).then(d => { majRayon(m[1], String(d.fichier || ''), d); D.repondreJson(res, 200, m[1] === 'captures' ? lireCaptures() : lireVideos()); }).catch(echec);
      return true;
    }
    if (M === 'GET' && url === '/api/semaine') {
      assurerProjet();
      const courante = iso(lundiDe(new Date()));
      D.repondreJson(res, 200, { semaines: listeSemaines(), courante: courante, suivante: iso(new Date(lundiDe(new Date()).getTime() + 7 * 864e5)), projet: PROJET() });
      return true;
    }
    if (M === 'POST' && url === '/api/semaine') {
      D.corpsJson(req, 1e4).then(d => {
        assurerProjet();
        const s = String(d.id || '');
        if (!idSemaine(s)) throw new Error('Date de semaine illisible.');
        D.repondreJson(res, 200, semainePublique(lireSemaine(s) || ecrireSemaine(semaineVide(s))));
      }).catch(echec);
      return true;
    }
    // la banque
    if (M === 'GET' && url === '/api/banque') { assurerProjet(); D.repondreJson(res, 200, lireBanque()); return true; }
    if (M === 'POST' && url.startsWith('/api/banque/deposer')) {
      assurerProjet();
      const nom = new URLSearchParams(req.url.split('?')[1] || '').get('nom') || 'image.png', ext = path.extname(nom).toLowerCase();
      if (!IMAGES.includes(ext)) { D.repondreJson(res, 400, { erreur: 'Seules les images passent ici.' }); return true; }
      const f = 'b' + Date.now().toString(36) + ext, ecrit = fs.createWriteStream(path.join(dossierBanque(), f));
      req.pipe(ecrit);
      ecrit.on('close', () => { const l = lireBanque(); ecrireBanque(l); D.repondreJson(res, 200, l); });
      return true;
    }
    if (M === 'POST' && url === '/api/banque/decrire') { decrireBanque().then(l => D.repondreJson(res, 200, l)).catch(echec); return true; }
    if (M === 'POST' && (m = url.match(/^\/api\/banque\/(b?[a-z0-9]+\.(?:png|jpe?g|webp))$/i))) {
      D.corpsJson(req, 1e4).then(d => {
        const l = lireBanque(), e = l.find(x => x.fichier === m[1]);
        if (!e) throw new Error('Image introuvable.');
        if (d.retirer) {
          const c = path.join(dossierBanque(), '_corbeille'); fs.mkdirSync(c, { recursive: true });
          fs.renameSync(path.join(dossierBanque(), e.fichier), path.join(c, e.fichier));
          ecrireBanque(l.filter(x => x !== e));
        } else { e.description = String(d.description || '').trim().slice(0, 200); ecrireBanque(l); }
        D.repondreJson(res, 200, lireBanque());
      }).catch(echec);
      return true;
    }
    if (!(m = url.match(/^\/api\/semaine\/(\d{4}-\d{2}-\d{2})(?:\/([a-z-]+))?(?:\/([a-z]+))?$/))) return false;
    const s = m[1], action = m[2] || '', jour = m[3] || '';
    const sem = lireSemaine(s);
    if (!sem) { D.repondreJson(res, 404, { erreur: 'Semaine introuvable.' }); return true; }
    if (M === 'GET' && !action) { D.repondreJson(res, 200, semainePublique(sem)); return true; }
    if (M === 'POST' && !action) {
      D.corpsJson(req, 1e5).then(d => {
        const f = lireSemaine(s);
        if (typeof d.actu === 'string') f.actu = d.actu.slice(0, 6000);
        (Array.isArray(d.jours) ? d.jours : []).forEach(x => {
          const j = f.jours.find(y => y.jour === x.jour); if (!j) return;
          if (typeof x.brief === 'string') j.brief = x.brief.slice(0, 1200);
          if (typeof x.consigne === 'string') j.consigne = x.consigne.slice(0, 400);
          if (Number.isInteger(x.nb)) j.nb = Math.max(0, Math.min(6, x.nb));
          if (typeof x.heure === 'string') j.heure = /^\d{2}:\d{2}$/.test(x.heure) ? x.heure : '';
          if (typeof x.appel === 'string') j.appel = x.appel.slice(0, 60);
          if (Array.isArray(x.medias)) j.medias = x.medias.map(String).filter(k => /^[BMCV]\d{1,2}$/.test(k)).slice(0, 6);
        });
        (Array.isArray(d.matiere) ? d.matiere : []).forEach(x => { const e = f.matiere.find(y => y.fichier === x.fichier); if (e && typeof x.note === 'string') e.note = x.note.slice(0, 200); });
        D.repondreJson(res, 200, semainePublique(ecrireSemaine(f)));
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'matiere') {
      const nom = new URLSearchParams(req.url.split('?')[1] || '').get('nom') || 'image.png';
      const tmp = path.join(D.RACINE, 'CACHE', 'matiere-' + Date.now().toString(36));
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      const ecrit = fs.createWriteStream(tmp); req.pipe(ecrit);
      ecrit.on('close', () => { try { D.repondreJson(res, 200, semainePublique(ajouterMatiere(s, nom, tmp))); } catch (e) { echec(e); } finally { try { fs.rmSync(tmp, { force: true }); } catch (e) {} } });
      return true;
    }
    if (M === 'POST' && action === 'matiere-retirer') {
      D.corpsJson(req, 1e4).then(d => {
        const f = lireSemaine(s), e = f.matiere.find(x => x.fichier === d.fichier);
        if (e) { const c = path.join(dossierMatiere(s), '_corbeille'); fs.mkdirSync(c, { recursive: true }); try { fs.renameSync(path.join(dossierMatiere(s), e.fichier), path.join(c, e.fichier)); } catch (x) {} f.matiere = f.matiere.filter(x => x !== e); }
        D.repondreJson(res, 200, semainePublique(ecrireSemaine(f)));
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'preparer') {
      // la semaine entière : les briefs, puis chaque jour (tout ce qui n'est pas déjà prêt, sauf « tout » : on refait tout)
      D.corpsJson(req, 1e4).then(d => {
        lancer(s, async () => {
          tache(s, 'Claude prépare ta semaine (les briefs de chaque jour)…');
          const f = await enProjet(() => ecrireBriefs(lireSemaine(s)));
          await fairesJours(s, f.jours.filter(j => j.nb && j.brief && !j.verrou).map(j => j.jour));
        });
        D.repondreJson(res, 200, semainePublique(lireSemaine(s)));
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'verrou' && JOURS.includes(jour)) {
      D.corpsJson(req, 1e4).then(d => { majJour(s, jour, j => { j.verrou = !!(d && d.verrou); }); D.repondreJson(res, 200, semainePublique(lireSemaine(s))); }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'faire') {
      // les jours qui ont un brief et ne sont pas verrouillés, sans réécrire les briefs
      try { lancer(s, () => fairesJours(s, lireSemaine(s).jours.filter(j => j.nb && j.brief && !j.verrou).map(j => j.jour))); D.repondreJson(res, 200, semainePublique(lireSemaine(s))); } catch (e) { echec(e); }
      return true;
    }
    if (M === 'POST' && action === 'briefs') {
      lancer(s, async () => { tache(s, 'Claude écrit les briefs de la semaine…'); await enProjet(() => ecrireBriefs(lireSemaine(s))); });
      D.repondreJson(res, 200, semainePublique(lireSemaine(s)));
      return true;
    }
    if (M === 'POST' && action === 'jour' && JOURS.includes(jour)) {
      // refaire UN jour : depuis son brief (nouvelle suite), ou avec une remarque de la personne (la même suite, corrigée)
      D.corpsJson(req, 1e4).then(d => {
        const remarque = d && typeof d.remarque === 'string' && d.remarque.trim() ? d.remarque.trim().slice(0, 1000) : null;
        lancer(s, async () => {
          try { await faireJour(s, jour, remarque); }
          catch (e) { majJour(s, jour, j => { j.etat = 'erreur'; j.erreur = (e && e.message) || String(e); }); throw e; }
        });
        D.repondreJson(res, 200, semainePublique(lireSemaine(s)));
      }).catch(echec);
      return true;
    }
    if (M === 'POST' && action === 'exporter') {
      try { lancer(s, () => exporterSemaine(s)); D.repondreJson(res, 200, semainePublique(lireSemaine(s))); } catch (e) { echec(e); }
      return true;
    }
    if (M === 'POST' && action === 'ouvrir') {
      const f = lireSemaine(s); if (f.dossierExport) D.ouvrirDossier(f.dossierExport);
      D.repondreJson(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  // une tâche coupée par un redémarrage du moteur ne doit pas laisser la page en attente
  try { assurerProjet(); listeSemaines().forEach(x => { const f = lireSemaine(x.id); if (f && f.tache && !f.tache.fini) { f.tache = { message: 'Interrompu (le moteur a redémarré).', fini: true }; f.jours.forEach(j => { if (j.etat === 'plan' || j.etat === 'compo') j.etat = 'erreur', j.erreur = 'Interrompu.'; }); ecrireSemaine(f); } }); } catch (e) {}

  return { routes, PROJET, occupe: () => TACHES.size > 0 };
};
