/* Nuage : connexion par code (Auth Supabase), session, lecture et écriture REST.
   Repris de salle-app/nuage.js. fetch, horloge et mémoire de session sont injectés pour les tests ; aucune bibliothèque. */

export function creerNuage({ url, cle, comptes, fetch: f = globalThis.fetch.bind(globalThis), memoire, horloge = () => Date.now() }) {
  const enTetes = { apikey: cle, 'Content-Type': 'application/json' };

  const traduire = (j) => {
    const m = (j && (j.error_code || j.msg || j.error_description || j.message)) || '';
    if (/invalid_credentials|invalid login/i.test(m)) return 'Ce code ne correspond pas';
    if (/rate|too many/i.test(m)) return "Trop d'essais, attends une minute";
    if (/not confirmed/i.test(m)) return 'Compte pas encore confirmé';
    return m ? `Connexion refusée (${m})` : 'Connexion impossible';
  };

  /* Erreur avec un statut HTTP = refus du serveur ; sans statut = réseau (on garde la session, on réessaiera). */
  async function jeton(corps) {
    const grant = corps.refresh_token ? 'refresh_token' : 'password';
    const r = await f(`${url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: enTetes, body: JSON.stringify(corps) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) { const e = new Error(traduire(j)); e.statut = r.status; throw e; }
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: horloge() + (j.expires_in || 3600) * 1000 };
  }

  async function session() {
    const s = memoire.lire();
    if (!s) return null;
    if (s.expires_at - horloge() > 60000) return s;
    try {
      const n = await jeton({ refresh_token: s.refresh_token });
      memoire.ecrire(n);
      return n;
    } catch (e) {
      if (e.statut && e.statut < 500) memoire.ecrire(null); // jeton refusé : il faudra retaper le code
      return null;                                         // réseau ou serveur : on garde la session pour plus tard
    }
  }

  async function requete(methode, chemin, options = {}, deuxiemeEssai = false) {
    const s = await session();
    if (!s) { const e = new Error('Pas de session'); e.session = false; throw e; }
    const r = await f(`${url}/rest/v1/${chemin}`, { method: methode,
      headers: { ...enTetes, Authorization: `Bearer ${s.access_token}`, ...(options.prefer ? { Prefer: options.prefer } : {}) },
      ...(options.corps !== undefined ? { body: JSON.stringify(options.corps) } : {}) });
    if (r.status === 401 && !deuxiemeEssai) { // jeton périmé côté serveur avant l'heure locale : on rafraîchit et on rejoue une fois
      const cur = memoire.lire(); if (cur) memoire.ecrire({ ...cur, expires_at: 0 });
      return requete(methode, chemin, options, true);
    }
    if (!r.ok) {
      let texte = ''; try { texte = (await r.text()).slice(0, 200); } catch (e) { texte = ''; }
      const e = new Error(`${chemin.split('?')[0]} : HTTP ${r.status} ${texte}`); e.statut = r.status; throw e;
    }
    return r;
  }

  return {
    connecte: () => !!memoire.lire(),
    deconnecter() { memoire.ecrire(null); },

    /* Essaie chaque compte avec le code ; une erreur réseau arrête tout de suite, un refus passe au compte suivant. */
    async connecter(code) {
      let derniere = 'Connexion impossible';
      for (const email of comptes) {
        try { const s = await jeton({ email, password: code }); memoire.ecrire(s); return s; }
        catch (e) { if (!e.statut) throw new Error('Pas de réseau : réessaie dans un instant'); derniere = e.message; }
      }
      throw new Error(derniere);
    },

    /* Lecture : chemin REST complet (table et filtres), rend les lignes. */
    async lire(chemin) {
      return (await requete('GET', chemin)).json();
    },

    /* Écriture sur la clé primaire : rejouer un envoi ne crée jamais de doublon. */
    async ecrire(table, lignes) {
      await requete('POST', table, { corps: lignes, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
  };
}
