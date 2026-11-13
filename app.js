/* Maison Sud : l'écran. Lit la base (ou les données du banc avec ?banc), dessine, enregistre vos gestes.
   Toute valeur venue d'une annonce passe par esc() ; tout lien et toute photo par lienSur(). */
import { SITES, esc, lienSur, ranger, euros, metres, jour, depuis, faits } from './logique.js';
import { creerNuage } from './nuage.js';

const BANC = new URLSearchParams(location.search).has('banc');
const racine = document.getElementById('app');
const memoire = (cle) => ({
  lire() { try { return JSON.parse(localStorage.getItem(cle)); } catch (e) { return null; } },
  ecrire(v) { try { v == null ? localStorage.removeItem(cle) : localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* navigation privée */ } },
});
const session = memoire('maison-sud-session'), prenom = memoire('maison-sud-prenom'), presque = memoire('maison-sud-presque');
const ONGLETS = [['voir', 'À voir'], ['aime', 'On aime'], ['suivi', 'Contactées et visites'], ['ecartees', 'Écartées'], ['parties', 'Parties']];
const VIDES = {
  voir: 'Aucune maison à voir pour l\'instant. Le robot repasse à 8 h, 13 h et 19 h.',
  aime: 'Rien ici pour l\'instant. Ouvre une maison et clique « On aime ».',
  suivi: 'Aucune maison contactée ni visite prévue.',
  ecartees: 'Vous n\'avez écarté aucune maison.',
  parties: 'Aucune annonce retirée pour l\'instant.',
};
const etat = { criteres: null, config: null, nuage: null, biens: [], avis: {}, passage: null,
  onglet: 'voir', choisi: null, photo: 0, erreur: null, vue: 'chargement', refus: '', ouverts: {} };

async function json(nom) {
  for (const base of ['./', '../']) {   // en ligne les fichiers sont à côté de la page ; dans le dépôt, un cran au-dessus
    try { const r = await fetch(base + nom, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* on essaie l'autre */ }
  }
  throw new Error(nom + ' introuvable');
}

async function charger() {
  if (BANC) {
    const d = await json('banc/donnees.json');
    etat.biens = d.biens;
    etat.avis = { ...Object.fromEntries((d.avis || []).map((a) => [a.bien_id, a])), ...etat.avis };
    etat.passage = d.passages[d.passages.length - 1] || null;
    return;
  }
  const [biens, avis, passages] = await Promise.all([
    etat.nuage.lire('maison_biens?select=*&order=id.asc&limit=3000'),
    etat.nuage.lire('maison_avis?select=bien_id,statut,note,visite_le,par,maj_le&limit=3000'),
    etat.nuage.lire('maison_passages?select=debut,fin,sites,nouvelles&order=fin.desc&limit=1'),
  ]);
  etat.biens = biens;
  etat.avis = Object.fromEntries(avis.map((a) => [a.bien_id, a]));
  etat.passage = passages[0] || null;
}

async function rafraichir() {
  try {
    await charger();
    etat.erreur = null;
    etat.vue = 'maisons';
  } catch (e) {
    if (e.session === false) etat.vue = 'code';
    else if (etat.vue === 'maisons') etat.erreur = 'Lecture impossible pour l\'instant : les maisons affichées datent du dernier chargement.';
    else { etat.vue = 'panne'; etat.refus = e.message; }
  }
  dessiner();
}

async function noter(id, modif) {
  const avant = etat.avis[id];
  const a = { statut: null, note: null, visite_le: null, ...(avant || {}), ...modif };
  const ligne = { bien_id: id, statut: a.statut, note: a.note, visite_le: a.statut === 'visite' ? a.visite_le : null,
    par: prenom.lire() || null, maj_le: new Date().toISOString() };
  etat.avis[id] = ligne;
  etat.erreur = null;
  dessiner();
  if (BANC) return;
  try {
    await etat.nuage.ecrire('maison_avis', [ligne]);
  } catch (e) {
    if (avant) etat.avis[id] = avant; else delete etat.avis[id];
    etat.erreur = e.session === false ? 'Pas enregistré : retape le code.' : 'Pas enregistré : réessaie dans un instant.';
    if (e.session === false) etat.vue = 'code';
    dessiner();
  }
}

/* ───────── dessin */

function puces(f, complet) {
  const b = f.bien, p = [];
  const statut = f.avis && f.avis.statut;
  if (statut === 'aime') p.push(['aime', 'On aime']);
  if (statut === 'contactee') p.push(['suivi', 'Contactée']);
  if (statut === 'visite') p.push(['suivi', 'Visite' + (f.avis.visite_le ? ' le ' + jour(f.avis.visite_le) : ' prévue')]);
  if (f.nouveau) p.push(['nouveau', 'Nouveau']);
  if (f.ideal) p.push(['ideal', 'Idéal, ' + b.pieces + ' pièces']);
  if (b.jardin === 'oui') p.push(['', 'Jardin']);
  if (b.garage === 'oui') p.push(['', 'Garage']);
  if (b.piscine) p.push(['', 'Piscine']);
  if (b.meuble === true) p.push(['', 'Meublé']);
  if (f.classe !== 'tout') for (const r of (complet ? f.raisons : f.raisons.slice(0, 1))) p.push(['verifier', r]);
  return '<span class="puces">' + p.map(([c, t]) => `<span class="puce ${c}">${esc(t)}</span>`).join('') + '</span>';
}

function ligne(f) {
  const b = f.bien, photo = lienSur((b.photos || [])[0]);
  const mesures = [metres(b.surface), b.pieces ? b.pieces + ' pièces' : null].filter(Boolean).join(', ');
  return `<button class="ligne${b.id === etat.choisi ? ' choisie' : ''}" data-id="${esc(b.id)}">
    <span class="vignette">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
    <span>
      <span class="loyer">${esc(euros(b.loyer))}</span>
      <span class="lieu">${esc(b.commune)}${b.quartier ? ', ' + esc(b.quartier) : ''}</span>
      <span class="mesures">${esc(mesures || 'Surface non précisée')}</span>
      ${puces(f, false)}
    </span>
  </button>`;
}

function liste(rangs) {
  const fiches = etat.onglet === 'voir' && presque.lire() ? [...rangs.voir, ...rangs.presque] : rangs[etat.onglet];
  let html = '';
  if (etat.onglet === 'voir' && rangs.presque.length) {
    html += `<label class="reglage"><input type="checkbox" id="presque"${presque.lire() ? ' checked' : ''}>
      Montrer aussi les ${rangs.presque.length} qui ratent un critère de peu</label>`;
  }
  html += fiches.length ? fiches.map(ligne).join('') : `<p class="vide">${esc(VIDES[etat.onglet])}</p>`;
  if (etat.onglet === 'voir') {
    const replie = (cle, titre, fs) => (fs.length
      ? `<details class="replie" data-replie="${cle}"${etat.ouverts[cle] ? ' open' : ''}><summary>${esc(titre)}</summary>${fs.map(ligne).join('')}</details>` : '');
    html += replie('hiver', `${rangs.hiver.length} locations d'hiver ou de quelques mois, écartées par le robot`, rangs.hiver);
    html += replie('hors', `${rangs.hors.length} hors critères (trop chères, trop petites ou sans jardin)`, rangs.hors);
  }
  return html;
}

function fiche(f) {
  const b = f.bien, a = f.avis || {};
  const photos = (b.photos || []).map(lienSur).filter(Boolean);
  const i = Math.min(etat.photo, Math.max(photos.length - 1, 0));
  const geste = (statut, texte, classe = '') =>
    `<button class="geste ${classe}" data-geste="${statut}" aria-pressed="${a.statut === statut}">${texte}</button>`;
  const sources = (b.sources || []).map((s) => {
    const url = lienSur(s.url);
    if (!url) return '';
    const qui = s.annonceur || (s.pro === false ? 'Particulier' : s.pro ? 'Agence' : '');
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Voir sur ${esc(SITES[s.site] || s.site)}<small>${esc(qui)}</small></a>`;
  }).join('');
  const charges = b.loyer == null ? '' : b.charges_comprises === true ? 'par mois, charges comprises'
    : b.charges_comprises === false ? 'par mois, charges en plus' : 'par mois, charges à vérifier';
  return `<article class="fiche">
    <button class="retour" data-retour>Retour à la liste</button>
    <div class="photo${photos.length ? '' : ' aucune'}">
      ${photos.length ? `<img src="${esc(photos[i])}" alt="Photo ${i + 1} de la maison" referrerpolicy="no-referrer">` : ''}
      ${photos.length > 1 ? `<button class="pas avant" data-photo="-1" aria-label="Photo précédente">‹</button>
        <button class="pas apres" data-photo="1" aria-label="Photo suivante">›</button>
        <span class="compte">${i + 1} sur ${photos.length}</span>` : ''}
    </div>
    <div class="entete">
      <div><h1 class="plaque">${esc(b.commune)}</h1>${b.quartier ? `<p class="quartier">${esc(b.quartier)}</p>` : ''}</div>
      <div class="prix"><strong>${esc(euros(b.loyer))}</strong><span>${esc(charges)}</span></div>
    </div>
    ${puces(f, true)}
    <div class="gestes">
      ${geste('aime', 'On aime', 'aime')}${geste('contactee', 'Contactée')}${geste('visite', 'Visite prévue')}${geste('ecartee', 'Écarter')}
      ${a.statut === 'visite' ? `<label>le <input type="date" id="visite-le" value="${esc(a.visite_le || '')}"></label>` : ''}
    </div>
    <div class="note">
      <textarea id="note" maxlength="2000" placeholder="Votre note à deux : ce qui plaît, ce qui gêne, qui a appelé">${esc(a.note || '')}</textarea>
      <div class="bas"><button data-note>Enregistrer la note</button>
        <span>${a.maj_le ? 'Dernier geste' + (a.par ? ' de ' + esc(a.par) : '') + ', ' + esc(depuis(a.maj_le, Date.now())) : ''}</span></div>
    </div>
    <dl class="faits">${faits(b).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${b.description ? `<h2>L'annonce</h2><p class="texte">${esc(b.titre && b.titre !== b.description ? b.titre + '\n' : '')}${esc(b.description)}</p>` : (b.titre ? `<h2>L'annonce</h2><p class="texte">${esc(b.titre)}</p>` : '')}
    <h2>${(b.sources || []).length > 1 ? 'La même maison sur ' + b.sources.length + ' sites' : 'Où la voir'}</h2>
    <div class="sources">${sources}</div>
    <p class="dates">${b.publie_le ? 'Publiée le ' + esc(jour(b.publie_le)) + '. ' : ''}Repérée par le robot ${esc(depuis(b.premiere_vue, Date.now()))}.${b.partie_le ? ' Annonce retirée depuis le ' + esc(jour(b.partie_le)) + '.' : ''}</p>
  </article>`;
}

function robot() {
  const p = etat.passage;
  if (!p) return '<span>Le robot n\'est pas encore passé</span>';
  const sites = Object.keys(SITES).map((s) => {
    const e = (p.sites || {})[s] || { lu: false };
    return e.lu ? `<span class="site" title="${esc(e.nb)} annonces lues">${esc(SITES[s])}</span>`
      : `<span class="site bloque" title="${esc(e.erreur || '')}">${esc(SITES[s])} non lu</span>`;
  }).join('');
  return `<span>Dernier passage ${esc(depuis(p.fin, Date.now()))}</span>${sites}`;
}

function dessiner() {
  if (etat.vue === 'chargement') { racine.innerHTML = '<p class="vide">Chargement des maisons…</p>'; return; }
  if (etat.vue === 'attente') { racine.innerHTML = '<div class="porte"><h1>Maison Sud</h1><p>La page n\'est pas encore reliée à sa base. Elle le sera dès que le compte sera créé.</p></div>'; return; }
  if (etat.vue === 'panne') { racine.innerHTML = `<div class="porte"><h1>Maison Sud</h1><p>Les maisons ne se chargent pas (${esc(etat.refus)}). Vérifie ta connexion puis recharge la page.</p></div>`; return; }
  if (etat.vue === 'code') {
    racine.innerHTML = `<form class="porte" id="porte"><h1>Maison Sud</h1><p>Les maisons à louer entre Toulon et Hyères.</p>
      <label for="prenom">Ton prénom</label><input id="prenom" autocomplete="given-name" maxlength="40" required value="${esc(prenom.lire() || '')}">
      <label for="code">Le code</label><input id="code" type="password" autocomplete="current-password" required>
      <button>Entrer</button><p class="refus" role="alert">${esc(etat.refus)}</p></form>`;
    return;
  }
  const rangs = ranger(etat.biens, etat.avis, etat.criteres, Date.now());
  const toutes = Object.values(rangs).flat();
  const large = matchMedia('(min-width: 900px)').matches;
  let choisie = toutes.find((f) => f.bien.id === etat.choisi) || null;
  if (!choisie && large) {   // sur ordinateur, la première maison de l'onglet est ouverte d'office
    choisie = rangs[etat.onglet][0] || null;
    etat.choisi = choisie ? choisie.bien.id : null;
    etat.photo = 0;
  }
  const haut = racine.querySelector('.liste') ? racine.querySelector('.liste').scrollTop : 0;
  racine.innerHTML = `<header class="haut">
      <p class="marque">Maison Sud</p>
      <nav class="onglets" aria-label="Vos listes">${ONGLETS.map(([cle, nom]) =>
        `<button data-onglet="${cle}" aria-current="${cle === etat.onglet}">${nom}<span class="nb">${rangs[cle].length}</span></button>`).join('')}</nav>
      <div class="robot">${robot()}<button data-actualiser>Actualiser</button></div>
    </header>
    ${etat.erreur ? `<p class="alerte" role="alert">${esc(etat.erreur)}</p>` : ''}
    <main><section class="liste" aria-label="Maisons">${liste(rangs)}</section>
      <section class="detail" aria-live="polite">${choisie ? fiche(choisie) : '<p class="vide">Choisis une maison dans la liste.</p>'}</section></main>`;
  racine.querySelector('.liste').scrollTop = haut;
}

/* ───────── gestes */

document.addEventListener('click', (e) => {
  const c = (sel) => e.target.closest(sel);
  let el;
  if ((el = c('[data-id]'))) { etat.choisi = el.dataset.id; etat.photo = 0; document.body.classList.add('fiche-ouverte'); dessiner(); racine.querySelector('.detail').scrollTop = 0; }
  else if ((el = c('[data-onglet]'))) { etat.onglet = el.dataset.onglet; etat.choisi = null; document.body.classList.remove('fiche-ouverte'); dessiner(); }
  else if (c('[data-retour]')) { document.body.classList.remove('fiche-ouverte'); }
  else if ((el = c('[data-photo]'))) {
    const n = ((etat.biens.find((b) => b.id === etat.choisi) || {}).photos || []).map(lienSur).filter(Boolean).length;
    etat.photo = (etat.photo + Number(el.dataset.photo) + n) % n; dessiner();
  }
  else if ((el = c('[data-geste]'))) {
    const actuel = (etat.avis[etat.choisi] || {}).statut;
    noter(etat.choisi, { statut: actuel === el.dataset.geste ? null : el.dataset.geste });
  }
  else if (c('[data-note]')) { noter(etat.choisi, { note: document.getElementById('note').value.trim() || null }); }
  else if (c('[data-actualiser]')) { rafraichir(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'presque') { presque.ecrire(e.target.checked || null); dessiner(); }
  if (e.target.id === 'visite-le') { noter(etat.choisi, { statut: 'visite', visite_le: e.target.value || null }); }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'porte') return;
  e.preventDefault();
  prenom.ecrire(document.getElementById('prenom').value.trim().slice(0, 40));
  try {
    await etat.nuage.connecter(document.getElementById('code').value);
    etat.refus = '';
    etat.vue = 'chargement';
    dessiner();
    await rafraichir();
  } catch (err) { etat.refus = err.message; dessiner(); }
});

/* Une liste repliée qu'on ouvre reste ouverte quand l'écran se redessine. */
document.addEventListener('toggle', (e) => {
  if (e.target.dataset && e.target.dataset.replie) etat.ouverts[e.target.dataset.replie] = e.target.open;
}, true);

/* Une photo que son site refuse d'afficher ailleurs : la case reste, avec le renvoi vers l'annonce. */
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') { const boite = e.target.closest('.vignette, .photo'); if (boite) boite.classList.add('sans-photo'); }
}, true);

async function demarrer() {
  dessiner();
  try {
    [etat.criteres, etat.config] = await Promise.all([json('criteres.json'), json('config.json')]);
  } catch (e) { etat.vue = 'panne'; etat.refus = e.message; dessiner(); return; }
  if (!BANC) {
    if (!etat.config.compte) { etat.vue = 'attente'; dessiner(); return; }
    etat.nuage = creerNuage({ url: etat.config.supabase_url, cle: etat.config.supabase_cle, comptes: [etat.config.compte], memoire: session });
    if (!etat.nuage.connecte()) { etat.vue = 'code'; dessiner(); return; }
  }
  await rafraichir();
  setInterval(() => { if (etat.vue === 'maisons' && !document.hidden && !document.activeElement.matches('textarea, input')) rafraichir(); }, 5 * 60 * 1000);
}

demarrer();
