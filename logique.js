/* Logique pure de la page : classement, rangement par onglet, mise en forme.
   Le classement existe aussi côté robot (robot/regles.py) : les deux sont tenus d'accord
   par tests/cas-classement.json, lu par les deux suites de tests. */

export const SITES = { bienici: "Bien'ici", leboncoin: 'Leboncoin', seloger: 'SeLoger', pap: 'PAP' };

/* Tout texte venu d'une annonce passe par ici avant d'entrer dans la page. */
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Un lien ou une photo ne sort de la base que s'il commence par https. */
export function lienSur(u) {
  return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

export function classer(bien, criteres) {
  if (bien.hiver) return { classe: 'hiver', raisons: [bien.hiver_raison || "location d'hiver"] };
  const presque = [], manques = [], hors = [];
  const loyer = bien.loyer, surface = bien.surface == null ? null : Number(bien.surface);
  if (loyer == null) manques.push('loyer non précisé');
  else if (loyer > criteres.presque.loyer_max) hors.push('loyer trop haut');
  else if (loyer > criteres.loyer_max) presque.push('loyer un peu au-dessus');
  else if (bien.charges_comprises === false) manques.push('charges en plus du loyer');
  if (surface == null) manques.push('surface non précisée');
  else if (surface < criteres.presque.surface_min) hors.push('trop petit');
  else if (surface < criteres.surface_min) presque.push('surface un peu en dessous');
  if (criteres.jardin_obligatoire) {
    if (bien.jardin === 'non') hors.push('pas de jardin');
    else if (bien.jardin !== 'oui') manques.push('jardin non précisé');
  }
  if (hors.length || presque.length > 1) return { classe: 'hors', raisons: [...hors, ...presque] };
  if (presque.length) return { classe: 'presque', raisons: [...presque, ...manques] };
  if (manques.length) return { classe: 'verifier', raisons: manques };
  return { classe: 'tout', raisons: [] };
}

export function ideal(bien, criteres) {
  return (bien.pieces || 0) >= criteres.ideal_pieces_min;
}

export function estNouveau(bien, maintenant, criteres) {
  return maintenant - Date.parse(bien.premiere_vue) < criteres.nouveau_heures * 3600 * 1000;
}

/* Dans quel onglet va une maison : vos gestes passent avant le classement du robot. */
export function onglet(bien, avis, classe) {
  if (bien.partie_le) return 'parties';
  const statut = avis && avis.statut;
  if (statut === 'aime') return 'aime';
  if (statut === 'contactee' || statut === 'visite') return 'suivi';
  if (statut === 'ecartee') return 'ecartees';
  return { tout: 'voir', verifier: 'voir', presque: 'presque', hiver: 'hiver', hors: 'hors' }[classe];
}

/* Toutes les maisons, rangées par onglet. Dans chaque onglet : les nouvelles d'abord, puis les plus récentes. */
export function ranger(biens, avisParId, criteres, maintenant) {
  const rangs = { voir: [], presque: [], aime: [], suivi: [], ecartees: [], parties: [], hiver: [], hors: [] };
  for (const bien of biens) {
    const c = classer(bien, criteres);
    const fiche = { bien, avis: avisParId[bien.id] || null, classe: c.classe, raisons: c.raisons,
      ideal: ideal(bien, criteres), nouveau: !bien.partie_le && estNouveau(bien, maintenant, criteres) };
    rangs[onglet(bien, fiche.avis, c.classe)].push(fiche);
  }
  const ordre = (a, b) => (b.nouveau - a.nouveau) || (Date.parse(b.bien.premiere_vue) - Date.parse(a.bien.premiere_vue))
    || (a.bien.id < b.bien.id ? -1 : 1);
  for (const cle of Object.keys(rangs)) rangs[cle].sort(ordre);
  rangs.suivi.sort((a, b) => String(a.avis.visite_le || '9999').localeCompare(String(b.avis.visite_le || '9999')) || ordre(a, b));
  return rangs;
}

export function euros(n) {
  return n == null ? 'Loyer non précisé' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
}

export function metres(n) {
  return n == null ? null : String(Math.round(Number(n) * 10) / 10).replace('.', ',') + ' m²';
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* « 12 nov. » depuis une date ISO (jour seul ou horodatage). */
export function jour(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[3]) + ' ' + MOIS[Number(m[2]) - 1] : '';
}

/* « il y a 3 h », « hier », « il y a 4 j ». */
export function depuis(iso, maintenant) {
  const minutes = Math.max(0, Math.round((maintenant - Date.parse(iso)) / 60000));
  if (minutes < 60) return minutes <= 1 ? "à l'instant" : 'il y a ' + minutes + ' min';
  const heures = Math.round(minutes / 60);
  if (heures < 24) return 'il y a ' + heures + ' h';
  const jours = Math.round(heures / 24);
  return jours === 1 ? 'hier' : 'il y a ' + jours + ' j';
}

/* Les faits d'une maison, en mots : ce qui est sûr est dit, ce qui manque est dit aussi. */
export function faits(bien) {
  const garage = { oui: 'Garage', parking: 'Parking (garage non précisé)', inconnu: 'Non précisé' }[bien.garage] || 'Non précisé';
  return [
    ['Surface', metres(bien.surface) || 'Non précisée'],
    ['Pièces', bien.pieces ? bien.pieces + (bien.chambres ? ' dont ' + bien.chambres + ' chambres' : '') : 'Non précisé'],
    ['Jardin', bien.jardin === 'oui' ? (bien.terrain ? 'Oui, terrain de ' + bien.terrain + ' m²' : 'Oui') : bien.jardin === 'non' ? 'Non' : 'Non précisé'],
    ['Stationnement', garage],
    ['Piscine', bien.piscine ? 'Oui' : 'Non précisée'],
    ['Meublé', bien.meuble === true ? 'Meublé' : bien.meuble === false ? 'Vide' : 'Non précisé'],
  ];
}
