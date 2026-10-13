/* ============================================================
   LE PROFIL — à qui appartiennent les stories (13 oct. 2026, pour que n'importe qui puisse se servir de Storymatic)
   ------------------------------------------------------------
   Tout ce qui était écrit en dur pour une seule personne (son nom, son compte, son offre, ses mots à répondre, sa semaine
   type, sa recette de story, sa DA) vit maintenant ici, dans MON-PROFIL/ (jamais publié : ce sont les données de la personne).
   PLUSIEURS PROFILS (13 oct. 2026) : un compte Instagram = un profil, chacun dans son dossier, avec son projet (ses semaines,
   sa banque), sa DA, ses captures et ses vidéos ; un seul est ACTIF à la fois (le sélecteur de l'accueil le change).
     MON-PROFIL/profils.json            { actif, ordre } : le profil actif et l'ordre de la liste
     MON-PROFIL/<id>/profil.json        les réponses du parcours « Faisons connaissance »
     MON-PROFIL/<id>/semaine-type.md    sa semaine type : un « ## <Jour> — <rôle> » par jour posté (écrite par Claude d'après la
                                        méthode SAVOIR/stories/methode-semaine.md et le profil, retouchée par la personne)
   Le profil est « complet » quand le parcours est fini ; tant qu'il ne l'est pas, l'accueil ouvre le parcours.
   ============================================================ */
const fs = require('fs'), path = require('path');

module.exports = function creerProfil(D) {
  const RACINE_P = path.join(D.RACINE, 'MON-PROFIL'), F_INDEX = path.join(RACINE_P, 'profils.json');
  const idOk = x => /^[a-z0-9][a-z0-9-]{0,40}$/.test(String(x || ''));
  const slug = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const lireIndex = () => { try { const x = JSON.parse(fs.readFileSync(F_INDEX, 'utf8')); return { actif: x.actif || '', ordre: Array.isArray(x.ordre) ? x.ordre.filter(idOk) : [] }; } catch (e) { return { actif: '', ordre: [] }; } };
  const ecrireIndex = x => { fs.mkdirSync(RACINE_P, { recursive: true }); D.ecrireJsonSurement(F_INDEX, x); };
  /** Les profils qui existent (un dossier avec profil.json), dans l'ordre de la liste. */
  function ids() {
    let l = []; try { l = fs.readdirSync(RACINE_P).filter(n => idOk(n) && fs.existsSync(path.join(RACINE_P, n, 'profil.json'))); } catch (e) {}
    const o = lireIndex().ordre;
    return l.sort((a, b) => (o.indexOf(a) < 0 ? 999 : o.indexOf(a)) - (o.indexOf(b) < 0 ? 999 : o.indexOf(b)) || a.localeCompare(b));
  }
  /** Le profil actif ; s'il n'y en a aucun, le premier est créé (vide : l'accueil ouvrira « Faisons connaissance »). */
  function actif() {
    const x = lireIndex(), l = ids();
    if (idOk(x.actif) && l.includes(x.actif)) return x.actif;
    if (l.length) { ecrireIndex({ actif: l[0], ordre: l }); return l[0]; }
    return creerProfilVide();
  }
  const dossierDe = id => path.join(RACINE_P, id);
  const F_PROFIL = () => path.join(dossierDe(actif()), 'profil.json'), F_SEMAINE = () => path.join(dossierDe(actif()), 'semaine-type.md');
  const DOSSIER_ACTIF = () => dossierDe(actif());
  const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const NOMS = { lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi', vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche' };
  const PRESENCES = ['jamais', 'visage', 'avatar'];
  const txt = (x, n) => String(x == null ? '' : x).trim().slice(0, n || 400);

  /* La recette d'une story « par défaut » (celle qui sert tant que la charte de la DA n'en donne pas une) */
  const RECETTE_DEFAUT = '- Une story = UNE idée, bien remplie : « titre » = 4 à 10 mots, souvent une question qui vise la cible ; « texte » = une ou deux lignes courtes séparées par \\n (la première enfonce le clou, la seconde peut être une punchline courte et parlée). La dernière story porte l\'appel.';

  function defaut() {
    return { version: 1, complet: false, prenom: '', compte: '', niche: '', cible: '', presence: 'jamais',
      offre: { nom: '', quoi: '', prix: '', lien: '' }, ressource: { nom: '', quoi: '', lien: '' }, mots: [],
      rythme: { min: 3, max: 5, jours: { lundi: true, mardi: true, mercredi: true, jeudi: true, vendredi: true, samedi: true, dimanche: false } },
      captures: '', videos: '', recette: '', gifChaqueStory: true, projet: '', da: '' };
  }
  function lire() {
    let p = null; try { p = JSON.parse(fs.readFileSync(F_PROFIL(), 'utf8')); } catch (e) {}
    const d = defaut();
    if (!p) return d;
    return Object.assign(d, p, { offre: Object.assign(d.offre, p.offre || {}), ressource: Object.assign(d.ressource, p.ressource || {}),
      rythme: Object.assign(d.rythme, p.rythme || {}, { jours: Object.assign(d.rythme.jours, (p.rythme || {}).jours || {}) }) });
  }
  function ecrire(p) { fs.mkdirSync(DOSSIER_ACTIF(), { recursive: true }); D.ecrireJsonSurement(F_PROFIL(), p); return p; }

  /** Ce que la page envoie : on ne garde que des champs connus, bornés. */
  function enregistrer(d) {
    const p = lire();
    for (const k of ['prenom', 'niche', 'cible', 'captures', 'videos']) if (typeof d[k] === 'string') p[k] = txt(d[k], k === 'prenom' ? 40 : 400);
    if (typeof d.compte === 'string') { const c = txt(d.compte, 40).replace(/\s+/g, ''); p.compte = c && !c.startsWith('@') ? '@' + c : c; }
    if (PRESENCES.includes(d.presence)) p.presence = d.presence;
    if (d.offre && typeof d.offre === 'object') for (const k of ['nom', 'quoi', 'prix', 'lien']) if (typeof d.offre[k] === 'string') p.offre[k] = txt(d.offre[k], k === 'quoi' ? 400 : 120);
    if (d.ressource && typeof d.ressource === 'object') for (const k of ['nom', 'quoi', 'lien']) if (typeof d.ressource[k] === 'string') p.ressource[k] = txt(d.ressource[k], k === 'quoi' ? 400 : 160);
    if (Array.isArray(d.mots)) p.mots = d.mots.filter(m => m && txt(m.mot, 20)).slice(0, 6)
      .map(m => ({ mot: txt(m.mot, 20).toUpperCase().replace(/[^A-Z0-9À-ÖØ-Þ-]/g, ''), envoie: txt(m.envoie, 160) })).filter(m => m.mot);
    if (d.rythme && typeof d.rythme === 'object') {
      const r = d.rythme;
      if (Number.isInteger(r.min)) p.rythme.min = Math.max(1, Math.min(6, r.min));
      if (Number.isInteger(r.max)) p.rythme.max = Math.max(p.rythme.min, Math.min(6, r.max));
      if (r.jours && typeof r.jours === 'object') JOURS.forEach(j => { if (j in r.jours) p.rythme.jours[j] = !!r.jours[j]; });
    }
    if (typeof d.recette === 'string') p.recette = txt(d.recette, 2000);
    if (typeof d.gifChaqueStory === 'boolean') p.gifChaqueStory = d.gifChaqueStory;
    if (typeof d.complet === 'boolean') p.complet = d.complet;
    p.maj = new Date().toISOString();
    return ecrire(p);
  }

  // ------------------------------------------------------------------ la semaine type
  function lireSemaineType() { try { return fs.readFileSync(F_SEMAINE(), 'utf8'); } catch (e) { return ''; } }
  /** Les sections « ## Lundi — Le rôle » : { lundi: { role, texte } } ; un jour absent n'est pas posté. */
  function jours() {
    const t = lireSemaineType(), o = {};
    const parts = t.split(/^## /m).slice(1);
    for (const x of parts) {
      const i = x.indexOf('\n'), tete = (i < 0 ? x : x.slice(0, i)).trim(), corps = i < 0 ? '' : x.slice(i + 1).trim();
      const m = tete.match(/^([A-Za-zéû]+)\s*[—–-]\s*(.+)$/); if (!m) continue;
      const j = m[1].toLowerCase(); if (!JOURS.includes(j)) continue;
      o[j] = { role: m[2].trim().slice(0, 60), texte: corps };
    }
    return o;
  }
  /** Écrit la semaine type à partir des sections retouchées par la personne (la tête du fichier est gardée). */
  function enregistrerJours(l) {
    const t = lireSemaineType(), i = t.search(/^## /m), tete = i > 0 ? t.slice(0, i).trimEnd() : (t.trim() ? t.trimEnd() : '# Ma semaine type');
    const corps = JOURS.filter(j => l[j] && txt(l[j].role, 60)).map(j => '## ' + NOMS[j] + ' — ' + txt(l[j].role, 60) + '\n' + txt(l[j].texte, 3000)).join('\n\n');
    fs.mkdirSync(DOSSIER_ACTIF(), { recursive: true });
    fs.writeFileSync(F_SEMAINE(), tete + '\n\n' + corps + '\n', 'utf8');
    return { texte: lireSemaineType(), jours: jours() };
  }

  /** Le profil en clair, pour les demandes à Claude. */
  function enClair(p) {
    p = p || lire();
    const qui = (p.prenom || 'la personne') + (p.compte ? ' (' + p.compte + ')' : '');
    const l = ['LA PERSONNE : ' + qui + '.'];
    if (p.niche) l.push('Sa niche : ' + p.niche + '.');
    if (p.cible) l.push('Sa cible (à qui parlent les stories) : ' + p.cible + '.');
    l.push({ jamais: 'Elle n\'apparaît JAMAIS en photo ni en vidéo : les stories se font en texte, avec des photos de son quotidien (sans personne visible), ses captures et ses vidéos.',
      visage: 'Elle se montre : ses photos et ses vidéos à elle peuvent porter les stories.',
      avatar: 'Elle se montre par son avatar IA : ses images d\'avatar portent les stories.' }[p.presence] || '');
    if (p.offre.nom) l.push('CE QU\'ELLE VEND : ' + p.offre.nom + (p.offre.quoi ? ' — ' + p.offre.quoi : '') + (p.offre.prix ? ' (' + p.offre.prix + ')' : '') + (p.offre.lien ? ' — ' + p.offre.lien : '') + '.');
    if (p.ressource.nom) l.push('SA RESSOURCE GRATUITE : ' + p.ressource.nom + (p.ressource.quoi ? ' — ' + p.ressource.quoi : '') + '.');
    if (p.mots.length) l.push('SES MOTS À RÉPONDRE (une réponse automatique envoie le lien) : ' + p.mots.map(m => '« ' + m.mot + ' » → ' + (m.envoie || 'le lien')).join(' ; ') + '.');
    return l.filter(Boolean).join('\n');
  }

  /** Claude écrit la semaine type d'après la méthode et le profil (≈ 1 min, gratuit). */
  async function proposerSemaine(envie) {
    const p = lire();
    let methode = ''; try { methode = fs.readFileSync(path.join(D.RACINE, 'SAVOIR', 'stories', 'methode-semaine.md'), 'utf8'); } catch (e) {}
    const postes = JOURS.filter(j => p.rythme.jours[j]);
    const consigne = [
      'Tu es le stratège des stories Instagram d\'un créateur. Tu écris SA SEMAINE TYPE de stories, d\'après LA MÉTHODE (plus bas) et SON PROFIL.',
      '- Ici RIEN ne se génère : tu n\'appelles aucun outil, tu ne dépenses aucun crédit. Tu écris, c\'est tout.',
      '- Un rôle par jour posté (' + postes.map(j => NOMS[j]).join(', ') + '), dans l\'ordre de la semaine ; les jours non postés n\'apparaissent pas.',
      '- Pour chaque jour : « role » = le nom du rôle, 2 à 5 mots, adapté à SA niche et à SON offre (« L\'offre (la projection) », « La preuve », « L\'astuce <niche> »…) ; « texte » = 3 à 7 phrases : le but, le déroulé type story par story, des exemples de problèmes ou de sujets concrets DE SA NICHE, ce qu\'on y montre (photos du quotidien, captures, vidéos — selon comment la personne apparaît), et le mot à répondre s\'il y en a un (seulement ceux du profil). Écris « la personne » ou son prénom, jamais « je ».',
      '- AUCUN FAIT INVENTÉ sur la personne (chiffres, résultats, clients) : la semaine type dit QUOI montrer, les faits viendront chaque semaine.',
      '- « tete » : deux ou trois phrases d\'introduction : à quoi sert la semaine, ce qu\'elle vend, ce qu\'on montre en général.',
      'Tu réponds UNIQUEMENT du JSON strict, sur une ligne : {"tete":"…","jours":[{"jour":"lundi","role":"…","texte":"…"}]}',
      '', '# LA MÉTHODE', '', methode
    ].join('\n');
    const q = enClair(p) + '\nSon rythme : ' + p.rythme.min + ' à ' + p.rythme.max + ' stories par jour posté.' + (envie ? '\n\nCE QU\'ELLE DEMANDE (c\'est un ordre) : ' + txt(envie, 600) : '') + '\n\nÉcris sa semaine type.';
    const r = await D.interroger(q, consigne, null, 1, D.DELAI_MAX, { args: ['--strict-mcp-config'] });
    let j = null; try { j = JSON.parse(D.premierObjetJson(r.texte || '')); } catch (e) {}
    if (!j || !Array.isArray(j.jours) || !j.jours.length) throw new Error("Claude n'a pas rendu de semaine type lisible. Réessaie.");
    const corps = j.jours.filter(x => x && JOURS.includes(String(x.jour).toLowerCase()) && txt(x.role, 60))
      .sort((a, b) => JOURS.indexOf(String(a.jour).toLowerCase()) - JOURS.indexOf(String(b.jour).toLowerCase()))
      .map(x => '## ' + NOMS[String(x.jour).toLowerCase()] + ' — ' + txt(x.role, 60) + '\n' + txt(x.texte, 3000)).join('\n\n');
    fs.mkdirSync(DOSSIER_ACTIF(), { recursive: true });
    fs.writeFileSync(F_SEMAINE(), '# La semaine type de ' + (p.prenom || 'mes stories') + (p.compte ? ' (' + p.compte + ')' : '') + '\n\n' + txt(j.tete, 1200) + '\n\n' + corps + '\n', 'utf8');
    return { texte: lireSemaineType(), jours: jours() };
  }

  // ------------------------------------------------------------------ la DA de la personne : créée d'office, neutre
  function assurerDA() {
    const p = lire();
    if (p.da && D.lireIdentite(p.da)) return p.da;
    const fiche = D.enregistrerIdentite({ nom: p.prenom ? 'DA de ' + p.prenom : 'Ma DA', sous: 'story', couleurs: { fond: '#14101d', texte: '#f5f2f9', accent: '#f44b7b', second: '#fdab3d' }, polices: { titres: 'Sora', texte: 'Inter' } });
    p.da = fiche.id; ecrire(p);
    return p.da;
  }

  // ------------------------------------------------------------------ PLUSIEURS PROFILS
  let occupe = () => false;   // posé par serveur.js : une préparation de semaine en cours interdit de changer de profil
  /** Un profil neuf, vide, qui devient actif : son projet « stories-<id> » ; sa DA naîtra au premier besoin. */
  function creerProfilVide() {
    let k = ids().length + 1, id = 'profil-' + k; while (fs.existsSync(dossierDe(id))) id = 'profil-' + (++k);
    fs.mkdirSync(dossierDe(id), { recursive: true });
    D.ecrireJsonSurement(path.join(dossierDe(id), 'profil.json'), Object.assign(defaut(), { projet: 'stories-' + id, cree: new Date().toISOString() }));
    const x = lireIndex(); ecrireIndex({ actif: id, ordre: x.ordre.filter(i => i !== id).concat(id) });
    return id;
  }
  function liste() {
    const a = actif();
    return { actif: a, profils: ids().map(id => { let p = {}; try { p = JSON.parse(fs.readFileSync(path.join(dossierDe(id), 'profil.json'), 'utf8')); } catch (e) {}
      return { id, prenom: p.prenom || '', compte: p.compte || '', complet: !!p.complet }; }) };
  }
  function choisir(id) {
    if (!ids().includes(id)) throw new Error('Ce profil n\'existe pas.');
    if (id !== actif() && occupe()) throw new Error('Une préparation de semaine tourne encore : attends qu\'elle finisse pour changer de profil.');
    const x = lireIndex(); ecrireIndex({ actif: id, ordre: x.ordre.length ? x.ordre : ids() });
  }
  function nouveau() {
    if (occupe()) throw new Error('Une préparation de semaine tourne encore : attends qu\'elle finisse pour créer un profil.');
    const avant = actif(), id = creerProfilVide();
    const x = lireIndex(); x.precedent = avant; ecrireIndex(x);
    return id;
  }
  /** Retirer un profil : son dossier part dans MON-PROFIL/_corbeille ; ses stories, sa DA et ses fichiers restent sur le disque. */
  function retirer(id) {
    const l = ids(); if (!l.includes(id)) throw new Error('Ce profil n\'existe pas.');
    if (l.length < 2) throw new Error('C\'est le seul profil : il ne peut pas être retiré.');
    if (occupe()) throw new Error('Une préparation de semaine tourne encore : attends qu\'elle finisse.');
    const c = path.join(RACINE_P, '_corbeille'); fs.mkdirSync(c, { recursive: true });
    fs.renameSync(dossierDe(id), path.join(c, id + '-' + Date.now().toString(36)));
    const x = lireIndex(), reste = ids();
    ecrireIndex({ actif: x.actif === id ? (reste.includes(x.precedent) ? x.precedent : reste[0]) : x.actif, ordre: x.ordre.filter(i => i !== id) });
  }
  /* Une installation d'avant les profils multiples : MON-PROFIL/profil.json et semaine-type.md au premier niveau deviennent
     le premier profil (son id vient de son compte) ; ses captures et ses vidéos passent dans leur sous-dossier. */
  function reprendreUnique() {
    const vieux = path.join(RACINE_P, 'profil.json'); if (!fs.existsSync(vieux)) return;
    let p = {}; try { p = JSON.parse(fs.readFileSync(vieux, 'utf8')); } catch (e) {}
    let id = slug(p.compte) || slug(p.prenom) || 'moi'; if (!idOk(id)) id = 'moi';
    while (fs.existsSync(path.join(dossierDe(id), 'profil.json'))) id += '-2';
    fs.mkdirSync(dossierDe(id), { recursive: true });
    fs.renameSync(vieux, path.join(dossierDe(id), 'profil.json'));
    const st = path.join(RACINE_P, 'semaine-type.md'); if (fs.existsSync(st)) fs.renameSync(st, path.join(dossierDe(id), 'semaine-type.md'));
    for (const r of ['MES CAPTURES', 'MES VIDEOS']) {
      const d = path.join(D.RACINE, r); if (!fs.existsSync(d)) continue;
      fs.mkdirSync(path.join(d, id), { recursive: true });
      for (const f of fs.readdirSync(d)) { const a = path.join(d, f); if (f !== id && fs.statSync(a).isFile()) fs.renameSync(a, path.join(d, id, f)); }
      const corb = path.join(d, '_corbeille'); if (fs.existsSync(corb)) { try { fs.renameSync(corb, path.join(d, id, '_corbeille')); } catch (e) {} }
    }
    const x = lireIndex(); ecrireIndex({ actif: id, ordre: [id].concat(x.ordre.filter(i => i !== id)) });
  }

  // sa voix (la façon de parler, ses textes) : rangée dans SA DA, que Claude lit pour chaque story
  function voix() { const da = lire().da && D.lireIdentite(lire().da); return { parole: (da && da.parole) || '', paroleExemples: (da && da.paroleExemples) || '' }; }
  function enregistrerVoix(d) {
    const id = assurerDA(), da = D.lireIdentite(id);
    D.enregistrerIdentite({ id, nom: da.nom, parole: txt(d.parole, 800), paroleExemples: String(d.paroleExemples || '').trim().slice(0, 16000) });
  }
  function etat() { if (!lire().da || !D.lireIdentite(lire().da)) assurerDA(); const p = lire(); return Object.assign({}, p, { id: actif(), semaine: { texte: lireSemaineType(), jours: jours() }, recetteDefaut: RECETTE_DEFAUT, voix: voix(), profils: liste().profils }); }

  function routes(req, res, url) {
    const M = req.method, echec = e => D.repondreJson(res, 400, { erreur: (e && e.message) || String(e) });
    if (M === 'GET' && url === '/api/profil') { D.repondreJson(res, 200, etat()); return true; }
    if (M === 'GET' && url === '/api/profils') { D.repondreJson(res, 200, liste()); return true; }
    if (M === 'POST' && /^\/api\/profils\/(choisir|nouveau|retirer)$/.test(url)) {
      D.corpsJson(req, 1e4).then(d => { const a = url.split('/').pop();
        if (a === 'choisir') choisir(String((d || {}).id || '')); else if (a === 'nouveau') nouveau(); else retirer(String((d || {}).id || ''));
        D.repondreJson(res, 200, liste()); }).catch(echec); return true;
    }
    if (M === 'POST' && url === '/api/profil') {
      D.corpsJson(req, 1e5).then(d => { enregistrer(d || {}); if (d && d.complet) assurerDA(); D.repondreJson(res, 200, etat()); }).catch(echec); return true;
    }
    if (M === 'POST' && url === '/api/profil/voix') {
      D.corpsJson(req, 1e5).then(d => { enregistrerVoix(d || {}); D.repondreJson(res, 200, etat()); }).catch(echec); return true;
    }
    if (M === 'POST' && url === '/api/profil/semaine-type') {
      D.corpsJson(req, 2e5).then(d => { enregistrerJours((d && d.jours) || {}); D.repondreJson(res, 200, etat()); }).catch(echec); return true;
    }
    if (M === 'POST' && url === '/api/profil/semaine-type/proposer') {
      D.corpsJson(req, 1e4).then(d => proposerSemaine(d && d.envie)).then(() => D.repondreJson(res, 200, etat())).catch(echec); return true;
    }
    return false;
  }

  reprendreUnique();
  return { lire, enregistrer, enClair, jours, lireSemaineType, assurerDA, routes, RECETTE_DEFAUT, NOMS, JOURS,
    id: () => actif(), projet: () => lire().projet || 'stories-' + actif(), da: () => lire().da || '', poserOccupe: f => { occupe = f; } };
};
