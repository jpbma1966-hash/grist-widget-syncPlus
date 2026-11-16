/*
 * SyncPlus (version « Constructeur ») : synchronisation de tables entre documents Grist.
 * Adaptation du widget grist-factory/grist-widget-syncPlus 0.5.9 (Grist Factory,
 * https://grist-factory.fr, licence GNU GPL v3.0) : code regroupé en un seul script pour le widget
 * personnalisé « Constructeur » de Grist. Images et tutoriel retirés.
 * À coller dans l'onglet JavaScript ; le contenu de syncplus-builder.html va dans l'onglet HTML.
 * Réglage à adapter : GRIST_ORIGINS (section js/config.js, plus bas).
 */
const __M = {};
// ===== js/config.js =====
__M["js/config.js"] = (() => {
'use strict';
// RÉGLAGE À ADAPTER : adresses des instances Grist que le widget a le droit d'appeler (schéma
// http:// ou https:// compris, sans barre finale). Mettre ici l'adresse de CHAQUE instance Grist
// qui porte un document SOURCE ou CIBLE.
const GRIST_ORIGINS = [
  "https://docs.getgrist.com",
  "https://grist.numerique.gouv.fr",
  ];

const VERSION = "0.5.9 (constructeur)";
return { GRIST_ORIGINS, VERSION };
})();

// ===== js/logic/common.js =====
__M["js/logic/common.js"] = (() => {
'use strict';
// Logique pure de la synchro (dossier logic/) : ni DOM, ni `grist`, ni réseau. Tout ce qui décide
// (quelle version gagne, quoi écrire, quelle adresse accepter) y est. Les
// autres modules lisent Grist, appellent ces fonctions et appliquent le résultat.
// Ici : les noms partagés par la SOURCE et la CIBLE, et de petits utilitaires.

// Colonnes ajoutées aux tables envoyées, et reçues dans les destinations.
const KEY_COL = 'id_sync'; // clé stable, UUID posé à la création de la ligne
const ORDER_COL = 'MajLe'; // heure de la dernière modification d'une valeur envoyée
// Heure du dernier recalcul de MajLe (formule ordinaire). Une annulation (Ctrl+Z) remet MajLe à sa
// valeur d'avant, mais Grist recalcule cette colonne : c'est ainsi que le lot repère une annulation.
const RECALC_COL = 'RecalculLe';
const DELETE_COL = 'Supprime'; // suppression logique, prise en compte si la table l'a

// SOURCE : la seule table technique du widget, quel que soit le nombre d'exports et de tables.
// Chaque table d'un export y a ses lignes (voir KIND) ; le webhook d'un destinataire n'envoie que
// celles de son export.
const SYNC_TABLE = 'Synchro';
const EXPORT_COL = 'Synchro_Export'; // identifiant de l'export
const TABLE_COL = 'Synchro_Table'; // table SOURCE (et, dans le journal, table d'origine d'une ligne)
const TYPE_COL = 'Synchro_Type'; // voir KIND
const SCHEMA_COL = 'Synchro_Colonnes'; // colonnes envoyées : [{ id, type, label }] en JSON
const RESEND_COL = 'Synchro_Renvoi'; // lignes à renvoyer, écrites par le widget
const LIST_COL = 'Synchro_Ids'; // ce qu'il faut envoyer de la liste des clés
const LOT_COL = 'Synchro_Lot'; // lot : lignes récentes avec leurs colonnes, en JSON
const AUTHOR_COL = 'Sync_Par'; // e-mail de la personne qui a ajouté la ligne (user.Email)
const STATE_COL = 'Sync_Etat'; // CIBLE : effet de la version recopiée (ajout, modif, suppression)
// Le webhook envoie chaque ligne de Synchro entière, et un journal refuse une colonne qu'il n'a pas :
// la marque d'envoi coupé (lignes 'lot') et le suivi des clés (lignes 'suivi') reprennent donc le nom
// d'une colonne que tous les journaux ont déjà.
const MISSING_COL = STATE_COL;
const TRACK_COL = STATE_COL;
// Types de ligne. Les webhooks n'envoient que les listes et les lots ('cles', 'lot') ; le suivi des
// clés, le filtre de lignes et la ligne d'un export en Échange restent dans la SOURCE ; 'complet' et
// son empreinte ne sont lus que par le lien public. Une seule ligne 'charge', d'aucun export, suit
// les renvois du document (voir resend.js).
const KIND = { keys: 'cles', lot: 'lot', full: 'complet', mark: 'empreinte', filter: 'filtre', track: 'suivi', swap: 'echange', load: 'charge', end: 'fin' };

// CIBLE : un journal par export reçu, où le webhook dépose les lignes de Synchro.
const JOURNAL_PREFIX = 'Journal_';
// Tables de la personne, que l'on peut envoyer ou choisir comme destination : pas celles du widget.
const isUserTable = id => id !== SYNC_TABLE && !id.startsWith('Synchro_') && !id.startsWith(JOURNAL_PREFIX);
const APPLIED_COL = 'Sync_Applique'; // version déjà recopiée dans la destination
const RECEIVED_COL = 'Sync_Recu'; // date d'arrivée de la ligne dans le journal (NOW())
const DATA_COL = 'Synchro_Donnees'; // colonnes envoyées d'une ligne, en un bloc JSON
// CIBLE : ce que la recopie a remplacé, pour l'historique, en JSON : { v: valeurs d'avant des
// colonnes modifiées } pour une modification, { n: numéro de la ligne } pour une suppression.
const BEFORE_COL = 'Sync_Avant';

// Les clés d'une table sont réparties en BUCKETS seaux selon leur CRC-32 (voir formulas.js).
const BUCKETS = 256;
const LIST_PREFIX = 'ids:'; // liste complète d'un seul tenant (montage 0.4, lien public)
const RESEND_ALL = 1; // marque de renvoi : toute la table, lignes sans MajLe comprises

const CHUNK = 500; // lignes par action

// fetchTable renvoie des colonnes ({id: [...], Nom: [...]}) : on travaille en lignes.
function toRows(columnar) {
  if (!columnar || !Array.isArray(columnar.id)) return [];
  const cols = Object.keys(columnar);
  return columnar.id.map((_, i) => Object.fromEntries(cols.map(c => [c, columnar[c][i]])));
}

function chunk(items, size = CHUNK) {
  const parts = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

// Éléments rangés par clé, dans leur ordre : Map(clé -> [éléments]).
function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const isBlank = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const isTrue = value => value === true || value === 1
  || (typeof value === 'string' && ['true', 'oui', 'vrai', '1'].includes(value.trim().toLowerCase()));

function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
// SHA-256 : crypto.subtle n'existe qu'en HTTPS ; sinon calcul en JavaScript.
function sha256Fallback(bytes) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  H.forEach((x, i) => outView.setUint32(i * 4, x));
  return out;
}
const sha256 = async (text) => {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto && crypto.subtle) return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  return toHex(sha256Fallback(bytes));
};

// UUID v4 : crypto.randomUUID n'existe qu'en HTTPS.
const randomUUID = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const COL_ID = /^[A-Za-z_][A-Za-z0-9_]*$/; // identifiant de table ou de colonne Grist
const HEX16 = /^[0-9a-f]{16}$/; // identifiant d'export ou d'invitation
// Contrôle d'une valeur lue dans un code ou un journal : `RegExp.test` changerait un tableau ou
// `undefined` en texte.
const is = (re, value) => typeof value === 'string' && re.test(value);
// Identifiant reçu d'ailleurs (code, journal) : valide pour Grist, et pas un nom propre aux objets
// JavaScript (`__proto__`, `constructor`…), qui servira de clé.
const isSafeId = value => is(COL_ID, value) && !(value in Object.prototype);

// Identifiant de table Grist valide à partir d'un nom libre.
function toTableId(name, fallback = 'Table') {
  let id = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
  if (/^[0-9]/.test(id)) id = 'T_' + id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Premier identifiant libre : `base`, puis `base_2`, `base_3`… Grist ne distingue pas les
// majuscules d'un identifiant à l'autre (`ANNUAIRE` prendrait la place d'`Annuaire`) : la
// comparaison non plus.
function freeTableId(base, taken) {
  const used = new Set(taken.map(id => id.toLowerCase()));
  const free = id => !used.has(id.toLowerCase());
  if (free(base)) return base;
  let n = 2;
  while (!free(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// CRC-32 d'un texte en UTF-8, comme zlib.crc32(texte.encode()) dans les formules Python.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(text) {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Seau d'une clé : les premiers bits de son CRC-32.
const bucketOf = key => Math.floor(crc32(String(key)) * BUCKETS / 2 ** 32);
return { KEY_COL, ORDER_COL, RECALC_COL, DELETE_COL, SYNC_TABLE, EXPORT_COL, TABLE_COL, TYPE_COL, SCHEMA_COL, RESEND_COL, LIST_COL, LOT_COL, AUTHOR_COL, STATE_COL, MISSING_COL, TRACK_COL, KIND, JOURNAL_PREFIX, isUserTable, APPLIED_COL, RECEIVED_COL, DATA_COL, BEFORE_COL, BUCKETS, LIST_PREFIX, RESEND_ALL, toRows, chunk, groupBy, isBlank, isTrue, parseJson, randomHex, sha256, randomUUID, COL_ID, HEX16, is, isSafeId, toTableId, freeTableId, crc32, bucketOf };
})();

// ===== js/logic/formulas.js =====
__M["js/logic/formulas.js"] = (() => {
'use strict';
// SOURCE : les formules de la table Synchro, et les colonnes que le widget ajoute aux tables
// envoyées (clé, MajLe, RecalculLe, Supprime).
const {
  AUTHOR_COL, BUCKETS, COL_ID, DELETE_COL, EXPORT_COL, KEY_COL, KIND, LIST_COL, LOT_COL, MISSING_COL, ORDER_COL, RECALC_COL, RESEND_COL, SCHEMA_COL,
  SYNC_TABLE, TABLE_COL, TRACK_COL, TYPE_COL, chunk, isBlank,
} = __M["js/logic/common.js"];

const WINDOW_S = 5; // un lot porte les lignes modifiées depuis 5 secondes
// Au chargement du document, Grist recalcule RECALC_COL pour toutes les lignes : ce n'est pas une
// annulation, sauf dans une petite table, renvoyée alors en entier (quelques lignes).
const SMALL_TABLE = 20;
// Octets d'un lot. Grist refuse un envoi de plus de 1 Mo, et un même envoi regroupe les listes des
// clés et les lots des tables d'un export qui changent ensemble : chaque lot prend sa part de ce
// que les listes laissent.
const LOT_MAX = 250000;
const POST_MAX = 950000;
const LOT_MIN = 20000;
// Instantané d'un export public, relu par chaque page CIBLE ouverte quand il change : au-delà, il
// reste vide et la CIBLE dit que la table est trop grosse pour le lien public.
const PUBLIC_MAX = 2000000;
// Le suivi ne garde qu'une somme de CRC-32 par seau de clés, de taille fixe quelle que soit la
// table (la liste de toutes les clés, réécrite à chaque ajout, faisait grossir l'historique du
// document de 1,5 Mo par ligne ajoutée sur 20 000 lignes ; les sommes, de quelques Ko, mesuré). Un
// seau qui perd une clé part en entier (ses clés restantes) ; au-delà de PART_KEYS clés à envoyer
// d'un coup, le widget SOURCE renvoie la liste complète, par morceaux de PART_KEYS clés. Une clé
// (UUID) fait une quarantaine d'octets : de quoi laisser la place aux lots.
const PART_KEYS = 5000;

// Lecture d'une valeur (`g`) et filtre de lignes de la table dans l'export (`keep`), communs aux
// formules : une ligne qui sort du filtre quitte les clés, la CIBLE l'efface. Une valeur est lue à
// part : une cellule en erreur part vide sans bloquer les autres. Dates en secondes (format de
// Grist), Référence par son texte affiché.
const READ = [
  'import json, datetime',
  'def v(x):',
  '  if isinstance(x, datetime.datetime): return x.timestamp()',
  '  if isinstance(x, datetime.date): return (x - datetime.date(1970, 1, 1)).days * 86400',
  '  if isinstance(x, (list, tuple)): return [v(y) for y in x]',
  '  return x if x is None or isinstance(x, (str, int, float, bool)) else str(x)',
  'def g(r, c):',
  '  try:',
  '    x, s, w = getattr(r, c["id"]), c.get("source", ""), c.get("visible", "")',
  '    if s.startswith("RefList:"): return ", ".join(str(getattr(y, w) if w else y.id) for y in x)',
  '    if s.startswith("Ref:"): return v(getattr(x, w) if w else x.id)',
  '    return v(x)',
  '  except Exception:',
  '    return None',
  'def txt(x):',
  '  if isinstance(x, bool): return "oui" if x else "non"',
  '  if isinstance(x, float) and x.is_integer(): x = int(x)',
  '  if isinstance(x, list): return ", ".join(txt(y) for y in x)',
  '  return "" if x is None else str(x).strip().lower()',
  `f = ${SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.filter}")`,
  `spec = json.loads(f.${SCHEMA_COL} or "null") if f.id else None`,
  'def keep(r): return not spec or txt(g(r, spec)) == spec["value"]',
];

// Formules de la table Synchro. Elles nomment en clair les tables qu'elles peuvent lire (`tables`,
// qui doivent exister : une table inconnue mettrait toutes les lignes en erreur) : le widget les
// réécrit quand un export gagne ou perd une table. Leurs variables sont en minuscules, comme aucun
// nom de table Grist.
function syncFormulas(tables) {
  const ids = [...new Set(tables)].filter(id => COL_ID.test(id)).sort();
  const pick = `tables = {${ids.map(id => `"${id}": ${id}`).join(', ')}}\nsrc = tables.get($${TABLE_COL})`;
  return { keys: keysFormula(pick), lot: lotFormula(pick), state: stateFormula(pick) };
}

// Synchro_Ids. Lignes 'cles' : ce qu'il faut envoyer de la liste, en JSON : les seaux qui ont perdu
// une clé (lus dans le suivi), et pendant un renvoi le morceau de la liste complète demandé dans
// Synchro_Renvoi ({ marque, n, apres }), à l'heure `t` du suivi. Lignes 'suivi' : le nombre de clés
// et la somme de leurs CRC-32, recalculés à chaque changement des clés, qui déclenchent le suivi.
// Lignes 'empreinte' : la taille et le CRC-32 de l'instantané public.
function keysFormula(pick) {
  return [
    // Empreinte de l'instantané public : la CIBLE ne relit l'instantané que si elle change.
    `if $${TYPE_COL} == "${KIND.mark}":`,
    '  import zlib',
    `  c = ${SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.full}").${LOT_COL} or ""`,
    '  return "%d:%08x" % (len(c), zlib.crc32(c.encode()))',
    `if $${TYPE_COL} not in ("${KIND.keys}", "${KIND.track}"): return ""`,
    // Échange : l'autre document n'efface rien d'après la liste des clés, elle ne part pas.
    `if $${TYPE_COL} == "${KIND.keys}" and ${SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.swap}").id: return ""`,
    pick, 'if src is None: return ""', ...READ,
    `if $${TYPE_COL} == "${KIND.track}":`,
    '  import zlib',
    `  sums = [zlib.crc32(str(r.${KEY_COL}).encode()) for r in src.all if r.${KEY_COL} and keep(r)]`,
    '  return "%d:%08x" % (len(sums), sum(sums) & 0xffffffff)',
    'import bisect',
    `s = ${SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.track}")`,
    `state = json.loads(s.${TRACK_COL}) if s.id and isinstance(s.${TRACK_COL}, str) and s.${TRACK_COL}.startswith("{") else {}`,
    'out = {"t": state["t"], "seaux": state["seaux"]} if state.get("seaux") else {}',
    `ask = json.loads($${RESEND_COL}) if ($${RESEND_COL} or "").startswith("{") else None`,
    // Le morceau porte l'heure du suivi : les clés n'ont pas changé depuis (sinon le suivi aussi).
    'if ask and state.get("t"):',
    `  have = sorted(set(str(r.${KEY_COL}) for r in src.all if r.${KEY_COL} and keep(r)))`,
    '  i = bisect.bisect_right(have, str(ask.get("apres") or ""))',
    `  out["liste"] = {"marque": ask.get("marque"), "n": ask.get("n"), "t": state["t"], "cles": have[i:i + ${PART_KEYS}], "fin": i + ${PART_KEYS} >= len(have)}`,
    'return json.dumps(out) if out else ""',
  ].join('\n');
}

// Synchro_Lot. Lignes 'lot' : les lignes modifiées depuis WINDOW_S secondes et celles demandées
// dans Synchro_Renvoi, avec les colonnes de l'export, plafonné (`total` dit combien il y en avait).
// Un lot coupé dit depuis quand (`depuis`) : la marque MISSING_COL le retient, et le widget SOURCE
// envoie le reste. Lignes 'complet' (lien public) : toutes les lignes, au plus PUBLIC_MAX octets
// (au-delà, aucune : `trop`).
// Une ligne annulée (Ctrl+Z : MajLe revenue en arrière, RECALC_COL recalculée à l'instant) part
// avec l'heure de l'annulation, pour l'emporter sur la version qu'elle annule.
// Échange : la consolidation écrit les lignes reçues avec MajLe à l'heure de leur version, et
// touche dans le même lot d'écritures la ligne 'echange' de l'export, dont MISSING_COL prend alors
// l'heure. Grist recalcule tout le lot d'écritures d'un coup : une ligne recalculée à cette heure-là
// (à une seconde près) et dont MajLe est plus ancienne vient de l'autre document. Elle n'y repart
// pas (pas d'écho) ; vers les autres exports (relais), elle part avec l'heure de sa version. Une
// modification ici a une MajLe plus récente que la ligne 'echange' : elle part toujours.
// `Supprime` part telle quelle : la CIBLE la lit comme une case à cocher (« Non » ne supprime pas).
function lotFormula(pick) {
  return [
    `if $${TYPE_COL} not in ("${KIND.lot}", "${KIND.full}"): return ""`, pick, 'if src is None: return ""', ...READ,
    `cols = json.loads($${SCHEMA_COL} or "[]")`,
    `again = set(int(i) for i in ($${RESEND_COL} or "").split(":")[-1].split(",") if i.strip().isdigit())`,
    `rows = [r for r in src.all if r.${KEY_COL} and keep(r)]`,
    'undone = set()',
    `if $${TYPE_COL} == "${KIND.lot}":`,
    `  swap = ${SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.swap}").id`,
    `  stamps = [x.${MISSING_COL} for x in ${SYNC_TABLE}.lookupRecords(${TYPE_COL}="${KIND.swap}") if isinstance(x.${MISSING_COL}, (int, float))]`,
    `  cut = NOW() - datetime.timedelta(seconds=${WINDOW_S})`,
    // Seule RECALC_COL (un nombre : lu vite) est lue sur toutes les lignes ; les dates, bien plus
    // lentes à lire, seulement sur les lignes recalculées depuis moins de WINDOW_S secondes.
    `  touched = [r for r in rows if (v(getattr(r, "${RECALC_COL}", None)) or 0) > v(cut)]`,
    '  def echo(r):',
    `    t, m = v(getattr(r, "${RECALC_COL}")) or 0, v(r.${ORDER_COL}) or 0`,
    '    return any(abs(t - s) < 1 and m < s for s in stamps)',
    `  recent = set(r.id for r in touched if r.${ORDER_COL} and r.${ORDER_COL} >= cut and not (swap and echo(r)))`,
    '  fresh = set() if swap else set(r.id for r in touched if r.id not in recent and echo(r))',
    '  undone = set(r.id for r in touched if r.id not in recent and r.id not in fresh and not echo(r))',
    // Toutes les lignes recalculées d'un coup : un rechargement du document, pas une annulation (une
    // petite table repart, sauf dans un Échange, où une version ancienne écraserait l'autre côté).
    `  if len(touched) == len(rows) > (0 if swap else ${SMALL_TABLE}): undone = set()`,
    '  rows = [r for r in rows if r.id in again or r.id in recent or r.id in undone or r.id in fresh]',
    // Une ligne renvoyée part au plus tôt à son dernier recalcul (hors Échange) : un rechargement
    // du document a pu la faire partir à cette heure-là (petite table), et la CIBLE ignorerait
    // sinon le renvoi, plus ancien, par exemple celui d'une colonne ajoutée à l'export (vérifié).
    // En Échange, un renvoi garde l'heure de sa version, pour ne pas l'emporter à tort.
    'def when(r):',
    `  if r.id in undone: return v(getattr(r, "${RECALC_COL}"))`,
    `  if r.id in again and $${TYPE_COL} == "${KIND.lot}" and not swap: return max(v(r.${ORDER_COL}) or 0, v(getattr(r, "${RECALC_COL}", None)) or 0)`,
    `  return v(r.${ORDER_COL})`,
    // Les listes de l'export partent dans le même envoi : chaque lot prend sa part de ce qu'elles laissent.
    `lists = ${SYNC_TABLE}.lookupRecords(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.keys}")`,
    `room = ${POST_MAX} - sum(len(r.${LIST_COL} or "") for r in lists)`,
    `budget = max(${LOT_MIN}, min(${LOT_MAX}, room // max(1, len(lists))))`,
    `capped = $${TYPE_COL} == "${KIND.lot}"`,
    'out, size, big = [], 0, []',
    `for r in sorted(rows, key=lambda r: when(r) or 0, reverse=True):`,
    `  line = [r.${KEY_COL}, when(r), v(getattr(r, "${DELETE_COL}", False)), {c["id"]: g(r, c) for c in cols}]`,
    '  n = len(json.dumps(line, ensure_ascii=False))',
    // Une ligne plus grosse qu'un envoi ne partira jamais : signalée, pas renvoyée sans fin.
    `  if capped and n > max(budget, room):`,
    `    big.append(r.${KEY_COL})`,
    '    continue',
    // Le premier venu part même s'il dépasse le plafond du lot : seul, il tient dans un envoi.
    '  if capped and out and size + n > budget: break',
    '  size += n',
    `  if not capped and size > ${PUBLIC_MAX}: return json.dumps({"lignes": [], "total": len(rows), "trop": True})`,
    '  out.append(line)',
    'lot = {"lignes": out, "total": len(rows)}',
    'if big: lot["tropGros"] = big',
    `if capped and len(out) + len(big) < len(rows): lot.update(depuis=v(cut), renvoi=bool(again))`,
    'return json.dumps(lot, ensure_ascii=False)',
  ].join('\n');
}

// Sync_Etat (formule de déclenchement). Lignes 'suivi' : l'heure du dernier changement des clés
// (`t`), le plus grand numéro de ligne vu (`top`), la somme des CRC-32 des clés de chaque seau
// (`s`), et les clés des seaux qui en ont perdu une (`seaux`). Une ligne de numéro supérieur à
// `top` est nouvelle : un seau dont la somme a bougé d'autre chose que ses nouvelles clés a perdu
// une clé (ou changé une clé). Au-delà de PART_KEYS clés à envoyer, `trop` (l'heure) reste posé
// jusqu'à ce que le widget SOURCE ait renvoyé la liste complète (il recopie alors `trop` dans
// Synchro_Renvoi du suivi). Lignes 'lot' : la marque d'envoi coupé, la plus ancienne date d'un lot
// coupé, gardée jusqu'à ce que le widget envoie le reste (un lot de renvoi coupé ne compte pas : le
// widget le recoupe lui-même). Ligne 'echange' : l'heure de la dernière consolidation.
function stateFormula(pick) {
  return [
    'import json',
    `if $${TYPE_COL} == "${KIND.swap}": return NOW().timestamp()`,
    `if $${TYPE_COL} == "${KIND.lot}":`,
    `  lot = json.loads($${LOT_COL} or "{}")`,
    '  if lot.get("depuis") and not lot.get("renvoi"):',
    '    return min(value, lot["depuis"]) if value else lot["depuis"]',
    '  return value',
    `if $${TYPE_COL} != "${KIND.track}": return value`, pick, 'if src is None: return value', ...READ,
    'import zlib',
    'old = json.loads(value) if isinstance(value, str) and value.startswith("{") else {}',
    'top = old.get("top", 0)',
    `sums, fresh, keys = [0] * ${BUCKETS}, [0] * ${BUCKETS}, []`,
    'for r in src.all:',
    `  if not r.${KEY_COL} or not keep(r): continue`,
    `  k = str(r.${KEY_COL})`,
    '  h = zlib.crc32(k.encode())',
    `  b = h * ${BUCKETS} >> 32`,
    '  sums[b] = (sums[b] + h) & 0xffffffff',
    '  if r.id > top: fresh[b] = (fresh[b] + h) & 0xffffffff',
    '  keys.append((b, k))',
    'was = old.get("s")',
    'if was == sums: return value',
    't = v(NOW())',
    'state = {"t": t, "top": max([top] + [r.id for r in src.all]), "s": sums}',
    `if isinstance(was, list) and len(was) == ${BUCKETS}:`,
    `  moved = set(b for b in range(${BUCKETS}) if (was[b] + fresh[b]) & 0xffffffff != sums[b])`,
    '  left = {str(b): [] for b in moved}',
    '  for b, k in keys:',
    '    if b in moved: left[str(b)].append(k)',
    `  if sum(len(x) for x in left.values()) > ${PART_KEYS}: state["trop"] = str(t)`,
    '  elif left: state["seaux"] = {b: sorted(x) for b, x in left.items()}',
    `if old.get("trop") and old["trop"] != $${RESEND_COL} and "trop" not in state: state["trop"] = old["trop"]`,
    'return json.dumps(state)',
  ].join('\n');
}

// Colonnes de la table Synchro. Le journal de la CIBLE doit toutes les avoir (le webhook envoie
// chaque ligne entière) : une colonne ajoutée ici doit déjà exister dans les journaux.
function syncColumns(tables) {
  const { keys, lot, state } = syncFormulas(tables);
  return [
    { id: EXPORT_COL, type: 'Text', isFormula: false },
    { id: TABLE_COL, type: 'Text', isFormula: false },
    { id: TYPE_COL, type: 'Text', isFormula: false },
    { id: SCHEMA_COL, type: 'Text', isFormula: false },
    { id: RESEND_COL, type: 'Text', isFormula: false },
    { id: LIST_COL, type: 'Text', isFormula: true, formula: keys },
    { id: LOT_COL, type: 'Text', isFormula: true, formula: lot },
    // Formule de déclenchement : ses dépendances (Synchro_Lot, Synchro_Ids, Synchro_Renvoi) sont posées après coup.
    { id: TRACK_COL, type: 'Any', isFormula: false, formula: state, recalcWhen: 0 },
    // E-mail de la personne qui crée l'export : présenté à la CIBLE comme propriétaire.
    { id: AUTHOR_COL, type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0 },
  ];
}

// ---------------------------------------------------------------------------------------------
// Colonnes ajoutées aux tables envoyées

// RecalculLe : heure (en secondes) du dernier recalcul de MajLe. Un nombre, et non une date : la
// formule du lot la lit sur toutes les lignes à chaque modification, et Grist lit une date environ
// cinq fois plus lentement (mesuré : 190 ms contre 38 ms sur 12 000 lignes).
const RECALC_SPEC = { type: 'Numeric', isFormula: true, formula: `$${ORDER_COL}\nreturn NOW().timestamp()` };

// Colonnes de la synchro qui manquent à une table.
const missingSyncColumns = cols => [KEY_COL, ORDER_COL, RECALC_COL].filter(id => !cols.some(c => c.colId === id));

// id_sync : UUID posé à la création. MajLe : NOW() à toute modification de la ligne.
function prepareSourceActions(tableId, missing) {
  const specs = {
    [KEY_COL]: { type: 'Text', isFormula: false, formula: 'UUID()', recalcWhen: 0 },
    [ORDER_COL]: { type: 'DateTime:UTC', isFormula: false, formula: 'NOW()', recalcWhen: 2 },
    [RECALC_COL]: RECALC_SPEC,
  };
  return missing.map(colId => ['AddColumn', tableId, colId, specs[colId]]);
}

// Clé id_sync posée à la création d'une ligne (formule de déclenchement UUID()), sur une colonne
// qui existe déjà : celle d'une destination d'Échange, qui envoie aussi ses lignes nouvelles. Les
// lignes déjà là gardent leur clé.
function keyTriggerAction(tableId, cols) {
  const key = cols.find(c => c.colId === KEY_COL);
  return key && !key.isFormula && key.formula !== 'UUID()' ? ['ModifyColumn', tableId, KEY_COL, { formula: 'UUID()', recalcWhen: 0 }] : null;
}

// Échange : la case Supprime efface une ligne des deux côtés ; elle est ajoutée aux tables qui
// n'en ont pas.
const deleteColumnAction = (tableId, cols) =>
  (cols.some(c => c.colId === DELETE_COL) ? null : ['AddColumn', tableId, DELETE_COL, { type: 'Bool', isFormula: false }]);

// MajLe change quand une valeur envoyée change, et seulement alors : formule de déclenchement sur
// les colonnes envoyées par les exports (`colIds`), leurs colonnes d'affichage (texte d'une
// Référence) et Supprime. Une valeur qui change à cause d'une autre table (ville renommée, formule)
// la fait donc changer aussi (vérifié). Rend l'action qui la met à jour, ou null.
function majleAction(cols, colIds) {
  const majle = cols.find(c => c.colId === ORDER_COL);
  if (!majle) return null;
  const sent = cols.filter(c => colIds.includes(c.colId) || c.colId === DELETE_COL);
  const refs = [...new Set(sent.flatMap(c => [c.id, c.displayCol]).filter(Boolean))].sort((a, b) => a - b);
  const deps = ['L', ...refs];
  const same = majle.recalcWhen === 0 && JSON.stringify(majle.recalcDeps || null) === JSON.stringify(deps);
  return same || !refs.length ? null : ['UpdateRecord', '_grist_Tables_column', majle.id, { recalcWhen: 0, recalcDeps: deps }];
}

// Une formule de déclenchement ajoutée après coup laisse les lignes existantes vides (vérifié).
function fillKeyActions(tableId, rows, newId) {
  const empty = rows.filter(r => isBlank(r[KEY_COL])).map(r => r.id);
  return chunk(empty).map(ids => ['BulkUpdateRecord', tableId, ids, { [KEY_COL]: ids.map(() => newId()) }]);
}
return { syncFormulas, syncColumns, RECALC_SPEC, missingSyncColumns, prepareSourceActions, keyTriggerAction, deleteColumnAction, majleAction, fillKeyActions };
})();

// ===== js/logic/exports.js =====
__M["js/logic/exports.js"] = (() => {
'use strict';
// SOURCE : un export (des tables, leurs colonnes, un filtre de lignes facultatif) et ses lignes
// dans Synchro ; ses destinataires (un webhook filtré sur l'export) ; son lien public (règles
// d'accès) ; ce qu'un Échange renvoie.
const { COL_ID, DELETE_COL, EXPORT_COL, HEX16, KEY_COL, KIND, ORDER_COL, RECALC_COL, RESEND_COL, SCHEMA_COL, SYNC_TABLE, TABLE_COL, TYPE_COL, is, parseJson } = __M["js/logic/common.js"];

// Dernier envoi à un destinataire coupé (révoqué, export supprimé, Échange arrêté) : une ligne
// « fin » de son export, envoyée directement à l'adresse de son webhook. Sans elle, la CIBLE, qui ne
// lit pas la SOURCE, ne saurait jamais que plus rien n'arrivera.
const endNotice = exportId => [{ [EXPORT_COL]: exportId, [TYPE_COL]: KIND.end }];

// Colonnes qu'une table SOURCE peut envoyer : toutes ses colonnes de données et formules, hors
// colonnes de la synchro et colonnes internes de Grist. Les pièces jointes ne peuvent pas partir
// (`blocked`). Une Référence part comme le texte qu'elle affiche.
function exportableColumns(cols) {
  const skip = new Set(['manualSort', KEY_COL, ORDER_COL, RECALC_COL, DELETE_COL]);
  return cols.filter(c => !skip.has(c.colId) && !c.colId.startsWith('gristHelper_')).map(c => ({
    id: c.colId, label: c.label || c.colId, type: /^Ref(List)?:/.test(c.type) ? 'Text' : c.type, source: c.type,
    visible: c.visible || '', blocked: c.type === 'Attachments',
  }));
}

// Filtre de lignes d'une table : n'envoyer que les lignes dont la colonne `id` vaut `value` (texte
// affiché, sans tenir compte des majuscules ; une case à cocher vaut « oui » ou « non »). Rend le
// filtre tel que la formule le lit, ou null s'il est vide ou mal formé.
const YES = ['oui', 'yes', 'vrai', 'true', '1', 'x'];
function rowFilter(filter) {
  if (!filter || !COL_ID.test(String(filter.id || ''))) return null;
  const source = String(filter.source || '');
  const text = String(filter.value ?? '').trim().toLowerCase();
  const value = source === 'Bool' ? (YES.includes(text) ? 'oui' : 'non') : text;
  return { id: filter.id, source, visible: String(filter.visible || ''), value };
}

// ---------------------------------------------------------------------------------------------
// Lignes Synchro d'un export

const SYNC_FIELDS = [EXPORT_COL, TABLE_COL, TYPE_COL, SCHEMA_COL, RESEND_COL];

// Valeur de Synchro_Colonnes voulue pour chaque type de ligne d'une table : ses colonnes, ou son
// filtre (ligne 'filtre', seulement s'il y en a un).
function wantedValues({ columns, filter }, kinds) {
  const schema = JSON.stringify(columns.map(({ id, type, label, source, visible, as }) => ({ id, type, label, source, visible, ...(as ? { as } : {}) })));
  const kept = rowFilter(filter);
  return new Map([...kinds.map(kind => [kind, schema]), ...(kept ? [[KIND.filter, JSON.stringify(kept)]] : [])]);
}

// Table nouvelle, aux colonnes changées ou au filtre changé : ses lignes sont à renvoyer.
function tableChanged(here, values) {
  const filterWas = (here.find(r => r[TYPE_COL] === KIND.filter) || {})[SCHEMA_COL] || '';
  return !here.length || here.some(r => r[TYPE_COL] !== KIND.filter && r[SCHEMA_COL] !== values.get(KIND.keys))
    || filterWas !== (values.get(KIND.filter) || '');
}

// Lignes Synchro d'un export : par table, sa liste des clés, son lot, son suivi des clés, son
// filtre s'il en a un, et son instantané complet avec son empreinte s'il est partagé par lien
// public ; un export en Échange (`swap`) a en plus sa ligne 'echange' (sans table). `rows` : lignes
// Synchro existantes. Rend les actions qui amènent l'export à `tables` ([{ table, columns, filter }],
// colonnes de `exportableColumns`) et `changed`, les tables dont les lignes sont à renvoyer.
function exportRowsActions(rows, exportId, tables, { isPublic = false, swap = false } = {}) {
  const mine = rows.filter(r => r[EXPORT_COL] === exportId);
  const kinds = [KIND.keys, KIND.lot, KIND.track, ...(isPublic ? [KIND.full, KIND.mark] : [])];
  const wanted = [];
  const changed = [];
  for (const tb of tables) {
    const values = wantedValues(tb, kinds);
    const here = mine.filter(r => r[TABLE_COL] === tb.table);
    if (tableChanged(here, values)) changed.push(tb.table);
    for (const [kind, value] of values) wanted.push({ table: tb.table, kind, value, row: here.find(r => r[TYPE_COL] === kind) });
  }
  if (swap) wanted.push({ table: '', kind: KIND.swap, value: '', row: mine.find(r => r[TYPE_COL] === KIND.swap) });
  const keys = new Set(wanted.map(w => `${w.table}|${w.kind}`));
  const add = wanted.filter(w => !w.row)
    .map(w => ({ [EXPORT_COL]: exportId, [TABLE_COL]: w.table, [TYPE_COL]: w.kind, [SCHEMA_COL]: w.value, [RESEND_COL]: '' }));
  const update = wanted.filter(w => w.row && w.kind !== KIND.swap && w.row[SCHEMA_COL] !== w.value);
  const remove = mine.filter(r => !keys.has(`${r[TABLE_COL]}|${r[TYPE_COL]}`)).map(r => r.id);
  const actions = [];
  if (add.length) actions.push(['BulkAddRecord', SYNC_TABLE, add.map(() => null), Object.fromEntries(SYNC_FIELDS.map(c => [c, add.map(r => r[c])]))]);
  if (update.length) actions.push(['BulkUpdateRecord', SYNC_TABLE, update.map(w => w.row.id), { [SCHEMA_COL]: update.map(w => w.value) }]);
  if (remove.length) actions.push(['BulkRemoveRecord', SYNC_TABLE, remove]);
  return { actions, changed };
}

// Montage d'avant la version 0.5 : le suivi des clés manque aux tables des exports. Rend l'action
// qui l'ajoute (le suivi part des clés présentes : rien n'est effacé dans les CIBLES), ou null.
function addTrackRowsAction(rows) {
  const has = new Set(rows.filter(r => r[TYPE_COL] === KIND.track).map(r => `${r[EXPORT_COL]}|${r[TABLE_COL]}`));
  const add = rows.filter(r => r[TYPE_COL] === KIND.keys && !has.has(`${r[EXPORT_COL]}|${r[TABLE_COL]}`));
  if (!add.length) return null;
  const cols = [EXPORT_COL, TABLE_COL, SCHEMA_COL];
  return ['BulkAddRecord', SYNC_TABLE, add.map(() => null),
    { ...Object.fromEntries(cols.map(c => [c, add.map(r => r[c] ?? '')])), [TYPE_COL]: add.map(() => KIND.track), [RESEND_COL]: add.map(() => '') }];
}

// Tables, colonnes et filtres d'un export, lus dans ses lignes Synchro.
function exportTables(rows, exportId) {
  const mine = rows.filter(r => r[EXPORT_COL] === exportId && r[TYPE_COL] !== KIND.swap);
  const tables = new Map();
  for (const r of mine) {
    if (r[TYPE_COL] !== KIND.filter && !tables.has(r[TABLE_COL])) tables.set(r[TABLE_COL], parseJson(r[SCHEMA_COL], []) || []);
  }
  const filterOf = table => rowFilter(parseJson((mine.find(r => r[TABLE_COL] === table && r[TYPE_COL] === KIND.filter) || {})[SCHEMA_COL], null));
  return [...tables].map(([table, columns]) => ({ table, columns, filter: filterOf(table) }));
}

// Exports en Échange : ceux qui ont une ligne 'echange'.
const swapExports = rows => new Set(rows.filter(r => r[TYPE_COL] === KIND.swap).map(r => r[EXPORT_COL]));

// ---------------------------------------------------------------------------------------------
// Destinataires

// Condition du webhook d'un destinataire : Grist ne lui envoie que les lignes de son export.
const conditionOf = exportId => `rec.${EXPORT_COL} == "${exportId}" and rec.${TYPE_COL} in ("${KIND.keys}", "${KIND.lot}")`;
// L'identifiant entre dans une formule Python : rien d'autre que 16 chiffres hexadécimaux.
function exportCondition(exportId) {
  if (!is(HEX16, exportId)) throw new Error('codeInvalid');
  return conditionOf(exportId);
}

// Export d'un webhook, lu dans sa condition ; '' si elle n'a pas exactement la forme attendue
// (webhook à ne pas laisser : il recevrait d'autres lignes que celles d'un export).
function conditionExport(text) {
  const [before, after] = conditionOf('\u0000').split('\u0000');
  const s = String(text || '');
  if (!s.startsWith(before) || !s.endsWith(after)) return '';
  const id = s.slice(before.length, s.length - after.length);
  return HEX16.test(id) ? id : '';
}

// Nom du webhook d'un destinataire : lisible dans les réglages de Grist, avec l'export en fin.
const hookName = (name, exportId) => `Synchro ${name} #${exportId}`;

// Destinataires d'un export : les webhooks sur Synchro dont la condition nomme cet export
// (`conditions` : texte de la condition par webhook).
const hooksOf = (hooks, conditions, exportId) =>
  hooks.filter(h => h.fields.tableId === SYNC_TABLE && conditionExport(conditions.get(h.id)) === exportId);

// ---------------------------------------------------------------------------------------------
// Échange

// Côté CIBLE : ce que ce document renvoie à la SOURCE. Chaque destination (`entries` : tables de la
// note du journal) part avec les colonnes qui reçoivent une colonne de la SOURCE, chacune avec son
// nom là-bas (`as`). `columnsOf(table)` : ses colonnes envoyables.
function exchangeTables(entries, columnsOf) {
  return entries.map((entry) => {
    const map = entry.map || {};
    const back = new Map([...new Set([...(entry.columns || []).map(c => c.id), ...Object.keys(map)])].map(id => [map[id] || id, id]));
    const columns = (columnsOf(entry.dest) || []).filter(c => !c.blocked && back.has(c.id)).map(c => ({ ...c, as: back.get(c.id) }));
    return { table: entry.dest, columns, filter: null };
  }).filter(tb => tb.columns.length);
}

// Côté SOURCE (journal de retour) : colonnes reçues de l'autre document gardées, et leur
// correspondance (colonne de l'autre document -> d'ici), lue dans leur nom ici (`as`) ; un choix
// noté dans `map` l'emporte. L'autre document n'écrit que les colonnes que l'export d'ici envoie
// pour cette table (`allowed`) : ni une colonne gardée pour soi, ni une colonne nouvelle.
function exchangeColumns(sent, allowed, map = {}) {
  const target = c => map[c.id] || c.as || c.id;
  const kept = sent.filter(c => allowed.has(target(c)));
  return { sent: kept, map: Object.fromEntries(kept.map(c => [c.id, target(c)])) };
}

// ---------------------------------------------------------------------------------------------
// Lien public : règles d'accès qui ne laissent aux lecteurs (dont le lien public) que les lignes
// 'complet' et 'empreinte' des exports `exportIds` dans la table Synchro, sans la colonne
// Synchro_Export : un lecteur lirait sinon sa description, la note de la SOURCE (noms des exports,
// invitations en attente ; vérifié). Le filtre sur cette colonne marche encore (vérifié). Les
// règles du widget portent ce mémo ; elles passent avant les règles existantes. Sans export,
// `keepDeny` garde le refus général : à utiliser tant que le document reste partagé publiquement.
const PUBLIC_MEMO = 'Synchro : lecture limitée aux exports publics';
const LEGACY_MEMO = 'Synchro : lecture limitée aux vues d’export';
const VIEWER_ONLY = 'user.Access == VIEWER';

const isPublicRule = r => r.memo === PUBLIC_MEMO || r.memo === LEGACY_MEMO;

// Règles voulues : [{ tableId, colIds, aclFormula, permissionsText }], dans l'ordre.
function publicAclRules(exportIds, { keepDeny = false } = {}) {
  const ids = exportIds.filter(id => HEX16.test(id)).sort();
  if (!ids.length && !keepDeny) return [];
  return [
    ...(ids.length ? [
      { tableId: SYNC_TABLE, colIds: EXPORT_COL, aclFormula: VIEWER_ONLY, permissionsText: '-R' },
      { tableId: SYNC_TABLE, colIds: '*', permissionsText: '+R',
        aclFormula: `${VIEWER_ONLY} and rec.${EXPORT_COL} in [${ids.map(id => `"${id}"`).join(', ')}] and rec.${TYPE_COL} in ["${KIND.full}", "${KIND.mark}"]` },
    ] : []),
    { tableId: '*', colIds: '*', aclFormula: VIEWER_ONLY, permissionsText: '-R' },
  ];
}

// Une règle, telle que la compare syncPublicRules.
const ruleText = ({ tableId, colIds, aclFormula, permissionsText }) => `${tableId}|${colIds}|${aclFormula}|${permissionsText}`;

// Actions qui remplacent les règles du widget par les règles voulues. `resources`, `rules` : lignes
// de _grist_ACLResources et _grist_ACLRules.
function publicAclActions(resources, rules, exportIds, options = {}) {
  const actions = [['BulkRemoveRecord', '_grist_ACLRules', rules.filter(isPublicRule).map(r => r.id)]].filter(a => a[2].length);
  let pos = Math.min(0, ...rules.map(r => r.rulePos || 0));
  let newRef = 0;
  const resourceFor = (tableId, colIds) => {
    const found = resources.find(r => r.tableId === tableId && r.colIds === colIds);
    if (found) return found.id;
    actions.push(['AddRecord', '_grist_ACLResources', --newRef, { tableId, colIds }]);
    return newRef;
  };
  for (const { tableId, colIds, aclFormula, permissionsText } of publicAclRules(exportIds, options)) {
    actions.push(['AddRecord', '_grist_ACLRules', null, { resource: resourceFor(tableId, colIds), aclFormula, permissionsText, rulePos: --pos, memo: PUBLIC_MEMO }]);
  }
  return actions;
}
return { endNotice, exportableColumns, rowFilter, exportRowsActions, addTrackRowsAction, exportTables, swapExports, exportCondition, conditionExport, hookName, hooksOf, exchangeTables, exchangeColumns, PUBLIC_MEMO, isPublicRule, publicAclRules, ruleText, publicAclActions };
})();

// ===== js/logic/codes.js =====
__M["js/logic/codes.js"] = (() => {
'use strict';
// Codes échangés entre SOURCE et CIBLE (préfixe + JSON en base64url, sur une ligne) et adresses
// Grist qu'ils portent. Tout ce qui vient d'un code collé est contrôlé ici : identifiants, colonnes,
// adresses réécrites à partir de leurs seuls éléments reconnus.
const { HEX16, is, isSafeId, parseJson } = __M["js/logic/common.js"];

const CODE_PREFIX = 'GRISTSYNC2.';
const SECRET = /^[0-9a-f]{32}$/;
// Types de colonnes qu'un export envoie (une Référence part en texte, une pièce jointe ne part pas).
const SENT_TYPE = /^(Any|Bool|Choice|ChoiceList|Date|DateTime(:[A-Za-z0-9_/+-]+)?|Int|Numeric|Text)$/;
const MAX_COLUMNS = 400; // colonnes par table, au plus
const TEAM = '(?:/o/[A-Za-z0-9_-]+)?'; // équipe dans le chemin : /o/<équipe>

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
  } catch (e) {
    return '';
  }
}

const encodeCode = payload => CODE_PREFIX + toBase64Url(JSON.stringify(payload));

// Un code recopié d'un courriel peut avoir été coupé en plusieurs lignes : les blancs sont ôtés.
function decodeCode(text, kind) {
  const raw = String(text || '').replace(/\s+/g, '');
  if (raw.startsWith('GRISTSYNC1.')) throw new Error('codeOld');
  if (!raw.startsWith(CODE_PREFIX)) throw new Error('codeFormat');
  const payload = parseJson(fromBase64Url(raw.slice(CODE_PREFIX.length)));
  if (!payload) throw new Error('codeFormat');
  if (payload.kind !== kind) throw new Error(kind === 'invitation' ? 'notInvitation' : 'notReply');
  return payload;
}

// Colonnes envoyées, telles qu'un code ou un journal les décrit : [{ id, type, label, as }]. Dans un
// Échange, `as` donne le nom de la colonne dans l'autre document (voir exchangeTables).
function validColumns(cols) {
  return Array.isArray(cols) && cols.length > 0 && cols.length <= MAX_COLUMNS && new Set(cols.map(c => c && c.id)).size === cols.length &&
    cols.every(c => c && isSafeId(c.id) && is(SENT_TYPE, c.type) && (c.as === undefined || isSafeId(c.as)));
}

const exportSchema = columns => columns.map(({ id, type, label, as }) => ({
  id, type, ...(typeof label === 'string' ? { label: label.slice(0, 200) } : {}), ...(as ? { as } : {}),
}));

const text200 = (from, keys) => Object.fromEntries(keys.map(k => [k, String(from[k] ?? '').slice(0, 200)]));

// ---------------------------------------------------------------------------------------------
// Invitation (SOURCE -> CIBLE) et réponse (CIBLE -> SOURCE)

// Une invitation donne accès à un export (`export`, ses tables et colonnes) pour une personne :
// `id` la désigne dans la réponse ; `secret`, facultatif et choisi à la création, prouve que la
// réponse vient de quelqu'un qui l'a reçue (la SOURCE n'en garde que l'empreinte).
// Mode « lien public » (`base` : adresse REST du document SOURCE) : pas de réponse, la CIBLE lit
// les instantanés de l'export elle-même, sans identifiant. Mode « Échange » (`retour` : adresse
// d'écriture du journal de retour de la SOURCE) : la CIBLE renvoie ses modifications à cette
// adresse, par un webhook à elle. Ce code-là est donc un droit d'écriture.
function buildInvitation({ id, exportId, name, origin, secret = '', from = {}, tables, base = '', retour = '' }) {
  return encodeCode({
    kind: 'invitation', id, export: exportId, name, origin, secret, from,
    ...(base ? { mode: 'public', base } : retour ? { mode: 'echange', retour } : {}),
    tables: tables.map(({ table, columns }) => ({ table, columns: exportSchema(columns) })),
  });
}

function validInvitation(inv) {
  return is(HEX16, inv.id) && is(HEX16, inv.export) && typeof inv.name === 'string' && (!inv.secret || is(SECRET, inv.secret))
    && Array.isArray(inv.tables) && inv.tables.length > 0 && inv.tables.every(tb => tb && isSafeId(tb.table) && validColumns(tb.columns))
    && new Set(inv.tables.map(tb => tb.table)).size === inv.tables.length;
}

// Mode d'une invitation et l'adresse qu'il porte, réécrite ; null si l'adresse ne convient pas.
function invitationMode(inv) {
  if (inv.mode === 'public') {
    const base = safeDocBaseUrl(inv.base);
    return base ? { mode: 'public', base } : null;
  }
  if (inv.mode === 'echange') {
    const back = parseWebhookUrl(inv.retour);
    return back && back.flat ? { mode: 'echange', base: '', retour: back.url, retourOrigin: back.origin } : null;
  }
  return { mode: 'reponse', base: '' };
}

function parseInvitation(text) {
  const inv = decodeCode(text, 'invitation');
  const mode = validInvitation(inv) ? invitationMode(inv) : null;
  if (!mode) throw new Error('codeInvalid');
  const from = inv.from && typeof inv.from === 'object' ? inv.from : {};
  return {
    id: inv.id, export: inv.export, name: inv.name.slice(0, 200), secret: inv.secret || '', origin: String(inv.origin || ''), ...mode,
    from: text200(from, ['email', 'docId']),
    tables: inv.tables.map(tb => ({ table: tb.table, columns: exportSchema(tb.columns) })),
  };
}

// `url` : l'adresse d'écriture du journal de l'export dans la CIBLE. Échange : `retour` dit où la
// CIBLE a rangé chaque table ([{ table: table de la CIBLE, dest: table de la SOURCE }]).
function buildReply({ id, secret = '', recipient, url, retour = null }) {
  return encodeCode({ kind: 'reponse', id, secret, recipient, url, ...(retour ? { retour } : {}) });
}

// Tables d'un Échange dans la réponse : chacune nommée, une seule fois de chaque côté.
function validRetour(back) {
  const unique = key => new Set(back.map(b => b && b[key])).size === back.length;
  return Array.isArray(back) && back.length > 0 && back.every(b => b && isSafeId(b.table) && isSafeId(b.dest)) && unique('table') && unique('dest');
}

// `sourceOrigin` : origine de l'instance du document SOURCE. Le webhook ne part que vers la même
// instance, à une adresse d'écriture par clé de formulaire, rien d'autre.
function parseReply(text, sourceOrigin) {
  const reply = decodeCode(text, 'reponse');
  const target = parseWebhookUrl(reply.url);
  const ok = is(HEX16, reply.id) && (!reply.secret || is(SECRET, reply.secret)) && target && target.flat
    && reply.recipient && typeof reply.recipient === 'object' && (reply.retour === undefined || validRetour(reply.retour));
  if (!ok) throw new Error('codeInvalid');
  if (target.origin !== sourceOrigin) throw new Error('otherInstance');
  const out = { id: reply.id, secret: reply.secret || '', recipient: text200(reply.recipient, ['email', 'docId', 'team', 'at']), url: target.url };
  return reply.retour === undefined ? out : { ...out, retour: reply.retour.map(({ table, dest }) => ({ table, dest })) };
}

// ---------------------------------------------------------------------------------------------
// Adresses

const parseUrl = (text) => {
  try {
    const url = new URL(String(text || '').trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch (e) {
    return null;
  }
};

// Lien « Copier le lien » d'un formulaire publié : https://<instance>[/o/<équipe>]/forms/<clé>/<n>
function parseFormLink(link) {
  const url = parseUrl(link);
  const m = url && url.pathname.match(new RegExp(`^(${TEAM})/forms/([A-Za-z0-9]+)/\\d+/?$`));
  return m ? { origin: url.origin, prefix: m[1], key: m[2] } : null;
}

const writeUrl = ({ origin, prefix, key }, table) => `${origin}${prefix}/api/s/${key}/tables/${table}/records?flat=1`;

function buildWebhookUrl(formLink, journalTable) {
  const form = parseFormLink(formLink);
  return form && isSafeId(journalTable) ? writeUrl(form, journalTable) : null;
}

// Adresse d'écriture d'un journal par une clé de formulaire. `url` : la même, réécrite.
function parseWebhookUrl(text) {
  const url = parseUrl(text);
  const m = url && url.pathname.match(new RegExp(`^(${TEAM})/api/s/([A-Za-z0-9]+)/tables/([A-Za-z_][A-Za-z0-9_]*)/records$`));
  if (!m) return null;
  const parts = { origin: url.origin, prefix: m[1], key: m[2], table: m[3] };
  return { ...parts, flat: url.search === '?flat=1', url: writeUrl(parts, parts.table) };
}

// Boucles refusées à l'approbation : renvoyer une table reçue vers le document d'où elle vient
// (relais retour, ou table vers elle-même dans le même document). `received` : tables reçues ici,
// avec le document qui les envoie ({ dest, fromDocId }). Rend les tables en cause.
function loopingTables(tables, recipientDocId, received) {
  if (!recipientDocId) return [];
  return tables.filter(table => received.some(r => r.dest === table && r.fromDocId === recipientDocId));
}

// La clé de partage est un droit d'écriture : on ne l'affiche jamais en entier, même dans un
// message d'erreur de Grist.
const maskKey = text => String(text || '').replace(/\/(api\/s|forms)\/([A-Za-z0-9]{4})[A-Za-z0-9]*/g, '/$1/$2…');

// `baseUrl` renvoyé par getAccessToken : https://<instance>[/o/<équipe>]/api/docs/<docId>
function parseDocBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  const m = url.pathname.match(/^(?:\/o\/([^/]+))?\/api\/docs\/([^/]+)\/?$/);
  return { origin: url.origin, team: m ? m[1] || '' : '', docId: m ? m[2] : '' };
}

// Adresse REST d'un document, réécrite à partir de ses seuls éléments reconnus ; '' sinon.
function safeDocBaseUrl(text) {
  const url = parseUrl(text);
  if (!url || url.search) return '';
  const { team, docId } = parseDocBaseUrl(url.href);
  if (!/^[A-Za-z0-9_-]+$/.test(docId) || (team && !/^[A-Za-z0-9_-]+$/.test(team))) return '';
  return `${url.origin}${team ? `/o/${team}` : ''}/api/docs/${docId}`;
}
return { decodeCode, validColumns, exportSchema, buildInvitation, parseInvitation, buildReply, parseReply, parseFormLink, buildWebhookUrl, parseWebhookUrl, loopingTables, maskKey, parseDocBaseUrl };
})();

// ===== js/grist.js =====
__M["js/grist.js"] = (() => {
'use strict';
// Accès au document courant, avec les droits de la personne qui a ouvert la page.
// Deux canaux seulement :
//  - l'API des widgets (`grist.docApi`) : lecture des tables, écritures groupées ;
//  - l'API REST de la même instance pour les webhooks, que l'API des widgets n'expose pas, et
//    pour des lectures légères en SQL, avec un jeton d'accès court (`getAccessToken`) passé en
//    paramètre `auth=`.
// Toute requête réseau du widget passe par gristFetch.
const { GRIST_ORIGINS } = __M["js/config.js"];
const { maskKey, parseDocBaseUrl } = __M["js/logic/codes.js"];
const { toRows } = __M["js/logic/common.js"];

// Requête vers une instance Grist de la liste (config.js), jamais ailleurs, sans les cookies de
// la personne (le jeton, quand il en faut un, est dans l'adresse).
async function gristFetch(url, options = {}) {
  if (!GRIST_ORIGINS.includes(new URL(url).origin)) throw new Error('otherInstance');
  return fetch(url, { ...options, credentials: 'omit' });
}

const fetchRows = async tableId => toRows(await grist.docApi.fetchTable(tableId));

const apply = actions => (actions.length ? grist.docApi.applyUserActions(actions) : null);

// Instantané des métadonnées du document (tables et colonnes), lu en deux requêtes, et relu après
// une écriture qui change le schéma. Les tables de résumé et les tables cachées de Grist ne sont
// pas listées, mais `has` et `columns` les connaissent.
async function readSchema() {
  const [tables, columns] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Tables_column')]);
  const byId = new Map(tables.map(tb => [tb.tableId, tb]));
  const colById = new Map(columns.map(c => [c.id, c]));
  return {
    tableIds: tables.filter(tb => !tb.summarySourceTable && !tb.tableId.startsWith('GristHidden')).map(tb => tb.tableId).sort(),
    has: tableId => byId.has(tableId),
    table: tableId => byId.get(tableId),
    // Nom exact d'une table nommée `tableId` aux majuscules près (Grist ne les distingue pas), ou null.
    resolve: tableId => (tables.find(tb => tb.tableId.toLowerCase() === String(tableId).toLowerCase()) || {}).tableId || null,
    // Nom actuel de la table de numéro `ref` (il change si on la renomme), ou null.
    tableIdOf: ref => (tables.find(tb => tb.id === ref) || {}).tableId || null,
    // Colonnes d'une table, dans l'ordre de leur création ; null si la table n'existe pas.
    // `visible` : colonne affichée d'une Référence, dans la table visée.
    columns(tableId) {
      const table = byId.get(tableId);
      if (!table) return null;
      return columns.filter(c => c.parentId === table.id).sort((x, y) => x.parentPos - y.parentPos).map(c => ({
        id: c.id, colId: c.colId, type: c.type, isFormula: c.isFormula, formula: c.formula, label: c.label, description: c.description,
        displayCol: c.displayCol, recalcWhen: c.recalcWhen, recalcDeps: c.recalcDeps,
        visible: (colById.get(c.visibleCol) || {}).colId || '',
      }));
    },
  };
}

// Identité du document, déduite de l'adresse REST du jeton : instance, équipe, identifiant, et
// l'adresse elle-même (`baseUrl`).
async function docIdentity() {
  const { baseUrl } = await grist.docApi.getAccessToken({ readOnly: true });
  return { ...parseDocBaseUrl(baseUrl), baseUrl };
}

// La personne ne fait que lire le document : Grist le dit dans l'adresse du widget (`readonly`).
// Le nom du document, lui, n'est pas lisible : l'API REST refuse au jeton la fiche du document.
const isReadOnly = () => new URLSearchParams(location.search).get('readonly') === 'true';

// Propriétaire du document : seul un propriétaire lit la liste des webhooks.
const isOwner = () => listWebhooks().then(() => true, () => false);

// Quelques colonnes d'une table, lues par l'API REST en SQL (jeton en lecture seule) : bien plus
// léger que fetchTable quand la table a de grosses cellules (lots de Synchro), pour une lecture
// répétée. Null si Grist refuse (droits, table absente) : lire alors la table entière.
async function selectRows(tableId, colIds) {
  try {
    const { token, baseUrl } = await grist.docApi.getAccessToken({ readOnly: true });
    const sql = `select ${['id', ...colIds].map(c => `"${c}"`).join(', ')} from "${tableId}"`;
    const response = await gristFetch(`${baseUrl}/sql?q=${encodeURIComponent(sql)}&auth=${encodeURIComponent(token)}`);
    return response.ok ? (await response.json()).records.map(r => r.fields) : null;
  } catch (e) {
    return null;
  }
}

// Ce qui a changé dans le document depuis l'état `since` (empreinte d'une action de son
// historique) : l'état actuel (`hash`) et les tables touchées, lignes ou colonnes (`tables` ; null
// si `since` est vide ou sorti de l'historique, si une table a été renommée, ou si Grist n'a pas
// pu répondre). Lu par la comparaison de deux états de Grist (GET /compare, quelques
// millisecondes ; une valeur au plus par colonne revient). Null si Grist refuse : la comparaison
// est réservée à qui peut lire tout le document.
async function docChanges(since) {
  const { token, baseUrl } = await grist.docApi.getAccessToken({ readOnly: true });
  const read = left => gristFetch(`${baseUrl}/compare?left=${encodeURIComponent(left)}&right=HEAD&maxRows=1&auth=${encodeURIComponent(token)}`);
  try {
    let response = await read(since || 'HEAD');
    if ([401, 403].includes(response.status)) return null;
    if (!response.ok && since) response = await read('HEAD');
    if (!response.ok) return response.status === 404 ? null : { hash: since, tables: null };
    const { right, details } = await response.json();
    const delta = (details || {}).rightChanges;
    const known = since && delta && !(delta.tableRenames || []).length;
    return { hash: right.h, tables: known ? new Set(Object.keys(delta.tableDeltas || {})) : null };
  } catch (e) {
    return { hash: since, tables: null };
  }
}

// Une seule exécution à la fois de `fn` sous ce nom, tous onglets du navigateur confondus.
async function withLock(name, fn) {
  if (navigator.locks) {
    try { return await navigator.locks.request(name, fn); } catch (e) { if (!e || e.name !== 'SecurityError') throw e; }
  }
  return fn();
}

// ---------------------------------------------------------------------------------------------
// Webhooks (propriétaires du document seulement : Grist refuse sinon en 403)

async function rest(method, path, body) {
  const { token, baseUrl } = await grist.docApi.getAccessToken({ readOnly: false });
  const response = await gristFetch(`${baseUrl}${path}${path.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`, {
    method,
    // Grist exige l'un de ces en-têtes pour toute écriture sans cookie (protection CSRF).
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    // Une erreur de Grist peut citer l'adresse d'un webhook : sa clé n'est jamais montrée en entier.
    const error = new Error(response.status === 403 ? 'ownerOnly' : maskKey(`HTTP ${response.status} ${text.slice(0, 200)}`));
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

const listWebhooks = async () => (await rest('GET', '/webhooks')).webhooks;

// Un webhook par destinataire, sur la table Synchro, filtré par `condition` (formule évaluée par
// Grist sur chaque ligne : seules celles de l'export partent). Grist accepte les conditions depuis
// la version 1.7.11 : une instance plus ancienne refuse le champ, ou l'ignore ; le widget vérifie
// donc la condition enregistrée et efface le webhook si elle manque (il recevrait tout).
async function createWebhook({ name, memo, url, tableId, condition }) {
  let result;
  try {
    result = await rest('POST', '/webhooks', {
      webhooks: [{ fields: { name, memo, url, tableId, condition, eventTypes: ['add', 'update'], enabled: true, isReadyColumn: null } }],
    });
  } catch (e) {
    if (/condition/i.test(e.message)) throw new Error('gristTooOld');
    throw e;
  }
  const id = result.webhooks[0].id;
  if ((await webhookConditions()).get(id) !== condition) {
    await deleteWebhook(id).catch(() => {});
    throw new Error('gristTooOld');
  }
  return id;
}

// Condition de chaque webhook du document (texte de la formule), par identifiant de webhook :
// lue dans _grist_Triggers, où Grist garde aussi l'identifiant de chaque webhook.
async function webhookConditions() {
  const conditions = new Map();
  for (const trigger of await fetchRows('_grist_Triggers')) {
    let text = '';
    try { text = (JSON.parse(trigger.condition || '{}') || {}).text || ''; } catch (e) { /* condition illisible */ }
    let actions = [];
    try { actions = JSON.parse(trigger.actions || '[]') || []; } catch (e) { /* actions illisibles */ }
    for (const action of actions) if (action && action.type === 'webhook') conditions.set(action.id, text);
  }
  return conditions;
}

const setWebhookEnabled = (id, enabled) => rest('PATCH', `/webhooks/${encodeURIComponent(id)}`, { enabled });
const renameWebhook = (id, name) => rest('PATCH', `/webhooks/${encodeURIComponent(id)}`, { name });
const deleteWebhook = id => rest('DELETE', `/webhooks/${encodeURIComponent(id)}`);

// Webhook effacé après un dernier envoi direct à son adresse (`rows`, comme le webhook les
// enverrait). Un lien déjà mort ou trop lent ne retient pas l'effacement.
async function deleteWebhookWithNotice(h, rows) {
  const body = JSON.stringify(rows);
  await gristFetch(h.fields.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) }).catch(() => {});
  await deleteWebhook(h.id);
}
const clearWebhookQueue = () => rest('DELETE', '/webhooks/queue');
return { gristFetch, fetchRows, apply, readSchema, docIdentity, isReadOnly, isOwner, selectRows, docChanges, withLock, listWebhooks, createWebhook, webhookConditions, setWebhookEnabled, renameWebhook, deleteWebhook, deleteWebhookWithNotice, clearWebhookQueue };
})();

// ===== js/pages.js =====
__M["js/pages.js"] = (() => {
'use strict';
// Pages du document : formulaires de réception (un par journal, chacun sur sa page) et ménage des
// pages que laissent les tables techniques.
const { apply, fetchRows, readSchema } = __M["js/grist.js"];
const { randomHex } = __M["js/logic/common.js"];

const published = section => JSON.parse(section.shareOptions || '{}').publish === true;

// ---------------------------------------------------------------------------------------------
// Formulaires de réception

// Formulaire d'un journal, sur sa propre page. Grist donne une clé
// d'écriture par page partagée, et cette clé lit aussi les colonnes (descriptions comprises, donc
// la note) des tables de tous les formulaires de la page (vérifié) : une page par journal, et
// chaque expéditeur n'atteint que le sien. Mêmes actions que le bouton « Publier » de Grist ; le
// serveur crée alors la clé, que le widget ne peut pas lire : la personne copie le lien depuis la
// carte du formulaire. Idempotent. La page, nommée comme le journal, reste à la racine de la liste
// des pages, là où Grist la crée (en fin de liste) : on la trouve sans déplier la page du widget.
async function ensureForm(tableId) {
  const table = (await readSchema()).table(tableId);
  let section = (await fetchRows('_grist_Views_section')).find(s => s.parentKey === 'form' && s.tableRef === table.id);
  if (!section) {
    const created = (await apply([['CreateViewSection', table.id, 0, 'form', null, null]])).retValues[0];
    section = { id: created.sectionRef, parentId: created.viewRef, shareOptions: '' };
    await apply([['UpdateRecord', '_grist_Views', created.viewRef, { name: tableId }]]);
  }
  const page = (await fetchRows('_grist_Pages')).find(p => p.viewRef === section.parentId);
  if (!page.shareRef) {
    const shareRef = (await apply([['AddRecord', '_grist_Shares', null, { linkId: randomHex(12), options: JSON.stringify({ publish: true }) }]])).retValues[0];
    await apply([['UpdateRecord', '_grist_Pages', page.id, { shareRef }]]);
  }
  if (!published(section)) {
    await apply([['UpdateRecord', '_grist_Views_section', section.id, { shareOptions: JSON.stringify({ form: true, publish: true }) }]]);
  }
}

// Formulaire publié de chaque table : { section, viewRef, name (de la page), shared (autres
// formulaires publiés sur la même page, donc atteints par la même clé : montage d'avant la 0.5) }.
async function formPages() {
  const [sections, tables, views] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Tables'), fetchRows('_grist_Views')]);
  const forms = sections.filter(s => s.parentKey === 'form' && published(s));
  const pages = new Map();
  for (const section of forms) {
    const table = tables.find(tb => tb.id === section.tableRef);
    const view = views.find(v => v.id === section.parentId);
    const shared = forms.filter(s => s !== section && s.parentId === section.parentId).length;
    if (table) pages.set(table.tableId, { section: section.id, viewRef: section.parentId, name: view ? view.name : '', shared });
  }
  return pages;
}

// Couper le lien du formulaire de ce journal. Seul sur sa page : le partage de la page change
// d'identifiant, et Grist remplace sa clé (il efface celle d'un identifiant disparu, vérifié dans
// HomeDBManager.syncShares). Sur une page partagée avec d'autres formulaires : il quitte la page
// (la clé de la page ne l'atteint plus, vérifié) ; le prochain ensureForm lui en donne une à lui.
async function renewFormLink(tableId) {
  await ensureForm(tableId);
  const form = (await formPages()).get(tableId);
  if (form.shared) {
    const [sections, views, pages] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Views'), fetchRows('_grist_Pages')]);
    const left = sections.filter(s => s.id !== form.section);
    await apply([['RemoveRecord', '_grist_Views_section', form.section], ...tidyActions(form.viewRef, left, views, pages)]);
    return;
  }
  const page = (await fetchRows('_grist_Pages')).find(p => p.viewRef === form.viewRef);
  await apply([['UpdateRecord', '_grist_Shares', page.shareRef, { linkId: randomHex(12) }]]);
}

// ---------------------------------------------------------------------------------------------
// Ménage

// Une page dont des sections ont disparu : leurs cases restent dans sa disposition, et dans sa
// barre des repliés (vérifié : les numéros de sections sont ensuite réutilisés). On les retire, et
// une page qui n'a plus de formulaire publié perd son partage : la clé d'écriture disparaît avec lui.
function tidyActions(viewRef, sections, views, pages) {
  const view = views.find(v => v.id === viewRef);
  if (!view) return [];
  const here = sections.filter(s => s.parentId === viewRef);
  const ids = new Set(here.map(s => s.id));
  const actions = [];
  if (view.layoutSpec) {
    const keep = box => (box.leaf !== undefined ? (ids.has(box.leaf) ? box : null) : { ...box, children: (box.children || []).map(keep).filter(Boolean) });
    const { collapsed = [], ...tree } = JSON.parse(view.layoutSpec);
    const tidy = { ...keep(tree), collapsed: collapsed.filter(c => ids.has(c.leaf)) };
    if (!tidy.collapsed.length) delete tidy.collapsed;
    if (JSON.stringify(tidy) !== view.layoutSpec) actions.push(['UpdateRecord', '_grist_Views', viewRef, { layoutSpec: JSON.stringify(tidy) }]);
  }
  const page = pages.find(p => p.viewRef === viewRef);
  if (page && page.shareRef && !here.some(published) && !pages.some(p => p.id !== page.id && p.shareRef === page.shareRef)) {
    actions.push(['UpdateRecord', '_grist_Pages', page.id, { shareRef: 0 }], ['RemoveRecord', '_grist_Shares', page.shareRef]);
  }
  return actions;
}

// Efface des tables techniques et les pages qu'elles laissent vides (dont celles de leurs
// formulaires), puis range les pages où il reste des sections.
async function removeTechnicalTables(tableIds) {
  const schema = await readSchema();
  const ids = tableIds.filter(id => schema.has(id));
  if (!ids.length) return;
  const refs = new Set(ids.map(id => schema.table(id).id));
  const [before, pagesBefore] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Pages')]);
  const touched = new Set(before.filter(s => refs.has(s.tableRef)).map(s => s.parentId));
  const shared = new Set(pagesBefore.filter(p => touched.has(p.viewRef) && p.shareRef).map(p => p.shareRef));
  await apply(ids.map(id => ['RemoveTable', id]));
  const [sections, views, pages] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Views'), fetchRows('_grist_Pages')]);
  const left = new Set(sections.map(s => s.parentId));
  const still = [...touched].filter(v => views.some(view => view.id === v));
  // Une page vide disparaît (Grist efface déjà celle qui ne portait que le formulaire d'une table
  // effacée), et son partage avec elle : Grist le garderait, clé comprise (vérifié).
  const emptied = still.filter(v => !left.has(v));
  const orphans = [...shared].filter(ref => !pages.some(p => !emptied.includes(p.viewRef) && p.shareRef === ref));
  await apply([...emptied.map(v => ['RemoveView', v]), ...orphans.map(ref => ['RemoveRecord', '_grist_Shares', ref])]);
  await apply(still.filter(v => left.has(v)).flatMap(v => tidyActions(v, sections, views, pages)));
}

// Tables techniques sans page : elles restent dans « Données source », pas dans la liste des
// pages. Seule la page propre à la table est retirée (celle qui ne montre qu'elle).
async function dropPages(tableIds) {
  const [tables, sections] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Views_section')]);
  const views = tables.filter(tb => tableIds.includes(tb.tableId) && tb.primaryViewId).filter(tb =>
    sections.filter(s => s.parentId === tb.primaryViewId).every(s => s.tableRef === tb.id)).map(tb => tb.primaryViewId);
  await apply(views.map(v => ['RemoveView', v]));
}

// Page commune aux vues d'export de la version 0.3 (SOURCE), effacée avec l'ancien montage. 0 si
// elle n'existe pas.
async function exportsViewRef() {
  const view = (await fetchRows('_grist_Views')).find(v => v.name === 'Synchro_Exports');
  return view ? view.id : 0;
}

// Retire une colonne de la page principale de sa table (elle reste dans les données brutes).
async function hideColumn(tableId, colId) {
  const table = (await fetchRows('_grist_Tables')).find(tb => tb.tableId === tableId);
  const column = (await fetchRows('_grist_Tables_column')).find(c => c.parentId === table.id && c.colId === colId);
  const sections = new Set((await fetchRows('_grist_Views_section')).filter(s => s.parentId === table.primaryViewId).map(s => s.id));
  const fields = (await fetchRows('_grist_Views_section_field')).filter(f => f.colRef === column.id && sections.has(f.parentId));
  await apply(fields.length ? [['BulkRemoveRecord', '_grist_Views_section_field', fields.map(f => f.id)]] : []);
}
return { ensureForm, formPages, renewFormLink, removeTechnicalTables, dropPages, exportsViewRef, hideColumn };
})();

// ===== js/source/synchro.js =====
__M["js/source/synchro.js"] = (() => {
'use strict';
// SOURCE : la seule table technique du widget, Synchro, quel que soit le nombre d'exports et de
// tables. Chaque table d'un export y a sa liste des clés, son lot de lignes modifiées et son suivi
// des clés (voir logic/formulas.js) ; une ligne 'charge' suit les renvois du document. Les exports
// (nom, lien public), les invitations en attente (et l'empreinte de leur secret) et les pauses sont
// notés dans la description de sa colonne Synchro_Export : des métadonnées, que le webhook
// n'envoie pas. Synchro n'a pas de page : elle reste dans « Données source ».
const {
  EXPORT_COL, KEY_COL, KIND, LIST_COL, LOT_COL, RECALC_COL, RESEND_COL, SCHEMA_COL, SYNC_TABLE, TABLE_COL, TRACK_COL, TYPE_COL,
} = __M["js/logic/common.js"];
const { RECALC_SPEC, majleAction, prepareSourceActions, syncColumns, syncFormulas } = __M["js/logic/formulas.js"];
const { addTrackRowsAction, exportRowsActions, exportTables } = __M["js/logic/exports.js"];
const { apply, fetchRows, readSchema } = __M["js/grist.js"];
const { dropPages, exportsViewRef, removeTechnicalTables } = __M["js/pages.js"];

const SORT_COL = 'manualSort'; // colonne d'ordre que Grist donne à toute table (voir ensureSyncTable)

// Lignes de Synchro des exports ([] sans la table), sans la ligne 'charge'. `schema` : instantané
// déjà lu, s'il y en a un.
const isCharge = row => row[TYPE_COL] === KIND.load;
const syncRows = async (schema = null) => ((schema || await readSchema()).has(SYNC_TABLE) ? (await fetchRows(SYNC_TABLE)).filter(r => !isCharge(r)) : []);

// Ligne 'charge' de Synchro (voir parseCharge), créée au premier renvoi.
async function chargeRow() {
  const row = (await fetchRows(SYNC_TABLE)).find(isCharge);
  if (row) return row;
  const fields = { [TYPE_COL]: KIND.load, [EXPORT_COL]: '', [TABLE_COL]: '', [SCHEMA_COL]: '', [RESEND_COL]: '' };
  return { ...fields, id: (await apply([['AddRecord', SYNC_TABLE, null, fields]])).retValues[0] };
}

// Note de la table Synchro : { exports: [{ id, name, at, public }], invitations: [{ id, export,
// hash, at }], pauses: [{ hook, export, at, columns }] }.
const exportColumn = schema => (schema.columns(SYNC_TABLE) || []).find(c => c.colId === EXPORT_COL);

function readSourceNote(schema) {
  let note = null;
  try { note = JSON.parse((exportColumn(schema) || {}).description || 'null'); } catch (e) { /* note illisible */ }
  return { exports: [], invitations: [], pauses: [], ...(note && typeof note === 'object' ? note : {}) };
}

async function writeSourceNote(note) {
  const column = exportColumn(await readSchema());
  if (column) await apply([['UpdateRecord', '_grist_Tables_column', column.id, { description: JSON.stringify(note) }]]);
}

// Relit la note, la change (`change` la modifie en place) et l'écrit.
async function updateSourceNote(change) {
  const note = readSourceNote(await readSchema());
  change(note);
  await writeSourceNote(note);
}

// Les formules de Synchro nomment les tables qu'elles lisent : réécrites quand l'ensemble change.
// Une table renommée ou effacée dans la SOURCE n'y figure plus (la carte de l'export le signale) :
// son nom inconnu mettrait en erreur les lignes de tous les exports.
async function refreshFormulas(schema, rows) {
  const { keys, lot, state } = syncFormulas(rows.map(r => r[TABLE_COL]).filter(table => schema.has(table)));
  const cols = schema.columns(SYNC_TABLE);
  const actions = [[LIST_COL, keys], [LOT_COL, lot], [TRACK_COL, state]]
    .filter(([colId, formula]) => (cols.find(c => c.colId === colId) || {}).formula !== formula)
    .map(([colId, formula]) => ['ModifyColumn', SYNC_TABLE, colId, { formula }]);
  await apply(actions);
  return actions.length > 0;
}

// Table Synchro à jour : une colonne ajoutée par une version suivante du widget est créée, la
// colonne de suivi (marque d'envoi coupé des lots, suivi des clés, heure de la dernière
// consolidation d'un Échange) accepte du texte et surveille le lot, la liste et la demande de
// renvoi (dépendances posées après coup : Grist les refuse à la création), les formules
// sont celles de cette version, pour les tables de `rows` (lignes de Synchro, ou à venir), et
// chaque table d'un export a son suivi des clés. Synchro n'a pas de colonne manualSort : le webhook
// l'enverrait, et chaque ligne reçue se placerait au même rang dans le journal ; au bout d'une
// cinquantaine d'envois en attente (page de la CIBLE fermée), Grist renumérote les lignes voisines,
// ce que la clé du formulaire n'a pas le droit de faire (403), et la file se bloque (vérifié). Rend
// vrai si quelque chose a changé.
async function ensureSyncTable(rows = null) {
  let schema = await readSchema();
  if (!schema.has(SYNC_TABLE)) return false;
  const have = new Set(schema.columns(SYNC_TABLE).map(c => c.colId));
  const missing = syncColumns([]).filter(c => !have.has(c.id));
  const sorted = have.has(SORT_COL);
  if (missing.length || sorted) {
    await apply([...missing.map(({ id, ...info }) => ['AddColumn', SYNC_TABLE, id, info]), ...(sorted ? [['RemoveColumn', SYNC_TABLE, SORT_COL]] : [])]);
    schema = await readSchema();
  }
  const cols = schema.columns(SYNC_TABLE);
  const watch = cols.find(c => c.colId === TRACK_COL);
  const deps = ['L', ...[LOT_COL, LIST_COL, RESEND_COL].map(id => cols.find(c => c.colId === id).id)];
  const depsChanged = JSON.stringify(watch.recalcDeps || null) !== JSON.stringify(deps) || watch.type !== 'Any';
  if (watch.type !== 'Any') await apply([['ModifyColumn', SYNC_TABLE, TRACK_COL, { type: 'Any' }]]);
  if (depsChanged) await apply([['UpdateRecord', '_grist_Tables_column', watch.id, { recalcWhen: 0, recalcDeps: deps }]]);
  const formulasChanged = await refreshFormulas(schema, rows || await syncRows(schema));
  const track = addTrackRowsAction(await fetchRows(SYNC_TABLE));
  if (track) await apply([track]);
  return missing.length > 0 || sorted || depsChanged || formulasChanged || Boolean(track);
}

// MajLe de chaque table envoyée suit les colonnes que ses exports envoient (voir majleAction), et
// la table a sa colonne RecalculLe. Rend vrai si quelque chose a changé.
async function refreshMajLe() {
  const schema = await readSchema();
  const rows = await syncRows(schema);
  const sent = new Map(); // table -> colonnes envoyées par l'un de ses exports
  for (const id of new Set(rows.map(r => r[EXPORT_COL]))) {
    // Une colonne de filtre compte aussi : une ligne qui entre dans le filtre doit partir.
    for (const { table, columns, filter } of exportTables(rows, id)) {
      sent.set(table, new Set([...(sent.get(table) || []), ...columns.map(c => c.id), ...(filter ? [filter.id] : [])]));
    }
  }
  const tables = [...sent].filter(([table]) => schema.has(table));
  // RecalculLe (repère des annulations) manque aux tables exportées avant la version 0.4.3, et
  // était une date avant la version 0.5.
  const recalc = table => schema.columns(table).find(c => c.colId === RECALC_COL);
  const actions = [
    ...tables.flatMap(([table]) => (recalc(table) ? [] : prepareSourceActions(table, [RECALC_COL]))),
    ...tables.filter(([table]) => recalc(table) && (recalc(table).type !== RECALC_SPEC.type || recalc(table).formula !== RECALC_SPEC.formula))
      .map(([table]) => ['ModifyColumn', table, RECALC_COL, RECALC_SPEC]),
    ...tables.map(([table, ids]) => majleAction(schema.columns(table), [...ids])).filter(Boolean),
  ];
  await apply(actions);
  return actions.length > 0;
}

// Enregistre les tables et colonnes d'un export (`tables` : [{ table, columns }]). Crée la table
// Synchro au premier export. Rend les tables dont les lignes sont à envoyer (nouvelles ou aux
// colonnes changées). `swap` : export en Échange (voir exportRowsActions).
async function saveExport(exportId, tables, { isPublic = false, swap = false } = {}) {
  if (!(await readSchema()).has(SYNC_TABLE)) {
    await apply([['AddTable', SYNC_TABLE, syncColumns(tables.map(tb => tb.table))]]);
    await dropPages([SYNC_TABLE]);
  }
  const before = await fetchRows(SYNC_TABLE);
  const { actions, changed } = exportRowsActions(before, exportId, tables, { isPublic, swap });
  // Les formules d'abord quand une table s'ajoute (elles doivent pouvoir la lire), après quand une
  // table s'en va (elles ne la lisent plus quand ses lignes disparaissent).
  const all = [...before.filter(r => r[EXPORT_COL] !== exportId), ...tables.map(tb => ({ [TABLE_COL]: tb.table }))];
  await ensureSyncTable([...before, ...all]);
  await apply(actions);
  await refreshFormulas(await readSchema(), all);
  await refreshMajLe();
  return changed;
}

// Efface les lignes d'un export ; la table Synchro disparaît avec le dernier export.
async function removeExport(exportId) {
  const rows = await syncRows();
  const left = rows.filter(r => r[EXPORT_COL] !== exportId);
  if (!left.length) {
    await removeTechnicalTables([SYNC_TABLE]);
    return;
  }
  await apply([['BulkRemoveRecord', SYNC_TABLE, rows.filter(r => r[EXPORT_COL] === exportId).map(r => r.id)]]);
  await refreshFormulas(await readSchema(), left);
}

// Écrit les mêmes champs dans des lignes de Synchro (renvoi, marque d'envoi coupé).
const writeSync = (ids, fields) => apply(ids.length
  ? [['BulkUpdateRecord', SYNC_TABLE, ids, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, ids.map(() => v)]))]] : []);

// Montage d'avant la version 0.4 : une vue d'export et une table liste par table envoyée, et la
// page Synchro_Exports. Ces tables sont reconnues à leur nom et à leur colonne Synchro_Ids.
const legacyTables = schema => [
  ...schema.tableIds.filter(id => id.startsWith('Synchro_') && (schema.columns(id) || []).some(c => c.colId === LIST_COL && c.isFormula)),
  ...schema.tableIds.map(id => `${id}_summary_${KEY_COL}`).filter(id => schema.has(id)),
];

async function removeLegacy(schema) {
  await removeTechnicalTables(legacyTables(schema));
  const page = await exportsViewRef();
  if (page) await apply([['RemoveView', page]]);
}
return { isCharge, syncRows, chargeRow, readSourceNote, updateSourceNote, ensureSyncTable, refreshMajLe, saveExport, removeExport, writeSync, legacyTables, removeLegacy };
})();

// ===== js/target/journals.js =====
__M["js/target/journals.js"] = (() => {
'use strict';
// CIBLE : un journal par export reçu, Journal_<export>, où le webhook dépose les listes et les lots.
// Ce que la CIBLE a choisi (destinations, colonnes) est noté dans la description de sa colonne
// Synchro_Ids (voir awaitingPartner pour sa forme) ; la clé du formulaire peut la lire, mais pas
// l'écrire. Le journal n'a pas de page : seul son formulaire en a une (voir pages.js).
const {
  APPLIED_COL, AUTHOR_COL, BEFORE_COL, DATA_COL, DELETE_COL, JOURNAL_PREFIX, KEY_COL, LIST_COL, MISSING_COL, ORDER_COL, RECEIVED_COL, STATE_COL,
} = __M["js/logic/common.js"];
const { syncColumns } = __M["js/logic/formulas.js"];
const { apply, readSchema } = __M["js/grist.js"];
const { dropPages, hideColumn } = __M["js/pages.js"];

// Colonnes du journal : celles de la table Synchro (le webhook envoie chaque ligne entière), puis
// les colonnes des lignes dépliées et leurs marques (clé, date, suppression, bloc des colonnes ;
// recopiée, effet, valeurs remplacées, auteur, date d'arrivée). Le webhook n'écrit que les
// premières : une colonne propre au journal ne gêne pas.
const JOURNAL_COLUMNS = [
  ...syncColumns([]).map(({ id, type }) => ({ id, type, isFormula: false })).filter(c => ![AUTHOR_COL, MISSING_COL].includes(c.id)),
  { id: KEY_COL, type: 'Text', isFormula: false },
  { id: ORDER_COL, type: 'DateTime:UTC', isFormula: false },
  { id: DELETE_COL, type: 'Bool', isFormula: false },
  { id: DATA_COL, type: 'Text', isFormula: false },
  { id: APPLIED_COL, type: 'Bool', isFormula: false },
  { id: STATE_COL, type: 'Text', isFormula: false },
  { id: BEFORE_COL, type: 'Text', isFormula: false },
  { id: AUTHOR_COL, type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0 },
  { id: RECEIVED_COL, type: 'DateTime:UTC', isFormula: false, formula: 'NOW()', recalcWhen: 0 },
];

// Journaux d'exports reçus : leur note dit d'où ils viennent et où va chaque table.
// { journal, note: { id, export, name, secret, from, mode, base, tables: [{ table, dest, columns,
// map, match, label }], refused: [], missing: {} } }
function receivedJournals(schema) {
  return schema.tableIds.filter(id => id.startsWith(JOURNAL_PREFIX)).map((journal) => {
    const note = readNote(schema, journal);
    return note && note.export && Array.isArray(note.tables) ? { journal, note: { refused: [], missing: {}, ...note } } : null;
  }).filter(Boolean);
}

// Journaux d'avant la version 0.4 (un par table reçue) : à refaire.
function legacyJournals(schema) {
  const current = new Set(receivedJournals(schema).map(r => r.journal));
  return schema.tableIds.filter(id => id.startsWith(JOURNAL_PREFIX) && !current.has(id) && (schema.columns(id) || []).some(c => c.colId === LIST_COL));
}

// Tables reçues ici, avec le document qui les envoie : pour refuser les boucles et repérer un relais.
const receivedDests = schema => receivedJournals(schema)
  .flatMap(({ note }) => note.tables.map(tb => ({ dest: tb.dest, fromDocId: (note.from || {}).docId || '' })));

// Un journal créé par une version précédente du widget reçoit les colonnes techniques qui lui
// manquent. Renvoie vrai si le schéma a changé.
async function upgradeJournal(schema, journal) {
  const have = new Set(schema.columns(journal).map(c => c.colId));
  const missing = JOURNAL_COLUMNS.filter(c => !have.has(c.id));
  await apply(missing.map(({ id, ...info }) => ['AddColumn', journal, id, info]));
  return missing.length > 0;
}

// Colonnes que la destination reçoit : les colonnes de données.
const destColumns = columns => columns.filter(c => ![KEY_COL, ORDER_COL, DELETE_COL].includes(c.id));

// CIBLE : colonnes envoyées qui manquent à la destination, sous le nom choisi dans `map`
// (colonne envoyée -> colonne de la destination). La clé `id_sync` en fait partie. Les colonnes de
// données s'affichent dans les vues de la table (`AddColumn` ne les mettrait que dans « Données
// source » et la fiche : une colonne ajoutée plus tard à l'export arrivait cachée) ; la clé non.
function addDestColumnsActions(schema, dest, columns, map = {}) {
  const have = new Set((schema.columns(dest) || []).map(c => c.colId));
  return [...destColumns(columns), { id: KEY_COL, type: 'Text', label: KEY_COL }]
    .map(({ id, type, label }) => ({ id: map[id] || id, type, label: map[id] ? map[id] : label, key: id === KEY_COL }))
    .filter(c => !have.has(c.id))
    .map(({ id, key, ...info }) => [key ? 'AddColumn' : 'AddVisibleColumn', dest, id, { ...info, isFormula: false }]);
}

async function createJournal(journal, note) {
  await apply([['AddTable', journal, JOURNAL_COLUMNS]]);
  await writeNote(await readSchema(), journal, note);
  await dropPages([journal]);
}

// Destination d'une table reçue : créée, ou complétée des colonnes qui lui manquent ; sa clé
// `id_sync` est masquée de sa page.
async function prepareDest({ dest, columns, map = {} }) {
  if (!(await readSchema()).has(dest)) await apply([['AddTable', dest, []]]);
  await apply(addDestColumnsActions(await readSchema(), dest, columns, map));
  await hideColumn(dest, KEY_COL);
}

// Note JSON dans la description de la colonne Synchro_Ids d'un journal.
const listColumn = (schema, tableId) => (schema.columns(tableId) || []).find(c => c.colId === LIST_COL);

function readNote(schema, tableId) {
  const column = listColumn(schema, tableId);
  try { return JSON.parse((column && column.description) || 'null'); } catch (e) { return null; }
}

async function writeNote(schema, tableId, value) {
  await apply([['UpdateRecord', '_grist_Tables_column', listColumn(schema, tableId).id, { description: value == null ? '' : JSON.stringify(value) }]]);
}

// Note d'un journal relue, changée par `change` (qui rend la nouvelle note), puis écrite.
async function updateJournalNote(journal, change) {
  const schema = await readSchema();
  await writeNote(schema, journal, change(readNote(schema, journal)));
}
return { receivedJournals, legacyJournals, receivedDests, upgradeJournal, destColumns, addDestColumnsActions, createJournal, prepareDest, updateJournalNote };
})();

// ===== js/exchange.js =====
__M["js/exchange.js"] = (() => {
'use strict';
// Échange : deux documents qui se tiennent à jour l'un l'autre (voir planConsolidation). Chacun a
// un export (même identifiant des deux côtés, avec sa ligne 'echange') et un journal en mode
// 'echange' qui reçoit l'autre. Le journal de retour du document qui a invité (`retour`) attend
// la réponse (`from` encore vide) avant de recopier quoi que ce soit.
const { SYNC_TABLE } = __M["js/logic/common.js"];
const { deleteColumnAction, keyTriggerAction, missingSyncColumns, prepareSourceActions } = __M["js/logic/formulas.js"];
const { endNotice, exchangeTables, exportCondition, exportTables, exportableColumns, hookName, hooksOf } = __M["js/logic/exports.js"];
const { apply, createWebhook, deleteWebhook, deleteWebhookWithNotice, listWebhooks, readSchema, webhookConditions } = __M["js/grist.js"];
const { removeTechnicalTables } = __M["js/pages.js"];
const { removeExport, saveExport, syncRows, updateSourceNote } = __M["js/source/synchro.js"];
const { receivedJournals } = __M["js/target/journals.js"];

// Côté CIBLE : l'export de retour (identifiant et nom de l'export reçu) envoie les destinations à
// la SOURCE. Elles reçoivent MajLe et RecalculLe, et une clé à chaque ligne nouvelle ; les lignes
// déjà là sans clé restent à ce document. Avec `retour` (adresse d'écriture du journal de retour,
// lue dans l'invitation, jamais notée), le webhook vers la SOURCE est (re)créé.
async function wireExchange(note, retour = '') {
  let schema = await readSchema();
  for (const { dest } of note.tables) {
    const cols = schema.columns(dest) || [];
    await apply([...prepareSourceActions(dest, missingSyncColumns(cols)), keyTriggerAction(dest, cols), deleteColumnAction(dest, cols)].filter(Boolean));
  }
  schema = await readSchema();
  await saveExport(note.export, exchangeTables(note.tables, dest => exportableColumns(schema.columns(dest) || [])), { swap: true });
  await updateSourceNote((n) => {
    const was = n.exports.find(e => e.id === note.export) || { at: Date.now() / 1000 };
    n.exports = [...n.exports.filter(e => e.id !== note.export), { ...was, id: note.export, name: note.name, echange: true, retour: true }];
  });
  if (!retour) return;
  const [hooks, conditions] = await Promise.all([listWebhooks(), webhookConditions()]);
  for (const h of hooksOf(hooks, conditions, note.export)) await deleteWebhook(h.id);
  const from = note.from || {};
  await createWebhook({
    name: hookName(note.name, note.export), memo: [from.email, from.docId].filter(Boolean).join(' · '), url: retour,
    tableId: SYNC_TABLE, condition: exportCondition(note.export),
  });
}

// Échange, côté du document qui invite : ses tables reçoivent la case Supprime.
async function addDeleteColumns(tables) {
  const schema = await readSchema();
  await apply(tables.map(table => deleteColumnAction(table, schema.columns(table) || [])).filter(Boolean));
}

// Fin d'un Échange, de ce côté : ses webhooks et son journal sont effacés, les tables gardent
// leurs lignes. `keepExport` (document qui a invité) : l'export reste, sans destinataire ; sinon
// (export de retour) il disparaît aussi.
async function endExchange(exportId, { keepExport }) {
  const [hooks, conditions] = await Promise.all([listWebhooks(), webhookConditions()]);
  for (const h of hooksOf(hooks, conditions, exportId)) await deleteWebhookWithNotice(h, endNotice(exportId));
  const journals = receivedJournals(await readSchema()).filter(r => r.note.export === exportId && r.note.mode === 'echange');
  await removeTechnicalTables(journals.map(r => r.journal));
  if (keepExport) await saveExport(exportId, exportTables(await syncRows(), exportId));
  else await removeExport(exportId);
  await updateSourceNote((note) => {
    note.exports = keepExport ? note.exports.map(e => (e.id === exportId ? { ...e, echange: false } : e)) : note.exports.filter(e => e.id !== exportId);
    note.invitations = note.invitations.filter(i => i.export !== exportId);
    note.pauses = note.pauses.filter(p => p.export !== exportId);
  });
}
return { wireExchange, addDeleteColumns, endExchange };
})();

// ===== js/prefs.js =====
__M["js/prefs.js"] = (() => {
'use strict';
// Préférences de la personne dans le stockage local du navigateur : langue, thème, l'heure de sa
// dernière visite par document CIBLE (`visit.<docId>`, pour l'historique) et un identifiant
// tiré au hasard pour ce navigateur (`browser`, voir chargeBusy). Aucune donnée du document n'y est
// écrite.
const PREFIX = 'gristsync.';

function readPref(name) {
  try { return localStorage.getItem(PREFIX + name); } catch (e) { return null; }
}

function writePref(name, value) {
  try { localStorage.setItem(PREFIX + name, value); return true; } catch (e) { return false; }
}

function applyTheme() {
  const theme = readPref('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
return { readPref, writePref, applyTheme };
})();

// ===== js/i18n.js =====
__M["js/i18n.js"] = (() => {
'use strict';
// Textes de l'interface, français et anglais, dans i18n/fr.json et i18n/en.json (des données, pas
// du code). La langue est lue une fois au démarrage : le choix des Réglages, sinon la première des
// deux que propose le navigateur. Changer de langue recharge la page. Pluriels :
// « {n|singulier|pluriel} » (en français, 0 et 1 au singulier).
const { readPref } = __M["js/prefs.js"];
const fr = {
 "app.title": "Synchro",
 "tab.send": "Envoyer",
 "tab.receive": "Recevoir",
 "settings.title": "Réglages",
 "settings.lang": "Langue",
 "settings.theme": "Thème",
 "settings.theme.system": "Système",
 "settings.theme.light": "Clair",
 "settings.theme.dark": "Sombre",
 "settings.credits": "Crédits",
 "settings.credits.author": "Auteur",
 "settings.credits.site": "Site",
 "settings.credits.license": "Licence",
 "settings.credits.version": "Version",
 "common.close": "Fermer",
 "common.cancel": "Annuler",
 "common.copy": "Copier",
 "common.save": "Enregistrer",
 "common.copied": "Copié",
 "common.next": "Continuer",
 "common.back": "Retour",
 "common.later": "Plus tard",
 "common.filter": "Filtrer",
 "common.none": "Aucun résultat",
 "common.readonly": "Lecture seule : un éditeur doit ouvrir cette page pour que les actions soient possibles.",
 "common.ownerOnly": "Réservé aux propriétaires du document.",
 "common.code": "Code",
 "common.filterIn": "Filtrer : {name}",
 "common.choose": "— Choisir —",
 "common.blank": "(vide)",
 "common.yes": "oui",
 "common.no": "non",
 "type.Text": "Texte",
 "type.Numeric": "Numérique",
 "type.Int": "Entier",
 "type.Bool": "Case à cocher",
 "type.Date": "Date",
 "type.DateTime": "Date et heure",
 "type.Choice": "Choix",
 "type.ChoiceList": "Choix multiple",
 "type.Ref": "Référence",
 "type.RefList": "Liste de références",
 "type.Attachments": "Pièces jointes",
 "type.Any": "Quelconque",
 "home.title": "Que voulez-vous faire dans ce document ?",
 "guide.title": "Qui fait quoi ?",
 "guide.you": "vous",
 "guide.role.source": "SOURCE",
 "guide.role.target": "CIBLE",
 "guide.s1": "Installe le widget, Envoyer : crée un export (ses tables et leurs colonnes), puis « Ajouter un destinataire » et transmet le code d’invitation à la CIBLE.",
 "guide.t1": "Installe le widget, Recevoir, « Accepter une invitation » : colle le code, choisit où ranger chaque table.",
 "guide.t2": "Ouvre la page du formulaire, apparue en bas de la liste des pages : Partager, Copier le lien. Colle ce lien dans le widget (un seul lien pour tout l’export), puis renvoie le code de réponse à la SOURCE.",
 "guide.s2": "Sur la carte de l’export, ligne de l’invitation : « Coller la réponse », vérifie qui a accepté, « Approuver et brancher », puis « Envoyer » les lignes existantes.",
 "guide.t3": "Ouvre de temps en temps la page du widget : la recopie dans les tables se fait page ouverte. Une table ajoutée plus tard à l’export y est proposée dans une fenêtre.",
 "guide.p.s1": "Installe le widget, Envoyer : crée un export, « Ajouter un destinataire », mode Lien public. Transmet le code, puis dans Partager règle « Lien public » sur Lecture.",
 "guide.p.t1": "Installe le widget, Recevoir, « Accepter une invitation » : colle le code, choisit les destinations. La lecture se fait page ouverte, toutes les 10 secondes.",
 "guide.e.s1": "Installe le widget, Envoyer : crée un export, « Ajouter un destinataire », mode Échange. Copie le lien du formulaire de retour, publié sur sa propre page en bas de la liste des pages, puis transmet le code d’invitation à la CIBLE.",
 "guide.e.t1": "Installe le widget dans un document dont elle est propriétaire, Recevoir, « Accepter une invitation » : colle le code, choisit où ranger chaque table.",
 "guide.e.t3": "Chaque document ouvre de temps en temps la page du widget : chacun recopie, page ouverte, ce que l’autre a changé. La modification la plus récente l’emporte.",
 "guide.publicNote": "En mode lien public, un seul code suffit : la CIBLE n’a pas de réponse à renvoyer.",
 "guide.install": "Installation : dans le document, ajoutez un widget personnalisé « Constructeur » avec le même code HTML et JavaScript, et acceptez l’accès complet.",
 "guide.copyHandoff": "Copier avec les consignes",
 "guide.copyHandoff.help": "Le code et les étapes de l’autre document, prêts à coller dans un courriel.",
 "guide.handoff.target": "Bonjour, je vous propose de recevoir des tables de mon document Grist. Dans votre document Grist (vous devez pouvoir le modifier) :",
 "guide.handoff.source": "Bonjour, voici ma réponse à votre invitation de synchro Grist. Dans votre document :",
 "guide.handoff.code": "Code :",
 "home.send": "Envoyer des tables",
 "home.send.desc": "Ce document est la SOURCE : ses lignes sont recopiées dans un autre document.",
 "home.receive": "Recevoir des tables",
 "home.receive.desc": "Ce document est la CIBLE : il reçoit et tient à jour une copie éditable.",
 "send.empty": "Aucun export. Un export regroupe des tables et les colonnes choisies ; vous y ajoutez ensuite les personnes qui le reçoivent.",
 "send.new": "Nouvel export",
 "send.step.tables": "Tables",
 "send.step.columns": "Colonnes",
 "send.step.name": "Nom",
 "send.step.options": "Options",
 "send.step.invitation": "Invitation",
 "send.step.reply": "Réponse",
 "send.step.load": "Envoi",
 "send.tables.help": "Cochez les tables de l’export.",
 "send.edit.tables": "Cochez les tables de l’export. Une table ajoutée est proposée à chaque destinataire, qui choisit où la ranger.",
 "send.edit.removed": "Ne partiront plus : {tables}. Ce que les destinataires en ont déjà reçu reste chez eux.",
 "send.columns.help": "Par défaut, toutes les colonnes et toutes les lignes partent. Précisez-les au besoin : le reste ne sort jamais du document. Une Référence part comme le texte qu’elle affiche.",
 "send.columns.relay": "Table reçue d’un autre document : le widget la relaie telle qu’il la reçoit. Les lignes que vous y ajoutez à la main restent ici, elles ne partent pas.",
 "send.columns.blocked": "Non envoyables (pièces jointes) : {cols}.",
 "send.columns.all": "Toutes les colonnes ({n})",
 "send.columns.some": "{n} {n|colonne|colonnes} sur {total}",
 "send.rows.all": "toutes les lignes",
 "send.rows.filtered": "lignes où {column} vaut « {value} »",
 "send.columns.pick": "Choisir les colonnes",
 "send.rows.pick": "Filtrer les lignes",
 "send.lastOk": "Dernier envoi reçu par le destinataire : {at}",
 "send.secret.help": "Le secret prouve que la réponse vient de quelqu’un qui a reçu l’invitation. Sans lui, vous approuvez sur la seule fiche du destinataire.",
 "send.backOptions.title": "Revenir aux options ?",
 "send.backOptions.body": "L’invitation en cours est annulée : son code ne servira plus. Vous en créerez une nouvelle, à transmettre à la place.",
 "send.newCode.title": "Refaire le code d’invitation ?",
 "send.newCode.body": "Le widget ne garde ni le code ni son secret : il en fait un nouveau, et l’ancien ne servira plus. Transmettez le nouveau à la place.",
 "send.newCode.ok": "Refaire le code",
 "send.reply.ready": "J’ai la réponse",
 "send.connected": "Branché : les ajouts, modifications et suppressions partent désormais tout seuls.",
 "send.done": "Lignes existantes envoyées.",
 "send.name": "Nom de l’export",
 "send.name.help": "Les destinataires voient ce nom.",
 "send.create": "Créer l’export",
 "send.created": "Export « {name} » créé.",
 "send.created.next": "Ajoutez maintenant la première personne qui le reçoit. Depuis la carte de l’export, vous pourrez en ajouter d’autres ou en révoquer une seule.",
 "send.edit.title": "Modifier « {name} »",
 "send.edit.saved": "Enregistré : {n} {n|ligne est partie|lignes sont parties} vers les destinataires.",
 "send.edit.savedNone": "Enregistré.",
 "send.export.table": "{table} ({n} {n|colonne|colonnes})",
 "send.export.tableFiltered": "{table} ({n} {n|colonne|colonnes}, lignes où {col} = « {value} »)",
 "send.filter.title": "Lignes de {table} à envoyer",
 "send.filter.all": "Toutes les lignes",
 "send.filter.value": "Valeur des lignes de {table} à envoyer",
 "send.filter.help": "Seules partent les lignes où cette colonne vaut exactement ce texte (majuscules indifférentes). Une ligne qui en sort est effacée chez les destinataires.",
 "send.filter.bool": "Case à cocher : écrivez « oui » ou « non ». Une ligne qui en sort est effacée chez les destinataires.",
 "send.export.partial": "Un envoi n’est pas terminé (gros changement, nombreuses suppressions, renvoi interrompu) : le widget envoie le reste. Gardez cette page ouverte jusqu’à la fin.",
 "send.export.lost": "Table introuvable (renommée ou supprimée) : {tables}. Ses lignes ne partent plus. Rendez-lui son nom, ou retirez-la de l’export (Modifier).",
 "send.export.drift": "Colonnes changées depuis l’export (renommées, supprimées ou d’un autre type) : {cols}. Elles ne partent plus correctement : cochez de nouveau les bonnes colonnes (Modifier).",
 "send.export.nobody": "Personne ne reçoit encore cet export.",
 "send.action.addPerson": "Ajouter un destinataire",
 "send.action.edit": "Modifier",
 "send.action.delete": "Supprimer",
 "send.delete.title": "Supprimer l’export « {name} » ?",
 "send.delete.body": "Les envois s’arrêtent pour {n} {n|destinataire|destinataires}. Ce qu’ils ont déjà reçu reste chez eux. Les colonnes id_sync et MajLe restent dans vos tables.",
 "send.person.title": "Ajouter un destinataire à « {name} »",
 "send.person.tables": "Tables de l’export : {tables}.",
 "send.mode": "Mode",
 "send.mode.others": "Autres modes",
 "send.mode.reply": "Dans un seul sens (recommandé) : vos modifications partent vers le destinataire, qui vous renvoie un code de réponse",
 "send.mode.public": "Lien public : un seul code, le destinataire lit l’export sans répondre (données publiables)",
 "send.mode.publicDone": "Lien public : déjà ouvert pour cet export (bouton Code sur sa carte)",
 "send.mode.echange": "Dans les deux sens (Échange) : ses modifications reviennent aussi ici, la plus récente l’emporte",
 "send.mode.echange.help": "Les deux documents se tiennent à jour l’un l’autre. Effacer une ligne ne l’efface que chez soi : cochez sa case Supprime pour l’effacer des deux côtés. Un Échange relie deux documents : l’export n’a pas d’autre destinataire, et le destinataire doit être propriétaire de son document.",
 "send.mode.echange.off": "Dans les deux sens (Échange) : seulement pour un export sans destinataire ni invitation, hors lien public",
 "send.back.title": "Lien du formulaire de retour",
 "send.back.help": "Les modifications du destinataire arriveront ici par un formulaire de retour, publié {where}. Copiez son lien et collez-le ici : il part dans l’invitation, et seul le destinataire pourra s’en servir.",
 "send.back.again": "Refaire le code",
 "send.back.resume": "Reprendre",
 "send.exchange.single": "Un Échange relie deux documents : pas d’autre destinataire.",
 "send.exchange.managed": "Échange reçu d’un autre document : il se règle depuis l’onglet Recevoir. Le supprimer arrête l’Échange.",
 "send.exchange.with": "Échange : les modifications de ce destinataire reviennent dans vos tables.",
 "send.exchange.map": "{dest} ↔ {table}",
 "send.public.warn": "Le widget ajoute des règles d’accès : toute personne qui n’est que lectrice du document (dont le lien public) ne verra plus que les exports publics, rien d’autre. Ensuite, dans Partager, réglez « Lien public » sur Lecture. À éviter pour des données qui ne doivent pas être publiques.",
 "send.public.label": "lien public",
 "send.public.turnOn": "À faire : dans le menu Partager du document, réglez « Lien public » sur Lecture.",
 "send.public.code": "Code",
 "send.public.help": "Transmettez ce code : il suffit au destinataire. Il ne contient aucune donnée.",
 "send.public.revokeBody": "Les lecteurs ne verront plus cet export. Désactivez aussi le lien public dans Partager s’il ne sert plus : tant qu’il reste actif, le widget garde la règle qui cache le reste du document.",
 "send.public.stop": "Couper le lien public",
 "send.charge.wait": "Renvois espacés pour ménager le serveur : la suite part vers {at}. Les modifications ordinaires partent toujours.",
 "send.charge.busy": "Un renvoi est en cours depuis une autre page ou une autre personne : il continue seul.",
 "send.public.tooBig": "Trop gros pour le lien public (plus de 2 Mo) : {tables}. Le lien public n’en donne rien ; invitez plutôt la personne (webhook), ou filtrez les lignes.",
 "send.public.stopTitle": "Couper le lien public de « {name} » ?",
 "send.check.missing": "En créant l’export, le widget ajoutera : {items}.",
 "send.check.sync": "la table technique Synchro (une seule pour tous les exports)",
 "send.secret": "Protéger l’invitation par un secret (recommandé)",
 "send.secret.on": "avec secret",
 "send.secret.off": "sans secret",
 "send.invite": "Créer l’invitation",
 "send.invite.help": "Transmettez ce code à la personne qui gère le document CIBLE. Elle le colle dans ce widget, onglet « Recevoir », puis vous renvoie un code de réponse.",
 "send.invite.pending": "Invitation du {at}",
 "send.reply": "Coller la réponse",
 "send.reply.title": "Réponse du destinataire",
 "send.reply.help": "Collez le code de réponse reçu du document CIBLE.",
 "send.reply.check": "Vérifier",
 "send.reply.tables": "Tables",
 "send.reply.email": "Accepté par",
 "send.reply.doc": "Document",
 "send.reply.team": "Équipe",
 "send.reply.at": "Le",
 "send.reply.approve": "Approuver et brancher",
 "send.reply.nosecret": "Cette invitation n’a pas de secret, vérifiez donc la fiche avant d’approuver.",
 "send.reply.sameDoc": "ce document",
 "send.load.body": "Le branchement n’envoie que les modifications à venir. Envoyer maintenant {n} {n|ligne existante|lignes existantes} ?",
 "send.load.ok": "Envoyer",
 "send.load.empty": "Les tables sont vides pour l’instant : les lignes partiront dès leur ajout.",
 "send.load.progress": "Envoi : {done} sur {total}…",
 "send.load.done": "Renvoi terminé : {n} {n|ligne renvoyée|lignes renvoyées}.",
 "send.load.queued": "Un autre renvoi est en cours pour ce document (autre page ou autre personne) : celui-ci est noté, et partira seul ensuite, tant qu’une page du widget reste ouverte.",
 "send.load.nobody": "Aucun destinataire branché : rien à renvoyer.",
 "send.load.background": "Vous pouvez fermer cette fenêtre : l’envoi continue tant que la page reste ouverte, et reprend sinon à la prochaine ouverture du widget par un propriétaire.",
 "send.status.invited": "En attente de réponse",
 "send.status.people": "{n} {n|destinataire|destinataires}",
 "send.status.alone": "Sans destinataire",
 "send.status.legacy": "À refaire",
 "send.cancel.title": "Retirer cette invitation ?",
 "send.cancel.body": "Son code ne pourra plus être accepté.",
 "send.status.public": "Public",
 "send.status.publicOff": "Lien public à activer",
 "send.status.active": "Actif",
 "send.status.paused": "En pause",
 "send.status.error": "Erreur",
 "send.waiting": "{n} {n|envoi en attente|envois en attente}",
 "send.action.load": "Tout renvoyer",
 "send.action.pause": "Mettre en pause",
 "send.action.resume": "Reprendre",
 "send.resume.title": "Reprendre « {name} »",
 "send.resume.catchup": "Rattraper les modifications de la pause (recommandé)",
 "send.resume.catchup.help": "Renvoie {n} {n|ligne ajoutée ou modifiée|lignes ajoutées ou modifiées} pendant la pause, et les suppressions. Le reste de la table ne repart pas.",
 "send.resume.all": "L’heure de la pause n’est pas connue, ou les colonnes ont changé pendant la pause : tout l’export repart.",
 "send.resume.asIs": "Reprendre sans rattraper",
 "send.resume.asIs.help": "Seules les modifications à venir partent. Ce qui a été ajouté, modifié ou supprimé pendant la pause n’arrivera pas à la CIBLE, sauf si la ligne est modifiée de nouveau (ou avec « Tout renvoyer »).",
 "send.action.unblock": "Débloquer la file",
 "send.action.revoke": "Révoquer",
 "send.action.cancel": "Retirer l’invitation",
 "send.revoke.title": "Révoquer « {name} » ?",
 "send.revoke.body": "Les envois s’arrêtent pour cette personne seulement ; les autres destinataires continuent. Ce qu’elle a déjà reçu reste chez elle.",
 "send.revoke.exchange": "L’Échange s’arrête : vos modifications ne partent plus, les siennes ne reviennent plus (le journal de retour est effacé). Les tables gardent leurs lignes, des deux côtés.",
 "send.unblock.title": "Débloquer la file d’envoi ?",
 "send.unblock.body": "La file d’envoi est commune à tout le document : ses envois en attente sont abandonnés, puis le widget renvoie les exports seul (gardez cette page ouverte). Si une personne ne reçoit plus, révoquez-la ou mettez-la en pause d’abord, sinon la file se bloquera de nouveau.",
 "send.unsafe.title": "Envoi sans filtre",
 "send.unsafe.body": "Ces envois (webhooks de Grist) lisent la table Synchro sans filtre d’export : ils recevraient tous les exports. Supprimez-les : {who}.",
 "send.unsafe.delete": "Supprimer ces envois",
 "send.unsafe.confirm": "Ces envois sont supprimés de Grist. Leurs destinataires ne reçoivent plus rien.",
 "send.error.size": "Envoi trop gros pour Grist (plus de 1 Mo) : le widget vide la file et renvoie tout de lui-même. Gardez cette page ouverte.",
 "send.error.column": "Le journal de cette personne refuse une colonne envoyée : demandez-lui d’ouvrir la page de son widget, qui remet son journal à jour. L’envoi reprend ensuite seul.",
 "send.error.link": "Le lien de réception de cette personne ne marche plus (réception arrêtée, lien coupé ou formulaire dépublié) : révoquez-la, puis invitez-la de nouveau.",
 "send.error.other": "Cette personne ne reçoit plus : tant que l’envoi échoue, la file d’envoi du document est bloquée pour tous.",
 "send.error.detail": "Détail : {detail}",
 "send.legacy.title": "Montage d’une version précédente",
 "send.legacy.body": "Ces tables techniques viennent d’une version précédente du widget : {tables}. Recréez vos envois sous forme d’exports, puis effacez l’ancien montage.",
 "send.legacy.clean": "Effacer l’ancien montage",
 "send.legacy.confirm": "Le widget supprime les anciens webhooks et les anciennes tables techniques. Les destinataires de l’ancien montage ne reçoivent plus rien tant qu’ils n’ont pas accepté une invitation à un export.",
 "recv.empty": "Aucun export reçu. Collez une invitation reçue du document SOURCE.",
 "recv.new": "Accepter une invitation",
 "recv.invite.title": "Invitation reçue",
 "recv.invite.help": "Collez le code d’invitation transmis par le document SOURCE.",
 "recv.invite.summary": "« {name} » : {n|table|tables} {tables}.",
 "recv.dest": "Où ranger chaque table reçue : une nouvelle table, ou une table de ce document.",
 "recv.step.code": "Code",
 "recv.step.dest": "Destinations",
 "recv.step.link": "Lien",
 "recv.step.reply": "Réponse",
 "recv.from": "Données de {from}",
 "recv.fromDoc": "Données de {from}, document {doc}",
 "recv.link.ok": "Le lien fonctionne.",
 "recv.action.continue": "Continuer",
 "recv.history.since": "Depuis votre dernière visite",
 "recv.history.last": "Derniers changements",
 "recv.history.n.ajout": "{n} {n|ajoutée|ajoutées}",
 "recv.history.n.modif": "{n} {n|modifiée|modifiées}",
 "recv.history.n.suppression": "{n} {n|supprimée|supprimées}",
 "recv.history.n.colonne": "{n} {n|colonne ajoutée|colonnes ajoutées}",
 "recv.history.colonne": "ajoutée par la SOURCE",
 "recv.history.colLabel": "Colonne « {col} »",
 "recv.history.more": "et {n} {n|autre|autres}",
 "recv.history.none": "Aucune modification depuis votre dernière visite.",
 "recv.history.ajout": "ajoutée",
 "recv.history.modif": "modifiée",
 "recv.history.suppression": "supprimée",
 "recv.history.before": "Avant",
 "recv.history.after": "Après",
 "recv.history.row": "Ligne {n} de la table",
 "recv.history.rowGone": "Ligne {n} de la table, avant sa suppression",
 "recv.drift.title": "{dest} : {n} {n|modification faite|modifications faites} à la main ici",
 "recv.drift.body": "{n|Elle reste en place|Elles restent en place} jusqu’à ce que la SOURCE modifie la même ligne. « Corriger » remet tout de suite l’état exact de la SOURCE.",
 "recv.drift.row": "Ligne",
 "recv.drift.col": "Colonne",
 "recv.drift.here": "Ici",
 "recv.drift.source": "SOURCE",
 "recv.drift.fix": "Corriger",
 "recv.drift.fixTitle": "Remettre les valeurs de la SOURCE dans {dest} ?",
 "recv.drift.fixBody": "{n} {n|modification faite à la main ici est remplacée|modifications faites à la main ici sont remplacées} par l’état exact de la SOURCE.",
 "recv.drift.fixRows": "{n} {n|ligne supprimée ici revient|lignes supprimées ici reviennent}, en fin de table.",
 "recv.drift.fixCols": "{n} {n|colonne supprimée ici est recréée|colonnes supprimées ici sont recréées}.",
 "recv.drift.rowGone": "Ligne supprimée ici, toujours dans la SOURCE",
 "recv.drift.colGone": "Colonne supprimée ici, toujours envoyée par la SOURCE",
 "recv.label.change": "Changer la colonne affichée",
 "recv.label.title": "Colonne affichée",
 "recv.label.help": "Colonne qui nomme chaque ligne dans l’historique, par table.",
 "recv.create": "Créer les tables",
 "recv.existing": "Choisissez la colonne qui reçoit chaque colonne envoyée. Le widget ajoute les colonnes nouvelles et une clé id_sync masquée.",
 "recv.dest.new": "Nouvelle table",
 "recv.dest.name": "Nom de la nouvelle table pour {table}",
 "recv.dest.nameLabel": "Nom de la nouvelle table",
 "recv.dest.from": "Table reçue",
 "recv.dest.to": "Ranger dans",
 "recv.undo.title": "Revenir aux destinations ?",
 "recv.undo.body": "Le journal de cette réception et son formulaire sont effacés, avec son lien d’écriture ; les tables qu’elle a créées aussi, si elles sont encore vides. Vous choisirez de nouveau où ranger chaque table.",
 "recv.col.new": "Nouvelle colonne « {col} »",
 "recv.match": "Rattacher les lignes déjà là par la colonne",
 "recv.match.none": "Ne pas rattacher",
 "recv.match.help": "Une ligne déjà là dont cette colonne a la même valeur qu’une ligne reçue est mise à jour au lieu d’être doublée. Les autres lignes déjà là ne sont jamais touchées.",
 "recv.link.title": "Lien du formulaire",
 "recv.link.where": "sur sa propre page, en bas de la liste des pages",
 "recv.link.where.page": "sur la page « {page} », dans la liste des pages (ouvrez-la)",
 "recv.link.help": "Un formulaire de réception vient d’être publié {where}. Copiez son lien et collez-le ici : il sert pour toutes les tables de l’export.",
 "recv.link.step1": "1. Ouvrez la page du formulaire et cliquez « Partager » dans sa carte.",
 "recv.link.step2": "2. Cliquez « Copier le lien », puis collez-le ci-dessous.",
 "recv.link.check": "Tester le lien",
 "recv.reply.help": "Renvoyez ce code à la personne qui vous a invité : elle le colle dans son widget pour brancher l’envoi.",
 "recv.status.waiting": "En attente du lien",
 "recv.status.ok": "À jour",
 "recv.status.error": "Erreur",
 "recv.status.incomplete": "Incomplet",
 "recv.status.ended": "Coupé par la SOURCE",
 "recv.ended": "La SOURCE a coupé cet envoi le {at} (révocation, export supprimé ou Échange arrêté) : plus rien n’arrivera. Les tables gardent leurs lignes ; « Arrêter la réception » retire le journal et son formulaire.",
 "recv.sync.none": "Rien de nouveau : tout est à jour.",
 "recv.consent": "En continuant, le widget crée dans ce document les tables de destination nouvelles (ou ajoute aux tables existantes leurs colonnes et une clé id_sync masquée), un journal technique pour cet export, et son formulaire de réception, sur sa propre page.",
 "recv.consent.public": "En continuant, le widget crée dans ce document les tables de destination nouvelles (ou ajoute aux tables existantes leurs colonnes et une clé id_sync masquée) et un journal technique sans page pour cet export.",
 "recv.consent.echange": "Échange : vos modifications de ces tables repartiront vers le document SOURCE, la plus récente l’emportant. Le widget ajoute aux tables de destination les colonnes MajLe et RecalculLe, et crée un envoi de retour (onglet Envoyer). Effacer une ligne ne l’efface que chez vous : cochez sa case Supprime pour l’effacer des deux côtés.",
 "recv.exchange": "Échange : vos modifications de ces tables repartent vers ce document.",
 "recv.action.sync": "Synchroniser",
 "recv.action.link": "Refaire le lien",
 "recv.public": "Lien public : relu tant que cette page est ouverte, seulement quand l’export change.",
 "recv.public.done": "Branché : le widget lit la SOURCE tant que cette page est ouverte.",
 "recv.action.stop": "Arrêter la réception",
 "recv.stop.title": "Arrêter de recevoir « {name} » ?",
 "recv.stop.body": "Le widget efface le journal {journal} et son formulaire de réception, avec son lien d’écriture : les envois de la SOURCE échoueront, elle devra révoquer. Les tables de destination et leurs lignes restent.",
 "recv.result": "{added} {added|ajoutée|ajoutées}, {updated} {updated|mise à jour|mises à jour}, {removed} {removed|supprimée|supprimées}",
 "recv.result.none": "Rien à faire",
 "recv.auto": "Mise à jour automatique tant que cette page est ouverte : toutes les 10 secondes, toutes les minutes quand rien n’arrive.",
 "recv.missing": "{table} : {n} {n|ligne n’est pas encore arrivée|lignes ne sont pas encore arrivées} (changement trop gros pour un seul envoi). Elles partiront d’elles-mêmes dès qu’un propriétaire de la SOURCE ouvrira la page de son widget.",
 "recv.big": "{table} : {n} {n|ligne ne peut pas arriver|lignes ne peuvent pas arriver}, plus {n|grosse|grosses} à elle seule que la taille maximale d’un envoi de Grist (1 Mo). Raccourcissez-la dans la SOURCE.",
 "recv.tooBig": "{tables} : trop gros pour le lien public (plus de 2 Mo), rien n’en est lu. Demandez à la SOURCE une invitation, ou un filtre de lignes.",
 "recv.suspect.title": "Arrivées suspectes",
 "recv.suspect.rejected": "{n} {n|ligne rejetée|lignes rejetées} dans le journal, la dernière le {at} : elles ne pouvaient pas venir de la SOURCE de cet export (autre export, contenu illisible). Rien n’a été recopié.",
 "recv.suspect.flood": "Arrivée anormale le {at} : plus de 600 lignes en une minute, traitées par petits lots.",
 "recv.suspect.help": "Quelqu’un d’autre que la SOURCE écrit peut-être avec le lien du formulaire. Si vous ne l’expliquez pas, coupez le lien.",
 "recv.suspect.cut": "Couper le lien",
 "recv.suspect.dismiss": "Effacer l’alerte",
 "recv.cut.title": "Couper le lien du formulaire ?",
 "recv.cut.body": "L’ancien lien n’écrira plus rien dans cette réception, et les envois de la SOURCE échoueront. Pour reprendre, la SOURCE révoque l’ancien destinataire et vous envoie une nouvelle invitation : acceptez-la ici, la même réception reprend avec ses tables et un nouveau formulaire, sur sa propre page.",
 "recv.cut.done": "Lien coupé. Demandez une nouvelle invitation à la SOURCE, et acceptez-la ici.",
 "recv.shared.title": "Lien commun à d’autres formulaires",
 "recv.shared.body": "Le formulaire de cette réception est sur une page qui porte {n} {n|autre formulaire|autres formulaires} : leur lien commun peut aussi écrire dans ce journal. Coupez le lien : cette réception reprendra avec son propre formulaire, sur sa propre page.",
 "recv.relink": "Cet export est déjà reçu ici : la même réception reprend avec cette nouvelle invitation. Copiez le lien du formulaire (il a peut-être changé).",
 "recv.relink.confirm": "« {name} » est déjà reçu dans ce document (journal {journal}). Cette invitation reprend la même réception, avec ses tables : vérifiez qu’elle vient bien de la même personne et du même document.",
 "recv.relink.ok": "Reprendre la réception",
 "recv.offer.title": "Table ajoutée à l’export : {table}",
 "recv.offer.refuseTitle": "Refuser la table {table} ?",
 "recv.offer.refuseBody": "Ses lignes seront effacées à leur arrivée, maintenant et plus tard. Pour la recevoir ensuite, il faudra arrêter la réception et accepter une nouvelle invitation.",
 "recv.offer.body": "« {name} » envoie maintenant la table {table} ({n} {n|ligne|lignes} ; colonnes {cols}).",
 "recv.offer.where": "Table qui recevra les lignes (nouvelle ou existante)",
 "recv.offer.accept": "Recevoir",
 "recv.offer.refuse": "Refuser",
 "recv.offer.line": "Nouvelle table proposée : {table} ({n} {n|ligne|lignes})",
 "recv.offer.place": "Choisir où la ranger",
 "recv.offer.refusedList": "Tables refusées (leurs lignes sont effacées à l’arrivée) : {tables}.",
 "recv.legacy.title": "Réception d’une version précédente",
 "recv.legacy.body": "Ces journaux viennent d’une version précédente du widget : {tables}. La SOURCE doit vous inviter de nouveau à un export ; effacez ensuite les anciens journaux. Vos tables de destination restent.",
 "recv.legacy.clean": "Effacer les anciens journaux",
 "recv.legacy.confirm": "Le widget efface ces anciens journaux et leurs formulaires de réception. Vos tables de destination et leurs lignes restent.",
 "error.codeFormat": "Ce texte n’est pas un code de synchro. Recopiez tout le code, de « GRISTSYNC2. » jusqu’à la fin.",
 "error.codeOld": "Ce code vient d’une version précédente du widget. Demandez une nouvelle invitation.",
 "error.notInvitation": "Ce code est une réponse, pas une invitation.",
 "error.notReply": "Ce code est une invitation, pas une réponse.",
 "error.codeInvalid": "Ce code est incomplet ou modifié.",
 "error.otherInstance": "Le document CIBLE est sur une autre instance Grist : l’envoi est refusé.",
 "error.alreadyReceived": "Cet export est déjà reçu dans ce document, par lien public ou depuis un autre document : arrêtez d’abord cette réception.",
 "error.unknownInvitation": "Cette réponse ne correspond à aucune invitation en attente de ce document, ou son secret est différent.",
 "error.mapTwice": "Deux colonnes envoyées vont dans la même colonne.",
 "error.matchUnmapped": "La colonne de rattachement doit recevoir une colonne envoyée.",
 "error.publicClosed": "Le document SOURCE n’est plus lisible par lien public.",
 "error.noColumn": "Cochez au moins une colonne par table.",
 "error.loop": "Boucle refusée : une table reçue ne peut pas être renvoyée au document d’où elle vient, ni une table vers elle-même. Ce serait une synchro dans les deux sens. Le relais vers un autre document, lui, est possible.",
 "error.destTaken": "Deux tables reçues ont le même nom de destination, cette destination reçoit déjà une synchro, ou ce nom est réservé au widget : choisissez un autre nom.",
 "error.destExported": "Ce document envoie déjà cette table dans un export : elle ne peut pas aussi en recevoir une (ses lignes seraient effacées). Choisissez une autre table.",
 "error.ownerOnly": "Seul un propriétaire du document peut faire cela.",
 "error.destMissing": "La table {dest} n’existe plus.",
 "error.gristTooOld": "Cette instance Grist ne sait pas filtrer un webhook par export (il faut Grist 1.7.11 ou plus récent). Rien n’a été branché.",
 "error.queueStuck": "La file d’envoi ne se vide pas : un destinataire ne reçoit plus. Voyez l’erreur sur sa ligne, puis réessayez.",
 "error.tooLarge": "Un envoi dépasse la taille permise par Grist (1 Mo). Le widget vide la file et renvoie tout de lui-même : gardez cette page ouverte.",
 "error.formLink": "Ce lien n’a pas la forme attendue : https://<instance>/o/<équipe>/forms/<clé>/<numéro>.",
 "error.exchangeOwner": "Un Échange crée aussi un envoi depuis ce document : il faut en être propriétaire.",
 "error.linkTest": "Le lien ne fonctionne pas ({detail}). Vérifiez que le formulaire est publié et que le document est dans un espace d’équipe.",
 "error.linkElsewhere": "Ce lien n’écrit pas dans le journal de cette réception (formulaire d’une autre réception, ou d’un autre document). Copiez le lien du formulaire indiqué ci-dessus.",
 "error.generic": "Erreur : {detail}",
 "start.outside": "Ce widget s’ouvre dans Grist : ajoutez-le comme widget personnalisé « Constructeur » avec l’accès complet.",
 "start.access": "Le widget a besoin de l’accès complet au document : dans le panneau de droite, cliquez sur « Accepter », ou choisissez « Accès complet au document » dans « Niveau d’accès ».",
 "start.slow": "Grist ne répond pas au widget. Vérifiez qu’il a l’accès complet au document (panneau de droite : « Accepter », ou « Accès complet au document » dans « Niveau d’accès »), puis rechargez la page. Si cela dure, vérifiez votre connexion.",
 "start.network": "Le widget ne peut pas charger l’API de Grist depuis {origin} : le réseau la bloque, ou cette instance n’est pas dans la liste du widget.",
 "start.failed": "Le widget n’a pas pu lire le document. {detail} Rechargez la page.",
 "start.reload": "Recharger la page"
};
const en = {
 "app.title": "Sync",
 "tab.send": "Send",
 "tab.receive": "Receive",
 "settings.title": "Settings",
 "settings.lang": "Language",
 "settings.theme": "Theme",
 "settings.theme.system": "System",
 "settings.theme.light": "Light",
 "settings.theme.dark": "Dark",
 "settings.credits": "Credits",
 "settings.credits.author": "Author",
 "settings.credits.site": "Website",
 "settings.credits.license": "License",
 "settings.credits.version": "Version",
 "common.close": "Close",
 "common.cancel": "Cancel",
 "common.copy": "Copy",
 "common.save": "Save",
 "common.copied": "Copied",
 "common.next": "Continue",
 "common.filter": "Filter",
 "common.none": "No result",
 "common.readonly": "Read only: an editor must open this page for actions to be available.",
 "common.back": "Back",
 "common.later": "Later",
 "common.ownerOnly": "Document owners only.",
 "common.code": "Code",
 "common.filterIn": "Filter: {name}",
 "common.choose": "— Choose —",
 "common.blank": "(empty)",
 "common.yes": "yes",
 "common.no": "no",
 "type.Text": "Text",
 "type.Numeric": "Numeric",
 "type.Int": "Integer",
 "type.Bool": "Toggle",
 "type.Date": "Date",
 "type.DateTime": "Date and time",
 "type.Choice": "Choice",
 "type.ChoiceList": "Choice list",
 "type.Ref": "Reference",
 "type.RefList": "Reference list",
 "type.Attachments": "Attachments",
 "type.Any": "Any",
 "home.title": "What do you want to do in this document?",
 "guide.title": "Who does what?",
 "guide.you": "you",
 "guide.role.source": "SOURCE",
 "guide.role.target": "TARGET",
 "guide.s1": "Installs the widget, Send: creates an export (its tables and their columns), then “Add a recipient” and sends the invitation code to the TARGET.",
 "guide.t1": "Installs the widget, Receive, “Accept an invitation”: pastes the code, picks where each table goes.",
 "guide.t2": "Opens the form’s page, shown at the bottom of the page list: Share, Copy link. Pastes that link in the widget (one link for the whole export), then sends the reply code back to the SOURCE.",
 "guide.s2": "On the export card, invitation line: “Paste the reply”, checks who accepted, “Approve and connect”, then “Send” the existing rows.",
 "guide.t3": "Opens the widget page now and then: rows are copied into the tables while the page is open. A table added to the export later is offered there in a dialog.",
 "guide.p.s1": "Installs the widget, Send: creates an export, “Add a recipient”, Public link mode. Sends the code, then in Share sets “Public link” to Viewer.",
 "guide.p.t1": "Installs the widget, Receive, “Accept an invitation”: pastes the code, picks the destinations. Reading happens while the page is open, every 10 seconds.",
 "guide.e.s1": "Installs the widget, Send: creates an export, “Add a recipient”, Exchange mode. Copies the link of the return form, published on its own page at the bottom of the page list, then sends the invitation code to the TARGET.",
 "guide.e.t1": "Installs the widget in a document they own, Receive, “Accept an invitation”: pastes the code, picks where each table goes.",
 "guide.e.t3": "Each document opens the widget page now and then: each copies, while the page is open, what the other changed. The most recent change wins.",
 "guide.publicNote": "In public link mode, one code is enough: the TARGET has no reply to send back.",
 "guide.install": "Install: in the document, add a Custom Widget Builder widget with the same HTML and JavaScript code, and accept full access.",
 "guide.copyHandoff": "Copy with instructions",
 "guide.copyHandoff.help": "The code and the other document’s steps, ready to paste in an email.",
 "guide.handoff.target": "Hello, I would like to share tables of my Grist document with you. In your Grist document (you need edit rights):",
 "guide.handoff.source": "Hello, here is my reply to your Grist sync invitation. In your document:",
 "guide.handoff.code": "Code:",
 "home.send": "Send tables",
 "home.send.desc": "This document is the SOURCE: its rows are copied into another document.",
 "home.receive": "Receive tables",
 "home.receive.desc": "This document is the TARGET: it receives and maintains an editable copy.",
 "send.empty": "No export yet. An export groups tables and the chosen columns; you then add the people who receive it.",
 "send.new": "New export",
 "send.step.tables": "Tables",
 "send.step.columns": "Columns",
 "send.step.name": "Name",
 "send.step.options": "Options",
 "send.step.invitation": "Invitation",
 "send.step.reply": "Reply",
 "send.step.load": "Sending",
 "send.tables.help": "Tick the tables of the export.",
 "send.edit.tables": "Tick the tables of the export. An added table is offered to each recipient, who picks where it goes.",
 "send.edit.removed": "No longer sent: {tables}. What recipients already received stays with them.",
 "send.columns.help": "By default, all columns and all rows are sent. Narrow them down if needed: the rest never leaves the document. A Reference is sent as the text it shows.",
 "send.columns.relay": "Table received from another document: the widget relays it as received. Rows you add here by hand stay here, they are not sent.",
 "send.columns.blocked": "Cannot be sent (attachments): {cols}.",
 "send.columns.all": "All columns ({n})",
 "send.columns.some": "{n} of {total} {total|column|columns}",
 "send.rows.all": "all rows",
 "send.rows.filtered": "rows where {column} is “{value}”",
 "send.columns.pick": "Choose columns",
 "send.rows.pick": "Filter rows",
 "send.lastOk": "Last delivery accepted by the recipient: {at}",
 "send.secret.help": "The secret proves the reply comes from someone who received the invitation. Without it, you approve on the recipient’s details alone.",
 "send.backOptions.title": "Back to the options?",
 "send.backOptions.body": "The current invitation is cancelled: its code will no longer work. You will create a new one, to send instead.",
 "send.newCode.title": "Make the invitation code again?",
 "send.newCode.body": "The widget keeps neither the code nor its secret: it makes a new one, and the old one will no longer work. Send the new one instead.",
 "send.newCode.ok": "Make a new code",
 "send.reply.ready": "I have the reply",
 "send.connected": "Connected: additions, changes and deletions now go out on their own.",
 "send.done": "Existing rows sent.",
 "send.name": "Export name",
 "send.name.help": "Recipients see this name.",
 "send.create": "Create the export",
 "send.created": "Export “{name}” created.",
 "send.created.next": "Now add the first person who receives it. From the export card, you can add others or revoke a single one.",
 "send.edit.title": "Edit “{name}”",
 "send.edit.saved": "Saved: {n} {n|row was|rows were} sent to the recipients.",
 "send.edit.savedNone": "Saved.",
 "send.export.table": "{table} ({n} {n|column|columns})",
 "send.export.tableFiltered": "{table} ({n} {n|column|columns}, rows where {col} = \"{value}\")",
 "send.filter.title": "Rows of {table} to send",
 "send.filter.all": "All rows",
 "send.filter.value": "Value of the rows of {table} to send",
 "send.filter.help": "Only rows where this column is exactly this text are sent (case ignored). A row that leaves the filter is deleted at the recipients.",
 "send.filter.bool": "Checkbox: type \"yes\" or \"no\". A row that leaves the filter is deleted at the recipients.",
 "send.export.partial": "A delivery is not finished (big change, many deletions, interrupted resend): the widget is sending the rest. Keep this page open until it is done.",
 "send.export.lost": "Table not found (renamed or deleted): {tables}. Its rows are no longer sent. Give it back its name, or remove it from the export (Edit).",
 "send.export.drift": "Columns changed since the export (renamed, deleted or of another type): {cols}. They are no longer sent correctly: tick the right columns again (Edit).",
 "send.export.nobody": "Nobody receives this export yet.",
 "send.action.addPerson": "Add a recipient",
 "send.action.edit": "Edit",
 "send.action.delete": "Delete",
 "send.delete.title": "Delete the export “{name}”?",
 "send.delete.body": "Deliveries stop for {n} {n|recipient|recipients}. What they already received stays with them. The id_sync and MajLe columns stay in your tables.",
 "send.person.title": "Add a recipient to “{name}”",
 "send.person.tables": "Tables of the export: {tables}.",
 "send.mode": "Mode",
 "send.mode.others": "Other modes",
 "send.mode.reply": "One way (recommended): your changes go to the recipient, who sends you back a reply code",
 "send.mode.public": "Public link: a single code, the recipient reads the export without replying (publishable data)",
 "send.mode.publicDone": "Public link: already open for this export (Code button on its card)",
 "send.mode.echange": "Both ways (Exchange): their changes also come back here, the most recent one wins",
 "send.mode.echange.help": "Both documents keep each other up to date. Deleting a row only deletes it on one side: tick its Supprime box to delete it on both. An Exchange links two documents: the export has no other recipient, and the recipient must own their document.",
 "send.mode.echange.off": "Both ways (Exchange): only for an export with no recipient nor invitation, and no public link",
 "send.back.title": "Return form link",
 "send.back.help": "The recipient’s changes will arrive here through a return form, published {where}. Copy its link and paste it here: it goes into the invitation, and only the recipient can use it.",
 "send.back.again": "Make the code again",
 "send.back.resume": "Resume",
 "send.exchange.single": "An Exchange links two documents: no other recipient.",
 "send.exchange.managed": "Exchange received from another document: it is managed from the Receive tab. Deleting it stops the Exchange.",
 "send.exchange.with": "Exchange: this recipient’s changes come back into your tables.",
 "send.exchange.map": "{dest} ↔ {table}",
 "send.public.warn": "The widget adds access rules: anyone who is only a viewer of the document (including the public link) will only see the public exports, nothing else. Then, in Share, set “Public link” to Viewer. Avoid for data that must not be public.",
 "send.public.label": "public link",
 "send.public.turnOn": "To do: in the document Share menu, set “Public link” to Viewer.",
 "send.public.code": "Code",
 "send.public.help": "Send this code: it is all the recipient needs. It holds no data.",
 "send.public.revokeBody": "Viewers will no longer see this export. Also turn off the public link in Share if it is no longer used: while it stays on, the widget keeps the rule that hides the rest of the document.",
 "send.public.stop": "Close the public link",
 "send.charge.wait": "Resends spaced out to spare the server: the rest leaves around {at}. Ordinary changes always leave.",
 "send.charge.busy": "A resend is running from another page or another person: it carries on by itself.",
 "send.public.tooBig": "Too large for the public link (over 2 MB): {tables}. The public link gives nothing of it; invite the person instead (webhook), or filter the rows.",
 "send.public.stopTitle": "Close the public link of “{name}”?",
 "send.check.missing": "When creating the export, the widget will add: {items}.",
 "send.check.sync": "the Synchro technical table (one for all exports)",
 "send.secret": "Protect the invitation with a secret (recommended)",
 "send.secret.on": "with secret",
 "send.secret.off": "without secret",
 "send.invite": "Create the invitation",
 "send.invite.help": "Give this code to the person managing the TARGET document. They paste it in this widget, “Receive” tab, then send you back a reply code.",
 "send.invite.pending": "Invitation of {at}",
 "send.reply": "Paste the reply",
 "send.reply.title": "Recipient’s reply",
 "send.reply.help": "Paste the reply code received from the TARGET document.",
 "send.reply.check": "Check",
 "send.reply.tables": "Tables",
 "send.reply.email": "Accepted by",
 "send.reply.doc": "Document",
 "send.reply.team": "Team",
 "send.reply.at": "On",
 "send.reply.approve": "Approve and connect",
 "send.reply.nosecret": "This invitation has no secret, so check the details before approving.",
 "send.reply.sameDoc": "this document",
 "send.load.body": "Connecting only sends future changes. Send {n} {n|existing row|existing rows} now?",
 "send.load.ok": "Send",
 "send.load.empty": "The tables are empty for now: rows will go out as soon as they are added.",
 "send.load.progress": "Sending: {done} of {total}…",
 "send.load.done": "Resend finished: {n} {n|row|rows} resent.",
 "send.load.queued": "Another resend is running for this document (another page or another person): this one is noted, and will leave by itself afterwards, while a widget page stays open.",
 "send.load.nobody": "No connected recipient: nothing to resend.",
 "send.load.background": "You can close this window: sending carries on while the page stays open, and otherwise resumes the next time an owner opens the widget.",
 "send.status.invited": "Waiting for reply",
 "send.status.people": "{n} {n|recipient|recipients}",
 "send.status.alone": "No recipient",
 "send.status.legacy": "To redo",
 "send.cancel.title": "Withdraw this invitation?",
 "send.cancel.body": "Its code can no longer be accepted.",
 "send.status.public": "Public",
 "send.status.publicOff": "Public link to turn on",
 "send.status.active": "Active",
 "send.status.paused": "Paused",
 "send.status.error": "Error",
 "send.waiting": "{n} {n|pending delivery|pending deliveries}",
 "send.action.load": "Resend all",
 "send.action.pause": "Pause",
 "send.action.resume": "Resume",
 "send.resume.title": "Resume “{name}”",
 "send.resume.catchup": "Catch up on changes made during the pause (recommended)",
 "send.resume.catchup.help": "Sends {n} {n|row|rows} added or changed during the pause, and the deletions. The rest of the table is not sent again.",
 "send.resume.all": "The pause time is unknown, or the columns changed during the pause: the whole export is sent.",
 "send.resume.asIs": "Resume without catching up",
 "send.resume.asIs.help": "Only future changes are sent. Rows added, changed or deleted during the pause will not reach the TARGET unless they change again (or with “Resend all”).",
 "send.action.unblock": "Unblock the queue",
 "send.action.revoke": "Revoke",
 "send.action.cancel": "Withdraw the invitation",
 "send.revoke.title": "Revoke “{name}”?",
 "send.revoke.body": "Deliveries stop for this person only; other recipients go on. What they already received stays with them.",
 "send.revoke.exchange": "The Exchange stops: your changes no longer go out, theirs no longer come back (the return log is deleted). Tables keep their rows, on both sides.",
 "send.unblock.title": "Unblock the delivery queue?",
 "send.unblock.body": "The delivery queue is shared by the whole document: its pending deliveries are dropped, then the widget resends the exports on its own (keep this page open). If someone no longer receives, revoke or pause them first, or the queue will get stuck again.",
 "send.unsafe.title": "Unfiltered delivery",
 "send.unsafe.body": "These deliveries (Grist webhooks) read the Synchro table without an export filter: they would receive every export. Delete them: {who}.",
 "send.unsafe.delete": "Delete these deliveries",
 "send.unsafe.confirm": "These deliveries are deleted from Grist. Their recipients no longer receive anything.",
 "send.error.size": "Delivery too big for Grist (over 1 MB): the widget clears the queue and resends everything on its own. Keep this page open.",
 "send.error.column": "This person’s journal refuses a sent column: ask them to open their widget page, which updates their journal. Delivery then resumes on its own.",
 "send.error.link": "This person’s receiving link no longer works (reception stopped, link cut or form unpublished): revoke them, then invite them again.",
 "send.error.other": "This person no longer receives: while the delivery fails, the document’s delivery queue is blocked for everyone.",
 "send.error.detail": "Details: {detail}",
 "send.legacy.title": "Setup from a previous version",
 "send.legacy.body": "These technical tables come from a previous version of the widget: {tables}. Recreate your shares as exports, then delete the old setup.",
 "send.legacy.clean": "Delete the old setup",
 "send.legacy.confirm": "The widget deletes the old webhooks and technical tables. Recipients of the old setup receive nothing until they accept an invitation to an export.",
 "recv.empty": "No export received. Paste an invitation received from the SOURCE document.",
 "recv.new": "Accept an invitation",
 "recv.invite.title": "Invitation received",
 "recv.invite.help": "Paste the invitation code sent by the SOURCE document.",
 "recv.invite.summary": "“{name}”: {n|table|tables} {tables}.",
 "recv.dest": "Where to store each received table: a new table, or a table of this document.",
 "recv.step.code": "Code",
 "recv.step.dest": "Destinations",
 "recv.step.link": "Link",
 "recv.step.reply": "Reply",
 "recv.from": "Data from {from}",
 "recv.fromDoc": "Data from {from}, document {doc}",
 "recv.link.ok": "The link works.",
 "recv.action.continue": "Continue",
 "recv.history.since": "Since your last visit",
 "recv.history.last": "Latest changes",
 "recv.history.n.ajout": "{n} added",
 "recv.history.n.modif": "{n} changed",
 "recv.history.n.suppression": "{n} deleted",
 "recv.history.n.colonne": "{n} {n|column added|columns added}",
 "recv.history.colonne": "added by the SOURCE",
 "recv.history.colLabel": "Column “{col}”",
 "recv.history.more": "and {n} more",
 "recv.history.none": "No change since your last visit.",
 "recv.history.ajout": "added",
 "recv.history.modif": "changed",
 "recv.history.suppression": "deleted",
 "recv.history.before": "Before",
 "recv.history.after": "After",
 "recv.history.row": "Row {n} of the table",
 "recv.history.rowGone": "Row {n} of the table, before it was deleted",
 "recv.drift.title": "{dest}: {n} {n|change|changes} made by hand here",
 "recv.drift.body": "{n|It stays|They stay} until the SOURCE changes the same row. “Fix” puts the exact SOURCE state back now.",
 "recv.drift.row": "Row",
 "recv.drift.col": "Column",
 "recv.drift.here": "Here",
 "recv.drift.source": "SOURCE",
 "recv.drift.fix": "Fix",
 "recv.drift.fixTitle": "Put the SOURCE values back in {dest}?",
 "recv.drift.fixBody": "{n} {n|change made by hand here is replaced|changes made by hand here are replaced} by the exact SOURCE state.",
 "recv.drift.fixRows": "{n} {n|row deleted here comes|rows deleted here come} back, at the end of the table.",
 "recv.drift.fixCols": "{n} {n|column deleted here is|columns deleted here are} created again.",
 "recv.drift.rowGone": "Row deleted here, still in the SOURCE",
 "recv.drift.colGone": "Column deleted here, still sent by the SOURCE",
 "recv.label.change": "Change the displayed column",
 "recv.label.title": "Displayed column",
 "recv.label.help": "Column that names each row in the history, per table.",
 "recv.create": "Create the tables",
 "recv.existing": "Choose the column receiving each sent column. The widget adds new columns and a hidden id_sync key.",
 "recv.dest.new": "New table",
 "recv.dest.name": "Name of the new table for {table}",
 "recv.dest.nameLabel": "Name of the new table",
 "recv.dest.from": "Received table",
 "recv.dest.to": "Store in",
 "recv.undo.title": "Back to the destinations?",
 "recv.undo.body": "This reception’s journal and its form are deleted, with its write link; so are the tables it created, if they are still empty. You will choose again where to store each table.",
 "recv.col.new": "New column “{col}”",
 "recv.match": "Attach existing rows by column",
 "recv.match.none": "Do not attach",
 "recv.match.help": "An existing row whose value in this column equals a received row is updated instead of duplicated. Other existing rows are never touched.",
 "recv.link.title": "Form link",
 "recv.link.help": "A receiving form was just published {where}. Copy its link and paste it here: it works for every table of the export.",
 "recv.link.step1": "1. Open the form’s page and click “Share” in its card.",
 "recv.link.step2": "2. Click “Copy link”, then paste it below.",
 "recv.link.where": "on its own page, at the bottom of the page list",
 "recv.link.where.page": "on page “{page}”, in the page list (open it)",
 "recv.link.check": "Test the link",
 "recv.reply.help": "Send this code back to the person who invited you: they paste it in their widget to connect the feed.",
 "recv.status.waiting": "Waiting for the link",
 "recv.status.ok": "Up to date",
 "recv.status.error": "Error",
 "recv.status.incomplete": "Incomplete",
 "recv.status.ended": "Cut by the SOURCE",
 "recv.ended": "The SOURCE cut this feed on {at} (revoked, export deleted or Exchange stopped): nothing more will arrive. Tables keep their rows; “Stop receiving” removes the journal and its form.",
 "recv.sync.none": "Nothing new: everything is up to date.",
 "recv.consent": "If you continue, the widget creates in this document the new destination tables (or adds their columns and a hidden id_sync key to existing tables), a technical journal for this export, and its receiving form, on its own page.",
 "recv.consent.public": "If you continue, the widget creates in this document the new destination tables (or adds their columns and a hidden id_sync key to existing tables) and a technical journal without a page for this export.",
 "recv.consent.echange": "Exchange: your changes to these tables will go back to the SOURCE document, the most recent one winning. The widget adds the MajLe and RecalculLe columns to the destination tables and creates a return export (Send tab). Deleting a row only deletes it here: tick its Supprime box to delete it on both sides.",
 "recv.exchange": "Exchange: your changes to these tables go back to that document.",
 "recv.action.sync": "Synchronize",
 "recv.action.link": "Redo the link",
 "recv.public": "Public link: read again while this page is open, only when the export changes.",
 "recv.public.done": "Connected: the widget reads the SOURCE while this page is open.",
 "recv.action.stop": "Stop receiving",
 "recv.stop.title": "Stop receiving “{name}”?",
 "recv.stop.body": "The widget deletes the journal {journal} and its receiving form, with its write link: the SOURCE deliveries will fail and it will have to revoke. Destination tables and their rows stay.",
 "recv.result": "{added} added, {updated} updated, {removed} removed",
 "recv.result.none": "Nothing to do",
 "recv.auto": "Updated automatically while this page is open: every 10 seconds, every minute when nothing arrives.",
 "recv.missing": "{table}: {n} {n|row has|rows have} not arrived yet (change too big for one delivery). They will leave on their own as soon as an owner of the SOURCE opens its widget page.",
 "recv.big": "{table}: {n} {n|row|rows} cannot arrive, each larger than the maximum size of a Grist send (1 MB). Shorten it in the SOURCE.",
 "recv.tooBig": "{tables}: too large for the public link (over 2 MB), nothing of it is read. Ask the SOURCE for an invitation, or a row filter.",
 "recv.suspect.title": "Suspicious arrivals",
 "recv.suspect.rejected": "{n} {n|row|rows} rejected in the journal, the last on {at}: they could not come from this export’s SOURCE (other export, unreadable content). Nothing was copied.",
 "recv.suspect.flood": "Abnormal arrival on {at}: more than 600 rows in a minute, processed in small batches.",
 "recv.suspect.help": "Someone other than the SOURCE may be writing with the form link. If you cannot explain it, cut the link.",
 "recv.suspect.cut": "Cut the link",
 "recv.suspect.dismiss": "Clear the alert",
 "recv.cut.title": "Cut the form link?",
 "recv.cut.body": "The old link will write nothing more into this reception, and the SOURCE’s sends will fail. To resume, the SOURCE revokes the old recipient and sends you a new invitation: accept it here, the same reception resumes with its tables and a new form, on its own page.",
 "recv.cut.done": "Link cut. Ask the SOURCE for a new invitation, and accept it here.",
 "recv.shared.title": "Link shared with other forms",
 "recv.shared.body": "This reception’s form is on a page holding {n} other {n|form|forms}: their shared link can also write into this journal. Cut the link: this reception will resume with its own form, on its own page.",
 "recv.relink": "This export is already received here: the same reception resumes with this new invitation. Copy the form link (it may have changed).",
 "recv.relink.confirm": "“{name}” is already received in this document (journal {journal}). This invitation resumes the same reception, with its tables: check that it comes from the same person and the same document.",
 "recv.relink.ok": "Resume the reception",
 "recv.offer.title": "Table added to the export: {table}",
 "recv.offer.refuseTitle": "Refuse the table {table}?",
 "recv.offer.refuseBody": "Its rows will be deleted on arrival, now and later. To receive it afterwards, you will have to stop receiving and accept a new invitation.",
 "recv.offer.body": "“{name}” now sends the table {table} ({n} {n|row|rows}; columns {cols}).",
 "recv.offer.where": "Table receiving the rows (new or existing)",
 "recv.offer.accept": "Receive",
 "recv.offer.refuse": "Refuse",
 "recv.offer.line": "New table offered: {table} ({n} {n|row|rows})",
 "recv.offer.place": "Choose where it goes",
 "recv.offer.refusedList": "Refused tables (their rows are deleted on arrival): {tables}.",
 "recv.legacy.title": "Receiving from a previous version",
 "recv.legacy.body": "These journals come from a previous version of the widget: {tables}. The SOURCE must invite you again to an export; then delete the old journals. Your destination tables stay.",
 "recv.legacy.clean": "Delete the old journals",
 "recv.legacy.confirm": "The widget deletes these old journals and their receiving forms. Your destination tables and their rows stay.",
 "error.codeFormat": "This text is not a sync code. Copy the whole code, from “GRISTSYNC2.” to the end.",
 "error.codeOld": "This code comes from a previous version of the widget. Ask for a new invitation.",
 "error.notInvitation": "This code is a reply, not an invitation.",
 "error.notReply": "This code is an invitation, not a reply.",
 "error.codeInvalid": "This code is incomplete or altered.",
 "error.otherInstance": "The TARGET document is on another Grist instance: sending is refused.",
 "error.alreadyReceived": "This export is already received in this document, through a public link or from another document: stop that reception first.",
 "error.unknownInvitation": "This reply matches no pending invitation of this document, or its secret differs.",
 "error.mapTwice": "Two sent columns go to the same column.",
 "error.matchUnmapped": "The attach column must receive a sent column.",
 "error.publicClosed": "The SOURCE document can no longer be read by public link.",
 "error.noColumn": "Tick at least one column per table.",
 "error.loop": "Loop refused: a received table cannot be sent back to the document it comes from, nor a table to itself. That would be a two-way sync. Relaying to another document is fine.",
 "error.destTaken": "Two received tables have the same destination name, this destination already receives a sync, or this name is reserved for the widget: choose another name.",
 "error.destExported": "This document already sends this table in an export: it cannot also receive one (its rows would be deleted). Choose another table.",
 "error.ownerOnly": "Only a document owner can do this.",
 "error.destMissing": "The table {dest} no longer exists.",
 "error.gristTooOld": "This Grist instance cannot filter a webhook by export (Grist 1.7.11 or later is needed). Nothing was connected.",
 "error.queueStuck": "The delivery queue does not empty: a recipient no longer receives. See the error on its line, then try again.",
 "error.tooLarge": "A delivery exceeds the size Grist allows (1 MB). The widget clears the queue and resends everything on its own: keep this page open.",
 "error.formLink": "This link does not have the expected form: https://<instance>/o/<team>/forms/<key>/<number>.",
 "error.exchangeOwner": "An Exchange also creates a sending from this document: you must own it.",
 "error.linkTest": "The link does not work ({detail}). Check that the form is published and the document is in a team site.",
 "error.linkElsewhere": "This link does not write into this reception’s journal (another reception’s form, or another document’s). Copy the link of the form named above.",
 "error.generic": "Error: {detail}",
 "start.outside": "This widget opens inside Grist: add it as a Custom Widget Builder widget with full access.",
 "start.access": "The widget needs full access to the document: in the right panel, click “Accept”, or choose “Full document access” under “Access level”.",
 "start.slow": "Grist does not answer the widget. Check that it has full access to the document (right panel: “Accept”, or “Full document access” under “Access level”), then reload the page. If it lasts, check your connection.",
 "start.network": "The widget cannot load the Grist API from {origin}: the network blocks it, or this instance is not in the widget’s list.",
 "start.failed": "The widget could not read the document. {detail} Reload the page.",
 "start.reload": "Reload the page"
};

const TEXTS = { fr, en };

function initialLang() {
  const stored = readPref('lang');
  if (stored === 'fr' || stored === 'en') return stored;
  for (const lang of navigator.languages || []) {
    const short = String(lang).slice(0, 2).toLowerCase();
    if (short === 'fr' || short === 'en') return short;
  }
  return navigator.languages && navigator.languages.length ? 'en' : 'fr';
}

const LANG = initialLang();

// Typographie française : espace insécable avant « : ; ? ! » et à l'intérieur des guillemets, pour
// qu'aucun signe ne commence une ligne.
const frenchSpaces = text => text.replace(/ ([:;?!»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');

// format('fr', 'send.waiting', {n: 3}) -> « 3 envois en attente ». Les nombres s'écrivent à la
// façon de la langue (« 3 000 ») ; les autres valeurs (noms, adresses, détails d'erreur) restent
// telles quelles. Une clé absente d'une langue prend le texte français, puis la clé elle-même.
function format(lang, key, vars = {}) {
  const text = TEXTS[lang][key] ?? TEXTS.fr[key] ?? key;
  const value = (name) => {
    const v = vars[name];
    return typeof v === 'number' ? v.toLocaleString(lang) : v;
  };
  return (lang === 'fr' ? frenchSpaces(text) : text)
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, name, one, many) => {
      const n = Number(vars[name]);
      return (lang === 'fr' ? n <= 1 : n === 1) ? one : many;
    })
    .replace(/\{(\w+)\}/g, (_, name) => (value(name) ?? `{${name}}`));
}

const t = (key, vars) => format(LANG, key, vars);

// Dates et heures à la façon de la langue (millisecondes, ou secondes pour timeText).
const dateText = ms => new Date(ms).toLocaleString(LANG);
const timeText = sec => new Date(sec * 1000).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });

// Type d'une colonne Grist, en clair : « Référence (Villes) », « Date et heure ».
function typeName(type) {
  const [base, target] = String(type || '').split(':');
  const name = t(`type.${base}`) === `type.${base}` ? base : t(`type.${base}`);
  return /^Ref(List)?$/.test(base) && target ? `${name} (${target})` : name;
}

// Textes statiques de index.html : attributs data-i18n (contenu) et data-i18n-label (aria-label
// et title).
function translatePage() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    el.title = t(el.dataset.i18nLabel);
  }
}
return { LANG, format, t, dateText, timeText, typeName, translatePage };
})();

// ===== js/ui.js =====
__M["js/ui.js"] = (() => {
'use strict';
// Briques d'interface communes : construction d'éléments sans innerHTML (aucun texte venu du
// document ou d'un code collé n'est interprété comme du HTML), fenêtres, confirmation, champ à
// copier, liste avec recherche.
const { t } = __M["js/i18n.js"];

// Recherche sans accents ni majuscules : chaque mot tapé doit se trouver dans le libellé.
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const matches = (label, query) => fold(query).split(/\s+/).filter(Boolean).every(w => fold(label).includes(w));

// el('button', {class: 'btn', onclick: fn}, 'Texte') ; les enfants texte passent par textContent,
// les listes d'enfants (imbriquées ou non) sont mises à plat.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (name === 'class') node.className = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const icon = name => el('span', { class: `icon icon-${name}`, 'aria-hidden': 'true' });

function message(kind, text) {
  return el('p', { class: `msg msg-${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);
}

// ---------------------------------------------------------------------------------------------
// Fenêtres : titre fixe, contenu qui défile, boutons fixes. Le focus entre à l'ouverture,
// tourne dans la fenêtre (Tab), revient à l'élément d'origine à la fermeture ; Échap ferme.

const stack = [];

function openModal({ title, body, buttons = [], width = 480, onClose }) {
  const opener = document.activeElement;
  const titleId = `modal-title-${stack.length}`;
  const footer = el('div', { class: 'modal-footer' });
  const frame = el('div', { class: `modal modal-${width}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    el('h2', { class: 'modal-title', id: titleId }, title),
    el('div', { class: 'modal-body' }, body),
    footer);
  const scrim = el('div', { class: 'scrim' }, frame);
  const modal = {
    frame, footer,
    close(result) {
      scrim.remove();
      stack.splice(stack.indexOf(modal), 1);
      if (opener && opener.focus) opener.focus();
      if (onClose) onClose(result);
    },
    // Un clic à la fois : les boutons restent grisés tant que l'action tourne (un double clic
    // brancherait deux fois le même destinataire).
    setButtons(list) {
      footer.replaceChildren(...list.map(b => el('button', {
        class: `btn ${b.kind || ''}${b.back ? ' btn-back' : ''}`, type: 'button', disabled: b.disabled,
        onclick: e => (b.onClick ? busy(e.currentTarget, () => b.onClick(modal)) : modal.close()),
      }, b.label)));
    },
  };
  async function busy(clicked, fn) {
    const all = [...footer.children];
    const before = all.map(button => button.disabled);
    for (const button of all) button.disabled = true;
    try {
      await fn();
    } finally {
      all.forEach((button, i) => { button.disabled = before[i]; });
      if (clicked.isConnected && !frame.contains(document.activeElement)) clicked.focus();
    }
  }
  modal.setButtons(buttons.length ? buttons : [{ label: t('common.close') }]);
  stack.push(modal);
  document.body.append(scrim);
  (frame.querySelector('textarea, input, select, .btn-primary') || footer.querySelector('button')).focus();
  return modal;
}

document.addEventListener('keydown', (event) => {
  const modal = stack[stack.length - 1];
  if (!modal) return;
  if (event.key === 'Escape') { event.preventDefault(); modal.close(false); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...modal.frame.querySelectorAll('button, input, textarea, select, summary, [tabindex="0"]')]
    .filter(n => !n.disabled && n.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  const inside = modal.frame.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
});

// Assistant : une seule fenêtre, des étapes numérotées qui se débloquent l'une après l'autre.
// `show(index, body, buttons)` affiche une étape ; les précédentes sont marquées faites.
// `buttons(list)` change les boutons seuls ; `setSteps(labels)` raccourcit le parcours (lien public).
function openWizard({ title, steps, onClose }) {
  const stepList = el('ol', { class: 'steps' });
  const content = el('div', { class: 'form' });
  const modal = openModal({ title, body: [stepList, content], onClose, width: 720 });
  let shown = -1;
  return {
    close: () => modal.close(),
    buttons: list => modal.setButtons(list),
    setSteps(labels) { steps = labels; },
    show(index, body, buttons) {
      stepList.replaceChildren(...steps.map((label, i) => el('li', {
        class: i < index ? 'done' : i === index ? 'current' : 'locked', 'aria-current': i === index ? 'step' : null,
      }, el('span', { class: 'step-num', 'aria-hidden': 'true' }, i < index ? icon('check') : String(i + 1)), label)));
      content.replaceChildren(...[body].flat().filter(Boolean));
      modal.setButtons(buttons);
      if (index === shown) return; // même étape redessinée : le focus reste où il est
      shown = index;
      const first = content.querySelector('textarea:not([readonly]), input') || modal.footer.querySelector('.btn-primary');
      if (first) first.focus();
    },
  };
}

// Confirmation d'une action destructrice : promesse d'un booléen, focus sur Annuler.
function confirmDialog({ title, body, confirmLabel }) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title, body: el('p', {}, body), width: 400,
      onClose: () => { if (!answered) resolve(false); },
      buttons: [
        { label: t('common.cancel'), onClick: m => { answered = true; resolve(false); m.close(); } },
        { label: confirmLabel, kind: 'btn-danger', onClick: m => { answered = true; resolve(true); m.close(); } },
      ],
    });
    modal.footer.querySelector('button').focus();
  });
}

// Code en lecture seule avec bouton « Copier ».
function copyField(value, label = t('common.code')) {
  const area = el('textarea', { class: 'code', readonly: true, rows: 3, spellcheck: 'false', 'aria-label': label });
  area.value = value;
  return el('div', { class: 'copy-field' }, area, copyButton(() => value, t('common.copy'), () => area.select()));
}

// Bouton qui copie `text()` dans le presse-papiers ; `onFail` si le navigateur le refuse.
function copyButton(text, label, onFail = () => {}) {
  const button = el('button', { class: 'btn', type: 'button' }, icon('copy'), label);
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text()); } catch (e) { onFail(); return; }
    button.lastChild.textContent = t('common.copied');
    setTimeout(() => { button.lastChild.textContent = label; }, 1500);
  });
  return button;
}

// Liste à cocher, filtrable au clavier (tables, colonnes). `items` : [{ value, label, hint }]
// (`hint` : type de la colonne, en discret). `checked` : valeurs cochées au départ. `onChange`
// reçoit les valeurs cochées, dans l'ordre de la liste. `label` nomme la liste.
function checkList({ items, checked = [], label = '', onChange }) {
  const name = label ? t('common.filterIn', { name: label }) : t('common.filter');
  const filter = el('input', { class: 'search-input', type: 'search', placeholder: t('common.filter'), 'aria-label': name, autocomplete: 'off' });
  const list = el('div', { class: 'check-list', role: 'group', 'aria-label': label || null });
  const chosen = new Set(checked);
  const render = () => {
    const found = items.filter(it => matches(it.label, filter.value));
    list.replaceChildren(...(found.length ? found.map(it => el('label', {},
      el('input', {
        type: 'checkbox', checked: chosen.has(it.value),
        onchange: (e) => { if (e.target.checked) chosen.add(it.value); else chosen.delete(it.value); onChange(items.map(i => i.value).filter(v => chosen.has(v))); },
      }), it.label, it.hint ? el('span', { class: 'hint' }, it.hint) : null)) : [el('p', { class: 'muted small' }, t('common.none'))]));
  };
  filter.addEventListener('input', render);
  render();
  return el('div', { class: 'check-select' }, filter, list);
}

// Choix d'une valeur dans une liste filtrable (tables, colonnes) : un bouton qui affiche le choix
// et ouvre la liste sous lui. `items` : [{ value, label }]. Échap referme la liste seule.
function pickField({ items, value, label, onChange = () => {} }) {
  let current = value;
  const button = el('button', { class: 'btn pick-button', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
  const filter = el('input', { class: 'search-input', type: 'search', placeholder: t('common.filter'), 'aria-label': t('common.filter'), autocomplete: 'off' });
  const list = el('div', { class: 'check-list', role: 'listbox', 'aria-label': label });
  const panel = el('div', { class: 'pick-panel hidden' }, filter, list);
  const field = el('div', { class: 'pick-field' }, button, panel);
  const shown = () => (items.find(it => it.value === current) || items[0] || { label: t('common.choose') }).label;
  // Le bouton dit le choix ; son nom accessible dit aussi le champ.
  const showChoice = () => { button.textContent = shown(); button.setAttribute('aria-label', `${label} : ${shown()}`); };
  const toggle = (open) => {
    panel.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) { filter.value = ''; render(); filter.focus(); } else button.focus();
  };
  const choose = (v) => { current = v; showChoice(); toggle(false); onChange(v); };
  function render() {
    const found = items.filter(it => matches(it.label, filter.value));
    list.replaceChildren(...(found.length ? found.map(it => el('button', {
      class: 'pick-option', type: 'button', role: 'option', 'aria-selected': String(it.value === current), onclick: () => choose(it.value),
    }, it.label)) : [el('p', { class: 'muted small' }, t('common.none'))]));
  }
  showChoice();
  button.addEventListener('click', () => toggle(panel.classList.contains('hidden')));
  filter.addEventListener('input', render);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) { e.stopPropagation(); toggle(false); }
    if (e.key === 'Enter' && e.target === filter) { e.preventDefault(); const first = list.querySelector('.pick-option'); if (first) first.click(); }
  });
  field.value = () => current;
  return field;
}

// Texte d'une erreur pour la personne : celui de sa clé (`error.<message>`), sinon une phrase
// générique avec le détail technique.
const known = e => t(`error.${e.message}`) !== `error.${e.message}`;
const errorText = e => (known(e) ? t(`error.${e.message}`) : t('error.generic', { detail: e.message || String(e) }));

// Exécute une action d'un bouton : le bouton est grisé pendant l'opération, l'erreur affichée
// dans `out` (élément qui reçoit le message).
async function run(button, out, fn) {
  if (button) button.disabled = true;
  if (out) out.replaceChildren();
  try {
    return await fn();
  } catch (e) {
    if (!known(e)) console.error(e); // une erreur prévue (code mal copié, lien refusé) n'est qu'un message
    if (out) out.replaceChildren(message('err', errorText(e)));
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}
return { el, icon, message, openModal, openWizard, confirmDialog, copyField, copyButton, checkList, pickField, errorText, run };
})();

// ===== js/form-link.js =====
__M["js/form-link.js"] = (() => {
'use strict';
// Lien du formulaire de réception d'un journal (CIBLE, ou retour d'un Échange côté SOURCE) : où le
// trouver, comment le copier, et le test qui vérifie qu'il écrit bien dans ce journal.
const { AUTHOR_COL, KEY_COL, randomHex } = __M["js/logic/common.js"];
const { maskKey } = __M["js/logic/codes.js"];
const { fetchRows, gristFetch, selectRows, withLock } = __M["js/grist.js"];
const { formPages } = __M["js/pages.js"];
const { el } = __M["js/ui.js"];
const { t } = __M["js/i18n.js"];

// Où est le formulaire d'un journal.
async function formWhere(journal) {
  const page = (await formPages()).get(journal);
  return page ? t('recv.link.where.page', { page: page.name }) : t('recv.link.where');
}

// Les deux étapes pour copier le lien (texte seul).
const linkFigures = () => ['recv.link.step1', 'recv.link.step2'].map(key => el('p', { class: 'small' }, t(key)));

// Le lien écrit-il dans ce journal-ci ? Une ligne marquée d'un nombre tiré au hasard part par la
// clé, comme le fera le webhook (ce qui valide d'un coup la clé, la publication, le nom de la table
// et `?flat=1`), et doit arriver dans `journal`. Le lien d'un autre formulaire ou d'un autre
// document est refusé : la réponse enverrait les données ailleurs. Le nettoyage du journal efface
// la ligne ; le verrou de la recopie l'en empêche avant la vérification. Écriture anonyme en JSON :
// l'en-tête Content-Type suffit à Grist.
function testUrl(url, journal) {
  const probe = randomHex(8);
  return withLock('gristsync-consolidation', async () => {
    let response;
    try {
      response = await gristFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ [KEY_COL]: '', [AUTHOR_COL]: probe }]) });
    } catch (e) {
      throw new Error(t('error.linkTest', { detail: e.message }));
    }
    const text = await response.text();
    if (!response.ok) throw new Error(t('error.linkTest', { detail: maskKey(`HTTP ${response.status} ${text.slice(0, 120)}`) }));
    const rows = (await selectRows(journal, [AUTHOR_COL])) || await fetchRows(journal);
    if (!rows.some(r => r[AUTHOR_COL] === probe)) throw new Error('linkElsewhere');
  });
}
return { formWhere, linkFigures, testUrl };
})();

// ===== js/guide.js =====
__M["js/guide.js"] = (() => {
'use strict';
// Mode d'emploi à deux rôles : qui fait quoi, dans quel document. Affiché sur l'accueil et en bas
// des assistants, pour que chacun sache ce qu'il fait et ce que l'autre document doit faire, et
// texte de consignes à transmettre avec un code.
const { t } = __M["js/i18n.js"];
const { copyField, el } = __M["js/ui.js"];

// Étapes de chaque mode, dans l'ordre : [rôle, clé du texte].
const STEPS = {
  reponse: [['source', 'guide.s1'], ['target', 'guide.t1'], ['target', 'guide.t2'], ['source', 'guide.s2'], ['target', 'guide.t3']],
  public: [['source', 'guide.p.s1'], ['target', 'guide.p.t1']],
  echange: [['source', 'guide.e.s1'], ['target', 'guide.e.t1'], ['target', 'guide.t2'], ['source', 'guide.s2'], ['target', 'guide.e.t3']],
};


// `you` : rôle de ce document ('source', 'target' ou null sur l'accueil). `current` : étape en
// cours ou attendue (-1 : aucune). Replié par défaut dans les assistants.
function roleGuide({ you = null, mode = 'reponse', current = -1, open = false }) {
  const steps = STEPS[mode].map(([role, key], i) => el('li', { class: i === current ? 'current' : null },
    el('span', { class: `role-badge role-${role}` }, t(`guide.role.${role}`) + (role === you ? ` · ${t('guide.you')}` : '')),
    el('span', {}, t(key))));
  return el('details', { class: 'guide', open },
    el('summary', {}, t('guide.title')),
    el('ol', { class: 'guide-steps' }, steps),
    mode === 'public' ? null : el('p', { class: 'muted small' }, t('guide.publicNote')),
    el('p', { class: 'small' }, t('guide.install')));
}

// Consignes pour l'autre document (`role`), ses étapes à partir de `from`, à coller dans un
// courriel avec le code.
function handoffText(role, mode, from, code) {
  const lines = STEPS[mode].slice(from).filter(([r]) => r === role).map(([, key], i) => `${i + 1}. ${t(key)}`);
  return [t(`guide.handoff.${role}`), '', ...lines, '', t('guide.install'), '', t('guide.handoff.code'), code].join('\n');
}
return { roleGuide, handoffText };
})();

// ===== js/logic/journal.js =====
__M["js/logic/journal.js"] = (() => {
'use strict';
// CIBLE : le journal d'un export. Le webhook y dépose des lignes de Synchro (« brutes ») ; le widget
// les déplie en une ligne par version ou par liste des clés, puis les recopie (consolidation.js) et
// nettoie le journal.
// Le lien du formulaire permet d'écrire n'importe quoi dans le journal. Chaque réception a sa clé
// (un formulaire par page) : seul l'expéditeur de l'export l'a, et il décide déjà de ce qu'il
// envoie. Une ligne brute qui ne peut pas venir du webhook de cet export est tout de même effacée
// sans effet et comptée, et rien de ce qui est lu ne peut servir de nom propre aux objets JavaScript.
const {
  APPLIED_COL, BEFORE_COL, BUCKETS, DATA_COL, DELETE_COL, EXPORT_COL, KEY_COL, KIND, LIST_COL, LIST_PREFIX, LOT_COL, ORDER_COL, RECEIVED_COL, RESEND_COL,
  SCHEMA_COL, STATE_COL, TABLE_COL, TYPE_COL, chunk, groupBy, isBlank, isSafeId, isTrue, parseJson,
} = __M["js/logic/common.js"];
const { exportSchema, validColumns } = __M["js/logic/codes.js"];

const MAX_LINES = 100000; // lignes par lot, au plus (un envoi fait au plus 1 Mo, un instantané public 2 Mo)
const MAX_BIG = 1000; // clés de lignes trop grosses retenues par table
const MAX_TABLES = 200; // tables suivies dans la note d'un journal

// Ligne telle que déposée par le webhook (ou le lien public) : une liste des clés ou un lot.
const isRaw = row => !isBlank(row[TYPE_COL]);

// Note d'un journal (description de sa colonne Synchro_Ids) : { id, export, name, secret, from,
// mode, base, retour, tables: [{ table, dest, columns, map, match, label, refs }], refused, missing,
// big, tooBig, suspect }. Le journal de retour d'un Échange (`retour`, côté du document qui a
// invité) attend la réponse (`from` encore vide) avant de recopier quoi que ce soit.
const awaitingPartner = note => note.mode === 'echange' && Boolean(note.retour) && !(note.from || {}).docId;

// ---------------------------------------------------------------------------------------------
// Lecture des listes et des lots

// Liste reçue (Synchro_Ids d'une ligne 'cles') : { buckets: { t, keys: Map(seau -> Set(clés)) } }
// pour les seaux qui ont perdu une clé, { part: { mark, n, t, keys, last } } pour un morceau de
// liste complète, les deux à la fois, ou { full: [clés] } pour une liste complète d'un seul tenant
// (« ids:… » : montage 0.4, lien public). null si elle est vide ou illisible.
function parseList(text) {
  const s = String(text || '');
  if (s.startsWith(LIST_PREFIX)) return { full: s.slice(LIST_PREFIX.length).split(' ').filter(Boolean) };
  const list = parseJson(s);
  if (!list || typeof list !== 'object') return null;
  const out = {};
  const buckets = listBuckets(list);
  if (buckets) out.buckets = buckets;
  const p = list.liste;
  if (p && typeof p === 'object' && typeof p.marque === 'string' && p.marque && Number.isInteger(p.n) && p.n > 0 && typeof p.t === 'number') {
    out.part = { mark: p.marque, n: p.n, t: p.t, keys: keyStrings(p.cles), last: p.fin === true };
  }
  return out.buckets || out.part ? out : null;
}

const isKey = k => (typeof k === 'string' || typeof k === 'number') && !isBlank(k);
const keyStrings = a => (Array.isArray(a) ? a.filter(isKey).map(String) : []);

function listBuckets(list) {
  const seaux = list.seaux && typeof list.seaux === 'object' ? Object.entries(list.seaux).filter(([b]) => /^\d+$/.test(b) && Number(b) < BUCKETS) : [];
  return seaux.length && typeof list.t === 'number' ? { t: list.t, keys: new Map(seaux.map(([b, keys]) => [Number(b), new Set(keyStrings(keys))])) } : null;
}

// Lot reçu : { lines: [{ key, order, deleted, data }], total, big, tooBig } ; null s'il est
// illisible. `tooBig` : instantané public trop gros, laissé vide. Une ligne sans clé, sans bloc de
// colonnes, ou dont l'heure n'est ni vide ni un nombre, est écartée.
const validLine = l => Array.isArray(l) && isKey(l[0]) && (l[1] === null || l[1] === undefined || typeof l[1] === 'number')
  && l[3] !== null && typeof l[3] === 'object' && !Array.isArray(l[3]);
function parseLot(text) {
  const lot = parseJson(text);
  if (!lot || !Array.isArray(lot.lignes) || lot.lignes.length > MAX_LINES) return null;
  const lines = lot.lignes.filter(validLine).map(([key, order, deleted, data]) => ({ key: String(key), order: order ?? null, deleted: isTrue(deleted), data }));
  const big = keyStrings(lot.tropGros).slice(0, MAX_BIG);
  return { lines, total: Number(lot.total) || lines.length, big, ...(lot.trop === true ? { tooBig: true } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Dépliage

// Ce que dit une ligne brute : { table, list, text }, { table, lot } ou { end } (la SOURCE a coupé
// cet envoi, voir endNotice), ou null si elle ne peut pas venir de la SOURCE de cet export
// (`exportId`) : autre export, type inconnu, table au nom invalide, liste, lot ou colonnes illisibles.
function readRaw(row, exportId) {
  const table = row[TABLE_COL];
  const cols = isBlank(row[SCHEMA_COL]) ? [] : parseJson(row[SCHEMA_COL]);
  const columnsOk = Array.isArray(cols) && (!cols.length || validColumns(cols));
  if (exportId && row[EXPORT_COL] !== exportId) return null;
  if (row[TYPE_COL] === KIND.end && exportId) return { end: true };
  if (!isSafeId(table) || !columnsOk) return null;
  if (row[TYPE_COL] === KIND.keys) {
    const text = String(row[LIST_COL] || '');
    return !text || parseList(text) ? { table, text } : null;
  }
  const lot = row[TYPE_COL] === KIND.lot ? parseLot(row[LOT_COL]) : null;
  return lot ? { table, lot } : null;
}

// Lignes à ajouter au journal pour une ligne brute lue.
function unpackedRows(row, { table, text, lot }) {
  const base = { [TABLE_COL]: table, [RECEIVED_COL]: row[RECEIVED_COL] ?? null };
  if (!lot) return text || row[SCHEMA_COL] ? [{ ...base, [LIST_COL]: text, [SCHEMA_COL]: row[SCHEMA_COL] || '' }] : [];
  return lot.lines.map((l, i) => ({
    ...base, [KEY_COL]: l.key, [ORDER_COL]: l.order, [DELETE_COL]: l.deleted, [DATA_COL]: JSON.stringify(l.data),
    ...(i === 0 ? { [SCHEMA_COL]: row[SCHEMA_COL] || '' } : {}),
  }));
}

// Dépliage, dans l'ordre d'arrivée : chaque lot devient une ligne par version (clé, date,
// suppression, bloc des colonnes, table d'origine), chaque liste des clés une ligne de liste (qui
// porte aussi la description des colonnes) ; les lignes reçues sont effacées dans le même lot. Les
// nouvelles lignes gardent l'ordre d'arrivée et la date d'arrivée. Rend aussi, par table, les
// lignes qu'un lot coupé n'a pas portées depuis le dernier renvoi (`missing`), les clés des lignes
// trop grosses pour un envoi et celles arrivées (`big`, `arrived`), les tables reçues par un renvoi
// (`resent`), dont le compte précédent ne vaut plus, et le nombre de lignes rejetées (`rejected`).
// `ended` : { at } (heure d'arrivée) si la dernière nouvelle de la SOURCE est la fin de cet envoi,
// null si des données sont arrivées après, absent si ce passage n'en dit rien. Au plus `max` lignes
// reçues par passage, les plus anciennes : les suivantes attendent le passage d'après (`left`).
function planUnpack(journalRows, journalTable, { exportId = null, max = Infinity } = {}) {
  const all = journalRows.filter(isRaw).sort((a, b) => a.id - b.id);
  const raw = all.slice(0, max);
  const added = [];
  const gaps = { missing: new Map(), big: new Map(), arrived: new Map(), resent: new Set() };
  let rejected = 0;
  let ended;
  for (const row of raw) {
    const read = readRaw(row, exportId);
    if (!read) {
      rejected++;
      continue;
    }
    ended = read.end ? { at: typeof row[RECEIVED_COL] === 'number' ? row[RECEIVED_COL] : null } : null;
    if (read.end) continue;
    added.push(...unpackedRows(row, read));
    if (read.lot) noteGaps(gaps, read.table, read.lot, !isBlank(row[RESEND_COL]));
  }
  const cols = [...new Set(added.flatMap(Object.keys))];
  const empty = c => (c === DELETE_COL ? false : c === ORDER_COL || c === RECEIVED_COL ? null : '');
  const actions = chunk(added).map(part => ['BulkAddRecord', journalTable, part.map(() => null),
    Object.fromEntries(cols.map(c => [c, part.map(r => r[c] ?? empty(c))]))]);
  for (const part of chunk(raw.map(r => r.id))) actions.push(['BulkRemoveRecord', journalTable, part]);
  const plain = map => Object.fromEntries(map);
  return {
    actions, missing: plain(gaps.missing), big: plain(gaps.big), arrived: plain(gaps.arrived), resent: [...gaps.resent], rejected, left: all.length - raw.length,
    ...(ended === undefined ? {} : { ended }),
  };
}

// Un renvoi remet le compte de sa table à zéro (la SOURCE recoupe elle-même un lot de renvoi trop
// gros) ; un lot coupé ajoute ce qui manque.
function noteGaps(gaps, table, lot, resent) {
  const add = (map, items) => map.set(table, [...(map.get(table) || []), ...items]);
  if (lot.big.length) add(gaps.big, lot.big);
  add(gaps.arrived, lot.lines.map(l => l.key));
  if (resent) {
    gaps.resent.add(table);
    gaps.missing.set(table, 0);
  } else if (lot.total > lot.lines.length) gaps.missing.set(table, (gaps.missing.get(table) || 0) + lot.total - lot.lines.length);
}

// Ce qui manque encore dans la CIBLE, mis à jour d'après un dépliage : le nombre de lignes pas
// encore arrivées par table (`missing`) et les clés des lignes trop grosses pour un envoi de Grist
// (`big`). Un renvoi remet sa table à zéro ; une ligne arrivée sort de `big`. Une table refusée
// (`refused`) n'est pas suivie, et la note en suit au plus MAX_TABLES.
function nextGaps({ missing = {}, big = {}, refused = [] }, unpack) {
  const nextMissing = new Map(Object.entries(missing));
  const nextBig = new Map(Object.entries(big));
  for (const table of unpack.resent) {
    nextMissing.delete(table);
    nextBig.delete(table);
  }
  for (const [table, n] of Object.entries(unpack.missing)) if (n > 0) nextMissing.set(table, (nextMissing.get(table) || 0) + n);
  for (const table of new Set([...Object.keys(unpack.big), ...Object.keys(unpack.arrived)])) {
    const gone = new Set(unpack.arrived[table] || []);
    const keys = [...new Set([...(nextBig.get(table) || []), ...(unpack.big[table] || [])])].filter(k => !gone.has(k)).slice(0, MAX_BIG);
    if (keys.length) nextBig.set(table, keys);
    else nextBig.delete(table);
  }
  const kept = map => Object.fromEntries([...map].filter(([table]) => !refused.includes(table)).slice(-MAX_TABLES));
  return { missing: kept(nextMissing), big: kept(nextBig) };
}

// ---------------------------------------------------------------------------------------------
// Lignes dépliées

// Versions : (valeur de MajLe, numéro de ligne du journal). Vide = plus ancien ; à égalité
// d'horodatage, la dernière ligne arrivée gagne.
function compareOrder(a, b) {
  if (isBlank(a) || isBlank(b)) return (isBlank(a) ? 0 : 1) - (isBlank(b) ? 0 : 1);
  if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function compareVersion(a, b) {
  return compareOrder(a.order, b.order) || Math.sign((a.id || 0) - (b.id || 0));
}

// Dernière version de chaque clé. Les lignes sans clé (listes, test du lien) sont ignorées.
function latestByKey(journalRows) {
  const latest = new Map();
  for (const row of journalRows) {
    const key = row[KEY_COL];
    if (isBlank(key)) continue;
    const version = { order: row[ORDER_COL], id: row.id, row };
    const current = latest.get(key);
    if (!current || compareVersion(version, current) > 0) latest.set(key, version);
  }
  return latest;
}

// Lignes dépliées du journal, par table d'origine.
const rowsByTable = journalRows => groupBy(journalRows.filter(r => !isRaw(r) && !isBlank(r[TABLE_COL])), r => r[TABLE_COL]);

// Lignes avec leurs colonnes envoyées dépliées (bloc JSON). Une liste devient une ChoiceList au
// format de Grist ; seules les clés qui peuvent être des colonnes sont gardées.
function expandRows(journalRows) {
  return journalRows.map((row) => {
    const payload = isBlank(row[DATA_COL]) ? null : parseJson(row[DATA_COL]);
    if (!payload || typeof payload !== 'object') return row;
    const values = Object.fromEntries(Object.entries(payload).filter(([k]) => isSafeId(k))
      .map(([k, v]) => [k, Array.isArray(v) ? ['L', ...v] : v]));
    return { ...values, ...row };
  });
}

// Dernière ligne qui vérifie `test`, par numéro de ligne.
const lastWhere = (rows, test) => rows.reduce((latest, row) => (test(row) && (!latest || row.id > latest.id) ? row : latest), null);

// Dernière ligne qui porte la description des colonnes (listes, et première version de chaque lot).
const latestSchemaRow = rows => lastWhere(rows, r => !isBlank(r[SCHEMA_COL]));

// Colonnes envoyées, lues dans la dernière description reçue, sinon `fallback` (celles de l'invitation).
function sentColumns(rows, fallback = []) {
  const cols = parseJson((latestSchemaRow(rows) || {})[SCHEMA_COL]);
  return validColumns(cols) ? exportSchema(cols) : fallback;
}

// Dernière liste complète d'un seul tenant reçue (« ids:… », voir parseList).
const latestList = rows => lastWhere(rows, r => String(r[LIST_COL] || '').startsWith(LIST_PREFIX));

// Listes du journal pas encore traitées, dans l'ordre d'arrivée, avec leur contenu lu.
const pendingLists = rows => rows.filter(r => isBlank(r[KEY_COL]) && !isTrue(r[APPLIED_COL]))
  .map(row => ({ row, list: parseList(row[LIST_COL]) })).filter(l => l.list).sort((a, b) => a.row.id - b.row.id);

// Marque du dernier renvoi dont un morceau de liste est arrivé.
const lastMark = pending => (pending.filter(l => l.list.part).pop() || { list: { part: {} } }).list.part.mark;

// Morceaux de liste complète arrivés en entier (du premier au dernier), par renvoi : { rows,
// keys, t } avec l'heure du premier morceau.
function completeLists(pending) {
  const done = [];
  for (const parts of groupBy(pending.filter(p => p.list.part), p => p.list.part.mark).values()) {
    const last = parts.find(p => p.list.part.last);
    const have = new Set(parts.map(p => p.list.part.n));
    if (!last || Array.from({ length: last.list.part.n }, (_, i) => i + 1).some(n => !have.has(n))) continue;
    done.push({ rows: parts.map(p => p.row), keys: new Set(parts.flatMap(p => p.list.part.keys)), t: Math.min(...parts.map(p => p.list.part.t)) });
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// Nettoyage et historique

// Nettoyage du journal, dans le même lot. Restent, par table : la dernière version de chaque clé,
// la dernière liste « ids:… » et la dernière description des colonnes (avec leur marque
// `Sync_Applique`) ; les seaux pas encore traités et les morceaux du dernier renvoi pas encore
// arrivé en entier ; toutes les lignes des tables `keep` (proposées par la SOURCE, pas encore
// rangées) ; les lignes reçues pas encore dépliées ; et la ligne la plus récente, pour que Grist ne
// réutilise pas son numéro. Le reste (versions remplacées, tables `drop` refusées, test du lien)
// disparaît.
function planPurge(journalRows, journalTable, { keep = [], drop = [] } = {}) {
  const kept = new Set(journalRows.filter(isRaw).map(r => r.id));
  for (const [table, rows] of rowsByTable(journalRows)) {
    if (drop.includes(table)) continue;
    if (keep.includes(table)) {
      rows.forEach(r => kept.add(r.id));
      continue;
    }
    for (const v of latestByKey(rows).values()) kept.add(v.id);
    for (const row of [latestList(rows), latestSchemaRow(rows)]) if (row) kept.add(row.id);
    const pending = pendingLists(rows);
    const mark = lastMark(pending);
    for (const { row, list } of pending) if (list.buckets || (list.part && list.part.mark === mark)) kept.add(row.id);
  }
  kept.add(journalRows.reduce((max, r) => Math.max(max, r.id), 0));
  const ids = journalRows.filter(r => !kept.has(r.id)).map(r => r.id);
  return chunk(ids).map(part => ['BulkRemoveRecord', journalTable, part]);
}

// Historique : dernière version de chaque clé recopiée avec un effet connu, arrivée après `since`
// (secondes), la plus récente d'abord, au plus `max`. `labelCol` nomme la ligne ; `n` est son
// numéro dans la destination (`numbers`, voir rowNumbers), celui qu'elle avait pour une ligne
// supprimée ; `detail` montre avant et après sur les colonnes recopiées (`copyCols`).
const STATES = ['ajout', 'modif', 'suppression'];

// Tables à relire parmi celles que Grist dit changées (`changed` ; null : on ne sait pas) : les
// journaux et destinations suivis (`watched`), et le schéma (une table ou une colonne ajoutée,
// effacée). Null : tout relire.
const SCHEMA_TABLES = ['_grist_Tables', '_grist_Tables_column'];
const touchedTables = (changed, watched) => (changed === null ? null
  : [...changed].filter(table => watched.has(table) || SCHEMA_TABLES.includes(table)));
// Une date hors de ce que JavaScript sait écrire (une ligne écrite par la clé du formulaire peut en
// porter une) ferait échouer tout l'onglet : elle n'est pas montrée.
const MAX_TIME_S = 8.64e12;
const validTime = at => Number.isFinite(at) && Math.abs(at) < MAX_TIME_S;
function recentChanges(journalRows, labelCol, since, max, { copyCols = [], numbers = new Map() } = {}) {
  return [...latestByKey(journalRows).values()]
    .map(v => ({ at: v.row[RECEIVED_COL] ?? v.order, state: v.row[STATE_COL], row: v.row }))
    .filter(c => STATES.includes(c.state) && validTime(c.at) && c.at > since)
    .sort((a, b) => b.at - a.at).slice(0, max)
    .map((c) => {
      const was = parseJson(c.row[BEFORE_COL]) || {};
      const gone = c.state === 'suppression';
      const n = gone ? (Number.isInteger(was.n) && was.n > 0 ? was.n : null) : numbers.get(c.row[KEY_COL]) || null;
      return { at: c.at, key: c.row[KEY_COL], label: labelCol ? String(c.row[labelCol] ?? '') : '', state: c.state, n, detail: changeDetail(c.state, c.row, copyCols, was) };
    });
}

// Avant et après d'un changement, sur des colonnes [colonne du journal, colonne d'ici] : un ajout
// montre toutes les colonnes après, une suppression toutes avant (dernière version reçue), une
// modification celles qu'elle a remplacées (`Sync_Avant`). null s'il n'y a rien à montrer.
function changeDetail(state, row, copyCols, was) {
  const values = cols => cols.map(([from]) => row[from] ?? null);
  if (state !== 'modif') return copyCols.length ? { cols: copyCols, before: state === 'ajout' ? null : values(copyCols), after: state === 'ajout' ? values(copyCols) : null } : null;
  const v = was.v && typeof was.v === 'object' && !Array.isArray(was.v) ? was.v : {};
  const cols = copyCols.filter(([from]) => Object.hasOwn(v, from));
  return cols.length ? { cols, before: cols.map(([from]) => v[from]), after: values(cols) } : null;
}

// ---------------------------------------------------------------------------------------------
// Lien public, côté CIBLE : lignes à ajouter au journal pour qu'il reflète les instantanés lus
// (`records` : lignes 'complet' de la table Synchro, lues par l'API REST), comme l'aurait fait un
// webhook. Par table, une version n'est ajoutée que si elle diffère de la
// dernière reçue ; une liste des clés, que si l'ensemble des clés ou les colonnes ont changé. Un
// instantané trop gros (vide) ne change rien : sa table est rendue dans `tooBig`.
function planPull({ records, journalRows, journalTable }) {
  const byTable = rowsByTable(journalRows);
  const versions = [];
  const lists = [];
  const tooBig = [];
  for (const { fields } of records) {
    const table = fields[TABLE_COL];
    const lot = fields[TYPE_COL] === KIND.full && isSafeId(table) ? parseLot(fields[LOT_COL]) : null;
    if (lot && lot.tooBig) tooBig.push(table);
    if (!lot || lot.tooBig) continue;
    const rows = byTable.get(table) || [];
    versions.push(...changedVersions(table, lot, latestByKey(rows)));
    const list = pulledList(table, lot, rows, fields[SCHEMA_COL] || '');
    if (list) lists.push(list);
  }
  const cols = [TABLE_COL, KEY_COL, ORDER_COL, DELETE_COL, DATA_COL];
  const actions = chunk(versions).map(part => ['BulkAddRecord', journalTable, part.map(() => null),
    Object.fromEntries(cols.map(col => [col, part.map(v => v[col])]))]);
  for (const l of lists) actions.push(['AddRecord', journalTable, null, l]);
  return { actions, tooBig: tooBig.sort() };
}

function changedVersions(table, lot, latest) {
  return lot.lines.filter((l) => {
    const known = latest.get(l.key);
    return !(known && known.order === l.order && known.row[DATA_COL] === JSON.stringify(l.data) && isTrue(known.row[DELETE_COL]) === l.deleted);
  }).map(l => ({ [TABLE_COL]: table, [KEY_COL]: l.key, [ORDER_COL]: l.order, [DELETE_COL]: l.deleted, [DATA_COL]: JSON.stringify(l.data) }));
}

// Liste des clés d'un instantané, si l'ensemble des clés ou les colonnes ont changé ; sinon null.
function pulledList(table, lot, rows, schema) {
  const sortedKeys = keys => `${LIST_PREFIX}${keys.filter(Boolean).sort().join(' ')}`;
  const ids = sortedKeys(lot.lines.map(l => l.key));
  const list = latestList(rows);
  const same = list && sortedKeys(String(list[LIST_COL]).slice(LIST_PREFIX.length).split(' ')) === ids && (latestSchemaRow(rows) || {})[SCHEMA_COL] === schema;
  return same ? null : { [TABLE_COL]: table, [LIST_COL]: ids, [SCHEMA_COL]: schema };
}
return { isRaw, awaitingPartner, parseList, parseLot, planUnpack, nextGaps, compareOrder, compareVersion, latestByKey, rowsByTable, expandRows, sentColumns, pendingLists, lastMark, completeLists, planPurge, STATES, touchedTables, recentChanges, planPull };
})();

// ===== js/logic/consolidation.js =====
__M["js/logic/consolidation.js"] = (() => {
'use strict';
// CIBLE : recopie des versions d'un journal dans la table de destination (`planConsolidation`), et
// correspondance des colonnes entre les deux.
const {
  APPLIED_COL, AUTHOR_COL, BEFORE_COL, DATA_COL, DELETE_COL, EXPORT_COL, KEY_COL, LIST_COL, LOT_COL, ORDER_COL, RECALC_COL, RECEIVED_COL, RESEND_COL, SCHEMA_COL,
  STATE_COL, TABLE_COL, TYPE_COL, BUCKETS, bucketOf, chunk, freeTableId, groupBy, isBlank, isTrue,
} = __M["js/logic/common.js"];
const { compareOrder, completeLists, lastMark, latestByKey, pendingLists } = __M["js/logic/journal.js"];

// Colonnes recopiées, en couples [colonne du journal, colonne de la destination] : colonnes
// envoyées présentes des deux côtés (sous le nom choisi dans `map`, sinon le même), hors colonnes
// techniques de la synchro et formules de la destination. La destination ne garde que `id_sync`.
const TECHNICAL = new Set(['id', 'manualSort', KEY_COL, ORDER_COL, RECALC_COL, DELETE_COL, LIST_COL, APPLIED_COL, AUTHOR_COL, RECEIVED_COL, STATE_COL,
  BEFORE_COL, DATA_COL, SCHEMA_COL, EXPORT_COL, TABLE_COL, TYPE_COL, RESEND_COL, LOT_COL]);
function copyColumns(journalCols, destCols, map = {}) {
  const writable = new Set(destCols.filter(c => !c.isFormula).map(c => c.colId));
  return journalCols.map(c => c.colId).filter(id => !TECHNICAL.has(id) && !id.startsWith('gristHelper_'))
    .map(id => [id, map[id] || id]).filter(([, to]) => writable.has(to) && to !== KEY_COL);
}

// Destination renommée dans la CIBLE : la table et ses colonnes sont suivies par leur numéro dans
// Grist, noté à chaque passage (`refs`, voir destRefs). Rend l'entrée avec les noms actuels : la
// destination, la correspondance des colonnes (`map`) et la colonne de rattachement (`match`).
function followRenames(entry, schema) {
  const { table: tableRef, cols = {} } = entry.refs || {};
  const dest = (tableRef && schema.tableIdOf(tableRef)) || entry.dest;
  const current = new Map((schema.columns(dest) || []).map(c => [c.id, c.colId]));
  const renamed = new Map(Object.entries(cols).filter(([colId, ref]) => current.has(ref) && current.get(ref) !== colId)
    .map(([colId, ref]) => [colId, current.get(ref)]));
  if (dest === entry.dest && !renamed.size) return entry;
  const map = { ...entry.map };
  for (const id of new Set([...(entry.columns || []).map(c => c.id), ...Object.keys(map)])) {
    const to = map[id] || id;
    if (renamed.has(to)) map[id] = renamed.get(to);
  }
  const next = { ...entry, dest, map };
  if (entry.match) next.match = renamed.get(entry.match) || entry.match;
  return next;
}

// Colonnes reçues effacées à la main dans la destination (noms d'ici) : leur numéro Grist, noté
// au passage précédent (`refs`), n'existe plus, ou elles étaient déjà notées (`dropped`). Elles ne
// sont pas recréées vides à chaque passage, mais signalées ; une colonne de ce nom revenue, ou que
// la SOURCE n'envoie plus, sort de la liste. La clé `id_sync` n'en fait jamais partie.
function droppedColumns(entry, sent, destColIds) {
  const have = new Set(destColIds);
  const noted = new Set([...Object.keys((entry.refs || {}).cols || {}), ...(entry.dropped || [])]);
  return sent.filter(c => ![KEY_COL, ORDER_COL, DELETE_COL].includes(c.id))
    .map(c => [c.id, (entry.map || {})[c.id] || c.id]).filter(([, to]) => !have.has(to) && noted.has(to));
}

// Numéros Grist de la destination et de ses colonnes, notés pour suivre un renommage.
function destRefs(schema, dest) {
  const table = schema.table(dest);
  return table ? { table: table.id, cols: Object.fromEntries(schema.columns(dest).map(c => [c.colId, c.id])) } : undefined;
}

// Colonnes envoyées arrivées après l'invitation (ni dans `columns`, ni dans `map` d'une table
// reçue) : chacune prend son nom dans la destination, ou un nom libre (`Note_2`) si une colonne de
// la destination (`destColIds`) le porte déjà, pour ne jamais écraser une colonne à elle. Rend la
// correspondance complétée, ou null s'il n'y a rien de nouveau.
function newColumnsMap({ columns = [], map = {} }, sent, destColIds) {
  const known = new Set([...columns.map(c => c.id), ...Object.keys(map)]);
  const fresh = sent.filter(c => !known.has(c.id));
  if (!fresh.length) return null;
  const taken = [...destColIds, ...Object.values(map)];
  const next = { ...map };
  for (const { id } of fresh) {
    next[id] = freeTableId(id, taken);
    taken.push(next[id]);
  }
  return next;
}

// Colonnes que la SOURCE a ajoutées à l'export, gardées pour l'historique (nom d'ici, heure ; les
// ADDED_KEPT dernières) : celles que newColumnsMap vient de ranger (`map`). Une entrée qui ne
// connaissait encore aucune colonne (ancien montage) n'en note pas : tout y paraîtrait nouveau.
const ADDED_KEPT = 10;
function addedColumns({ columns = [], map = {}, addedCols = [] }, next, at) {
  const known = new Set([...columns.map(c => c.id), ...Object.keys(map)]);
  const fresh = Object.keys(next).filter(id => !known.has(id));
  if (!known.size || !fresh.length) return addedCols.length ? addedCols : undefined;
  return [...addedCols, ...fresh.map(id => ({ col: next[id], at }))].slice(-ADDED_KEPT);
}

// Valeur reçue et valeur de la destination égales ? Vide vaut vide ; une liste de choix lue dans
// Grist commence par la marque 'L'.
function sameValue(sent, have) {
  const norm = x => (isBlank(x) ? null : Array.isArray(x) && x[0] === 'L' ? x.slice(1) : x);
  return JSON.stringify(norm(sent)) === JSON.stringify(norm(have));
}

// Numéro de ligne de chaque clé de la destination, tel que Grist l'affiche dans une vue sans tri
// (ordre de `manualSort`, puis du numéro interne) : l'`id` d'une ligne diffère d'un document à
// l'autre, son rang se retrouve dans la table.
function rowNumbers(destRows) {
  const rank = r => (typeof r.manualSort === 'number' ? r.manualSort : r.id);
  const sorted = [...destRows].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const numbers = new Map();
  sorted.forEach((r, i) => { if (!isBlank(r[KEY_COL]) && !numbers.has(r[KEY_COL])) numbers.set(r[KEY_COL], i + 1); });
  return numbers;
}

// Valeurs qu'une version va remplacer dans une ligne de la destination, notées pour l'historique
// ({ colonne du journal: valeur d'ici }), s'il y en a.
function noteReplaced(plan, copyCols, version, destRow) {
  const cells = copyCols.filter(([from, to]) => !sameValue(version.row[from], destRow[to]));
  if (cells.length) plan.before.set(version.id, { v: Object.fromEntries(cells.map(([from, to]) => [from, destRow[to] ?? null])) });
}

// Effet noté sur la dernière version d'une clé partie de la SOURCE alors que la destination ne
// l'avait plus (ou pas encore) : ni l'historique ni les retouches ne la montrent.
const LEFT = 'partie';
const SETTLED_GONE = new Set(['suppression', LEFT]);

// Retouches faites à la main dans la destination, lues après la recopie : cellules d'une ligne
// reçue qui diffèrent de la dernière version reçue, et lignes reçues effacées ici alors qu'elles
// sont toujours dans la SOURCE (`gone`). `except` : clés parties de la SOURCE à ce passage. Rend [{ id, key, n, row, cells: [[colonne du
// journal, colonne d'ici, valeur d'ici, valeur de la SOURCE]] }] par numéro de ligne (`id` : la
// ligne d'ici, `row` : la version reçue). Échange : rien (une retouche y part vers l'autre
// document, ce n'est pas un écart).
function manualEdits({ journalRows, destRows, copyCols, exchange = false, except = new Set() }) {
  if (exchange) return [];
  const latest = latestByKey(journalRows);
  const numbers = rowNumbers(destRows);
  const edits = [];
  for (const row of destRows) {
    const version = latest.get(row[KEY_COL]);
    if (!version || isTrue(version.row[DELETE_COL])) continue;
    const cells = copyCols.filter(([from, to]) => !sameValue(version.row[from], row[to]))
      .map(([from, to]) => [from, to, row[to] ?? null, version.row[from] ?? null]);
    if (cells.length) edits.push({ id: row.id, key: row[KEY_COL], n: numbers.get(row[KEY_COL]) || null, row: version.row, cells });
  }
  for (const [key, version] of latest) {
    if (numbers.has(key) || except.has(key) || isTrue(version.row[DELETE_COL]) || SETTLED_GONE.has(version.row[STATE_COL])) continue;
    edits.push({ id: null, key, n: null, row: version.row, cells: [], gone: true });
  }
  return edits.sort((a, b) => Number(Boolean(a.gone)) - Number(Boolean(b.gone)) || (a.n || 0) - (b.n || 0));
}

// « Corriger » : remet dans les cellules retouchées (voir manualEdits) la valeur de la SOURCE, une
// écriture par groupe de lignes retouchées sur les mêmes colonnes, et fait revenir les lignes
// effacées ici avec toutes leurs valeurs (`copyCols`).
function restoreActions(edits, destTable, copyCols) {
  const changed = edits.filter(e => !e.gone);
  const back = edits.filter(e => e.gone);
  const groups = groupBy(changed, e => JSON.stringify(e.cells.map(([, to]) => to)));
  return [
    ...[...groups.values()].flatMap(list => chunk(list).map(part => ['BulkUpdateRecord', destTable, part.map(e => e.id),
      Object.fromEntries(part[0].cells.map(([, to], i) => [to, part.map(e => e.cells[i][3])]))])),
    ...chunk(back).map(part => ['BulkAddOrUpdateRecord', destTable, { [KEY_COL]: part.map(e => e.key) },
      Object.fromEntries(copyCols.map(([from, to]) => [to, part.map(e => e.row[from] ?? null)])), { on_many: 'all' }]),
  ];
}

// ---------------------------------------------------------------------------------------------
// Recopie

// Lignes de la destination par clé, et celles sans clé par valeur de la colonne de rattachement.
function indexDest(destRows, matchCol) {
  const keyed = destRows.filter(r => !isBlank(r[KEY_COL]));
  const unkeyed = matchCol ? destRows.filter(r => isBlank(r[KEY_COL]) && !isBlank(r[matchCol])) : [];
  return { byKey: groupBy(keyed, r => r[KEY_COL]), unkeyed: groupBy(unkeyed, r => r[matchCol]) };
}

// Clés parties de la SOURCE d'après les listes pas encore traitées : absentes de la liste la plus
// récente qui couvre leur seau (seau qui a perdu une clé, ou liste complète arrivée en entier), ou
// d'une liste « ids:… » ; sauf si une version plus récente que la liste est arrivée (clé recréée,
// annulation) : « plus récente » se lit à l'heure de la SOURCE, ou à l'ordre d'arrivée pour une
// liste « ids:… », qui n'a pas d'heure. Seule la plus récente compte : une clé sortie d'un filtre
// puis revenue figure dans la dernière liste, pas dans celle d'avant, et les deux peuvent attendre
// le même passage, dans un ordre quelconque (file de Grist).
// Rend les clés (`gone`) et, pour l'historique, [version, date d'arrivée de la liste] de celles que
// la destination a (`listGone`) ; les versions déjà recopiées des autres (`leftGone`, effacées ici
// avant de partir de la SOURCE) ; note dans `marks` les listes traitées.
function droppedKeys(pending, latest, destByKey, marks) {
  const gone = new Set();
  const listGone = [];
  const leftGone = [];
  const known = [...new Set([...destByKey.keys(), ...latest.keys()])];
  const drop = (key, t, listRow) => {
    const version = latest.get(key);
    if (gone.has(key) || (version && (t === null ? version.id > listRow.id : compareOrder(version.order, t) > 0))) return;
    gone.add(key);
    if (version && destByKey.has(key)) listGone.push([version.id, listRow[RECEIVED_COL] ?? null]);
    else if (version && isTrue(version.row[APPLIED_COL]) && !SETTLED_GONE.has(version.row[STATE_COL])) leftGone.push(version.id);
  };
  const newest = new Map(); // seau -> { t, keys, row } : la liste la plus récente qui le couvre
  const cover = (bucket, t, keys, row) => {
    const was = newest.get(bucket);
    if (!was || compareOrder(t, was.t) >= 0) newest.set(bucket, { t, keys, row });
  };
  const mark = lastMark(pending);
  for (const { row, list } of pending) {
    if (list.buckets) for (const [bucket, keys] of list.buckets.keys) cover(bucket, list.buckets.t, keys, row);
    // Un morceau de liste complète attend les autres ; celui d'un renvoi remplacé par un autre
    // (interrompu, repris sous une autre marque) ne servira plus.
    if (!list.part || list.part.mark !== mark) marks.set(row.id, '');
  }
  const byBucket = groupBy(known, bucketOf);
  for (const { rows, keys, t } of completeLists(pending)) {
    for (let bucket = 0; bucket < BUCKETS; bucket++) cover(bucket, t, keys, rows[rows.length - 1]);
    rows.forEach(row => marks.set(row.id, ''));
  }
  for (const [bucket, { t, keys, row }] of newest) (byBucket.get(bucket) || []).filter(key => !keys.has(key)).forEach(key => drop(key, t, row));
  const full = pending.filter(l => l.list.full).pop();
  if (full) {
    const present = new Set(full.list.full);
    known.filter(key => !present.has(key)).forEach(key => drop(key, null, full.row));
  }
  return { gone, listGone, leftGone };
}

const newest = rows => rows.map(r => r[ORDER_COL]).reduce((a, b) => (compareOrder(a, b) >= 0 ? a : b), null);

// Sans effet : la destination a déjà ces valeurs, ou la SOURCE n'a rien changé depuis la version
// déjà recopiée (un renvoi, l'arrivée d'un autre destinataire, une colonne non envoyée modifiée).
// Une retouche faite à la main dans la destination reste donc en place.
function withoutEffect({ applied, copyCols }, version, here) {
  const before = applied.get(version.row[KEY_COL]);
  if (before && copyCols.every(([from]) => sameValue(version.row[from], before.row[from]))) return true;
  return here.every(row => copyCols.every(([from, to]) => sameValue(version.row[from], row[to])));
}

// Effet de la dernière version d'une clé pas encore recopiée : 'suppression', 'modif' (dont le
// rattachement d'une ligne sans clé), 'ajout', ou '' (sans effet). Les lignes à écrire sont notées
// dans `plan`.
function versionState(ctx, plan, key, version) {
  const here = ctx.dest.byKey.get(key);
  // Échange : la version reçue n'a d'effet que si elle est plus récente que la ligne d'ici.
  if (ctx.exchange && here && compareOrder(version.order, newest(here)) <= 0) return '';
  if (isTrue(version.row[DELETE_COL])) plan.gone.add(key);
  if (plan.gone.has(key)) return here ? 'suppression' : LEFT;
  const candidates = !here && ctx.matchFrom ? ctx.dest.unkeyed.get(version.row[ctx.matchFrom]) : null;
  if (candidates && candidates.length) {
    const row = candidates.shift();
    plan.attached.push([row, version]);
    noteReplaced(plan, ctx.copyCols, version, row);
    return 'modif';
  }
  if (here && withoutEffect(ctx, version, here)) return '';
  plan.upserts.push(version);
  if (here) noteReplaced(plan, ctx.copyCols, version, here[0]);
  return here ? 'modif' : 'ajout';
}

// Le plan en actions Grist : ajouts et modifications par clé, rattachements, suppressions, puis
// marques dans le journal et, pour l'historique, ce qui a été remplacé.
function consolidationActions({ destTable, journalTable, copyCols, exchange }, { upserts, attached, removeIds, marks, listGone, leftGone, before }) {
  const values = (versions) => {
    const out = Object.fromEntries(copyCols.map(([from, to]) => [to, versions.map(v => v.row[from] ?? null)]));
    return exchange ? { ...out, [ORDER_COL]: versions.map(v => v.order ?? null) } : out;
  };
  return [
    ...chunk(upserts).map(part => ['BulkAddOrUpdateRecord', destTable, { [KEY_COL]: part.map(v => v.row[KEY_COL]) }, values(part), { on_many: 'all' }]),
    ...chunk(attached).map(part => ['BulkUpdateRecord', destTable, part.map(([row]) => row.id),
      { [KEY_COL]: part.map(([, v]) => v.row[KEY_COL]), ...values(part.map(([, v]) => v)) }]),
    ...chunk(removeIds).map(part => ['BulkRemoveRecord', destTable, part]),
    ...chunk([...marks]).map(part => ['BulkUpdateRecord', journalTable, part.map(([id]) => id),
      { [APPLIED_COL]: part.map(() => true), [STATE_COL]: part.map(([, state]) => state) }]),
    ...chunk(listGone).map(part => ['BulkUpdateRecord', journalTable, part.map(([id]) => id),
      { [STATE_COL]: part.map(() => 'suppression'), [RECEIVED_COL]: part.map(([, at]) => at) }]),
    ...chunk(leftGone).map(part => ['BulkUpdateRecord', journalTable, part, { [STATE_COL]: part.map(() => LEFT) }]),
    ...chunk([...before]).map(part => ['BulkUpdateRecord', journalTable, part.map(([id]) => id),
      { [BEFORE_COL]: part.map(([, was]) => JSON.stringify(was)) }]),
  ];
}

// Actions qui amènent la destination à l'état de la SOURCE, en un seul lot, pour une table
// (lignes du journal de cette table seulement) :
//  - la dernière version de chaque clé, si elle n'a pas encore été recopiée ; une clé inconnue
//    de la destination peut y reprendre une ligne existante sans clé de même valeur dans la
//    colonne `matchCol` (rattachement d'un référentiel déjà rempli) ;
//  - la suppression des lignes cochées `Supprime` et des clés parties de la SOURCE (droppedKeys) ;
//  - le marquage des versions et des listes traitées (`Sync_Applique`) et de leur effet
//    (`Sync_Etat`), pour l'historique ; une suppression venue d'une liste est notée sur la
//    dernière version de la clé, à la date d'arrivée de la liste ;
//  - ce que la recopie remplace (`Sync_Avant`) : les valeurs d'ici d'une ligne modifiée, le
//    numéro d'une ligne supprimée.
// Une retouche manuelle survit donc jusqu'à la prochaine modification côté SOURCE, et rejouer le
// plan après application ne change rien (idempotent).
// Échange (`exchange`) : la destination est aussi envoyée à l'autre document. La version la plus
// récente gagne : une version reçue n'a d'effet que si elle est plus récente que la ligne d'ici
// (MajLe), et elle y écrit MajLe à son heure. Les listes des clés sont sans effet : une clé absente
// de la liste de l'autre document peut n'y être pas encore arrivée ; seule `Supprime` efface.
function planConsolidation({ journalRows, destRows, copyCols, destTable, journalTable, matchCol = '', exchange = false }) {
  const dest = indexDest(destRows, matchCol);
  const latest = latestByKey(journalRows);
  const marks = new Map(); // ligne du journal -> effet ('' pour une liste ou une version sans effet)
  const pending = pendingLists(journalRows);
  const { gone, listGone, leftGone } = exchange ? { gone: new Set(), listGone: [], leftGone: [] } : droppedKeys(pending, latest, dest.byKey, marks);
  if (exchange) pending.forEach(({ row }) => marks.set(row.id, ''));
  const ctx = {
    dest, copyCols, exchange,
    matchFrom: (copyCols.find(([, to]) => to === matchCol) || [])[0],
    applied: latestByKey(journalRows.filter(r => isTrue(r[APPLIED_COL]) && !isTrue(r[DELETE_COL]))),
  };
  const plan = { gone, marks, upserts: [], attached: [], before: new Map(), stats: { added: 0, updated: 0, removed: 0 } };
  for (const [key, version] of latest) {
    if (isTrue(version.row[APPLIED_COL])) continue;
    const state = versionState(ctx, plan, key, version);
    marks.set(version.id, state);
    if (state === 'ajout') plan.stats.added++;
    if (state === 'modif') plan.stats.updated++;
  }
  const removed = [...gone].filter(key => dest.byKey.has(key));
  plan.stats.removed = removed.length;
  const removeIds = removed.flatMap(key => dest.byKey.get(key).map(r => r.id));
  if (removed.length) {
    const numbers = rowNumbers(destRows);
    for (const key of removed) if (latest.has(key)) plan.before.set(latest.get(key).id, { n: numbers.get(key) });
  }
  return { actions: consolidationActions({ destTable, journalTable, copyCols, exchange }, { ...plan, removeIds, listGone, leftGone }), stats: plan.stats, gone };
}
return { copyColumns, followRenames, droppedColumns, destRefs, newColumnsMap, addedColumns, rowNumbers, manualEdits, restoreActions, planConsolidation };
})();

// ===== js/logic/resend.js =====
__M["js/logic/resend.js"] = (() => {
'use strict';
// SOURCE : renvois de lignes et de listes des clés, ménagés pour l'instance (un renvoi à la fois par
// document, un budget d'octets par fenêtre de temps).
const { KIND, ORDER_COL, RESEND_ALL, RESEND_COL, TRACK_COL, TYPE_COL, parseJson } = __M["js/logic/common.js"];

const RESEND_CHUNK = 200; // lignes par tranche de renvoi

// Renvoi de lignes (numéros de ligne de la table SOURCE) : une marque nouvelle à chaque fois, pour
// que la valeur change même si les lignes sont les mêmes.
const resendValue = (mark, ids) => `${mark}:${ids.join(',')}`;

// Renvoi reprenable : lignes d'une table à renvoyer depuis `since` (RESEND_ALL : toutes), dans
// l'ordre de MajLe. Chaque tranche part avec la marque `chunkMark` : ses lignes et les suivantes
// restent à envoyer, de sorte qu'un renvoi interrompu reprend à la dernière tranche.
const majle = r => r[ORDER_COL] || 0;
const rowsSince = (rows, since) => rows.filter(r => since <= RESEND_ALL || majle(r) >= since)
  .sort((a, b) => majle(a) - majle(b) || a.id - b.id);
const chunkMark = (part, since) => Math.max(since, majle(part[0]));

// Morceau `n` de la liste complète d'un renvoi, après la clé `after` (Synchro_Renvoi de la ligne
// 'cles'). `mark` distingue un renvoi des autres.
const listRequest = (mark, n, after) => JSON.stringify({ marque: mark, n, apres: after });

// Suivi des clés d'une table (ligne 'suivi') : { t, top, s, seaux, trop } ; {} s'il n'y en a pas.
const trackState = row => (row && row[TYPE_COL] === KIND.track ? parseJson(row[TRACK_COL], null) || {} : {});

// Trop de clés à envoyer d'un coup, et la liste complète pas encore renvoyée depuis.
const listOverdue = (row) => {
  const { trop } = trackState(row);
  return Boolean(trop) && trop !== row[RESEND_COL];
};

// Ligne Synchro qui demande d'envoyer la liste complète de sa table : renvoi de la liste interrompu
// (la demande est restée dans la ligne 'cles'), ou trop de clés parties d'un coup (suivi).
const listDue = r => (r[TYPE_COL] === KIND.keys && Boolean(r[RESEND_COL])) || listOverdue(r);

// ---------------------------------------------------------------------------------------------
// Renvois ménagés (ligne 'charge' de Synchro, colonne Synchro_Renvoi, en JSON) : un renvoi à la
// fois par document, toutes pages et personnes confondues (`par` : la page qui renvoie, `le` : son
// dernier signe de vie, en secondes ; au-delà de LEASE_S sans signe, une autre page reprend), et au
// plus RESEND_BUDGET octets envoyés par fenêtre de BUDGET_WINDOW secondes, tous destinataires
// comptés (`envoye` : [[minute, octets]]) ; au-delà, le renvoi attend jusqu'à `reprise`. Les
// modifications ordinaires ne passent pas par là : elles partent toujours.
const RESEND_BUDGET = 20000000;
const BUDGET_WINDOW = 600;
const LEASE_S = 120;

function parseCharge(text) {
  const charge = parseJson(text, null) || {};
  const pairs = Array.isArray(charge.envoye) ? charge.envoye.filter(e => Array.isArray(e) && e.length === 2) : [];
  return {
    par: typeof charge.par === 'string' ? charge.par : '', le: Number(charge.le) || 0, reprise: Number(charge.reprise) || 0,
    envoye: pairs.map(([at, n]) => [Number(at) || 0, Number(n) || 0]),
  };
}

// Une autre page renvoie, et a donné signe de vie depuis moins de LEASE_S secondes. Une page se
// nomme `navigateur.page` ; la question n'est posée que sous le verrou du navigateur (une page de ce
// navigateur qui renverrait encore le tiendrait) : une page du même navigateur est donc fermée.
function chargeBusy(charge, page, now) {
  const browser = id => id.split('.')[0];
  return Boolean(charge.par) && browser(charge.par) !== browser(page) && now - charge.le < LEASE_S;
}

// Ajoute `bytes` octets envoyés à l'instant `now` ; oublie ce qui est sorti de la fenêtre.
function addSpent(charge, now, bytes) {
  const minute = Math.floor(now / 60) * 60;
  const envoye = charge.envoye.filter(([at]) => at > now - BUDGET_WINDOW).map(([at, n]) => [at, n]);
  const last = envoye[envoye.length - 1];
  if (last && last[0] === minute) last[1] += bytes;
  else envoye.push([minute, bytes]);
  return { ...charge, envoye };
}

// Secondes à attendre avant d'envoyer encore : 0 tant que la fenêtre n'a pas atteint le budget,
// sinon le temps que les plus anciens envois en sortent.
function budgetWait(charge, now) {
  const recent = charge.envoye.filter(([at]) => at > now - BUDGET_WINDOW).sort((a, b) => a[0] - b[0]);
  let spent = recent.reduce((sum, [, n]) => sum + n, 0);
  let wait = 0;
  for (const [at, n] of recent) {
    if (spent < RESEND_BUDGET) break;
    spent -= n;
    wait = at + BUDGET_WINDOW - now;
  }
  return Math.max(0, wait);
}
return { RESEND_CHUNK, resendValue, rowsSince, chunkMark, listRequest, trackState, listOverdue, listDue, RESEND_BUDGET, BUDGET_WINDOW, LEASE_S, parseCharge, chargeBusy, addSpent, budgetWait };
})();

// ===== js/source/resend.js =====
__M["js/source/resend.js"] = (() => {
'use strict';
// SOURCE : renvois de lignes et de listes des clés, et rattrapage automatique tant qu'un
// propriétaire a la page du widget ouverte. Rien n'est modifié dans les tables : le widget écrit
// les lignes voulues dans Synchro_Renvoi et Grist recalcule le lot.
const { EXPORT_COL, KIND, LIST_COL, LOT_COL, MISSING_COL, RESEND_ALL, RESEND_COL, STATE_COL, SYNC_TABLE, TABLE_COL, TYPE_COL, chunk, randomHex } = __M["js/logic/common.js"];
const { hooksOf, swapExports } = __M["js/logic/exports.js"];
const { parseList, parseLot } = __M["js/logic/journal.js"];
const {
  RESEND_CHUNK, addSpent, budgetWait, chargeBusy, chunkMark, listDue, listRequest, parseCharge, resendValue, rowsSince, trackState,
} = __M["js/logic/resend.js"];
const { apply, clearWebhookQueue, fetchRows, listWebhooks, readSchema, selectRows, webhookConditions, withLock } = __M["js/grist.js"];
const { chargeRow, isCharge, syncRows, writeSync } = __M["js/source/synchro.js"];
const { message } = __M["js/ui.js"];
const { t, timeText } = __M["js/i18n.js"];
const { readPref, writePref } = __M["js/prefs.js"];

const now = () => Date.now() / 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// État d'un destinataire : [état, ton de la pastille].
function hookStatus(h) {
  if (!h.fields.enabled) return ['paused', 'off'];
  const u = h.usage || {};
  return ['retrying', 'error'].includes(u.status) || u.lastHttpStatus >= 400 ? ['error', 'err'] : ['active', 'ok'];
}

// Lot refusé pour sa taille. L'état d'un webhook est remis à zéro quand la file est vidée, mais un
// envoi en vol peut encore y écrire son échec : seul compte l'envoi que Grist retente.
function tooLarge(h) {
  const u = h.usage || {};
  return ['retrying', 'postponed'].includes(u.status) && (u.lastEventBatch || {}).httpStatus === 413;
}

// Un envoi met en général moins d'une seconde : les premières lectures sont rapprochées.
async function waitForQueue(hookIds) {
  for (let i = 0; i < 60; i++) {
    const hooks = (await listWebhooks()).filter(h => hookIds.includes(h.id));
    if (hooks.some(tooLarge)) throw new Error('tooLarge');
    if (!hooks.some(h => h.usage && h.usage.numWaiting)) return;
    await beat();
    await sleep(i < 3 ? 500 : 1500);
  }
  throw new Error('queueStuck');
}

// Vide la file de Grist (commune au document) et marque à renvoyer en entier les lots des exports
// servis : le rattrapage les renvoie ensuite.
async function clearAndMark() {
  await clearWebhookQueue();
  const [rows, hooks, conditions] = await Promise.all([syncRows(), listWebhooks(), webhookConditions()]);
  const lots = rows.filter(r => r[TYPE_COL] === KIND.lot && hooksOf(hooks, conditions, r[EXPORT_COL]).some(h => h.fields.enabled)).map(r => r.id);
  await writeSync(lots, { [MISSING_COL]: RESEND_ALL });
}

// ---------------------------------------------------------------------------------------------
// Renvoi des tables d'un export depuis `since` (secondes ; RESEND_ALL : toutes les lignes), par
// tranches, puis de leur liste complète des clés (voir sendList). La tranche suivante attend que
// les destinataires aient tout reçu (un envoi reste sous la limite de taille de Grist) ; une
// tranche trop grosse pour un lot est coupée en deux. Le renvoi est reprenable : la marque du lot
// (MISSING_COL, voir chunkMark) est posée avant la première tranche et avance avec chacune ; une
// page fermée en cours de route, le rattrapage reprend à la prochaine ouverture. Une marque déjà
// plus ancienne l'emporte. Rend le nombre de lignes renvoyées. Un renvoi à la fois, tous onglets
// confondus, et un seul par document (voir withCharge) : si une autre page renvoie déjà, les lots
// sont seulement marqués, et le rattrapage les enverra ensuite (rend alors null). `out` reçoit
// l'avancement.
const startOf = (lot, since) => (lot[MISSING_COL] > 0 ? Math.min(lot[MISSING_COL], since) : since);
const lotsOf = async (exportId, tables) => (await syncRows()).filter(r => r[EXPORT_COL] === exportId && tables.includes(r[TABLE_COL]) && r[TYPE_COL] === KIND.lot);

function resendTables(exportId, tables, out, since = RESEND_ALL) {
  return withLock('gristsync-resend', async () => {
    try {
      return await withCharge(() => resendLocked(exportId, tables, out, since), out);
    } catch (e) {
      if (e.message !== 'resendBusy') throw e;
      for (const lot of await lotsOf(exportId, tables)) await writeSync([lot.id], { [MISSING_COL]: startOf(lot, since) });
      return null;
    }
  });
}

async function resendLocked(exportId, tables, out, since) {
  const [hooks, conditions] = await Promise.all([listWebhooks(), webhookConditions()]);
  const hookIds = hooksOf(hooks, conditions, exportId).filter(h => h.fields.enabled).map(h => h.id);
  if (!hookIds.length) return 0;
  const plans = await markLots(exportId, tables, since);
  const total = plans.reduce((n, p) => n + p.rows.length, 0);
  let done = 0;
  for (const plan of plans) {
    await sendRows(plan, hookIds, (n) => {
      done += n;
      if (!out) return;
      out.replaceChildren(message('info', t('send.load.progress', { done, total })));
      out.scrollIntoView({ block: 'nearest' });
    });
    // Un Échange n'efface rien d'après les listes des clés : inutile de l'envoyer.
    if (!swapExports(await syncRows()).has(exportId)) await sendList(exportId, plan.table, hookIds);
  }
  if (out) out.replaceChildren();
  return total;
}

// Marque de chaque lot posée avant tout envoi, et lignes à renvoyer. Une table retirée ou
// introuvable est passée : la carte le dit.
async function markLots(exportId, tables, since) {
  const schema = await readSchema();
  const plans = [];
  for (const lot of await lotsOf(exportId, tables)) {
    if (!schema.has(lot[TABLE_COL])) continue;
    const start = startOf(lot, since);
    await writeSync([lot.id], { [MISSING_COL]: start });
    plans.push({ table: lot[TABLE_COL], lot: lot.id, start, rows: rowsSince(await fetchRows(lot[TABLE_COL]), start) });
  }
  return plans;
}

// Lignes d'une table, tranche par tranche. Une table sans ligne à renvoyer part quand même en lot
// de renvoi (vide) : la CIBLE remet à zéro son compte de lignes non arrivées. La marque est
// effacée à part à la fin : écrite avec le lot ordinaire, elle cacherait un nouvel envoi coupé.
async function sendRows({ lot, start, rows }, hookIds, onSent) {
  const queue = rows.length ? chunk(rows, RESEND_CHUNK) : [[]];
  while (queue.length) {
    const part = queue.shift();
    await waitForQueue(hookIds);
    await writeSync([lot], { [RESEND_COL]: resendValue(randomHex(4), part.map(r => r.id)), [MISSING_COL]: part.length ? chunkMark(part, start) : start });
    const cell = String(((await fetchRows(SYNC_TABLE)).find(r => r.id === lot) || {})[LOT_COL] || '');
    await spend(cell.length * hookIds.length);
    const sent = parseLot(cell);
    if (sent && sent.total > sent.lines.length && part.length > 1) queue.unshift(part.slice(0, part.length / 2), part.slice(part.length / 2));
    else onSent(part.length);
  }
  await waitForQueue(hookIds);
  await writeSync([lot], { [MISSING_COL]: 0 });
  await writeSync([lot], { [RESEND_COL]: '' });
}

// Liste complète des clés d'une table, en morceaux, chacun quand le précédent est parti : la CIBLE
// efface les clés absentes une fois tous les morceaux arrivés. Ses lignes sont déjà là : c'est
// elle qui fait partir les suppressions qu'une liste des clés parties n'a pas portées (file vidée,
// pause, trop de clés parties d'un coup). La demande du morceau reste dans la ligne 'cles' jusqu'à
// la fin : une page fermée en cours de route, le rattrapage recommence.
async function sendList(exportId, table, hookIds) {
  const mine = async kind => (await fetchRows(SYNC_TABLE)).find(r => r[EXPORT_COL] === exportId && r[TABLE_COL] === table && r[TYPE_COL] === kind);
  const [keys, track] = [await mine(KIND.keys), await mine(KIND.track)];
  if (!keys) return;
  const overdue = trackState(track).trop;
  const mark = randomHex(4);
  for (let n = 1, after = ''; track; n++) {
    await waitForQueue(hookIds);
    await writeSync([keys.id], { [RESEND_COL]: listRequest(mark, n, after) });
    const cell = String((await mine(KIND.keys))[LIST_COL] || '');
    await spend(cell.length * hookIds.length);
    const { part } = parseList(cell) || {};
    if (!part || part.last || !part.keys.length) break;
    after = part.keys[part.keys.length - 1];
  }
  await waitForQueue(hookIds);
  await writeSync([keys.id], { [RESEND_COL]: '' });
  if (overdue) await writeSync([track.id], { [RESEND_COL]: overdue });
}

// ---------------------------------------------------------------------------------------------
// Rattrapage, tant qu'un propriétaire a la page du widget ouverte : à l'affichage, puis toutes les
// 10 secondes (la minute quand l'onglet est caché), un onglet à la fois.
//  - Envoi refusé pour sa taille (413 : plus de 1 Mo, quand Grist regroupe des envois qui ont
//    attendu) : Grist le retenterait sans fin et la file resterait bloquée. Le widget la vide, et
//    marque à renvoyer en entier chaque export qui a un destinataire actif. Pas plus d'une fois en
//    10 minutes.
//  - Lot marqué (envoi coupé, renvoi interrompu, file vidée) : ses lignes depuis la marque
//    repartent, puis la liste complète. Liste demandée (renvoi de la liste interrompu, trop de clés
//    parties d'un coup) : la liste complète repart. Export sans destinataire : marque et demande
//    effacées (un destinataire ajouté reçoit tout). Destinataires tous en pause : marque gardée
//    pour après la reprise. File bloquée par un autre échec (lien de réception mort) : rien ne part
//    tant que la carte le signale, renvoyer ne ferait qu'attendre.
// `onDone` est appelé quand quelque chose est parti.
let catching = false;
let notOwner = false;
let repairedAt = 0;
let caughtAt = 0;

async function catchUp(onDone = () => {}) {
  if (catching || notOwner) return;
  catching = true;
  caughtAt = Date.now();
  try {
    if (await withLock('gristsync-resend', catchUpLocked)) await onDone();
  } catch (e) {
    if (e.message === 'ownerOnly') notOwner = true;
    else if (e.message !== 'resendBusy') console.warn(e);
  } finally {
    catching = false;
  }
}

function startAutoCatchUp(onDone) {
  setInterval(() => {
    if (!document.hidden || Date.now() - caughtAt > 60000) catchUp(onDone);
  }, 10000);
}

async function catchUpLocked() {
  let rows = await lightRows();
  if (!rows) return 0;
  const [hooks, conditions] = await Promise.all([listWebhooks(), webhookConditions()]);
  if (hooks.some(tooLarge) && Date.now() - repairedAt > 600000) {
    repairedAt = Date.now();
    await clearAndMark();
    rows = await lightRows();
  }
  if (hooks.some(h => h.fields.enabled && !tooLarge(h) && hookStatus(h)[0] === 'error')) return 0;
  const late = rows.filter(r => r[TYPE_COL] === KIND.lot && r[MISSING_COL] > 0);
  const same = (a, b) => a[EXPORT_COL] === b[EXPORT_COL] && a[TABLE_COL] === b[TABLE_COL];
  const swaps = swapExports(rows);
  const lists = rows.filter(r => listDue(r) && !late.some(l => same(l, r)) && !swaps.has(r[EXPORT_COL]));
  if (!late.length && !lists.length) return 0;
  const recipients = row => hooksOf(hooks, conditions, row[EXPORT_COL]);
  const active = row => recipients(row).filter(h => h.fields.enabled).map(h => h.id);
  await withCharge(async () => {
    for (const row of late) {
      if (!recipients(row).length) await writeSync([row.id], { [MISSING_COL]: 0 });
      else if (active(row).length) await resendLocked(row[EXPORT_COL], [row[TABLE_COL]], null, row[MISSING_COL]);
    }
    for (const row of lists) {
      if (!recipients(row).length) await writeSync([row.id], { [RESEND_COL]: row[TYPE_COL] === KIND.keys ? '' : trackState(row).trop });
      else if (active(row).length) await sendList(row[EXPORT_COL], row[TABLE_COL], active(row));
    }
  });
  return late.length + lists.length;
}

// Lignes de Synchro utiles au rattrapage, sans les lots ni les listes (de grosses cellules), car
// lues toutes les 10 secondes. Null sans la table.
async function lightRows() {
  const rows = await selectRows(SYNC_TABLE, [EXPORT_COL, TABLE_COL, TYPE_COL, RESEND_COL, STATE_COL]);
  if (rows) return rows.filter(r => !isCharge(r));
  return (await readSchema()).has(SYNC_TABLE) ? syncRows() : null;
}

// ---------------------------------------------------------------------------------------------
// Renvois ménagés (voir parseCharge) : la ligne 'charge' de Synchro dit quelle page renvoie et ce
// qui est parti ces dix dernières minutes. Une page qui dépasse le budget attend, en donnant signe
// de vie ; une autre page (autre personne, autre navigateur) ne lance rien pendant ce temps.
const BROWSER = readPref('browser') || randomHex(4);
writePref('browser', BROWSER);
const PAGE = `${BROWSER}.${randomHex(4)}`;
let charge = null; // { id, state, saved, out } pendant un renvoi de cette page

// Page fermée en plein renvoi : elle rend la main si Grist reçoit encore son écriture (sinon une
// autre page de ce navigateur la reprend aussitôt, une autre personne après LEASE_S secondes).
window.addEventListener('pagehide', () => {
  if (charge) apply([['UpdateRecord', SYNC_TABLE, charge.id, { [RESEND_COL]: JSON.stringify({ ...charge.state, par: '', reprise: 0 }) }]]);
});

async function readCharge() {
  const rows = await selectRows(SYNC_TABLE, [TYPE_COL, RESEND_COL]);
  return (rows && rows.find(isCharge)) || chargeRow();
}

async function withCharge(fn, out = null) {
  const row = await readCharge();
  const state = parseCharge(row[RESEND_COL]);
  if (chargeBusy(state, PAGE, now())) throw new Error('resendBusy');
  charge = { id: row.id, state: { ...state, par: PAGE, reprise: 0 }, saved: 0, out };
  await saveCharge();
  try {
    return await fn();
  } finally {
    charge.state = { ...charge.state, par: '', reprise: 0 };
    await saveCharge().catch(() => {});
    charge = null;
  }
}

// Écrit l'état, avec un signe de vie. Une autre page qui aurait pris la main entre-temps (deux
// renvois lancés au même instant) la garde : celle-ci s'arrête, ses marques restent pour le
// rattrapage.
async function saveCharge() {
  const current = parseCharge((await readCharge())[RESEND_COL]);
  if (charge.state.par && chargeBusy(current, PAGE, now())) throw new Error('resendBusy');
  if (!charge.state.par && current.par && current.par !== PAGE) return;
  charge.state.le = now();
  charge.saved = now();
  await writeSync([charge.id], { [RESEND_COL]: JSON.stringify(charge.state) });
}

// Signe de vie pendant une longue attente (file d'envoi, budget).
async function beat() {
  if (charge && now() - charge.saved > 20) await saveCharge();
}

// Octets partis (une copie par destinataire). Au-delà du budget, attendre que la fenêtre se vide.
async function spend(bytes) {
  charge.state = addSpent(charge.state, now(), bytes);
  const wait = budgetWait(charge.state, now());
  if (wait > 0) {
    charge.state.reprise = now() + wait;
    await saveCharge();
    if (charge.out) charge.out.replaceChildren(message('info', t('send.charge.wait', { at: timeText(charge.state.reprise) })));
    while (now() < charge.state.reprise) {
      await sleep(Math.min(30, charge.state.reprise - now()) * 1000);
      await saveCharge();
    }
    charge.state.reprise = 0;
  }
  await beat();
}

function chargeNotice(state) {
  if (state.reprise > now()) return message('info', t('send.charge.wait', { at: timeText(state.reprise) }));
  return chargeBusy(state, PAGE, now()) ? message('info', t('send.charge.busy')) : null;
}
return { hookStatus, clearAndMark, resendTables, catchUp, startAutoCatchUp, chargeNotice };
})();

// ===== js/source/actions.js =====
__M["js/source/actions.js"] = (() => {
'use strict';
// SOURCE : actions sur un export et ses destinataires, depuis sa carte.
const { ORDER_COL, RESEND_ALL } = __M["js/logic/common.js"];
const { buildInvitation } = __M["js/logic/codes.js"];
const { endNotice } = __M["js/logic/exports.js"];
const { rowsSince } = __M["js/logic/resend.js"];
const { deleteWebhookWithNotice, docIdentity, fetchRows, readSchema, setWebhookEnabled } = __M["js/grist.js"];
const { removeTechnicalTables } = __M["js/pages.js"];
const { endExchange } = __M["js/exchange.js"];
const { readSourceNote, removeExport, saveExport, updateSourceNote } = __M["js/source/synchro.js"];
const { clearAndMark, resendTables } = __M["js/source/resend.js"];
const { confirmDialog, copyButton, copyField, el, openModal } = __M["js/ui.js"];
const { handoffText } = __M["js/guide.js"];
const { t } = __M["js/i18n.js"];

// Mise en pause : un webhook désactivé perd son historique d'envoi (Grist remet son état à zéro),
// il ne peut donc pas dire depuis quand il ne livre plus. On note la plus récente MajLe des tables
// de l'export (heure du serveur, sans écart d'horloge avec le navigateur) et leurs colonnes.
async function pause(exp, h) {
  let at = 0;
  for (const { table } of exp.tables) for (const r of await fetchRows(table)) at = Math.max(at, r[ORDER_COL] || 0);
  await updateSourceNote((note) => {
    note.pauses = note.pauses.filter(p => p.hook !== h.id).concat([{ hook: h.id, export: exp.id, at, columns: JSON.stringify(exp.tables) }]);
  });
  await setWebhookEnabled(h.id, false);
}

// Choix de reprise : rattraper (par défaut) ou reprendre tel quel. Rend 'catchup', 'as-is' ou null.
function resumeChoice(title, help) {
  const choice = (value, label, text, checked) => [el('label', { class: 'check' },
    el('input', { type: 'radio', name: 'gristsync-resume', value, checked }), el('strong', {}, label)), el('p', { class: 'muted small choice-help' }, text)];
  const body = el('div', { class: 'form', role: 'radiogroup', 'aria-label': title },
    choice('catchup', t('send.resume.catchup'), help, true), choice('as-is', t('send.resume.asIs'), t('send.resume.asIs.help'), false));
  return new Promise((resolve) => {
    let answered = false;
    const done = (m, value) => { answered = true; resolve(value); m.close(); };
    openModal({
      title, body,
      onClose: () => { if (!answered) resolve(null); },
      buttons: [{ label: t('common.cancel'), onClick: m => done(m, null) },
        { label: t('send.action.resume'), kind: 'btn-primary', onClick: m => done(m, body.querySelector('input:checked').value) }],
    });
  });
}

// Reprendre après une pause : un webhook désactivé ne met rien en file, les changements de la
// pause sont donc perdus pour la CIBLE. Le rattrapage renvoie les lignes dont MajLe est plus
// récente que la pause, et la liste des clés pour les suppressions. Heure inconnue, ou colonnes
// changées pendant la pause : tout l'export.
async function resume(exp, h, out) {
  const entry = readSourceNote(await readSchema()).pauses.find(p => p.hook === h.id);
  const all = !entry || entry.columns !== JSON.stringify(exp.tables);
  const since = all ? RESEND_ALL : entry.at + 0.0001; // MajLe plus récente que la pause
  let n = 0;
  for (const { table } of exp.tables) n += rowsSince(await fetchRows(table), since).length;
  const help = [t('send.resume.catchup.help', { n }), all ? t('send.resume.all') : ''].filter(Boolean).join(' ');
  const picked = await resumeChoice(t('send.resume.title', { name: h.fields.memo || exp.name }), help);
  if (!picked) return;
  await setWebhookEnabled(h.id, true);
  await updateSourceNote((note) => { note.pauses = note.pauses.filter(p => p.hook !== h.id); });
  // Le renvoi pose sa marque avant tout : s'il s'interrompt, le rattrapage automatique le finit.
  if (picked === 'catchup') await resendTables(exp.id, exp.tables.map(tb => tb.table), out, since);
}

// Révoquer une personne : son webhook disparaît, les autres destinataires continuent ; sa carte le
// dit (voir endNotice). Un Échange s'arrête dans les deux sens (voir endExchange).
async function revoke(exp, h) {
  const body = t(exp.echange ? 'send.revoke.exchange' : 'send.revoke.body');
  if (!(await confirmDialog({ title: t('send.revoke.title', { name: h.fields.memo || exp.name }), body, confirmLabel: t('send.action.revoke') }))) return;
  if (exp.echange) {
    await endExchange(exp.id, { keepExport: !exp.retour });
    return;
  }
  await deleteWebhookWithNotice(h, endNotice(exp.id));
  await updateSourceNote((note) => { note.pauses = note.pauses.filter(p => p.hook !== h.id); });
}

// Annuler une invitation ; celle d'un Échange emporte son journal de retour (et la clé d'écriture
// de son formulaire).
async function cancelInvitation(inv) {
  if (!(await confirmDialog({ title: t('send.cancel.title'), body: t('send.cancel.body'), confirmLabel: t('send.action.cancel') }))) return;
  await updateSourceNote((note) => { note.invitations = note.invitations.filter(i => i.id !== inv.id); });
  if (inv.journal) await removeTechnicalTables([inv.journal]);
}

// Débloquer : la file de Grist est commune au document, la vider abandonne les envois en attente
// de tous les destinataires ; le rattrapage renvoie ensuite les exports servis.
async function unblockQueue() {
  if (await confirmDialog({ title: t('send.unblock.title'), body: t('send.unblock.body'), confirmLabel: t('send.action.unblock') })) await clearAndMark();
}

// Supprimer un export : ses destinataires sont coupés, ses lignes Synchro effacées (la table
// disparaît avec le dernier export). Les colonnes id_sync et MajLe restent dans les tables.
async function deleteExport(exp) {
  const body = t('send.delete.body', { n: exp.recipients.length });
  if (!(await confirmDialog({ title: t('send.delete.title', { name: exp.name }), body, confirmLabel: t('send.action.delete') }))) return;
  if (exp.echange || exp.invitations.some(inv => inv.journal)) {
    await endExchange(exp.id, { keepExport: false });
    return;
  }
  for (const h of exp.recipients) await deleteWebhookWithNotice(h, endNotice(exp.id));
  await updateSourceNote((note) => {
    note.exports = note.exports.filter(e => e.id !== exp.id);
    note.invitations = note.invitations.filter(i => i.export !== exp.id);
    note.pauses = note.pauses.filter(p => p.export !== exp.id);
  });
  await removeExport(exp.id);
}

// ---------------------------------------------------------------------------------------------
// Lien public : pas de webhook, la CIBLE lit elle-même les instantanés de l'export.

async function publicCode(exp) {
  const { origin, docId, baseUrl } = await docIdentity();
  return buildInvitation({ id: exp.id, exportId: exp.id, name: exp.name, origin, base: baseUrl, from: { email: exp.email, docId }, tables: exp.tables });
}

// Bouton « copier avec les consignes » : le code et les étapes de la CIBLE, prêts pour un courriel.
const handoff = (mode, code) => el('div', { class: 'handoff' },
  copyButton(() => handoffText('target', mode, 1, code), t('guide.copyHandoff')), el('span', { class: 'muted small' }, t('guide.copyHandoff.help')));

async function showPublicCode(exp) {
  const code = await publicCode(exp);
  await new Promise(resolve => openModal({ title: exp.name, onClose: resolve,
    body: [el('p', {}, t('send.public.help')), copyField(code), handoff('public', code)], buttons: [{ label: t('common.close'), kind: 'btn-primary' }] }));
}

// Couper le lien public d'un export : ses instantanés disparaissent, les règles d'accès suivent au
// prochain affichage. Tant que le document reste public, le refus général reste en place.
async function stopPublic(exp) {
  const body = t('send.public.revokeBody');
  if (!(await confirmDialog({ title: t('send.public.stopTitle', { name: exp.name }), body, confirmLabel: t('send.public.stop') }))) return;
  await updateSourceNote((note) => { note.exports = note.exports.map(e => (e.id === exp.id ? { ...e, public: false } : e)); });
  await saveExport(exp.id, exp.tables, { isPublic: false });
}
return { pause, resume, revoke, cancelInvitation, unblockQueue, deleteExport, publicCode, handoff, showPublicCode, stopPublic };
})();

// ===== js/source/recipient-wizard.js =====
__M["js/source/recipient-wizard.js"] = (() => {
'use strict';
// SOURCE : assistant d'ajout d'un destinataire, en quatre étapes (Options, Invitation, Réponse,
// Envoi ; Options et Invitation seulement pour le lien public). Une invitation en attente le
// rouvre à l'étape Réponse (`pending`), ou à l'étape Invitation pour un Échange qui attend le lien
// de son formulaire de retour.
const { AUTHOR_COL, EXPORT_COL, JOURNAL_PREFIX, SYNC_TABLE, freeTableId, randomHex, sha256, toTableId } = __M["js/logic/common.js"];
const { buildInvitation, buildWebhookUrl, loopingTables, maskKey, parseFormLink, parseReply } = __M["js/logic/codes.js"];
const { exportCondition, hookName } = __M["js/logic/exports.js"];
const { createWebhook, docIdentity, fetchRows, readSchema } = __M["js/grist.js"];
const { ensureForm, removeTechnicalTables } = __M["js/pages.js"];
const { formWhere, linkFigures, testUrl } = __M["js/form-link.js"];
const { addDeleteColumns } = __M["js/exchange.js"];
const { saveExport, syncRows, updateSourceNote } = __M["js/source/synchro.js"];
const { createJournal, receivedDests, updateJournalNote } = __M["js/target/journals.js"];
const { resendTables } = __M["js/source/resend.js"];
const { handoff, publicCode } = __M["js/source/actions.js"];
const { confirmDialog, copyField, el, message, openWizard, run } = __M["js/ui.js"];
const { roleGuide } = __M["js/guide.js"];
const { t } = __M["js/i18n.js"];

const STEP = { options: 0, invitation: 1, reply: 2, load: 3 };
const now = () => Date.now() / 1000;
const later = { label: t('common.later') };
const back = onClick => ({ label: t('common.back'), back: true, onClick });
const closeButton = () => [{ label: t('common.close'), kind: 'btn-primary' }];

// `onClose` : appelé à la fermeture (l'onglet se redessine).
function recipientWizard(exp, pending, onClose) {
  const steps = ['send.step.options', 'send.step.invitation', 'send.step.reply', 'send.step.load'].map(k => t(k));
  const ctx = { exp, steps, onClose, codes: new Map(), wizard: openWizard({ title: t('send.person.title', { name: exp.name }), steps, onClose }) };
  if (!pending) return showOptions(ctx);
  return pending.journal && !pending.ready ? showBack(ctx, pending) : showReply(ctx, pending);
}

// 1. Mode (réponse, lien public ou Échange) et secret (sans objet pour le lien public : grisé).
// L'Échange suppose un export sans autre destinataire.
function showOptions(ctx) {
  const { exp } = ctx;
  const secretBox = el('input', { type: 'checkbox', checked: true });
  const secretPart = el('div', { class: 'form' }, el('label', { class: 'check' }, secretBox, t('send.secret')), el('p', { class: 'muted small' }, t('send.secret.help')));
  const parts = { public: el('div', { class: 'hidden' }, message('warn', t('send.public.warn'))), echange: el('div', { class: 'hidden' }, message('info', t('send.mode.echange.help'))) };
  const radio = (value, label, checked, disabled) => el('label', { class: 'check' },
    el('input', { type: 'radio', name: 'gristsync-mode', value, checked, disabled, onchange: () => {
      secretBox.disabled = value === 'public';
      for (const [key, part] of Object.entries(parts)) part.classList.toggle('hidden', value !== key);
    } }), label);
  const report = el('div', { class: 'report' });
  const mode = () => (document.querySelector('input[name="gristsync-mode"]:checked') || {}).value;
  const exchangeOk = !exp.recipients.length && !exp.invitations.length && !exp.public;
  // Le parcours principal d'abord (un seul sens, avec secret) ; les autres modes, plus discrets.
  ctx.wizard.show(STEP.options, [
    el('p', { class: 'muted small' }, t('send.person.tables', { tables: exp.tables.map(tb => tb.table).join(', ') })),
    el('p', { class: 'field-title', id: 'gristsync-mode-title' }, t('send.mode')),
    el('div', { class: 'form', role: 'radiogroup', 'aria-labelledby': 'gristsync-mode-title' },
      radio('reponse', t('send.mode.reply'), true, false),
      el('p', { class: 'muted small' }, t('send.mode.others')),
      radio('echange', exchangeOk ? t('send.mode.echange') : t('send.mode.echange.off'), false, !exchangeOk),
      radio('public', exp.public ? t('send.mode.publicDone') : t('send.mode.public'), false, exp.public)),
    secretPart, parts.public, parts.echange, report, roleGuide({ you: 'source', current: 0 }),
  ], [{ label: t('common.cancel') }, { label: t('send.invite'), kind: 'btn-primary', onClick: () => run(null, report, () => invite(ctx, mode() !== 'public' && secretBox.checked, mode())) }]);
}

// 2. Invitation : le code à transmettre ; elle attend sa réponse sur la carte de l'export.
async function invite(ctx, withSecret, mode) {
  if (mode === 'echange') return openBack(ctx, withSecret);
  if (mode === 'public') return invitePublic(ctx);
  const secret = withSecret ? randomHex(16) : '';
  const entry = { id: randomHex(8), export: ctx.exp.id, hash: secret ? await sha256(secret) : '', at: now() };
  await updateSourceNote((note) => { note.invitations = [...note.invitations, entry]; });
  return showInvitation(ctx, entry, secret);
}

// Lien public : l'export devient lisible par ses instantanés. Les règles d'accès sont posées à la
// fermeture (le document se recharge alors).
async function invitePublic({ exp, wizard, steps }) {
  await updateSourceNote((note) => { note.exports = note.exports.map(e => (e.id === exp.id ? { ...e, public: true } : e)); });
  await saveExport(exp.id, exp.tables, { isPublic: true });
  const code = await publicCode(exp);
  wizard.setSteps(steps.slice(0, 2));
  wizard.show(STEP.invitation, [el('p', {}, t('send.public.help')), copyField(code), handoff('public', code),
    message('warn', t('send.public.turnOn')), roleGuide({ you: 'source', mode: 'public', current: 1 })], closeButton());
}

async function showInvitation(ctx, entry, secret, retour = '') {
  const { exp } = ctx;
  const mode = retour ? 'echange' : 'reponse';
  const [{ origin, docId }, rows] = await Promise.all([docIdentity(), syncRows()]);
  const email = (rows.find(r => r[EXPORT_COL] === exp.id) || {})[AUTHOR_COL] || '';
  const code = buildInvitation({ id: entry.id, exportId: exp.id, name: exp.name, origin, secret, from: { email, docId }, tables: exp.tables, retour });
  ctx.codes.set(entry.id, { secret, retour });
  const report = el('div', { class: 'report' });
  ctx.wizard.show(STEP.invitation, [el('p', {}, t('send.invite.help')), copyField(code), handoff(mode, code), report,
    roleGuide({ you: 'source', mode, current: 1 })],
  [back(() => run(null, report, () => backToOptions(ctx, entry))), later, { label: t('send.reply.ready'), kind: 'btn-primary', onClick: () => showReply(ctx, entry) }]);
}

// Retour aux options : l'invitation est annulée (son code ne sert plus), avec le journal de retour
// d'un Échange ; la personne en crée une autre.
async function backToOptions(ctx, inv) {
  if (!(await confirmDialog({ title: t('send.backOptions.title'), body: t('send.backOptions.body'), confirmLabel: t('common.back') }))) return;
  await updateSourceNote((note) => { note.invitations = note.invitations.filter(i => i.id !== inv.id); });
  if (inv.journal) await removeTechnicalTables([inv.journal]);
  showOptions(ctx);
}

// Retour à l'invitation depuis l'étape Réponse : le même code s'il a été fait dans cette fenêtre ;
// sinon il est refait (ni le code ni son secret ne sont gardés), et un nouveau secret rend l'ancien
// code inutile : la personne le confirme. Un Échange le refait par son lien de retour.
async function backToInvitation(ctx, inv) {
  const kept = ctx.codes.get(inv.id);
  if (kept) return showInvitation(ctx, inv, kept.secret, kept.retour);
  if (inv.hash && !(await confirmDialog({ title: t('send.newCode.title'), body: t('send.newCode.body'), confirmLabel: t('send.newCode.ok') }))) return null;
  if (inv.journal) return showBack(ctx, inv);
  const secret = inv.hash ? randomHex(16) : '';
  const entry = { ...inv, hash: secret ? await sha256(secret) : '' };
  await updateSourceNote((note) => { note.invitations = note.invitations.map(i => (i.id === inv.id ? entry : i)); });
  return showInvitation(ctx, entry, secret);
}

// 2 bis. Échange : un journal de retour, que la CIBLE remplira par le formulaire publié ici, sur
// sa propre page. Le secret est tiré quand le code est fait, et le code n'est gardé nulle part :
// il peut être refait.
async function openBack(ctx, withSecret) {
  const { exp } = ctx;
  const journal = freeTableId(JOURNAL_PREFIX + toTableId(exp.name, 'Export'), (await readSchema()).tableIds);
  const entry = { id: randomHex(8), export: exp.id, hash: '', at: now(), journal, withSecret };
  await createJournal(journal, { id: entry.id, export: exp.id, name: exp.name, secret: '', from: {}, mode: 'echange', retour: true, tables: [], refused: [], missing: {} });
  await updateSourceNote((note) => { note.invitations = [...note.invitations, entry]; });
  return showBack(ctx, entry);
}

async function showBack(ctx, inv) {
  await ensureForm(inv.journal);
  const input = el('input', { type: 'url', class: 'input', spellcheck: 'false', 'aria-label': t('send.back.title') });
  const report = el('div', { class: 'report' });
  const check = async () => {
    if (!parseFormLink(input.value)) throw new Error('formLink');
    const retour = buildWebhookUrl(input.value, inv.journal);
    await testUrl(retour, inv.journal);
    const secret = inv.withSecret ? randomHex(16) : '';
    const entry = { ...inv, hash: secret ? await sha256(secret) : '', ready: true };
    await updateSourceNote((note) => { note.invitations = note.invitations.map(i => (i.id === inv.id ? entry : i)); });
    await showInvitation(ctx, entry, secret, retour);
  };
  ctx.wizard.show(STEP.invitation, [el('p', {}, t('send.back.help', { where: await formWhere(inv.journal) })), ...linkFigures(), input, report,
    roleGuide({ you: 'source', mode: 'echange', current: 0 })],
  [back(() => run(null, report, () => backToOptions(ctx, inv))), later, { label: t('recv.link.check'), kind: 'btn-primary', onClick: () => run(null, report, check) }]);
}

// 3. Réponse : vérifier, montrer la fiche, approuver. La réponse doit désigner cette invitation
// et porter le même secret (comparé par empreinte).
function showReply(ctx, inv) {
  const area = el('textarea', { class: 'code', rows: 4, spellcheck: 'false', 'aria-label': t('send.reply.title') });
  const report = el('div', { class: 'report' });
  const body = [el('p', {}, t('send.reply.help')), area, report, roleGuide({ you: 'source', current: 3 })];
  const check = async () => {
    const reply = await checkReply(ctx.exp, inv, area.value);
    report.replaceChildren(...replyFiche(reply, (await docIdentity()).docId));
    ctx.wizard.show(STEP.reply, body, [toInvitation, later, { label: t('send.reply.approve'), kind: 'btn-primary', onClick: () => run(null, report, () => approve(ctx, inv, reply)) }]);
  };
  const toInvitation = back(() => run(null, report, () => backToInvitation(ctx, inv)));
  ctx.wizard.show(STEP.reply, body, [toInvitation, later, { label: t('send.reply.check'), kind: 'btn-primary', onClick: () => run(null, report, check) }]);
}

// Réponse lue et contrôlée : même instance, cette invitation, même secret, pas de boucle ; un
// Échange dit où la CIBLE a rangé chaque table de l'export.
async function checkReply(exp, inv, text) {
  const reply = parseReply(text, (await docIdentity()).origin);
  if (reply.id !== inv.id || inv.hash !== (reply.secret ? await sha256(reply.secret) : '')) throw new Error('unknownInvitation');
  if (loopingTables(exp.tables.map(tb => tb.table), reply.recipient.docId, receivedDests(await readSchema())).length) throw new Error('loop');
  if (Boolean(inv.journal) !== Boolean(reply.retour) || (reply.retour || []).some(b => !exp.tables.some(tb => tb.table === b.dest))) throw new Error('codeInvalid');
  return { ...reply, tables: reply.retour ? reply.retour.map(b => t('send.exchange.map', b)).join(', ') : exp.tables.map(tb => tb.table).join(', ') };
}

// Fiche de la personne qui répond, à vérifier avant d'approuver.
function replyFiche(reply, docId) {
  const r = reply.recipient;
  const fiche = [[t('send.reply.tables'), reply.tables], [t('send.reply.email'), r.email],
    [t('send.reply.doc'), r.docId === docId ? `${r.docId} · ${t('send.reply.sameDoc')}` : r.docId], [t('send.reply.team'), r.team], [t('send.reply.at'), r.at]];
  return [el('dl', { class: 'fiche' }, fiche.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v || '—')])),
    reply.secret ? null : message('warn', t('send.reply.nosecret')),
    el('p', { class: 'muted small' }, maskKey(reply.url))].filter(Boolean);
}

// Un webhook sur Synchro, filtré sur l'export, vers le journal de la CIBLE. Échange : l'export
// reçoit sa ligne 'echange', et le journal de retour sait d'où viennent ses tables : il commence
// à recopier.
async function approve(ctx, inv, reply) {
  const { exp } = ctx;
  const r = reply.recipient;
  await createWebhook({
    name: hookName(exp.name, exp.id), memo: [r.email, r.docId, r.team].filter(Boolean).join(' · '), url: reply.url,
    tableId: SYNC_TABLE, condition: exportCondition(exp.id),
  });
  if (inv.journal) {
    await addDeleteColumns(exp.tables.map(tb => tb.table));
    await saveExport(exp.id, exp.tables, { swap: true });
    await updateJournalNote(inv.journal, n => ({
      ...n, from: { email: r.email, docId: r.docId }, tables: reply.retour.map(b => ({ table: b.table, dest: b.dest, columns: [] })),
    }));
  }
  await updateSourceNote((note) => {
    note.invitations = note.invitations.filter(i => i.id !== inv.id);
    if (inv.journal) note.exports = note.exports.map(e => (e.id === exp.id ? { ...e, echange: true } : e));
  });
  await showLoad(ctx);
}

// 4. Envoi : le branchement n'envoie que les modifications à venir ; proposer l'existant. La
// fenêtre se ferme pendant l'envoi, qui continue (voir resendTables) : l'onglet se redessine à la fin.
async function showLoad({ exp, wizard, onClose }) {
  let total = 0;
  for (const { table } of exp.tables) total += (await fetchRows(table)).length;
  const report = el('div', { class: 'report' });
  if (!total) {
    wizard.show(STEP.load, [message('ok', t('send.connected')), el('p', {}, t('send.load.empty'))], closeButton());
    return;
  }
  const send = async () => {
    wizard.show(STEP.load, [message('ok', t('send.connected')), report, el('p', { class: 'muted small' }, t('send.load.background'))], closeButton());
    report.replaceChildren(message('info', t('send.load.progress', { done: 0, total })));
    const n = await resendTables(exp.id, exp.tables.map(tb => tb.table), report);
    if (!report.isConnected) return onClose && onClose();
    return wizard.show(STEP.load + 1, n === null ? message('info', t('send.load.queued')) : message('ok', t('send.done')), closeButton());
  };
  wizard.show(STEP.load, [message('ok', t('send.connected')), el('p', {}, t('send.load.body', { n: total })), report],
    [later, { label: t('send.load.ok'), kind: 'btn-primary', onClick: () => run(null, report, send) }]);
}
return { recipientWizard };
})();

// ===== js/source/export-wizard.js =====
__M["js/source/export-wizard.js"] = (() => {
'use strict';
// SOURCE : assistant d'export, en trois étapes (Tables, Colonnes, Nom). Crée l'export, ou le
// modifie (`exp`) : ajouter ou retirer des tables, changer les colonnes ou le nom vaut pour tous
// ses destinataires.
const { SYNC_TABLE, isUserTable, randomHex, randomUUID } = __M["js/logic/common.js"];
const { exportableColumns, hookName } = __M["js/logic/exports.js"];
const { fillKeyActions, missingSyncColumns, prepareSourceActions } = __M["js/logic/formulas.js"];
const { apply, fetchRows, readSchema, renameWebhook } = __M["js/grist.js"];
const { saveExport, updateSourceNote } = __M["js/source/synchro.js"];
const { receivedDests } = __M["js/target/journals.js"];
const { resendTables } = __M["js/source/resend.js"];
const { recipientWizard } = __M["js/source/recipient-wizard.js"];
const { checkList, el, message, openWizard, pickField, run } = __M["js/ui.js"];
const { roleGuide } = __M["js/guide.js"];
const { t, typeName } = __M["js/i18n.js"];

const cancel = { label: t('common.cancel') };
const columnLabel = c => (c.label === c.id ? c.id : `${c.label} (${c.id})`);

// `onClose` : appelé à la fermeture (l'onglet se redessine).
function exportWizard(exp, onClose) {
  const wizard = openWizard({
    title: exp ? t('send.edit.title', { name: exp.name }) : t('send.new'),
    steps: ['send.step.tables', 'send.step.columns', 'send.step.name'].map(k => t(k)),
    onClose,
  });
  showTables({
    exp, wizard, onClose,
    chosen: exp ? exp.tables.map(tb => tb.table) : [],
    selected: new Map(exp ? exp.tables.map(tb => [tb.table, tb.columns.map(c => c.id)]) : []), // table -> colonnes cochées
    filters: new Map(exp ? exp.tables.map(tb => [tb.table, tb.filter]) : []), // table -> filtre de lignes, ou null
  });
}

// 1. Tables de l'export. Une table introuvable (renommée, effacée) en sort.
async function showTables(ctx) {
  const tables = (await readSchema()).tableIds.filter(isUserTable);
  ctx.chosen = ctx.chosen.filter(table => tables.includes(table));
  const report = el('div', { class: 'report' });
  const next = { label: t('common.next'), kind: 'btn-primary', disabled: !ctx.chosen.length, onClick: () => run(null, report, () => showColumns(ctx)) };
  const list = checkList({
    items: tables.map(id => ({ value: id, label: id })), checked: ctx.chosen, label: t('send.step.tables'),
    onChange: (values) => { ctx.chosen = values; next.disabled = !values.length; ctx.wizard.buttons([cancel, next]); },
  });
  ctx.wizard.show(0, [el('p', {}, t(ctx.exp ? 'send.edit.tables' : 'send.tables.help')), list, report, ctx.exp ? null : roleGuide({ you: 'source', current: 0 })], [cancel, next]);
}

// Bloc d'une table à l'étape Colonnes : par défaut toutes ses colonnes et toutes ses lignes, dit
// en une ligne ; deux boutons ouvrent le choix des colonnes et le filtre des lignes (ouverts
// d'emblée quand l'export modifié les précise déjà).
function columnsBlock(ctx, schema, table, relayed) {
  const all = exportableColumns(schema.columns(table));
  const usable = all.filter(c => !c.blocked);
  if (!ctx.selected.has(table)) ctx.selected.set(table, usable.map(c => c.id));
  const blocked = all.filter(c => c.blocked).map(c => c.id);
  const summary = el('p', { class: 'small' });
  const describe = () => {
    const n = ctx.selected.get(table).length;
    const filter = ctx.filters.get(table);
    summary.textContent = `${n === usable.length ? t('send.columns.all', { n }) : t('send.columns.some', { n, total: usable.length })} · ${
      filter ? t('send.rows.filtered', { column: filter.visible || filter.id, value: filter.value }) : t('send.rows.all')}`;
  };
  const columns = el('div', { class: 'form' },
    checkList({ items: usable.map(c => ({ value: c.id, label: columnLabel(c), hint: typeName(c.source) })),
      checked: ctx.selected.get(table), label: table, onChange: (values) => { ctx.selected.set(table, values); describe(); } }),
    blocked.length ? el('p', { class: 'muted small' }, t('send.columns.blocked', { cols: blocked.join(', ') })) : null);
  const rows = el('div', {}, filterField(table, usable, ctx.filters.get(table), (filter) => { ctx.filters.set(table, filter); describe(); }));
  describe();
  return el('div', { class: 'form table-block' }, el('h3', {}, table),
    relayed ? message('info', t('send.columns.relay')) : null, summary,
    el('div', { class: 'block-actions' },
      togglePart(columns, t('send.columns.pick'), ctx.selected.get(table).length !== usable.length),
      togglePart(rows, t('send.rows.pick'), Boolean(ctx.filters.get(table)))),
    columns, rows);
}

// Bouton qui ouvre ou ferme une partie de la fenêtre.
function togglePart(part, label, open) {
  part.classList.toggle('hidden', !open);
  const button = el('button', { class: 'btn btn-small', type: 'button', 'aria-expanded': String(open), onclick: () => {
    const now = part.classList.toggle('hidden') === false;
    button.setAttribute('aria-expanded', String(now));
  } }, label);
  return button;
}

// 2. Colonnes, par table, et ce que le widget ajoutera pour la synchro.
async function showColumns(ctx) {
  const schema = await readSchema();
  const relays = receivedDests(schema).map(d => d.dest);
  const report = el('div', { class: 'report' });
  const blocks = ctx.chosen.map(table => columnsBlock(ctx, schema, table, relays.includes(table)));
  const adds = ctx.chosen.flatMap(table => missingSyncColumns(schema.columns(table)).map(col => `${table}.${col}`));
  if (!schema.has(SYNC_TABLE)) adds.push(t('send.check.sync'));
  const removed = ctx.exp ? ctx.exp.tables.map(tb => tb.table).filter(table => !ctx.chosen.includes(table)) : [];
  const next = () => {
    if (ctx.chosen.some(table => !(ctx.selected.get(table) || []).length)) throw new Error('noColumn');
    showName(ctx);
  };
  ctx.wizard.show(1, [el('p', {}, t('send.columns.help')),
    removed.length ? message('warn', t('send.edit.removed', { tables: removed.join(', ') })) : null,
    ...blocks,
    adds.length ? el('p', { class: 'muted small' }, t('send.check.missing', { items: adds.join(', ') })) : null, report], [
    { label: t('common.back'), back: true, onClick: () => showTables(ctx) },
    { label: t('common.next'), kind: 'btn-primary', onClick: () => run(null, report, next) }]);
}

// 3. Nom, puis création (ou enregistrement) : c'est ici seulement que le widget écrit.
function showName(ctx) {
  const fallback = ctx.chosen.join(' + ');
  const nameInput = el('input', { type: 'text', class: 'input', id: 'gristsync-export-name', value: ctx.exp ? ctx.exp.name : fallback });
  const report = el('div', { class: 'report' });
  ctx.wizard.show(2, [el('label', { for: 'gristsync-export-name' }, t('send.name')), nameInput, el('p', { class: 'muted small' }, t('send.name.help')), report], [
    { label: t('common.back'), back: true, onClick: () => run(null, report, () => showColumns(ctx)) },
    { label: ctx.exp ? t('common.save') : t('send.create'), kind: 'btn-primary', onClick: () => run(null, report, () => save(ctx, nameInput.value.trim() || fallback, report)) }]);
}

// Tables prêtes à partir (id_sync, MajLe…) et leurs colonnes choisies. Une table reçue (relais)
// garde la clé de son document d'origine : une ligne ajoutée ici à la main reste sans clé, donc
// locale (avec une clé, la prochaine liste de l'origine, qui ne la connaît pas, l'effacerait).
// Un seul instantané suffit : chaque étape ne touche que sa table, et les colonnes que le widget
// ajoute ne sont pas envoyables.
async function prepareTables(ctx) {
  const schema = await readSchema();
  const relays = receivedDests(schema).map(d => d.dest);
  const tables = [];
  for (const table of ctx.chosen) {
    await apply(prepareSourceActions(table, missingSyncColumns(schema.columns(table))));
    if (!relays.includes(table)) await apply(fillKeyActions(table, await fetchRows(table), () => randomUUID()));
    const columns = exportableColumns(schema.columns(table)).filter(c => !c.blocked && ctx.selected.get(table).includes(c.id));
    tables.push({ table, columns, filter: ctx.filters.get(table) || null });
  }
  return tables;
}

async function save(ctx, name, report) {
  const { exp, wizard } = ctx;
  const tables = await prepareTables(ctx);
  const id = exp ? exp.id : randomHex(8);
  const changed = await saveExport(id, tables, { isPublic: Boolean(exp && exp.public), swap: Boolean(exp && exp.echange) });
  await updateSourceNote((note) => {
    const others = note.exports.filter(e => e.id !== id);
    note.exports = [...others, { ...(exp ? note.exports.find(e => e.id === id) : {}), id, name, at: exp ? exp.at : Date.now() / 1000 }];
  });
  if (!exp) {
    const created = { id, name, tables, recipients: [], invitations: [], public: false, email: '' };
    wizard.show(3, [message('ok', t('send.created', { name })), el('p', {}, t('send.created.next'))], [
      { label: t('common.later') },
      { label: t('send.action.addPerson'), kind: 'btn-primary', onClick: () => { wizard.close(); recipientWizard(created, null, ctx.onClose); } }]);
    return;
  }
  if (name !== exp.name) for (const h of exp.recipients) await renameWebhook(h.id, hookName(name, id));
  // Fenêtre fermée pendant le renvoi, qui continue : l'onglet se redessine à la fin.
  if (changed.length) wizard.show(3, [report, el('p', { class: 'muted small' }, t('send.load.background'))], [{ label: t('common.close'), kind: 'btn-primary' }]);
  const n = changed.length ? await resendTables(id, changed, report) : 0;
  if (changed.length && !report.isConnected) return ctx.onClose && ctx.onClose();
  const saved = n === null ? message('info', t('send.load.queued')) : message('ok', n ? t('send.edit.saved', { n }) : t('send.edit.savedNone'));
  return wizard.show(3, saved, [{ label: t('common.close'), kind: 'btn-primary' }]);
}

// Filtre de lignes d'une table, facultatif : une colonne et la valeur qu'ont les lignes envoyées.
// `onChange` reçoit le filtre ({ id, source, visible, value }), ou null pour toutes les lignes.
function filterField(table, columns, current, onChange) {
  const input = el('input', { type: 'text', class: 'input', value: current ? current.value : '', 'aria-label': t('send.filter.value', { table }) });
  const hint = el('p', { class: 'muted small' });
  const filter = () => {
    const column = columns.find(col => col.id === pick.value());
    return column ? { id: column.id, source: column.source, visible: column.visible, value: input.value } : null;
  };
  const show = (id) => {
    const column = columns.find(col => col.id === id);
    input.hidden = !column;
    hint.textContent = column ? t(column.source === 'Bool' ? 'send.filter.bool' : 'send.filter.help') : '';
    onChange(filter());
  };
  const pick = pickField({
    items: [{ value: '', label: t('send.filter.all') }, ...columns.map(c => ({ value: c.id, label: columnLabel(c) }))],
    value: current ? current.id : '', label: t('send.filter.title', { table }), onChange: show,
  });
  input.addEventListener('input', () => onChange(filter()));
  show(current ? current.id : '');
  return el('div', { class: 'filter-field' }, el('p', { class: 'field-title' }, t('send.filter.title', { table })), pick, input, hint);
}
return { exportWizard };
})();

// ===== js/source/tab.js =====
__M["js/source/tab.js"] = (() => {
'use strict';
// Onglet « Envoyer » (document SOURCE) : une carte par export (un nom, des tables et leurs
// colonnes) avec ses destinataires. Une seule table technique, Synchro ; un webhook par
// destinataire, filtré par Grist sur les lignes de son export.
const { AUTHOR_COL, EXPORT_COL, KIND, LOT_COL, MISSING_COL, RESEND_COL, SYNC_TABLE, TABLE_COL, TYPE_COL } = __M["js/logic/common.js"];
const { maskKey } = __M["js/logic/codes.js"];
const { PUBLIC_MEMO, conditionExport, exportTables, exportableColumns, hooksOf, isPublicRule, publicAclActions, publicAclRules, ruleText } = __M["js/logic/exports.js"];
const { parseLot } = __M["js/logic/journal.js"];
const { listDue, parseCharge } = __M["js/logic/resend.js"];
const { apply, deleteWebhook, docIdentity, fetchRows, gristFetch, listWebhooks, readSchema, webhookConditions } = __M["js/grist.js"];
const { ensureSyncTable, isCharge, legacyTables, readSourceNote, refreshMajLe, removeLegacy } = __M["js/source/synchro.js"];
const { catchUp, chargeNotice, hookStatus, resendTables } = __M["js/source/resend.js"];
const { cancelInvitation, deleteExport, pause, resume, revoke, showPublicCode, stopPublic, unblockQueue } = __M["js/source/actions.js"];
const { exportWizard } = __M["js/source/export-wizard.js"];
const { recipientWizard } = __M["js/source/recipient-wizard.js"];
const { confirmDialog, el, icon, message, run } = __M["js/ui.js"];
const { roleGuide } = __M["js/guide.js"];
const { dateText, t } = __M["js/i18n.js"];

let container;
let notice = null; // message à montrer au prochain affichage (fin d'un renvoi)
let resumed = false; // l'assistant d'un Échange ne se rouvre seul qu'une fois par chargement

// ---------------------------------------------------------------------------------------------
// État du document : exports (note + lignes Synchro), destinataires (webhooks sur Synchro, rangés
// par l'export que nomme leur condition), invitations en attente.

async function loadState() {
  let hooks = [];
  let ownerOnly = false;
  try { hooks = await listWebhooks(); } catch (e) { if (e.message !== 'ownerOnly') throw e; ownerOnly = true; }
  const conditions = ownerOnly ? new Map() : await webhookConditions();
  const schema = await readSchema();
  const all = schema.has(SYNC_TABLE) ? await fetchRows(SYNC_TABLE) : [];
  const rows = all.filter(r => !isCharge(r));
  const note = readSourceNote(schema);
  const ids = [...new Set([...note.exports.map(e => e.id), ...rows.map(r => r[EXPORT_COL])])];
  const exports = ids.map(id => exportState(id, { note, rows, schema, recipients: hooksOf(hooks, conditions, id) }));
  const legacy = legacyTables(schema);
  // Webhooks de l'ancien montage : sur ses tables, ou vers un journal par une clé de formulaire.
  // Les autres webhooks du document (autres outils) ne sont pas à lui.
  const legacyHooks = hooks.filter(h => h.fields.tableId !== SYNC_TABLE && (legacy.includes(h.fields.tableId) || /\/api\/s\/[^/]+\/tables\/[^/]+\/records\?flat=1$/.test(h.fields.url || '')));
  const unsafe = hooks.filter(h => h.fields.tableId === SYNC_TABLE && !conditionExport(conditions.get(h.id)));
  const charge = parseCharge((all.find(isCharge) || {})[RESEND_COL]);
  return { ownerOnly, schema, note, exports, unsafe, charge, legacy: { tables: legacy, hooks: legacyHooks } };
}

function exportState(id, { note, rows, schema, recipients }) {
  const mine = rows.filter(r => r[EXPORT_COL] === id);
  const tables = exportTables(rows, id);
  return {
    ...(note.exports.find(e => e.id === id) || { id, name: id }), tables, recipients, invitations: note.invitations.filter(i => i.export === id),
    email: (mine[0] || {})[AUTHOR_COL] || '',
    partial: recipients.some(h => h.fields.enabled) && mine.some(r => (r[TYPE_COL] === KIND.lot && r[MISSING_COL] > 0) || listDue(r)),
    // Lien public : tables dont l'instantané dépasse la taille permise (il reste vide).
    tooBig: mine.filter(r => r[TYPE_COL] === KIND.full && (parseLot(r[LOT_COL]) || {}).tooBig).map(r => r[TABLE_COL]),
    ...drift(schema, tables),
  };
}

// Ce que la SOURCE a changé depuis l'enregistrement de l'export : tables introuvables (renommées
// ou effacées : leurs lignes ne partent plus) et colonnes renommées, effacées ou d'un autre type
// (elles partiraient vides ou fausses). « Modifier » remet l'export d'accord avec les tables.
function drift(schema, tables) {
  const lost = tables.filter(tb => !schema.has(tb.table)).map(tb => tb.table);
  const changed = tables.filter(tb => schema.has(tb.table)).flatMap(({ table, columns }) => {
    const current = new Map(exportableColumns(schema.columns(table)).map(c => [c.id, c]));
    return columns.filter((c) => {
      const cur = current.get(c.id);
      return !cur || cur.source !== (c.source || c.type) || (cur.visible || '') !== (c.visible || '');
    }).map(c => `${table}.${c.id}`);
  });
  return { lost, changed };
}

// Lien public : le document est-il lisible sans identifiant ? (requête anonyme) Vrai, faux, ou
// null quand la réponse ne permet pas de le dire (réseau, serveur occupé) : rien ne change alors.
async function isPublic(base) {
  try {
    const response = await gristFetch(base);
    if (response.ok) return true;
    return [401, 403, 404].includes(response.status) ? false : null;
  } catch (e) {
    return null;
  }
}

// Règles d'accès du lien public, accordées aux exports partagés : réécrites seulement si elles
// diffèrent (changer une règle fait recharger le document, et donc le widget). Le refus général
// posé par le widget reste tant que le document est public ; le widget n'en pose jamais un sur un
// document qu'il n'a pas partagé lui-même (un document public sans export public reste lisible).
async function syncPublicRules(exportIds, open) {
  const [resources, rules] = await Promise.all([fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules')]);
  const mine = rules.filter(isPublicRule);
  const keepDeny = open && mine.length > 0;
  const resource = id => resources.find(r => r.id === id) || {};
  const have = mine.map(r => ruleText({ ...resource(r.resource), ...r }) + r.memo).sort().join('\n');
  const want = publicAclRules(exportIds, { keepDeny }).map(r => ruleText(r) + PUBLIC_MEMO).sort().join('\n');
  if (have !== want) await apply(publicAclActions(resources, rules, exportIds, { keepDeny }));
}

// ---------------------------------------------------------------------------------------------
// Tableau de bord

// Redessine l'onglet s'il est affiché et qu'aucune fenêtre n'est ouverte (rattrapage terminé).
async function refreshSource() {
  if (container && container.isConnected && !document.querySelector('.scrim')) await renderSource();
}

async function renderSource(root = container) {
  container = root;
  let state = await loadState();
  // Mise à niveau silencieuse du montage (colonnes de Synchro, dépendances de MajLe), puis
  // rattrapage d'un envoi coupé.
  if (!state.ownerOnly && state.schema.has(SYNC_TABLE)) {
    const upgraded = await ensureSyncTable();
    const majle = await refreshMajLe();
    if (upgraded || majle) state = await loadState();
    catchUp(refreshSource);
  }
  // Document lisible par lien public ? Vérifié à chaque affichage : tant qu'il l'est, le refus
  // général posé par le widget reste en place, même sans export public.
  const open = await isPublic((await docIdentity()).baseUrl);
  if (!state.ownerOnly && open !== null) await syncPublicRules(state.exports.filter(e => e.public).map(e => e.id), open);
  const out = el('div', { class: 'out' }, notice);
  notice = null;
  const toolbar = el('div', { class: 'toolbar' },
    el('button', { class: 'btn btn-primary', type: 'button', disabled: state.ownerOnly, onclick: () => exportWizard(null, renderSource) }, icon('plus'), t('send.new')));
  const cards = state.exports.map(exp => exportCard(exp, state, open, out));
  if (state.unsafe.length) cards.unshift(unsafeCard(state.unsafe, state.ownerOnly, out));
  if (state.legacy.tables.length) cards.push(legacyCard(state, out));
  container.replaceChildren(...[toolbar,
    state.ownerOnly ? message('warn', t('common.ownerOnly')) : null,
    chargeNotice(state.charge),
    out,
    cards.length ? el('div', { class: 'cards' }, cards) : el('p', { class: 'muted' }, t('send.empty')),
    roleGuide({ you: 'source' })].filter(Boolean));
  // Échange qui attend le lien de son formulaire de retour (page fermée en route) : l'assistant
  // reprend à cette étape, une fois par chargement.
  const pending = state.exports.flatMap(exp => exp.invitations.filter(inv => inv.journal && !inv.ready).map(inv => [exp, inv]))[0];
  if (pending && !resumed && !state.ownerOnly && !document.querySelector('.scrim')) openRecipient(...pending);
}

const openRecipient = (exp, pending = null) => {
  resumed = true;
  recipientWizard(exp, pending, renderSource);
};

// Bouton d'une carte : grisé pour qui n'est pas propriétaire, ou avec la raison (`reason`).
// L'action finie, l'onglet est redessiné.
function actionButton(label, iconName, fn, ownerOnly, out, { kind = '', reason = '' } = {}) {
  return el('button', {
    class: `btn btn-small ${kind}`, type: 'button', disabled: ownerOnly || Boolean(reason), title: reason || null,
    onclick: e => run(e.currentTarget, out, async () => { await fn(); await renderSource(); }),
  }, icon(iconName), label);
}

// Bouton qui ouvre un assistant.
const wizardButton = (label, iconName, onclick, { primary = false, ownerOnly = false, reason = '' } = {}) => el('button', {
  class: `btn btn-small ${primary ? 'btn-primary' : ''}`, type: 'button', disabled: ownerOnly || Boolean(reason), title: reason || null, onclick,
}, icon(iconName), label);

const pill = (key, tone, vars) => el('span', { class: `pill pill-${tone}` }, t(`send.status.${key}`, vars));

// Erreur d'envoi d'un destinataire, dite simplement, et ce qu'il faut faire.
function hookError(u) {
  const status = u.lastHttpStatus || (u.lastEventBatch || {}).httpStatus;
  if (status === 413) return t('send.error.size');
  if (/Invalid column/i.test(u.lastErrorMessage || '')) return t('send.error.column');
  return t([401, 403, 404].includes(status) ? 'send.error.link' : 'send.error.other');
}

function exportStatus(exp) {
  if (exp.recipients.some(h => hookStatus(h)[0] === 'error')) return ['error', 'err'];
  if (exp.recipients.length || exp.public) return ['people', 'ok'];
  return exp.invitations.length ? ['invited', 'pending'] : ['alone', 'off'];
}

// Avis d'un export : tables perdues, colonnes changées, envoi incomplet, Échange.
const exportNotes = exp => [
  exp.lost.length ? message('warn', t('send.export.lost', { tables: exp.lost.join(', ') })) : null,
  exp.changed.length ? message('warn', t('send.export.drift', { cols: exp.changed.join(', ') })) : null,
  exp.partial ? message('info', t('send.export.partial')) : null,
  exp.retour ? message('info', t('send.exchange.managed')) : null,
  exp.echange && !exp.retour ? el('p', { class: 'muted small' }, t('send.exchange.with')) : null,
];

const tablesLine = exp => exp.tables.map(tb => t(tb.filter ? 'send.export.tableFiltered' : 'send.export.table',
  { table: tb.table, n: tb.columns.length, ...(tb.filter ? { col: tb.filter.id, value: tb.filter.value } : {}) })).join(' · ') || '—';

function exportCard(exp, state, open, out) {
  const { ownerOnly } = state;
  const n = exp.recipients.length;
  const [status, tone] = exportStatus(exp);
  const rows = [
    ...exp.recipients.map(h => personRow(exp, h, ownerOnly, out)),
    ...exp.invitations.map(inv => inviteRow(exp, inv, ownerOnly, out)),
    exp.public ? publicRow(exp, open, ownerOnly, out) : null,
  ].filter(Boolean);
  const load = async () => {
    const total = await resendTables(exp.id, exp.tables.map(tb => tb.table), out);
    notice = total === null ? message('info', t('send.load.queued')) : message('ok', t('send.load.done', { n: total }));
  };
  // Échange : un seul destinataire ; l'export de retour (reçu d'un autre document) se règle depuis
  // l'onglet Recevoir.
  const single = exp.echange || exp.invitations.some(inv => inv.journal) ? t('send.exchange.single') : '';
  return el('article', { class: 'card', 'data-export': exp.id },
    el('div', { class: 'card-head' }, el('strong', {}, exp.name), pill(status, tone, { n: n + (exp.public ? 1 : 0) })),
    el('p', { class: 'muted small' }, tablesLine(exp)),
    exportNotes(exp),
    rows.length ? el('ul', { class: 'people' }, rows) : el('p', { class: 'small' }, t('send.export.nobody')),
    el('div', { class: 'card-actions' },
      exp.retour ? null : wizardButton(t('send.action.addPerson'), 'plus', () => openRecipient(exp), { primary: true, ownerOnly, reason: single }),
      exp.retour ? null : wizardButton(t('send.action.edit'), 'edit', () => exportWizard(exp, renderSource), { ownerOnly }),
      actionButton(t('send.action.load'), 'send', load, ownerOnly, out, { reason: n ? '' : t('send.load.nobody') }),
      actionButton(t('send.action.delete'), 'trash', () => deleteExport(exp), ownerOnly, out, { kind: 'btn-danger-text' })));
}

// Un destinataire : sa fiche (mémo du webhook), son état, et ce qu'on peut faire pour lui seul.
function personRow(exp, h, ownerOnly, out) {
  const [status, tone] = hookStatus(h);
  const u = h.usage || {};
  const action = (label, iconName, fn, options) => actionButton(label, iconName, fn, ownerOnly, out, options);
  const failing = status === 'error';
  return el('li', { class: 'person' },
    el('div', { class: 'person-head' }, el('span', { class: 'person-who' }, h.fields.memo || '—'), pill(status, tone)),
    u.lastSuccessTime ? el('p', { class: 'muted small' }, t('send.lastOk', { at: dateText(u.lastSuccessTime) })) : null,
    u.numWaiting ? el('p', { class: 'small' }, t('send.waiting', { n: u.numWaiting })) : null,
    failing ? el('p', { class: 'small text-danger' }, hookError(u)) : null,
    failing && u.lastErrorMessage ? el('p', { class: 'muted small' }, t('send.error.detail', { detail: maskKey(`${u.lastHttpStatus || ''} ${u.lastErrorMessage}`) })) : null,
    el('div', { class: 'person-actions' },
      status === 'paused' ? action(t('send.action.resume'), 'play', () => resume(exp, h, out)) : action(t('send.action.pause'), 'pause', () => pause(exp, h)),
      failing ? action(t('send.action.unblock'), 'unblock', unblockQueue) : null,
      action(t('send.action.revoke'), 'revoke', () => revoke(exp, h), { kind: 'btn-danger-text' })));
}

// Invitation en attente. Celle d'un Échange attend d'abord le lien de son formulaire de retour, et
// son code peut être refait (nouveau secret) : il n'est gardé nulle part.
function inviteRow(exp, inv, ownerOnly, out) {
  const back = inv.journal && !inv.ready;
  return el('li', { class: 'person' },
    el('div', { class: 'person-head' },
      el('span', { class: 'person-who' }, t('send.invite.pending', { at: dateText(inv.at * 1000) })), pill('invited', 'pending')),
    el('p', { class: 'muted small' }, back ? t('send.mode.echange') : inv.hash ? t('send.secret.on') : t('send.secret.off')),
    el('div', { class: 'person-actions' },
      wizardButton(back ? t('send.back.resume') : t('send.reply'), back ? 'link' : 'paste', () => openRecipient(exp, inv), { primary: true, ownerOnly }),
      inv.journal && inv.ready ? wizardButton(t('send.back.again'), 'key', () => openRecipient(exp, { ...inv, ready: false }), { ownerOnly }) : null,
      actionButton(t('send.action.cancel'), 'trash', () => cancelInvitation(inv), ownerOnly, out, { kind: 'btn-danger-text' })));
}

function publicRow(exp, open, ownerOnly, out) {
  return el('li', { class: 'person' },
    el('div', { class: 'person-head' }, el('span', { class: 'person-who' }, t('send.public.label')), pill(open ? 'public' : 'publicOff', open ? 'ok' : 'pending')),
    open ? null : el('p', { class: 'small' }, t('send.public.turnOn')),
    exp.tooBig.length ? message('warn', t('send.public.tooBig', { tables: exp.tooBig.join(', ') })) : null,
    el('div', { class: 'person-actions' },
      actionButton(t('send.public.code'), 'key', () => showPublicCode(exp), ownerOnly, out),
      actionButton(t('send.public.stop'), 'unlink', () => stopPublic(exp), ownerOnly, out, { kind: 'btn-danger-text' })));
}

// Carte d'avertissement avec un bouton qui nettoie, après confirmation.
function cleanupCard({ title, body, status, clean, confirm, ownerOnly, out, fn }) {
  return el('article', { class: 'card' },
    el('div', { class: 'card-head' }, el('strong', {}, title), status),
    el('p', { class: 'small' }, body),
    el('div', { class: 'card-actions' }, actionButton(clean, 'trash', async () => {
      if (await confirmDialog({ title, body: confirm, confirmLabel: clean })) await fn();
    }, ownerOnly, out, { kind: 'btn-danger-text' })));
}

// Webhook sur Synchro sans filtre reconnu : il recevrait les lignes de tous les exports.
const unsafeCard = (hooks, ownerOnly, out) => cleanupCard({
  title: t('send.unsafe.title'), status: pill('error', 'err'), body: t('send.unsafe.body', { who: hooks.map(h => h.fields.memo || h.fields.name).join(', ') }),
  clean: t('send.unsafe.delete'), confirm: t('send.unsafe.confirm'), ownerOnly, out,
  fn: async () => { for (const h of hooks) await deleteWebhook(h.id); },
});

// Montage d'avant la version 0.4 : à refaire avec un export ; le bouton efface l'ancien.
const legacyCard = (state, out) => cleanupCard({
  title: t('send.legacy.title'), status: pill('legacy', 'pending'), body: t('send.legacy.body', { tables: state.legacy.tables.join(', ') }),
  clean: t('send.legacy.clean'), confirm: t('send.legacy.confirm'), ownerOnly: state.ownerOnly, out,
  fn: async () => {
    for (const h of state.legacy.hooks) await deleteWebhook(h.id);
    await removeLegacy(await readSchema());
  },
});
return { refreshSource, renderSource };
})();

// ===== js/target/loop.js =====
__M["js/target/loop.js"] = (() => {
'use strict';
// CIBLE : la recopie, tant qu'un éditeur a la page du widget ouverte. Toutes les 10 secondes, le
// widget demande à Grist quelles tables ont changé (voir due) ; si un journal ou une destination a
// changé, et au moins une fois par minute, chaque journal est déplié, recopié dans ses
// destinations, puis nettoyé. Le résultat de chaque passage est gardé ici pour l'onglet.
const { EXPORT_COL, KEY_COL, KIND, LIST_COL, RESEND_COL, SYNC_TABLE, TABLE_COL, TYPE_COL, randomHex } = __M["js/logic/common.js"];
const { exchangeColumns, exportTables } = __M["js/logic/exports.js"];
const { awaitingPartner, expandRows, isRaw, nextGaps, planPull, planPurge, planUnpack, recentChanges, rowsByTable, sentColumns, touchedTables } = __M["js/logic/journal.js"];
const { addedColumns, copyColumns, destRefs, droppedColumns, followRenames, manualEdits, newColumnsMap, planConsolidation, restoreActions, rowNumbers } = __M["js/logic/consolidation.js"];
const { apply, docChanges, docIdentity, fetchRows, gristFetch, readSchema, withLock } = __M["js/grist.js"];
const { addDestColumnsActions, destColumns, receivedJournals, updateJournalNote, upgradeJournal } = __M["js/target/journals.js"];
const { syncRows } = __M["js/source/synchro.js"];
const { wireExchange } = __M["js/exchange.js"];
const { errorText } = __M["js/ui.js"];
const { t } = __M["js/i18n.js"];
const { readPref, writePref } = __M["js/prefs.js"];

const POLL_MS = 10000;
const IDLE_MS = 60000;
// Lignes reçues dépliées par passage, au plus ; au-delà de FLOOD_PER_MIN lignes reçues par minute,
// l'arrivée est anormale (le webhook n'en dépose que quelques-unes) : la carte le signale.
const RAW_BATCH = 500;
const FLOOD_PER_MIN = 600;
// Une destination dont le journal n'a pas changé n'est relue, pour y voir les retouches faites à la
// main, que si Grist dit qu'elle a changé (voir due), au retour sur la page, sur « Synchroniser »,
// et au plus tard au bout de 5 minutes.
const REREAD_MS = 300000;
const DRIFT_KEPT = 20;

// Ce que l'onglet montre. `results` : dernier passage par journal ({ at, rows, gaps } ; { at,
// error, text } en cas d'erreur) et par table reçue (clé `journal|table` : { at, text, table,
// stats, recent, dest, copyCols, labelCol, labelCols, types, drift, droppedCols, driftCount,
// driftGone }, ou { at, error, text }). `drift` : les premières lignes retouchées à la main
// (DRIFT_KEPT), `droppedCols` : les colonnes reçues effacées ici ([colonne du journal, d'ici]),
// `driftCount` : le nombre de retouches en tout (cellules, lignes et colonnes effacées),
// `driftGone` : celui des lignes effacées. `offers` : tables proposées par
// journal ([{ table, columns, n }]). `readOnly` : le document refuse l'écriture (lecteur).
// `lastVisit` : date de la visite précédente sur ce document (secondes), ou 0.
const state = { results: new Map(), offers: new Map(), readOnly: false, viewer: false, lastVisit: null };
const tableKey = (journal, table) => `${journal}|${table}`;
// Refus de Grist faute de droits (lecteur) : le widget passe en lecture seule.
const isAccessError = e => /access|denied|blocked|permission/i.test(e.message);

let busy = false;
let lastArrival = Date.now(); // dernière arrivée dans un journal (ou retour sur la page)
let lastPass = 0; // début du dernier passage
// Coup d'œil sur le document (voir due) : son état au coup d'œil précédent (`hash`), les journaux
// et destinations du dernier passage (`tables`), un journal en lien public (`pull`) ; `compare`
// passe à faux si Grist refuse.
const watch = { hash: '', tables: new Set(), pull: false, compare: true };
let onChange = async () => {}; // l'onglet, redessiné quand un passage a changé quelque chose
const inflow = new Map(); // journal -> { ids, at } : lignes reçues vues au passage précédent
const settled = new Map(); // `journal|table` -> { signature, at } : journal déjà recopié sans effet
const lastRead = new Map(); // `journal|table` -> { numbers, drift } : numéros de ligne et retouches, à la dernière lecture
const pulled = new Map(); // journal -> empreintes des instantanés publics déjà lus

function startAutoConsolidation(render) {
  onChange = render;
  const tick = async () => {
    if (document.visibilityState === 'visible' && await due()) await consolidateAll();
    setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    lastArrival = Date.now();
    consolidateAll({ reread: true });
  });
}

// Un passage est-il dû ? Grist dit quelles tables ont changé depuis le coup d'œil précédent
// (docChanges) : un journal où des lignes sont arrivées, une destination retouchée à la main (elle
// est alors relue), ou le schéma. Sinon un passage par minute suffit (retouche que la comparaison
// n'aurait pas dite). Un lien public, que rien ne signale ici, et le cas où Grist refuse la
// comparaison (droits) gardent le rythme d'avant : toutes les POLL_MS tant que des lignes
// arrivent, puis toutes les minutes.
async function due() {
  if (busy) return false; // un passage en cours : le coup d'œil attend le suivant
  const elapsed = Date.now() - lastPass;
  const steady = elapsed >= (Date.now() - lastArrival > IDLE_MS ? IDLE_MS : POLL_MS);
  if (watch.compare) {
    const changes = await docChanges(watch.hash).catch(() => ({ hash: watch.hash, tables: null }));
    if (changes) {
      const touched = changes.hash === watch.hash ? [] : touchedTables(changes.tables, watch.tables);
      watch.hash = changes.hash;
      if (touched === null) settled.clear();
      else for (const [key, was] of settled) if (touched.includes(was.dest)) settled.delete(key);
      return elapsed >= IDLE_MS || touched === null || touched.length > 0 || (watch.pull && steady);
    }
    watch.compare = false;
  }
  return steady;
}

// Date de la visite précédente, retenue par navigateur et par document : la seule chose que le
// widget garde hors de Grist pour l'historique (aucune donnée des tables).
async function readLastVisit() {
  if (state.lastVisit !== null) return;
  const key = `visit.${(await docIdentity()).docId}`;
  state.lastVisit = Number(readPref(key)) || 0;
  writePref(key, String(Math.floor(Date.now() / 1000)));
}

// Oublie ce qui est gardé d'un journal (réception arrêtée).
function forgetJournal(journal) {
  for (const key of [...state.results.keys()]) if (key === journal || key.startsWith(`${journal}|`)) state.results.delete(key);
  for (const map of [settled, lastRead]) for (const key of [...map.keys()]) if (key.startsWith(`${journal}|`)) map.delete(key);
  state.offers.delete(journal);
}

// ---------------------------------------------------------------------------------------------
// Un passage sur un journal

// Lien public : lit les instantanés de l'export dans la table Synchro de la SOURCE, sans
// identifiant, et ajoute au journal ce qui a changé, comme l'aurait fait un webhook. Les
// instantanés ne sont relus que si leur empreinte (taille et CRC-32, une petite ligne à part) a
// changé depuis la dernière lecture de cette page. Rend vrai si quelque chose est arrivé.
async function pull(note, journal) {
  const read = async (kind) => {
    const filter = encodeURIComponent(JSON.stringify({ [EXPORT_COL]: [note.export], [TYPE_COL]: [kind] }));
    const response = await gristFetch(`${note.base}/tables/${SYNC_TABLE}/records?filter=${filter}`).catch(() => null);
    if (!response || !response.ok) throw new Error('publicClosed');
    return (await response.json()).records || [];
  };
  // Une SOURCE d'avant la version 0.5 n'a pas d'empreinte : l'instantané est relu à chaque fois.
  const marks = await read(KIND.mark);
  const seen = JSON.stringify(marks.map(r => [r.fields[TABLE_COL], r.fields[LIST_COL]]).sort());
  if (marks.length && pulled.get(journal) === seen) return false;
  const { actions, tooBig } = planPull({ records: await read(KIND.full), journalRows: await fetchRows(journal), journalTable: journal });
  await apply(actions);
  if (JSON.stringify(tooBig) !== JSON.stringify(note.tooBig || [])) await updateJournalNote(journal, n => ({ ...n, tooBig }));
  pulled.set(journal, seen);
  return actions.length > 0;
}

// Arrivée anormale : plus de FLOOD_PER_MIN lignes reçues par minute depuis le passage précédent.
// Le premier passage d'un chargement ne peut pas le dire (on ne sait pas depuis quand elles sont là).
function flooded(journal, raw) {
  const at = Date.now() / 1000;
  const was = inflow.get(journal);
  inflow.set(journal, { ids: new Set(raw.map(r => r.id)), at });
  if (!was) return false;
  return raw.filter(r => !was.ids.has(r.id)).length > FLOOD_PER_MIN * Math.max(1, (at - was.at) / 60);
}

function nextSuspect(was = {}, rejected, flood) {
  const at = Math.floor(Date.now() / 1000);
  return { n: (was.n || 0) + rejected, at, ...(flood ? { flood: at } : was.flood ? { flood: was.flood } : {}) };
}

// Déplie ce qui est arrivé, et note dans le journal ce qui manque encore, les arrivées suspectes
// (lignes rejetées, flot anormal) et la fin de l'envoi annoncée par la SOURCE (`ended`, heure ;
// effacée si des données arrivent ensuite). Rend la note à jour, les lignes du journal, et s'il
// reste des lignes reçues pour le passage suivant.
async function unpack(journal, note) {
  let rows = await fetchRows(journal);
  const flood = flooded(journal, rows.filter(isRaw));
  const plan = planUnpack(rows, journal, { exportId: note.mode === 'public' ? null : note.export, max: RAW_BATCH });
  if (!plan.actions.length) return { note, rows, left: 0 };
  lastArrival = Date.now();
  await apply(plan.actions);
  const gaps = nextGaps(note, plan);
  if (plan.rejected || flood) gaps.suspect = nextSuspect(note.suspect, plan.rejected, flood);
  const ended = (plan.ended === undefined ? note.ended : plan.ended && (plan.ended.at || Math.floor(Date.now() / 1000))) || undefined;
  if (gaps.suspect || ended !== note.ended || JSON.stringify(gaps) !== JSON.stringify({ missing: note.missing || {}, big: note.big || {} })) {
    note = { ...note, ...gaps, ended };
    await updateJournalNote(journal, n => ({ ...n, ...gaps, ended }));
  }
  rows = await fetchRows(journal);
  return { note, rows, left: plan.left };
}

// Tables que la SOURCE a ajoutées à l'export, pas encore rangées ni refusées (`pending`), et
// celles qu'on peut déjà proposer (leurs colonnes sont connues).
function offersOf(groups, note) {
  const known = new Set(note.tables.map(tb => tb.table));
  const pending = [...groups.keys()].filter(table => !known.has(table) && !note.refused.includes(table));
  const offers = pending.map((table) => {
    const tableRows = groups.get(table);
    return { table, columns: sentColumns(tableRows, []), n: new Set(tableRows.map(r => r[KEY_COL]).filter(Boolean)).size };
  }).filter(o => o.columns.length);
  return { pending, offers };
}

// Colonnes reçues pour une table, et la correspondance. Échange, côté du document qui a invité
// (`allowed` : colonnes que son export envoie pour cette destination) : l'autre document n'écrit
// que celles-là (voir exchangeColumns). Une colonne ajoutée à l'export après coup ne remplace
// jamais une colonne de la destination qui porte déjà son nom (elle prend un nom libre) ; elle
// est notée pour l'historique (`addedCols`).
function receivedColumns(entry, tableRows, schema, allowed) {
  let sent = sentColumns(tableRows, entry.columns || []);
  let next = entry;
  if (allowed) {
    const kept = exchangeColumns(sent, allowed, entry.map);
    sent = kept.sent;
    next = { ...entry, map: kept.map };
  }
  const map = newColumnsMap(next, destColumns(sent), schema.columns(next.dest).map(c => c.colId));
  return { sent, entry: map ? { ...next, map, addedCols: addedColumns(next, map, Math.floor(Date.now() / 1000)) } : next };
}

// Recopie d'une table dans sa destination (une colonne nouvelle y est d'abord ajoutée ; une colonne
// effacée ici ne l'est pas, elle est notée). Rend l'entrée à jour (destination renommée,
// correspondance, colonnes effacées), les compteurs, les colonnes recopiées et leurs types, les
// numéros de ligne et les retouches faites à la main (lus après la recopie).
async function copyTable(ctx, noted) {
  const { journal, groups, exchange, swap, allowedFor } = ctx;
  let entry = followRenames(noted, ctx.schema);
  if (!ctx.schema.has(entry.dest)) return { entry, error: t('error.destMissing', { dest: entry.dest }) };
  const tableRows = groups.get(entry.table) || [];
  const received = receivedColumns(entry, tableRows, ctx.schema, allowedFor(entry.dest));
  // Échange : une colonne effacée est recréée, comme avant (la destination repart vers l'autre document).
  const dropped = exchange ? [] : droppedColumns(received.entry, received.sent, ctx.schema.columns(received.entry.dest).map(c => c.colId));
  const kept = received.sent.filter(c => !dropped.some(([from]) => from === c.id));
  const added = addDestColumnsActions(ctx.schema, received.entry.dest, kept, received.entry.map);
  if (added.length) {
    await apply(added);
    ctx.schema = await readSchema();
  }
  entry = { ...received.entry, refs: destRefs(ctx.schema, received.entry.dest), dropped: dropped.length ? dropped.map(([, to]) => to) : undefined };
  const copyCols = copyColumns(received.sent.map(c => ({ colId: c.id })), ctx.schema.columns(entry.dest), entry.map);
  const types = Object.fromEntries(received.sent.map(c => [c.id, c.type]));
  // La destination n'est relue que si le journal de cette table a changé depuis le dernier
  // passage resté sans effet, ou pour y revoir les retouches (REREAD_MS).
  const key = tableKey(journal, entry.table);
  const signature = JSON.stringify([tableRows.map(r => r.id), copyCols, entry.match || '', entry.dest]);
  const was = settled.get(key);
  if (was && was.signature === signature && Date.now() - was.at < REREAD_MS && lastRead.has(key)) {
    return { entry, stats: { added: 0, updated: 0, removed: 0 }, copyCols, types, dropped, ...lastRead.get(key) };
  }
  const destRows = await fetchRows(entry.dest);
  const { actions, stats, gone } = planConsolidation({
    journalRows: tableRows, destRows, copyCols, destTable: entry.dest, journalTable: journal, matchCol: entry.match || '', exchange,
  });
  // Échange : la ligne 'echange' de l'export est touchée dans le même lot (voir syncFormulas) :
  // les lignes reçues ne repartent pas vers l'autre document.
  const written = stats.added + stats.updated + stats.removed > 0;
  await apply(swap && written ? [['UpdateRecord', SYNC_TABLE, swap.id, { [RESEND_COL]: randomHex(4) }], ...actions] : actions);
  if (actions.length) settled.delete(key);
  else settled.set(key, { signature, at: Date.now(), dest: entry.dest });
  const after = written ? await fetchRows(entry.dest) : destRows;
  lastRead.set(key, { numbers: rowNumbers(after), drift: manualEdits({ journalRows: tableRows, destRows: after, copyCols, exchange, except: gone }) });
  return { entry, stats, copyCols, types, dropped, ...lastRead.get(key) };
}

// Contexte de la recopie d'un journal. Échange : la ligne 'echange' de l'export et, côté du
// document qui a invité, les colonnes que son export envoie par table.
async function copyContext(schema, journal, note, groups) {
  const exchange = note.mode === 'echange';
  const rows = exchange ? await syncRows(schema) : [];
  const own = note.retour ? new Map(exportTables(rows, note.export).map(tb => [tb.table, new Set(tb.columns.map(c => c.id))])) : null;
  return {
    schema, journal, groups, exchange,
    swap: rows.find(r => r[EXPORT_COL] === note.export && r[TYPE_COL] === KIND.swap) || null,
    allowedFor: dest => (own ? own.get(dest) || new Set() : null),
  };
}

// Notes des tables changées (destination renommée, colonnes arrivées après coup). Échange, côté
// CIBLE : l'export de retour suit.
async function saveEntries(journal, note, updates) {
  if (!updates.size) return;
  const noted = ({ dest, map, match, refs, dropped, addedCols }) => JSON.parse(JSON.stringify({ dest, map, match, refs, dropped, addedCols }));
  const tables = note.tables.map(tb => (updates.has(tb.table) ? { ...tb, dropped: undefined, ...noted(updates.get(tb.table)) } : tb));
  await updateJournalNote(journal, n => ({ ...n, tables }));
  if (note.mode === 'echange' && !note.retour) await wireExchange({ ...note, tables });
}

// Retouches gardées pour la carte : les premières lignes, nommées, les colonnes effacées et les comptes.
const driftResult = (drift, labelCol, droppedCols) => ({
  drift: drift.slice(0, DRIFT_KEPT).map(({ n, row, cells, gone }) => ({ n, label: labelCol ? String(row[labelCol] ?? '') : '', cells, ...(gone ? { gone } : {}) })),
  droppedCols,
  driftCount: drift.reduce((sum, d) => sum + (d.gone ? 1 : d.cells.length), 0) + droppedCols.length,
  driftGone: drift.filter(d => d.gone).length,
});

// Ce que la carte montre d'une table : compteurs, colonne qui nomme les lignes, historique (dont
// les colonnes ajoutées par la SOURCE, `added`), valeurs retouchées à la main (`drift`).
function tableResult({ entry, stats, copyCols, types, numbers, drift, dropped, error }, groups) {
  if (error) return { table: entry.table, error };
  const labelCol = copyCols.some(([from]) => from === entry.label) ? entry.label : (copyCols[0] || [])[0];
  const recent = recentChanges(groups.get(entry.table) || [], labelCol, state.lastVisit, Infinity, { copyCols, numbers });
  const added = (entry.addedCols || []).filter(a => a.at > (state.lastVisit || 0));
  return { table: entry.table, stats, dest: entry.dest, copyCols, labelCol, labelCols: copyCols.map(([c]) => c), types, recent, added, ...driftResult(drift, labelCol, dropped) };
}

// « Corriger » : une table reçue reprend l'état exact de la SOURCE (la dernière version reçue de
// chaque ligne), relu au moment du clic : les colonnes effacées ici sont recréées, les lignes
// effacées reviennent, les cellules retouchées reprennent leur valeur. La carte suit aussitôt.
async function restoreSource(journal, table) {
  const key = tableKey(journal, table);
  const result = state.results.get(key);
  if (!result || !result.copyCols) return;
  const { dest, labelCol, types = {}, droppedCols = [] } = result;
  const copyCols = [...result.copyCols, ...droppedCols];
  await withLock('gristsync-consolidation', async () => {
    if (droppedCols.length) {
      const columns = droppedCols.map(([from]) => ({ id: from, type: types[from] || 'Any', label: from }));
      await apply(addDestColumnsActions(await readSchema(), dest, columns, Object.fromEntries(droppedCols)));
      await updateJournalNote(journal, n => ({ ...n, tables: n.tables.map(tb => (tb.table === table ? { ...tb, dropped: undefined } : tb)) }));
    }
    const journalRows = rowsByTable(expandRows(await fetchRows(journal))).get(table) || [];
    await apply(restoreActions(manualEdits({ journalRows, destRows: await fetchRows(dest), copyCols }), dest, copyCols));
    const after = await fetchRows(dest);
    const drift = manualEdits({ journalRows, destRows: after, copyCols });
    lastRead.set(key, { numbers: rowNumbers(after), drift });
    state.results.set(key, { ...state.results.get(key), copyCols, ...driftResult(drift, labelCol, []) });
  });
}

// Un passage sur un journal : déplier, recopier chaque table rangée, noter les tables proposées,
// nettoyer. Chaque étape est un seul lot d'écritures, donc tout ou rien.
async function consolidate(schema, { journal, note: noteBefore }) {
  if (noteBefore.mode === 'public' && await pull(noteBefore, journal)) lastArrival = Date.now();
  const { note, rows, left } = await unpack(journal, noteBefore);
  const groups = rowsByTable(expandRows(rows));
  const { pending, offers } = offersOf(groups, note);
  state.offers.set(journal, offers);
  const ctx = await copyContext(schema, journal, note, groups);
  const tables = [];
  for (const noted of note.tables) {
    const done = await copyTable(ctx, noted);
    tables.push({ ...done, changed: !done.error && JSON.stringify(done.entry) !== JSON.stringify(noted) });
  }
  await saveEntries(journal, note, new Map(tables.filter(tb => tb.changed).map(tb => [tb.entry.table, tb.entry])));
  const after = await fetchRows(journal);
  await apply(planPurge(after, journal, { keep: pending, drop: note.refused }));
  // Lignes reçues laissées pour le passage suivant : il vient sans attendre la minute.
  if (left) lastArrival = Date.now();
  const afterGroups = rowsByTable(expandRows(after));
  return { rows: after.length, note, tables: tables.map(tb => tableResult(tb, afterGroups)) };
}

// ---------------------------------------------------------------------------------------------
// Un passage sur tous les journaux

const summary = s => (s.added || s.updated || s.removed ? t('recv.result', s) : t('recv.result.none'));

// Résultat d'un passage noté pour l'onglet ; rend vrai si la carte change.
function notePass(journal, pass, before, offersBefore, at) {
  // Ce que la carte montre du journal : lignes manquantes, trop grosses, arrivées suspectes, fin.
  const gaps = JSON.stringify([pass.note.missing, pass.note.big, pass.note.suspect, pass.note.ended]);
  state.results.set(journal, { at, rows: pass.rows, gaps });
  let changed = !before || Boolean(before.error) || !before.rows !== !pass.rows || before.gaps !== gaps || offersBefore !== JSON.stringify(state.offers.get(journal) || []);
  for (const tb of pass.tables) {
    const key = tableKey(journal, tb.table);
    const was = state.results.get(key);
    state.results.set(key, tb.error ? { at, error: true, text: tb.error } : { at, text: summary(tb.stats), ...tb });
    changed ||= Boolean(tb.error) !== Boolean(was && was.error) || Boolean(tb.stats && tb.stats.added + tb.stats.updated + tb.stats.removed)
      || JSON.stringify([(was && was.drift) || [], (was && was.driftCount) || 0]) !== JSON.stringify([tb.drift || [], tb.driftCount || 0]);
  }
  return changed;
}

async function passAll() {
  let changed = false;
  lastPass = Date.now();
  let schema = await readSchema();
  let upgraded = false;
  for (const { journal } of receivedJournals(schema)) upgraded = (await upgradeJournal(schema, journal)) || upgraded;
  if (upgraded) schema = await readSchema();
  watch.tables = new Set(receivedJournals(schema).flatMap(r => [r.journal, ...r.note.tables.map(tb => tb.dest)]));
  watch.pull = receivedJournals(schema).some(r => r.note.mode === 'public');
  for (const received of receivedJournals(schema).filter(r => !awaitingPartner(r.note))) {
    const { journal } = received;
    const before = state.results.get(journal);
    const offersBefore = JSON.stringify(state.offers.get(journal) || []);
    const at = Date.now() / 1000;
    try {
      changed = notePass(journal, await consolidate(schema, received), before, offersBefore, at) || changed;
      state.readOnly = state.viewer;
      schema = await readSchema();
    } catch (e) {
      state.readOnly = state.viewer || isAccessError(e);
      state.results.set(journal, { ...before, at, text: errorText(e), error: true });
      changed ||= !(before && before.error);
    }
  }
  return changed;
}

// Un passage sur tous les journaux. Deux onglets du même navigateur ne recopient pas en même
// temps (verrou du navigateur) ; entre deux navigateurs, les écritures sont idempotentes.
// L'onglet n'est redessiné que si un passage a changé quelque chose. Rend vrai si c'est le cas,
// null si un passage était déjà en cours. `reread` : relire toutes les destinations.
async function consolidateAll({ reread = false } = {}) {
  if (busy) return null;
  busy = true;
  if (reread) settled.clear();
  let changed = false;
  try {
    await readLastVisit();
    changed = await withLock('gristsync-consolidation', passAll);
  } catch (e) {
    // Document illisible (droits, réseau) : la boucle continue, le prochain passage réessaie.
    if (isAccessError(e)) state.readOnly = true;
    console.warn(e);
  } finally {
    busy = false;
  }
  if (changed) await onChange();
  return changed;
}
return { state, tableKey, isAccessError, startAutoConsolidation, forgetJournal, restoreSource, consolidateAll };
})();

// ===== js/target/dest.js =====
__M["js/target/dest.js"] = (() => {
'use strict';
// CIBLE : destination d'une table reçue, nouvelle (nom libre) ou existante (liste filtrable). Une
// table existante passe ensuite par la correspondance des colonnes et le rattachement des lignes.
// Aussi : la fenêtre d'une table que la SOURCE ajoute à un export déjà reçu.
const { EXPORT_COL, KEY_COL, TABLE_COL, isUserTable, toTableId } = __M["js/logic/common.js"];
const { docIdentity, readSchema } = __M["js/grist.js"];
const { syncRows } = __M["js/source/synchro.js"];
const { wireExchange } = __M["js/exchange.js"];
const { destColumns, prepareDest, receivedDests, receivedJournals, updateJournalNote } = __M["js/target/journals.js"];
const { consolidateAll } = __M["js/target/loop.js"];
const { confirmDialog, el, message, openModal, pickField, run } = __M["js/ui.js"];
const { t } = __M["js/i18n.js"];

// Choix de la destination d'une table. `dest()` rend son nom : une table existante, ou le nom
// tapé (un nom qui est celui d'une table existante, aux majuscules près, désigne cette table).
function destField(schema, table) {
  const tables = schema.tableIds.filter(isUserTable);
  const name = el('input', { type: 'text', class: 'input', value: toTableId(table), 'aria-label': t('recv.dest.name', { table }) });
  const nameBox = el('div', { class: 'dest-pick' }, el('span', { class: 'muted small' }, t('recv.dest.nameLabel')), name);
  const field = pickField({
    label: table, value: '',
    items: [{ value: '', label: t('recv.dest.new') }, ...tables.map(id => ({ value: id, label: id }))],
    onChange: (v) => { nameBox.classList.toggle('hidden', v !== ''); },
  });
  const typed = () => toTableId(name.value, table);
  return { node: el('div', { class: 'dest-pick' }, field, nameBox), dest: () => field.value() || schema.resolve(typed()) || typed() };
}

// Colonne qui reçoit chaque colonne envoyée (la même, une autre, ou une nouvelle), et colonne
// commune qui rattache les lignes déjà là au lieu de les doubler. `read()` rend { map, match }.
function mappingBlock(schema, table, dest, columns) {
  const destCols = schema.columns(dest).filter(c => !c.isFormula && c.colId !== KEY_COL).map(c => c.colId);
  const maps = destColumns(columns).map(c => ({
    id: c.id,
    field: pickField({
      label: c.id, value: destCols.includes(c.id) ? c.id : '',
      items: [...(destCols.includes(c.id) ? [] : [{ value: '', label: t('recv.col.new', { col: c.id }) }]), ...destCols.map(d => ({ value: d, label: d }))],
    }),
  }));
  const match = pickField({
    label: t('recv.match'), value: '',
    items: [{ value: '', label: t('recv.match.none') }, ...destCols.map(d => ({ value: d, label: d }))],
  });
  const node = el('div', { class: 'form' },
    el('h3', {}, `${table} → ${dest}`),
    ...maps.map(m => el('div', { class: 'dest-row' }, el('span', {}, `${m.id} →`), m.field)),
    el('label', {}, t('recv.match')), match,
    el('p', { class: 'muted small' }, t('recv.match.help')));
  const read = () => {
    const map = Object.fromEntries(maps.map(m => [m.id, m.field.value() || m.id]));
    const targets = Object.values(map);
    if (new Set(targets).size !== targets.length) throw new Error('mapTwice');
    if (match.value() && !targets.includes(match.value())) throw new Error('matchUnmapped');
    return { map, match: match.value() };
  };
  return { node, read };
}

// Une destination ne reçoit qu'une table, d'un seul export, et n'est ni une table du widget, ni
// une table que ce document envoie lui-même (ses lignes, absentes des listes de la SOURCE, y
// seraient effacées ; le relais, lui, reçoit d'abord puis envoie). Copie dans le même document :
// une table ne peut pas se recevoir elle-même (`plans` : [{ table, dest }]). Échange (`exportId`) :
// une table que ce document envoie dans le même Échange peut recevoir.
async function checkDests(schema, plans, fromDocId, exportId = null) {
  const taken = receivedDests(schema).map(d => d.dest);
  const dests = plans.map(p => p.dest);
  if (new Set(dests).size !== dests.length || dests.some(d => taken.includes(d) || !isUserTable(d))) throw new Error('destTaken');
  const sent = new Set((await syncRows(schema)).filter(r => !exportId || r[EXPORT_COL] !== exportId).map(r => r[TABLE_COL]));
  if (dests.some(d => sent.has(d))) throw new Error('destExported');
  if (fromDocId && fromDocId === (await docIdentity()).docId && plans.some(p => p.dest === p.table)) throw new Error('loop');
}

// ---------------------------------------------------------------------------------------------
// Table ajoutée par la SOURCE à un export reçu : la ranger (nouvelle table ou existante), la
// refuser (ses lignes sont effacées du journal à mesure qu'elles arrivent), ou plus tard.
// `onDone` : appelé une fois la table rangée ou refusée (l'onglet se redessine).

async function offerDialog(group, offer, onDone) {
  const schema = await readSchema();
  const pick = destField(schema, offer.table);
  const report = el('div', { class: 'report' });
  const step = el('div', { class: 'form' });
  const exchange = group.note.mode === 'echange';
  const finish = async (m) => {
    m.close();
    await consolidateAll();
    await onDone();
  };
  const accept = async (entry, m) => {
    await prepareDest({ dest: entry.dest, columns: offer.columns, map: entry.map });
    // Deux éditeurs qui rangent la même table : la première réponse compte.
    await updateJournalNote(group.journal, note => (note.tables.some(tb => tb.table === entry.table) ? note : { ...note, tables: [...note.tables, entry] }));
    // Échange, côté CIBLE : la table rangée repart aussi vers la SOURCE.
    if (exchange && !group.note.retour) await wireExchange(receivedJournals(await readSchema()).find(r => r.journal === group.journal).note);
    await finish(m);
  };
  const refuse = async (m) => {
    if (!(await confirmDialog({ title: t('recv.offer.refuseTitle', { table: offer.table }), body: t('recv.offer.refuseBody'), confirmLabel: t('recv.offer.refuse') }))) return;
    await updateJournalNote(group.journal, note => ({ ...note, refused: [...(note.refused || []), offer.table] }));
    await finish(m);
  };
  // Table existante : correspondance des colonnes avant de ranger.
  const choose = async (m) => {
    const dest = pick.dest();
    await checkDests(schema, [{ table: offer.table, dest }], (group.note.from || {}).docId, exchange ? group.note.export : null);
    const entry = { table: offer.table, dest, columns: offer.columns };
    if (!schema.has(dest)) return accept(entry, m);
    const mapping = mappingBlock(schema, offer.table, dest, offer.columns);
    step.replaceChildren(el('p', {}, t('recv.existing')), mapping.node);
    m.setButtons([{ label: t('common.back'), onClick: () => { step.replaceChildren(first); m.setButtons(buttons); } },
      { label: t('recv.offer.accept'), kind: 'btn-primary', onClick: mm => run(null, report, () => {
        const { map, match } = mapping.read();
        return accept({ ...entry, map, ...(match ? { match } : {}) }, mm);
      }) }]);
    return null;
  };
  const first = el('div', { class: 'form' },
    message('info', t('recv.offer.body', { name: group.note.name, table: offer.table, n: offer.n, cols: offer.columns.map(c => c.id).join(', ') })),
    el('label', {}, t('recv.offer.where')), pick.node);
  step.replaceChildren(first);
  const buttons = [
    { label: t('common.later') },
    { label: t('recv.offer.refuse'), kind: 'btn-danger-text', onClick: m => run(null, report, () => refuse(m)) },
    { label: t('recv.offer.accept'), kind: 'btn-primary', onClick: m => run(null, report, () => choose(m)) },
  ];
  openModal({ title: t('recv.offer.title', { table: offer.table }), body: [step, report], buttons });
}
return { destField, mappingBlock, checkDests, offerDialog };
})();

// ===== js/target/wizard.js =====
__M["js/target/wizard.js"] = (() => {
'use strict';
// CIBLE : assistant de réception, en quatre étapes (Code, Destinations, Lien, Réponse). Une
// réception en attente (ou à rebrancher) l'ouvre directement à l'étape Lien (`group`).
const { APPLIED_COL, AUTHOR_COL, JOURNAL_PREFIX, LIST_COL, freeTableId, toTableId } = __M["js/logic/common.js"];
const { buildReply, buildWebhookUrl, parseFormLink, parseInvitation } = __M["js/logic/codes.js"];
const { apply, docIdentity, fetchRows, isOwner, readSchema } = __M["js/grist.js"];
const { ensureForm, removeTechnicalTables } = __M["js/pages.js"];
const { formWhere, linkFigures, testUrl } = __M["js/form-link.js"];
const { wireExchange } = __M["js/exchange.js"];
const { createJournal, prepareDest, receivedJournals, updateJournalNote } = __M["js/target/journals.js"];
const { consolidateAll } = __M["js/target/loop.js"];
const { checkDests, destField, mappingBlock } = __M["js/target/dest.js"];
const { confirmDialog, copyButton, copyField, el, message, openWizard, run } = __M["js/ui.js"];
const { handoffText, roleGuide } = __M["js/guide.js"];
const { t } = __M["js/i18n.js"];

const STEP = { code: 0, dest: 1, link: 2, reply: 3 };
const cancel = { label: t('common.cancel') };
const back = onClick => ({ label: t('common.back'), back: true, onClick });
const flowOf = note => (note.mode === 'echange' ? 'echange' : 'reponse');

// `onClose` : appelé à la fermeture (l'onglet se redessine).
function receiveWizard(group, onClose) {
  const steps = ['recv.step.code', 'recv.step.dest', 'recv.step.link', 'recv.step.reply'].map(k => t(k));
  const ctx = { steps, onClose, wizard: openWizard({ title: t('recv.new'), steps, onClose }) };
  return group ? showLink(ctx, group) : showCode(ctx);
}

// 1. Code d'invitation.
function showCode(ctx) {
  const area = el('textarea', { class: 'code', rows: 4, spellcheck: 'false', 'aria-label': t('recv.invite.title') });
  const report = el('div', { class: 'report' });
  const next = async () => {
    const invitation = await readInvitation(area.value);
    const known = receivedJournals(await readSchema()).find(r => r.note.export === invitation.export);
    return known ? showRelink(ctx, known, invitation) : showDest(ctx, invitation);
  };
  ctx.wizard.show(STEP.code, [el('p', {}, t('recv.invite.help')), area, report, roleGuide({ you: 'target', current: 1 })],
    [cancel, { label: t('common.next'), kind: 'btn-primary', onClick: () => run(null, report, next) }]);
}

// Invitation lue et contrôlée : même instance que ce document ; un Échange suppose un propriétaire
// (ce document enverra aussi, par un webhook).
async function readInvitation(text) {
  const invitation = parseInvitation(text);
  const { origin } = await docIdentity();
  if (invitation.mode === 'public' && new URL(invitation.base).origin !== origin) throw new Error('otherInstance');
  if (invitation.mode === 'echange' && invitation.retourOrigin !== origin) throw new Error('otherInstance');
  if (invitation.mode === 'echange' && !(await isOwner())) throw new Error('exchangeOwner');
  return invitation;
}

// Nouvelle invitation pour un export déjà reçu (lien coupé, destinataire révoqué) : la même
// réception reprend, avec son journal et ses tables, si l'invitation vient du même document, dans
// le même mode. La fiche est montrée avant : la personne confirme que c'est bien la même SOURCE.
// Un Échange rebranche son retour sur la nouvelle adresse.
function showRelink(ctx, known, invitation) {
  const same = invitation.mode !== 'public' && invitation.mode === (known.note.mode || 'reponse') && !known.note.retour
    && (known.note.from || {}).docId === invitation.from.docId;
  if (!same) throw new Error('alreadyReceived');
  const report = el('div', { class: 'report' });
  const relink = async () => {
    const { id, secret, name, from } = invitation;
    await updateJournalNote(known.journal, n => ({ ...n, id, secret, name, from }));
    const note = receivedJournals(await readSchema()).find(r => r.journal === known.journal).note;
    if (invitation.mode === 'echange') await wireExchange(note, invitation.retour);
    await ensureForm(known.journal);
    return showLink(ctx, { journal: known.journal, note }, message('info', t('recv.relink')));
  };
  ctx.wizard.show(STEP.dest, [message('info', t('recv.relink.confirm', { name: known.note.name, journal: known.journal })), sourceFiche(invitation), report],
    [back(() => showCode(ctx)), cancel, { label: t('recv.relink.ok'), kind: 'btn-primary', onClick: () => run(null, report, relink) }]);
}

// D'où vient une invitation : export, tables, personne et document qui l'ont faite.
function sourceFiche(invitation) {
  const { from } = invitation;
  return el('div', {},
    message('info', t('recv.invite.summary', { name: invitation.name, n: invitation.tables.length, tables: invitation.tables.map(tb => tb.table).join(', ') })),
    from.email ? el('p', { class: 'small' }, t(from.docId ? 'recv.fromDoc' : 'recv.from', { from: from.email, doc: from.docId })) : null);
}

// 2. Destinations : une par table reçue.
async function showDest(ctx, invitation) {
  const schema = await readSchema();
  const rows = invitation.tables.map(tb => ({ tb, pick: destField(schema, tb.table) }));
  const report = el('div', { class: 'report' });
  const next = async () => {
    const current = await readSchema();
    const plans = rows.map(({ tb, pick }) => ({ tb, dest: pick.dest() }));
    await checkDests(current, plans.map(p => ({ table: p.tb.table, dest: p.dest })), invitation.from.docId);
    if (plans.some(p => current.has(p.dest))) return showColumns(ctx, invitation, plans, current);
    return create(ctx, invitation, plans);
  };
  ctx.wizard.show(STEP.dest, [
    sourceFiche(invitation),
    el('p', {}, t('recv.dest')),
    el('div', { class: 'dest-grid' }, el('span', { class: 'dest-head' }, t('recv.dest.from')), el('span', { class: 'dest-head' }, t('recv.dest.to')),
      ...rows.flatMap(r => [el('span', { class: 'dest-from' }, r.tb.table), r.pick.node])),
    invitation.mode === 'echange' ? message('info', t('recv.consent.echange')) : null,
    el('p', { class: 'muted small' }, t(invitation.mode === 'public' ? 'recv.consent.public' : 'recv.consent')),
    report, roleGuide({ you: 'target', mode: invitation.mode, current: 1 }),
  ], [back(() => showCode(ctx)), cancel, { label: t('common.next'), kind: 'btn-primary', onClick: () => run(null, report, next) }]);
}

// 2 bis. Tables existantes : correspondance des colonnes et rattachement.
function showColumns(ctx, invitation, plans, schema) {
  const report = el('div', { class: 'report' });
  const blocks = plans.filter(p => schema.has(p.dest)).map(p => ({ p, block: mappingBlock(schema, p.tb.table, p.dest, p.tb.columns) }));
  const next = () => {
    for (const { p, block } of blocks) Object.assign(p, block.read());
    return create(ctx, invitation, plans);
  };
  ctx.wizard.show(STEP.dest, [el('p', {}, t('recv.existing')), ...blocks.map(b => b.block.node), report], [
    back(() => showDest(ctx, invitation)),
    { label: t('recv.create'), kind: 'btn-primary', onClick: () => run(null, report, next) },
  ]);
}

// Un journal pour l'export, nommé d'après lui, et une destination par table. Échange : l'envoi de
// retour est branché aussitôt ; l'adresse de retour, un droit d'écriture, n'est notée nulle part.
async function create(ctx, invitation, plans) {
  const journal = freeTableId(JOURNAL_PREFIX + toTableId(invitation.name, 'Export'), (await readSchema()).tableIds);
  const { mode } = invitation;
  const note = {
    id: invitation.id, export: invitation.export, name: invitation.name, secret: invitation.secret, from: invitation.from,
    ...(mode === 'public' ? { mode, base: invitation.base } : mode === 'echange' ? { mode } : {}),
    tables: plans.map(p => ({ table: p.tb.table, dest: p.dest, columns: p.tb.columns, ...(p.map ? { map: p.map } : {}), ...(p.match ? { match: p.match } : {}) })),
    refused: [], missing: {},
  };
  const before = await readSchema();
  for (const p of plans) await prepareDest({ dest: p.dest, columns: p.tb.columns, map: p.map });
  await createJournal(journal, note);
  ctx.made = mode === 'reponse' || !mode ? { invitation, journal, tables: plans.map(p => p.dest).filter(d => !before.has(d)) } : null;
  if (mode === 'echange') await wireExchange(note, invitation.retour);
  if (mode !== 'public') {
    await ensureForm(journal);
    return showLink(ctx, { journal, note });
  }
  ctx.wizard.setSteps(ctx.steps.slice(0, 2));
  ctx.wizard.show(STEP.link, [message('ok', t('recv.public.done')), roleGuide({ you: 'target', mode: 'public', current: 1 })], [{ label: t('common.close'), kind: 'btn-primary' }]);
  consolidateAll();
  return null;
}

// 3. Lien du formulaire de réception.
async function showLink(ctx, group, intro = null) {
  const input = el('input', { type: 'url', class: 'input', spellcheck: 'false', 'aria-label': t('recv.link.title') });
  const report = el('div', { class: 'report' });
  const where = await formWhere(group.journal);
  const made = ctx.made && ctx.made.journal === group.journal ? ctx.made : null;
  ctx.wizard.show(STEP.link, [intro, el('p', {}, t('recv.link.help', { where, n: group.note.tables.length })),
    ...linkFigures(), input, report, roleGuide({ you: 'target', mode: flowOf(group.note), current: 2 })],
  [made ? back(() => run(null, report, () => undoCreate(ctx, made))) : null, { label: t('common.later') },
    { label: t('recv.link.check'), kind: 'btn-primary', onClick: () => run(null, report, () => showReply(ctx, group, input.value)) }].filter(Boolean));
}

// Retour aux destinations depuis l'étape Lien : le journal et son formulaire (avec son lien
// d'écriture) sont effacés, et les tables que cette réception a créées, si elles sont encore vides.
async function undoCreate(ctx, made) {
  if (!(await confirmDialog({ title: t('recv.undo.title'), body: t('recv.undo.body'), confirmLabel: t('common.back') }))) return null;
  const empty = [];
  for (const table of made.tables) if (!(await fetchRows(table).catch(() => [null])).length) empty.push(table);
  await removeTechnicalTables([made.journal]);
  await apply(empty.map(table => ['RemoveTable', table]));
  ctx.made = null;
  return showDest(ctx, made.invitation);
}

// 4. Réponse à renvoyer, une fois le lien vérifié.
async function showReply(ctx, { journal, note }, link) {
  if (!parseFormLink(link)) throw new Error('formLink');
  const url = buildWebhookUrl(link, journal);
  await testUrl(url, journal);
  const identity = await docIdentity();
  const code = buildReply({
    id: note.id, secret: note.secret, url, retour: note.mode === 'echange' ? note.tables.map(tb => ({ table: tb.dest, dest: tb.table })) : null,
    recipient: { email: await myEmail(journal), docId: identity.docId, team: identity.team, at: new Date().toISOString().slice(0, 16).replace('T', ' ') },
  });
  const flow = flowOf(note);
  ctx.wizard.show(STEP.reply, [message('ok', t('recv.link.ok')), el('p', {}, t('recv.reply.help')), copyField(code),
    el('div', { class: 'handoff' }, copyButton(() => handoffText('source', flow, 3, code), t('guide.copyHandoff')), el('span', { class: 'muted small' }, t('guide.copyHandoff.help'))),
    roleGuide({ you: 'target', mode: flow, current: 3 })],
  [back(() => showLink(ctx, { journal, note })), { label: t('common.close'), kind: 'btn-primary' }]);
}

// E-mail de la personne connectée, calculé par le serveur Grist : une ligne vide ajoutée au
// journal avec ses droits remplit la colonne Sync_Par (formule user.Email). Le nettoyage l'efface.
async function myEmail(journal) {
  const id = (await apply([['AddRecord', journal, null, { [APPLIED_COL]: true, [LIST_COL]: '' }]])).retValues[0];
  return ((await fetchRows(journal)).find(r => r.id === id) || {})[AUTHOR_COL] || '';
}
return { receiveWizard };
})();

// ===== js/target/tab.js =====
__M["js/target/tab.js"] = (() => {
'use strict';
// Onglet « Recevoir » (document CIBLE) : une carte par export reçu, avec ses tables, ce qui manque,
// les arrivées suspectes, les valeurs retouchées à la main et l'historique des changements. Un
// journal encore vide attend son lien.
const { isBlank } = __M["js/logic/common.js"];
const { STATES, awaitingPartner } = __M["js/logic/journal.js"];
const { fetchRows, isReadOnly, readSchema } = __M["js/grist.js"];
const { dropPages, ensureForm, formPages, removeTechnicalTables, renewFormLink } = __M["js/pages.js"];
const { endExchange } = __M["js/exchange.js"];
const { legacyJournals, receivedJournals, updateJournalNote } = __M["js/target/journals.js"];
const { consolidateAll, forgetJournal, isAccessError, restoreSource, state, tableKey } = __M["js/target/loop.js"];
const { offerDialog } = __M["js/target/dest.js"];
const { receiveWizard } = __M["js/target/wizard.js"];
const { confirmDialog, el, errorText, icon, message, openModal, pickField, run } = __M["js/ui.js"];
const { roleGuide } = __M["js/guide.js"];
const { LANG, dateText, t } = __M["js/i18n.js"];

const HISTORY_MAX = 20;
const DRIFT_MAX = 10;
let container;
let wizardOpened = false; // l'assistant ne se rouvre seul qu'une fois par chargement
const offered = new Set(); // tables déjà proposées en fenêtre pendant ce chargement
// Historiques et lignes d'historique ouverts : repliés par défaut, ils le restent d'un dessin à
// l'autre de l'onglet (un passage qui change quelque chose le redessine).
const opened = new Set();
const keepOpen = id => e => (e.currentTarget.open ? opened.add(id) : opened.delete(id));

// Redessine l'onglet s'il est affiché (un passage de la recopie a changé quelque chose).
async function refreshTarget() {
  if (container && container.isConnected) await renderTarget();
}

// Réceptions à montrer. Le journal de retour d'un Échange se règle depuis l'onglet Envoyer : il
// n'attend jamais son lien ici. `shared` : autres formulaires atteints par la même clé.
async function receivedGroups(schema) {
  const forms = await formPages();
  const groups = [];
  for (const { journal, note } of receivedJournals(schema).filter(r => !awaitingPartner(r.note))) {
    const known = state.results.get(journal);
    const rows = known ? known.rows : (await fetchRows(journal)).length;
    const waiting = note.mode !== 'public' && !note.retour && !rows;
    groups.push({ journal, note, public: note.mode === 'public', waiting, shared: (forms.get(journal) || {}).shared || 0 });
  }
  return groups;
}

const button = (label, iconName, onclick, kind = '') => el('button', { class: `btn btn-small ${kind}`, type: 'button', disabled: state.readOnly, onclick }, icon(iconName), label);

async function renderTarget(root = container) {
  if (!container) state.viewer = isReadOnly();
  container = root;
  state.readOnly ||= state.viewer;
  const schema = await readSchema();
  const groups = await receivedGroups(schema);
  // Formulaire des exports en attente, chacun sur sa page.
  const out = el('div', { class: 'out' });
  try {
    for (const group of groups.filter(g => g.waiting)) await ensureForm(group.journal);
  } catch (e) {
    if (isAccessError(e)) state.readOnly = true; // un lecteur ne peut pas publier le formulaire
    else out.append(message('err', errorText(e)));
  }
  const legacy = legacyJournals(schema);
  const sync = async () => { if ((await consolidateAll({ reread: true })) === false) out.replaceChildren(message('ok', t('recv.sync.none'))); };
  const toolbar = el('div', { class: 'toolbar' },
    el('button', { class: 'btn btn-primary', type: 'button', disabled: state.readOnly, onclick: () => receiveWizard(null, renderTarget) }, icon('plus'), t('recv.new')),
    el('button', { class: 'btn', type: 'button', disabled: state.readOnly || !groups.length, onclick: e => run(e.currentTarget, out, sync) }, icon('refresh'), t('recv.action.sync')));
  const cards = groups.map(safeCard);
  if (legacy.length) cards.push(legacyCard(legacy, out));
  container.replaceChildren(...[toolbar,
    state.readOnly ? message('warn', t('common.readonly')) : null,
    out,
    cards.length ? el('div', { class: 'cards' }, cards, el('p', { class: 'muted small' }, t('recv.auto'))) : el('p', { class: 'muted' }, t('recv.empty')),
    roleGuide({ you: 'target' })].filter(Boolean));
  if (!state.readOnly) await openPending(groups);
}

// Ouvre seul, une fois par chargement : l'assistant d'une réception qui attend son lien, sinon la
// fenêtre d'une table ajoutée par la SOURCE.
async function openPending(groups) {
  dropPages(groups.map(g => g.journal)).catch(() => {});
  if (document.querySelector('.scrim')) return;
  const waiting = groups.find(g => g.waiting);
  if (waiting && !wizardOpened) {
    wizardOpened = true;
    receiveWizard(waiting, renderTarget);
    return;
  }
  for (const group of groups) {
    const offer = (state.offers.get(group.journal) || []).find(o => !offered.has(tableKey(group.journal, o.table)));
    if (!offer) continue;
    offered.add(tableKey(group.journal, offer.table));
    offerDialog(group, offer, renderTarget);
    return;
  }
}

function cardStatus(group) {
  const { journal, note } = group;
  if (group.waiting) return ['waiting', 'pending'];
  if (note.ended) return ['ended', 'off'];
  if ((state.results.get(journal) || {}).error || note.tables.some(tb => (state.results.get(tableKey(journal, tb.table)) || {}).error)) return ['error', 'err'];
  return Object.keys({ ...note.missing, ...note.big }).length ? ['incomplete', 'pending'] : ['ok', 'ok'];
}

// Une table reçue : origine → destination, heure du dernier passage, ou l'erreur. Le détail des
// changements est dans l'historique.
function tableLine(group, entry) {
  const journalResult = state.results.get(group.journal) || {};
  const result = state.results.get(tableKey(group.journal, entry.table)) || (journalResult.error ? journalResult : null);
  const detail = result && !group.waiting ? ` · ${new Date(result.at * 1000).toLocaleTimeString(LANG)}${result.error ? ` · ${result.text}` : ''}` : '';
  return el('p', { class: `small ${result && result.error ? 'text-danger' : 'muted'}` }, `${entry.table} → ${entry.dest}${detail}`);
}

// Avis d'une réception : envoi coupé par la SOURCE, lignes manquantes, trop grosses, instantané
// trop gros, lien partagé, arrivées suspectes, tables proposées ou refusées.
function cardNotes(group) {
  const { note } = group;
  return [
    note.ended ? message('warn', t('recv.ended', { at: dateText(note.ended * 1000) })) : null,
    Object.entries(note.missing || {}).map(([table, n]) => message('warn', t('recv.missing', { table, n }))),
    Object.entries(note.big || {}).map(([table, keys]) => message('warn', t('recv.big', { table, n: keys.length }))),
    (note.tooBig || []).length ? message('warn', t('recv.tooBig', { tables: note.tooBig.join(', ') })) : null,
    group.shared && !group.public ? alertBlock(t('recv.shared.title'), [t('recv.shared.body', { n: group.shared })], [button(t('recv.suspect.cut'), 'unlink', () => cutLink(group), 'btn-danger-text')]) : null,
    note.suspect ? suspectBlock(group) : null,
    (state.offers.get(group.journal) || []).map(o => el('div', { class: 'offer' }, el('span', { class: 'small' }, t('recv.offer.line', { table: o.table, n: o.n })),
      button(t('recv.offer.place'), 'plus', () => offerDialog(group, o, renderTarget), 'btn-primary'))),
    note.refused.length ? el('p', { class: 'muted small' }, t('recv.offer.refusedList', { tables: note.refused.join(', ') })) : null,
  ];
}

function syncCard(group) {
  const { note } = group;
  const [status, tone] = cardStatus(group);
  const from = (note.from || {}).email;
  const fromDoc = (note.from || {}).docId || '';
  return el('article', { class: 'card', 'data-journal': group.journal },
    el('div', { class: 'card-head' }, el('strong', {}, note.name), el('span', { class: `pill pill-${tone}` }, t(`recv.status.${status}`))),
    from ? el('p', { class: 'small' }, t(fromDoc ? 'recv.fromDoc' : 'recv.from', { from, doc: fromDoc })) : null,
    group.public ? el('p', { class: 'muted small' }, t('recv.public')) : null,
    note.mode === 'echange' ? el('p', { class: 'muted small' }, t('recv.exchange')) : null,
    note.tables.map(entry => tableLine(group, entry)),
    cardNotes(group),
    note.tables.map(entry => driftBlock(group, entry)),
    group.waiting ? null : history(group),
    el('div', { class: 'card-actions' },
      group.public || note.retour ? null : button(t(group.waiting ? 'recv.action.continue' : 'recv.action.link'), 'link', () => receiveWizard(group, renderTarget), group.waiting ? 'btn-primary' : ''),
      button(t('recv.action.stop'), 'stop', () => stopReceiving(group), 'btn-danger-text')));
}

// Une carte qui ne se dessine pas (journal abîmé, ligne forgée) n'emporte pas tout l'onglet : elle
// garde son nom, l'erreur, et de quoi couper le lien ou arrêter la réception.
function safeCard(group) {
  try {
    return syncCard(group);
  } catch (e) {
    console.error(e);
    return el('article', { class: 'card', 'data-journal': group.journal },
      el('div', { class: 'card-head' }, el('strong', {}, String(group.note.name || group.journal)), el('span', { class: 'pill pill-err' }, t('recv.status.error'))),
      message('err', errorText(e)),
      el('div', { class: 'card-actions' },
        group.public ? null : button(t('recv.suspect.cut'), 'unlink', () => cutLink(group), 'btn-danger-text'),
        button(t('recv.action.stop'), 'stop', () => stopReceiving(group), 'btn-danger-text')));
  }
}

const alertBlock = (title, lines, actions) => el('div', { class: 'msg msg-warn suspect', role: 'status' },
  el('strong', {}, title), lines.filter(Boolean).map(line => el('p', { class: 'small' }, line)), el('div', { class: 'card-actions' }, actions));

// Arrivées suspectes : lignes rejetées (elles ne pouvaient pas venir du webhook de cet export) et
// arrivée anormale. Le lien du formulaire est peut-être connu d'un autre : on peut le couper.
function suspectBlock(group) {
  const { n = 0, at, flood } = group.note.suspect;
  const dismiss = async (e) => {
    e.currentTarget.disabled = true;
    await updateJournalNote(group.journal, ({ suspect, ...note }) => note);
    await renderTarget();
  };
  return alertBlock(t('recv.suspect.title'), [
    n ? t('recv.suspect.rejected', { n, at: dateText(at * 1000) }) : null,
    flood ? t('recv.suspect.flood', { at: dateText(flood * 1000) }) : null,
    t('recv.suspect.help'),
  ], [button(t('recv.suspect.cut'), 'unlink', () => cutLink(group), 'btn-danger-text'), button(t('recv.suspect.dismiss'), 'check', dismiss)]);
}

// Couper le lien : le formulaire de cette réception prend une nouvelle clé, sur sa propre page. La
// SOURCE révoque l'ancien destinataire et envoie une nouvelle invitation, acceptée ici sur la même
// réception.
async function cutLink(group) {
  if (!(await confirmDialog({ title: t('recv.cut.title'), body: t('recv.cut.body'), confirmLabel: t('recv.suspect.cut') }))) return;
  await updateJournalNote(group.journal, ({ suspect, ...note }) => note);
  await renewFormLink(group.journal);
  await renderTarget();
  container.querySelector('.out').replaceChildren(message('ok', t('recv.cut.done')));
}

// Réceptions d'avant la version 0.4 (un journal par table) : à refaire avec la SOURCE.
function legacyCard(journals, out) {
  const clean = async () => {
    if (!(await confirmDialog({ title: t('recv.legacy.title'), body: t('recv.legacy.confirm'), confirmLabel: t('recv.legacy.clean') }))) return;
    await removeTechnicalTables(journals);
    await renderTarget();
  };
  return el('article', { class: 'card' },
    el('div', { class: 'card-head' }, el('strong', {}, t('recv.legacy.title')), el('span', { class: 'pill pill-pending' }, t('send.status.legacy'))),
    el('p', { class: 'small' }, t('recv.legacy.body', { tables: journals.join(', ') })),
    el('div', { class: 'card-actions' }, button(t('recv.legacy.clean'), 'trash', e => run(e.currentTarget, out, clean), 'btn-danger-text')));
}

// Arrêter de recevoir : efface le journal (et son formulaire, donc la clé d'écriture) ; les tables
// de destination et leurs lignes restent. Un Échange s'arrête dans les deux sens (voir endExchange).
async function stopReceiving(group) {
  const { note } = group;
  const exchange = note.mode === 'echange';
  const body = t(exchange ? 'send.revoke.exchange' : 'recv.stop.body', { journal: group.journal });
  if (!(await confirmDialog({ title: t('recv.stop.title', { name: note.name }), body, confirmLabel: t('recv.action.stop') }))) return;
  if (exchange) await endExchange(note.export, { keepExport: Boolean(note.retour) });
  else await removeTechnicalTables([group.journal]);
  forgetJournal(group.journal);
  await renderTarget();
}

// ---------------------------------------------------------------------------------------------
// Valeurs en petit tableau, comme dans une vue Grist.

// Texte d'une valeur reçue ou lue dans la destination : liste de choix, date, case à cocher.
function cellText(value, type = '') {
  if (Array.isArray(value)) return value[0] === 'L' ? value.slice(1).join(', ') : JSON.stringify(value);
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (typeof value === 'number' && /^Date/.test(type)) {
    const zone = type.startsWith('DateTime:') ? type.slice(9) : 'UTC';
    try {
      const date = new Date(value * 1000);
      return type.startsWith('DateTime') ? date.toLocaleString(LANG, { timeZone: zone }) : date.toLocaleDateString(LANG, { timeZone: 'UTC' });
    } catch (e) { /* fuseau inconnu : la valeur brute */ }
  }
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
}

const cell = (value, type, kind = '') => {
  if (isBlank(value)) return el('td', { class: `${kind} mg-blank` }, t('common.blank'));
  const text = cellText(value, type);
  return el('td', { class: kind, title: text }, text);
};

const miniGrid = (head, rows) => el('div', { class: 'mini-grid-wrap' }, el('table', { class: 'mini-grid' },
  el('thead', {}, el('tr', {}, head.map(h => el('th', { scope: 'col' }, h)))), el('tbody', {}, rows)));

// Retouches faites à la main dans une destination : colonnes reçues effacées, cellules qui
// diffèrent de la dernière version reçue (avec leur numéro de ligne), lignes reçues effacées. Elles
// restent jusqu'à ce que la SOURCE change leur ligne, ou que l'on clique sur « Corriger ».
function driftBlock(group, entry) {
  const result = state.results.get(tableKey(group.journal, entry.table)) || {};
  const total = result.driftCount || 0;
  if (!total) return null;
  const types = result.types || {};
  const said = (text, span) => el('td', { class: 'mg-here', colspan: String(span) }, text);
  const rows = [
    ...(result.droppedCols || []).map(([, to]) => el('tr', {}, el('td', {}), el('td', {}), el('td', {}, to), said(t('recv.drift.colGone'), 2))),
    ...(result.drift || []).flatMap(d => (d.gone
      ? [el('tr', {}, el('td', { class: 'mg-n' }), el('td', { title: d.label }, d.label), said(t('recv.drift.rowGone'), 3))]
      : d.cells.map(([from, to, here, source]) => el('tr', {}, el('td', { class: 'mg-n' }, d.n ? String(d.n) : ''), el('td', { title: d.label }, d.label),
        el('td', {}, to), cell(here, types[from], 'mg-here'), cell(source, types[from], 'mg-source'))))),
  ].slice(0, DRIFT_MAX);
  return el('div', { class: 'msg msg-warn drift', role: 'status' },
    el('strong', {}, t('recv.drift.title', { dest: entry.dest, n: total })),
    el('p', { class: 'small' }, t('recv.drift.body', { n: total })),
    miniGrid([t('recv.drift.row'), result.labelCol || '', t('recv.drift.col'), t('recv.drift.here'), t('recv.drift.source')], rows),
    total > rows.length ? el('p', { class: 'small' }, t('recv.history.more', { n: total - rows.length })) : null,
    el('div', { class: 'card-actions' }, button(t('recv.drift.fix'), 'check', e => run(e.currentTarget, container.querySelector('.out'), () => correct(group, entry, result)))));
}

// « Corriger » : la table reprend l'état exact de la SOURCE, après confirmation.
async function correct(group, entry, { driftCount, driftGone = 0, droppedCols = [] }) {
  const body = [t('recv.drift.fixBody', { n: driftCount }), driftGone ? t('recv.drift.fixRows', { n: driftGone }) : '',
    droppedCols.length ? t('recv.drift.fixCols', { n: droppedCols.length }) : ''].filter(Boolean).join(' ');
  if (!(await confirmDialog({ title: t('recv.drift.fixTitle', { dest: entry.dest }), body, confirmLabel: t('recv.drift.fix') }))) return;
  await restoreSource(group.journal, entry.table);
  await renderTarget();
}

// ---------------------------------------------------------------------------------------------
// Historique : lignes changées depuis la visite précédente, par table de destination : compteurs
// par état (ajoutées, modifiées, supprimées, et colonnes ajoutées par la SOURCE), puis les plus
// récentes (HISTORY_MAX par table),
// numérotées comme dans la table et nommées par la colonne choisie pour chaque table. Chacune
// s'ouvre au clic sur son avant et son après. Tout est replié par défaut.

const STATE_ICON = { ajout: 'plus', modif: 'edit', suppression: 'minus', colonne: 'column' };
const COUNTED = [...STATES, 'colonne'];

function stateCounts(items) {
  return el('span', { class: 'history-counts' }, COUNTED.map((st) => {
    const n = items.filter(c => c.state === st).length;
    return n ? el('span', { class: `chg chg-${st}` }, icon(STATE_ICON[st]), t(`recv.history.n.${st}`, { n })) : null;
  }));
}

function when(at) {
  const date = new Date(at * 1000);
  const today = date.toDateString() === new Date().toDateString();
  return today ? date.toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(LANG, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function historyRow(c, types, id) {
  const gone = c.state === 'suppression';
  const line = [
    el('span', { class: 'chg-n', title: c.n ? t(gone ? 'recv.history.rowGone' : 'recv.history.row', { n: c.n }) : null }, c.n ? String(c.n) : ''),
    el('span', { class: 'chg-dot', title: t(`recv.history.${c.state}`) }, icon(STATE_ICON[c.state])),
    el('span', { class: 'chg-label' }, c.state === 'colonne' ? t('recv.history.colLabel', { col: c.label }) : c.label || '—'),
    el('span', { class: 'chg-state' }, t(`recv.history.${c.state}`)),
    el('time', { class: 'chg-time', datetime: new Date(c.at * 1000).toISOString() }, when(c.at))];
  const rowClass = `chg-row chg-${c.state}`;
  if (!c.detail) return el('li', { class: `chg-item chg-${c.state}` }, el('div', { class: rowClass }, line));
  const { cols, before, after } = c.detail;
  const values = (kind, list) => list && el('tr', { class: `mg-${kind}` }, el('th', { scope: 'row' }, t(`recv.history.${kind}`)),
    list.map((v, i) => cell(v, types[cols[i][0]])));
  return el('li', { class: `chg-item chg-${c.state}` }, el('details', { open: opened.has(id), ontoggle: keepOpen(id) },
    el('summary', { class: rowClass }, line),
    miniGrid(['', ...cols.map(([, to]) => to)], [values('before', before), values('after', after)])));
}

const historyTable = ({ id, dest, items, types }) => (items.length ? el('section', { class: 'history-table' },
  el('div', { class: 'history-head' }, el('strong', {}, dest), stateCounts(items)),
  el('ul', { class: 'history-rows' }, items.slice(0, HISTORY_MAX).map(c => historyRow(c, types, `${id}|${c.key}|${c.at}`))),
  items.length > HISTORY_MAX ? el('p', { class: 'muted small' }, t('recv.history.more', { n: items.length - HISTORY_MAX })) : null) : null);

function history(group) {
  const tables = group.note.tables.map((tb) => {
    const result = state.results.get(tableKey(group.journal, tb.table)) || {};
    // Une colonne ajoutée par la SOURCE prend place parmi les lignes, à son heure.
    const columns = (result.added || []).map(a => ({ at: a.at, key: `col:${a.col}`, state: 'colonne', label: a.col, n: null, detail: null }));
    const items = [...columns, ...(result.recent || [])].sort((x, y) => y.at - x.at);
    return { id: tableKey(group.journal, tb.table), dest: tb.dest, items, types: result.types || {} };
  });
  const all = tables.flatMap(tb => tb.items);
  if (!all.length) return el('p', { class: 'muted small' }, t('recv.history.none'));
  return el('details', { class: 'history', open: opened.has(group.journal), ontoggle: keepOpen(group.journal) },
    el('summary', {}, el('span', { class: 'history-title' }, t(state.lastVisit ? 'recv.history.since' : 'recv.history.last')), stateCounts(all)),
    tables.map(historyTable),
    el('button', { class: 'btn btn-small btn-link', type: 'button', disabled: state.readOnly, onclick: () => labelDialog(group) }, t('recv.label.change')));
}

// Colonne qui nomme les lignes dans l'historique, par table reçue (notée dans le journal).
function labelDialog(group) {
  const pickers = group.note.tables.map((entry) => {
    const result = state.results.get(tableKey(group.journal, entry.table)) || {};
    const cols = result.labelCols || [];
    return { entry, field: pickField({ items: cols.map(c => ({ value: c, label: c })), value: result.labelCol || cols[0], label: entry.dest }) };
  });
  const report = el('div', { class: 'report' });
  const save = async (m) => {
    await updateJournalNote(group.journal, note => ({
      ...note, tables: note.tables.map(tb => ({ ...tb, label: (pickers.find(p => p.entry.table === tb.table) || {}).field.value() })),
    }));
    m.close();
    state.results.clear();
    await consolidateAll();
  };
  openModal({
    title: t('recv.label.title'), width: 400,
    body: [el('p', { class: 'small' }, t('recv.label.help')), ...pickers.map(p => el('div', { class: 'dest-row' }, el('span', {}, p.entry.dest), p.field)), report],
    buttons: [{ label: t('common.cancel') }, { label: t('common.save'), kind: 'btn-primary', onClick: m => run(null, report, () => save(m)) }],
  });
}
return { refreshTarget, renderTarget };
})();

// ===== js/main.js =====
__M["js/main.js"] = (() => {
'use strict';
// Démarrage : thème et langue, chargement de l'API des widgets depuis l'instance Grist, choix de
// l'onglet, Réglages.
const { GRIST_ORIGINS, VERSION } = __M["js/config.js"];
const { LANG, t, translatePage } = __M["js/i18n.js"];
const { applyTheme, readPref, writePref } = __M["js/prefs.js"];
const { SYNC_TABLE } = __M["js/logic/common.js"];
const { readSchema } = __M["js/grist.js"];
const { legacyTables, readSourceNote } = __M["js/source/synchro.js"];
const { legacyJournals, receivedJournals } = __M["js/target/journals.js"];
const { copyField, el, errorText, message, openModal } = __M["js/ui.js"];
const { roleGuide } = __M["js/guide.js"];
const { refreshSource, renderSource } = __M["js/source/tab.js"];
const { startAutoCatchUp } = __M["js/source/resend.js"];
const { refreshTarget, renderTarget } = __M["js/target/tab.js"];
const { consolidateAll, startAutoConsolidation } = __M["js/target/loop.js"];

const $ = id => document.getElementById(id);

function showScreen(...nodes) {
  $('main').replaceChildren(...nodes.filter(Boolean));
}

// Démarrage impossible : ce qu'il faut faire, l'adresse du widget (hors de Grist) ou un bouton
// pour recharger. Les onglets restent visibles, grisés.
function showStartProblem(text, { withAddress = false, reload = false } = {}) {
  for (const button of document.querySelectorAll('[data-tab]')) button.disabled = true;
  showScreen(message('warn', text),
    reload ? el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, t('start.reload')) : null);
}

async function select(tab) {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  const view = el('div', { class: 'view' });
  showScreen(view);
  try {
    await (tab === 'send' ? renderSource(view) : renderTarget(view));
  } catch (e) {
    console.error(e);
    view.replaceChildren(message('err', errorText(e)));
  }
  return undefined;
}

function showHome() {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', 'false');
  const tile = (tab, title, desc) => el('button', { class: 'tile', type: 'button', onclick: () => select(tab) },
    el('span', { class: 'tile-title' }, title), el('span', { class: 'tile-desc' }, desc));
  showScreen(el('h2', { class: 'home-title' }, t('home.title')),
    el('div', { class: 'tiles' }, tile('send', t('home.send'), t('home.send.desc')), tile('receive', t('home.receive'), t('home.receive.desc'))),
    roleGuide({}));
}

function openSettings() {
  const radios = (name, title, values, current, onPick) => el('div', { class: 'radios', role: 'radiogroup', 'aria-label': title }, values.map(([value, label]) =>
    el('label', {}, el('input', { type: 'radio', name, value, checked: value === current, onchange: e => onPick(value, e.target) }), label)));
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const credits = [
    [t('settings.credits.author'), 'Grist Factory'],
    [t('settings.credits.site'), link('https://grist-factory.fr', 'grist-factory.fr')],
    [t('settings.credits.license'), link('https://www.gnu.org/licenses/gpl-3.0.html', 'GNU GPL v3.0')],
    [t('settings.credits.version'), VERSION],
  ];
  openModal({
    title: t('settings.title'), width: 400,
    body: el('div', { class: 'form' },
      el('h3', {}, t('settings.lang')),
      // Langue non retenue (stockage refusé) : le choix revient à la langue en cours.
      radios('lang', t('settings.lang'), [['fr', 'Français'], ['en', 'English']], LANG, (lang, input) => {
        if (writePref('lang', lang)) location.reload();
        else { input.checked = false; document.querySelector(`input[name="lang"][value="${LANG}"]`).checked = true; }
      }),
      el('h3', {}, t('settings.theme')),
      radios('theme', t('settings.theme'), [['system', t('settings.theme.system')], ['light', t('settings.theme.light')], ['dark', t('settings.theme.dark')]],
        readPref('theme') || 'system', (theme) => { writePref('theme', theme); applyTheme(); }),
      el('h3', {}, t('settings.credits')),
      el('dl', { class: 'fiche small' }, credits.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))),
  });
}

async function start() {
  applyTheme();
  translatePage();
  $('settings').addEventListener('click', openSettings);
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => { picked = button.dataset.tab; if (ready) select(picked); });
  }

  // L'API des widgets (grist) est fournie par le widget « Constructeur ».
  if (window.parent === window || typeof grist === 'undefined') return showStartProblem(t('start.outside'));
  grist.ready({ requiredAccess: 'full' });
  // Sans accès complet, Grist refuse la lecture ; sans réponse du tout, Grist est injoignable.
  try {
    await Promise.race([grist.docApi.fetchTable('_grist_Tables'), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))]);
  } catch (e) {
    return e.message === 'timeout' ? showStartProblem(t('start.slow'), { reload: true }) : showStartProblem(t('start.access'));
  }

  startAutoConsolidation(refreshTarget);
  startAutoCatchUp(refreshSource);
  try {
    await openFirstScreen();
  } catch (e) {
    // Document illisible juste après la sonde (rechargé par Grist, réseau) : rien ne s'affiche
    // sinon. L'erreur est montrée, la console n'en garde que la trace.
    console.warn(e);
    showStartProblem(t('start.failed', { detail: errorText(e) }), { reload: true });
  }
}

// Onglet choisi pendant le démarrage : il est ouvert à la place du premier écran (vu au test : le
// premier écran, choisi plus tard, l'écrasait).
let picked = null;
let ready = false;

// Premier écran : l'onglet choisi, sinon celui du rôle que le document tient déjà, sinon l'accueil.
async function openFirstScreen() {
  const schema = await readSchema();
  const journals = receivedJournals(schema);
  // Échange dont le formulaire de retour vient d'être publié : l'assistant reprend dans Envoyer.
  // Le journal de retour d'un Échange fait partie de l'envoi : il n'ouvre pas Recevoir.
  const backLink = readSourceNote(schema).invitations.some(inv => inv.journal && !inv.ready);
  ready = true;
  if (picked) await select(picked);
  else if (!backLink && (journals.some(r => !r.note.retour) || legacyJournals(schema).length)) await select('receive');
  else if (schema.has(SYNC_TABLE) || legacyTables(schema).length) await select('send');
  else showHome();
  if (journals.length) consolidateAll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
return {  };
})();
