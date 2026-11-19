/*
 * Sync+ / SyncPlus (version « Constructeur ») : synchronisation de tables entre documents Grist.
 * Adaptation du widget grist-factory/grist-widget-syncPlus 0.30.4 (Grist Factory,
 * https://grist-factory.fr, licence GNU GPL v3.0) : code regroupé en un seul script pour le widget
 * personnalisé « Constructeur » de Grist. Images et tutoriel retirés.
 * À coller dans l'onglet JavaScript ; le contenu de syncplus-builder.html va dans l'onglet HTML.
 * Réglage à adapter : GRIST_ORIGINS (section js/config.js, plus bas).
 */
// ===== Compatibilité : pages servies en http:// (contexte non sécurisé) =====
// crypto.subtle et crypto.randomUUID n'existent qu'en HTTPS. Si elles manquent, ce bloc les remplace
// par des versions en JavaScript pur (SHA-1, SHA-256, HMAC, HKDF, ECDH P-256), identiques en résultat.
(function () {
  const g = globalThis;
  if (!g.crypto) return;
  const def = (name, value) => Object.defineProperty(g.crypto, name, { value, configurable: true, writable: true });
  if (!g.crypto.randomUUID) {
    def('randomUUID', () => {
      const b = g.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    });
  }
  if (g.crypto.subtle) return;

  const u8 = d => (d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d));
  const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  function padded(bytes) {
    const len = bytes.length; const p = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    p.set(bytes); p[len] = 0x80;
    const v = new DataView(p.buffer);
    v.setUint32(p.length - 8, Math.floor(len / 0x20000000)); v.setUint32(p.length - 4, (len << 3) >>> 0);
    return v;
  }
  function sha1(bytes) {
    const v = padded(bytes); const H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]; const w = new Uint32Array(80);
    for (let off = 0; off < v.byteLength; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = v.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let [a, b, c, d, e] = H;
      for (let i = 0; i < 80; i++) {
        const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
        const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = t;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0;
    }
    const out = new Uint8Array(20); const ov = new DataView(out.buffer); H.forEach((x, i) => ov.setUint32(i * 4, x)); return out;
  }
  const K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256(bytes) {
    const v = padded(bytes); const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const w = new Uint32Array(64);
    for (let off = 0; off < v.byteLength; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = v.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3); const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, gg, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & gg)) + K256[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = gg; gg = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, gg, h].forEach((x, i) => { H[i] = (H[i] + x) >>> 0; });
    }
    const out = new Uint8Array(32); const ov = new DataView(out.buffer); H.forEach((x, i) => ov.setUint32(i * 4, x)); return out;
  }
  const HASH = { 'SHA-1': sha1, 'SHA-256': sha256 };
  const hashOf = a => { const name = typeof a === 'string' ? a : a.name; const f = HASH[name.toUpperCase()]; if (!f) throw new Error('algorithme non pris en charge'); return f; };
  function hmac(f, key, msg) {
    const kp = new Uint8Array(64); kp.set(key.length > 64 ? f(key) : key);
    return f(cat(kp.map(b => b ^ 0x5c), f(cat(kp.map(b => b ^ 0x36), msg))));
  }
  function hkdf(f, ikm, salt, info, bits) {
    const hl = f(new Uint8Array(0)).length; const prk = hmac(f, salt.length ? salt : new Uint8Array(hl), ikm);
    let t = new Uint8Array(0); let okm = new Uint8Array(0);
    for (let i = 1; okm.length < bits / 8; i++) { t = hmac(f, prk, cat(t, info, Uint8Array.of(i))); okm = cat(okm, t); }
    return okm.slice(0, bits / 8);
  }

  // Courbe P-256
  const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const G = [0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n];
  const md = a => ((a % P) + P) % P;
  function inv(a) { let [r0, r1, s0, s1] = [P, md(a), 0n, 1n]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } return md(s0); }
  function add(p, q) {
    if (!p) return q; if (!q) return p;
    if (p[0] === q[0]) { if (md(p[1] + q[1]) === 0n) return null; const l = md(md(3n * p[0] * p[0] - 3n) * inv(2n * p[1])); const x = md(l * l - 2n * p[0]); return [x, md(l * (p[0] - x) - p[1])]; }
    const l = md(md(q[1] - p[1]) * inv(q[0] - p[0])); const x = md(l * l - p[0] - q[0]); return [x, md(l * (p[0] - x) - p[1])];
  }
  function mul(k, pt) { let r = null; let a = pt; for (let n = k; n > 0n; n >>= 1n) { if (n & 1n) r = add(r, a); a = add(a, a); } return r; }
  const onCurve = ([x, y]) => x > 0n && x < P && y > 0n && y < P && md(y * y) === md(x * x * x - 3n * x + B);
  const toBig = bytes => BigInt('0x' + (Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('') || '0'));
  const toBytes = (n, len = 32) => Uint8Array.from(n.toString(16).padStart(len * 2, '0').match(/../g), h => parseInt(h, 16));
  const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const rawPub = pt => cat(Uint8Array.of(4), toBytes(pt[0]), toBytes(pt[1]));
  const algName = a => (typeof a === 'string' ? a : a.name).toUpperCase();

  const subtle = {
    async digest(algo, data) { return hashOf(algo)(u8(data)).buffer; },
    async generateKey(algo) {
      let d = 0n; while (d === 0n || d >= N) d = toBig(g.crypto.getRandomValues(new Uint8Array(32)));
      const pt = mul(d, G);
      return { privateKey: { kind: 'ec-private', d, pt }, publicKey: { kind: 'ec-public', pt } };
    },
    async exportKey(format, key) {
      if (format === 'raw' && key.kind === 'ec-public') return rawPub(key.pt).buffer;
      if (format === 'jwk' && key.kind === 'ec-private') return { kty: 'EC', crv: 'P-256', x: b64u(toBytes(key.pt[0])), y: b64u(toBytes(key.pt[1])), d: b64u(toBytes(key.d)), ext: true };
      throw new Error('format non pris en charge');
    },
    async importKey(format, data, algo) {
      const name = algName(algo);
      if (name === 'ECDH' && format === 'jwk') {
        const d = toBig(unb64u(data.d)); const pt = [toBig(unb64u(data.x)), toBig(unb64u(data.y))];
        if (d <= 0n || d >= N || !onCurve(pt)) throw new Error('clé invalide');
        return { kind: 'ec-private', d, pt };
      }
      if (name === 'ECDH' && format === 'raw') {
        const b = u8(data); if (b.length !== 65 || b[0] !== 4) throw new Error('clé invalide');
        const pt = [toBig(b.slice(1, 33)), toBig(b.slice(33))]; if (!onCurve(pt)) throw new Error('clé invalide');
        return { kind: 'ec-public', pt };
      }
      if (name === 'HKDF' && format === 'raw') return { kind: 'hkdf', bytes: u8(data).slice() };
      if (name === 'HMAC' && format === 'raw') return { kind: 'hmac', bytes: u8(data).slice(), f: hashOf(algo.hash) };
      throw new Error('algorithme non pris en charge');
    },
    async deriveBits(algo, key, bits) {
      const name = algName(algo);
      if (name === 'ECDH') { const s = mul(key.d, algo.public.pt); if (!s) throw new Error('clé invalide'); return toBytes(s[0]).buffer; }
      if (name === 'HKDF') return hkdf(hashOf(algo.hash), key.bytes, u8(algo.salt), u8(algo.info), bits).buffer;
      throw new Error('algorithme non pris en charge');
    },
    async sign(algo, key, data) { return hmac(key.f, key.bytes, u8(data)).buffer; },
  };
  def('subtle', subtle);
})();

const __M = {};
// ===== js/config.js =====
__M["js/config.js"] = (() => {
'use strict';
const GRIST_ORIGINS = [
  "http://optimis-developpement.minint.fr",
  "https://grist.numerique.gouv.fr",
];
const servedAt = () => '';
const widgetUrl = () => '';
const servedFrom = () => 'constructeur';
const VERSION = '0.30.4';
return { GRIST_ORIGINS, servedAt, widgetUrl, servedFrom, VERSION };
})();

// ===== js/engine/logic/common.js =====
__M["js/engine/logic/common.js"] = (() => {
'use strict';

const KEY_COL = 'id_sync'; // clé stable, UUID posé à la création de la ligne
const ORDER_COL = 'MajLe'; // heure de la dernière modification d'une valeur envoyée
const RECALC_COL = 'RecalculLe';
const DELETE_COL = 'Supprime'; // suppression logique, prise en compte si la table l'a
const LINK_PREFIX = 'Synchro_Cle_';
const ARCHIVE_COL = 'Supprimee_a_la_source';

let SYNC_TABLE = 'Synchro';
const EXPORT_COL = 'Synchro_Export'; // identifiant de l'export
const TABLE_COL = 'Synchro_Table'; // table SOURCE (et, dans le journal, table d'origine d'une ligne)
const TYPE_COL = 'Synchro_Type'; // voir KIND
const SCHEMA_COL = 'Synchro_Colonnes'; // colonnes envoyées : [{ id, type, label }] en JSON
const RESEND_COL = 'Synchro_Renvoi'; // lignes à renvoyer, écrites par le widget
const LIST_COL = 'Synchro_Ids'; // ce qu'il faut envoyer de la liste des clés
const LOT_COL = 'Synchro_Lot'; // lot : lignes récentes avec leurs colonnes, en JSON
const AUTHOR_COL = 'Sync_Par'; // e-mail de la personne qui a ajouté la ligne (user.Email)
const STATE_COL = 'Sync_Etat'; // CIBLE : effet de la version recopiée (ajout, modif, suppression)
const MISSING_COL = STATE_COL;
const TRACK_COL = STATE_COL;
const KIND = {
  keys: 'cles', lot: 'lot', full: 'complet', mark: 'empreinte', filter: 'filtre', track: 'suivi', swap: 'echange', load: 'charge', end: 'fin',
  files: 'fichiers', part: 'fichier', sign: 'signature',
};
const HUB = 'plusieurs';

let JOURNAL_PREFIX = 'Journal_';

let TABLE_PREFIX = '';
const TABLE_PREFIX_RULE = /^(?:[A-Z][A-Za-z0-9_]{0,31})?$/;
function setTablePrefix(prefix = '') {
  if (typeof prefix !== 'string' || !TABLE_PREFIX_RULE.test(prefix)) throw new Error(`préfixe de tables invalide : ${JSON.stringify(prefix)}`);
  TABLE_PREFIX = prefix;
  SYNC_TABLE = `${prefix}Synchro`;
  JOURNAL_PREFIX = `${prefix}Journal_`;
}

const isUserTable = id => id !== SYNC_TABLE && !id.startsWith(`${SYNC_TABLE}_`) && !id.startsWith(JOURNAL_PREFIX);
const APPLIED_COL = 'Sync_Applique'; // version déjà recopiée dans la destination
const RECEIVED_COL = 'Sync_Recu'; // date d'arrivée de la ligne dans le journal (NOW())
const DATA_COL = 'Synchro_Donnees'; // colonnes envoyées d'une ligne, en un bloc JSON
const BEFORE_COL = 'Sync_Avant';
const SEAL_COL = 'Sync_Sceau';

const SIG_KEY = /^[0-9a-f]{32}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;

const BUCKETS = 256;
const LIST_PREFIX = 'ids:'; // liste complète d'un seul tenant (montage 0.4, lien public)
const RESEND_ALL = 1; // marque de renvoi : toute la table, lignes sans MajLe comprises

const CHUNK = 500; // lignes par action

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

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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

const NOTE_KEY = 'syncNote';
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const optionsOf = column => {
  const options = parseJson((column && column.widgetOptions) || 'null');
  return isObject(options) ? options : {};
};
const legacyNoteOf = (column) => {
  const note = parseJson((column && column.description) || 'null');
  return isObject(note) ? note : null;
};
function columnNote(column) {
  const note = optionsOf(column)[NOTE_KEY];
  return isObject(note) ? note : legacyNoteOf(column);
}
const legacyNote = legacyNoteOf;
const hasNoteOption = column => isObject(optionsOf(column)[NOTE_KEY]);
function noteAction(column, note) {
  const options = { ...optionsOf(column) };
  if (note == null) delete options[NOTE_KEY];
  else options[NOTE_KEY] = note;
  const fields = { widgetOptions: Object.keys(options).length ? JSON.stringify(options) : '' };
  if (legacyNoteOf(column)) fields.description = '';
  return ['UpdateRecord', '_grist_Tables_column', column.id, fields];
}

const nowS = () => Date.now() / 1000;
const sleep = ms => new Promise((resolve) => { setTimeout(resolve, ms); });

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
const digest = async (algo, bytes) => new Uint8Array(await crypto.subtle.digest(algo, bytes));
const sha256 = async text => toHex(await digest('SHA-256', new TextEncoder().encode(text)));

const COL_ID = /^[A-Za-z_][A-Za-z0-9_]*$/; // identifiant de table ou de colonne Grist
const HEX16 = /^[0-9a-f]{16}$/; // identifiant d'export ou d'invitation
const is = (re, value) => typeof value === 'string' && re.test(value);

const SENT_TYPE = /^(Any|Attachments|Bool|Choice|ChoiceList|Date|DateTime(:[A-Za-z0-9_/+-]+)?|Int|Numeric|Text)$/;
const isSafeId = value => is(COL_ID, value) && !(value in Object.prototype);

function toTableId(name, fallback = 'Table') {
  let id = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
  if (/^[0-9]/.test(id)) id = 'T_' + id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const destTableId = (name, fallback = 'Table') => TABLE_PREFIX + toTableId(name, fallback);

const journalId = (name, taken) => freeTableId(JOURNAL_PREFIX + toTableId(name, 'Export'), taken);

function freeTableId(base, taken) {
  const used = new Set(taken.map(id => id.toLowerCase()));
  const free = id => !used.has(id.toLowerCase());
  if (free(base)) return base;
  let n = 2;
  while (!free(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

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
const bucketOf = key => Math.floor(crc32(String(key)) * BUCKETS / 2 ** 32);
return { KEY_COL, ORDER_COL, RECALC_COL, DELETE_COL, LINK_PREFIX, ARCHIVE_COL, EXPORT_COL, TABLE_COL, TYPE_COL, SCHEMA_COL, RESEND_COL, LIST_COL, LOT_COL, AUTHOR_COL, STATE_COL, MISSING_COL, TRACK_COL, KIND, HUB, TABLE_PREFIX_RULE, setTablePrefix, isUserTable, APPLIED_COL, RECEIVED_COL, DATA_COL, BEFORE_COL, SEAL_COL, SIG_KEY, PUBLIC_KEY, BUCKETS, LIST_PREFIX, RESEND_ALL, toRows, chunk, pool, groupBy, isBlank, isTrue, parseJson, NOTE_KEY, columnNote, legacyNote, hasNoteOption, noteAction, nowS, sleep, toHex, randomHex, digest, sha256, COL_ID, HEX16, is, SENT_TYPE, isSafeId, toTableId, destTableId, journalId, freeTableId, crc32, bucketOf, get SYNC_TABLE() { return SYNC_TABLE; }, get JOURNAL_PREFIX() { return JOURNAL_PREFIX; }, get TABLE_PREFIX() { return TABLE_PREFIX; } };
})();

// ===== js/engine/logic/filters.js =====
__M["js/engine/logic/filters.js"] = (() => {
'use strict';
const {COL_ID} = __M["js/engine/logic/common.js"];

function filterKind(source) {
  const s = String(source || '');
  if (s === 'Attachments') return null;
  if (s === 'Bool') return 'bool';
  if (s === 'Numeric' || s === 'Int') return 'number';
  if (s === 'Date' || s.startsWith('DateTime')) return 'date';
  if (s.startsWith('RefList:')) return 'refs';
  if (s.startsWith('Ref:')) return 'ref';
  if (s === 'ChoiceList') return 'list';
  return 'text';
}

const OPERATORS = {
  text: ['in', 'notin', 'eq', 'contains', 'notcontains', 'starts', 'empty', 'notempty'],
  list: ['in', 'notin', 'empty', 'notempty'],
  ref: ['in', 'notin', 'contains', 'notcontains', 'empty', 'notempty'],
  refs: ['in', 'notin', 'contains', 'notcontains', 'empty', 'notempty'],
  number: ['eq', 'noteq', 'gt', 'ge', 'lt', 'le', 'between', 'empty', 'notempty'],
  date: ['eq', 'lt', 'le', 'gt', 'ge', 'between', 'empty', 'notempty'],
  bool: ['true', 'false'],
};
const ALL_OPS = new Set(Object.values(OPERATORS).flat());

function operandOf(op) {
  const base = op.startsWith('not') ? op.slice(3) : op;
  if (base === 'in') return 'pick';
  if (base === 'between') return 'two';
  return ['empty', 'true', 'false'].includes(base) ? 'none' : 'one';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const lower = x => String(x ?? '').trim().toLowerCase();

const asRef = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
const asNumber = v => (v === '' || v === null || !Number.isFinite(Number(v)) ? undefined : Number(v));
const asDay = v => (DAY.test(String(v ?? '')) ? String(v) : undefined);
const asText = v => lower(v) || undefined;
function shapeOf(kind, op) {
  const base = op.startsWith('not') ? op.slice(3) : op;
  if (base === 'in' && (kind === 'ref' || kind === 'refs')) return asRef;
  if (['contains', 'starts', 'in'].includes(base) || !['number', 'date'].includes(kind)) return asText;
  return kind === 'number' ? asNumber : asDay;
}

function normalCond(cond) {
  if (!cond || !COL_ID.test(String(cond.id || ''))) return null;
  const source = String(cond.source || '');
  const kind = filterKind(source);
  const op = String(cond.op || '');
  if (!kind || !ALL_OPS.has(op)) return null;
  const out = { id: cond.id, source, visible: String(cond.visible || ''), op, values: [] };
  const need = operandOf(op);
  const raw = Array.isArray(cond.values) ? cond.values : [];
  if (need === 'pick') return pickedCond(out, raw, Array.isArray(cond.labels) ? cond.labels : [], shapeOf(kind, op));
  return need === 'none' ? out : typedCond(out, raw.slice(0, need === 'two' ? 2 : 1), need === 'two' ? 2 : 1, shapeOf(kind, op));
}
function typedCond(out, raw, size, shape) {
  const values = raw.map(shape);
  return values.length === size && !values.includes(undefined) ? { ...out, values } : null;
}
function pickedCond(out, raw, labels, shape) {
  const picked = new Map();
  raw.forEach((v, i) => {
    const value = shape(v);
    if (value !== undefined && !picked.has(value)) picked.set(value, String(labels[i] ?? v));
  });
  return picked.size ? { ...out, values: [...picked.keys()], labels: [...picked.values()] } : null;
}

function legacyConds(filter) {
  if (!filter.id) return [];
  const value = lower(filter.value);
  if (filter.source === 'Bool') return [{ ...filter, op: ['oui', 'yes', 'vrai', 'true', '1', 'x'].includes(value) ? 'true' : 'false' }];
  return [{ ...filter, op: value ? 'eq' : 'empty', values: value ? [value] : [] }];
}

function rowFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  const conds = (Array.isArray(filter.conds) ? filter.conds : legacyConds(filter)).map(normalCond).filter(Boolean);
  return conds.length ? { mode: filter.mode === 'any' ? 'any' : 'all', conds } : null;
}

const filterColumns = filter => [...new Set(((rowFilter(filter) || {}).conds || []).map(c => c.id))];

function cellText(x) {
  if (x === null || x === undefined) return '';
  if (typeof x === 'boolean') return x ? 'oui' : 'non';
  if (Array.isArray(x)) return x.map(cellText).join(', ');
  return lower(x);
}

const listOf = x => (Array.isArray(x) ? (x[0] === 'L' ? x.slice(1) : x) : []);

function dayOf(source, x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const zone = source.startsWith('DateTime:') ? source.slice(9) : 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x * 1000));
  } catch (e) {
    return new Date(x * 1000).toISOString().slice(0, 10);
  }
}

function shownText(kind, x, labels) {
  const label = id => (labels ? labels.get(id) : id);
  if (kind === 'ref') return x ? cellText(label(x)) : '';
  if (kind === 'refs') return lower(listOf(x).map(id => String(label(id) ?? '')).join(', '));
  return cellText(kind === 'list' ? listOf(x) : x);
}

function cellItems(kind, source, x, labels) {
  if (kind === 'ref') return Number.isInteger(x) && x > 0 ? [x] : [];
  if (kind === 'refs') return listOf(x).filter(id => Number.isInteger(id) && id > 0);
  if (kind === 'list') return listOf(x).map(cellText);
  if (kind === 'bool') return [x === true];
  if (kind === 'number') return typeof x === 'number' && Number.isFinite(x) ? [x] : [];
  if (kind === 'date') return dayOf(source, x) ? [dayOf(source, x)] : [];
  const text = shownText(kind, x, labels);
  return text ? [text] : [];
}

const COMPARE = {
  eq: (x, y) => x === y, lt: (x, y) => x < y, le: (x, y) => x <= y, gt: (x, y) => x > y, ge: (x, y) => x >= y,
};

function passes(cond, row, labels) {
  const { op, values: w } = cond;
  if (op.startsWith('not')) return !passes({ ...cond, op: op.slice(3) }, row, labels);
  const kind = filterKind(cond.source);
  const x = row[cond.id];
  if (['contains', 'starts', 'eq'].includes(op) && !['number', 'date'].includes(kind)) {
    const text = shownText(kind, x, labels);
    if (op === 'eq') return text === w[0];
    return op === 'starts' ? text.startsWith(w[0]) : text.includes(w[0]);
  }
  const items = cellItems(kind, cond.source, x, labels);
  if (op === 'empty') return !items.length;
  if (op === 'in') return items.some(i => w.includes(i));
  if (op === 'true') return items[0] === true;
  if (op === 'false') return items[0] !== true;
  if (!items.length) return false;
  if (op === 'between') return w[0] <= items[0] && items[0] <= w[1];
  return COMPARE[op] ? COMPARE[op](items[0], w[0]) : false;
}

function filterTester(filter, labels = {}) {
  const spec = rowFilter(filter);
  if (!spec) return () => true;
  const tests = spec.conds.map(c => row => passes(c, row, labels[c.id]));
  return row => (spec.mode === 'any' ? tests.some(f => f(row)) : tests.every(f => f(row)));
}

function columnValues(cond, rows, labels) {
  const kind = filterKind(cond.source);
  const found = new Map();
  const add = (value, label) => {
    const seen = found.get(value);
    if (seen) seen.n += 1; else found.set(value, { value, label, n: 1 });
  };
  for (const row of rows) {
    const x = row[cond.id];
    if (kind === 'ref' || kind === 'refs') {
      for (const id of new Set(cellItems(kind, cond.source, x))) add(id, String((labels && labels.get(id)) ?? `#${id}`));
    } else if (kind === 'list') {
      for (const item of new Set(listOf(x).map(y => String(y ?? '').trim()).filter(Boolean))) add(item.toLowerCase(), item);
    } else if (kind === 'text') {
      const label = Array.isArray(x) ? listOf(x).join(', ') : String(x ?? '').trim();
      if (label) add(cellText(x), label);
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' }));
}
return { filterKind, OPERATORS, operandOf, rowFilter, filterColumns, cellText, filterTester, columnValues };
})();

// ===== js/engine/logic/rules.js =====
__M["js/engine/logic/rules.js"] = (() => {
'use strict';
const {COL_ID} = __M["js/engine/logic/common.js"];

const RULE_MAX = 300; // caractères d'une règle
const STRING_MAX = 100;
const LIST_MAX = 50;
const NODES_MAX = 60;
const DEPTH_MAX = 12;
const NUMBER = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPERATORS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '(', ')', '[', ']', ','];
const COMPARE = new Set(['==', '!=', '<', '<=', '>', '>=']);
const WORDS = new Set(['and', 'or', 'not', 'in', 'is', 'True', 'False', 'None', 'TODAY']);

class Refused extends Error {}
const refuse = () => { throw new Refused('règle hors grammaire'); };

function lexColumn(text, i) {
  const name = WORD.exec(text.slice(i + 1));
  if (!name || !COL_ID.test(name[0])) refuse();
  return [{ type: 'col', value: name[0] }, i + 1 + name[0].length];
}
function lexNumber(text, i) {
  const rest = text.slice(i);
  const num = NUMBER.exec(rest);
  if (!num || /^[A-Za-z_]/.test(rest.slice(num[0].length))) refuse();
  return [{ type: 'num', value: num[0] }, i + num[0].length];
}
function lexString(text, i) {
  const end = text.indexOf(text[i], i + 1);
  const value = end < 0 ? '' : text.slice(i + 1, end);
  if (end < 0 || value.length > STRING_MAX || /[\\"'\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200b-\u200f\u202a-\u202e\u2066-\u206f\ufeff]/.test(value)) refuse();
  return [{ type: 'str', value }, end + 1];
}
function lexWord(text, i) {
  const rest = text.slice(i);
  const word = WORD.exec(rest)[0];
  if (word === 'rec' && rest[3] === '.') {
    const name = WORD.exec(rest.slice(4));
    if (!name) refuse();
    return [{ type: 'col', value: name[0] }, i + 4 + name[0].length];
  }
  if (!WORDS.has(word)) refuse();
  return [{ type: 'word', value: word }, i + word.length];
}
function lexOperator(text, i) {
  const rest = text.slice(i);
  const op = OPERATORS.find(o => rest.startsWith(o));
  if (!op) refuse();
  return [{ type: 'op', value: op }, i + op.length];
}
function nextToken(text, i) {
  const ch = text[i];
  if (ch === '$') return lexColumn(text, i);
  if (/[0-9]/.test(ch)) return lexNumber(text, i);
  if (ch === '"' || ch === "'") return lexString(text, i);
  if (/[A-Za-z_]/.test(ch)) return lexWord(text, i);
  return lexOperator(text, i);
}

function tokens(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (' \t\r\n'.includes(text[i])) { i++; continue; }
    const [token, next] = nextToken(text, i);
    out.push(token);
    i = next;
  }
  return out;
}

const CONSTANTS = ['True', 'False', 'None'];

class Parser {
  constructor(list) {
    this.list = list;
    this.at = 0;
    this.nodes = 0;
  }
  peek() { return this.list[this.at]; }
  step() { return this.list[this.at++]; }
  is(type, value) {
    const tok = this.list[this.at];
    return tok && tok.type === type && (value === undefined || tok.value === value);
  }
  take(type, value) {
    if (!this.is(type, value)) refuse();
    return this.step();
  }
  make(node) {
    if (++this.nodes > NODES_MAX) refuse();
    return node;
  }
  literal() {
    const minus = this.is('op', '-') && this.step();
    const tok = this.peek();
    if (!tok || (minus && tok.type !== 'num')) refuse();
    if (tok.type === 'num') return this.make({ k: 'num', v: `${minus ? '-' : ''}${this.step().value}` });
    if (tok.type === 'str') return this.make({ k: 'str', v: this.step().value });
    if (tok.type === 'word' && CONSTANTS.includes(tok.value)) return this.make({ k: 'const', v: this.step().value });
    return refuse();
  }
  items() {
    const close = this.take('op', this.is('op', '(') ? '(' : '[').value === '(' ? ')' : ']';
    const found = [];
    while (!this.is('op', close)) {
      found.push(this.literal());
      if (found.length > LIST_MAX) refuse();
      if (this.is('op', ',')) this.at++;
      else if (!this.is('op', close)) refuse();
    }
    this.take('op', close);
    return found;
  }
  atom(depth) {
    if (depth > DEPTH_MAX) refuse();
    const tok = this.peek();
    if (!tok) return refuse();
    if (tok.type === 'num') return this.make({ k: 'num', v: this.step().value });
    if (tok.type === 'str') return this.make({ k: 'str', v: this.step().value });
    if (tok.type === 'col') return this.make({ k: 'col', v: this.step().value });
    if (this.is('word', 'TODAY')) { this.at++; this.take('op', '('); this.take('op', ')'); return this.make({ k: 'today' }); }
    if (tok.type === 'word' && CONSTANTS.includes(tok.value)) return this.make({ k: 'const', v: this.step().value });
    if (this.is('op', '(')) { this.at++; const inner = this.or(depth + 1); this.take('op', ')'); return inner; }
    return refuse();
  }
  unary(depth) {
    if (this.is('op', '-')) { this.at++; return this.make({ k: 'neg', a: this.unary(depth + 1) }); }
    return this.atom(depth);
  }
  binary(next, ops, depth) {
    let left = next(depth);
    while (this.list[this.at] && this.list[this.at].type === 'op' && ops.includes(this.list[this.at].value)) {
      const op = this.step().value;
      left = this.make({ k: 'bin', op, a: left, b: next(depth) });
    }
    return left;
  }
  product(depth) { return this.binary(d => this.unary(d), ['*', '/'], depth); }
  sum(depth) { return this.binary(d => this.product(d), ['+', '-'], depth); }
  comparison(depth) {
    const left = this.sum(depth);
    if (this.list[this.at] && this.list[this.at].type === 'op' && COMPARE.has(this.list[this.at].value)) {
      const op = this.step().value;
      return this.make({ k: 'cmp', op, a: left, b: this.sum(depth) });
    }
    if (this.is('word', 'in') || (this.is('word', 'not') && this.list[this.at + 1] && this.list[this.at + 1].value === 'in')) {
      const negated = this.is('word', 'not') && ++this.at;
      this.take('word', 'in');
      return this.make({ k: 'in', not: Boolean(negated), a: left, list: this.items() });
    }
    if (this.is('word', 'is')) {
      this.at++;
      const negated = this.is('word', 'not') && ++this.at;
      this.take('word', 'None');
      return this.make({ k: 'isnone', not: Boolean(negated), a: left });
    }
    return left;
  }
  not(depth) {
    if (depth > DEPTH_MAX) refuse();
    if (this.is('word', 'not')) { this.at++; return this.make({ k: 'not', a: this.not(depth + 1) }); }
    return this.comparison(depth);
  }
  and(depth) {
    let left = this.not(depth);
    while (this.is('word', 'and')) { this.at++; left = this.make({ k: 'and', a: left, b: this.not(depth) }); }
    return left;
  }
  or(depth) {
    let left = this.and(depth);
    while (this.is('word', 'or')) { this.at++; left = this.make({ k: 'or', a: left, b: this.and(depth) }); }
    return left;
  }
  run() {
    const tree = this.or(0);
    if (this.at !== this.list.length) refuse();
    return tree;
  }
}

function parseRule(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > RULE_MAX) return null;
  try {
    return new Parser(tokens(text.trim())).run();
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e;
  }
}

function ruleRefs(tree) {
  const found = new Set();
  const walk = (node) => {
    if (!node) return;
    if (node.k === 'col') found.add(node.v);
    walk(node.a);
    walk(node.b);
  };
  walk(tree);
  return [...found];
}

const LEVEL = { or: 1, and: 2, not: 3, cmp: 4, in: 4, isnone: 4, neg: 7 };
const levelOf = node => (node.k === 'bin' ? (node.op === '+' || node.op === '-' ? 5 : 6) : LEVEL[node.k] || 9);

const chain = (node, kind) => (node.k === kind ? [...chain(node.a, kind), node.b] : [node]);

function show(node, name, min = 0) {
  const text = body(node, name);
  return levelOf(node) < min ? `(${text})` : text;
}
const shown = (node, name) => show(node.a, name, 5);
const joined = (node, name) => chain(node, node.k).map(operand => show(operand, name, 3)).join(` ${node.k} `);
const SHOWERS = {
  num: node => node.v,
  str: node => `"${node.v}"`,
  const: node => node.v,
  col: (node, name) => `$${name(node.v)}`,
  today: () => 'TODAY()',
  neg: (node, name) => `-${show(node.a, name, 7)}`,
  not: (node, name) => `not ${show(node.a, name, 3)}`,
  and: joined,
  or: joined,
  in: (node, name) => `${shown(node, name)} ${node.not ? 'not in' : 'in'} [${node.list.map(v => show(v, name)).join(', ')}]`,
  isnone: (node, name) => `${shown(node, name)} is ${node.not ? 'not ' : ''}None`,
  cmp: (node, name) => `${shown(node, name)} ${node.op} ${show(node.b, name, 5)}`,
};
function showBinary(node, name) {
  const wide = node.op === '+' || node.op === '-' ? 5 : 6;
  return `${show(node.a, name, wide)} ${node.op} ${show(node.b, name, wide + 1)}`;
}
const body = (node, name) => (Object.hasOwn(SHOWERS, node.k) ? SHOWERS[node.k] : showBinary)(node, name);

function printRule(tree, rename = id => id) {
  if (!tree) return null;
  const missing = ruleRefs(tree).some(id => !rename(id));
  return missing ? null : show(tree, id => rename(id));
}

const normalizeRule = (text) => {
  const tree = parseRule(text);
  return tree ? printRule(tree) : null;
};
return { RULE_MAX, parseRule, ruleRefs, printRule, normalizeRule };
})();

// ===== js/engine/logic/options.js =====
__M["js/engine/logic/options.js"] = (() => {
'use strict';
const {normalizeRule} = __M["js/engine/logic/rules.js"];
const COLOR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const FORMAT = /^[A-Za-z0-9 .,:;/_'()[\]-]{1,40}$/; // format de date ou d'heure (moment.js)
const bool = v => typeof v === 'boolean';
const oneOf = list => v => list.includes(v);
const int = max => v => Number.isInteger(v) && v >= 0 && v <= max;
const STYLE = {
  fillColor: v => COLOR.test(v), textColor: v => COLOR.test(v),
  fontBold: bool, fontItalic: bool, fontUnderline: bool, fontStrikethrough: bool,
};
const HEADER = {
  headerTextColor: v => COLOR.test(v), headerFillColor: v => COLOR.test(v),
  headerFontBold: bool, headerFontItalic: bool, headerFontUnderline: bool, headerFontStrikethrough: bool,
};
const RULES_MAX = 10;
const COMMON = { alignment: oneOf(['left', 'center', 'right']), wrap: bool, ...STYLE };
const NUMBER = {
  numMode: oneOf(['currency', 'decimal', 'percent', 'scientific']), currency: v => /^[A-Z]{3}$/.test(v), numSign: oneOf(['parens']),
  decimals: int(10), maxDecimals: int(10), widget: oneOf(['TextBox', 'Spinner']),
};
const DATE = { dateFormat: v => FORMAT.test(v), isCustomDateFormat: bool };
const KEYS = {
  Text: { widget: oneOf(['TextBox']) }, // ni HyperLink ni Markdown : le texte reçu ne devient pas un lien cliquable ni du texte mis en forme
  Bool: { widget: oneOf(['CheckBox', 'Switch', 'TextBox']) },
  Numeric: NUMBER,
  Int: NUMBER,
  Date: DATE,
  DateTime: { ...DATE, timeFormat: v => FORMAT.test(v), isCustomTimeFormat: bool },
  Choice: {},
  ChoiceList: {},
};
const CHOICES_MAX = 500;
const CHOICE_LEN = 200;
const OPTS_MAX = 20000; // caractères de JSON par colonne : au-delà, les couleurs des choix, puis rien

const parse = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
};
const isChoice = type => type === 'Choice' || type === 'ChoiceList';

function choicesOf(raw) {
  const choices = Array.isArray(raw.choices) ? [...new Set(raw.choices.filter(c => typeof c === 'string' && c && c.length <= CHOICE_LEN))].slice(0, CHOICES_MAX) : [];
  const given = raw.choiceOptions && typeof raw.choiceOptions === 'object' ? raw.choiceOptions : {};
  const choiceOptions = Object.fromEntries(choices.filter(c => Object.hasOwn(given, c)).map(c => [c, pick(given[c], STYLE)])
    .filter(([, style]) => Object.keys(style).length));
  return { ...(choices.length ? { choices } : {}), ...(Object.keys(choiceOptions).length ? { choiceOptions } : {}) };
}

function rulesOf(list) {
  const rules = (Array.isArray(list) ? list.slice(0, RULES_MAX) : []).map((rule) => {
    const when = normalizeRule(rule && rule.when);
    const style = pick(rule, STYLE);
    return when && Object.keys(style).length ? { when, ...style } : null;
  }).filter(Boolean);
  return rules.length ? { rules } : {};
}

function pick(raw, keys) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(Object.entries(keys).filter(([k, ok]) => Object.hasOwn(source, k) && ok(source[k])).map(([k]) => [k, source[k]]));
}

function columnOptions(type, widgetOptions, { extras = false } = {}) {
  const base = String(type || '').split(':')[0];
  if (!KEYS[base]) return null;
  const raw = parse(widgetOptions);
  let opts = { ...pick(raw, { ...COMMON, ...KEYS[base], ...(extras ? HEADER : {}) }), ...(isChoice(base) ? choicesOf(raw) : {}), ...(extras ? rulesOf(raw.rules) : {}) };
  if (JSON.stringify(opts).length > OPTS_MAX) delete opts.choiceOptions;
  if (JSON.stringify(opts).length > OPTS_MAX) delete opts.rules;
  if (JSON.stringify(opts).length > OPTS_MAX) opts = {};
  return Object.keys(opts).length ? opts : null;
}

function fillOptions(type, current, sent) {
  const here = parse(current);
  const wanted = columnOptions(type, sent, { extras: true });
  if (!wanted) return null;
  const next = { ...here };
  for (const [k, v] of Object.entries(wanted)) if (!['choices', 'choiceOptions', 'rules'].includes(k) && !Object.hasOwn(here, k)) next[k] = v;
  if (wanted.choices) {
    const had = Array.isArray(here.choices) ? here.choices : [];
    const added = wanted.choices.filter(c => !had.includes(c)).slice(0, Math.max(0, CHOICES_MAX - had.length)); // la liste d'ici reste bornée
    if (added.length) next.choices = [...had, ...added];
    const styles = Object.entries(wanted.choiceOptions || {}).filter(([c]) => added.includes(c));
    if (styles.length) next.choiceOptions = { ...(here.choiceOptions || {}), ...Object.fromEntries(styles) };
  }
  return JSON.stringify(next) === JSON.stringify(here) ? null : JSON.stringify(next);
}

function receivedChoices(current, values) {
  const here = parse(current);
  const had = Array.isArray(here.choices) ? here.choices : [];
  const known = new Set(had);
  const added = [];
  for (const cell of values) {
    for (const choice of Array.isArray(cell) ? cell.slice(1) : [cell]) {
      if (typeof choice === 'string' && choice && choice.length <= CHOICE_LEN && !known.has(choice) && had.length + added.length < CHOICES_MAX) {
        known.add(choice);
        added.push(choice);
      }
    }
  }
  return added.length ? JSON.stringify({ ...here, choices: [...had, ...added] }) : null;
}

const ownsColumn = (own, sentId, column) => (own ? own.includes(sentId)
  : isChoice(column.type) && !(parse(column.widgetOptions).choices || []).length);

function replaceOptions(type, current, sent) {
  const here = parse(current);
  const base = String(type || '').split(':')[0];
  if (!KEYS[base]) return null;
  const wanted = columnOptions(type, sent, { extras: true }) || {};
  const next = { ...here };
  for (const key of Object.keys({ ...COMMON, ...KEYS[base], ...HEADER })) {
    if (Object.hasOwn(wanted, key)) next[key] = wanted[key];
    else delete next[key];
  }
  const text = JSON.stringify(next);
  const filled = fillOptions(type, text, sent) || text;
  return filled === JSON.stringify(here) ? null : filled;
}

const sentRules = opts => (opts && Array.isArray(opts.rules) ? rulesOf(opts.rules).rules || [] : []);

const ruleStyles = widgetOptions => (Array.isArray(parse(widgetOptions).rulesOptions) ? parse(widgetOptions).rulesOptions : []);

function withRuleStyles(widgetOptions, styles) {
  const next = { ...parse(widgetOptions) };
  if (styles.length) next.rulesOptions = styles;
  else delete next.rulesOptions;
  return JSON.stringify(next);
}

const ruleStyle = rule => pick(rule, STYLE);
return { isChoice, columnOptions, fillOptions, receivedChoices, ownsColumn, replaceOptions, sentRules, ruleStyles, withRuleStyles, ruleStyle };
})();

// ===== js/engine/logic/docformat.js =====
__M["js/engine/logic/docformat.js"] = (() => {
'use strict';
const {parseJson} = __M["js/engine/logic/common.js"];

const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DEFAULT_LOCALE = 'en-US'; // celle de Grist quand le document n'en dit pas

const COUNTRY_CURRENCY = {
  ...Object.fromEntries('AD AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC ME MT NL PT SI SK SM VA'.split(' ').map(c => [c, 'EUR'])),
  US: 'USD', GB: 'GBP', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', BG: 'BGN', MA: 'MAD', DZ: 'DZD', TN: 'TND', BR: 'BRL', MX: 'MXN', IN: 'INR', CN: 'CNY',
  ...Object.fromEntries('BJ BF CI GW ML NE SN TG'.split(' ').map(c => [c, 'XOF'])),
  ...Object.fromEntries('CM CF TD CG GA GQ'.split(' ').map(c => [c, 'XAF'])),
};

function docFormat(settings) {
  const raw = typeof settings === 'string' ? parseJson(settings, null) : settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const locale = typeof raw.locale === 'string' && LOCALE.test(raw.locale) ? raw.locale : '';
  const currency = typeof raw.currency === 'string' && CURRENCY.test(raw.currency) ? raw.currency : '';
  return locale || currency ? { ...(locale ? { locale } : {}), ...(currency ? { currency } : {}) } : null;
}

const docFormatOf = rows => docFormat((rows && rows[0] ? rows[0].documentSettings : null));

function currencyOf(format) {
  const have = docFormat(format);
  if (!have) return '';
  const country = (/-([A-Z]{2})$/.exec(have.locale || DEFAULT_LOCALE) || [])[1];
  return have.currency || COUNTRY_CURRENCY[country] || '';
}

function formatGap(sent, here) {
  const [a, b] = [docFormat(sent), docFormat(here)];
  if (!a) return null;
  const gap = {};
  if (a.locale && a.locale !== ((b && b.locale) || DEFAULT_LOCALE)) gap.locale = [a.locale, (b && b.locale) || DEFAULT_LOCALE];
  const [from, to] = [currencyOf(a), currencyOf(b || {})];
  if (from && from !== to) gap.currency = [from, to];
  return Object.keys(gap).length ? gap : null;
}

function formatAction(rows, wanted) {
  const want = docFormat(wanted);
  const row = rows && rows[0];
  if (!want || !row) return null;
  const here = parseJson(row.documentSettings, null);
  const next = { ...(here && typeof here === 'object' && !Array.isArray(here) ? here : {}) };
  if (want.locale) next.locale = want.locale;
  if (want.currency) next.currency = want.currency;
  else delete next.currency;
  return JSON.stringify(next) === JSON.stringify(here) ? null : ['UpdateRecord', '_grist_DocInfo', row.id, { documentSettings: JSON.stringify(next) }];
}
return { docFormat, docFormatOf, currencyOf, formatGap, formatAction };
})();

// ===== js/engine/logic/schema.js =====
__M["js/engine/logic/schema.js"] = (() => {
'use strict';
function schemaFrom(tables, columns) {
  const byId = new Map(tables.map(tb => [tb.tableId, tb]));
  const colById = new Map(columns.map(c => [c.id, c]));
  return {
    tableIds: tables.filter(tb => !tb.summarySourceTable && !tb.tableId.startsWith('GristHidden')).map(tb => tb.tableId).sort(),
    everyTableId: tables.map(tb => tb.tableId).sort(),
    has: tableId => byId.has(tableId),
    table: tableId => byId.get(tableId),
    resolve: tableId => (tables.find(tb => tb.tableId.toLowerCase() === String(tableId).toLowerCase()) || {}).tableId || null,
    tableIdOf: ref => (tables.find(tb => tb.id === ref) || {}).tableId || null,
    columns(tableId) {
      const table = byId.get(tableId);
      if (!table) return null;
      return columns.filter(c => c.parentId === table.id).sort((x, y) => x.parentPos - y.parentPos).map(c => ({
        id: c.id, colId: c.colId, type: c.type, isFormula: c.isFormula, formula: c.formula, label: c.label, description: c.description,
        displayCol: c.displayCol, recalcWhen: c.recalcWhen, recalcDeps: c.recalcDeps, widgetOptions: c.widgetOptions, rules: c.rules,
        visible: (colById.get(c.visibleCol) || {}).colId || '',
      }));
    },
  };
}

function destContext(schema, entry) {
  return {
    here: new Map((schema.columns(entry.dest) || []).map(c => [c.colId, c])),
    map: entry.map || {},
    own: new Set(Array.isArray(entry.own) ? entry.own : []),
  };
}
return { schemaFrom, destContext };
})();

// ===== js/engine/logic/column-formulas.js =====
__M["js/engine/logic/column-formulas.js"] = (() => {
'use strict';
const {KEY_COL} = __M["js/engine/logic/common.js"];
const {destContext} = __M["js/engine/logic/schema.js"];

const FORMULA_MAX = 1500;
const FORMULAS_TOTAL_MAX = 20000;

function cleanFormula(text, max = FORMULA_MAX) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return [...clean].length > max ? '' : clean;
}

const CONVERTED = /^(Ref(List)?:|Attachments$)/;

function sourceFormula(col) {
  if (!col || !col.isFormula || CONVERTED.test(col.type || '')) return '';
  return cleanFormula(col.formula);
}

function sourceDefault(col) {
  if (!col || col.isFormula || CONVERTED.test(col.type || '')) return '';
  if (col.recalcWhen && col.recalcWhen !== 0) return '';
  if (Array.isArray(col.recalcDeps) && col.recalcDeps.length > 1) return '';
  return cleanFormula(col.formula);
}

function withFormulas(columns, live) {
  const here = new Map((live || []).map(c => [c.colId, c]));
  let total = 0;
  const fit = (formula) => {
    const sent = formula && total + formula.length <= FORMULAS_TOTAL_MAX ? formula : '';
    total += sent.length;
    return sent;
  };
  return columns.map(({ fx, fd, ...c }) => {
    const col = here.get(c.id);
    const formula = fit(col ? sourceFormula(col) : '');
    const initial = fit(col ? sourceDefault(col) : '');
    return { ...c, fx: formula, ...(initial ? { fd: initial } : {}) };
  });
}

const hasText = value => typeof value === 'string' && value !== '';
const formulaItems = columns => (Array.isArray(columns) ? columns : []).filter(c => c && (hasText(c.fx) || hasText(c.fd)));
const formulasOffered = columns => (Array.isArray(columns) ? columns : []).some(c => c && typeof c.fx === 'string');
const formulasSent = columns => formulaItems(columns).length > 0;

const SAFE_MODULES = ['math', 'datetime', 'time', 'calendar', 're', 'json', 'decimal', 'statistics',
  'itertools', 'functools', 'collections', 'random', 'unicodedata'];

const FORBIDDEN = /\b(?:eval|exec|compile|open|input|breakpoint|help|exit|quit|getattr|setattr|delattr|globals|locals|vars|memoryview|attrgetter|methodcaller|Formatter|vformat|get_field|import_module|os|sys|subprocess|socket|urllib|requests|http|ftplib|smtplib|ctypes|importlib|pickle|shelve|shutil|pathlib|builtins|bltns|inspect|gc|signal|threading|multiprocessing|asyncio|operator|codecs|copyreg|enum|monitoring|REQUEST|Response|HTTPError|grist|docmodel|engine|sandbox|while|sleep)\b/g;

function stripStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '"' || ch === "'") {
      const { body, end } = readString(src, i);
      const prefix = /([A-Za-z]{1,2})$/.exec(out);
      out += prefix && /f/i.test(prefix[1]) ? ` ${body} ` : '""';
      i = end;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function readString(src, start) {
  const quote = src.startsWith(src[start].repeat(3), start) ? src[start].repeat(3) : src[start];
  let end = start + quote.length;
  while (end < src.length && !src.startsWith(quote, end) && !(quote.length === 1 && src[end] === '\n')) end += src[end] === '\\' ? 2 : 1;
  return { body: src.slice(start + quote.length, end), end: src.startsWith(quote, end) ? end + quote.length : end };
}

function importedModules(code) {
  const found = [...code.matchAll(/\bfrom\s+([A-Za-z_][\w.]*)\s+import\b/g)].map(m => m[1].split('.')[0]);
  const rest = code.replace(/\bfrom\s+[A-Za-z_][\w.]*\s+import\b[^\n;]*/g, ' ');
  for (const m of rest.matchAll(/\bimport\s+([^\n;]+)/g)) {
    found.push(...m[1].split(',').map(part => part.trim().split(/\s+as\s+/)[0].split('.')[0]).filter(Boolean));
  }
  return found;
}

const unique = list => list.filter((p, i) => list.findIndex(q => q.code === p.code && q.name === p.name) === i);

function formulaProblems(formula, { here, map = {}, tables = new Map(), every = new Set() }) {
  const code = stripStrings(formula);
  return unique([...forbiddenProblems(formula, code), ...referenceProblems(code, { here, map, tables, every })]);
}

const COLUMN_REF = /\$\s*([A-Za-z]\w*)|\brec\s*\.\s*([A-Za-z]\w*)/g;
const withoutColumns = code => code.normalize('NFKC').replace(COLUMN_REF, ' COLUMN ');

function forbiddenProblems(formula, code) {
  const problems = formula.includes('__') ? [{ code: 'unsafe', name: '__' }] : [];
  for (const odd of new Set(code.match(/[^\x00-\x7f]+/g) || [])) problems.push({ code: 'unsafe', name: odd.slice(0, 40) }); // dit à la personne : 40 caractères au plus
  const bare = withoutColumns(code);
  for (const word of new Set(bare.match(FORBIDDEN) || [])) problems.push({ code: 'unsafe', name: word });
  for (const hidden of new Set(bare.match(/\b_\w+/g) || [])) problems.push({ code: 'unsafe', name: hidden });
  const flagged = new Set(problems.map(p => p.name));
  for (const module of new Set(importedModules(bare))) if (!SAFE_MODULES.includes(module) && !flagged.has(module)) problems.push({ code: 'import', name: module });
  return problems;
}

function referenceProblems(code, { here, map, tables, every }) {
  const text = code.normalize('NFKC');
  const problems = [];
  const names = [...text.matchAll(/\$\s*([A-Za-z_]\w*)/g), ...text.matchAll(/\brec\s*\.\s*([A-Za-z_]\w*)/g)].map(m => m[1]);
  for (const name of names.filter(n => n !== 'id')) {
    const to = map[name] || name;
    if (to !== name) problems.push({ code: 'renamedCol', name, to });
    else if (!here.has(name)) problems.push({ code: 'missingCol', name });
  }
  const bare = text.replace(/\$\s*[A-Za-z_]\w*|\brec\s*\.\s*[A-Za-z_]\w*/g, ' ');
  const cited = new Set([...bare.matchAll(/(?<![.\w])([A-Z]\w*)\s*\.\s*(?:lookup\w*|all)\b/g)].map(m => m[1]));  // un identifiant de table commence par une majuscule
  for (const m of bare.matchAll(/(?<![.\w])([A-Za-z_]\w*)\b(?!\s*=(?!=))/g)) if (every.has(m[1]) || tables.has(m[1])) cited.add(m[1]);
  for (const name of cited) {
    const to = tables.get(name);
    if (to === undefined) problems.push({ code: 'foreignTable', name });
    else if (to !== name) problems.push({ code: 'renamedTable', name, to });
  }
  return problems;
}

function placed(column, kind, formula) {
  if (kind === 'column') return !column.isFormula ? 'data' : column.formula === formula ? 'same' : 'other';
  if (column.isFormula || !column.formula) return 'data';
  return column.formula === formula && !column.recalcWhen && !(Array.isArray(column.recalcDeps) && column.recalcDeps.length > 1) ? 'same' : 'other';
}

function planFormulas(schema, entry, columns, { tables = new Map(), replace = false } = {}) {
  const context = { entry, ...destContext(schema, entry), tables, every: new Set(schema.everyTableId || schema.tableIds || []), replace };
  const items = [];
  const actions = [];
  for (const sent of formulaItems(columns)) {
    const planned = planFormula(sent, context);
    if (!planned) continue;
    if (planned.action) actions.push(planned.action);
    items.push(planned.item);
  }
  return { items, actions };
}

function planFormula(c, { entry, here, own, map, tables, every, replace }) {
  const kind = hasText(c.fx) ? 'column' : 'default';
  const formula = cleanFormula(kind === 'column' ? c.fx : c.fd);
  const to = map[c.id] || c.id;
  const column = here.get(to);
  if (!formula || !column || to === KEY_COL) return null;
  const problems = objections({ formula, kind, column, to, owned: own.has(c.id) }, { here, map, tables, every });
  const state = placed(column, kind, formula);
  const ok = !problems.length;
  const applied = replace && ok && state !== 'same';
  return { action: applied ? formulaWrite(entry.dest, to, kind, formula) : null, item: { id: c.id, to, label: c.label || c.id, formula, kind, state: applied ? 'same' : state, problems, ok, applied } };
}

function objections({ formula, kind, column, to, owned }, { here, map, tables, every }) {
  const problems = formulaProblems(formula, { here, map, tables, every });
  if (!owned) problems.unshift({ code: 'notOwn', name: to });
  if (kind === 'default' && column.isFormula) problems.unshift({ code: 'formulaHere', name: to });
  return problems;
}

const formulaWrite = (dest, to, kind, formula) => ['ModifyColumn', dest, to, kind === 'column' ? { isFormula: true, formula } : { isFormula: false, formula, recalcWhen: 0 }];
return { FORMULA_MAX, FORMULAS_TOTAL_MAX, cleanFormula, sourceFormula, sourceDefault, withFormulas, formulaItems, formulasOffered, formulasSent, SAFE_MODULES, formulaProblems, planFormulas };
})();

// ===== js/engine/logic/layout.js =====
__M["js/engine/logic/layout.js"] = (() => {
'use strict';
const {destContext} = __M["js/engine/logic/schema.js"];

const POS_MAX = 100000;

const isPos = pos => Number.isInteger(pos) && pos >= -1 && pos <= POS_MAX;

function modelSection(table, sections) {
  if (!table || !Array.isArray(sections)) return null;
  const found = sections.filter(s => s && s.tableRef === table.id && s.parentKey === 'record' && s.parentId > 0
    && s.id !== table.rawViewSectionRef && s.id !== table.recordCardViewSectionRef);
  return found.sort((a, b) => a.id - b.id)[0] || null;
}

function withLayout(columns, live, tableRow, sections, fields) {
  const section = modelSection(tableRow, sections);
  if (!section || !Array.isArray(fields)) return columns.map(({ pos, ...c }) => c);
  const refs = new Map(live.map(c => [c.colId, c.id]));
  const sent = new Set(columns.map(c => refs.get(c.id)));
  const order = fields.filter(f => f.parentId === section.id && sent.has(f.colRef)).sort((a, b) => a.parentPos - b.parentPos).map(f => f.colRef);
  return columns.map(c => ({ ...c, pos: order.includes(refs.get(c.id)) ? order.indexOf(refs.get(c.id)) : -1 }));
}

const layoutSent = columns => (Array.isArray(columns) ? columns : []).some(c => c && isPos(c.pos));

function planLayout(schema, entry, columns, { sections, fields, replace = false } = {}) {
  const section = modelSection(schema.table(entry.dest), sections);
  if (!section || !Array.isArray(fields)) return { actions: [], laid: [] };
  const { here, map, own } = destContext(schema, entry);
  const done = new Set(entry.laid || []);
  const field = new Map(fields.filter(f => f.parentId === section.id).map(f => [f.colRef, f]));
  const asked = columns.filter(c => isPos(c.pos) && own.has(c.id) && here.has(map[c.id] || c.id) && (replace || !done.has(c.id)))
    .map(c => ({ id: c.id, pos: c.pos, column: here.get(map[c.id] || c.id) }));
  const actions = [];
  const hidden = asked.filter(a => a.pos < 0 && field.has(a.column.id));
  if (hidden.length) actions.push(['BulkRemoveRecord', '_grist_Views_section_field', hidden.map(a => field.get(a.column.id).id)]);
  const shown = asked.filter(a => a.pos >= 0 && (field.has(a.column.id) || replace)).sort((a, b) => a.pos - b.pos);
  const missing = shown.filter(a => !field.has(a.column.id));
  const last = Math.max(0, ...[...field.values()].map(f => f.parentPos));
  const slots = [...shown.filter(a => field.has(a.column.id)).map(a => field.get(a.column.id).parentPos).sort((a, b) => a - b),
    ...missing.map((_, i) => last + i + 1)];
  const moved = [];
  const added = [];
  shown.forEach((a, i) => {
    if (!field.has(a.column.id)) added.push(['AddRecord', '_grist_Views_section_field', null, { parentId: section.id, colRef: a.column.id, parentPos: slots[i] }]);
    else if (field.get(a.column.id).parentPos !== slots[i]) moved.push([field.get(a.column.id).id, slots[i]]);
  });
  if (moved.length) actions.push(['BulkUpdateRecord', '_grist_Views_section_field', moved.map(([id]) => id), { parentPos: moved.map(([, pos]) => pos) }]);
  return { actions: [...actions, ...added], laid: asked.map(a => a.id) };
}
return { POS_MAX, isPos, modelSection, withLayout, layoutSent, planLayout };
})();

// ===== js/engine/logic/descriptions.js =====
__M["js/engine/logic/descriptions.js"] = (() => {
'use strict';

const {formulasSent} = __M["js/engine/logic/column-formulas.js"];
const {layoutSent} = __M["js/engine/logic/layout.js"];
const {destContext} = __M["js/engine/logic/schema.js"];

const NOTE_MAX = 300;
const TABLE_NOTE_MAX = 500;

function cleanNote(text, max = NOTE_MAX) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f؜​-‏‪-‮⁦-⁯﻿]/g, '')
    .replace(/[ ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chars = [...clean];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : clean;
}

function tableNoteOf(table, sections) {
  const raw = table && table.rawViewSectionRef;
  const section = raw && Array.isArray(sections) ? sections.find(s => s.id === raw) : null;
  return section ? cleanNote(section.description, TABLE_NOTE_MAX) : '';
}

function noteSent(columns) {
  const list = Array.isArray(columns) ? columns : [];
  const tdesc = list.find(c => c && typeof c.tdesc === 'string');
  return { notes: list.some(c => c && typeof c.desc === 'string'), table: Boolean(tdesc), tableNote: tdesc ? tdesc.tdesc : null };
}

const withTableNote = (columns, note) => columns.map(({ tdesc, ...c }, i) => (i === 0 && typeof note === 'string' ? { ...c, tdesc: note } : c));

function sentElements(columns) {
  const list = Array.isArray(columns) ? columns : [];
  const sent = noteSent(list);
  return [...(list.some(c => c && c.fmt) ? ['style'] : []), ...(sent.notes ? ['notes'] : []), ...(sent.table ? ['table'] : []), ...(layoutSent(list) ? ['layout'] : []), ...(formulasSent(list) ? ['formulas'] : [])];
}

function planNotes(schema, entry, columns, { replace = false, replaceTable = false, tableNote = null, sections = null } = {}) {
  const forColumns = columnNotePlan(schema, entry, columns, replace);
  const forTable = tableNotePlan(schema, entry, { replaceTable, tableNote, sections });
  return { actions: [...forColumns.actions, ...forTable.actions], described: forColumns.described, tabled: forTable.tabled };
}

const noteChange = (current, text, replace) => (replace ? (current || '') !== text : !current && Boolean(text));

function columnNotePlan(schema, entry, columns, replace) {
  const { here, map, own } = destContext(schema, entry);
  const done = new Set(entry.described || []);
  const actions = [];
  const described = [];
  for (const sent of columns) {
    const column = here.get(map[sent.id] || sent.id);
    if (typeof sent.desc !== 'string' || !column || (!replace && (done.has(sent.id) || !own.has(sent.id)))) continue;
    const text = cleanNote(sent.desc);
    if (noteChange(column.description, text, replace)) actions.push(['UpdateRecord', '_grist_Tables_column', column.id, { description: text }]);
    if (text || replace) described.push(sent.id);
  }
  return { actions, described };
}

function tableNotePlan(schema, entry, { replaceTable, tableNote, sections }) {
  const actions = [];
  let tabled = Boolean(entry.tabled);
  const raw = (schema.table(entry.dest) || {}).rawViewSectionRef;
  const section = raw && typeof tableNote === 'string' && Array.isArray(sections) ? sections.find(s => s.id === raw) : null;
  if (section && (replaceTable || (!tabled && tableNote))) {
    const text = cleanNote(tableNote, TABLE_NOTE_MAX);
    if (noteChange(section.description, text, replaceTable)) actions.push(['UpdateRecord', '_grist_Views_section', raw, { description: text }]);
    tabled = Boolean(text) || replaceTable;
  }
  return { actions, tabled };
}
return { NOTE_MAX, TABLE_NOTE_MAX, cleanNote, tableNoteOf, noteSent, withTableNote, sentElements, planNotes };
})();

// ===== js/engine/logic/exports.js =====
__M["js/engine/logic/exports.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {AUTHOR_COL, DELETE_COL, EXPORT_COL, HEX16, KEY_COL, KIND, ORDER_COL, RECALC_COL, RESEND_COL, SCHEMA_COL, SENT_TYPE, TABLE_COL, TYPE_COL, is, parseJson} = __M["js/engine/logic/common.js"];
const {rowFilter} = __M["js/engine/logic/filters.js"];
const {columnOptions, ruleStyle, ruleStyles} = __M["js/engine/logic/options.js"];
const {currencyOf} = __M["js/engine/logic/docformat.js"];
const {parseRule, ruleRefs} = __M["js/engine/logic/rules.js"];
const {cleanNote, noteSent, tableNoteOf, withTableNote} = __M["js/engine/logic/descriptions.js"];
const {isPos, layoutSent, modelSection, withLayout} = __M["js/engine/logic/layout.js"];
const {formulasOffered, sourceDefault, sourceFormula, withFormulas} = __M["js/engine/logic/column-formulas.js"];

const endNotice = exportId => [{ [EXPORT_COL]: exportId, [TYPE_COL]: KIND.end }];

const INTERNAL = new Set(['manualSort', KEY_COL, ORDER_COL, RECALC_COL, DELETE_COL]);
const dataColumns = cols => cols.filter(c => !INTERNAL.has(c.colId) && !c.colId.startsWith('gristHelper_'));

const LIFTED = { PositionNumber: 'Numeric', Id: 'Int' };
function sentType(type) {
  const sent = /^Ref(List)?:/.test(type) ? 'Text' : (Object.hasOwn(LIFTED, type) ? LIFTED[type] : type);
  return is(SENT_TYPE, sent) ? sent : null;
}

const unsentColumns = cols => dataColumns(cols).filter(c => !sentType(c.type)).map(c => ({ id: c.colId, label: c.label || c.colId, type: c.type }));

function exportableColumns(cols, { extras = false, doc = null, notes = false } = {}) {
  return dataColumns(cols).filter(c => sentType(c.type)).map((c) => {
    const type = sentType(c.type);
    const opts = sourceOptions(c, type, cols, { extras, doc });
    return { id: c.colId, label: c.label || c.colId, type, source: c.type, visible: c.visible || '', ...(opts ? { opts } : {}), ...(extras ? { fmt: true } : {}), ...(notes ? { desc: cleanNote(c.description) } : {}) };
  });
}

function sourceOptions(c, type, cols, { extras, doc }) {
  const base = columnOptions(type, c.widgetOptions, { extras });
  if (!extras) return base;
  const opts = { ...(base || {}) };
  const rules = sourceRules(c, cols);
  if (rules.length) opts.rules = rules;
  if (opts.numMode === 'currency' && !opts.currency && doc && currencyOf(doc)) opts.currency = currencyOf(doc);
  return Object.keys(opts).length ? columnOptions(type, opts, { extras: true }) : null;
}

const CONVERTED = /^(Ref(List)?:|Attachments$)/;

function sourceRules(c, cols) {
  const refs = Array.isArray(c.rules) ? c.rules.slice(1) : [];
  const styles = ruleStyles(c.widgetOptions);
  const byRow = new Map(cols.map(x => [x.id, x]));
  const byName = new Map(cols.map(x => [x.colId, x]));
  return refs.map((ref, i) => {
    const tree = parseRule((byRow.get(ref) || {}).formula);
    const plain = tree && ruleRefs(tree).every(id => byName.has(id) && !CONVERTED.test(byName.get(id).type));
    return plain ? { when: byRow.get(ref).formula, ...ruleStyle(styles[i]) } : null;
  }).filter(Boolean);
}

function elementCounts(schema, tables, sections) {
  const columns = (extras) => tables.flatMap(table => exportableColumns(schema.columns(table) || [], { extras, notes: !extras }));
  return {
    style: columns(true).filter(c => c.opts).length,
    notes: columns(false).filter(c => c.desc).length,
    tableNote: tables.filter(table => tableNoteOf(schema.table(table), sections)).length,
    layout: tables.filter(table => modelSection(schema.table(table), sections)).length,
    formulas: tables.reduce((sum, table) => sum + (schema.columns(table) || []).filter(c => sourceFormula(c) || sourceDefault(c)).length, 0),
  };
}

function pruneRules(columns) {
  const ids = new Set(columns.map(c => c.id));
  return columns.map(({ opts, ...c }) => {
    if (!opts || !opts.rules) return opts ? { ...c, opts } : c;
    const { rules, ...rest } = opts;
    const kept = rules.filter(r => ruleRefs(parseRule(r.when)).every(id => ids.has(id)));
    const next = kept.length ? { ...rest, rules: kept } : rest;
    return Object.keys(next).length ? { ...c, opts: next } : c;
  });
}

const withDoc = (columns, doc) => columns.map(({ doc: old, ...c }, i) => (i === 0 && doc && c.fmt ? { ...c, doc } : c));

const readTables = tables => [...new Set(tables.flatMap(({ table, columns }) => [table,
  ...columns.map(c => (/^Ref(?:List)?:(\w+)$/.exec(c.source || '') || [])[1]).filter(Boolean)]))];

const isFileColumn = c => c.type === 'Attachments';

function exportDrift(schema, tables) {
  const lost = tables.filter(tb => !schema.has(tb.table)).map(tb => tb.table);
  const present = tables.filter(tb => schema.has(tb.table));
  const changed = present.flatMap(({ table, columns }) => {
    const current = new Map(exportableColumns(schema.columns(table)).map(c => [c.id, c]));
    return columns.filter((c) => {
      const cur = current.get(c.id);
      return !cur || cur.source !== (c.source || c.type) || (cur.visible || '') !== (c.visible || '');
    }).map(c => `${table}.${c.id}`);
  });
  return { lost, changed };
}

const driftDetails = (schema, tables) => tables.filter(tb => schema.has(tb.table)).flatMap(driftOf(schema));

const typeOf = c => c.source || c.type;
const driftOf = schema => ({ table, columns }) => {
  const current = new Map(exportableColumns(schema.columns(table)).map(c => [c.id, c]));
  const sent = new Set(columns.map(c => c.id));
  const unsent = [...current.values()].filter(c => !sent.has(c.id));
  const gone = columns.filter(c => !current.has(c.id));
  return columns.flatMap((c) => {
    const cur = current.get(c.id);
    if (!cur) {
      const twins = unsent.filter(u => typeOf(u) === typeOf(c));
      const alike = gone.filter(g => typeOf(g) === typeOf(c));
      return [{ table, id: c.id, kind: 'gone', ...(twins.length === 1 && alike.length === 1 ? { to: twins[0].id } : {}) }];
    }
    if (cur.source !== typeOf(c)) return [{ table, id: c.id, kind: 'retyped', was: typeOf(c), now: cur.source }];
    return (cur.visible || '') !== (c.visible || '') ? [{ table, id: c.id, kind: 'shown' }] : [];
  });
};

const SYNC_FIELDS = [EXPORT_COL, TABLE_COL, TYPE_COL, SCHEMA_COL, RESEND_COL];

const textExtras = ({ opts, fmt, doc, desc, tdesc, pos, fx, fd }) => ({
  ...(opts ? { opts } : {}), ...(fmt ? { fmt: true } : {}), ...(doc ? { doc } : {}),
  ...(typeof desc === 'string' ? { desc } : {}), ...(typeof tdesc === 'string' ? { tdesc } : {}),
  ...(isPos(pos) ? { pos } : {}),
  ...(typeof fx === 'string' ? { fx } : {}),
  ...(typeof fd === 'string' && fd ? { fd } : {}),
});
const columnText = (column, withOpts) => {
  const { id, type, label, source, visible, as, link, list } = column;
  const head = { id, type, label, source, visible, ...(as ? { as } : {}), ...(link ? { link } : {}), ...(link && list === true ? { list: true } : {}) };
  return withOpts ? { ...head, ...textExtras(column) } : head;
};
const schemaText = (columns, withOpts = true) => JSON.stringify(columns.map(column => columnText(column, withOpts)));
const filteredColumns = ({ columns, filter }) => (rowFilter(filter) ? columns.map(({ opts, ...c }) => {
  const { choices, choiceOptions, ...format } = opts || {};
  return Object.keys(format).length ? { ...c, opts: format } : c;
}) : columns);
function wantedValues({ columns, filter }, kinds) {
  const schema = schemaText(filteredColumns({ columns, filter }));
  const kept = rowFilter(filter);
  return new Map([...kinds.map(kind => [kind, schema]), ...(kept ? [[KIND.filter, JSON.stringify(kept)]] : [])]);
}

const withoutOpts = text => schemaText(parseJson(text, []) || [], false);
function tableChanged(here, values) {
  const filterWas = (here.find(r => r[TYPE_COL] === KIND.filter) || {})[SCHEMA_COL] || '';
  return !here.length || here.some(r => r[TYPE_COL] !== KIND.filter && withoutOpts(r[SCHEMA_COL]) !== withoutOpts(values.get(KIND.keys)))
    || filterWas !== (values.get(KIND.filter) || '');
}

function exportRowsActions(rows, exportId, tables, { isPublic = false, swap = false } = {}) {
  const mine = rows.filter(r => r[EXPORT_COL] === exportId);
  const kinds = [KIND.keys, KIND.lot, KIND.track, ...(isPublic ? [KIND.full, KIND.mark] : [])];
  const wanted = [];
  const changed = [];
  for (const tb of tables) {
    const values = wantedValues(tb, tb.columns.some(isFileColumn) ? [...kinds, KIND.files] : kinds);
    const here = mine.filter(r => r[TABLE_COL] === tb.table);
    if (tableChanged(here, values)) changed.push(tb.table);
    for (const [kind, value] of values) wanted.push({ table: tb.table, kind, value, row: here.find(r => r[TYPE_COL] === kind) });
  }
  if (swap) wanted.push({ table: '', kind: KIND.swap, value: '', row: mine.find(r => r[TYPE_COL] === KIND.swap) });
  const keys = new Set(wanted.map(w => `${w.table}|${w.kind}`));
  const add = wanted.filter(w => !w.row)
    .map(w => ({ [EXPORT_COL]: exportId, [TABLE_COL]: w.table, [TYPE_COL]: w.kind, [SCHEMA_COL]: w.value, [RESEND_COL]: '' }));
  const update = wanted.filter(w => w.row && w.kind !== KIND.swap && w.row[SCHEMA_COL] !== w.value);
  const remove = mine.filter(r => r[TYPE_COL] !== KIND.sign && !keys.has(`${r[TABLE_COL]}|${r[TYPE_COL]}`)).map(r => r.id);
  const actions = [];
  if (add.length) actions.push(['BulkAddRecord', __C.SYNC_TABLE, add.map(() => null), Object.fromEntries(SYNC_FIELDS.map(c => [c, add.map(r => r[c])]))]);
  if (update.length) actions.push(['BulkUpdateRecord', __C.SYNC_TABLE, update.map(w => w.row.id), { [SCHEMA_COL]: update.map(w => w.value) }]);
  if (remove.length) actions.push(['BulkRemoveRecord', __C.SYNC_TABLE, remove]);
  return { actions, changed };
}

function exportTables(rows, exportId) {
  const mine = rows.filter(r => r[EXPORT_COL] === exportId && r[TYPE_COL] !== KIND.swap && r[TYPE_COL] !== KIND.sign);
  const tables = new Map();
  for (const r of mine) {
    if (r[TYPE_COL] !== KIND.filter && !tables.has(r[TABLE_COL])) tables.set(r[TABLE_COL], parseJson(r[SCHEMA_COL], []) || []);
  }
  const filterOf = table => rowFilter(parseJson((mine.find(r => r[TABLE_COL] === table && r[TYPE_COL] === KIND.filter) || {})[SCHEMA_COL], null));
  return [...tables].map(([table, columns]) => ({ table, columns, filter: filterOf(table) }));
}

const SCHEMA_KINDS = [KIND.keys, KIND.lot, KIND.track, KIND.full, KIND.mark, KIND.files];
function optionsActions(rows, schema, doc = null, sections = null, fields = null) {
  const ids = [];
  const values = [];
  for (const exportId of new Set(rows.map(r => r[EXPORT_COL]))) {
    for (const { table, columns, filter } of exportTables(rows, exportId).filter(tb => schema.has(tb.table))) {
      const live = schema.columns(table);
      const here = new Map(live.map(c => [c.colId, c]));
      const extras = columns.some(c => c.fmt);
      const fresh = columns.map(({ opts, desc, ...c }) => {
        const next = here.has(c.id) ? sourceOptions(here.get(c.id), c.type, live, { extras, doc }) : opts;
        const note = typeof desc === 'string' ? { desc: here.has(c.id) ? cleanNote(here.get(c.id).description) : desc } : {};
        return { ...c, ...(next ? { opts: next } : {}), ...note };
      });
      const sent = noteSent(columns);
      const styled = extras ? withDoc(pruneRules(fresh), doc) : fresh;
      const described = sent.table && sections ? withTableNote(styled, tableNoteOf(schema.table(table), sections)) : styled;
      const formulas = formulasOffered(columns) ? withFormulas(described, live) : described;
      const laidOut = layoutSent(columns) && sections && fields ? withLayout(formulas, live, schema.table(table), sections, fields) : formulas;
      const value = schemaText(filteredColumns({ columns: laidOut, filter }));
      for (const r of rows.filter(x => x[EXPORT_COL] === exportId && x[TABLE_COL] === table && SCHEMA_KINDS.includes(x[TYPE_COL]) && x[SCHEMA_COL] !== value)) {
        ids.push(r.id);
        values.push(value);
      }
    }
  }
  return ids.length ? [['BulkUpdateRecord', __C.SYNC_TABLE, ids, { [SCHEMA_COL]: values }]] : [];
}

const swapExports = rows => new Set(rows.filter(r => r[TYPE_COL] === KIND.swap).map(r => r[EXPORT_COL]));

const conditionOf = exportId => `rec.${EXPORT_COL} == "${exportId}" and rec.${TYPE_COL} in ("${KIND.keys}", "${KIND.lot}")`;
function exportCondition(exportId) {
  if (!is(HEX16, exportId)) throw new Error('codeInvalid');
  return conditionOf(exportId);
}

function conditionExport(text) {
  const [before, after] = conditionOf('\u0000').split('\u0000');
  const s = String(text || '');
  if (!s.startsWith(before) || !s.endsWith(after)) return '';
  const id = s.slice(before.length, s.length - after.length);
  return HEX16.test(id) ? id : '';
}

const hookName = (name, exportId) => `Synchro ${name} #${exportId}`;

const SLOW_MS = 180000;
const waitingTooLong = (u, now) => u.status === 'sending' && u.updatedTime > 0 && now - u.updatedTime > SLOW_MS;

function hookStatus(h, now = Date.now()) {
  if (!h.fields.enabled) return ['paused', 'off'];
  const u = h.usage || {};
  const failing = ['retrying', 'error', 'postponed', 'invalid'].includes(u.status) || u.lastHttpStatus >= 400 || waitingTooLong(u, now);
  return failing ? ['error', 'err'] : ['active', 'ok'];
}

function failureStatus(h) {
  const u = h.usage || {};
  const batch = u.lastEventBatch;
  if (batch && batch.status !== 'success') return batch.httpStatus || 0;
  return u.lastHttpStatus || 0;
}

function failureMessage(h) {
  const u = h.usage || {};
  const batch = u.lastEventBatch;
  return String((batch && batch.status !== 'success' && batch.errorMessage) || u.lastErrorMessage || '');
}

const hookBusy = h => Boolean(h.fields.enabled) && (((h.usage || {}).numWaiting || 0) > 0 || ['sending', 'retrying', 'postponed'].includes((h.usage || {}).status));

const queueBlocker = hooks => hooks.find(h => hookStatus(h)[0] === 'error') || null;

function tooLarge(h) {
  const u = h.usage || {};
  return ['retrying', 'postponed'].includes(u.status) && (u.lastEventBatch || {}).httpStatus === 413;
}

function hookErrorKey(h, now = Date.now()) {
  const u = h.usage || {};
  const status = failureStatus(h);
  if (status === 413) return 'send.error.size';
  if (/Invalid column/i.test(u.lastErrorMessage || '')) return 'send.error.column';
  if (status === 404 && /Table not found/i.test(failureMessage(h))) return 'send.error.journal';
  if ([401, 403, 404].includes(status)) return 'send.error.link';
  if (status === 429 || /too many requests|rate.?limit/i.test(u.lastErrorMessage || '')) return 'send.error.rate';
  if (status >= 500) return 'send.error.server';
  if (waitingTooLong(u, now)) return 'send.error.slow';
  return !status && u.lastErrorMessage ? 'send.error.network' : 'send.error.other';
}

const DEAD_KEYS = ['send.error.link', 'send.error.journal'];

function autoPauseKind(h, now = Date.now()) {
  if (!h.fields.enabled || hookStatus(h, now)[0] !== 'error') return '';
  const key = hookErrorKey(h, now);
  if (DEAD_KEYS.includes(key)) return 'link';
  return key === 'send.error.slow' ? 'slow' : '';
}

const NO_UNBLOCK = ['send.error.link', 'send.error.journal', 'send.error.rate', 'send.error.server', 'send.error.network', 'send.error.slow'];

function exportStatus(exp) {
  if (exp.recipients.some(h => hookStatus(h)[0] === 'error')) return ['error', 'err'];
  if (exp.recipients.length && exp.echange && !exp.retour) return ['participants', 'ok'];
  if (exp.recipients.length || exp.public) return ['people', 'ok'];
  return exp.invitations.length ? ['invited', 'pending'] : ['alone', 'off'];
}

const memoText = text => String(text || '').replace(/\s*·\s*/g, ' - ').trim();
const hookMemo = ({ email, docId, team, docName }) => {
  const name = memoText(docName);
  return [email, docId, name ? `${team || ''}/${name}` : team].filter(Boolean).join(' · ');
};

function hookLabel(memo, docName = '') {
  const parts = String(memo || '').split(' · ').filter(Boolean);
  let at = parts.findIndex(p => p.includes('/'));
  if (at < 0 && parts.length === 3) at = 2;
  const place = at < 0 ? '' : parts[at];
  const team = place.split('/')[0];
  const name = memoText(docName) || place.slice(team.length + 1);
  const shown = [team, name].filter(Boolean).join('/');
  if (at < 0) return [...parts, shown].filter(Boolean).join(' · ');
  return parts.map((p, i) => (i === at ? shown : p)).filter(Boolean).join(' · ');
}

function memoDoc(memo) {
  const parts = String(memo || '').split(' · ').filter(Boolean);
  const email = parts.find(p => p.includes('@')) || '';
  const rest = parts.filter(p => p !== email);
  const placeOnly = rest.length === 1 && rest[0].includes('/');
  const place = (placeOnly ? rest[0] : rest[1]) || '';
  const team = place.split('/')[0];
  return { email, docId: placeOnly ? '' : rest[0] || '', team, name: place.slice(team.length + 1) };
}

const ownJournal = hook => ({ note }) => note.hook === hook.id
  || (!note.hook && Boolean((note.from || {}).docId) && (hook.fields.memo || '').split(' · ').includes(note.from.docId));

const exportEmail = (rows, exportId) => (rows.find(r => r[EXPORT_COL] === exportId) || {})[AUTHOR_COL] || '';

const hooksOf = (hooks, conditions, exportId) =>
  hooks.filter(h => h.fields.tableId === __C.SYNC_TABLE && conditionExport(conditions.get(h.id)) === exportId);

function exchangeTables(entries, columnsOf) {
  return entries.map((entry) => {
    const map = entry.map || {};
    const back = new Map([...new Set([...(entry.columns || []).map(c => c.id), ...Object.keys(map)])].map(id => [map[id] || id, id]));
    const columns = (columnsOf(entry.dest) || []).filter(c => back.has(c.id)).map(c => ({ ...c, as: back.get(c.id) }));
    return { table: entry.dest, columns, filter: null };
  }).filter(tb => tb.columns.length);
}

const returnExportTables = (note, schema) => exchangeTables(note.tables, dest => exportableColumns(schema.columns(dest) || []));

function exchangeColumns(sent, allowed, map = {}) {
  const target = c => map[c.id] || c.as || c.id;
  const kept = sent.filter(c => allowed.has(target(c)));
  return { sent: kept, map: Object.fromEntries(kept.map(c => [c.id, target(c)])) };
}
return { endNotice, sentType, unsentColumns, exportableColumns, sourceOptions, elementCounts, pruneRules, withDoc, readTables, isFileColumn, exportDrift, driftDetails, exportRowsActions, exportTables, optionsActions, swapExports, exportCondition, conditionExport, hookName, SLOW_MS, hookStatus, failureStatus, hookBusy, queueBlocker, tooLarge, hookErrorKey, DEAD_KEYS, autoPauseKind, NO_UNBLOCK, exportStatus, hookMemo, hookLabel, memoDoc, ownJournal, exportEmail, hooksOf, exchangeTables, returnExportTables, exchangeColumns };
})();

// ===== js/engine/logic/formulas.js =====
__M["js/engine/logic/formulas.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {AUTHOR_COL, BUCKETS, COL_ID, DELETE_COL, EXPORT_COL, HUB, KEY_COL, KIND, LIST_COL, LOT_COL, MISSING_COL, ORDER_COL, RECALC_COL, RESEND_COL, SCHEMA_COL, LINK_PREFIX, TABLE_COL, TRACK_COL, TYPE_COL, chunk, isBlank} = __M["js/engine/logic/common.js"];

const WINDOW_S = 5; // un lot porte les lignes modifiées depuis 5 secondes
const SMALL_TABLE = 20;
const LOT_MAX = 250000;
const POST_MAX = 950000;
const LOT_MIN = 20000;
const PUBLIC_MAX = 2000000;
const PART_KEYS = 5000;

const filterLines = () => [
  'def kind(s):',
  '  if s == "Bool": return "bool"',
  '  if s in ("Numeric", "Int"): return "number"',
  '  if s == "Date" or s.startswith("DateTime"): return "date"',
  '  if s.startswith("RefList:"): return "refs"',
  '  if s.startswith("Ref:"): return "ref"',
  '  return "list" if s == "ChoiceList" else "text"',
  'def items(r, c, k):',
  '  try:',
  '    x = getattr(r, c["id"])',
  '    if k == "ref": return [x.id] if x and x.id else []',
  '    if k == "refs": return [y.id for y in x] if x else []',
  '    if k == "list": return [txt(y) for y in x] if isinstance(x, (list, tuple)) else []',
  '    if k == "bool": return [x is True]',
  '    if k == "number": return [x] if isinstance(x, (int, float)) and not isinstance(x, bool) else []',
  '    if k == "date": return [x.date().isoformat() if isinstance(x, datetime.datetime) else x.isoformat()] if isinstance(x, datetime.date) else []',
  '  except Exception:',
  '    return []',
  '  t = txt(g(r, c))',
  '  return [t] if t else []',
  'def test(r, c):',
  '  op, w, k = c.get("op") or "", c.get("values") or [], kind(c.get("source") or "")',
  '  if op.startswith("not"): return not test(r, dict(c, op=op[3:]))',
  '  if op in ("contains", "starts", "eq") and k not in ("number", "date"):',
  '    t = txt(g(r, c))',
  '    return t == w[0] if op == "eq" else t.startswith(w[0]) if op == "starts" else w[0] in t',
  '  i = items(r, c, k)',
  '  if op == "empty": return not i',
  '  if op == "in": return any(x in w for x in i)',
  '  if op == "true": return i == [True]',
  '  if op == "false": return i != [True]',
  '  if not i: return False',
  '  x = i[0]',
  '  if op == "between": return w[0] <= x <= w[1]',
  '  return {"eq": x == w[0], "lt": x < w[0], "le": x <= w[0], "gt": x > w[0], "ge": x >= w[0]}.get(op, False)',
  'def ok(r, c):',
  '  try:',
  '    return test(r, c)',
  '  except Exception:',
  '    return False',
  `f = ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.filter}")`,
  `spec = json.loads(f.${SCHEMA_COL} or "null") if f.id else None`,
  'def keep(r):',
  '  if not spec: return True',
  '  if "conds" not in spec: return txt(g(r, spec)) == spec["value"]',
  '  oks = [ok(r, c) for c in spec["conds"]]',
  '  return any(oks) if spec.get("mode") == "any" else all(oks)',
];

const readLines = () => [
  'import json, datetime, math',
  'def v(x):',
  '  if isinstance(x, float) and not math.isfinite(x): return None',
  '  if isinstance(x, datetime.datetime): return x.timestamp()',
  '  if isinstance(x, datetime.date): return (x - datetime.date(1970, 1, 1)).days * 86400',
  '  if isinstance(x, (list, tuple)): return [v(y) for y in x]',
  '  return x if x is None or isinstance(x, (str, int, float, bool)) else str(x)',
  'def g(r, c):',
  '  try:',
  '    x, s, w = getattr(r, c["id"]), c.get("source", ""), c.get("visible", "")',
  '    if s == "Attachments": return [[y.fileIdent, y.fileName, y.fileSize] for y in x] or None',
  '    if s.startswith("RefList:"): return ", ".join(str(getattr(y, w) if w else y.id) for y in x)',
  '    if s.startswith("Ref:"): return v(getattr(x, w) if w else x.id)',
  '    return v(x)',
  '  except Exception:',
  '    return None',
  'def data(r, cols):',
  '  out = {c["id"]: g(r, c) for c in cols}',
  '  for c in cols:',
  '    if c.get("link"):',
  '      try:',
  `        out["${LINK_PREFIX}" + c["id"]] = getattr(r, c["id"]).${KEY_COL} or None`,
  '      except Exception:',
  '        out["' + LINK_PREFIX + '" + c["id"]] = None',
  '  return out',
  'def txt(x):',
  '  if isinstance(x, bool): return "oui" if x else "non"',
  '  if isinstance(x, float) and x.is_integer(): x = int(x)',
  '  if isinstance(x, list): return ", ".join(txt(y) for y in x)',
  '  return "" if x is None else str(x).strip().lower()',
  ...filterLines(),
];

function signed(lines, kind) {
  return [
    'def body():', ...lines.join('\n').split('\n').map(line => `  ${line}`),
    'text = body()',
    `if $${TYPE_COL} != "${kind}" or not isinstance(text, str) or not text.startswith("{"): return text`,
    `k = ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.sign}").${SCHEMA_COL}`,
    'if not k: return text',
    'import hmac, hashlib, json',
    'try:',
    '  keys = list(json.loads(k).values()) if k.startswith("{") else [k]',
    'except Exception:',
    '  keys = []',
    `d = hashlib.sha256("|".join([$${EXPORT_COL} or "", $${TABLE_COL} or "", $${TYPE_COL} or "", $${SCHEMA_COL} or "", text]).encode("utf-8")).hexdigest().encode()`,
    'sigs = dict((hashlib.sha256(x.encode()).hexdigest()[:8], hmac.new(x.encode(), d, hashlib.sha256).hexdigest()[:32]) for x in keys if isinstance(x, str) and x)',
    'if not sigs: return text',
    'return text[:-1] + \', "sigs": %s}\' % json.dumps(sigs, sort_keys=True)',
  ];
}

function syncFormulas(tables) {
  const ids = [...new Set(tables)].filter(id => COL_ID.test(id)).sort();
  const pick = `tables = {${ids.map(id => `"${id}": ${id}`).join(', ')}}\nsrc = tables.get($${TABLE_COL})`;
  return { keys: keysFormula(pick), lot: lotFormula(pick), state: stateFormula(pick) };
}

function keysFormula(pick) {
  return signed([
    `if $${TYPE_COL} == "${KIND.mark}":`,
    '  import zlib',
    `  c = ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.full}").${LOT_COL} or ""`,
    '  return "%d:%08x" % (len(c), zlib.crc32(c.encode()))',
    `if $${TYPE_COL} not in ("${KIND.keys}", "${KIND.track}"): return ""`,
    `if $${TYPE_COL} == "${KIND.keys}" and ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.swap}").id: return ""`,
    pick, 'if src is None: return ""', ...readLines(),
    `if $${TYPE_COL} == "${KIND.track}":`,
    '  import zlib',
    `  sums = [zlib.crc32(str(r.${KEY_COL}).encode()) for r in src.all if r.${KEY_COL} and keep(r)]`,
    '  return "%d:%08x" % (len(sums), sum(sums) & 0xffffffff)',
    'import bisect',
    `s = ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.track}")`,
    `state = json.loads(s.${TRACK_COL}) if s.id and isinstance(s.${TRACK_COL}, str) and s.${TRACK_COL}.startswith("{") else {}`,
    'out = {"t": state["t"], "seaux": state["seaux"]} if state.get("seaux") else {}',
    `ask = json.loads($${RESEND_COL}) if ($${RESEND_COL} or "").startswith("{") else None`,
    'if ask and state.get("t"):',
    `  have = sorted(set(str(r.${KEY_COL}) for r in src.all if r.${KEY_COL} and keep(r)))`,
    '  i = bisect.bisect_right(have, str(ask.get("apres") or ""))',
    `  out["liste"] = {"marque": ask.get("marque"), "n": ask.get("n"), "t": state["t"], "cles": have[i:i + ${PART_KEYS}], "fin": i + ${PART_KEYS} >= len(have)}`,
    'return json.dumps(out) if out else ""',
  ], KIND.keys).join('\n');
}

function lotFormula(pick) {
  return signed([
    ...lotHeadLines(pick), ...lotFilesLines(), ...lotWindowLines(), ...lotWhenLines(), ...lotPackLines(), ...lotAnnounceLines(), ...lotTallyLines(),
    'return json.dumps(lot, ensure_ascii=False)',
  ], KIND.lot).join('\n');
}

const lotHeadLines = pick => [
  `if $${TYPE_COL} not in ("${KIND.lot}", "${KIND.full}", "${KIND.files}"): return ""`, pick, 'if src is None: return ""', ...readLines(),
  `cols = json.loads($${SCHEMA_COL} or "[]")`,
  `asked = ($${RESEND_COL} or "").split(":")`,
  'again = set(int(i) for i in asked[-1].split(",") if i.strip().isdigit())',
  'rest = int(asked[1]) if len(asked) == 3 and asked[1].isdigit() else None',
  `if $${TYPE_COL} != "${KIND.lot}": rows = [r for r in src.all if r.${KEY_COL} and keep(r)]`,
];

const lotFilesLines = () => [
  `if $${TYPE_COL} == "${KIND.files}":`,
  '  files = {}',
  '  for r in rows:',
  '    for c in cols:',
  '      if c.get("source") != "Attachments": continue',
  '      try:',
  '        for y in getattr(r, c["id"]): files[y.fileIdent] = [y.id, y.fileName, y.fileSize]',
  '      except Exception:',
  '        pass',
  '  return json.dumps(files, ensure_ascii=False)',
];

const lotWindowLines = () => [
  'undone = set()',
  `if $${TYPE_COL} == "${KIND.lot}":`,
  `  swap = ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.swap}")`,
  `  mute = swap.id and swap.${SCHEMA_COL} != "${HUB}"`,
  `  stamps = [x.${MISSING_COL} for x in ${__C.SYNC_TABLE}.lookupRecords(${TYPE_COL}="${KIND.swap}") if isinstance(x.${MISSING_COL}, (int, float))]`,
  '  import time',
  `  cut = datetime.datetime.fromtimestamp(time.time() - ${WINDOW_S}, datetime.timezone.utc)`,
  '  c = v(cut)',
  `  hit = [r for r in src.all if (getattr(r, "${RECALC_COL}", None) or 0) > c or r.id in again]`,
  `  hit = [r for r in hit if r.${KEY_COL} and keep(r)]`,
  `  touched = [r for r in hit if (getattr(r, "${RECALC_COL}", None) or 0) > c]`,
  '  def echo(r):',
  `    t, m = v(getattr(r, "${RECALC_COL}")) or 0, v(r.${ORDER_COL}) or 0`,
  '    return any(abs(t - s) < 1 and m < s for s in stamps)',
  `  recent = set(r.id for r in touched if r.${ORDER_COL} and r.${ORDER_COL} >= cut and not (mute and echo(r)))`,
  '  fresh = set() if mute else set(r.id for r in touched if r.id not in recent and echo(r))',
  '  undone = set(r.id for r in touched if r.id not in recent and r.id not in fresh and not echo(r))',
  `  if len(touched) > (0 if swap.id else ${SMALL_TABLE}) and len(touched) == sum(1 for r in src.all if r.${KEY_COL} and keep(r)): undone = set()`,
  '  rows = [r for r in hit if r.id in again or r.id in recent or r.id in undone or r.id in fresh]',
];

const lotWhenLines = () => [
  'def when(r):',
  `  if r.id in undone: return v(getattr(r, "${RECALC_COL}"))`,
  `  if r.id in again and $${TYPE_COL} == "${KIND.lot}" and not swap.id: return max(v(r.${ORDER_COL}) or 0, v(getattr(r, "${RECALC_COL}", None)) or 0)`,
  `  return v(r.${ORDER_COL})`,
];

const lotPackLines = () => [
  `lists = ${__C.SYNC_TABLE}.lookupRecords(${EXPORT_COL}=$${EXPORT_COL}, ${TYPE_COL}="${KIND.keys}")`,
  `room = ${POST_MAX} - sum(len(r.${LIST_COL} or "") for r in lists)`,
  `budget = max(${LOT_MIN}, min(${LOT_MAX}, room // max(1, len(lists))))`,
  `capped = $${TYPE_COL} == "${KIND.lot}"`,
  'out, size, big = [], 0, []',
  `for r in sorted(rows, key=lambda r: when(r) or 0, reverse=True):`,
  `  line = [r.${KEY_COL}, when(r), v(getattr(r, "${DELETE_COL}", False)), data(r, cols)]`,
  '  n = len(json.dumps(line, ensure_ascii=False))',
  `  if capped and n > max(budget, room):`,
  `    big.append(r.${KEY_COL})`,
  '    continue',
  '  if capped and out and size + n > budget: break',
  '  size += n',
  `  if not capped and size > ${PUBLIC_MAX}: return json.dumps({"lignes": [], "total": len(rows), "trop": True})`,
  '  out.append(line)',
];

const lotAnnounceLines = () => [
  'lot = {"lignes": out, "total": len(rows)}',
  'if big: lot["tropGros"] = big',
  `if capped and len(out) + len(big) < len(rows): lot.update(depuis=v(cut), renvoi=bool(again))`,
  'if capped and rest is not None: lot["restant"] = rest',
];

const lotTallyLines = () => [
  'if capped and not swap.id:',
  `  tr = ${__C.SYNC_TABLE}.lookupOne(${EXPORT_COL}=$${EXPORT_COL}, ${TABLE_COL}=$${TABLE_COL}, ${TYPE_COL}="${KIND.track}")`,
  `  head = str(tr.${LIST_COL} or "").split(":")[0]`,
  `  st = json.loads(tr.${TRACK_COL}) if isinstance(tr.${TRACK_COL}, str) and tr.${TRACK_COL}.startswith("{") else {}`,
  '  if tr.id and head.isdigit() and st.get("t"): lot["bilan"] = {"n": int(head), "t": int(st["t"])}',
];

function stateFormula(pick) {
  return [
    'import json',
    `if $${TYPE_COL} == "${KIND.swap}": return NOW().timestamp()`,
    `if $${TYPE_COL} == "${KIND.lot}":`,
    `  lot = json.loads($${LOT_COL} or "{}")`,
    '  if lot.get("depuis") and not lot.get("renvoi"):',
    '    return min(value, lot["depuis"]) if value else lot["depuis"]',
    '  return value',
    `if $${TYPE_COL} != "${KIND.track}": return value`, pick, 'if src is None: return value', ...readLines(),
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
    { id: TRACK_COL, type: 'Any', isFormula: false, formula: state, recalcWhen: 0 },
    { id: AUTHOR_COL, type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0 },
  ];
}

const RECALC_SPEC = { type: 'Numeric', isFormula: true, formula: `$${ORDER_COL}\nimport time\nreturn time.time()` };

const missingSyncColumns = cols => [KEY_COL, ORDER_COL, RECALC_COL].filter(id => !cols.some(c => c.colId === id));

function prepareSourceActions(tableId, missing) {
  const specs = {
    [KEY_COL]: { type: 'Text', isFormula: false, formula: 'UUID()', recalcWhen: 0 },
    [ORDER_COL]: { type: 'DateTime:UTC', isFormula: false, formula: 'NOW()', recalcWhen: 2 },
    [RECALC_COL]: RECALC_SPEC,
  };
  return missing.map(colId => ['AddColumn', tableId, colId, specs[colId]]);
}

function keyTriggerAction(tableId, cols) {
  const key = cols.find(c => c.colId === KEY_COL);
  return key && !key.isFormula && key.formula !== 'UUID()' ? ['ModifyColumn', tableId, KEY_COL, { formula: 'UUID()', recalcWhen: 0 }] : null;
}

const deleteColumnAction = (tableId, cols) =>
  (cols.some(c => c.colId === DELETE_COL) ? null : ['AddColumn', tableId, DELETE_COL, { type: 'Bool', isFormula: false }]);

function majleAction(cols, colIds) {
  const majle = cols.find(c => c.colId === ORDER_COL);
  if (!majle) return null;
  const sent = cols.filter(c => colIds.includes(c.colId) || c.colId === DELETE_COL);
  const refs = [...new Set(sent.flatMap(c => [c.id, c.displayCol]).filter(Boolean))].sort((a, b) => a - b);
  const deps = ['L', ...refs];
  const same = majle.recalcWhen === 0 && JSON.stringify(majle.recalcDeps || null) === JSON.stringify(deps);
  return same || !refs.length ? null : ['UpdateRecord', '_grist_Tables_column', majle.id, { recalcWhen: 0, recalcDeps: deps }];
}

function fillKeyActions(tableId, rows, newId) {
  const empty = rows.filter(r => isBlank(r[KEY_COL])).map(r => r.id);
  return chunk(empty).map(ids => ['BulkUpdateRecord', tableId, ids, { [KEY_COL]: ids.map(() => newId()) }]);
}
return { LOT_MAX, syncFormulas, syncColumns, RECALC_SPEC, missingSyncColumns, prepareSourceActions, keyTriggerAction, deleteColumnAction, majleAction, fillKeyActions };
})();

// ===== js/engine/logic/strays.js =====
__M["js/engine/logic/strays.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, isBlank} = __M["js/engine/logic/common.js"];
const {conditionExport} = __M["js/engine/logic/exports.js"];
const {syncColumns} = __M["js/engine/logic/formulas.js"];

const SORT_COL = 'manualSort'; // colonne d'ordre de toute table Grist (voir ensureSyncTable)
const HELPER = /^gristHelper_/; // colonnes cachées de Grist (texte affiché d'une Référence...)

const ownsSync = schema => schema.has(__C.SYNC_TABLE) && schema.columns(__C.SYNC_TABLE).some(c => c.colId === EXPORT_COL);
const foreignSync = schema => schema.has(__C.SYNC_TABLE) && !ownsSync(schema);

function lostSync(schema, hooks, conditions) {
  if (ownsSync(schema)) return null;
  const own = hooks.filter(h => conditionExport(conditions.get(h.id)));
  if (!own.length) return null;
  const names = own.map(h => h.fields.tableId || '');
  const renamed = names.find(name => name && name !== __C.SYNC_TABLE);
  const kind = names.includes(__C.SYNC_TABLE) ? 'hidden' : renamed ? 'renamed' : 'deleted';
  return { kind, name: kind === 'renamed' ? renamed : '', hooks: own.map(h => h.id) };
}

const syncColumnIds = () => new Set(syncColumns([]).map(c => c.id));

const hasValue = v => !(isBlank(v) || v === 0 || v === false || (Array.isArray(v) && v.length <= 1));

function strayColumns(columns, rows = []) {
  const known = syncColumnIds();
  return columns.filter(c => !known.has(c.colId) && c.colId !== SORT_COL && !HELPER.test(c.colId)).map((c) => {
    const formula = c.isFormula ? String(c.formula || '').trim() : '';
    return {
      id: c.colId, label: c.label || c.colId, type: c.type || 'Any', formula,
      filled: c.isFormula ? 0 : rows.filter(r => hasValue(r[c.colId])).length,
    };
  });
}

const hasContent = stray => stray.filled > 0 || stray.formula !== '';

function refusedColumn(usage) {
  const found = /Invalid column\s*\\*"([^"\\]+)/i.exec((usage || {}).lastErrorMessage || '');
  return found ? found[1] : '';
}

function columnFault(usage, inSync) {
  const column = refusedColumn(usage);
  if (!column || syncColumnIds().has(column)) return '';
  return inSync.includes(column) ? 'stray' : 'gone';
}

function freeTableName(taken, base = `Table_${__C.SYNC_TABLE}`) {
  const used = new Set([...taken].map(name => name.toLowerCase()));
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}${n}`;
  return name;
}

function tableNameProblem(name, taken) {
  const text = String(name || '').trim();
  if (!text) return 'empty';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return 'invalid';
  if ([...taken].some(other => other.toLowerCase() === text.toLowerCase())) return 'taken';
  return '';
}
return { ownsSync, foreignSync, lostSync, syncColumnIds, strayColumns, hasContent, refusedColumn, columnFault, freeTableName, tableNameProblem };
})();

// ===== js/engine/logic/codes.js =====
__M["js/engine/logic/codes.js"] = (() => {
'use strict';
const {HEX16, PUBLIC_KEY, SENT_TYPE, SIG_KEY, is, isSafeId, parseJson} = __M["js/engine/logic/common.js"];
const {columnOptions} = __M["js/engine/logic/options.js"];
const {docFormat} = __M["js/engine/logic/docformat.js"];
const {TABLE_NOTE_MAX, cleanNote} = __M["js/engine/logic/descriptions.js"];
const {cleanFormula} = __M["js/engine/logic/column-formulas.js"];
const {isPos} = __M["js/engine/logic/layout.js"];

const CODE_PREFIX = 'GRISTSYNC2.';
const SECRET = /^[0-9a-f]{32}$/;
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

const CODE_FORMAT = 2;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const encodeCode = (payload, version) => CODE_PREFIX + toBase64Url(JSON.stringify({ ...payload, f: CODE_FORMAT, ...(version ? { v: version } : {}) }));

function decodeCode(text, kind, version = '') {
  const raw = String(text || '').replace(/\s+/g, '');
  if (raw.startsWith('GRISTSYNC1.')) throw new Error('codeOld');
  if (!raw.startsWith(CODE_PREFIX)) throw new Error('codeFormat');
  const payload = parseJson(fromBase64Url(raw.slice(CODE_PREFIX.length)));
  if (!payload) throw new Error('codeFormat');
  if (Number(payload.f) > CODE_FORMAT) {
    throw Object.assign(new Error('codeNewer'), { vars: { theirs: is(VERSION, payload.v) ? payload.v : '?', mine: version || '?' } });
  }
  if (payload.kind !== kind) throw new Error(kind === 'invitation' ? 'notInvitation' : 'notReply');
  return payload;
}

const codeVersion = payload => (is(VERSION, payload.v) ? payload.v : '');

function validColumns(cols) {
  return Array.isArray(cols) && cols.length > 0 && cols.length <= MAX_COLUMNS && new Set(cols.map(c => c && c.id)).size === cols.length &&
    cols.every(c => c && isSafeId(c.id) && is(SENT_TYPE, c.type) && (c.as === undefined || isSafeId(c.as)));
}

const exportSchema = (columns, withOpts = false) => columns.map(column => schemaColumn(column, withOpts));

const schemaAim = ({ link, visible, list }) => (isSafeId(link) ? { link, ...(isSafeId(visible) ? { visible } : {}), ...(list === true ? { list: true } : {}) } : {});

function schemaNotes({ desc, tdesc, fmt, pos, fx, fd }) {
  return {
    ...(fmt === true ? { fmt } : {}),
    ...(typeof desc === 'string' ? { desc: cleanNote(desc) } : {}),
    ...(typeof tdesc === 'string' ? { tdesc: cleanNote(tdesc, TABLE_NOTE_MAX) } : {}),
    ...(isPos(pos) ? { pos } : {}),
    ...(typeof fx === 'string' ? { fx: cleanFormula(fx) } : {}),
    ...(typeof fd === 'string' && cleanFormula(fd) ? { fd: cleanFormula(fd) } : {}),
  };
}

function schemaColumn(column, withOpts) {
  const { id, type, label, as, opts } = column;
  const head = { id, type, ...(typeof label === 'string' ? { label: cleanLabel(label) } : {}), ...(as ? { as } : {}) };
  if (!withOpts) return head;
  const kept = opts ? columnOptions(type, opts, { extras: true }) : null;
  const docInfo = docFormat(column.doc); // langue et monnaie du document de la SOURCE (voir docformat.js)
  return { ...head, ...schemaAim(column), ...(kept ? { opts: kept } : {}), ...(docInfo ? { doc: docInfo } : {}), ...schemaNotes(column) };
}

const text200 = (from, keys) => Object.fromEntries(keys.map(k => [k, cleanLabel(from[k])]));

const cleanLabel = text => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u206f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

const TEAM_ID = /^[A-Za-z0-9_-]{1,120}$/;
function sourceDoc(from) {
  const team = typeof from.team === 'string' && (from.team === '' || TEAM_ID.test(from.team)) ? { team: from.team } : {};
  const name = cleanLabel(from.docName);
  return { ...team, ...(name ? { docName: name } : {}) };
}

function buildInvitation({ id, exportId, name, origin, secret = '', from = {}, tables, base = '', retour = '', expire = 0, renforce = false, pub = '', version = '' }) {
  return encodeCode({
    kind: 'invitation', id, export: exportId, name, origin, secret, from,
    ...(expire ? { expire } : {}), ...(renforce ? { renforce: true } : {}), ...(pub ? { pub } : {}),
    ...(base ? { mode: 'public', base } : retour ? { mode: 'echange', retour } : {}),
    tables: tables.map(({ table, columns }) => ({ table, columns: exportSchema(columns) })),
  }, version);
}

function validInvitation(inv) {
  return is(HEX16, inv.id) && is(HEX16, inv.export) && typeof inv.name === 'string' && (!inv.secret || is(SECRET, inv.secret))
    && (inv.expire === undefined || Number.isFinite(inv.expire)) && (inv.pub === undefined || is(PUBLIC_KEY, inv.pub))
    && Array.isArray(inv.tables) && inv.tables.length > 0 && inv.tables.every(tb => tb && isSafeId(tb.table) && validColumns(tb.columns))
    && new Set(inv.tables.map(tb => tb.table)).size === inv.tables.length;
}

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

function parseInvitation(text, version = '') {
  const inv = decodeCode(text, 'invitation', version);
  const mode = validInvitation(inv) ? invitationMode(inv) : null;
  if (!mode) throw new Error('codeInvalid');
  if (mode.mode !== 'public' && !inv.pub) throw new Error(is(SIG_KEY, inv.cle) ? 'codeOld' : 'codeInvalid');
  const from = inv.from && typeof inv.from === 'object' ? inv.from : {};
  return {
    id: inv.id, export: inv.export, name: cleanLabel(inv.name), secret: inv.secret || '', origin: String(inv.origin || ''), ...mode,
    expire: inv.expire || 0, renforce: inv.renforce === true, pub: inv.pub || '',
    from: { ...text200(from, ['email', 'docId']), ...sourceDoc(from) }, version: codeVersion(inv),
    tables: inv.tables.map(tb => ({ table: tb.table, columns: exportSchema(tb.columns) })),
  };
}

function buildReply({ id, secret = '', recipient, url, retour = null, pub = '', version = '' }) {
  return encodeCode({ kind: 'reponse', id, secret, recipient, url, pub, ...(retour ? { retour } : {}) }, version);
}

function validRetour(back) {
  const unique = key => new Set(back.map(b => b && b[key])).size === back.length;
  return Array.isArray(back) && back.length > 0 && back.every(b => b && isSafeId(b.table) && isSafeId(b.dest)) && unique('table') && unique('dest');
}

function validReply({ id, secret, recipient, retour, pub }) {
  return is(HEX16, id) && (!secret || is(SECRET, secret)) && Boolean(recipient) && typeof recipient === 'object'
    && (retour === undefined || validRetour(retour)) && is(PUBLIC_KEY, pub);
}

function parseReply(text, sourceOrigin, version = '') {
  const reply = decodeCode(text, 'reponse', version);
  if (reply.pub === undefined) throw new Error('inviteOld');
  const target = parseWebhookUrl(reply.url);
  if (!validReply(reply) || !target?.flat) throw new Error('codeInvalid');
  if (target.origin !== sourceOrigin) throw new Error('otherInstance');
  const out = {
    id: reply.id, secret: reply.secret || '', recipient: text200(reply.recipient, ['email', 'docId', 'team', 'at']), url: target.url, pub: reply.pub,
    version: codeVersion(reply),
  };
  return reply.retour === undefined ? out : { ...out, retour: reply.retour.map(({ table, dest }) => ({ table, dest })) };
}

const parseUrl = (text) => {
  try {
    const url = new URL(String(text || '').trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch (e) {
    return null;
  }
};

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

function parseWebhookUrl(text) {
  const url = parseUrl(text);
  const m = url && url.pathname.match(new RegExp(`^(${TEAM})/api/s/([A-Za-z0-9]+)/tables/([A-Za-z_][A-Za-z0-9_]*)/records$`));
  if (!m) return null;
  const parts = { origin: url.origin, prefix: m[1], key: m[2], table: m[3] };
  return { ...parts, flat: url.search === '?flat=1', url: writeUrl(parts, parts.table) };
}

function loopingTables(tables, recipientDocId, received) {
  if (!recipientDocId) return [];
  return tables.filter(table => received.some(r => r.dest === table && r.fromDocId === recipientDocId));
}

const maskKey = text => String(text || '').replace(/\/(api\/s|forms)\/([A-Za-z0-9]{4})[A-Za-z0-9]*/g, '/$1/$2…');

function docSlug(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 80).replace(/^-+|-+$/g, '');
}

function safeOrigin(origin) {
  let base;
  try {
    base = new URL(String(origin || ''));
  } catch (e) {
    return '';
  }
  const secure = base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname));
  return secure && base.origin === origin ? origin : '';
}

function docUrl(origin, team, docId, name = '') {
  if (!safeOrigin(origin) || !TEAM_ID.test(String(docId || '')) || (team && !TEAM_ID.test(String(team)))) return '';
  const site = /^docs-\d+$/.test(team || '') ? 'docs' : team;
  const where = `${origin}${site ? `/o/${site}` : ''}`;
  return docId.length >= 12 ? `${where}/${docId}/${docSlug(name) || 'document'}` : `${where}/doc/${docId}`;
}

function parsePageAddress(text) {
  let url;
  try {
    url = new URL(String(text ?? '').trim());
  } catch (e) {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const found = addressParts(url.pathname.split('/').filter(Boolean).map(decoded));
  if (!TEAM_ID.test(found.docId) || (found.team && !TEAM_ID.test(found.team))) return null;
  const name = found.slug === 'document' ? '' : cleanLabel(found.slug.replace(/-+/g, ' '));
  return { origin: url.origin, team: found.team, docId: found.docId, name };
}

function decoded(part) {
  try {
    return decodeURIComponent(part);
  } catch (e) {
    return '';
  }
}

function addressParts(parts) {
  const team = parts[0] === 'o' ? parts[1] || '' : '';
  const rest = parts.slice(parts[0] === 'o' ? 2 : 0);
  const plain = rest[0] === 'doc';
  const after = rest.slice(plain ? 2 : 1);
  const page = after[0] === 'p' && /^\d+$/.test(after[1] || '');
  return { team, docId: (plain ? rest[1] : rest[0]) || '', slug: plain || page ? '' : after[0] || '' };
}

const sameId = (a, b) => a === b || (a.length >= 12 && b.length >= 12 && (a.startsWith(b) || b.startsWith(a)));

function docNameFrom(input, here) {
  const text = String(input ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return { kind: 'typed', name: cleanLabel(text) };
  const page = parsePageAddress(text);
  if (!page) return { kind: 'invalid', name: '' };
  if (page.origin !== (here || {}).origin) return { kind: 'otherSite', name: '' };
  if (!sameId(String(here.docId || ''), page.docId)) return { kind: 'otherDoc', name: '' };
  return page.name ? { kind: 'address', name: page.name } : { kind: 'noName', name: '' };
}

function parseDocBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  const m = url.pathname.match(/^(?:\/o\/([^/]+))?\/api\/docs\/([^/]+)\/?$/);
  return { origin: url.origin, team: m ? m[1] || '' : '', docId: m ? m[2] : '' };
}

function safeDocBaseUrl(text) {
  const url = parseUrl(text);
  if (!url || url.search) return '';
  const { team, docId } = parseDocBaseUrl(url.href);
  if (!/^[A-Za-z0-9_-]+$/.test(docId) || (team && !/^[A-Za-z0-9_-]+$/.test(team))) return '';
  return `${url.origin}${team ? `/o/${team}` : ''}/api/docs/${docId}`;
}
return { CODE_FORMAT, decodeCode, validColumns, exportSchema, cleanLabel, buildInvitation, parseInvitation, buildReply, parseReply, parseFormLink, buildWebhookUrl, parseWebhookUrl, loopingTables, maskKey, docSlug, docUrl, parsePageAddress, docNameFrom, parseDocBaseUrl };
})();

// ===== js/engine/logic/diagnostic.js =====
__M["js/engine/logic/diagnostic.js"] = (() => {
'use strict';
const {maskKey} = __M["js/engine/logic/codes.js"];

const short = id => String(id || '').slice(0, 8);
const when = (ms) => {
  const date = new Date(ms || 0);
  return ms && Number.isFinite(date.getTime()) ? date.toISOString().replace(/\.\d+Z$/, 'Z') : '';
};
const clip = text => maskKey(String(text || ''))
  .replace(/https?:\/\/\S+/gi, '[adresse]')
  .replace(/\b(auth|token|key|secret)=\S+/gi, '$1=…')
  .replace(/\bBearer\s+\S+/gi, 'Bearer …')
  .replace(/[A-Za-z0-9_-]{20,}/g, '…')
  .replace(/\s+/g, ' ').slice(0, 160);

function hookFacts(h) {
  const u = h.usage || {};
  const batch = u.lastEventBatch || {};
  return {
    id: short(h.id),
    enabled: Boolean(h.fields && h.fields.enabled),
    status: u.status || '',
    waiting: u.numWaiting || 0,
    success: when(u.lastSuccessTime),
    failure: when(u.lastFailureTime),
    http: u.lastHttpStatus || batch.httpStatus || 0,
    error: clip(u.lastErrorMessage || batch.errorMessage),
    attempts: batch.attempts || 0,
  };
}

function exportFacts(exp, t) {
  const mode = t(`diag.mode.${exp.public ? 'public' : exp.retour ? 'return' : exp.echange ? 'exchange' : 'oneway'}`);
  return {
    id: short(exp.id),
    name: String(exp.name || ''),
    mode: `${mode}${exp.renforce ? t('diag.suffix.renforce') : ''}`,
    tables: (exp.tables || []).map(tb => t(tb.filter ? 'diag.table.filter' : 'diag.table', { table: tb.table, n: String((tb.columns || []).length) })),
    lost: exp.lost || [],
    changed: exp.changed || [],
    invitations: (exp.invitations || []).length,
    late: exp.late || [],
    lists: exp.lists || [],
    recipients: (exp.recipients || []).map(hookFacts),
  };
}

function progressFact(prog, now, t) {
  if (!prog) return '';
  const ago = prog.last ? t('diag.progress.last', { n: String(Math.max(0, Math.round(now - prog.last))) }) : '';
  return t('diag.progress', { export: short(prog.exp), done: String(prog.done), total: String(prog.total), lots: String(prog.lots), lotsTotal: String(prog.lotsTotal) }) + ago;
}

const PASS = ['idle', 'sent', 'blocked', 'busy', 'nosync'];
function catchFact({ at, why, running }, t) {
  if (!at) return t(running ? 'diag.catch.first' : 'diag.catch.never');
  return `${t('diag.catch.last', { when: when(at) })}${why ? ` (${PASS.includes(why) ? t(`diag.pass.${why}`) : why})` : ''}${running ? t('diag.catch.running') : ''}`;
}

const JOURNAL_MODES = { public: 'public', echange: 'exchange' };

const arrivalFact = (stats, t) => {
  if (!stats) return '';
  const count = { n: String(stats.n), raw: String(stats.raw), when: stats.last ? when(stats.last * 1000) : '' };
  return t(stats.last ? 'diag.arrival' : 'diag.arrival.nodate', count);
};
const journalMode = (note, t) => `${t(`diag.mode.${JOURNAL_MODES[note.mode] || 'reply'}`)}${note.retour ? t('diag.suffix.return') : ''}${note.renforce ? t('diag.suffix.renforce') : ''}`;
const reserveFact = (note, t) => t(note.reserve ? (note.reserved ? 'diag.reserve.set' : 'diag.reserve.waiting') : 'diag.no');
const perTable = (byTable, say) => Object.entries(byTable || {}).map(([table, value]) => say(table, value));
const gapFacts = (results, t) => results.flatMap(r => perTable(r && r.tally, (table, g) => t('diag.gap', { table, got: String(g.got), expected: String(g.expected) })));
const suspectFact = (suspect, t) => (suspect ? t(suspect.flood ? 'diag.suspect.flood' : 'diag.suspect', { n: String(suspect.n || 0), when: when((suspect.at || 0) * 1000) }) : '');
const errorFacts = (results, journal) => results.filter(r => r && r.error).map(r => `${r.table || journal}: ${clip(r.text || r.error)}`);

function journalFacts({ journal, note, signed, results = [], offers = 0, stats = null, t }) {
  return {
    arrival: arrivalFact(stats, t),
    journal,
    export: short(note.export),
    mode: journalMode(note, t),
    tables: (note.tables || []).map(tb => `${tb.table} → ${tb.dest}`),
    refused: (note.refused || []).length,
    offers,
    signed: Boolean(signed),
    sealed: Boolean(note.sceau),
    reserve: reserveFact(note, t),
    ended: note.ended ? when(note.ended * 1000) : '',
    missing: perTable(note.missing, (table, n) => `${table}: ${n}`),
    announced: perTable(note.tally, (table, a) => `${table}: ${a.n}`),
    gap: gapFacts(results, t),
    big: perTable(note.big, (table, keys) => `${table}: ${(keys || []).length}`),
    suspect: suspectFact(note.suspect, t),
    errors: errorFacts(results, journal),
  };
}

const line = (t, label, value) => (value === '' || value === undefined || (Array.isArray(value) && !value.length) ? null
  : t('diag.line', { label: t(`diag.l.${label}`), value: Array.isArray(value) ? value.join(', ') : value }));

function recipientLine(t, r) {
  const parts = [t(r.enabled ? 'diag.rcpt.on' : 'diag.rcpt.paused'), r.status, t('diag.rcpt.queue', { n: String(r.waiting) }),
    r.success && t('diag.rcpt.success', { when: r.success }), r.failure && t('diag.rcpt.failure', { when: r.failure }), r.http && `HTTP ${r.http}`,
    r.attempts && t('diag.rcpt.attempts', { n: String(r.attempts) }), r.error && t('diag.rcpt.error', { error: r.error })];
  return t('diag.line', { label: `${t('diag.rcpt')} ${r.id}`, value: parts.filter(Boolean).join(', ') });
}

function exportLines(e, t) {
  return [
    t('diag.export', { id: e.id, name: e.name, mode: e.mode }),
    line(t, 'tables', e.tables), line(t, 'lost', e.lost), line(t, 'changed', e.changed),
    line(t, 'invitations', e.invitations ? String(e.invitations) : ''), line(t, 'late', e.late), line(t, 'lists', e.lists),
    ...e.recipients.map(r => recipientLine(t, r)),
    e.recipients.length ? null : `  ${t('diag.rcpt.none')}`,
  ];
}

function journalLines(j, t) {
  return [
    t('diag.journal', { journal: j.journal, export: j.export, mode: j.mode }),
    line(t, 'tables', j.tables), line(t, 'refused', j.refused ? String(j.refused) : ''), line(t, 'offers', j.offers ? String(j.offers) : ''),
    t('diag.journal.flags', { signed: t(j.signed ? 'diag.yes' : 'diag.no'), sealed: t(j.sealed ? 'diag.yes' : 'diag.no'), reserve: j.reserve }),
    line(t, 'ended', j.ended), line(t, 'missing', j.missing), line(t, 'announced', j.announced), line(t, 'gap', j.gap), line(t, 'big', j.big),
    line(t, 'suspect', j.suspect), line(t, 'journal', j.arrival), line(t, 'errors', j.errors),
  ];
}

const headerLines = ({ version, served, origin, access, at, agent }, t) => [
  t('diag.title', { version, served }),
  t('diag.date', { value: when(at) }),
  t('diag.instance', { value: origin || t('diag.unknown') }),
  t('diag.access', { value: t(`diag.access.${access}`) }),
  t('diag.browser', { value: agent }),
];

const sendLines = (source, t) => {
  if (!source) return [t('diag.send.none')];
  const kinds = Object.entries(source.kinds || {}).map(([kind, n]) => `${kind} ${n}`).join(', ');
  return [
    source.ownerOnly ? t('diag.send.ownerOnly') : null,
    source.unsafe ? t('diag.send.unsafe', { n: String(source.unsafe) }) : null,
    source.charge ? t('diag.send.charge', { value: source.charge }) : null,
    source.progress ? t('diag.send.progress', { value: source.progress }) : null,
    source.catchUp ? t('diag.send.catchUp', { value: source.catchUp }) : null,
    t('diag.send.kinds', { value: kinds || t('diag.none') }),
    ...(source.exports.length ? source.exports.flatMap(e => exportLines(e, t)) : [t('diag.send.noExport')]),
  ];
};

const receiveLines = (target, t) => {
  if (!target || !target.journals.length) return [t('diag.recv.none')];
  return [
    target.compare === false ? t('diag.recv.compare') : null,
    target.visible === undefined ? null : t('diag.recv.visible', { value: t(target.visible ? 'diag.yes' : 'diag.recv.hidden') }),
    ...target.journals.flatMap(j => journalLines(j, t)),
  ];
};

const errorLines = (errors, t) => (errors.length ? errors.map(e => `${when(e.at)} ${clip(e.text)}`) : [t('diag.errors.none')]);

function diagnosticText({ version, served, origin, access, at, agent, source, target, errors = [], t }) {
  return [
    ...headerLines({ version, served, origin, access, at, agent }, t),
    '',
    t('diag.send'), ...sendLines(source, t),
    '',
    t('diag.receive'), ...receiveLines(target, t),
    '',
    t('diag.errors'), ...errorLines(errors, t),
  ].filter(l => l !== null).join('\n');
}
return { hookFacts, exportFacts, progressFact, catchFact, journalFacts, diagnosticText };
})();

// ===== js/engine/logic/journal.js =====
__M["js/engine/logic/journal.js"] = (() => {
'use strict';
const {APPLIED_COL, BEFORE_COL, BUCKETS, DATA_COL, DELETE_COL, EXPORT_COL, KEY_COL, KIND, LIST_COL, LIST_PREFIX, LOT_COL, ORDER_COL, RECEIVED_COL, RESEND_COL, SCHEMA_COL, STATE_COL, TABLE_COL, TYPE_COL, chunk, groupBy, isBlank, isSafeId, isTrue, isUserTable, parseJson} = __M["js/engine/logic/common.js"];
const {exportSchema, validColumns} = __M["js/engine/logic/codes.js"];

const MAX_LINES = 100000; // lignes par lot, au plus (un envoi fait au plus 1 Mo, un instantané public 2 Mo)
const MAX_BIG = 1000; // clés de lignes trop grosses retenues par table
const MAX_REST = 1e9; // lignes annoncées à venir, au plus (un nombre absurde n'est pas montré tel quel)
const MAX_TABLES = 200; // tables suivies dans la note d'un journal

const isRaw = row => !isBlank(row[TYPE_COL]);

const awaitingPartner = note => note.mode === 'echange' && Boolean(note.retour) && !(note.from || {}).docId;

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

const validLine = l => Array.isArray(l) && isKey(l[0]) && (l[1] === null || l[1] === undefined || typeof l[1] === 'number')
  && l[3] !== null && typeof l[3] === 'object' && !Array.isArray(l[3]);
function parseLot(text) {
  const lot = parseJson(text);
  if (!lot || !Array.isArray(lot.lignes) || lot.lignes.length > MAX_LINES) return null;
  const lines = lot.lignes.filter(validLine).map(([key, order, deleted, data]) => ({ key: String(key), order: order ?? null, deleted: isTrue(deleted), data }));
  const big = keyStrings(lot.tropGros).slice(0, MAX_BIG);
  const rest = Number.isInteger(lot.restant) && lot.restant >= 0 ? Math.min(lot.restant, MAX_REST) : null;
  const announced = lot.bilan;
  const tally = announced && Number.isInteger(announced.n) && announced.n >= 0 && Number.isFinite(announced.t) ? { n: announced.n, t: announced.t } : null;
  return { lines, total: Number(lot.total) || lines.length, big, ...(rest === null ? {} : { rest }), ...(tally ? { tally } : {}), ...(lot.trop === true ? { tooBig: true } : {}) };
}

const FUTURE_S = 600;
const listTime = list => Math.max(list.buckets ? list.buckets.t : 0, list.part ? list.part.t : 0);

function readRaw(row, exportId, limit) {
  const table = row[TABLE_COL];
  if (exportId && row[EXPORT_COL] !== exportId) return null;
  if (row[TYPE_COL] === KIND.end && exportId) return { end: true };
  if (!isSafeId(table) || !readableColumns(row[SCHEMA_COL])) return null;
  if (row[TYPE_COL] === KIND.keys) return readKeys(table, row[LIST_COL], limit);
  const lot = row[TYPE_COL] === KIND.lot ? parseLot(row[LOT_COL]) : null;
  return lot ? { table, lot } : null;
}

function readableColumns(value) {
  if (isBlank(value)) return true;
  const cols = parseJson(value);
  return Array.isArray(cols) && (!cols.length || validColumns(cols));
}

function readKeys(table, value, limit) {
  const text = String(value || '');
  const list = text ? parseList(text) : null;
  return !text || (list && !(listTime(list) > limit)) ? { table, text } : null;
}

function unpackedRows(row, { table, text }, lines, known) {
  const base = { [TABLE_COL]: table, [RECEIVED_COL]: row[RECEIVED_COL] ?? null };
  if (!lines) return text || row[SCHEMA_COL] ? [{ ...base, [LIST_COL]: text, [SCHEMA_COL]: row[SCHEMA_COL] || '' }] : [];
  if (!lines.length) return !isBlank(row[SCHEMA_COL]) && row[SCHEMA_COL] !== known ? [{ ...base, [LIST_COL]: '', [SCHEMA_COL]: row[SCHEMA_COL] }] : [];
  return lines.map((l, i) => ({
    ...base, [KEY_COL]: l.key, [ORDER_COL]: l.order, [DELETE_COL]: l.deleted, [DATA_COL]: JSON.stringify(l.data),
    ...(i === 0 ? { [SCHEMA_COL]: row[SCHEMA_COL] || '' } : {}),
  }));
}

const SCHEMA_TABLES = ['_grist_Tables', '_grist_Tables_column'];
const touchedTables = (changed, watched) => (changed === null ? null
  : [...changed].filter(table => watched.has(table) || SCHEMA_TABLES.includes(table)));

function planUnpack(journalRows, journalTable, { exportId = null, max = Infinity, now = Infinity, bad = new Set(), bare = new Set() } = {}) {
  const all = journalRows.filter(r => isRaw(r) && !(exportId && r[TYPE_COL] === KIND.part && r[EXPORT_COL] === exportId)).sort((a, b) => a.id - b.id);
  const raw = all.slice(0, max);
  const added = [];
  const gaps = { missing: new Map(), big: new Map(), arrived: new Map(), resent: new Set(), tally: new Map() };
  let rejected = 0;
  let ended;
  const limit = now + FUTURE_S;
  const schemas = new Map(journalRows.filter(r => !isRaw(r) && !isBlank(r[SCHEMA_COL])).sort((a, b) => a.id - b.id).map(r => [r[TABLE_COL], r[SCHEMA_COL]]));
  for (const got of raw) {
    const row = bare.has(got.id) ? { ...got, [SCHEMA_COL]: '' } : got;
    const read = bad.has(row.id) ? null : readRaw(row, exportId, limit);
    if (!read) {
      rejected++;
      continue;
    }
    ended = read.end ? { at: typeof row[RECEIVED_COL] === 'number' ? row[RECEIVED_COL] : null } : null;
    if (read.end) continue;
    const lines = read.lot ? read.lot.lines.filter(l => !(l.order > limit)) : null;
    rejected += read.lot ? read.lot.lines.length - lines.length : 0;
    const rows = unpackedRows(row, read, lines, schemas.get(read.table));
    for (const r of rows) if (!isBlank(r[SCHEMA_COL])) schemas.set(read.table, r[SCHEMA_COL]);
    added.push(...rows);
    if (read.lot) noteGaps(gaps, read.table, read.lot, !isBlank(row[RESEND_COL]));
  }
  const removed = raw.map(r => r.id);
  const plain = map => Object.fromEntries(map);
  return {
    added, removed, actions: unpackActions(journalTable, added, removed),
    missing: plain(gaps.missing), big: plain(gaps.big), arrived: plain(gaps.arrived), resent: [...gaps.resent], tally: plain(gaps.tally), rejected, left: all.length - raw.length,
    ...(ended === undefined ? {} : { ended }),
  };
}

function unpackActions(journalTable, added, removed) {
  const cols = [...new Set(added.flatMap(Object.keys))];
  const empty = c => (c === DELETE_COL ? false : c === ORDER_COL || c === RECEIVED_COL ? null : '');
  const actions = chunk(added).map(part => ['BulkAddRecord', journalTable, part.map(() => null),
    Object.fromEntries(cols.map(c => [c, part.map(r => r[c] ?? empty(c))]))]);
  for (const part of chunk(removed)) actions.push(['BulkRemoveRecord', journalTable, part]);
  return actions;
}

function noteGaps(gaps, table, lot, resent) {
  const add = (map, items) => map.set(table, [...(map.get(table) || []), ...items]);
  if (lot.big.length) add(gaps.big, lot.big);
  add(gaps.arrived, lot.lines.map(l => l.key));
  const was = gaps.tally.get(table);
  if (lot.tally && (!was || lot.tally.t >= was.t)) gaps.tally.set(table, lot.tally);
  if (resent) {
    gaps.resent.add(table);
    gaps.missing.set(table, lot.rest ?? 0);
  } else if (lot.total > lot.lines.length) gaps.missing.set(table, (gaps.missing.get(table) || 0) + lot.total - lot.lines.length);
}

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

function compareOrder(a, b) {
  if (isBlank(a) || isBlank(b)) return (isBlank(a) ? 0 : 1) - (isBlank(b) ? 0 : 1);
  if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function compareVersion(a, b) {
  return compareOrder(a.order, b.order) || Math.sign((a.id || 0) - (b.id || 0));
}

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

const currentRows = journalRows => [...latestByKey(journalRows).values()].filter(v => !isTrue(v.row[DELETE_COL])).map(v => v.row);

const rowsByTable = journalRows => groupBy(journalRows.filter(r => !isRaw(r) && !isBlank(r[TABLE_COL])), r => r[TABLE_COL]);

function expandRows(journalRows) {
  return journalRows.map((row) => {
    const payload = isBlank(row[DATA_COL]) ? null : parseJson(row[DATA_COL]);
    if (!payload || typeof payload !== 'object') return row;
    const values = Object.fromEntries(Object.entries(payload).filter(([k]) => isSafeId(k))
      .map(([k, v]) => [k, Array.isArray(v) ? ['L', ...v] : v]));
    return { ...values, ...row };
  });
}

const lastWhere = (rows, test) => rows.reduce((latest, row) => (test(row) && (!latest || row.id > latest.id) ? row : latest), null);

const latestSchemaRow = rows => lastWhere(rows, r => !isBlank(r[SCHEMA_COL]));
const hasSchema = rows => Boolean(latestSchemaRow(rows) && validColumns(parseJson(latestSchemaRow(rows)[SCHEMA_COL])));

function destProblem(plans, received) {
  const seen = new Set();
  for (const { dest } of plans) {
    if (!isUserTable(dest)) return { code: 'destReserved', vars: { dest } };
    if (seen.has(dest)) return { code: 'destTwice', vars: { dest } };
    seen.add(dest);
    const feed = received.find(r => r.dest === dest);
    if (feed) return { code: 'destTaken', vars: { dest, table: feed.table } };
  }
  return null;
}

const destColumns = columns => columns.filter(c => ![KEY_COL, ORDER_COL, DELETE_COL].includes(c.id));

function sentColumns(rows, fallback = []) {
  const cols = parseJson((latestSchemaRow(rows) || {})[SCHEMA_COL]);
  return validColumns(cols) ? exportSchema(cols, true) : fallback;
}

const latestList = rows => lastWhere(rows, r => String(r[LIST_COL] || '').startsWith(LIST_PREFIX));

const pendingLists = rows => rows.filter(r => isBlank(r[KEY_COL]) && !isTrue(r[APPLIED_COL]))
  .map(row => ({ row, list: parseList(row[LIST_COL]) })).filter(l => l.list).sort((a, b) => a.row.id - b.row.id);

const lastMark = pending => (pending.filter(l => l.list.part).pop() || { list: { part: {} } }).list.part.mark;

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

const STATES = ['ajout', 'modif', 'suppression'];
const REFUSED = 'refus';
const SHOWN = [...STATES, REFUSED];
const MAX_TIME_S = 8.64e12;
const validTime = at => Number.isFinite(at) && Math.abs(at) < MAX_TIME_S;

function recentChanges(journalRows, labelCol, since, max, { copyCols = [], numbers = new Map() } = {}) {
  return [...latestByKey(journalRows).values()]
    .map(v => ({ at: v.row[RECEIVED_COL] ?? v.order, state: v.row[STATE_COL], row: v.row }))
    .filter(c => SHOWN.includes(c.state) && validTime(c.at) && c.at > since)
    .sort((a, b) => b.at - a.at).slice(0, max)
    .map((c) => {
      const was = parseJson(c.row[BEFORE_COL]) || {};
      const gone = c.state === 'suppression';
      const n = gone ? (Number.isInteger(was.n) && was.n > 0 ? was.n : null) : numbers.get(c.row[KEY_COL]) || null;
      return { at: c.at, key: c.row[KEY_COL], label: labelCol ? String(c.row[labelCol] ?? '') : '', state: c.state, n, detail: changeDetail(c.state, c.row, copyCols, was) };
    });
}

function changeDetail(state, row, copyCols, was) {
  const values = cols => cols.map(([from]) => row[from] ?? null);
  if (state === REFUSED) return was.k === 'suppression' ? null : changeDetail(was.k === 'ajout' ? 'ajout' : 'modif', row, copyCols, was);
  if (state !== 'modif') return copyCols.length ? { cols: copyCols, before: state === 'ajout' ? null : values(copyCols), after: state === 'ajout' ? values(copyCols) : null } : null;
  const v = was.v && typeof was.v === 'object' && !Array.isArray(was.v) ? was.v : {};
  const cols = copyCols.filter(([from]) => Object.hasOwn(v, from));
  return cols.length ? { cols, before: cols.map(([from]) => v[from]), after: values(cols) } : null;
}

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

function pulledList(table, lot, rows, schema) {
  const sortedKeys = keys => `${LIST_PREFIX}${keys.filter(Boolean).sort().join(' ')}`;
  const ids = sortedKeys(lot.lines.map(l => l.key));
  const list = latestList(rows);
  const same = list && sortedKeys(String(list[LIST_COL]).slice(LIST_PREFIX.length).split(' ')) === ids && (latestSchemaRow(rows) || {})[SCHEMA_COL] === schema;
  return same ? null : { [TABLE_COL]: table, [LIST_COL]: ids, [SCHEMA_COL]: schema };
}
return { isRaw, awaitingPartner, parseList, parseLot, touchedTables, planUnpack, unpackActions, nextGaps, compareOrder, compareVersion, latestByKey, currentRows, rowsByTable, expandRows, hasSchema, destProblem, destColumns, sentColumns, pendingLists, lastMark, completeLists, planPurge, STATES, REFUSED, recentChanges, planPull };
})();

// ===== js/engine/logic/received.js =====
__M["js/engine/logic/received.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {KEY_COL, LIST_COL, SIG_KEY, columnNote, isUserTable, noteAction} = __M["js/engine/logic/common.js"];
const {destColumns} = __M["js/engine/logic/journal.js"];
const {columnOptions, fillOptions, isChoice, ownsColumn, receivedChoices, replaceOptions, ruleStyle, ruleStyles, sentRules, withRuleStyles} = __M["js/engine/logic/options.js"];
const {parseRule, printRule} = __M["js/engine/logic/rules.js"];
const {destContext} = __M["js/engine/logic/schema.js"];

const listColumn = (schema, tableId) => (schema.columns(tableId) || []).find(c => c.colId === LIST_COL);
const journalNote = (schema, tableId) => columnNote(listColumn(schema, tableId));
const journalNoteAction = (schema, tableId, note) => noteAction(listColumn(schema, tableId), note);

const optionsNote = ({ archive, verrou, ask }) => ({ ...(archive ? { archive: true } : {}), ...(verrou ? { verrou: true } : {}), ...(ask ? { ask: true } : {}) });

function receivedJournals(schema) {
  return schema.tableIds.filter(id => id.startsWith(__C.JOURNAL_PREFIX)).map((journal) => {
    const note = journalNote(schema, journal);
    return note && note.export && Array.isArray(note.tables) ? { journal, note: { refused: [], missing: {}, ...note } } : null;
  }).filter(Boolean);
}

const receivedDests = schema => receivedJournals(schema)
  .flatMap(({ note }) => note.tables.map(tb => ({ dest: tb.dest, table: tb.table, fromDocId: (note.from || {}).docId || '' })));

function addDestColumnsActions(schema, dest, columns, map = {}) {
  const have = new Set((schema.columns(dest) || []).map(c => c.colId));
  return [...destColumns(columns), { id: KEY_COL, type: 'Text', label: KEY_COL }]
    .map(({ id, type, label, opts }) => ({ id: map[id] || id, type, label: map[id] ? map[id] : label, key: id === KEY_COL, opts: columnOptions(type, opts, { extras: true }) }))
    .filter(c => !have.has(c.id))
    .map(({ id, key, opts, ...info }) => {
      const { rules, ...format } = opts || {}; // les règles conditionnelles se posent après (voir planRules)
      return [key ? 'AddColumn' : 'AddVisibleColumn', dest, id, { ...info, isFormula: false, ...(Object.keys(format).length ? { widgetOptions: JSON.stringify(format) } : {}) }];
    });
}

function missingColumns(schema, dest, columns, map = {}) {
  const have = new Set((schema.columns(dest) || []).map(c => c.colId));
  return destColumns(columns).map(c => c.id).filter(id => !have.has(map[id] || id));
}

function optionActions(schema, entry, columns) {
  const { here } = destContext(schema, entry);
  return destColumns(columns).filter(c => c.opts).flatMap((c) => {
    const column = here.get((entry.map || {})[c.id] || c.id);
    if (!column || !ownsColumn(entry.own, c.id, column)) return [];
    const text = fillOptions(column.type, column.widgetOptions, c.opts);
    return text ? [['UpdateRecord', '_grist_Tables_column', column.id, { widgetOptions: text }]] : [];
  });
}

function restyleOptionActions(schema, entry, columns) {
  const { here } = destContext(schema, entry);
  return destColumns(columns).flatMap((c) => {
    const column = here.get((entry.map || {})[c.id] || c.id);
    const text = column ? replaceOptions(column.type, column.widgetOptions, c.opts || {}) : null;
    return text ? [['UpdateRecord', '_grist_Tables_column', column.id, { widgetOptions: text }]] : [];
  });
}

function planRules(schema, entry, columns, { replace = false } = {}) {
  const cols = schema.columns(entry.dest) || [];
  const here = new Map(cols.map(c => [c.colId, c]));
  const map = entry.map || {};
  const context = {
    here, map, replace, byRow: new Map(cols.map(c => [c.id, c])),
    rename: id => (here.has(map[id] || id) ? map[id] || id : null),
    decided: new Set(entry.styled || []), own: new Set(Array.isArray(entry.own) ? entry.own : []),
  };
  const todo = [];
  const settled = [];
  for (const sent of destColumns(columns)) {
    const planned = planColumnRules(sent, context);
    if (!planned) continue;
    if (planned.settled) settled.push(sent.id);
    else todo.push(planned.todo);
  }
  return { todo, settled };
}

function planColumnRules(c, { here, map, replace, byRow, rename, decided, own }) {
  const rules = sentRules(c.opts).map(r => ({ formula: printRule(parseRule(r.when), rename), style: ruleStyle(r) })).filter(r => r.formula);
  const column = here.get(map[c.id] || c.id);
  if (!rules.length || !column || (!replace && (decided.has(c.id) || !own.has(c.id)))) return null;
  const old = (Array.isArray(column.rules) ? column.rules.slice(1) : []).map(ref => (byRow.get(ref) || {}).colId).filter(Boolean);
  if (!replace && (old.length || ruleStyles(column.widgetOptions).length)) return { settled: true };
  return { todo: { id: c.id, column, rules, old: replace ? old : [] } };
}

function startRules(dest, todo) {
  const actions = [];
  const owners = [];
  todo.forEach((item, i) => {
    for (const helper of item.old) { actions.push(['RemoveColumn', dest, helper]); owners.push(-1); }
    for (let n = 0; n < item.rules.length; n++) { actions.push(['AddEmptyRule', dest, 0, item.column.id]); owners.push(i); }
  });
  return { actions, owners };
}

function finishRules(dest, todo, owners, retValues) {
  const made = todo.map(() => []);
  owners.forEach((owner, k) => { if (owner >= 0 && retValues[k] && retValues[k].colId) made[owner].push(retValues[k].colId); });
  return todo.flatMap((item, i) => (made[i].length !== item.rules.length ? [] : [
    ...made[i].map((helper, n) => ['ModifyColumn', dest, helper, { formula: item.rules[n].formula }]),
    ['UpdateRecord', '_grist_Tables_column', item.column.id, { widgetOptions: withRuleStyles(item.column.widgetOptions, item.rules.map(r => r.style)) }],
  ]));
}

const madeHelpers = (owners, retValues) => owners.map((owner, k) => (owner >= 0 && retValues[k] ? retValues[k].colId : '')).filter(Boolean);

function valueChoiceActions(schema, entry, columns, rows) {
  const { here } = destContext(schema, entry);
  const wanted = destColumns(columns).filter(c => isChoice(c.type) && !(c.opts && c.opts.choices)).map(c => ({ c, column: here.get((entry.map || {})[c.id] || c.id) }))
    .filter(({ c, column }) => column && isChoice(column.type) && ownsColumn(entry.own, c.id, column));
  const received = wanted.length ? rows() : [];
  return wanted.flatMap(({ c, column }) => {
    const text = receivedChoices(column.widgetOptions, received.map(row => row[c.id]));
    return text ? [['UpdateRecord', '_grist_Tables_column', column.id, { widgetOptions: text }]] : [];
  });
}

const keySlot = (journal, note) => (note.retour ? journal : note.export);
const keyColumn = (schema, table) => (schema.columns(table) || []).find(c => c.colId === KEY_COL);
function keysOf(column) {
  const { signature } = columnNote(column) || {};
  return signature && typeof signature === 'object' ? signature : {};
}
const signedTables = schema => schema.tableIds.filter(isUserTable)
  .filter(table => Object.keys(keysOf(keyColumn(schema, table))).length > 0).sort();
const destNow = (schema, tb) => {
  const ref = (tb.refs || {}).table;
  return (ref && schema.tableIdOf && schema.tableIdOf(ref)) || tb.dest;
};
function receivedKey(schema, journal, note) {
  const slot = keySlot(journal, note);
  return (note.tables || []).map(tb => keysOf(keyColumn(schema, destNow(schema, tb)))[slot]).find(k => SIG_KEY.test(k || '')) || '';
}
function storeKeyActions(schema, tables, slot, key) {
  if (!SIG_KEY.test(key || '')) return [];
  return tables.map(table => keyColumn(schema, table)).filter(c => c && keysOf(c)[slot] !== key)
    .map(c => noteAction(c, { signature: { ...keysOf(c), [slot]: key } }));
}
function dropKeyActions(schema, tables, slot) {
  return tables.map(table => keyColumn(schema, table)).filter(c => c && slot in keysOf(c))
    .map((c) => {
      const { [slot]: gone, ...rest } = keysOf(c);
      return noteAction(c, Object.keys(rest).length ? { signature: rest } : null);
    });
}
return { journalNote, journalNoteAction, optionsNote, receivedJournals, receivedDests, addDestColumnsActions, missingColumns, optionActions, restyleOptionActions, planRules, startRules, finishRules, madeHelpers, valueChoiceActions, keySlot, signedTables, receivedKey, storeKeyActions, dropKeyActions };
})();

// ===== js/engine/logic/resend.js =====
__M["js/engine/logic/resend.js"] = (() => {
'use strict';
const {EXPORT_COL, KIND, LIST_COL, MISSING_COL, ORDER_COL, RESEND_ALL, RESEND_COL, TABLE_COL, TRACK_COL, TYPE_COL, parseJson} = __M["js/engine/logic/common.js"];
const {swapExports} = __M["js/engine/logic/exports.js"];

const RESEND_CHUNK = 200; // lignes par tranche de renvoi

const resendValue = (mark, ids, rest = null) => (rest === null ? `${mark}:${ids.join(',')}` : `${mark}:${rest}:${ids.join(',')}`);

const announceRest = (left, ratio = 1) => (left > 0 ? Math.max(1, Math.ceil(left * Math.min(1, Math.max(0, ratio)))) : 0);

const majle = r => r[ORDER_COL] || 0;
const rowsSince = (rows, since) => rows.filter(r => since <= RESEND_ALL || majle(r) >= since)
  .sort((a, b) => majle(a) - majle(b) || a.id - b.id);
const chunkMark = (part, since) => Math.max(since, majle(part[0]));

const listRequest = (mark, n, after) => JSON.stringify({ marque: mark, n, apres: after });

const trackState = row => (row && row[TYPE_COL] === KIND.track ? parseJson(row[TRACK_COL], null) || {} : {});

const listOverdue = (row) => {
  const { trop } = trackState(row);
  return Boolean(trop) && trop !== row[RESEND_COL];
};

const listDue = r => (r[TYPE_COL] === KIND.keys && Boolean(r[RESEND_COL])) || listOverdue(r);

const lotLate = r => r[TYPE_COL] === KIND.lot && r[MISSING_COL] > 0;

function dueRows(rows) {
  const late = rows.filter(lotLate);
  const same = (a, b) => a[EXPORT_COL] === b[EXPORT_COL] && a[TABLE_COL] === b[TABLE_COL];
  const swaps = swapExports(rows);
  return { late, lists: rows.filter(r => listDue(r) && !late.some(l => same(l, r)) && !swaps.has(r[EXPORT_COL])) };
}

const RESEND_BUDGET = 20000000;
const BUDGET_WINDOW = 600;
const LEASE_S = 120;

function parseCharge(text) {
  const charge = parseJson(text, null) || {};
  const pairs = Array.isArray(charge.envoye) ? charge.envoye.filter(e => Array.isArray(e) && e.length === 2) : [];
  return {
    par: typeof charge.par === 'string' ? charge.par : '', le: Number(charge.le) || 0, reprise: Number(charge.reprise) || 0,
    envoye: pairs.map(([at, n]) => [Number(at) || 0, Number(n) || 0]), prog: parseProg(charge.prog),
  };
}

function parseProg(p) {
  if (!p || typeof p !== 'object' || typeof p.exp !== 'string' || !p.exp) return null;
  const num = x => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
  return {
    exp: p.exp, table: typeof p.table === 'string' ? p.table : '', done: num(p.done), total: num(p.total), lots: num(p.lots),
    lotsTotal: num(p.lotsTotal), bytes: num(p.bytes), at: num(p.at), last: num(p.last),
  };
}

const startProg = (exp, total, lotsTotal, now) => ({ exp, table: '', done: 0, total, lots: 0, lotsTotal, bytes: 0, at: Math.floor(now), last: Math.floor(now) });
const addProg = (prog, { rows, bytes, now }) => ({ ...prog, done: prog.done + rows, lots: prog.lots + 1, bytes: prog.bytes + bytes, last: Math.floor(now) });
const percent = prog => (prog.total > 0 ? Math.min(100, Math.floor((prog.done * 100) / prog.total)) : 0);

const windowSpent = (charge, now) => charge.envoye.filter(([at]) => at > now - BUDGET_WINDOW).reduce((sum, [, n]) => sum + n, 0);

function etaSeconds(prog, charge, now) {
  if (!prog || prog.done < 1 || prog.total <= prog.done) return null;
  const elapsed = now - prog.at;
  if (elapsed < 15) return null;
  const left = prog.total - prog.done;
  const byRate = left / (prog.done / elapsed);
  const room = Math.max(0, RESEND_BUDGET - windowSpent(charge, now));
  const byBudget = Math.max(0, ((left * (prog.bytes / prog.done) - room) / RESEND_BUDGET) * BUDGET_WINDOW);
  return Math.round(Math.max(byRate, byBudget));
}

const lotCut = sent => Boolean(sent) && sent.total > sent.lines.length + sent.big.length;

function nextChunkSize(size, asked, fit) {
  if (fit >= asked) return size;
  return Math.max(1, Math.min(size, Math.floor(fit * 0.9) || 1));
}

const chunkCount = (rows, size = RESEND_CHUNK) => (rows > 0 ? Math.ceil(rows / size) : 1);

function eligibleRows(syncRows, exportId, table) {
  const row = syncRows.find(r => r[EXPORT_COL] === exportId && r[TABLE_COL] === table && r[TYPE_COL] === KIND.track);
  const m = row ? /^(\d+):[0-9a-f]+$/.exec(String(row[LIST_COL] || '')) : null;
  return m ? Number(m[1]) : null;
}

function trackedCounts(syncRows) {
  const counts = {};
  for (const row of syncRows) {
    const m = row[TYPE_COL] === KIND.track ? /^(\d+):[0-9a-f]+$/.exec(String(row[LIST_COL] || '')) : null;
    if (m) (counts[row[EXPORT_COL]] ||= {})[row[TABLE_COL]] = Number(m[1]);
  }
  return counts;
}

function chargeBusy(charge, page, now) {
  const browser = id => id.split('.')[0];
  return Boolean(charge.par) && browser(charge.par) !== browser(page) && now - charge.le < LEASE_S;
}

function addSpent(charge, now, bytes) {
  const minute = Math.floor(now / 60) * 60;
  const envoye = charge.envoye.filter(([at]) => at > now - BUDGET_WINDOW).map(([at, n]) => [at, n]);
  const last = envoye[envoye.length - 1];
  if (last && last[0] === minute) last[1] += bytes;
  else envoye.push([minute, bytes]);
  return { ...charge, envoye };
}

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
return { RESEND_CHUNK, resendValue, announceRest, rowsSince, chunkMark, listRequest, trackState, listOverdue, listDue, lotLate, dueRows, RESEND_BUDGET, BUDGET_WINDOW, LEASE_S, parseCharge, parseProg, startProg, addProg, percent, windowSpent, etaSeconds, lotCut, nextChunkSize, chunkCount, eligibleRows, trackedCounts, chargeBusy, addSpent, budgetWait };
})();

// ===== js/engine/port.js =====
__M["js/engine/port.js"] = (() => {
'use strict';

const PORT_SHAPE = {
  data: ['fetchRows', 'apply', 'readSchema', 'selectRows', 'querySql', 'journalStats', 'docIdentity', 'isOwner', 'docChanges'],
  files: ['downloadAttachment', 'uploadAttachment'],
  hooks: ['listWebhooks', 'createWebhook', 'webhookConditions', 'setWebhookEnabled', 'renameWebhook', 'deleteWebhook',
    'deleteWebhookWithNotice', 'clearWebhookQueue', 'postToHook', 'postRows'],
  publicDoc: ['publicRecords', 'publicAccess', 'shareInfo'],
  environment: ['withLock', 'text'],
  page: ['visible', 'busy', 'onShow', 'onLeave'],
  prefs: ['read', 'write'],
};

let port = null;

function setPort(next) {
  const missing = [];
  for (const name of [...PORT_SHAPE.data, ...PORT_SHAPE.files, ...PORT_SHAPE.hooks, ...PORT_SHAPE.publicDoc, ...PORT_SHAPE.environment]) {
    if (!next || typeof next[name] !== 'function') missing.push(name);
  }
  for (const name of PORT_SHAPE.page) if (!next || !next.page || typeof next.page[name] !== 'function') missing.push(`page.${name}`);
  for (const name of PORT_SHAPE.prefs) if (!next || !next.prefs || typeof next.prefs[name] !== 'function') missing.push(`prefs.${name}`);
  if (missing.length) throw new Error(`port incomplet : ${missing.join(', ')}`);
  port = next;
}

const current = () => {
  if (!port) throw new Error('port non branché (startEngine)');
  return port;
};
const call = name => (...args) => current()[name](...args);

const fetchRows = call('fetchRows');
const apply = call('apply');
const readSchema = call('readSchema');
const selectRows = call('selectRows');
const querySql = call('querySql');
const journalStats = call('journalStats');
const docIdentity = call('docIdentity');
const isOwner = call('isOwner');
const docChanges = call('docChanges');
const downloadAttachment = call('downloadAttachment');
const uploadAttachment = call('uploadAttachment');
const listWebhooks = call('listWebhooks');
const createWebhook = call('createWebhook');
const webhookConditions = call('webhookConditions');
const setWebhookEnabled = call('setWebhookEnabled');
const renameWebhook = call('renameWebhook');
const deleteWebhook = call('deleteWebhook');
const deleteWebhookWithNotice = call('deleteWebhookWithNotice');
const clearWebhookQueue = call('clearWebhookQueue');
const postToHook = call('postToHook');
const postRows = call('postRows');
const publicRecords = call('publicRecords');
const publicAccess = call('publicAccess');
const shareInfo = call('shareInfo');
const withLock = call('withLock');

const t = (key, values) => current().text(key, values);

const page = {
  visible: () => current().page.visible(),
  busy: () => current().page.busy(),
  onShow: callback => current().page.onShow(callback),
  onLeave: callback => current().page.onLeave(callback),
};

const prefs = {
  read: name => current().prefs.read(name),
  write: (name, value) => current().prefs.write(name, value),
};
return { PORT_SHAPE, setPort, fetchRows, apply, readSchema, selectRows, querySql, journalStats, docIdentity, isOwner, docChanges, downloadAttachment, uploadAttachment, listWebhooks, createWebhook, webhookConditions, setWebhookEnabled, renameWebhook, deleteWebhook, deleteWebhookWithNotice, clearWebhookQueue, postToHook, postRows, publicRecords, publicAccess, shareInfo, withLock, t, page, prefs };
})();

// ===== js/engine/errors.js =====
__M["js/engine/errors.js"] = (() => {
'use strict';
const {t} = __M["js/engine/port.js"];

const known = e => t(`error.${e.message}`) !== `error.${e.message}`;
const RULES_REFUSAL = /Blocked by [a-z ]*access rules/i;
const errorText = (e) => {
  if (known(e)) return t(`error.${e.message}`, e.vars || {});
  const refusal = RULES_REFUSAL.exec(e.message || '');
  return refusal ? t('error.blockedRules', { detail: refusal[0] }) : t('error.generic', { detail: e.message || String(e) });
};
const failure = (code, vars) => Object.assign(new Error(code), { vars });

const ERRORS_KEPT = 10;
const recentErrors = [];
function noteError(e) {
  recentErrors.push({ at: Date.now(), text: errorText(e) });
  if (recentErrors.length > ERRORS_KEPT) recentErrors.shift();
}
return { known, errorText, failure, recentErrors, noteError };
})();

// ===== js/engine/logic/health.js =====
__M["js/engine/logic/health.js"] = (() => {
'use strict';
const {LEASE_S, etaSeconds, percent} = __M["js/engine/logic/resend.js"];

function exportFlow({ exportId, owed, recipients, charge, page, now, lastPass = { at: 0 } }) {
  const running = Boolean(charge.par) && now - charge.le < LEASE_S;
  const prog = charge.prog && charge.prog.exp === exportId ? charge.prog : null;
  if (running && prog) {
    const left = etaSeconds(prog, charge, now);
    const vars = {
      done: prog.done, total: prog.total, pct: percent(prog), lot: prog.lots + 1, lots: Math.max(prog.lotsTotal, prog.lots + 1), table: prog.table, left, at: charge.reprise,
    };
    if (charge.reprise > now) return { key: 'budget', vars };
    return { key: charge.par === page ? 'running' : 'runningOther', vars };
  }
  if (!owed) return null;
  if (running) return charge.reprise > now ? { key: 'budgetWait', vars: { at: charge.reprise } } : { key: 'queued', vars: {} };
  const live = recipients.filter(s => s !== 'paused');
  if (!live.length) return { key: 'paused', vars: { n: owed } };
  const failing = live.filter(s => s === 'error').length;
  if (failing) return { key: 'blocked', vars: { n: failing } };
  if (prog) return { key: 'interrupted', vars: { done: prog.done, total: prog.total, pct: percent(prog) } };
  return { key: 'waiting', vars: { n: owed, at: lastPass.at } };
}

const flowMoves = flow => Boolean(flow) && ['running', 'runningOther', 'budget', 'budgetWait', 'queued', 'waiting'].includes(flow.key);
return { exportFlow, flowMoves };
})();

// ===== js/engine/logic/notes.js =====
__M["js/engine/logic/notes.js"] = (() => {
'use strict';
const {cleanLabel} = __M["js/engine/logic/codes.js"];

const docNameOf = note => cleanLabel(note.nomDoc);
function setDocName(note, name) {
  const { nomDoc, ...rest } = note;
  const clean = cleanLabel(name);
  return clean ? { ...rest, nomDoc: clean } : rest;
}

const put = (list, entry) => (list.some(x => x.id === entry.id) ? list.map(x => (x.id === entry.id ? entry : x)) : [...list, entry]);

const setExport = (note, id, fields) => ({ ...note, exports: note.exports.map(e => (e.id === id ? { ...e, ...fields } : e)) });
const putExport = (note, entry) => ({ ...note, exports: put(note.exports, entry) });

const clearExport = (note, id) => ({ ...note, invitations: note.invitations.filter(i => i.export !== id), pauses: note.pauses.filter(p => p.export !== id) });
function dropExport(note, id) {
  const next = { ...clearExport(note, id), exports: note.exports.filter(e => e.id !== id) };
  delete next.historique;
  delete next.lignes;
  const { [id]: gone, ...history } = note.historique || {};
  const { [id]: noRows, ...rows } = note.lignes || {};
  return { ...next, ...(Object.keys(history).length ? { historique: history } : {}), ...(Object.keys(rows).length ? { lignes: rows } : {}) };
}

const EVENTS_KEPT = 30;
const WHO_MAX = 80;
const EVENT_KINDS = ['join', 'reinforce', 'resend', 'catchup', 'unblock', 'pause', 'autopause', 'resume', 'revoke', 'edit', 'editSent', 'shrink'];
function addEvent(note, exportId, { at, kind, who = '', n = 0 }) {
  const event = { at, kind, ...(who ? { who: String(who).slice(0, WHO_MAX) } : {}), ...(n ? { n } : {}) };
  const before = (note.historique || {})[exportId];
  return { ...note, historique: { ...(note.historique || {}), [exportId]: [event, ...(Array.isArray(before) ? before : [])].slice(0, EVENTS_KEPT) } };
}
const readable = e => e && typeof e === 'object' && EVENT_KINDS.includes(e.kind) && Number.isFinite(e.at) && e.at > 0 && e.at < 4e9;
function eventsOf(note, exportId, { all = false } = {}) {
  const list = (note.historique || {})[exportId];
  return (Array.isArray(list) ? list : []).filter(readable).filter(e => all || !e.cleared).map(({ at, kind, who, n, cleared }) => ({
    at, kind, ...(who ? { who: String(who).slice(0, WHO_MAX) } : {}), ...(Number.isFinite(n) && n ? { n } : {}), ...(cleared ? { cleared: true } : {}),
  }));
}

function clearEvents(note, exportId) {
  const marks = eventsOf(note, exportId, { all: true }).filter(e => e.kind === 'join' || e.kind === 'revoke').map(({ at, kind }) => ({ at, kind, cleared: true }));
  return { ...note, historique: { ...(note.historique || {}), [exportId]: marks } };
}

function vanishedRecipients(events, present) {
  const joined = events.filter(e => e.kind === 'join').length;
  const revoked = events.filter(e => e.kind === 'revoke').length;
  return Math.max(0, joined - revoked - present);
}

const putInvitation = (note, entry) => ({ ...note, invitations: put(note.invitations, entry) });
const dropInvitation = (note, id) => ({ ...note, invitations: note.invitations.filter(i => i.id !== id) });

const setPause = (note, hook, entry = null) => ({ ...note, pauses: [...note.pauses.filter(p => p.hook !== hook), ...(entry ? [entry] : [])] });

function setFiles(note, fichiers) {
  const rest = { ...note };
  delete rest.fichiers;
  return Object.keys(fichiers).length ? { ...rest, fichiers } : rest;
}

const ROWS_DROP = { min: 11, share: 0.2 };
const ROWS_REFRESH_S = 300; // l'observation de référence se renouvelle au plus toutes les 5 minutes
const DROP_SHOWN_S = 86400;

function rowsOf(note, exportId) {
  const seen = (note.lignes || {})[exportId];
  if (!seen || !Number.isFinite(seen.at) || !seen.n || typeof seen.n !== 'object' || Array.isArray(seen.n)) return null;
  const n = Object.fromEntries(Object.entries(seen.n).filter(([, v]) => Number.isInteger(v) && v >= 0));
  return { at: seen.at, n };
}

function rowDrops(before, counts) {
  return Object.keys(counts).filter(table => table in before).map(table => ({ table, n: before[table] - counts[table], was: before[table] }))
    .filter(d => d.n >= ROWS_DROP.min && d.n > ROWS_DROP.share * d.was);
}

function observeRows(note, exportId, counts, now, warn = true) {
  const tables = Object.keys(counts);
  if (!tables.length) return null;
  const before = rowsOf(note, exportId);
  const drops = warn && before ? rowDrops(before.n, counts) : [];
  const changed = !before || tables.some(table => before.n[table] !== counts[table]) || Object.keys(before.n).some(table => !(table in counts));
  if (!drops.length && !(changed && (!before || now - before.at >= ROWS_REFRESH_S))) return null;
  let next = { ...note, lignes: { ...(note.lignes || {}), [exportId]: { at: now, n: counts } } };
  for (const drop of drops) next = addEvent(next, exportId, { at: now, kind: 'shrink', who: drop.table, n: drop.n });
  return next;
}

function recentDrops(events, now) {
  const seen = new Set();
  return events.filter(e => e.kind === 'shrink' && e.who && now - e.at < DROP_SHOWN_S && !seen.has(e.who) && seen.add(e.who))
    .map(e => ({ table: e.who, n: e.n || 0, at: e.at }));
}

const MEMO_TOKEN = /^r-[0-9a-f]{12}$/;
const isMemoToken = memo => MEMO_TOKEN.test(String(memo || ''));

const putDest = (note, token, memo, at) => ({ ...note, dest: { ...note.dest, [token]: { m: String(memo), at } } });

function destOf(note, token) {
  const entry = note.dest && Object.hasOwn(note.dest, token) ? note.dest[token] : null;
  return entry && typeof entry.m === 'string' ? entry.m : null;
}

const identifyHooks = (hooks, note) => hooks.map((h) => {
  const memo = h.fields.memo;
  const card = isMemoToken(memo) ? destOf(note, memo) : null;
  return card === null ? h : { ...h, fields: { ...h.fields, memo: card, memoToken: memo } };
});

const staleDest = (note, memos, now, grace) => Object.entries(note.dest || {})
  .filter(([token, entry]) => !memos.has(token) && !(Number.isFinite(entry && entry.at) && now - entry.at < grace)).map(([token]) => token);

function dropDest(note, tokens) {
  if (!tokens.length) return note;
  const { dest, ...rest } = note;
  const left = Object.fromEntries(Object.entries(dest || {}).filter(([token]) => !tokens.includes(token)));
  return Object.keys(left).length ? { ...rest, dest: left } : rest;
}
return { docNameOf, setDocName, setExport, putExport, clearExport, dropExport, EVENTS_KEPT, addEvent, eventsOf, clearEvents, vanishedRecipients, putInvitation, dropInvitation, setPause, setFiles, ROWS_DROP, ROWS_REFRESH_S, DROP_SHOWN_S, rowsOf, rowDrops, observeRows, recentDrops, MEMO_TOKEN, isMemoToken, putDest, destOf, identifyHooks, staleDest, dropDest };
})();

// ===== js/engine/logic/trust.js =====
__M["js/engine/logic/trust.js"] = (() => {
'use strict';
const {DATA_COL, DELETE_COL, EXPORT_COL, KEY_COL, KIND, LIST_COL, LOT_COL, ORDER_COL, SCHEMA_COL, SEAL_COL, SIG_KEY, TABLE_COL, TYPE_COL, is, isBlank, digest, isTrue, sha256, toHex} = __M["js/engine/logic/common.js"];
const {cleanLabel, parseWebhookUrl} = __M["js/engine/logic/codes.js"];

function readShare(json) {
  if (!json || typeof json !== 'object' || !is(/^[A-Za-z0-9_-]{12,}$/, json.id)) return null;
  const ws = json.workspace && typeof json.workspace === 'object' ? json.workspace : {};
  const org = ws.org && typeof ws.org === 'object' ? ws.org : {};
  const text = v => (typeof v === 'string' ? cleanLabel(v) : '');
  const team = text(org.domain);
  return {
    docId: json.id, name: text(json.name), folder: text(ws.name), team, teamName: text(org.name),
    personal: !team || /^docs(-\d+)?$/.test(team) || Boolean(org.billingAccount && org.billingAccount.individual),
  };
}

const sameDoc = (fullId, shown) => typeof shown === 'string' && shown.length >= 12 && fullId.startsWith(shown);

function memoMatches(memo, fullId) {
  const parts = String(memo || '').split(' · ').filter(p => !p.includes('@') && /^[A-Za-z0-9]{12,}$/.test(p));
  return !parts.length || parts.some(p => sameDoc(fullId, p));
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sans 0, 1, I, L, O
async function controlCode(url, secret, seen = []) {
  const subject = (parseWebhookUrl(url) || {}).key || url;
  const text = [subject, secret || '', ...seen].join('\n');
  const bytes = await digest('SHA-256', new TextEncoder().encode(text));
  const chars = Array.from(bytes.slice(0, 6), b => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

const codeFacts = ({ renforce, pub }, replyPub = null) => [renforce ? 'renforce' : 'standard', pub || '', ...(replyPub === null ? [] : [replyPub || ''])];

const INVITE_DAYS = 7;
const expiresAt = at => (Number(at) || 0) + INVITE_DAYS * 86400;
const isExpired = (at, now) => now > expiresAt(at);

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const JWK_PART = /^[A-Za-z0-9_-]{43}$/;

const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));

async function newKeyPair() {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const { x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { pub: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), priv: { x, y, d } };
}

const isPrivateKey = priv => Boolean(priv) && typeof priv === 'object' && ['x', 'y', 'd'].every(k => is(JWK_PART, priv[k]));

async function linkKeys(priv, peerPub, exportId, invitationId) {
  let base;
  try {
    const mine = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...priv }, ECDH, false, ['deriveBits']);
    const peer = await crypto.subtle.importKey('raw', fromBase64Url(peerPub), ECDH, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, mine, 256);
    base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  } catch (e) {
    throw new Error('codeInvalid');
  }
  const encode = text => new TextEncoder().encode(text);
  const derive = async label => toHex(new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: encode(`${exportId}|${invitationId}`), info: encode(`gristsync|${label}`) }, base, 128)));
  return { down: await derive('envoi'), up: await derive('retour') };
}

function readKeys(value) {
  const text = String(value || '');
  if (SIG_KEY.test(text)) return { '*': text };
  let keys = null;
  try {
    keys = text.startsWith('{') ? JSON.parse(text) : null;
  } catch (e) {
    keys = null;
  }
  return Object.fromEntries(Object.entries(keys && typeof keys === 'object' ? keys : {}).filter(([, k]) => SIG_KEY.test(k)));
}

function unkeyedRecipients(value, hookIds, hasJoin) {
  const keys = readKeys(value);
  if (!hasJoin || keys['*']) return [];
  return hookIds.filter(id => !keys[id]);
}

function keptKeys(keys, hookIds, pendingIds) {
  const kept = Object.fromEntries(Object.entries(keys).filter(([label]) => hookIds.includes(label) || pendingIds.includes(label)));
  if (keys['*'] && hookIds.some(id => !kept[id])) kept['*'] = keys['*'];
  return kept;
}

const SIGNED = { [KIND.lot]: LOT_COL, [KIND.keys]: LIST_COL, [KIND.end]: LOT_COL };
const SIG_TAIL = /, "sig": "([0-9a-f]{64})"\}$/;
const SIGS_TAIL = /, "sigs": (\{[^{}]*\})\}$/;

const message = (row, text) => [row[EXPORT_COL], row[TABLE_COL] || '', row[TYPE_COL], row[SCHEMA_COL] || '', text].join('|');

async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text))));
}

const keyMark = async key => (await sha256(key)).slice(0, 8);
const keySig = async (key, digest) => (await hmac(key, digest)).slice(0, 32);

async function signText(key, row, text) {
  const sig = await keySig(key, await sha256(message(row, text)));
  return `${text.slice(0, -1)}, "sigs": {"${await keyMark(key)}": "${sig}"}}`;
}

async function signature(row, key) {
  const col = SIGNED[row[TYPE_COL]];
  if (!col) return 'ok';
  const text = typeof row[col] === 'string' ? row[col] : '';
  if (!text) return row[TYPE_COL] === KIND.keys ? 'bare' : 'bad';
  const legacy = SIG_TAIL.exec(text);
  if (legacy) return (await hmac(key, message(row, `${text.slice(0, legacy.index)}}`))) === legacy[1] ? 'ok' : 'bad';
  const m = SIGS_TAIL.exec(text);
  const sigs = m ? parseSigs(m[1]) : null;
  const sig = sigs && sigs[await keyMark(key)];
  if (!sig) return 'bad';
  return (await keySig(key, await sha256(message(row, `${text.slice(0, m.index)}}`)))) === sig ? 'ok' : 'bad';
}

function parseSigs(text) {
  try {
    const sigs = JSON.parse(text);
    return sigs && typeof sigs === 'object' ? sigs : null;
  } catch (e) {
    return null;
  }
}

function isUnsigned(row) {
  const col = SIGNED[row[TYPE_COL]];
  if (!col || row[TYPE_COL] === KIND.end) return false;
  const text = typeof row[col] === 'string' ? row[col] : '';
  return text !== '' && !SIG_TAIL.test(text) && !SIGS_TAIL.test(text);
}

async function checkSigned(rows, key, exportId, { grace = false } = {}) {
  const out = { bad: new Set(), bare: new Set(), signed: 0, tolerated: 0 };
  for (const row of rows) {
    if (row[EXPORT_COL] !== exportId) continue;
    const verdict = await signature(row, key);
    if (verdict === 'ok') {
      if (SIGNED[row[TYPE_COL]]) out.signed++;
    } else if (verdict === 'bad' && grace && isUnsigned(row)) {
      out.tolerated++;
    } else {
      out[verdict].add(row.id);
    }
  }
  return out;
}

const SEALED = [TABLE_COL, KEY_COL, ORDER_COL, DELETE_COL, DATA_COL, SCHEMA_COL, LIST_COL];
const sealText = (exportId, row) => JSON.stringify(['sceau', exportId,
  ...SEALED.map(c => (c === DELETE_COL ? isTrue(row[c]) : isBlank(row[c]) ? '' : row[c]))]);

const isUnpacked = row => isBlank(row[TYPE_COL]) && !isBlank(row[TABLE_COL]);

async function sealer(key) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return async text => toHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text))));
}

const sealMark = async seal => (await seal('sceau')).slice(0, 8);

const sealRows = async (rows, exportId, seal) => Promise.all(rows.map(async r => ({ ...r, [SEAL_COL]: await seal(sealText(exportId, r)) })));

async function checkSeals(rows, exportId, seal, seen = new Map()) {
  const present = new Set(rows.map(r => r.id));
  for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
  const forged = [];
  for (const row of rows.filter(isUnpacked)) {
    const got = row[SEAL_COL];
    if (got && seen.get(row.id) === got) continue;
    if (got && got === await seal(sealText(exportId, row))) seen.set(row.id, got);
    else forged.push(row.id);
  }
  const bad = new Set(forged);
  return { kept: rows.filter(r => !bad.has(r.id)), forged };
}
return { readShare, sameDoc, memoMatches, controlCode, codeFacts, INVITE_DAYS, expiresAt, isExpired, newKeyPair, isPrivateKey, linkKeys, readKeys, unkeyedRecipients, keptKeys, hmac, signText, signature, isUnsigned, checkSigned, sealText, isUnpacked, sealer, sealMark, sealRows, checkSeals };
})();

// ===== js/engine/logic/lost.js =====
__M["js/engine/logic/lost.js"] = (() => {
'use strict';
const {cleanLabel} = __M["js/engine/logic/codes.js"];

const MARK_KEY = 'syncPlus';
const TABLE_ID = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const DESTS_MAX = 100;

function receptionMark(journal, note) {
  const dests = [...new Set((note.tables || []).map(tb => tb.dest).filter(d => TABLE_ID.test(d)))].slice(0, DESTS_MAX);
  return JSON.stringify({ [MARK_KEY]: { journal, name: cleanLabel(note.name), dests } });
}

function readMark(description) {
  let parsed;
  try { parsed = JSON.parse(String(description || '')); } catch { return null; }
  const mark = parsed && typeof parsed === 'object' ? parsed[MARK_KEY] : null;
  if (!mark || typeof mark !== 'object' || !TABLE_ID.test(String(mark.journal))) return null;
  const dests = Array.isArray(mark.dests) ? mark.dests.filter(d => typeof d === 'string' && TABLE_ID.test(d)).slice(0, DESTS_MAX) : [];
  return { journal: mark.journal, name: cleanLabel(mark.name), dests };
}

function lostReceptions(schema, shares) {
  const lost = new Map();
  for (const share of shares) {
    const mark = readMark(share.description);
    if (!mark || schema.has(mark.journal)) continue;
    const known = lost.get(mark.journal);
    if (known) known.shares.push(share.id);
    else lost.set(mark.journal, { journal: mark.journal, name: mark.name, shares: [share.id], dests: mark.dests.map(dest => ({ dest, there: schema.has(dest) })) });
  }
  return [...lost.values()];
}
return { receptionMark, readMark, lostReceptions };
})();

// ===== js/engine/logic/page-order.js =====
__M["js/engine/logic/page-order.js"] = (() => {
'use strict';

function destPageViews(dests, tables, sections, pages) {
  const listed = new Set(pages.map(p => p.viewRef));
  const views = [];
  for (const dest of dests) {
    const table = tables.find(tb => tb.tableId === dest);
    if (!table) continue;
    if (table.primaryViewId && listed.has(table.primaryViewId)) views.push(table.primaryViewId);
    else {
      const section = sections.find(s => s.tableRef === table.id && listed.has(s.parentId));
      if (section) views.push(section.parentId);
    }
  }
  return views;
}

function placeBelow(pages, anchors, own) {
  const list = [...pages].sort((a, b) => a.pagePos - b.pagePos);
  const rest = list.filter(p => p.viewRef !== own);
  let at = -1;
  rest.forEach((p, i) => { if (anchors.includes(p.viewRef)) at = i; });
  if (at < 0) return null;
  const anchor = rest[at];
  let end = at;
  while (end + 1 < rest.length && rest[end + 1].indentation > anchor.indentation) end += 1;
  const before = rest[end];
  const after = rest[end + 1];
  const mine = list.find(p => p.viewRef === own);
  if (mine && mine.indentation === anchor.indentation && list[list.indexOf(mine) - 1] === before) return null;
  return { pagePos: after ? (before.pagePos + after.pagePos) / 2 : before.pagePos + 1, indentation: anchor.indentation };
}
return { destPageViews, placeBelow };
})();

// ===== js/engine/logic/page-widget.js =====
__M["js/engine/logic/page-widget.js"] = (() => {
'use strict';
const {parseJson} = __M["js/engine/logic/common.js"];
const {destPageViews} = __M["js/engine/logic/page-order.js"];

function widgetAddress(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.origin}${parsed.pathname}`.replace(/index\.html$/, '').replace(/\/+$/, '');
  } catch (e) {
    return '';
  }
}

function customUrl(section) {
  if (section.parentKey !== 'custom') return '';
  const options = parseJson(section.options);
  const view = options && typeof options === 'object' ? options.customView : null;
  const def = typeof view === 'string' ? parseJson(view) : view;
  return def && typeof def === 'object' && typeof def.url === 'string' ? def.url : '';
}

function widgetSpot(dest, url, tables, sections, pages) {
  const [view] = destPageViews([dest], tables, sections, pages);
  if (!view) return { view: null, there: false };
  const want = widgetAddress(url);
  return { view, there: Boolean(want) && sections.some(s => s.parentId === view && widgetAddress(customUrl(s)) === want) };
}

function sectionUrl(url, sections) {
  const want = widgetAddress(url);
  if (!want) return '';
  const known = sections.map(customUrl).find(u => widgetAddress(u) === want);
  return known || String(url);
}

const customOptions = url => JSON.stringify({ customView: JSON.stringify({ mode: 'url', url, access: 'none', renderAfterReady: false }) });
return { widgetAddress, customUrl, widgetSpot, sectionUrl, customOptions };
})();

// ===== js/engine/pages.js =====
__M["js/engine/pages.js"] = (() => {
'use strict';
const {apply, fetchRows, readSchema, withLock} = __M["js/engine/port.js"];
const {parseJson, randomHex} = __M["js/engine/logic/common.js"];
const {receptionMark} = __M["js/engine/logic/lost.js"];
const {destPageViews, placeBelow} = __M["js/engine/logic/page-order.js"];
const {customOptions, sectionUrl, widgetSpot} = __M["js/engine/logic/page-widget.js"];

const published = section => (parseJson(section.shareOptions) || {}).publish === true;

async function ensureForm(tableId, { below = [], note = null } = {}) {
  const table = (await readSchema()).table(tableId);
  let section = (await fetchRows('_grist_Views_section')).find(s => s.parentKey === 'form' && s.tableRef === table.id);
  if (!section) {
    const created = (await apply([['CreateViewSection', table.id, 0, 'form', null, null]])).retValues[0];
    section = { id: created.sectionRef, parentId: created.viewRef, shareOptions: '' };
    await apply([['UpdateRecord', '_grist_Views', created.viewRef, { name: tableId }]]);
    if (below.length) await placeForm(created.viewRef, below);
  }
  const page = (await fetchRows('_grist_Pages')).find(p => p.viewRef === section.parentId);
  if (!page.shareRef) {
    const description = note ? { description: receptionMark(tableId, note) } : {};
    const shareRef = (await apply([['AddRecord', '_grist_Shares', null, { linkId: randomHex(12), options: JSON.stringify({ publish: true }), ...description }]])).retValues[0];
    await apply([['UpdateRecord', '_grist_Pages', page.id, { shareRef }]]);
  }
  if (!published(section)) {
    await apply([['UpdateRecord', '_grist_Views_section', section.id, { shareOptions: JSON.stringify({ form: true, publish: true }) }]]);
  }
}

async function placeForm(viewRef, dests) {
  try {
    const [tables, sections, pages] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Views_section'), fetchRows('_grist_Pages')]);
    const spot = placeBelow(pages, destPageViews(dests, tables, sections, pages), viewRef);
    const mine = pages.find(p => p.viewRef === viewRef);
    if (spot && mine) await apply([['UpdateRecord', '_grist_Pages', mine.id, spot]]);
  } catch (e) {
    console.warn(e);
  }
}

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

function tidyActions(viewRef, sections, views, pages) {
  const view = views.find(v => v.id === viewRef);
  if (!view) return [];
  const here = sections.filter(s => s.parentId === viewRef);
  const ids = new Set(here.map(s => s.id));
  const actions = [];
  const spec = parseJson(view.layoutSpec); // illisible : laissé tel quel
  if (spec) {
    const keep = box => (box.leaf !== undefined ? (ids.has(box.leaf) ? box : null) : { ...box, children: (box.children || []).map(keep).filter(Boolean) });
    const { collapsed = [], ...tree } = spec;
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

async function isOnPage(tableId) {
  const [tables, sections, pages] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Views_section'), fetchRows('_grist_Pages')]);
  const table = tables.find(tb => tb.tableId === tableId);
  const listed = new Set(pages.map(p => p.viewRef));
  return Boolean(table) && sections.some(s => s.tableRef === table.id && listed.has(s.parentId));
}

async function widgetSpots(dests, url) {
  const [tables, sections, pages] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Views_section'), fetchRows('_grist_Pages')]);
  return new Map(dests.map(dest => [dest, widgetSpot(dest, url, tables, sections, pages)]));
}

async function addWidgetToPage(dest, url) {
  return withLock('gristsync-widget-page', async () => {
    const [tables, sections, pages] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Views_section'), fetchRows('_grist_Pages')]);
    const address = sectionUrl(url, sections);
    if (!address) throw new Error('badWidgetUrl');
    const spot = widgetSpot(dest, address, tables, sections, pages);
    if (!spot.view) throw new Error('noPageForTable');
    if (spot.there) return { added: false, view: spot.view };
    const table = tables.find(tb => tb.tableId === dest);
    const created = (await apply([['CreateViewSection', table.id, spot.view, 'custom', null, null]])).retValues[0];
    await apply([['UpdateRecord', '_grist_Views_section', created.sectionRef, { options: customOptions(address) }]]);
    return { added: true, view: spot.view };
  });
}

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
  const emptied = still.filter(v => !left.has(v));
  const orphans = [...shared].filter(ref => !pages.some(p => !emptied.includes(p.viewRef) && p.shareRef === ref));
  await apply([...emptied.map(v => ['RemoveView', v]), ...orphans.map(ref => ['RemoveRecord', '_grist_Shares', ref])]);
  await apply(still.filter(v => left.has(v)).flatMap(v => tidyActions(v, sections, views, pages)));
}

async function dropPages(tableIds) {
  const [tables, sections] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Views_section')]);
  const views = tables.filter(tb => tableIds.includes(tb.tableId) && tb.primaryViewId).filter(tb =>
    sections.filter(s => s.parentId === tb.primaryViewId).every(s => s.tableRef === tb.id)).map(tb => tb.primaryViewId);
  await apply(views.map(v => ['RemoveView', v]));
}

async function hideColumn(tableId, colId) {
  const table = (await fetchRows('_grist_Tables')).find(tb => tb.tableId === tableId);
  const column = (await fetchRows('_grist_Tables_column')).find(c => c.parentId === table.id && c.colId === colId);
  const sections = new Set((await fetchRows('_grist_Views_section')).filter(s => s.parentId === table.primaryViewId).map(s => s.id));
  const fields = (await fetchRows('_grist_Views_section_field')).filter(f => f.colRef === column.id && sections.has(f.parentId));
  await apply(fields.length ? [['BulkRemoveRecord', '_grist_Views_section_field', fields.map(f => f.id)]] : []);
}
return { ensureForm, formPages, renewFormLink, isOnPage, widgetSpots, addWidgetToPage, removeTechnicalTables, dropPages, hideColumn };
})();

// ===== js/engine/logic/note-store.js =====
__M["js/engine/logic/note-store.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, KEY_COL, LIST_COL, isUserTable, legacyNote, hasNoteOption, noteAction} = __M["js/engine/logic/common.js"];
const {ownsSync} = __M["js/engine/logic/strays.js"];

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function carriers(schema) {
  const found = [];
  const add = (table, colId, accepts) => {
    const column = (schema.columns(table) || []).find(c => c.colId === colId);
    if (column) found.push({ column, table, accepts });
  };
  if (ownsSync(schema)) add(__C.SYNC_TABLE, EXPORT_COL, () => true);
  for (const table of schema.tableIds) {
    if (table.startsWith(__C.JOURNAL_PREFIX)) add(table, LIST_COL, () => true);
    else if (isUserTable(table)) add(table, KEY_COL, note => isObject(note.signature));
  }
  return found;
}

function legacyNoteActions(schema) {
  return carriers(schema).flatMap(({ column, accepts }) => {
    const legacy = legacyNote(column);
    if (!legacy || !accepts(legacy)) return [];
    return [hasNoteOption(column) ? ['UpdateRecord', '_grist_Tables_column', column.id, { description: '' }] : noteAction(column, legacy)];
  });
}
return { legacyNoteActions };
})();

// ===== js/engine/note-move.js =====
__M["js/engine/note-move.js"] = (() => {
'use strict';
const {legacyNoteActions} = __M["js/engine/logic/note-store.js"];
const {apply, readSchema, withLock} = __M["js/engine/port.js"];

async function moveNotes(schema) {
  if (!legacyNoteActions(schema).length) return false;
  try {
    return await withLock('gristsync-note-move', async () => {
      const actions = legacyNoteActions(await readSchema());
      if (actions.length) await apply(actions);
      return actions.length > 0;
    });
  } catch (e) {
    console.warn(e);
    return false;
  }
}
return { moveNotes };
})();

// ===== js/engine/source/synchro.js =====
__M["js/engine/source/synchro.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, KIND, LIST_COL, LOT_COL, SIG_KEY, RECALC_COL, RESEND_COL, SCHEMA_COL, TABLE_COL, TRACK_COL, TYPE_COL, columnNote, noteAction, nowS, pool, randomHex} = __M["js/engine/logic/common.js"];
const {cleanLabel} = __M["js/engine/logic/codes.js"];
const {RECALC_SPEC, majleAction, prepareSourceActions, syncColumns, syncFormulas} = __M["js/engine/logic/formulas.js"];
const {endNotice, exportRowsActions, exportTables, hooksOf, optionsActions} = __M["js/engine/logic/exports.js"];
const {filterColumns} = __M["js/engine/logic/filters.js"];
const {docFormatOf} = __M["js/engine/logic/docformat.js"];
const {keptKeys, readKeys, signText} = __M["js/engine/logic/trust.js"];
const {foreignSync, ownsSync, strayColumns} = __M["js/engine/logic/strays.js"];
const {addEvent, docNameOf, dropDest, identifyHooks, isMemoToken, observeRows, putDest, setDocName, staleDest} = __M["js/engine/logic/notes.js"];
const {apply, docIdentity, fetchRows, listWebhooks, readSchema, renameWebhook, webhookConditions, withLock} = __M["js/engine/port.js"];
const {dropPages, isOnPage, removeTechnicalTables} = __M["js/engine/pages.js"];
const {moveNotes} = __M["js/engine/note-move.js"];

const SORT_COL = 'manualSort'; // colonne d'ordre que Grist donne à toute table (voir ensureSyncTable)

const isCharge = row => row[TYPE_COL] === KIND.load;
const syncRows = async (schema = null) => (ownsSync(schema || await readSchema()) ? (await fetchRows(__C.SYNC_TABLE)).filter(r => !isCharge(r)) : []);

async function readHooks() {
  const [hooks, conditions, schema] = await Promise.all([listWebhooks(), webhookConditions(), readSchema()]);
  const known = identifyHooks(hooks, readSourceNote(schema));
  return { hooks: known, conditions, of: id => hooksOf(known, conditions, id) };
}

const identified = (hooks, note) => identifyHooks(hooks, note);

async function rememberDest(memo) {
  const token = `r-${randomHex(6)}`;
  await updateSourceNote(note => putDest(note, token, memo, nowS()));
  return token;
}

const DEST_GRACE_S = 600;

const protectMemos = () => withLock('gristsync-memos', async () => {
  const schema = await readSchema();
  if (!ownsSync(schema)) return false;
  let hooks;
  try { hooks = await listWebhooks(); } catch (e) { if (e.message === 'ownerOnly') return false; throw e; }
  const mine = hooks.filter(h => h.fields.tableId === __C.SYNC_TABLE);
  const legacy = mine.filter(h => h.fields.memo && !isMemoToken(h.fields.memo));
  const tokens = new Map(legacy.map(h => [h.id, `r-${randomHex(6)}`]));
  const live = new Set(hooks.map(h => h.fields.memo));
  await updateSourceNote((note) => {
    const kept = tokens.size ? legacy.reduce((acc, h) => putDest(acc, tokens.get(h.id), h.fields.memo, nowS()), note) : note;
    return dropDest(kept, staleDest(kept, live, nowS(), DEST_GRACE_S));
  });
  let changed = false;
  await pool(legacy, 6, async (h) => {
    try {
      await renameWebhook(h.id, h.fields.name, tokens.get(h.id));
      changed = true;
    } catch (e) {
      console.warn(e);
    }
  });
  return changed;
});
const exportHooks = async exportId => (await readHooks()).of(exportId);

async function chargeRow() {
  const row = (await fetchRows(__C.SYNC_TABLE)).find(isCharge);
  if (row) return row;
  const fields = { [TYPE_COL]: KIND.load, [EXPORT_COL]: '', [TABLE_COL]: '', [SCHEMA_COL]: '', [RESEND_COL]: '' };
  return { ...fields, id: (await apply([['AddRecord', __C.SYNC_TABLE, null, fields]])).retValues[0] };
}

const exportColumn = schema => (schema.columns(__C.SYNC_TABLE) || []).find(c => c.colId === EXPORT_COL);

const readSourceNote = schema => ({ exports: [], invitations: [], pauses: [], ...columnNote(exportColumn(schema)) });

const updateSourceNote = change => withLock('gristsync-source-note', async () => {
  const schema = await readSchema();
  const column = exportColumn(schema);
  if (!column) return;
  const note = readSourceNote(schema);
  const next = change(note);
  if (next !== note) await apply([noteAction(column, next)]);
});

const sourceDocName = async () => docNameOf(readSourceNote(await readSchema()));
const rememberDocName = name => updateSourceNote(note => (docNameOf(note) === cleanLabel(name) ? note : setDocName(note, name)));

async function sourceFrom(email, { docId, team }) {
  const docName = await sourceDocName();
  return { email, docId, team, ...(docName ? { docName } : {}) };
}

const recordEvent = (exportId, kind, fields = {}) => updateSourceNote(note => addEvent(note, exportId, { at: nowS(), kind, ...fields })).catch(console.warn);

async function watchRows(note, counts, recipients) {
  const now = nowS();
  const observed = Object.entries(counts).map(([id, n]) => ({ id, entry: note.exports.find(e => e.id === id), counts: n }))
    .filter(o => o.entry)
    .map(o => ({ ...o, warn: !o.entry.echange && !o.entry.retour && recipients(o.id) + (o.entry.public ? 1 : 0) > 0 }));
  const observe = base => observed.reduce((next, o) => observeRows(next, o.id, o.counts, now, o.warn) || next, base);
  if (observe(note) === note) return false;
  await updateSourceNote(observe).catch(console.warn);
  return true;
}

async function refreshFormulas(schema, rows) {
  const { keys, lot, state } = syncFormulas(rows.map(r => r[TABLE_COL]).filter(table => schema.has(table)));
  const cols = schema.columns(__C.SYNC_TABLE);
  const actions = [[LIST_COL, keys], [LOT_COL, lot], [TRACK_COL, state]]
    .filter(([colId, formula]) => (cols.find(c => c.colId === colId) || {}).formula !== formula)
    .map(([colId, formula]) => ['ModifyColumn', __C.SYNC_TABLE, colId, { formula }]);
  await apply(actions);
  return actions.length > 0;
}

async function ensureSyncTable(schema = null, rows = null) {
  schema ||= await readSchema();
  if (!ownsSync(schema)) return false;
  const have = new Set(schema.columns(__C.SYNC_TABLE).map(c => c.colId));
  const missing = syncColumns([]).filter(c => !have.has(c.id));
  const sorted = have.has(SORT_COL);
  if (missing.length || sorted) {
    await apply([...missing.map(({ id, ...info }) => ['AddColumn', __C.SYNC_TABLE, id, info]), ...(sorted ? [['RemoveColumn', __C.SYNC_TABLE, SORT_COL]] : [])]);
    schema = await readSchema();
  }
  const cols = schema.columns(__C.SYNC_TABLE);
  const watch = cols.find(c => c.colId === TRACK_COL);
  const deps = ['L', ...[LOT_COL, LIST_COL, RESEND_COL].map(id => cols.find(c => c.colId === id).id)];
  const depsChanged = JSON.stringify(watch.recalcDeps || null) !== JSON.stringify(deps) || watch.type !== 'Any';
  if (watch.type !== 'Any') await apply([['ModifyColumn', __C.SYNC_TABLE, TRACK_COL, { type: 'Any' }]]);
  if (depsChanged) await apply([['UpdateRecord', '_grist_Tables_column', watch.id, { recalcWhen: 0, recalcDeps: deps }]]);
  const formulasChanged = await refreshFormulas(schema, rows || await syncRows(schema));
  const moved = await moveNotes(schema);
  return missing.length > 0 || sorted || depsChanged || formulasChanged || moved;
}

async function removeStrayColumns(ids) {
  const schema = await readSchema();
  const stray = new Set(strayColumns(schema.columns(__C.SYNC_TABLE) || []).map(c => c.id));
  await apply(ids.filter(id => stray.has(id)).map(id => ['RemoveColumn', __C.SYNC_TABLE, id]));
}

async function renameForeignSync(name) {
  const schema = await readSchema();
  if (!foreignSync(schema)) return;
  if (schema.resolve(name)) throw new Error('tableNameTaken');
  await apply([['RenameTable', __C.SYNC_TABLE, name]]);
}

async function refreshOptions(schema, rows) {
  const sends = key => rows.some(r => String(r[SCHEMA_COL] || '').includes(key));
  const doc = sends('"fmt":true') ? docFormatOf(await fetchRows('_grist_DocInfo')) : null;
  const laidOut = sends('"pos":');
  const sections = sends('"tdesc"') || laidOut ? await fetchRows('_grist_Views_section') : null;
  const fields = laidOut ? await fetchRows('_grist_Views_section_field') : null;
  const actions = optionsActions(rows, schema, doc, sections, fields);
  await apply(actions);
  return actions.length > 0;
}

async function refreshMajLe(schema = null, rows = null) {
  schema ||= await readSchema();
  rows ||= await syncRows(schema);
  const sent = new Map(); // table -> colonnes envoyées par l'un de ses exports
  for (const id of new Set(rows.map(r => r[EXPORT_COL]))) {
    for (const { table, columns, filter } of exportTables(rows, id)) {
      sent.set(table, new Set([...(sent.get(table) || []), ...columns.map(c => c.id), ...filterColumns(filter)]));
    }
  }
  const tables = [...sent].filter(([table]) => schema.has(table));
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

async function createSyncTable(tables = [], schema = null) {
  if ((schema || await readSchema()).has(__C.SYNC_TABLE)) return false;
  await apply([['AddTable', __C.SYNC_TABLE, syncColumns(tables)], ['RemoveColumn', __C.SYNC_TABLE, SORT_COL]]);
  await dropPages([__C.SYNC_TABLE]);
  return true;
}

async function saveExport(exportId, tables, { isPublic = false, swap = false } = {}) {
  const schema = await readSchema();
  if (foreignSync(schema)) throw new Error('syncTableForeign');
  await createSyncTable(tables.map(tb => tb.table), schema);
  const before = await fetchRows(__C.SYNC_TABLE);
  const { actions, changed } = exportRowsActions(before, exportId, tables, { isPublic, swap });
  const all = [...before.filter(r => r[EXPORT_COL] !== exportId), ...tables.map(tb => ({ [TABLE_COL]: tb.table }))];
  await ensureSyncTable(null, [...before, ...all]);
  await apply(actions);
  await refreshFormulas(await readSchema(), all);
  await refreshMajLe();
  return changed;
}

async function removeExport(exportId) {
  const rows = await syncRows();
  const left = rows.filter(r => r[EXPORT_COL] !== exportId);
  if (!left.length && !(await isOnPage(__C.SYNC_TABLE))) {
    await removeTechnicalTables([__C.SYNC_TABLE]);
    return;
  }
  await apply([['BulkRemoveRecord', __C.SYNC_TABLE, rows.filter(r => r[EXPORT_COL] === exportId).map(r => r.id)]]);
  await refreshFormulas(await readSchema(), left);
}

async function updateKeys(exportId, change) {
  const row = (await syncRows()).find(r => r[EXPORT_COL] === exportId && r[TYPE_COL] === KIND.sign);
  const before = readKeys(row ? row[SCHEMA_COL] : '');
  const after = change(before);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  const value = JSON.stringify(after);
  await apply([row ? ['UpdateRecord', __C.SYNC_TABLE, row.id, { [SCHEMA_COL]: value }]
    : ['AddRecord', __C.SYNC_TABLE, null, { [EXPORT_COL]: exportId, [TABLE_COL]: '', [TYPE_COL]: KIND.sign, [SCHEMA_COL]: value, [RESEND_COL]: '' }]]);
}

async function putRecipientKey(exportId, label, key, was = '') {
  if (!SIG_KEY.test(key || '')) throw new Error('codeInvalid');
  await updateKeys(exportId, (keys) => {
    const rest = Object.fromEntries(Object.entries(keys).filter(([k]) => k !== was));
    return { ...rest, [label]: key };
  });
}

async function setOnlyKey(exportId, label, key) {
  if (!SIG_KEY.test(key || '')) throw new Error('codeInvalid');
  await updateKeys(exportId, () => ({ [label]: key }));
}

async function pruneKeys(exportId) {
  const [hooks, schema] = await Promise.all([exportHooks(exportId), readSchema()]);
  const pending = readSourceNote(schema).invitations.filter(inv => inv.export === exportId).map(inv => inv.id);
  await updateKeys(exportId, keys => keptKeys(keys, hooks.map(h => h.id), pending));
}

async function endRows(exportId, hookId) {
  const row = (await syncRows()).find(r => r[EXPORT_COL] === exportId && r[TYPE_COL] === KIND.sign);
  const keys = readKeys(row ? row[SCHEMA_COL] : '');
  const key = keys[hookId] || keys['*'];
  const rows = endNotice(exportId);
  return key ? Promise.all(rows.map(async r => ({ ...r, [LOT_COL]: await signText(key, r, '{"fin": true}') }))) : rows;
}

const writeSync = (ids, fields) => apply(ids.length
  ? [['BulkUpdateRecord', __C.SYNC_TABLE, ids, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, ids.map(() => v)]))]] : []);
return { isCharge, syncRows, readHooks, identified, rememberDest, protectMemos, exportHooks, chargeRow, readSourceNote, updateSourceNote, sourceDocName, rememberDocName, sourceFrom, recordEvent, watchRows, ensureSyncTable, removeStrayColumns, renameForeignSync, refreshOptions, refreshMajLe, createSyncTable, saveExport, removeExport, putRecipientKey, setOnlyKey, pruneKeys, endRows, writeSync };
})();

// ===== js/engine/logic/files.js =====
__M["js/engine/logic/files.js"] = (() => {
'use strict';
const {APPLIED_COL, DELETE_COL, EXPORT_COL, KEY_COL, KIND, LOT_COL, RECEIVED_COL, SCHEMA_COL, TYPE_COL, chunk, digest, groupBy, is, isTrue, parseJson, toHex} = __M["js/engine/logic/common.js"];
const {expandRows, latestByKey} = __M["js/engine/logic/journal.js"];

const FILE_MAX = 25 * 1024 * 1024; // octets par fichier, au plus
const PART_BYTES = 512 * 1024;
const MAX_PARTS = Math.ceil(FILE_MAX / PART_BYTES);
const PART_TEXT_MAX = Math.ceil(PART_BYTES / 3) * 4;
const PART_TTL = 86400; // un envoi resté incomplet un jour ne s'achèvera plus (la SOURCE en refera un)
const SHA = /^[0-9a-f]{40}$/;
const SEND = /^[0-9a-f]{8}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const shaOf = ident => (typeof ident === 'string' && SHA.test(ident.slice(0, 40)) ? ident.slice(0, 40) : null);
const short = sha => sha.slice(0, 16);

function neededFiles(rows) {
  const files = new Map();
  for (const row of rows) {
    const list = parseJson(row[LOT_COL]);
    if (!list || typeof list !== 'object' || Array.isArray(list)) continue;
    for (const [ident, info] of Object.entries(list)) {
      const sha = shaOf(ident);
      if (sha && Array.isArray(info) && Number.isInteger(info[0])) files.set(sha, { id: info[0], name: safeName(String(info[1] || '')), size: Number(info[2]) || 0 });
    }
  }
  return files;
}

const HELD_MAX = 1000;
function readTracking(noted) {
  const words = s => new Set(typeof s === 'string' ? s.split(' ').filter(w => /^[0-9a-f]{16}$/.test(w)) : []);
  const x = noted && typeof noted === 'object' ? noted : {};
  const map = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : []);
  return {
    f: words(x.f), h: new Set(Array.isArray(x.h) ? x.h.filter(id => typeof id === 'string') : []),
    p: new Map(map(x.p).map(([id, s]) => [id, words(s)])), o: new Map(map(x.o).map(([id, s]) => [id, words(s)])),
  };
}

const copyTracking = tracking => ({
  f: new Set(tracking.f), h: new Set(tracking.h), p: new Map([...tracking.p].map(([id, s]) => [id, new Set(s)])),
  o: new Map([...(tracking.o || [])].map(([id, s]) => [id, new Set(s)])),
});

const trackingNote = ({ f, h, p, o = new Map() }) => {
  const held = Object.fromEntries([...o].filter(([, s]) => s.size).map(([id, s]) => [id, [...s].join(' ')]));
  return {
    f: [...f].sort().join(' '), h: [...h].sort(), p: Object.fromEntries([...p].map(([id, s]) => [id, [...s].sort().join(' ')])),
    ...(Object.keys(held).length ? { o: held } : {}),
  };
};

function holdFiles(tracking, hookIds, cited) {
  const valid = [...cited].filter(k => /^[0-9a-f]{16}$/.test(k));
  const next = copyTracking(tracking);
  for (const id of hookIds) {
    const set = next.o.get(id) || new Set();
    for (const k of valid) set.add(k);
    for (const k of [...set].slice(0, Math.max(0, set.size - HELD_MAX))) set.delete(k);
    next.o.set(id, set);
  }
  return next;
}

function mergeHeld(tracking, latest) {
  const next = copyTracking(tracking);
  for (const id of new Set([...tracking.h, ...tracking.p.keys()])) {
    const set = new Set([...(latest.o?.get(id) || []), ...(next.o.get(id) || [])]);
    for (const k of [...set].slice(0, Math.max(0, set.size - HELD_MAX))) set.delete(k);
    if (set.size) next.o.set(id, set);
  }
  return next;
}

function promote({ f, h, p }) {
  for (const [id, have] of p) {
    if ([...f].every(k => have.has(k))) {
      h.add(id);
      p.delete(id);
    }
  }
}

function fileSends(tracking, needed, hooks, active) {
  const live = new Set(hooks);
  const sendable = [...needed].filter(([, file]) => file.size <= FILE_MAX).map(([sha]) => sha);
  const keys = new Set(sendable.map(short));
  const kept = s => new Set([...s].filter(k => keys.has(k)));
  const next = {
    f: kept(tracking.f), h: new Set([...tracking.h].filter(id => live.has(id))),
    p: new Map([...tracking.p].filter(([id]) => live.has(id) && !tracking.h.has(id)).map(([id, s]) => [id, kept(s)])),
    o: new Map([...(tracking.o || [])].filter(([id]) => live.has(id)).map(([id, s]) => [id, new Set(s)])),
  };
  for (const id of hooks) if (!next.h.has(id) && !next.p.has(id)) next.p.set(id, new Set());
  promote(next);
  const served = [...next.h].filter(id => active.includes(id));
  const late = [...next.p].filter(([id]) => active.includes(id));
  const holds = (id, sha) => Boolean(next.o.get(id)?.has(short(sha)));
  const sends = sendable.map((sha) => {
    const due = [...(next.f.has(short(sha)) ? [] : served), ...late.filter(([, have]) => !have.has(short(sha))).map(([id]) => id)];
    const held = due.filter(id => holds(id, sha));
    return { sha, hooks: due.filter(id => !holds(id, sha)), ...(held.length ? { held } : {}) };
  }).filter(s => s.hooks.length || s.held || !next.f.has(short(s.sha)));
  return { tracking: next, sends };
}

function recordSent(tracking, sha, hookIds) {
  const k = short(sha);
  const next = copyTracking(tracking);
  for (const id of hookIds) if (!next.h.has(id)) next.p.set(id, new Set([...(next.p.get(id) || []), k]));
  if (!next.f.has(k)) {
    for (const id of [...next.h]) {
      if (hookIds.includes(id)) continue;
      next.h.delete(id);
      next.p.set(id, new Set(next.f));
    }
    next.f.add(k);
  }
  promote(next);
  return next;
}

const forgetHooks = tracking => ({ ...copyTracking(tracking), h: new Set(), p: new Map() });

function encodeParts(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length || !parts.length; i += PART_BYTES) parts.push(toBase64(bytes.subarray(i, i + PART_BYTES)));
  return parts;
}

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

const partRow = (exportId, { sha, name, size }, send, n, parts, data) => ({
  [EXPORT_COL]: exportId, [TYPE_COL]: KIND.part, [SCHEMA_COL]: JSON.stringify({ sha, nom: name, taille: size, n, parts, envoi: send }), [LOT_COL]: data,
});

const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const validMeta = meta => Boolean(meta) && typeof meta === 'object' && is(SHA, meta.sha) && typeof meta.nom === 'string'
  && inRange(meta.taille, 0, FILE_MAX) && inRange(meta.parts, 1, MAX_PARTS) && inRange(meta.n, 0, meta.parts - 1) && is(SEND, meta.envoi);
const validChunk = text => typeof text === 'string' && text.length <= PART_TEXT_MAX && BASE64.test(text);

const safeName = name => name.replace(/[\\/\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '_').slice(0, 255) || 'fichier';

function readPart(row, exportId) {
  const meta = parseJson(row[SCHEMA_COL]);
  const encoded = row[LOT_COL];
  if (row[EXPORT_COL] !== exportId || row[TYPE_COL] !== KIND.part || !validMeta(meta) || !validChunk(encoded)) return null;
  return { sha: meta.sha, name: safeName(meta.nom), size: meta.taille, n: meta.n, parts: meta.parts, send: meta.envoi, data: encoded };
}

function fileArrivals(rows, exportId, now) {
  const ready = [];
  const stale = [];
  const rejected = [];
  const partial = [];
  const parts = [];
  for (const row of rows.filter(r => r[TYPE_COL] === KIND.part)) {
    const part = readPart(row, exportId);
    if (part) parts.push({ row, part });
    else rejected.push(row.id);
  }
  for (const list of groupBy(parts, p => p.part.sha).values()) {
    const last = list.reduce((a, b) => (b.row.id > a.row.id ? b : a)).part.send;
    for (const [send, items] of groupBy(list, p => p.part.send)) {
      const ids = items.map(p => p.row.id);
      const { sha, name, size, parts: count } = items[items.length - 1].part;
      const byN = new Map(items.filter(p => p.part.parts === count).map(p => [p.part.n, p.part.data]));
      const arrived = Math.max(...items.map(p => (typeof p.row[RECEIVED_COL] === 'number' ? p.row[RECEIVED_COL] : now)));
      const bytes = items.reduce((n, p) => n + Math.floor(p.part.data.length * 3 / 4), 0);
      if (send === last && byN.size === count) ready.push({ sha, name, size, data: Array.from({ length: count }, (_, n) => byN.get(n)), ids, old: now - arrived > PART_TTL, bytes });
      else if (send !== last || now - arrived > PART_TTL) stale.push(...ids);
      else partial.push({ ids, bytes });
    }
  }
  return { ready, stale, rejected, partial };
}

const PARKED_MAX = 2 * FILE_MAX;

function parkedOverflow(groups, max = PARKED_MAX) {
  let total = 0;
  return [...groups].sort((a, b) => Math.max(...b.ids) - Math.max(...a.ids)).filter(g => (total += g.bytes) > max);
}

function citedFiles(rows, waiting = []) {
  const cited = new Set(waiting);
  for (const row of expandRows(rows)) {
    for (const value of Object.values(row)) for (const file of fileList(value)) cited.add(short(file.sha));
  }
  return cited;
}

function joinParts(data) {
  const parts = data.map(text => Uint8Array.from(atob(text), c => c.charCodeAt(0)));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}

const sha1 = async bytes => toHex(await digest('SHA-1', bytes));

function fileList(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(value[0] === 'L' ? 1 : 0).filter(f => Array.isArray(f) && shaOf(f[0]))
    .map(f => ({ sha: shaOf(f[0]), name: safeName(String(f[1] ?? '')), size: Number(f[2]) || 0 }));
}

function resolveCell(value, present) {
  const ids = fileList(value).map(f => present.get(f.sha)).filter(Boolean);
  return ids.length ? ['L', ...ids] : null;
}

function resolveRows(rows, cols, present) {
  if (!cols.length) return rows;
  return rows.map((row) => {
    const here = cols.filter(c => Object.hasOwn(row, c));
    return here.length ? { ...row, ...Object.fromEntries(here.map(c => [c, resolveCell(row[c], present)])) } : row;
  });
}

function waitingVersions(rows, cols, present) {
  const waiting = new Map();
  if (!cols.length) return waiting;
  for (const row of rows) {
    const missing = cols.flatMap(c => fileList(row[c])).filter(f => !present.has(f.sha));
    if (missing.length) waiting.set(row.id, missing);
  }
  return waiting;
}

function filesState(rows, cols, present) {
  const waiting = new Set();
  const big = new Map();
  if (!cols.length) return { waiting: [], big: [] };
  for (const { row } of latestByKey(rows).values()) {
    if (isTrue(row[DELETE_COL])) continue;
    for (const file of cols.flatMap(c => fileList(row[c]))) {
      if (present.has(file.sha)) continue;
      if (file.size > FILE_MAX) big.set(file.sha, file);
      else waiting.add(file.sha);
    }
  }
  return { waiting: [...waiting], big: [...big.values()] };
}

const idsOf = v => (Array.isArray(v) ? v.slice(v[0] === 'L' ? 1 : 0) : []);
const sameIds = (a, b) => JSON.stringify(idsOf(a)) === JSON.stringify(idsOf(b));
function fillActions({ journalRows, destRows, copyCols, present, arrived, destTable }) {
  if (!arrived.size || !copyCols.length) return [];
  const latest = latestByKey(journalRows);
  const before = new Map([...present].filter(([sha]) => !arrived.has(short(sha))));
  const updates = new Map(); // colonne d'ici -> [[ligne, valeur]]
  for (const row of destRows) {
    const version = latest.get(row[KEY_COL]);
    if (!version || !isTrue(version.row[APPLIED_COL]) || isTrue(version.row[DELETE_COL])) continue;
    for (const [from, to] of copyCols) {
      const value = version.row[from];
      if (!fileList(value).some(f => arrived.has(short(f.sha)))) continue;
      const full = resolveCell(value, present);
      if (sameIds(row[to], resolveCell(value, before)) && !sameIds(row[to], full)) updates.set(to, [...(updates.get(to) || []), [row.id, full]]);
    }
  }
  return [...updates].flatMap(([to, list]) => chunk(list).map(part => ['BulkUpdateRecord', destTable, part.map(([id]) => id), { [to]: part.map(([, v]) => v) }]));
}
return { FILE_MAX, PART_BYTES, shaOf, short, neededFiles, HELD_MAX, readTracking, trackingNote, holdFiles, mergeHeld, fileSends, recordSent, forgetHooks, encodeParts, partRow, readPart, fileArrivals, PARKED_MAX, parkedOverflow, citedFiles, joinParts, sha1, fileList, resolveCell, resolveRows, waitingVersions, filesState, fillActions };
})();

// ===== js/engine/source/files.js =====
__M["js/engine/source/files.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, KIND, LOT_COL, TYPE_COL, groupBy, randomHex} = __M["js/engine/logic/common.js"];
const {hooksOf, ownJournal} = __M["js/engine/logic/exports.js"];
const {setFiles} = __M["js/engine/logic/notes.js"];
const {encodeParts, fileSends, forgetHooks, holdFiles, mergeHeld, neededFiles, partRow, readTracking, recordSent, trackingNote} = __M["js/engine/logic/files.js"];
const {downloadAttachment, fetchRows, postToHook, readSchema, selectRows} = __M["js/engine/port.js"];
const {exportHooks, readSourceNote, syncRows, updateSourceNote} = __M["js/engine/source/synchro.js"];

const pending = new Map(); // export -> envois de fichiers restants, pour la carte
const failed = new Map();
const FAIL_HOLD_MS = 600000;

const filesPending = exportId => pending.get(exportId) || 0;

async function fileRows() {
  const rows = await selectRows(__C.SYNC_TABLE, [EXPORT_COL, TYPE_COL, LOT_COL], { [TYPE_COL]: KIND.files });
  return rows || (await fetchRows(__C.SYNC_TABLE)).filter(r => r[TYPE_COL] === KIND.files);
}

const saveTracking = change => updateSourceNote(note => setFiles(note, change({ ...(note.fichiers || {}) })));
const saveTracked = (entries, only = true) => saveTracking(all => ({
  ...(only ? all : {}),
  ...Object.fromEntries(Object.entries(entries).map(([id, tracking]) => [id, trackingNote(mergeHeld(tracking, readTracking(all[id])))])),
}));

async function planFiles(hooks, conditions, ok) {
  const groups = groupBy(await fileRows(), r => r[EXPORT_COL]);
  const noted = readSourceNote(await readSchema()).fichiers || {};
  const recent = id => Date.now() - (failed.get(id) || 0) < FAIL_HOLD_MS;
  const plans = [...groups].map(([exportId, rows]) => {
    const mine = hooksOf(hooks, conditions, exportId);
    const active = mine.filter(h => ok(h) && !recent(h.id)).map(h => h.id);
    const needed = neededFiles(rows);
    return { exportId, needed, hooks: mine, ...fileSends(readTracking(noted[exportId]), needed, mine.map(h => h.id), active) };
  });
  pending.clear();
  for (const p of plans) pending.set(p.exportId, p.sends.reduce((n, s) => n + s.hooks.length, 0));
  const next = Object.fromEntries(plans.map(p => [p.exportId, trackingNote(p.tracking)]));
  if (JSON.stringify(next) !== JSON.stringify(noted)) await saveTracked(Object.fromEntries(plans.map(p => [p.exportId, p.tracking])), false);
  return plans.filter(p => p.sends.length);
}

async function sendFiles(plans, spend) {
  let done = 0;
  for (const plan of plans) {
    let { tracking } = plan;
    for (const { sha, hooks: ids, held = [] } of plan.sends) {
      const sent = ids.length ? await sendFile(plan, sha, ids, spend) : [];
      tracking = recordSent(tracking, sha, [...sent, ...held]);
      await saveTracked({ [plan.exportId]: tracking });
      pending.set(plan.exportId, Math.max(0, filesPending(plan.exportId) - ids.length));
      done += sent.length;
    }
  }
  return done;
}

async function sendFile(plan, sha, ids, spend) {
  await spend(0);
  const file = plan.needed.get(sha);
  const bytes = await downloadAttachment(file.id);
  const parts = encodeParts(bytes);
  const info = { sha, name: file.name, size: bytes.length };
  const send = randomHex(4);
  const rows = parts.map((part, n) => partRow(plan.exportId, info, send, n, parts.length, part));
  const size = parts.reduce((total, part) => total + part.length, 0);
  const sent = [];
  for (const h of plan.hooks.filter(x => ids.includes(x.id))) {
    try {
      for (const row of rows) await postToHook(h, [row]);
      sent.push(h.id);
    } catch (e) {
      failed.set(h.id, Date.now());
    }
    await spend(size);
  }
  return sent;
}

async function resendFiles(exportId) {
  const noted = readSourceNote(await readSchema()).fichiers || {};
  if (!noted[exportId]) return;
  await saveTracked({ [exportId]: forgetHooks(readTracking(noted[exportId])) });
}

const noted = new Map(); // journal -> empreintes déjà notées par cette page

async function noteHeldFiles(journal, note, cited) {
  const have = noted.get(journal) || new Set();
  const fresh = [...cited].filter(k => !have.has(k));
  if (!fresh.length || note.mode !== 'echange') return;
  try {
    if (!(await syncRows()).some(r => r[EXPORT_COL] === note.export && r[TYPE_COL] === KIND.files)) return;
    const hooks = note.retour && note.hook ? [{ id: note.hook }] : (await exportHooks(note.export)).filter(h => !note.retour || ownJournal(h)({ note }));
    if (!hooks.length) return;
    const ids = hooks.map(h => h.id);
    const held = tracking => trackingNote(holdFiles(tracking, ids, fresh));
    const was = readTracking((readSourceNote(await readSchema()).fichiers || {})[note.export]);
    if (JSON.stringify(held(was)) !== JSON.stringify(trackingNote(was))) {
      await saveTracking(all => ({ ...all, [note.export]: held(readTracking(all[note.export])) }));
    }
    noted.set(journal, new Set([...have, ...fresh]));
  } catch (e) {
  }
}
return { filesPending, planFiles, sendFiles, resendFiles, noteHeldFiles };
})();

// ===== js/engine/source/pausing.js =====
__M["js/engine/source/pausing.js"] = (() => {
'use strict';
const {ORDER_COL} = __M["js/engine/logic/common.js"];
const {autoPauseKind, conditionExport, exportTables, hookLabel} = __M["js/engine/logic/exports.js"];
const {setPause} = __M["js/engine/logic/notes.js"];
const {fetchRows, setWebhookEnabled} = __M["js/engine/port.js"];
const {recordEvent, syncRows, updateSourceNote} = __M["js/engine/source/synchro.js"];

async function pauseHook(exportId, tables, h, { auto = '' } = {}) {
  let at = 0;
  for (const { table } of tables) for (const r of await fetchRows(table).catch(() => [])) at = Math.max(at, r[ORDER_COL] || 0);
  await updateSourceNote(note => setPause(note, h.id, { hook: h.id, export: exportId, at, columns: JSON.stringify(tables), ...(auto ? { auto: true, why: auto } : {}) }));
  await setWebhookEnabled(h.id, false);
  await recordEvent(exportId, auto ? 'autopause' : 'pause', { who: hookLabel(h.fields.memo) });
}

const DEAD_MS = 60000;
const deadSince = new Map(); // webhook -> première fois vu mort
async function pauseDeadLinks(hooks, conditions, now = Date.now()) {
  let paused = 0;
  for (const h of hooks) {
    const kind = autoPauseKind(h, now);
    if (!kind) { deadSince.delete(h.id); continue; }
    if (!deadSince.has(h.id)) { deadSince.set(h.id, now); continue; }
    const exportId = conditionExport(conditions.get(h.id));
    if (now - deadSince.get(h.id) < DEAD_MS || !exportId) continue;
    await pauseHook(exportId, exportTables(await syncRows(), exportId), h, { auto: kind });
    deadSince.delete(h.id);
    paused++;
  }
  return paused;
}
return { pauseHook, DEAD_MS, pauseDeadLinks };
})();

// ===== js/engine/source/resend.js =====
__M["js/engine/source/resend.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, KIND, LIST_COL, LOT_COL, MISSING_COL, RESEND_ALL, RESEND_COL, STATE_COL, TABLE_COL, TYPE_COL, chunk, nowS, randomHex, sleep} = __M["js/engine/logic/common.js"];
const {hookStatus, swapExports, tooLarge} = __M["js/engine/logic/exports.js"];
const {ownsSync} = __M["js/engine/logic/strays.js"];
const {parseList, parseLot} = __M["js/engine/logic/journal.js"];
const {RESEND_CHUNK, addProg, addSpent, announceRest, budgetWait, chargeBusy, chunkCount, chunkMark, dueRows, eligibleRows, listRequest, lotCut, nextChunkSize, parseCharge, resendValue, rowsSince, startProg, trackState, trackedCounts} = __M["js/engine/logic/resend.js"];
const {exportFlow} = __M["js/engine/logic/health.js"];
const {rowDrops} = __M["js/engine/logic/notes.js"];
const {apply, clearWebhookQueue, fetchRows, listWebhooks, page, prefs, readSchema, selectRows, withLock} = __M["js/engine/port.js"];
const {chargeRow, isCharge, readHooks, readSourceNote, recordEvent, syncRows, watchRows, writeSync} = __M["js/engine/source/synchro.js"];
const {planFiles, sendFiles} = __M["js/engine/source/files.js"];
const {pauseDeadLinks} = __M["js/engine/source/pausing.js"];
const {noteError} = __M["js/engine/errors.js"];

const QUEUE_READS = 60;
const QUEUE_FIRST_MS = 500;
const QUEUE_MS = 1500;
const CATCHUP_MS = 10000;
const HIDDEN_MS = 60000;
const REPAIR_MS = 600000;
const BEAT_S = 20;
const WAIT_STEP_S = 30;

async function waitForQueue(hookIds) {
  for (let i = 0; i < QUEUE_READS; i++) {
    const hooks = (await listWebhooks()).filter(h => hookIds.includes(h.id));
    if (hooks.some(tooLarge)) throw new Error('tooLarge');
    if (!hooks.some(h => h.usage && h.usage.numWaiting)) return;
    await beat();
    await sleep(i < 3 ? QUEUE_FIRST_MS : QUEUE_MS);
  }
  throw new Error('queueStuck');
}

async function clearAndMark() {
  await clearWebhookQueue();
  const [rows, hooks] = await Promise.all([syncRows(), readHooks()]);
  const served = rows.filter(r => r[TYPE_COL] === KIND.lot && hooks.of(r[EXPORT_COL]).some(h => h.fields.enabled));
  await writeSync(served.map(r => r.id), { [MISSING_COL]: RESEND_ALL });
  for (const id of new Set(served.map(r => r[EXPORT_COL]))) await recordEvent(id, 'unblock');
}

const startOf = (lot, since) => (lot[MISSING_COL] > 0 ? Math.min(lot[MISSING_COL], since) : since);
const lotsOf = async (exportId, tables) => (await syncRows()).filter(r => r[EXPORT_COL] === exportId && tables.includes(r[TABLE_COL]) && r[TYPE_COL] === KIND.lot);

function resendTables(exportId, tables, progress, since = RESEND_ALL) {
  return withLock('gristsync-resend', async () => {
    try {
      return await withCharge(() => resendLocked(exportId, tables, progress, since), progress);
    } catch (e) {
      if (e.message !== 'resendBusy') throw e;
      for (const lot of await lotsOf(exportId, tables)) await writeSync([lot.id], { [MISSING_COL]: startOf(lot, since) });
      return null;
    }
  });
}

async function resendLocked(exportId, tables, progress, since, kind = 'resend') {
  const hookIds = (await readHooks()).of(exportId).filter(h => h.fields.enabled).map(h => h.id);
  if (!hookIds.length) return 0;
  const plans = await markLots(exportId, tables, since);
  const total = plans.reduce((n, p) => n + p.total, 0);
  charge.state = { ...charge.state, prog: startProg(exportId, total, plans.reduce((n, p) => n + chunkCount(p.rows.length), 0), nowS()) };
  let sentRows = 0;
  for (const plan of plans) {
    charge.state.prog.table = plan.table;
    sentRows += await sendRows(plan, hookIds, ({ rows, bytes }) => {
      charge.state = { ...charge.state, prog: addProg(charge.state.prog, { rows, bytes, now: nowS() }) };
      showProgress(progress);
    });
    if (!swapExports(await syncRows()).has(exportId)) await sendList(exportId, plan.table, hookIds);
  }
  charge.state = { ...charge.state, prog: null };
  if (progress) progress(null);
  if (sentRows) await recordEvent(exportId, kind, { n: sentRows });
  return sentRows;
}

function showProgress(progress) {
  if (!progress || !charge || !charge.state.prog) return;
  const prog = charge.state.prog;
  progress(exportFlow({ exportId: prog.exp, owed: 1, recipients: ['active'], charge: { ...charge.state, le: nowS() }, page: pageName(), now: nowS() }));
}

async function markLots(exportId, tables, since) {
  const schema = await readSchema();
  const plans = [];
  for (const lot of await lotsOf(exportId, tables)) {
    if (!schema.has(lot[TABLE_COL])) continue;
    const start = startOf(lot, since);
    await writeSync([lot.id], { [MISSING_COL]: start });
    const tableRows = await fetchRows(lot[TABLE_COL]);
    const rows = rowsSince(tableRows, start);
    const allEligible = eligibleRows(await syncRows(), exportId, lot[TABLE_COL]);
    const eligible = start <= RESEND_ALL ? allEligible : null;
    const ratio = allEligible !== null && tableRows.length ? allEligible / tableRows.length : 1;
    plans.push({ table: lot[TABLE_COL], lot: lot.id, start, rows, total: eligible ?? rows.length, ratio });
  }
  return plans;
}

async function sendRows({ lot, start, rows, ratio = 1 }, hookIds, onSent) {
  let size = RESEND_CHUNK;
  let sentRows = 0;
  const queue = rows.length ? chunk(rows, size) : [[]];
  while (queue.length) {
    const part = queue.shift();
    await waitForQueue(hookIds);
    const rest = announceRest(queue.reduce((n, p) => n + p.length, 0), ratio);
    await writeSync([lot], { [RESEND_COL]: resendValue(randomHex(4), part.map(r => r.id), rest), [MISSING_COL]: part.length ? chunkMark(part, start) : start });
    const cell = String(((await fetchRows(__C.SYNC_TABLE)).find(r => r.id === lot) || {})[LOT_COL] || '');
    const bytes = cell.length * hookIds.length;
    await spend(bytes);
    const sent = parseLot(cell);
    const cut = lotCut(sent) && part.length > 1;
    if (cut) {
      size = nextChunkSize(size, part.length, sent.lines.length);
      queue.unshift(...chunk(part, size));
    }
    const counted = cut || !sent ? 0 : sent.lines.length;
    sentRows += counted;
    onSent({ rows: counted, bytes });
  }
  await waitForQueue(hookIds);
  await writeSync([lot], { [MISSING_COL]: 0 });
  await writeSync([lot], { [RESEND_COL]: '' });
  return sentRows;
}

async function sendList(exportId, table, hookIds) {
  const mine = async kind => (await fetchRows(__C.SYNC_TABLE)).find(r => r[EXPORT_COL] === exportId && r[TABLE_COL] === table && r[TYPE_COL] === kind);
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

let catching = false;
let notOwner = false;
let repairedAt = 0;
let caughtAt = 0;
const lastPass = { at: 0, why: '' };
const catchState = () => ({ at: lastPass.at, why: lastPass.why, running: catching });

async function catchUp(onDone = () => {}) {
  if (catching || notOwner) return;
  catching = true;
  caughtAt = Date.now();
  lastPass.at = caughtAt;
  try {
    const sent = await withLock('gristsync-resend', catchUpLocked);
    if (sent || shrunk) {
      shrunk = false;
      await onDone();
    }
  } catch (e) {
    if (e.message === 'ownerOnly') notOwner = true;
    else if (e.message === 'resendBusy') lastPass.why = 'busy';
    else {
      console.warn(e);
      noteError(e);
    }
  } finally {
    catching = false;
  }
}

function startAutoCatchUp(onDone) {
  prefs.write('browser', browser());
  page.onLeave(() => {
    if (charge) apply([['UpdateRecord', __C.SYNC_TABLE, charge.id, { [RESEND_COL]: JSON.stringify({ ...charge.state, par: '', reprise: 0 }) }]]).catch(() => {});
  });
  setInterval(() => {
    if (page.visible() || Date.now() - caughtAt > HIDDEN_MS) catchUp(onDone);
  }, CATCHUP_MS);
}

async function catchUpLocked() {
  let rows = await lightRows();
  if (!rows) {
    lastPass.why = 'nosync';
    return 0;
  }
  let { hooks, conditions, of: recipients } = await readHooks();
  if (await pauseDeadLinks(hooks, conditions)) ({ hooks, conditions, of: recipients } = await readHooks());
  await watchShrink(recipients).catch(console.warn);
  if (hooks.some(tooLarge) && Date.now() - repairedAt > REPAIR_MS) {
    repairedAt = Date.now();
    await clearAndMark();
    rows = await lightRows();
  }
  if (hooks.some(h => h.fields.enabled && !tooLarge(h) && hookStatus(h)[0] === 'error')) {
    lastPass.why = 'blocked';
    return 0;
  }
  const { late, lists } = dueRows(rows);
  const files = rows.some(r => r[TYPE_COL] === KIND.files) ? await planFiles(hooks, conditions, h => h.fields.enabled && hookStatus(h)[0] !== 'error') : [];
  lastPass.why = 'idle';
  if (!late.length && !lists.length && !files.length) return 0;
  const active = row => recipients(row[EXPORT_COL]).filter(h => h.fields.enabled).map(h => h.id);
  let sent = 0;
  await withCharge(async () => {
    for (const row of late) {
      if (!recipients(row[EXPORT_COL]).length) await writeSync([row.id], { [MISSING_COL]: 0 });
      else if (active(row).length) await resendLocked(row[EXPORT_COL], [row[TABLE_COL]], null, row[MISSING_COL], 'catchup');
    }
    for (const row of lists) {
      if (!recipients(row[EXPORT_COL]).length) await writeSync([row.id], { [RESEND_COL]: row[TYPE_COL] === KIND.keys ? '' : trackState(row).trop });
      else if (active(row).length) await sendList(row[EXPORT_COL], row[TABLE_COL], active(row));
    }
    sent = await sendFiles(files, spend);
  });
  lastPass.why = 'sent';
  return late.length + lists.length + sent + files.length;
}

const WATCH_MS = 30000;
let watched = ''; // derniers comptes traités (JSON)
let watchedAt = 0;
let lastCounts = {}; // comptes du passage précédent : une baisse d'un passage à l'autre passe sans attendre WATCH_MS
let shrunk = false;
async function watchShrink(recipients) {
  const rows = await selectRows(__C.SYNC_TABLE, [EXPORT_COL, TABLE_COL, TYPE_COL, LIST_COL], { [TYPE_COL]: KIND.track });
  if (!rows) return;
  const counts = trackedCounts(rows);
  const seen = JSON.stringify(counts);
  const falling = Object.entries(counts).some(([id, tables]) => rowDrops(lastCounts[id] || {}, tables).length);
  lastCounts = counts;
  if (seen === watched || (!falling && Date.now() - watchedAt < WATCH_MS)) return;
  watched = seen;
  watchedAt = Date.now();
  const note = readSourceNote(await readSchema());
  if (await watchRows(note, counts, id => recipients(id).length)) shrunk = true;
}

let noSyncAt = 0;
async function lightRows() {
  if (Date.now() - noSyncAt < HIDDEN_MS) return null;
  const rows = await selectRows(__C.SYNC_TABLE, [EXPORT_COL, TABLE_COL, TYPE_COL, RESEND_COL, STATE_COL]);
  if (rows) return rows.filter(r => !isCharge(r));
  if (ownsSync(await readSchema())) return syncRows();
  noSyncAt = Date.now();
  return null;
}

let browserId = null;
let pageId = null;
const browser = () => (browserId ||= prefs.read('browser') || randomHex(4));
const pageName = () => (pageId ||= `${browser()}.${randomHex(4)}`);
let charge = null; // { id, state, saved, progress } pendant un renvoi de cette page

async function readCharge() {
  const rows = await selectRows(__C.SYNC_TABLE, [TYPE_COL, RESEND_COL]);
  return (rows && rows.find(isCharge)) || chargeRow();
}

async function withCharge(fn, progress = null) {
  const row = await readCharge();
  const state = parseCharge(row[RESEND_COL]);
  if (chargeBusy(state, pageName(), nowS())) throw new Error('resendBusy');
  charge = { id: row.id, state: { ...state, par: pageName(), reprise: 0, prog: null }, saved: 0, progress };
  await saveCharge();
  try {
    const result = await fn();
    charge.state = { ...charge.state, prog: null };
    return result;
  } finally {
    charge.state = { ...charge.state, par: '', reprise: 0 };
    await saveCharge().catch(() => {});
    charge = null;
  }
}

async function saveCharge() {
  const current = parseCharge((await readCharge())[RESEND_COL]);
  if (charge.state.par && chargeBusy(current, pageName(), nowS())) throw new Error('resendBusy');
  if (!charge.state.par && current.par && current.par !== pageName()) return;
  charge.state.le = nowS();
  charge.saved = nowS();
  await writeSync([charge.id], { [RESEND_COL]: JSON.stringify(charge.state) });
}

async function beat() {
  if (charge && nowS() - charge.saved > BEAT_S) await saveCharge();
}

async function spend(bytes) {
  charge.state = addSpent(charge.state, nowS(), bytes);
  const wait = budgetWait(charge.state, nowS());
  if (wait > 0) {
    charge.state.reprise = nowS() + wait;
    await saveCharge();
    showProgress(charge.progress);
    while (nowS() < charge.state.reprise) {
      await sleep(Math.min(WAIT_STEP_S, charge.state.reprise - nowS()) * 1000);
      await saveCharge();
    }
    charge.state.reprise = 0;
  }
  await beat();
}

async function currentCharge() {
  if (charge) return { ...charge.state, le: nowS() };
  return parseCharge((await readCharge())[RESEND_COL]);
}

function flowOf(exp, state) {
  return exportFlow({
    exportId: exp.id, owed: exp.owed, recipients: exp.recipients.map(h => hookStatus(h)[0]), charge: state, page: pageName(), now: nowS(), lastPass,
  });
}
return { clearAndMark, resendTables, catchState, catchUp, startAutoCatchUp, currentCharge, flowOf };
})();

// ===== js/engine/logic/consolidation.js =====
__M["js/engine/logic/consolidation.js"] = (() => {
'use strict';
const {APPLIED_COL, ARCHIVE_COL, AUTHOR_COL, BEFORE_COL, DATA_COL, DELETE_COL, EXPORT_COL, KEY_COL, LIST_COL, LOT_COL, ORDER_COL, RECALC_COL, RECEIVED_COL, RESEND_COL, SCHEMA_COL, STATE_COL, TABLE_COL, TYPE_COL, BUCKETS, bucketOf, chunk, freeTableId, groupBy, isBlank, isTrue, parseJson} = __M["js/engine/logic/common.js"];
const {REFUSED, STATES, compareOrder, completeLists, destColumns, lastMark, latestByKey, pendingLists, sentColumns} = __M["js/engine/logic/journal.js"];
const {exchangeColumns} = __M["js/engine/logic/exports.js"];
const {noteSent, sentElements} = __M["js/engine/logic/descriptions.js"];

const RULES = ['accepter', 'refuser', 'valider'];
const REFUSALS = ['corriger', 'signaler'];
function exchangeRules(exp) {
  const { regles = {}, refus } = exp || {};
  const rule = state => (RULES.includes(regles[state]) ? regles[state] : RULES[0]);
  const rules = Object.fromEntries(STATES.map(state => [state, rule(state)]));
  if (STATES.every(state => rules[state] === RULES[0])) return null;
  return { ...rules, refus: REFUSALS.includes(refus) ? refus : REFUSALS[0] };
}

const TECHNICAL = new Set(['id', 'manualSort', KEY_COL, ORDER_COL, RECALC_COL, DELETE_COL, LIST_COL, APPLIED_COL, AUTHOR_COL, RECEIVED_COL, STATE_COL,
  BEFORE_COL, DATA_COL, SCHEMA_COL, EXPORT_COL, TABLE_COL, TYPE_COL, RESEND_COL, LOT_COL]);
function copyColumns(journalColIds, destCols, map = {}) {
  const writable = new Set(destCols.filter(c => !c.isFormula).map(c => c.colId));
  return journalColIds.filter(id => !TECHNICAL.has(id) && !id.startsWith('gristHelper_'))
    .map(id => [id, map[id] || id]).filter(([, to]) => writable.has(to) && to !== KEY_COL);
}

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

function droppedColumns(entry, sent, destColIds) {
  const have = new Set(destColIds);
  const noted = new Set([...Object.keys((entry.refs || {}).cols || {}), ...(entry.dropped || [])]);
  return destColumns(sent)
    .map(c => [c.id, (entry.map || {})[c.id] || c.id]).filter(([, to]) => !have.has(to) && noted.has(to));
}

function destRefs(schema, dest) {
  const table = schema.table(dest);
  return table ? { table: table.id, cols: Object.fromEntries(schema.columns(dest).map(c => [c.colId, c.id])) } : undefined;
}

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

const knownColumns = ({ columns = [], map = {} }) => new Set([...columns.map(c => c.id), ...Object.keys(map)]);

function freshColumns(entry, sent, destColIds) {
  const known = knownColumns(entry);
  const fresh = known.size ? destColumns(sent).filter(c => !known.has(c.id)) : [];
  const names = fresh.length ? newColumnsMap(entry, fresh, destColIds) : {};
  return fresh.map(c => ({ id: c.id, to: names[c.id], label: c.label || c.id, type: c.type }));
}

const ADDED_KEPT = 10;
function addedColumns({ columns = [], map = {}, addedCols = [] }, next, at) {
  const known = new Set([...columns.map(c => c.id), ...Object.keys(map)]);
  const fresh = Object.keys(next).filter(id => !known.has(id));
  if (!known.size || !fresh.length) return addedCols.length ? addedCols : undefined;
  return [...addedCols, ...fresh.map(id => ({ col: next[id], at }))].slice(-ADDED_KEPT);
}

function sameValue(sent, have) {
  const norm = x => (isBlank(x) ? null : Array.isArray(x) && x[0] === 'L' ? x.slice(1) : x);
  const [a, b] = [norm(sent), norm(have)];
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'number') return a === String(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function rowNumbers(destRows) {
  const rank = r => (typeof r.manualSort === 'number' ? r.manualSort : r.id);
  const sorted = [...destRows].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const numbers = new Map();
  sorted.forEach((r, i) => { if (!isBlank(r[KEY_COL]) && !numbers.has(r[KEY_COL])) numbers.set(r[KEY_COL], i + 1); });
  return numbers;
}

function noteReplaced(plan, copyCols, version, destRow) {
  const cells = copyCols.filter(([from, to]) => !sameValue(version.row[from], destRow[to]));
  if (cells.length) plan.before.set(version.id, { v: Object.fromEntries(cells.map(([from, to]) => [from, destRow[to] ?? null])) });
}

const LEFT = 'partie';
const SETTLED_GONE = new Set(['suppression', LEFT]);

function manualEdits({ journalRows, destRows, copyCols, exchange = false, except = new Set() }) {
  if (exchange) return [];
  const latest = latestByKey(journalRows);
  const numbers = rowNumbers(destRows);
  const edits = [];
  for (const row of destRows) {
    const version = latest.get(row[KEY_COL]);
    if (!version || isTrue(version.row[DELETE_COL]) || version.row[STATE_COL] === 'suppression') continue;
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

function indexDest(destRows, matchCol) {
  const keyed = destRows.filter(r => !isBlank(r[KEY_COL]));
  const unkeyed = matchCol ? destRows.filter(r => isBlank(r[KEY_COL]) && !isBlank(r[matchCol])) : [];
  return { byKey: groupBy(keyed, r => r[KEY_COL]), unkeyed: groupBy(unkeyed, r => r[matchCol]) };
}

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

const deleteDiffers = (ctx, version, row) => ctx.exchange && ctx.deleteCol && isTrue(version.row[DELETE_COL]) !== isTrue(row[DELETE_COL]);
function withoutEffect(ctx, version, here) {
  const before = ctx.exchange ? null : ctx.applied.get(version.row[KEY_COL]);
  if (before && ctx.copyCols.every(([from]) => sameValue(version.row[from], before.row[from]))) return true;
  return here.every(row => ctx.copyCols.every(([from, to]) => sameValue(version.row[from], row[to])) && !deleteDiffers(ctx, version, row));
}

function versionEffect(ctx, key, version, gone) {
  const here = ctx.dest.byKey.get(key);
  if (ctx.exchange && here && compareOrder(version.order, newest(here)) <= 0) return '';
  if (isTrue(version.row[DELETE_COL]) || gone.has(key)) return deletionEffect(ctx, version, here);
  if (ctx.archived.has(key)) return 'modif'; // ligne gardée en archive, revenue à la SOURCE
  if (!here) return ctx.matchFrom && ctx.dest.unkeyed.get(version.row[ctx.matchFrom])?.length ? 'modif' : 'ajout';
  return withoutEffect(ctx, version, here) ? '' : 'modif';
}

function deletionEffect(ctx, version, here) {
  if (!here) return LEFT;
  return ctx.hub && withoutEffect(ctx, version, here) ? '' : 'suppression';
}

function writeEffect(ctx, plan, key, version, state) {
  const here = ctx.dest.byKey.get(key);
  if (isTrue(version.row[DELETE_COL]) && !ctx.hub && (state === 'suppression' || state === LEFT)) plan.gone.add(key);
  if (!state || state === LEFT || plan.gone.has(key)) return state;
  const candidates = !here && ctx.matchFrom ? ctx.dest.unkeyed.get(version.row[ctx.matchFrom]) : null;
  if (candidates && candidates.length) {
    const row = candidates.shift();
    plan.attached.push([row, version]);
    noteReplaced(plan, ctx.copyCols, version, row);
    return 'modif';
  }
  plan.upserts.push(version);
  if (here) noteReplaced(plan, ctx.copyCols, version, here[0]);
  return state === 'suppression' || here ? state : 'ajout';
}

function refuseEffect(ctx, plan, key, version, state) {
  const here = ctx.dest.byKey.get(key);
  if (here) noteReplaced(plan, ctx.copyCols, version, here[0]);
  plan.before.set(version.id, { ...(plan.before.get(version.id) || {}), k: state });
  if (ctx.rules.refus === 'corriger') plan.fixes.push({ key, version, here });
}

function reviewItem(ctx, key, version, state) {
  const here = (ctx.dest.byKey.get(key) || [])[0] || null;
  const cells = ctx.copyCols.map(([from, to]) => [from, to, here ? here[to] ?? null : null, state === 'suppression' ? null : version.row[from] ?? null])
    .filter(([from, to]) => state !== 'modif' || !here || !sameValue(version.row[from], here[to]));
  if (state === 'modif' && here && deleteDiffers(ctx, version, here)) cells.push([DELETE_COL, DELETE_COL, isTrue(here[DELETE_COL]), isTrue(version.row[DELETE_COL])]);
  return { id: version.id, key, state, row: version.row, cells };
}

function consolidationActions({ destTable, journalTable, copyCols, exchange, deleteCol, archive, uncheck }, { upserts, attached, removeIds, marks, listGone, leftGone, before }) {
  const values = (versions) => {
    const out = Object.fromEntries(copyCols.map(([from, to]) => [to, versions.map(v => v.row[from] ?? null)]));
    if (exchange && deleteCol) out[DELETE_COL] = versions.map(v => isTrue(v.row[DELETE_COL]));
    if (uncheck && !Object.hasOwn(out, ARCHIVE_COL)) out[ARCHIVE_COL] = versions.map(() => false);
    return exchange ? { ...out, [ORDER_COL]: versions.map(v => v.order ?? null) } : out;
  };
  return [
    ...chunk(upserts).map(part => ['BulkAddOrUpdateRecord', destTable, { [KEY_COL]: part.map(v => v.row[KEY_COL]) }, values(part), { on_many: 'all' }]),
    ...chunk(attached).map(part => ['BulkUpdateRecord', destTable, part.map(([row]) => row.id),
      { [KEY_COL]: part.map(([, v]) => v.row[KEY_COL]), ...values(part.map(([, v]) => v)) }]),
    ...chunk(removeIds).map(part => (archive ? ['BulkUpdateRecord', destTable, part, { [ARCHIVE_COL]: part.map(() => true) }] : ['BulkRemoveRecord', destTable, part])),
    ...chunk([...marks]).map(part => ['BulkUpdateRecord', journalTable, part.map(([id]) => id),
      { [APPLIED_COL]: part.map(() => true), [STATE_COL]: part.map(([, state]) => state) }]),
    ...chunk(listGone).map(part => ['BulkUpdateRecord', journalTable, part.map(([id]) => id),
      { [STATE_COL]: part.map(() => 'suppression'), [RECEIVED_COL]: part.map(([, at]) => at) }]),
    ...chunk(leftGone).map(part => ['BulkUpdateRecord', journalTable, part, { [STATE_COL]: part.map(() => LEFT) }]),
    ...chunk([...before]).map(part => ['BulkUpdateRecord', journalTable, part.map(([id]) => id),
      { [BEFORE_COL]: part.map(([, was]) => JSON.stringify(was)) }]),
  ];
}

const FIX_STEP = 0.001;
function fixActions(destTable, fixes, copyCols, deleteCol, now) {
  const order = f => (typeof f.version.order === 'number' ? f.version.order : now) + FIX_STEP;
  const kept = fixes.filter(f => f.here).flatMap(f => f.here.map(row => [row.id, order(f)]));
  const added = deleteCol ? fixes.filter(f => !f.here) : [];
  return [
    ...chunk(kept).map(part => ['BulkUpdateRecord', destTable, part.map(([id]) => id), { [ORDER_COL]: part.map(([, at]) => at) }]),
    ...chunk(added).map(part => ['BulkAddOrUpdateRecord', destTable, { [KEY_COL]: part.map(f => f.key) }, {
      ...Object.fromEntries(copyCols.map(([from, to]) => [to, part.map(f => f.version.row[from] ?? null)])),
      [DELETE_COL]: part.map(() => true), [ORDER_COL]: part.map(order),
    }, { on_many: 'all' }]),
  ];
}

function refusedGaps({ journalRows, destRows, copyCols }) {
  const dest = groupBy(destRows.filter(r => !isBlank(r[KEY_COL])), r => r[KEY_COL]);
  const numbers = rowNumbers(destRows);
  const gaps = [];
  for (const [key, version] of latestByKey(journalRows)) {
    const here = dest.get(key);
    if (version.row[STATE_COL] !== REFUSED || (here && compareOrder(newest(here), version.order) > 0)) continue;
    const row = (here || [])[0];
    const cells = copyCols.map(([from, to]) => [from, to, row ? row[to] ?? null : null, version.row[from] ?? null])
      .filter(([from, to]) => !row || !sameValue(version.row[from], row[to]));
    const { k } = parseJson(version.row[BEFORE_COL]) || {};
    gaps.push({ key, n: numbers.get(key) || null, state: STATES.includes(k) ? k : row ? 'modif' : 'ajout', row: version.row, cells });
  }
  return gaps.sort((a, b) => (a.n || Infinity) - (b.n || Infinity));
}

function planConsolidation({
  journalRows, destRows, copyCols, destTable, journalTable, matchCol = '', exchange = false, hub = false, deleteCol = false, rules = null, decisions = new Map(),
  now = 0, archive = false, waiting = new Map(),
}) {
  const dest = indexDest(destRows, matchCol);
  const latest = latestByKey(journalRows);
  const marks = new Map(); // ligne du journal -> effet ('' pour une liste ou une version sans effet)
  const pending = pendingLists(journalRows);
  const archived = exchange ? new Set() : new Set(destRows.filter(r => isTrue(r[ARCHIVE_COL]) && !isBlank(r[KEY_COL])).map(r => r[KEY_COL]));
  const followed = archived.size ? new Map([...dest.byKey].filter(([key]) => !archived.has(key))) : dest.byKey;
  const { gone, listGone, leftGone } = exchange ? { gone: new Set(), listGone: [], leftGone: [] } : droppedKeys(pending, latest, followed, marks);
  if (exchange) pending.forEach(({ row }) => marks.set(row.id, ''));
  const ctx = { ...consolidationContext({ journalRows, copyCols, matchCol, exchange, hub, deleteCol, rules }, dest), archived, waiting: exchange ? waiting : new Map() };
  const plan = { gone, marks, upserts: [], attached: [], before: new Map(), fixes: [], pending: [], waiting: [], stats: { added: 0, updated: 0, removed: 0 } };
  planVersions(ctx, plan, latest, decisions);
  const { removed, numbers } = planRemovals({ plan, dest, destRows, archived });
  plan.stats.removed += removed.length;
  const removeIds = removed.flatMap(key => dest.byKey.get(key).map(r => r.id));
  for (const key of removed) if (latest.has(key)) plan.before.set(latest.get(key).id, { n: numbers.get(key) });
  return {
    actions: [
      ...consolidationActions({ destTable, journalTable, copyCols, exchange, deleteCol: ctx.deleteCol, archive: archive && !exchange, uncheck: archived.size > 0 || (archive && !exchange) }, { ...plan, removeIds, listGone, leftGone }),
    ],
    stats: plan.stats, gone, attached: plan.attached,
    pending: plan.pending.map(item => ({ ...item, n: numbers.get(item.key) || null })),
    waiting: plan.waiting.map(item => ({ ...item, n: numbers.get(item.key) || null })),
    fix: { actions: fixActions(destTable, plan.fixes, copyCols, ctx.deleteCol, now), keys: plan.fixes.map(f => f.key) },
  };
}

function consolidationContext({ journalRows, copyCols, matchCol, exchange, hub, deleteCol, rules }, dest) {
  return {
    dest, copyCols, exchange, hub: exchange && hub, deleteCol: exchange && (deleteCol || hub), rules: exchange ? rules : null,
    matchFrom: copyCols.find(([, to]) => to === matchCol)?.[0],
    applied: latestByKey(journalRows.filter(r => isTrue(r[APPLIED_COL]) && !isTrue(r[DELETE_COL]))),
  };
}

const STATS = { ajout: 'added', modif: 'updated' };
const WRITES = new Set(['ajout', 'modif']);
function planVersions(ctx, plan, latest, decisions) {
  for (const [key, version] of latest) {
    if (isTrue(version.row[APPLIED_COL])) continue;
    const state = versionEffect(ctx, key, version, plan.gone);
    const rule = ctx.rules && STATES.includes(state) ? decisions.get(version.id) || ctx.rules[state] : RULES[0];
    if (rule === 'refuser') {
      refuseEffect(ctx, plan, key, version, state);
      plan.marks.set(version.id, REFUSED);
    } else if (ctx.waiting.has(version.id) && WRITES.has(state)) {
      plan.waiting.push({ id: version.id, key, files: ctx.waiting.get(version.id) });
    } else if (rule === 'valider') {
      plan.pending.push(reviewItem(ctx, key, version, state));
    } else {
      const written = writeEffect(ctx, plan, key, version, state);
      plan.marks.set(version.id, written);
      const stat = written === 'suppression' && ctx.hub ? 'removed' : STATS[written];
      if (stat) plan.stats[stat]++;
    }
  }
}

function planRemovals({ plan, dest, destRows, archived }) {
  const removed = [...plan.gone].filter(key => dest.byKey.has(key) && !archived.has(key));
  const numbers = removed.length || plan.pending.length || plan.waiting.length ? rowNumbers(destRows) : new Map();
  return { removed, numbers };
}

function receivedColumns(entry, tableRows, schema, allowed, now, { hold = false } = {}) {
  let sent = sentColumns(tableRows, entry.columns || []);
  const doc = (sent.find(c => c.doc) || {}).doc; // langue et monnaie du document de la SOURCE, si elle les envoie
  const sends = sentElements(sent); // ce que l'export envoie en plus des données (voir descriptions.js)
  const { tableNote } = noteSent(sent);
  let next = entry;
  if (allowed) {
    const kept = exchangeColumns(sent, allowed, entry.map);
    sent = kept.sent;
    next = { ...entry, map: kept.map };
  }
  const all = sent;
  const destIds = schema.columns(next.dest).map(c => c.colId);
  const held = hold && !allowed ? freshColumns(next, sent, destIds) : [];
  if (held.length) sent = sent.filter(c => !held.some(h => h.id === c.id));
  const map = newColumnsMap(next, destColumns(sent), destIds);
  return { sent, all, held, doc, sends, tableNote, entry: map ? { ...next, map, addedCols: addedColumns(next, map, now) } : next };
}
return { RULES, REFUSALS, exchangeRules, copyColumns, followRenames, droppedColumns, destRefs, newColumnsMap, freshColumns, addedColumns, sameValue, rowNumbers, manualEdits, restoreActions, refusedGaps, planConsolidation, receivedColumns };
})();

// ===== js/engine/logic/tally.js =====
__M["js/engine/logic/tally.js"] = (() => {
'use strict';
const {DELETE_COL, STATE_COL, isTrue} = __M["js/engine/logic/common.js"];
const {latestByKey} = __M["js/engine/logic/journal.js"];

const TALLY_GRACE_S = 600;

function nextTally(was = {}, announced = {}, tables = null, max = 200) {
  const next = { ...was };
  for (const [table, a] of Object.entries(announced)) {
    if (!next[table] || a.t >= next[table].t) next[table] = a;
  }
  const kept = Object.entries(next).filter(([table]) => !tables || tables.includes(table));
  return Object.fromEntries(kept.slice(-max));
}

const GONE = new Set(['suppression', 'partie']);
function liveKeys(tableRows) {
  let n = 0;
  for (const { row } of latestByKey(tableRows).values()) {
    if (isTrue(row[DELETE_COL]) || !GONE.has(row[STATE_COL])) n++;
  }
  return n;
}

function tallyGap(announce, tableRows, explained = false) {
  if (!announce || explained) return null;
  const got = liveKeys(tableRows);
  return got < announce.n ? { expected: announce.n, got, gap: announce.n - got } : null;
}

function tallyDue(seen, key, gap, now, grace = TALLY_GRACE_S) {
  if (!gap) {
    seen.delete(key);
    return false;
  }
  const sign = `${gap.expected}:${gap.got}`;
  const was = seen.get(key);
  if (!was || was.sign !== sign) {
    seen.set(key, { sign, since: now });
    return false;
  }
  return now - was.since >= grace;
}
return { TALLY_GRACE_S, nextTally, liveKeys, tallyGap, tallyDue };
})();

// ===== js/engine/logic/links.js =====
__M["js/engine/logic/links.js"] = (() => {
'use strict';
const {APPLIED_COL, DELETE_COL, KEY_COL, LINK_PREFIX, chunk, isBlank, isTrue} = __M["js/engine/logic/common.js"];
const {latestByKey} = __M["js/engine/logic/journal.js"];

const linkKey = id => `${LINK_PREFIX}${id}`;
const REF = /^(Ref|RefList):(\w+)$/;

const refOf = (c) => {
  const found = REF.exec((c && c.source) || '');
  return found ? { list: found[1] === 'RefList', target: found[2] } : null;
};

const refKey = (table, id) => `${table}.${id}`;

const aim = (tables, c, lists = true) => {
  const ref = refOf(c);
  const there = ref && (lists || !ref.list) && tables.find(tb => tb.table === ref.target);
  return there && c.visible && there.columns.some(x => x.id === c.visible) ? ref.target : '';
};

const linkTables = (tables, on) => {
  const keys = on && on !== true ? new Set(on) : null;
  const kept = (table, c) => (on === true ? aim(tables, c, false) : keys && keys.has(refKey(table, c.id)) ? aim(tables, c) : '');
  return tables.map(tb => ({
    ...tb,
    columns: tb.columns.map(({ link, list, ...c }) => (kept(tb.table, c) ? { ...c, link: kept(tb.table, c), ...(refOf(c).list ? { list: true } : {}) } : c)),
  }));
};

function linkOffers({ chosen, columnsOf, picked, choices = new Map(), saved = null }) {
  const pulled = new Map();
  const ticked = (table) => {
    const own = chosen.includes(table) ? new Set(picked(table) || []) : new Set([...(pulled.get(table) || []), ...(picked(table) || [])]);
    return own;
  };
  const rowsOf = (table) => {
    const have = ticked(table);
    return columnsOf(table).filter(c => have.has(c.id) && refOf(c)).map((c) => {
      const { target, list } = refOf(c);
      const key = refKey(table, c.id);
      const there = columnsOf(target) || [];
      const inside = chosen.includes(target);
      const shownThere = c.visible && there.some(x => x.id === c.visible);
      const hidden = shownThere && chosen.includes(target) && !ticked(target).has(c.visible);
      const ok = Boolean(shownThere) && !hidden;
      const why = ok ? '' : shownThere ? 'hidden' : 'numbers';
      const wanted = choices.has(key) ? choices.get(key) : saved && saved.has(key) ? saved.get(key) : chosen.includes(target);
      return { key, table, id: c.id, label: c.label || c.id, list, target, shown: c.visible || '', inside, ok, why, link: Boolean(wanted) && ok };
    });
  };
  let rows = [];
  for (let pass = 0; pass <= 50; pass++) {
    rows = [...chosen, ...pulled.keys()].flatMap(rowsOf);
    let grown = false;
    for (const r of rows) {
      if (!r.link || chosen.includes(r.target)) continue;
      const need = pulled.get(r.target) || new Set();
      if (!pulled.has(r.target) || !need.has(r.shown)) grown = true;
      pulled.set(r.target, new Set([...need, r.shown]));
    }
    if (!grown) break;
  }
  return { rows, pulled: new Map([...pulled].map(([table, set]) => [table, [...set]])) };
}

const columnFor = (schema, entry, id) => {
  const to = (entry.map || {})[id] || id;
  return { to, column: schema.columns(entry.dest).find(x => x.colId === to) };
};
function linkSpec(schema, entry, c, aim) {
  const { to, column } = columnFor(schema, entry, c.id);
  const shownId = (aim.map || {})[c.visible] || c.visible;
  const shown = c.visible && (schema.columns(aim.dest).find(x => x.colId === shownId) || {}).id;
  return column && shown ? { from: c.id, to, ref: column.id, type: column.type, target: aim.dest, shownId, shown, list: c.list === true } : null;
}

function planLinks(schema, entry, sent, dests, { relink = false } = {}) {
  if (!schema.has(entry.dest)) return { ready: [], todo: [], undo: [], text: [] };
  const decided = new Set(entry.linked || []);
  const own = new Set(entry.own || []);
  const specs = sent.filter(c => c.link && dests.has(c.link) && schema.has(dests.get(c.link).dest))
    .map(c => linkSpec(schema, entry, c, dests.get(c.link))).filter(Boolean);
  const received = new Set([...dests.values()].map(d => d.dest));
  const undo = sent.filter(c => !c.link && own.has(c.id) && decided.has(c.id)).map((c) => {
    const { to, column } = columnFor(schema, entry, c.id);
    return column && /^Ref(List)?:/.test(column.type) && received.has(column.type.replace(/^Ref(List)?:/, '')) ? { from: c.id, to } : null;
  }).filter(Boolean);
  const text = specs.filter(s => s.type === 'Text' && own.has(s.from) && decided.has(s.from));
  return {
    ready: specs.filter(s => s.type === refType(s)),
    todo: specs.filter(s => s.type === 'Text' && own.has(s.from) && (relink || !decided.has(s.from))),
    undo,
    text: relink ? [] : text,
  };
}

const refType = spec => `${spec.list ? 'RefList' : 'Ref'}:${spec.target}`;

const linkActions = (table, spec) => [
  ['ModifyColumn', table, spec.to, { type: refType(spec) }],
  ['UpdateRecord', '_grist_Tables_column', spec.ref, { visibleCol: spec.shown }],
  ['SetDisplayFormula', table, null, spec.ref, `$${spec.to}.${spec.shownId}`],
];

const unlinkActions = (table, specs) => specs.map(spec => ['ModifyColumn', table, spec.to, { type: 'Text' }]);

function textFill({ journalRows, destRows, specs, destTable }) {
  if (!specs.length) return [];
  const latest = latestByKey(journalRows);
  return specs.flatMap((s) => {
    const cells = destRows.map(row => [row.id, latest.get(row[KEY_COL])]).filter(([, v]) => v && Object.hasOwn(v.row, s.from));
    return chunk(cells).map(part => ['BulkUpdateRecord', destTable, part.map(([id]) => id), { [s.to]: part.map(([, v]) => v.row[s.from] ?? '') }]);
  });
}

function decideLinks(todo, empty, { all = false } = {}) {
  return { convert: all ? todo : todo.filter(spec => empty(spec.to)), decided: todo.map(spec => spec.from) };
}

function keyIds(rows) {
  const ids = new Map();
  for (const r of rows) if (!isBlank(r[KEY_COL]) && !ids.has(r[KEY_COL])) ids.set(r[KEY_COL], r.id);
  return ids;
}

const targetRows = rows => ({ keys: keyIds(rows), live: new Set(rows.map(r => r.id)) });

const keysOf = value => (Array.isArray(value) ? value.slice(value[0] === 'L' ? 1 : 0) : isBlank(value) ? [] : [value]);

const idsFor = (value, keys) => [...new Set(keysOf(value).map(k => keys.get(k)).filter(Boolean))];

const listCell = ids => (ids.length ? ['L', ...ids] : null);

const cellItems = cell => (Array.isArray(cell) ? cell.slice(cell[0] === 'L' ? 1 : 0) : isBlank(cell) ? [] : [cell]);

function resolveLinks(rows, specs, lookups) {
  if (!specs.length) return rows;
  return rows.map((row) => {
    const here = specs.filter(s => Object.hasOwn(row, s.from));
    const value = s => (s.list ? listCell(idsFor(row[linkKey(s.from)], lookups.get(s.target).keys)) : lookups.get(s.target).keys.get(row[linkKey(s.from)]) || 0);
    return here.length ? { ...row, ...Object.fromEntries(here.map(s => [s.from, value(s)])) } : row;
  });
}

const fillable = (s, cell, want, live) => (s.list ? fillableList(s, cell, want, live) : fillableRef(s, cell, want, live));

function fillableList(s, cell, want, live) {
  const have = cellItems(cell);
  const same = JSON.stringify(have) === JSON.stringify(want);
  if (s.relink) return same ? undefined : listCell(want);
  const stale = have.some(id => typeof id !== 'number' || !live.has(id));
  const missing = have.length < want.length && have.every(id => want.includes(id));
  return want.length && (!have.length || stale || missing) && !same ? listCell(want) : undefined;
}

function fillableRef(s, cell, want, live) {
  if (s.relink) {
    if (want) return want === cell ? undefined : want;
    return cell && !live.has(cell) ? 0 : undefined;
  }
  return want && want !== cell && (!cell || !live.has(cell)) ? want : undefined;
}

function fillLinks({ journalRows, destRows, specs, lookups, destTable }) {
  if (!specs.length) return [];
  const latest = latestByKey(journalRows);
  const updates = new Map(); // colonne d'ici -> [[ligne, valeur]]
  for (const row of destRows) {
    const version = latest.get(row[KEY_COL]);
    if (!version || !isTrue(version.row[APPLIED_COL]) || isTrue(version.row[DELETE_COL])) continue;
    for (const s of specs) {
      const { keys, live } = lookups.get(s.target);
      const cited = version.row[linkKey(s.from)];
      const value = fillable(s, row[s.to], s.list ? idsFor(cited, keys) : keys.get(cited), live);
      if (value !== undefined) updates.set(s.to, [...(updates.get(s.to) || []), [row.id, value]]);
    }
  }
  return [...updates].flatMap(([to, list]) => chunk(list).map(part => ['BulkUpdateRecord', destTable, part.map(([id]) => id), { [to]: part.map(([, value]) => value) }]));
}
return { refOf, refKey, linkTables, linkOffers, planLinks, linkActions, unlinkActions, textFill, decideLinks, keyIds, targetRows, resolveLinks, fillLinks };
})();

// ===== js/engine/logic/structure.js =====
__M["js/engine/logic/structure.js"] = (() => {
'use strict';
const {DELETE_COL, KEY_COL, chunk, isBlank, isTrue} = __M["js/engine/logic/common.js"];
const {destColumns, latestByKey} = __M["js/engine/logic/journal.js"];

const baseType = type => String(type || '').split(':')[0];

function structureChanges(entry, { held = [], all, described, here }) {
  const ack = new Set(entry.ack || []);
  const sentIds = new Set(all.map(c => c.id));
  const known = new Set([...(entry.columns || []).map(c => c.id), ...Object.keys(entry.map || {})]);
  const gone = described
    ? destColumns([...known].map(id => ({ id }))).map(c => c.id).filter(id => !sentIds.has(id) && !ack.has(goneKey(id))).map(id => ({ id, to: (entry.map || {})[id] || id }))
    : [];
  const byName = new Map(here.map(c => [c.colId, c]));
  const retyped = destColumns(all).filter(c => (entry.own || []).includes(c.id)).flatMap((c) => {
    const column = byName.get((entry.map || {})[c.id] || c.id);
    if (!column || /^Ref(List)?$/.test(baseType(column.type)) || baseType(column.type) === baseType(c.type) || ack.has(typeKey(c.id, c.type))) return [];
    return [{ id: c.id, to: column.colId, sent: baseType(c.type), here: baseType(column.type) }];
  });
  const result = { held, gone, retyped };
  return held.length + gone.length + retyped.length ? result : null;
}

const goneKey = id => `gone:${id}`;
const typeKey = (id, type) => `type:${id}:${baseType(type)}`;

function acknowledged(entry, structure) {
  if (!structure) return entry.ack;
  const keys = [...structure.gone.map(g => goneKey(g.id)), ...structure.retyped.map(r => typeKey(r.id, r.sent))];
  return keys.length ? [...new Set([...(entry.ack || []), ...keys])] : entry.ack;
}

function backfillActions({ journalRows, destRows, specs, destTable }) {
  if (!specs.length) return [];
  const latest = latestByKey(journalRows);
  return specs.flatMap((s) => {
    const cells = destRows.map(row => [row, latest.get(row[KEY_COL])])
      .filter(([row, v]) => v && !isTrue(v.row[DELETE_COL]) && Object.hasOwn(v.row, s.from) && !isBlank(v.row[s.from]) && isBlank(row[s.to]));
    return chunk(cells).map(part => ['BulkUpdateRecord', destTable, part.map(([row]) => row.id), { [s.to]: part.map(([, v]) => v.row[s.from]) }]);
  });
}
return { structureChanges, acknowledged, backfillActions };
})();

// ===== js/engine/logic/adopt.js =====
__M["js/engine/logic/adopt.js"] = (() => {
'use strict';
const {KEY_COL, isBlank} = __M["js/engine/logic/common.js"];
const {sameValue} = __M["js/engine/logic/consolidation.js"];
const {destColumns} = __M["js/engine/logic/journal.js"];

const base = type => String(type || '').split(':')[0];
const REFS = new Set(['Ref', 'RefList']);
const SYSTEM = new Set(['Id', 'PositionNumber', 'ManualSortPos']);

function typeFit(sent, here) {
  const [s, h] = [base(sent), base(here)];
  if (s === h) return 'same';
  if (h === 'Any') return 'fine';
  if (s === 'Attachments' || h === 'Attachments' || REFS.has(h) || SYSTEM.has(h)) return 'bad';
  if (h === 'Text') return s === 'ChoiceList' || s === 'Date' || s === 'DateTime' ? 'risky' : 'fine';
  if (h === 'Choice') return s === 'Text' ? 'fine' : 'risky';
  if (h === 'Numeric') return s === 'Int' ? 'fine' : 'risky';
  return 'risky';
}

function fitIssues(columns, map, here) {
  const byName = new Map(here.map(c => [c.colId, c]));
  return destColumns(columns).flatMap((c) => {
    const to = (map || {})[c.id] || c.id;
    const column = byName.get(to);
    const level = column ? typeFit(c.type, column.type) : 'same';
    return level === 'risky' || level === 'bad' ? [{ id: c.id, to, sent: c.type, here: column.type, level }] : [];
  });
}

function adoptionStep({ ask, approve }, entry, destRows) {
  if (!entry.adopt || entry.adopted) return 'go';
  if (!ask || approve || !destRows.length) return 'mark';
  return 'hold';
}

const SHOWN = 40;
const clip = value => {
  const text = Array.isArray(value) ? value.filter(x => x !== 'L').join(', ') : String(value ?? '');
  return text.length > SHOWN ? `${text.slice(0, SHOWN - 1)}…` : text;
};
const SAMPLES = 3;

function adoptionPreview(plan, { copyCols, destRows, match = '' }) {
  const cells = plan.attached.map(([row, version]) => {
    const differ = copyCols.filter(([from, to]) => !sameValue(version.row[from], row[to]));
    const [over, fill] = [differ.filter(([, to]) => !isBlank(row[to])), differ.filter(([, to]) => isBlank(row[to]))];
    return { row, version, over, fill };
  });
  const unkeyed = destRows.filter(r => isBlank(r[KEY_COL])).length;
  return {
    added: plan.stats.added, attached: cells.length, match,
    overwritten: cells.reduce((sum, c) => sum + c.over.length, 0), filled: cells.reduce((sum, c) => sum + c.fill.length, 0),
    untouched: Math.max(0, unkeyed - cells.length),
    samples: cells.filter(c => c.over.length).slice(0, SAMPLES).map(({ row, version, over: [[from, to]] }) => ({
      key: clip(row[match]), col: to, here: clip(row[to]), sent: clip(version.row[from]),
    })),
  };
}
return { typeFit, fitIssues, adoptionStep, adoptionPreview };
})();

// ===== js/engine/target/formulas.js =====
__M["js/engine/target/formulas.js"] = (() => {
'use strict';
const {apply, readSchema} = __M["js/engine/port.js"];
const {planFormulas} = __M["js/engine/logic/column-formulas.js"];

async function formulaColumns(ctx, entry, columns, { replace = false } = {}) {
  if (ctx.exchange) return [];
  const tables = new Map([...ctx.dests].map(([table, tb]) => [table, tb.dest]));
  const plan = planFormulas(ctx.schema, entry, columns, { tables, replace });
  if (plan.actions.length) {
    await apply(plan.actions);
    ctx.schema = await readSchema();
  }
  return plan.items;
}
return { formulaColumns };
})();

// ===== js/engine/logic/report.js =====
__M["js/engine/logic/report.js"] = (() => {
'use strict';
const {KEY_COL} = __M["js/engine/logic/common.js"];
const {recentChanges, sentColumns} = __M["js/engine/logic/journal.js"];
const {filesState, short} = __M["js/engine/logic/files.js"];

const SHOWN = 10;
const WAITING_KEPT = 1000;
const BIG_KEPT = 20;

function nextSuspect(was = {}, rejected, flood, at) {
  const now = Math.floor(at);
  return { n: (was.n || 0) + rejected, at: now, ...(flood ? { flood: now } : was.flood ? { flood: was.flood } : {}) };
}

const endedAt = (note, plan, now) => (plan.ended === undefined ? note.ended : plan.ended && (plan.ended.at || Math.floor(now))) || undefined;

function offersOf(groups, note) {
  const known = new Set(note.tables.map(tb => tb.table));
  const pending = [...groups.keys()].filter(table => !known.has(table) && !note.refused.includes(table));
  const offers = pending.map((table) => {
    const tableRows = groups.get(table);
    return { table, columns: sentColumns(tableRows, []), n: new Set(tableRows.map(r => r[KEY_COL]).filter(Boolean)).size };
  }).filter(o => o.columns.length);
  return { pending, offers };
}

function filesSummary(tableRows, fileCols, present, isPublic, held = []) {
  if (!fileCols.length) return { waiting: undefined, card: undefined };
  const files = filesState(tableRows, fileCols.map(([from]) => from), present);
  return {
    waiting: files.waiting.length && !isPublic ? files.waiting.map(short).slice(0, WAITING_KEPT) : undefined,
    card: { waiting: isPublic ? 0 : files.waiting.length, big: files.big.slice(0, BIG_KEPT), public: isPublic, held: held.length },
  };
}

const exportShape = tables => JSON.stringify(tables.map(tb => [tb.table, tb.columns.map(c => `${c.id}>${c.as || ''}`)]).sort());

const named = (items, labelCol) => items.slice(0, SHOWN).map(({ id, n, state: change, row, cells, gone }) => ({
  id, n, state: change, label: labelCol ? String(row[labelCol] ?? '') : '', cells, ...(gone ? { gone } : {}),
}));
const reviewResult = (pending = [], gaps = [], labelCol = '') => ({
  pending: named(pending, labelCol), pendingIds: pending.map(p => p.id), pendingCount: pending.length, gaps: named(gaps, labelCol), gapCount: gaps.length,
});

const driftResult = (drift, labelCol, droppedCols) => ({
  drift: drift.slice(0, SHOWN).map(({ n, row, cells, gone }) => ({ n, label: labelCol ? String(row[labelCol] ?? '') : '', cells, ...(gone ? { gone } : {}) })),
  droppedCols,
  driftCount: drift.reduce((sum, d) => sum + (d.gone ? 1 : d.cells.length), 0) + droppedCols.length,
  driftGone: drift.filter(d => d.gone).length,
});

function tableResult({ entry, stats, copyCols, types, links, relinkable, formulas, structure, numbers, drift, dropped, pending, gaps, files, error, locked }, groups, lastVisit) {
  if (error) return { table: entry.table, error };
  if (locked) return { table: entry.table, stats, dest: entry.dest, locked: true };
  const labelCol = copyCols.some(([from]) => from === entry.label) ? entry.label : (copyCols[0] || [])[0];
  const recent = recentChanges(groups.get(entry.table) || [], labelCol, lastVisit, Infinity, { copyCols, numbers });
  const added = (entry.addedCols || []).filter(a => a.at > (lastVisit || 0));
  return {
    table: entry.table, stats, dest: entry.dest, copyCols, labelCol, labelCols: copyCols.map(([c]) => c), types, links, formulas, structure: structure || null, recent, added, files,
    relinkable: (relinkable || []).map(s => ({ from: s.from, to: s.to, list: s.list, target: s.target })),
    ...driftResult(drift, labelCol, dropped), ...reviewResult(pending, gaps, labelCol),
  };
}

const cardShape = (result = {}) => JSON.stringify([
  result.drift || [], result.driftCount || 0, result.pendingIds || [], result.gapCount || 0, result.files || null, result.structure || null, result.relinkable || [],
  (result.links || []).map(s => [s.to, s.target, Boolean(s.list)]),
]);
const wrote = stats => Boolean(stats && stats.added + stats.updated + stats.removed);
return { SHOWN, nextSuspect, endedAt, offersOf, filesSummary, exportShape, driftResult, tableResult, cardShape, wrote };
})();

// ===== js/engine/target/journals.js =====
__M["js/engine/target/journals.js"] = (() => {
'use strict';
const {APPLIED_COL, AUTHOR_COL, BEFORE_COL, DATA_COL, DELETE_COL, KEY_COL, MISSING_COL, ORDER_COL, RECEIVED_COL, SEAL_COL, STATE_COL} = __M["js/engine/logic/common.js"];
const {syncColumns} = __M["js/engine/logic/formulas.js"];
const {addDestColumnsActions, dropKeyActions, journalNote, journalNoteAction, storeKeyActions} = __M["js/engine/logic/received.js"];
const {apply, readSchema} = __M["js/engine/port.js"];
const {dropPages, hideColumn} = __M["js/engine/pages.js"];

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
  { id: SEAL_COL, type: 'Text', isFormula: false },
];

async function upgradeJournal(schema, journal) {
  const have = new Set(schema.columns(journal).map(c => c.colId));
  const missing = JOURNAL_COLUMNS.filter(c => !have.has(c.id));
  await apply(missing.map(({ id, ...info }) => ['AddColumn', journal, id, info]));
  return missing.length > 0;
}

async function storeKey(tables, slot, key) {
  await apply(storeKeyActions(await readSchema(), tables, slot, key));
}

async function dropKey(tables, slot) {
  await apply(dropKeyActions(await readSchema(), tables, slot));
}

async function createJournal(journal, note) {
  await apply([['AddTable', journal, JOURNAL_COLUMNS]]);
  await apply([journalNoteAction(await readSchema(), journal, note)]);
  await dropPages([journal]);
}

async function prepareDest({ dest, columns, map = {} }) {
  if (!(await readSchema()).has(dest)) await apply([['AddTable', dest, []]]);
  await apply(addDestColumnsActions(await readSchema(), dest, columns, map));
  await hideColumn(dest, KEY_COL);
}

async function updateJournalNote(journal, change) {
  const schema = await readSchema();
  const note = change(journalNote(schema, journal));
  await apply([journalNoteAction(schema, journal, note)]);
  return note;
}
return { upgradeJournal, storeKey, dropKey, createJournal, prepareDest, updateJournalNote };
})();

// ===== js/engine/logic/reinforce.js =====
__M["js/engine/logic/reinforce.js"] = (() => {
'use strict';
const {INVITE_DAYS, readKeys} = __M["js/engine/logic/trust.js"];

const GRACE_DAYS = INVITE_DAYS;
const GRACE_S = GRACE_DAYS * 86400;

const valid = renf => renf && typeof renf === 'object' && Number.isFinite(renf.at) && renf.at > 0 && renf.at < 4e9;

function renfState(note, now) {
  const renf = (note || {}).renf;
  if (!valid(renf)) return 'none';
  if (Number.isFinite(renf.done) && renf.done > 0) return 'done';
  return now - renf.at < GRACE_S ? 'pending' : 'expired';
}

const graceOpen = (note, now) => renfState(note, now) === 'pending';

const graceEnd = note => (valid((note || {}).renf) ? note.renf.at + GRACE_S : 0);

function startRenf(note, wasUnsigned, now) {
  const before = (note || {}).renf;
  if (wasUnsigned || renfState(note, now) === 'pending' || renfState(note, now) === 'expired') return { ...note, renf: { at: now } };
  return { ...note, ...(valid(before) ? { renf: before } : {}) };
}

function finishRenf(note, now) {
  if (!valid((note || {}).renf) || note.renf.done) return note;
  return { ...note, renf: { ...note.renf, done: now } };
}

const canRevert = (note, now) => ['pending', 'expired'].includes(renfState(note, now));
function revertedNote(note) {
  const { pub, pubSource, sceau, renf, ...rest } = note;
  return rest;
}

function unsignedHooks(value, hooks) {
  const keys = readKeys(value);
  return keys['*'] ? [] : hooks.filter(h => !keys[h.id]).map(h => h.id);
}
return { GRACE_DAYS, GRACE_S, renfState, graceOpen, graceEnd, startRenf, finishRenf, canRevert, revertedNote, unsignedHooks };
})();

// ===== js/engine/target/files.js =====
__M["js/engine/target/files.js"] = (() => {
'use strict';
const {apply, fetchRows, uploadAttachment} = __M["js/engine/port.js"];
const {chunk, nowS} = __M["js/engine/logic/common.js"];
const {fileArrivals, joinParts, parkedOverflow, sha1, shaOf, short} = __M["js/engine/logic/files.js"];

const RETRY_MS = 600000;
const refused = new Map();
const uploadErrors = journal => [...(refused.get(journal) || new Map()).values()];

async function attachments() {
  const present = new Map();
  for (const attachment of await fetchRows('_grist_Attachments')) {
    const sha = shaOf(attachment.fileIdent);
    if (sha && !present.has(sha)) present.set(sha, attachment.id);
  }
  return present;
}

async function receiveFiles(journal, exportId, rows, files, cited, settled = true) {
  const { ready, stale, rejected, partial } = fileArrivals(rows, exportId, nowS());
  if (!ready.length && !stale.length && !rejected.length && !partial.length) return { rows, rejected: 0 };
  const errors = refused.get(journal) || new Map();
  refused.set(journal, errors);
  const done = [...stale, ...rejected];
  let bad = rejected.length;
  const present = await files();
  const parked = [...partial];
  for (const file of ready) {
    const outcome = await receiveFile(file, { present, cited, errors });
    if (outcome === 'park') parked.push(file);
    else if (outcome !== 'wait') done.push(...file.ids);
    if (outcome === 'bad') bad++;
  }
  if (settled) {
    const over = parkedOverflow(parked);
    bad += over.filter(g => !g.sha).length;
    done.push(...over.flatMap(g => g.ids));
  }
  await apply(chunk(done).map(part => ['BulkRemoveRecord', journal, part]));
  const gone = new Set(done);
  return { rows: rows.filter(r => !gone.has(r.id)), rejected: bad };
}

async function receiveFile(file, { present, cited, errors }) {
  if (present.has(file.sha)) return 'done';
  if (!cited.has(short(file.sha))) return file.old ? 'done' : 'park';
  if (Date.now() - (errors.get(file.sha)?.at || 0) < RETRY_MS) return 'wait';
  const bytes = joinParts(file.data);
  if (bytes.length !== file.size || await sha1(bytes) !== file.sha) return 'bad';
  try {
    present.set(file.sha, await uploadAttachment(file.name, bytes));
    errors.delete(file.sha);
    return 'done';
  } catch (e) {
    errors.set(file.sha, { name: file.name, error: e.message, at: Date.now() });
    return 'wait';
  }
}
return { uploadErrors, attachments, receiveFiles };
})();

// ===== js/engine/target/style.js =====
__M["js/engine/target/style.js"] = (() => {
'use strict';
const {apply, fetchRows, readSchema} = __M["js/engine/port.js"];
const {docFormatOf, formatAction} = __M["js/engine/logic/docformat.js"];
const {finishRules, madeHelpers, planRules, startRules} = __M["js/engine/logic/received.js"];

async function styleColumns(ctx, entry, columns, { replace = false } = {}) {
  if (ctx.exchange) return entry;
  const plan = planRules(ctx.schema, entry, columns, { replace });
  if (plan.todo.length) {
    const first = startRules(entry.dest, plan.todo);
    const { retValues } = await apply(first.actions);
    try {
      await apply(finishRules(entry.dest, plan.todo, first.owners, retValues));
    } catch (e) {
      const helpers = madeHelpers(first.owners, retValues);
      await apply(helpers.map(helper => ['RemoveColumn', entry.dest, helper])).catch(() => {});
      throw e;
    }
    ctx.schema = await readSchema();
  }
  const decided = [...plan.todo.map(item => item.id), ...plan.settled];
  return decided.length ? { ...entry, styled: [...new Set([...(entry.styled || []), ...decided])] } : entry;
}

const readDocFormat = async () => docFormatOf(await fetchRows('_grist_DocInfo'));

async function alignDocFormat(wanted) {
  const action = formatAction(await fetchRows('_grist_DocInfo'), wanted);
  if (action) await apply([action]);
  return Boolean(action);
}
return { styleColumns, readDocFormat, alignDocFormat };
})();

// ===== js/engine/target/describe.js =====
__M["js/engine/target/describe.js"] = (() => {
'use strict';
const {apply, fetchRows} = __M["js/engine/port.js"];
const {planNotes} = __M["js/engine/logic/descriptions.js"];

async function describeColumns(ctx, entry, columns, { tableNote = null, replace = false, replaceTable = false } = {}) {
  if (ctx.exchange) return entry;
  const wantTable = typeof tableNote === 'string' && (replaceTable || (!entry.tabled && tableNote));
  const sections = wantTable ? await fetchRows('_grist_Views_section') : null;
  const plan = planNotes(ctx.schema, entry, columns, { replace, replaceTable, tableNote, sections });
  if (plan.actions.length) await apply(plan.actions);
  const described = [...new Set([...(entry.described || []), ...plan.described])];
  const next = { ...entry, ...(described.length ? { described } : {}), ...(plan.tabled ? { tabled: true } : {}) };
  return JSON.stringify(next) === JSON.stringify(entry) ? entry : next;
}
return { describeColumns };
})();

// ===== js/engine/target/layout.js =====
__M["js/engine/target/layout.js"] = (() => {
'use strict';
const {apply, fetchRows} = __M["js/engine/port.js"];
const {isPos, layoutSent, planLayout} = __M["js/engine/logic/layout.js"];

async function layoutColumns(ctx, entry, columns, { replace = false } = {}) {
  if (ctx.exchange || !layoutSent(columns)) return entry;
  const own = new Set(entry.own || []);
  const todo = columns.filter(c => isPos(c.pos) && own.has(c.id) && (replace || !(entry.laid || []).includes(c.id)));
  if (!todo.length) return entry;
  const [sections, fields] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Views_section_field')]);
  const plan = planLayout(ctx.schema, entry, columns, { sections, fields, replace });
  if (plan.actions.length) await apply(plan.actions);
  const laid = [...new Set([...(entry.laid || []), ...plan.laid])];
  return laid.length === (entry.laid || []).length ? entry : { ...entry, laid };
}
return { layoutColumns };
})();

// ===== js/engine/exchange.js =====
__M["js/engine/exchange.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, HUB, KIND, SCHEMA_COL, TYPE_COL, nowS} = __M["js/engine/logic/common.js"];
const {deleteColumnAction, keyTriggerAction, missingSyncColumns, prepareSourceActions} = __M["js/engine/logic/formulas.js"];
const {exportCondition, exportTables, hookMemo, hookName, ownJournal, returnExportTables} = __M["js/engine/logic/exports.js"];
const {clearExport, dropExport, putExport, setExport, setPause} = __M["js/engine/logic/notes.js"];
const {apply, createWebhook, deleteWebhook, deleteWebhookWithNotice, readSchema} = __M["js/engine/port.js"];
const {removeTechnicalTables} = __M["js/engine/pages.js"];
const {endRows, exportHooks, pruneKeys, putRecipientKey, readSourceNote, rememberDest, removeExport, saveExport, setOnlyKey, syncRows, updateSourceNote} = __M["js/engine/source/synchro.js"];
const {receivedJournals} = __M["js/engine/logic/received.js"];

const PENDING_LABEL = 'retour'; // clé de retour, le temps de créer son webhook

async function wireExchange(note, retour = '', key = '') {
  let schema = await readSchema();
  for (const { dest } of note.tables) {
    const cols = schema.columns(dest) || [];
    await apply([...prepareSourceActions(dest, missingSyncColumns(cols)), keyTriggerAction(dest, cols), deleteColumnAction(dest, cols)].filter(Boolean));
  }
  schema = await readSchema();
  const local = readSourceNote(schema).exports.find(e => e.id === note.export);
  if (local && !local.retour) throw new Error('exportTaken');
  await saveExport(note.export, returnExportTables(note, schema), { swap: true });
  await updateSourceNote((n) => {
    const was = n.exports.find(e => e.id === note.export) || { at: nowS() };
    return putExport(n, { ...was, id: note.export, name: note.name, echange: true, retour: true });
  });
  if (!retour) return;
  for (const h of await exportHooks(note.export)) await deleteWebhook(h.id);
  await setOnlyKey(note.export, PENDING_LABEL, key);
  const hookId = await createWebhook({
    name: hookName(note.name, note.export), memo: await rememberDest(hookMemo(note.from || {})), url: retour,
    tableId: __C.SYNC_TABLE, condition: exportCondition(note.export),
  });
  await putRecipientKey(note.export, hookId, key, PENDING_LABEL);
}

async function markHub(exportId) {
  const [hooks, rows] = await Promise.all([exportHooks(exportId), syncRows()]);
  const value = hooks.length >= 2 ? HUB : '';
  const row = rows.find(r => r[EXPORT_COL] === exportId && r[TYPE_COL] === KIND.swap);
  if (row && (row[SCHEMA_COL] || '') !== value) await apply([['UpdateRecord', __C.SYNC_TABLE, row.id, { [SCHEMA_COL]: value }]]);
}

async function removeRecipient(exportId, hook) {
  await deleteWebhookWithNotice(hook, await endRows(exportId, hook.id));
  await pruneKeys(exportId);
  const journals = receivedJournals(await readSchema()).filter(r => r.note.export === exportId && r.note.retour).filter(ownJournal(hook));
  await removeTechnicalTables(journals.map(r => r.journal));
  await updateSourceNote(note => setPause(note, hook.id));
  await markHub(exportId);
}

async function stopReturn(exportId) {
  for (const h of await exportHooks(exportId)) await deleteWebhook(h.id);
}

async function addDeleteColumns(tables) {
  const schema = await readSchema();
  await apply(tables.map(table => deleteColumnAction(table, schema.columns(table) || [])).filter(Boolean));
}

async function closeExport(exportId, { keepExport }) {
  for (const h of await exportHooks(exportId)) await deleteWebhookWithNotice(h, await endRows(exportId, h.id));
  if (keepExport) await pruneKeys(exportId);
  const journals = receivedJournals(await readSchema()).filter(r => r.note.export === exportId && r.note.mode === 'echange');
  await removeTechnicalTables(journals.map(r => r.journal));
  if (keepExport) await saveExport(exportId, exportTables(await syncRows(), exportId));
  else await removeExport(exportId);
  await updateSourceNote(note => (keepExport ? setExport(clearExport(note, exportId), exportId, { echange: false }) : dropExport(note, exportId)));
}
return { wireExchange, markHub, removeRecipient, stopReturn, addDeleteColumns, closeExport };
})();

// ===== js/engine/target/loop.js =====
__M["js/engine/target/loop.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {ARCHIVE_COL, DELETE_COL, EXPORT_COL, HUB, KEY_COL, KIND, LIST_COL, RESEND_COL, SCHEMA_COL, SEAL_COL, TABLE_COL, TYPE_COL, chunk, isBlank, nowS, randomHex, sleep} = __M["js/engine/logic/common.js"];
const {exportTables, returnExportTables} = __M["js/engine/logic/exports.js"];
const {awaitingPartner, currentRows, destColumns, expandRows, hasSchema, isRaw, nextGaps, planPull, planPurge, planUnpack, rowsByTable, sentColumns, touchedTables, unpackActions} = __M["js/engine/logic/journal.js"];
const {copyColumns, destRefs, droppedColumns, exchangeRules, followRenames, manualEdits, planConsolidation, receivedColumns, refusedGaps, restoreActions, rowNumbers} = __M["js/engine/logic/consolidation.js"];
const {resendValue} = __M["js/engine/logic/resend.js"];
const {nextTally, tallyDue, tallyGap} = __M["js/engine/logic/tally.js"];
const {citedFiles, fillActions, resolveRows, short, waitingVersions} = __M["js/engine/logic/files.js"];
const {decideLinks, fillLinks, linkActions, planLinks, resolveLinks, targetRows, textFill, unlinkActions} = __M["js/engine/logic/links.js"];
const {backfillActions, acknowledged, structureChanges} = __M["js/engine/logic/structure.js"];
const {adoptionPreview, adoptionStep} = __M["js/engine/logic/adopt.js"];
const {formulaColumns} = __M["js/engine/target/formulas.js"];
const {cardShape, driftResult, endedAt, exportShape, filesSummary, nextSuspect, offersOf, tableResult, wrote} = __M["js/engine/logic/report.js"];
const {apply, docChanges, docIdentity, fetchRows, isOwner, page, prefs, publicRecords, readSchema, t, withLock} = __M["js/engine/port.js"];
const {updateJournalNote, upgradeJournal} = __M["js/engine/target/journals.js"];
const {moveNotes} = __M["js/engine/note-move.js"];
const {addDestColumnsActions, missingColumns, optionActions, receivedJournals, receivedKey, restyleOptionActions, valueChoiceActions} = __M["js/engine/logic/received.js"];
const {checkSeals, checkSigned, isUnpacked, sealMark, sealRows, sealer} = __M["js/engine/logic/trust.js"];
const {finishRenf, graceOpen, renfState} = __M["js/engine/logic/reinforce.js"];
const {noteHeldFiles} = __M["js/engine/source/files.js"];
const {attachments, receiveFiles} = __M["js/engine/target/files.js"];
const {styleColumns} = __M["js/engine/target/style.js"];
const {describeColumns} = __M["js/engine/target/describe.js"];
const {layoutColumns} = __M["js/engine/target/layout.js"];
const {readSourceNote, syncRows} = __M["js/engine/source/synchro.js"];
const {stopReturn, wireExchange} = __M["js/engine/exchange.js"];
const {errorText, failure, noteError} = __M["js/engine/errors.js"];

const POLL_MS = 10000;
const IDLE_MS = 60000;
const QUIET_MS = 300000;
const DECIDE_RETRY_MS = 300;
const RAW_BATCH = 500;
const FLOOD_PER_MIN = 600;
const REREAD_MS = 300000;
const FIX_MARK = 'refus';
const FIX_VALUE = new RegExp(`^${FIX_MARK}(\\d+):`);
const FIX_HOLD_S = 60;

const state = { results: new Map(), offers: new Map(), readOnly: false, viewer: false, lastVisit: null };
const tableKey = (journal, table) => `${journal}|${table}`;
const isAccessError = e => /access|denied|blocked|permission/i.test(e.message);

let busy = false;
let lastArrival = Date.now(); // dernière arrivée dans un journal (ou retour sur la page)
let lastPass = 0; // début du dernier passage
const watch = { hash: '', tables: new Set(), pull: false, compare: true };
const comparing = () => watch.compare; // pour le diagnostic
let onChange = async () => {}; // l'onglet, redessiné quand un passage a changé quelque chose
const inflow = new Map(); // journal -> { ids, at } : lignes reçues vues au passage précédent
const settled = new Map(); // `journal|table` -> { signature, at, dest, deps } : journal déjà recopié sans effet (`deps` : tables visées par ses Références)
const lastRead = new Map(); // `journal|table` -> { numbers, drift } : numéros de ligne et retouches, à la dernière lecture
const pulled = new Map(); // journal -> empreintes des instantanés publics déjà lus
const stopped = new Set(); // Échanges coupés par l'autre document dont l'envoi de retour est arrêté
const decided = new Map(); // `journal|version` -> 'accepter' ou 'refuser', jusqu'au passage qui l'applique
let choices = new Map(); // les décisions prises en compte par le passage en cours

function startAutoConsolidation(render) {
  onChange = render;
  const tick = async () => {
    if (page.visible() && await due()) await consolidateAll();
    setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, POLL_MS);
  page.onShow(() => {
    lastArrival = Date.now();
    consolidateAll({ reread: true });
  });
}

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
      else for (const [key, was] of settled) if ([was.dest, ...(was.deps || [])].some(table => touched.includes(table))) settled.delete(key);
      return elapsed >= QUIET_MS || touched === null || touched.length > 0 || (watch.pull && steady);
    }
    watch.compare = false;
  }
  return steady;
}

async function readLastVisit() {
  if (state.lastVisit !== null) return;
  const key = `visit.${(await docIdentity()).docId}`;
  state.lastVisit = Number(prefs.read(key)) || 0;
  prefs.write(key, String(Math.floor(nowS())));
}

function forgetJournal(journal) {
  for (const key of [...state.results.keys()]) if (key === journal || key.startsWith(`${journal}|`)) state.results.delete(key);
  for (const map of [settled, lastRead]) for (const key of [...map.keys()]) if (key.startsWith(`${journal}|`)) map.delete(key);
  state.offers.delete(journal);
}

async function pull(note, journal) {
  const read = kind => publicRecords(note.base, __C.SYNC_TABLE, { [EXPORT_COL]: [note.export], [TYPE_COL]: [kind] });
  const marks = await read(KIND.mark);
  const seen = JSON.stringify(marks.map(r => [r.fields[TABLE_COL], r.fields[LIST_COL]]).sort());
  if (pulled.get(journal) === seen) return false;
  const { actions, tooBig } = planPull({ records: await read(KIND.full), journalRows: await fetchRows(journal), journalTable: journal });
  await apply(actions);
  if (JSON.stringify(tooBig) !== JSON.stringify(note.tooBig || [])) await updateJournalNote(journal, n => ({ ...n, tooBig }));
  pulled.set(journal, seen);
  return actions.length > 0;
}

function flooded(journal, raw) {
  const at = nowS();
  const was = inflow.get(journal);
  inflow.set(journal, { ids: new Set(raw.map(r => r.id)), at });
  if (!was) return false;
  return raw.filter(r => !was.ids.has(r.id)).length > FLOOD_PER_MIN * Math.max(1, (at - was.at) / 60);
}

async function sealing(schema, journal, note) {
  const key = note.mode === 'public' ? '' : receivedKey(schema, journal, note);
  if (!key) {
    if (note.sceau) throw failure('keyLost');
    return { key: '', seal: null, note };
  }
  const seal = await sealer(key);
  const mark = await sealMark(seal);
  if (note.sceau === mark) return { key, seal, note };
  sealsSeen.delete(journal);
  const sealed = await sealRows((await fetchRows(journal)).filter(isUnpacked), note.export, seal);
  await apply(chunk(sealed).map(part => ['BulkUpdateRecord', journal, part.map(r => r.id), { [SEAL_COL]: part.map(r => r[SEAL_COL]) }]));
  return { key, seal, note: await updateJournalNote(journal, n => ({ ...n, sceau: mark })) };
}

const sealsSeen = new Map();

async function trusted(journal, note, rows, seal) {
  if (!seal) return { rows, forged: [] };
  if (!sealsSeen.has(journal)) sealsSeen.set(journal, new Map());
  const { kept, forged } = await checkSeals(rows, note.export, seal, sealsSeen.get(journal));
  return { rows: kept, forged };
}

async function unpack(journal, { key, seal, note: known }) {
  let note = known;
  let rows = await fetchRows(journal);
  const raw = rows.filter(isRaw);
  const flood = flooded(journal, raw);
  const { bad, bare, signed } = key && raw.length ? await checkSigned(raw, key, note.export, { grace: graceOpen(note, nowS()) }) : {};
  if (signed && ['pending', 'expired'].includes(renfState(note, nowS()))) note = await updateJournalNote(journal, n => finishRenf(n, nowS()));
  const plan = planUnpack(rows, journal, { exportId: note.mode === 'public' ? null : note.export, max: RAW_BATCH, now: nowS(), bad, bare });
  if (plan.actions.length) {
    lastArrival = Date.now();
    await apply(seal ? unpackActions(journal, await sealRows(plan.added, note.export, seal), plan.removed) : plan.actions);
    rows = await fetchRows(journal);
  }
  const checked = await trusted(journal, note, rows, seal);
  rows = checked.rows;
  if (checked.forged.length) await apply(chunk(checked.forged).map(ids => ['BulkRemoveRecord', journal, ids]));
  if (!plan.actions.length && !checked.forged.length) return { note, rows, left: 0 };
  return { note: await noteArrivals(journal, note, { plan, forged: checked.forged.length, flood }), rows, left: plan.left };
}

async function noteArrivals(journal, note, { plan, forged, flood }) {
  const rejected = plan.rejected + forged;
  const gaps = nextGaps(note, plan);
  if (rejected || flood) gaps.suspect = nextSuspect(note.suspect, rejected, flood, nowS());
  const ended = endedAt(note, plan, nowS());
  const announced = nextTally(note.tally, plan.tally, note.tables.map(tb => tb.table));
  const tally = Object.keys(announced).length ? announced : undefined;
  if (!gaps.suspect && ended === note.ended && JSON.stringify(gaps) === JSON.stringify({ missing: note.missing || {}, big: note.big || {} })
    && JSON.stringify(tally) === JSON.stringify(note.tally)) return note;
  await updateJournalNote(journal, n => ({ ...n, ...gaps, ended, tally }));
  return { ...note, ...gaps, ended, tally };
}

async function prepareColumns(ctx, noted, tableRows) {
  const base = await addColumns(ctx, noted, tableRows);
  const { received, dropped, kept, made, own } = base;
  await refreshColumnOptions(ctx, base, tableRows);
  const { linked, laid, formulas } = await decideColumns(ctx, base, tableRows);
  const structure = ctx.exchange ? null : structureChanges({ ...laid, own }, { held: received.held, all: received.all, described: hasSchema(tableRows), here: ctx.schema.columns(received.entry.dest) });
  const ack = ctx.approve ? acknowledged(laid, structure) : laid.ack;
  const entry = { ...laid, ...(ack ? { ack } : {}), sends: received.sends.length ? received.sends : undefined, ...(received.doc ? { sourceDoc: received.doc } : {}), refs: destRefs(ctx.schema, received.entry.dest), dropped: dropped.length ? dropped.map(([, to]) => to) : undefined };
  const copyCols = copyColumns(received.sent.map(c => c.id), ctx.schema.columns(entry.dest), entry.map);
  const types = Object.fromEntries(received.sent.map(c => [c.id, c.type]));
  const created = ctx.approve ? made.map(id => ({ from: id, to: (received.entry.map || {})[id] || id })) : [];
  return { entry, dropped, copyCols, types, formulas, structure: ctx.approve ? null : structure, created, fileCols: copyCols.filter(([from]) => types[from] === 'Attachments'), links: linked.specs, relinkable: linked.text };
}

async function addColumns(ctx, noted, tableRows) {
  const received = receivedColumns(noted, tableRows, ctx.schema, ctx.allowedFor(noted.dest), Math.floor(nowS()), { hold: ctx.ask && !ctx.approve });
  const dropped = ctx.exchange ? [] : droppedColumns(received.entry, received.sent, ctx.schema.columns(received.entry.dest).map(c => c.colId));
  const kept = received.sent.filter(c => !dropped.some(([from]) => from === c.id));
  const added = [...addDestColumnsActions(ctx.schema, received.entry.dest, kept, received.entry.map), ...archiveColumn(ctx, received.entry.dest)];
  const made = missingColumns(ctx.schema, received.entry.dest, kept, received.entry.map);
  const own = received.entry.own && made.length ? [...new Set([...received.entry.own, ...made])] : received.entry.own;
  if (added.length) {
    await apply(added);
    ctx.schema = await readSchema();
  }
  return { received, dropped, kept, made, own };
}

async function refreshColumnOptions(ctx, { received, kept, own }, tableRows) {
  const again = ctx.restyle || {}; // « Reprendre depuis la SOURCE » : les éléments à reprendre ({ style, notes, table, formulas })
  const options = (again.style ? restyleOptionActions : optionActions)(ctx.schema, { ...received.entry, own }, kept);
  if (options.length) {
    await apply(options);
    ctx.schema = await readSchema();
  }
  const values = valueChoiceActions(ctx.schema, { ...received.entry, own }, kept, () => currentRows(tableRows));
  if (values.length) {
    await apply(values);
    ctx.schema = await readSchema();
  }
}

async function decideColumns(ctx, { received, kept, own }, tableRows) {
  const again = ctx.restyle || {};
  const linked = await linkColumns(ctx, { ...received.entry, own }, kept, tableRows, { relink: Boolean(again.links) });
  const styled = await styleColumns(ctx, linked.entry, kept, { replace: Boolean(again.style) });
  const described = await describeColumns(ctx, styled, destColumns(kept), { tableNote: received.tableNote, replace: Boolean(again.notes), replaceTable: Boolean(again.table) });
  const laid = await layoutColumns(ctx, described, destColumns(kept), { replace: Boolean(again.layout) });
  const formulas = await formulaColumns(ctx, laid, kept, { replace: Boolean(again.formulas) });
  return { linked, laid, formulas };
}

async function linkColumns(ctx, noted, sent, tableRows, { relink = false } = {}) {
  if (ctx.exchange) return { entry: noted, specs: [], text: [] };
  const plan = planLinks(ctx.schema, noted, sent, ctx.dests, { relink });
  let entry = noted;
  if (plan.undo.length) {
    await apply(unlinkActions(entry.dest, plan.undo));
    await apply(textFill({ journalRows: tableRows, destRows: await fetchRows(entry.dest), specs: plan.undo, destTable: entry.dest }));
    ctx.schema = await readSchema();
    entry = { ...entry, linked: (entry.linked || []).filter(id => !plan.undo.some(s => s.from === id)) };
  }
  if (!plan.todo.length) return { entry, specs: plan.ready, text: plan.text };
  const destRows = await fetchRows(entry.dest);
  const { convert, decided } = decideLinks(plan.todo, to => destRows.every(r => isBlank(r[to])), { all: relink });
  if (convert.length) {
    await apply(convert.flatMap(spec => linkActions(entry.dest, spec)));
    ctx.schema = await readSchema();
  }
  return {
    entry: { ...entry, linked: [...new Set([...(entry.linked || []), ...decided])] },
    specs: [...plan.ready, ...convert.map(spec => (relink ? { ...spec, relink: true } : spec))],
    text: [...plan.text, ...plan.todo.filter(spec => !convert.includes(spec))],
  };
}

const archiveColumn = (ctx, dest) => (ctx.archive && !ctx.schema.columns(dest).some(c => c.colId === ARCHIVE_COL)
  ? [['AddVisibleColumn', dest, ARCHIVE_COL, { type: 'Bool', label: t('recv.archive.col'), isFormula: false }]] : []);

async function copyTable(ctx, noted) {
  const renamed = followRenames(noted, ctx.schema);
  if (!ctx.schema.has(renamed.dest)) return { entry: renamed, error: failure('destMissing', { dest: renamed.dest }) };
  const tableRows = ctx.groups.get(renamed.table) || [];
  const { entry, copyCols, types, dropped, fileCols, links, relinkable, formulas, structure, created } = await prepareColumns(ctx, renamed, tableRows);
  const present = fileCols.length ? await ctx.files() : new Map();
  const waiting = ctx.exchange ? waitingVersions(tableRows, fileCols.map(([from]) => from), present) : new Map();
  const key = tableKey(ctx.journal, entry.table);
  const signature = JSON.stringify([tableRows.map(r => r.id), copyCols, entry.match || '', entry.dest, present.size, links.map(s => [s.to, s.target])]);
  if (unchanged(key, signature)) return { entry, stats: { added: 0, updated: 0, removed: 0 }, copyCols, types, dropped, links, relinkable, formulas, structure, wrote: false, ...lastRead.get(key) };
  const lookups = await linkLookups(links);
  const rows = resolveLinks(resolveRows(tableRows, fileCols.map(([from]) => from), present), links, lookups);
  const destRows = await fetchRows(entry.dest);
  const plan = planTable(ctx, entry, { rows, destRows, copyCols, waiting });
  const adopting = adoptionStep(ctx, entry, destRows);
  if (adopting === 'hold' && plan.stats.added + plan.stats.updated > 0) {
    const adoption = adoptionPreview(plan, { copyCols, destRows, match: entry.match || '' });
    return { entry, stats: { added: 0, updated: 0, removed: 0 }, copyCols, types, dropped, links, formulas, structure: { held: [], gone: [], retyped: [], ...structure, adoption },
      numbers: rowNumbers(destRows), drift: [], pending: [], gaps: [], files: null, wrote: false };
  }
  const fill = fillWrites(ctx, entry, { tableRows, rows, destRows, fileCols, present, links, lookups, created });
  const destChanged = await writeTable(ctx, entry, plan, fill);
  if (plan.actions.length || destChanged) settled.delete(key);
  else settled.set(key, { signature, at: Date.now(), dest: entry.dest, deps: links.map(s => s.target) });
  const after = destChanged ? await fetchRows(entry.dest) : destRows;
  const files = filesSummary(tableRows, fileCols, present, ctx.mode === 'public', plan.waiting);
  rememberRead(ctx, key, { rows, after, copyCols, plan, files });
  return { entry: { ...entry, waiting: files.waiting, ...(adopting === 'mark' ? { adopted: true } : {}) }, stats: plan.stats, copyCols, types, dropped, links, relinkable, formulas, structure, wrote: plan.actions.length > 0, ...lastRead.get(key) };
}

function fillWrites(ctx, entry, { tableRows, rows, destRows, fileCols, present, links, lookups, created }) {
  const presentKeys = new Set([...present.keys()].map(short));
  return [
    ...(ctx.exchange ? [] : fillActions({
      journalRows: tableRows, destRows, copyCols: fileCols, present, destTable: entry.dest, arrived: new Set((entry.waiting || []).filter(k => presentKeys.has(k))),
    })),
    ...fillLinks({ journalRows: tableRows, destRows, specs: links, lookups, destTable: entry.dest }),
    ...backfillActions({ journalRows: rows, destRows, specs: created, destTable: entry.dest }),
  ];
}

function rememberRead(ctx, key, { rows, after, copyCols, plan, files }) {
  lastRead.set(key, {
    numbers: rowNumbers(after), drift: manualEdits({ journalRows: rows, destRows: after, copyCols, exchange: ctx.exchange, except: plan.gone }),
    pending: plan.pending, gaps: ctx.review ? refusedGaps({ journalRows: rows, destRows: after, copyCols }) : [], files: files.card,
  });
}

async function linkLookups(specs) {
  const targets = [...new Set(specs.map(s => s.target))];
  return new Map(await Promise.all(targets.map(async target => [target, targetRows(await fetchRows(target))])));
}

function unchanged(key, signature) {
  const was = settled.get(key);
  return Boolean(was && was.signature === signature && Date.now() - was.at < REREAD_MS && lastRead.has(key));
}

function planTable(ctx, entry, { rows, destRows, copyCols, waiting }) {
  return planConsolidation({
    journalRows: rows, destRows, copyCols, destTable: entry.dest, journalTable: ctx.journal, matchCol: entry.match || '',
    exchange: ctx.exchange, hub: ctx.hub, rules: ctx.rules, decisions: ctx.decisions, waiting,
    deleteCol: ctx.schema.columns(entry.dest).some(c => c.colId === DELETE_COL),
    now: nowS(), archive: ctx.archive,
  });
}

async function writeTable(ctx, entry, { actions, stats, fix }, fill) {
  const written = stats.added + stats.updated + stats.removed > 0;
  await apply([...(ctx.swap && written ? [['UpdateRecord', __C.SYNC_TABLE, ctx.swap.id, { [RESEND_COL]: randomHex(4) }]] : []), ...actions, ...fill]);
  if (fix.actions.length) {
    await apply(fix.actions);
    await askResend(ctx.lots.get(entry.dest), entry.dest, fix.keys);
  }
  return written || fix.actions.length > 0 || fill.length > 0;
}

async function askResend(lot, dest, keys) {
  if (!lot || !keys.length) return;
  const wanted = new Set(keys);
  const ids = (await fetchRows(dest)).filter(r => wanted.has(r[KEY_COL])).map(r => r.id);
  if (ids.length) await apply([['UpdateRecord', __C.SYNC_TABLE, lot.id, { [RESEND_COL]: resendValue(`${FIX_MARK}${Math.floor(nowS())}`, ids) }]]);
}

async function clearFixMarks(lots) {
  const now = nowS();
  const age = value => { const m = FIX_VALUE.exec(String(value || '')); return m ? now - Number(m[1]) : -1; };
  const stale = lots.filter(lot => age(lot[RESEND_COL]) > FIX_HOLD_S);
  if (stale.length) await apply(stale.map(lot => ['UpdateRecord', __C.SYNC_TABLE, lot.id, { [RESEND_COL]: '' }]));
}

async function copyContext(schema, journal, note, groups) {
  const exchange = note.mode === 'echange';
  const review = exchange && Boolean(note.retour);
  const rows = exchange ? await syncRows(schema) : [];
  const own = review ? new Map(exportTables(rows, note.export).map(tb => [tb.table, new Set(tb.columns.map(c => c.id))])) : null;
  const swap = rows.find(r => r[EXPORT_COL] === note.export && r[TYPE_COL] === KIND.swap) || null;
  const lots = new Map(rows.filter(r => r[EXPORT_COL] === note.export && r[TYPE_COL] === KIND.lot).map(r => [r[TABLE_COL], r]));
  if (review) await clearFixMarks([...lots.values()]);
  const prefix = `${journal}|`;
  return {
    schema, journal, groups, exchange, swap, review, lots, rows, mode: note.mode, archive: Boolean(note.archive) && !exchange, ask: Boolean(note.ask) && !exchange,
    dests: new Map(note.tables.map(tb => [tb.table, tb])),
    hub: Boolean(review && swap && swap[SCHEMA_COL] === HUB),
    rules: review ? exchangeRules(readSourceNote(schema).exports.find(e => e.id === note.export)) : null,
    decisions: new Map([...choices].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [Number(k.slice(prefix.length)), v])),
    allowedFor: dest => (own ? own.get(dest) || new Set() : null),
  };
}

async function saveEntries(journal, updates) {
  if (!updates.size) return;
  const noted = ({ dest, map, match, refs, dropped, addedCols, waiting, own, linked, styled, sourceDoc, sends, described, laid, tabled, ack, adopted }) => JSON.parse(JSON.stringify({
    dest, map, match, refs, dropped, addedCols, waiting, own, linked, styled, sourceDoc, sends, described, laid, tabled, ack, adopted,
  }));
  const merged = n => ({ ...n, tables: n.tables.map(tb => (updates.has(tb.table) ? { ...tb, dropped: undefined, waiting: undefined, sends: undefined, ...noted(updates.get(tb.table)) } : tb)) });
  await followExchange(await updateJournalNote(journal, merged));
}

async function followExchange(note, rows = null) {
  if (note.mode !== 'echange' || note.retour || !(await isOwner().catch(() => false))) return;
  if (rows) {
    const schema = await readSchema();
    const want = returnExportTables(note, schema);
    if (exportShape(exportTables(rows, note.export)) === exportShape(want)) return;
  }
  await wireExchange(note);
}

async function restoreSource(journal, table) {
  const key = tableKey(journal, table);
  const result = state.results.get(key);
  if (!result || !result.copyCols) return;
  const { dest, labelCol, types = {}, droppedCols = [], links = [] } = result;
  const copyCols = [...result.copyCols, ...droppedCols];
  await withLock('gristsync-consolidation', async () => {
    if (droppedCols.length) {
      const columns = droppedCols.map(([from]) => ({ id: from, type: types[from] || 'Any', label: from }));
      await apply(addDestColumnsActions(await readSchema(), dest, columns, Object.fromEntries(droppedCols)));
      await updateJournalNote(journal, n => ({ ...n, tables: n.tables.map(tb => (tb.table === table ? { ...tb, dropped: undefined } : tb)) }));
    }
    const fileCols = copyCols.filter(([from]) => types[from] === 'Attachments').map(([from]) => from);
    const schema = await readSchema();
    const { note } = receivedJournals(schema).find(r => r.journal === journal);
    const { seal } = await sealing(schema, journal, note);
    const rows = (await trusted(journal, note, await fetchRows(journal), seal)).rows;
    const journalRows = resolveLinks(resolveRows(rowsByTable(expandRows(rows)).get(table) || [], fileCols, fileCols.length ? await attachments() : new Map()), links, await linkLookups(links));
    await apply(restoreActions(manualEdits({ journalRows, destRows: await fetchRows(dest), copyCols }), dest, copyCols));
    const after = await fetchRows(dest);
    const drift = manualEdits({ journalRows, destRows: after, copyCols });
    lastRead.set(key, { numbers: rowNumbers(after), drift });
    state.results.set(key, { ...state.results.get(key), copyCols, ...driftResult(drift, labelCol, []) });
  });
}

async function copyTables(ctx, note, owner) {
  const done = new Map();
  const locked = Boolean(note.verrou) && !ctx.exchange && !owner;
  const linking = tb => !ctx.exchange && sentColumns(ctx.groups.get(tb.table) || [], tb.columns || []).some(c => c.link);
  for (const noted of [...note.tables].sort((a, b) => linking(a) - linking(b))) {
    const copied = locked ? { entry: noted, locked: true, stats: { added: 0, updated: 0, removed: 0 } } : await copyTable(ctx, noted);
    ctx.dests.set(noted.table, copied.entry);
    done.set(noted.table, { ...copied, changed: !copied.error && JSON.stringify(copied.entry) !== JSON.stringify(noted) });
  }
  return note.tables.map(noted => done.get(noted.table));
}

const tallySeen = new Map();
function tallyReport(journal, note, groups, pending) {
  const out = {};
  const off = pending || note.mode === 'echange' || note.mode === 'public' || note.archive;
  for (const tb of note.tables) {
    const explained = (note.missing || {})[tb.table] > 0 || ((note.big || {})[tb.table] || []).length > 0;
    const gap = off ? null : tallyGap((note.tally || {})[tb.table], groups.get(tb.table) || [], explained);
    if (tallyDue(tallySeen, tableKey(journal, tb.table), gap, nowS())) out[tb.table] = gap;
  }
  return out;
}

async function consolidate(schema, { journal, note: noteBefore }, owner) {
  if (noteBefore.mode === 'public' && await pull(noteBefore, journal)) lastArrival = Date.now();
  const trust = await sealing(schema, journal, noteBefore);
  const unpacked = await unpack(journal, trust);
  let { note } = unpacked;
  if (note.ended && note.mode === 'echange' && !note.retour && !stopped.has(note.export)) {
    await stopReturn(note.export).then(() => stopped.add(note.export), () => {});
  }
  let present = null;
  const files = async () => (present ||= await attachments());
  const cited = citedFiles(unpacked.rows, note.tables.flatMap(tb => tb.waiting || []));
  await noteHeldFiles(journal, note, cited);
  const { rows, rejected } = await receiveFiles(journal, note.export, unpacked.rows, files, cited, !unpacked.left);
  if (rejected) {
    const suspect = nextSuspect(note.suspect, rejected, false, nowS());
    note = { ...note, suspect };
    await updateJournalNote(journal, n => ({ ...n, suspect }));
  }
  const groups = rowsByTable(expandRows(rows));
  const { pending, offers } = offersOf(groups, note);
  state.offers.set(journal, offers);
  const ctx = { ...await copyContext(schema, journal, note, groups), files, restyle: restyles.get(journal), approve: approvals.has(journal) };
  if (ctx.exchange && !ctx.review) await followExchange(note, ctx.rows);
  const tables = await copyTables(ctx, note, owner);
  await saveEntries(journal, new Map(tables.filter(tb => tb.changed).map(tb => [tb.entry.table, tb.entry])));
  const after = tables.some(tb => tb.wrote) ? (await trusted(journal, note, await fetchRows(journal), trust.seal)).rows : rows;
  await apply(planPurge(after, journal, { keep: pending, drop: note.refused }));
  if (unpacked.left) lastArrival = Date.now();
  const afterGroups = rowsByTable(expandRows(after));
  return {
    rows: after.length, note, tables: tables.map(tb => tableResult(tb, afterGroups, Math.max(state.lastVisit || 0, note.histo || 0))),
    tally: tallyReport(journal, note, rowsByTable(after), unpacked.left > 0),
  };
}

const summary = s => (s.added || s.updated || s.removed ? t('recv.result', s) : t('recv.result.none'));

function notePass(journal, pass, before, offersBefore, at) {
  const gaps = JSON.stringify([pass.note.missing, pass.note.big, pass.note.suspect, pass.note.ended, pass.tally]);
  state.results.set(journal, { at, rows: pass.rows, gaps, tally: pass.tally });
  const tablesChanged = pass.tables.map(tb => noteTable(journal, tb, at)).some(Boolean);
  return tablesChanged || !before || Boolean(before.error) || !before.rows !== !pass.rows || before.gaps !== gaps
    || offersBefore !== JSON.stringify(state.offers.get(journal) || []);
}

function noteTable(journal, tb, at) {
  const key = tableKey(journal, tb.table);
  const was = state.results.get(key);
  state.results.set(key, tb.error ? { at, error: true, text: errorText(tb.error) } : { at, text: tb.locked ? t('recv.lock.waiting') : summary(tb.stats), ...tb });
  return Boolean(tb.error) !== Boolean(was?.error) || wrote(tb.stats) || cardShape(was) !== cardShape(tb);
}

async function passAll() {
  let changed = false;
  lastPass = Date.now();
  choices = new Map(decided);
  let schema = await readSchema();
  let upgraded = false;
  for (const { journal } of receivedJournals(schema)) upgraded = (await upgradeJournal(schema, journal)) || upgraded;
  if (!state.readOnly) upgraded = (await moveNotes(schema)) || upgraded;
  if (upgraded) schema = await readSchema();
  watch.tables = new Set(receivedJournals(schema).flatMap(r => [r.journal, ...r.note.tables.map(tb => tb.dest)]));
  watch.pull = receivedJournals(schema).some(r => r.note.mode === 'public');
  const owner = await isOwner().catch(() => false);
  for (const received of receivedJournals(schema).filter(r => !awaitingPartner(r.note))) {
    const { journal } = received;
    const before = state.results.get(journal);
    const offersBefore = JSON.stringify(state.offers.get(journal) || []);
    const at = nowS();
    try {
      changed = notePass(journal, await consolidate(schema, received, owner), before, offersBefore, at) || changed;
      state.readOnly = state.viewer;
      schema = await readSchema();
    } catch (e) {
      state.readOnly = state.viewer || isAccessError(e);
      state.results.set(journal, { ...before, at, text: errorText(e), error: true });
      changed ||= !(before && before.error);
    }
  }
  for (const k of choices.keys()) decided.delete(k);
  choices = new Map();
  return changed;
}

const decide = (journal, ids, choice) => applyDecisions(ids.map(id => `${journal}|${id}`), choice);

const restyles = new Map();
const relink = journal => restyle(journal, { links: true });
async function restyle(journal, elements = { style: true, notes: true, table: true }) {
  restyles.set(journal, elements);
  try {
    while ((await consolidateAll({ reread: true })) === null) await sleep(DECIDE_RETRY_MS);
  } finally {
    restyles.delete(journal);
  }
}

const approvals = new Set();
async function approveStructure(journal, { auto = false } = {}) {
  if (auto) await updateJournalNote(journal, ({ ask, ...rest }) => rest);
  approvals.add(journal);
  try {
    while ((await consolidateAll({ reread: true })) === null) await sleep(DECIDE_RETRY_MS);
  } finally {
    approvals.delete(journal);
  }
}

async function applyDecisions(keys, choice) {
  for (const key of keys) decided.set(key, choice);
  while ((await consolidateAll({ reread: true })) === null) await sleep(DECIDE_RETRY_MS);
}

async function consolidateAll({ reread = false } = {}) {
  if (busy) return null;
  busy = true;
  if (reread) settled.clear();
  let changed = false;
  try {
    await readLastVisit();
    changed = await withLock('gristsync-consolidation', passAll);
  } catch (e) {
    if (isAccessError(e)) state.readOnly = true;
    console.warn(e);
    noteError(e);
  } finally {
    busy = false;
  }
  if (changed) await onChange();
  return changed;
}
return { state, tableKey, isAccessError, comparing, startAutoConsolidation, forgetJournal, sealing, sealsSeen, restoreSource, decide, relink, restyle, approveStructure, consolidateAll };
})();

// ===== js/engine/diagnostic.js =====
__M["js/engine/diagnostic.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {TYPE_COL, EXPORT_COL, TABLE_COL, RECEIVED_COL, RESEND_COL, nowS} = __M["js/engine/logic/common.js"];
const {ownsSync} = __M["js/engine/logic/strays.js"];
const {catchFact, diagnosticText, exportFacts, journalFacts, progressFact} = __M["js/engine/logic/diagnostic.js"];
const {conditionExport, exportDrift, exportTables, hooksOf} = __M["js/engine/logic/exports.js"];
const {receivedJournals, receivedKey} = __M["js/engine/logic/received.js"];
const {LEASE_S, budgetWait, dueRows, parseCharge} = __M["js/engine/logic/resend.js"];
const {docIdentity, fetchRows, isOwner, journalStats, listWebhooks, page, readSchema, t: portText, webhookConditions} = __M["js/engine/port.js"];
const {recentErrors} = __M["js/engine/errors.js"];
const {catchState} = __M["js/engine/source/resend.js"];
const {isCharge, readSourceNote} = __M["js/engine/source/synchro.js"];
const {comparing, state, tableKey} = __M["js/engine/target/loop.js"];

const t = (key, values) => portText(key, values).replace(/[\u00a0\u202f]/g, ' ');

async function sourceFacts(schema) {
  if (!ownsSync(schema)) return null;
  const owner = await isOwner().catch(() => false);
  const [hooks, conditions] = owner ? await Promise.all([listWebhooks(), webhookConditions()]) : [[], new Map()];
  const all = await fetchRows(__C.SYNC_TABLE);
  const rows = all.filter(r => !isCharge(r));
  const note = readSourceNote(schema);
  const { late, lists } = dueRows(rows);
  const ids = [...new Set([...note.exports.map(e => e.id), ...rows.map(r => r[EXPORT_COL])])].filter(Boolean);
  const exports = ids.map((id) => {
    const tables = exportTables(rows, id);
    const of = list => list.filter(r => r[EXPORT_COL] === id).map(r => r[TABLE_COL]);
    return exportFacts({
      ...(note.exports.find(e => e.id === id) || { id, name: '' }), tables, ...exportDrift(schema, tables),
      invitations: note.invitations.filter(i => i.export === id), late: of(late), lists: of(lists), recipients: hooksOf(hooks, conditions, id),
    }, t);
  });
  const charge = parseCharge((all.find(isCharge) || {})[RESEND_COL]);
  const now = nowS();
  const busy = charge.par && now - charge.le < LEASE_S ? t('diag.charge.alive', { n: String(Math.round(now - charge.le)) }) : '';
  const wait = budgetWait(charge, now);
  return {
    ownerOnly: !owner,
    unsafe: hooks.filter(h => h.fields.tableId === __C.SYNC_TABLE && !conditionExport(conditions.get(h.id))).length,
    charge: [busy, wait ? t('diag.charge.budget', { n: String(Math.round(wait)) }) : ''].filter(Boolean).join(', '),
    progress: progressFact(charge.prog, now, t),
    catchUp: catchFact(catchState(), t),
    exports,
    kinds: rows.reduce((n, r) => ({ ...n, [r[TYPE_COL]]: (n[r[TYPE_COL]] || 0) + 1 }), {}),
  };
}

async function targetFacts(schema) {
  const journals = await Promise.all(receivedJournals(schema).map(async ({ journal, note }) => journalFacts({
    journal, note, signed: receivedKey(schema, journal, note),
    results: [state.results.get(journal), ...note.tables.map(tb => state.results.get(tableKey(journal, tb.table)))],
    offers: (state.offers.get(journal) || []).length,
    stats: await journalStats(journal, RECEIVED_COL, TYPE_COL),
    t,
  })));
  return { journals, compare: comparing(), visible: page.visible() };
}

async function diagnostic({ version, served = '', readOnly = false, agent = '' }) {
  const schema = await readSchema();
  const owner = await isOwner().catch(() => false);
  return diagnosticText({
    version,
    served,
    origin: await docIdentity().then(d => d.origin, () => ''),
    access: readOnly ? 'reader' : owner ? 'owner' : 'editor',
    at: Date.now(),
    agent,
    source: await sourceFacts(schema),
    target: await targetFacts(schema),
    errors: recentErrors,
    t,
  });
}
return { diagnostic };
})();

// ===== js/engine/rest-port.js =====
__M["js/engine/rest-port.js"] = (() => {
'use strict';
const {maskKey, parseWebhookUrl} = __M["js/engine/logic/codes.js"];
const {parseJson} = __M["js/engine/logic/common.js"];
const {readShare} = __M["js/engine/logic/trust.js"];

const SHORT_MS = 10000;
const SHARE_MS = 15000;
const POST_MS = 60000;

const answer = async (promise) => {
  try {
    return await promise;
  } catch (e) {
    if (typeof e?.status === 'number') return { status: e.status, body: null, message: e.message };
    throw e;
  }
};

const URL_REFUSED = /url is forbidden/i;

const restOf = http => async (method, path, body) => {
  const response = await answer(http.request(method, path, { body, full: true }));
  if (response.status === 403) throw new Error(URL_REFUSED.test(response.message || '') ? 'webhookForbidden' : 'ownerOnly');
  if (response.status >= 300) throw new Error(maskKey(`HTTP ${response.status} ${String(response.message || '').slice(0, 200)}`));
  return response.body;
};

function sqlPort(http) {
  async function querySql(query) {
    try {
      const response = await answer(http.request('GET', '/sql', { params: { q: query }, full: true }));
      return response.status >= 300 ? null : response.body.records.map(r => r.fields);
    } catch (e) {
      return null;
    }
  }

  async function selectRows(tableId, colIds, where = {}) {
    const test = Object.entries(where).map(([c, v]) => `"${c}" = '${String(v).replace(/'/g, "''")}'`).join(' and ');
    return querySql(`select ${['id', ...colIds].map(c => `"${c}"`).join(', ')} from "${tableId}"${test ? ` where ${test}` : ''}`);
  }

  async function journalStats(tableId, receivedCol, typeCol) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableId)) return null;
    const [row] = (await querySql(`select count(*) as n, max("${receivedCol}") as last, sum(case when "${typeCol}" is not null and "${typeCol}" != '' then 1 else 0 end) as raw from "${tableId}"`)) || [];
    return row ? { n: Number(row.n) || 0, last: Number(row.last) || 0, raw: Number(row.raw) || 0 } : null;
  }

  return { querySql, selectRows, journalStats };
}

function changesPort(http) {
  async function docChanges(since) {
    const read = left => answer(http.request('GET', '/compare', { params: { left, right: 'HEAD', maxRows: 1 }, full: true }));
    try {
      let response = await read(since || 'HEAD');
      if ([401, 403].includes(response.status)) return null;
      let lost = !since;
      if (response.status >= 300 && since) {
        lost = true;
        response = await read('HEAD');
      }
      if (response.status >= 300) return response.status === 404 ? null : { hash: since, tables: null };
      const { right, details } = response.body;
      const delta = (details || {}).rightChanges;
      const known = !lost && delta && !(delta.tableRenames || []).length;
      return { hash: right.h, tables: known ? new Set(Object.keys(delta.tableDeltas || {})) : null };
    } catch (e) {
      return { hash: since, tables: null };
    }
  }

  return { docChanges };
}

function webhookListPort({ rest, docApi }) {
  let owner = null;
  const listWebhooks = async () => (await rest('GET', '/webhooks')).webhooks;

  async function isOwner() {
    if (owner === null) {
      try {
        await listWebhooks();
        owner = true;
      } catch (e) {
        if (e.message !== 'ownerOnly') throw e;
        owner = false;
      }
    }
    return owner;
  }

  async function webhookConditions() {
    const conditions = new Map();
    for (const trigger of await docApi.fetchRows('_grist_Triggers')) {
      const text = (parseJson(trigger.condition || '{}') || {}).text || '';
      const actions = parseJson(trigger.actions || '[]');
      for (const action of Array.isArray(actions) ? actions : []) if (action && action.type === 'webhook') conditions.set(action.id, text);
    }
    return conditions;
  }

  return { listWebhooks, isOwner, webhookConditions };
}

function directPort(http) {
  let ownOrigin = '';

  async function postRows(url, rows, timeout = POST_MS) {
    ownOrigin ||= new URL(await http.docBaseUrl()).origin;
    if (new URL(url).origin !== ownOrigin) throw new Error('otherInstance');
    const response = await answer(http.anonymous('POST', url, { body: rows, timeout }));
    if (response.status >= 300) throw new Error(maskKey(`HTTP ${response.status} ${String(response.message || '').slice(0, 120)}`));
  }
  const postToHook = (h, rows, timeout) => postRows(h.fields.url, rows, timeout);

  return { postRows, postToHook };
}

function webhookEditPort({ rest, webhookConditions, postToHook }) {
  const clearHookQueue = id => rest('DELETE', `/webhooks/queue/${encodeURIComponent(id)}`);
  async function deleteWebhook(id) {
    await clearHookQueue(id).catch(() => {});
    return rest('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }

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

  async function deleteWebhookWithNotice(h, rows) {
    await postToHook(h, rows, SHORT_MS).catch(() => {});
    await deleteWebhook(h.id);
  }

  return {
    createWebhook,
    setWebhookEnabled: (id, enabled) => rest('PATCH', `/webhooks/${encodeURIComponent(id)}`, { enabled }),
    renameWebhook: (id, name, memo) => rest('PATCH', `/webhooks/${encodeURIComponent(id)}`, memo === undefined ? { name } : { name, memo }),
    deleteWebhook,
    deleteWebhookWithNotice,
    clearWebhookQueue: () => rest('DELETE', '/webhooks/queue'),
  };
}

function sharePort(http) {
  async function shareInfo(url) {
    const target = parseWebhookUrl(url);
    if (!target) return null;
    const response = await answer(http.anonymous('GET', `${target.origin}${target.prefix}/api/s/${target.key}`, { timeout: SHARE_MS }));
    if (response.status === 404 || response.status === 403) return null;
    if (response.status >= 300) throw new Error('shareUnreadable');
    const info = readShare(response.body);
    if (!info) throw new Error('shareUnreadable');
    return info;
  }

  async function publicAccess(base) {
    try {
      const response = await answer(http.anonymous('GET', base, {}));
      if (response.status < 300) return String((response.body || {}).access || 'viewers');
      return [401, 403, 404].includes(response.status) ? '' : null;
    } catch (e) {
      return null;
    }
  }

  async function publicRecords(base, tableId, filter) {
    const query = encodeURIComponent(JSON.stringify(filter));
    const response = await answer(http.anonymous('GET', `${base}/tables/${tableId}/records?filter=${query}`, {})).catch(() => null);
    if (!response || response.status >= 300) throw new Error('publicClosed');
    return (response.body || {}).records || [];
  }

  return { shareInfo, publicAccess, publicRecords };
}

function attachmentPort(http) {
  async function downloadAttachment(id) {
    try {
      return await http.download(Number(id));
    } catch (e) {
      throw new Error(typeof e?.status === 'number' ? `HTTP ${e.status}` : e.message);
    }
  }

  async function uploadAttachment(name, bytes) {
    try {
      return await http.upload(name, bytes);
    } catch (e) {
      throw new Error(typeof e?.status === 'number' ? `HTTP ${e.status} ${String(e.message || '').slice(0, 200)}` : e.message);
    }
  }

  return { downloadAttachment, uploadAttachment };
}

function createRestPort({ docApi, http }) {
  const rest = restOf(http);
  const { querySql, selectRows, journalStats } = sqlPort(http);
  const { docChanges } = changesPort(http);
  const { listWebhooks, isOwner, webhookConditions } = webhookListPort({ rest, docApi });
  const { postRows, postToHook } = directPort(http);
  const { createWebhook, setWebhookEnabled, renameWebhook, deleteWebhook, deleteWebhookWithNotice, clearWebhookQueue } = webhookEditPort({ rest, webhookConditions, postToHook });
  const { shareInfo, publicAccess, publicRecords } = sharePort(http);
  const { downloadAttachment, uploadAttachment } = attachmentPort(http);

  return {
    querySql,
    selectRows,
    journalStats,
    docChanges,
    isOwner,
    downloadAttachment,
    uploadAttachment,
    listWebhooks,
    createWebhook,
    webhookConditions,
    setWebhookEnabled,
    renameWebhook,
    deleteWebhook,
    deleteWebhookWithNotice,
    clearWebhookQueue,
    postRows,
    postToHook,
    publicRecords,
    publicAccess,
    shareInfo,
  };
}
return { createRestPort };
})();

// ===== js/grist.js =====
__M["js/grist.js"] = (() => {
'use strict';
const {GRIST_ORIGINS} = __M["js/config.js"];
const {parseDocBaseUrl} = __M["js/engine/logic/codes.js"];
const {toRows} = __M["js/engine/logic/common.js"];
const {schemaFrom} = __M["js/engine/logic/schema.js"];
const {createRestPort} = __M["js/engine/rest-port.js"];

async function gristFetch(url, options = {}) {
  if (!GRIST_ORIGINS.includes(new URL(url).origin)) throw new Error('otherInstance');
  return fetch(url, { ...options, credentials: 'omit' });
}

async function authUrl(path, { full = false } = {}) {
  const { token, baseUrl } = await grist.docApi.getAccessToken({ readOnly: !full });
  return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`;
}

const fetchRows = async tableId => toRows(await grist.docApi.fetchTable(tableId));

const apply = actions => (actions.length ? grist.docApi.applyUserActions(actions) : null);

async function readSchema() {
  const [tables, columns] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Tables_column')]);
  return schemaFrom(tables, columns);
}

async function docIdentity() {
  const { baseUrl } = await grist.docApi.getAccessToken({ readOnly: true });
  return { ...parseDocBaseUrl(baseUrl), baseUrl };
}

const isReadOnly = () => new URLSearchParams(location.search).get('readonly') === 'true';

async function withLock(name, fn) {
  if (navigator.locks) {
    try { return await navigator.locks.request(name, fn); } catch (e) { if (!e || e.name !== 'SecurityError') throw e; }
  }
  return fn();
}

async function answerOf(response, limit = 200) {
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(text.slice(0, limit)), { status: response.status });
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = null;
  }
  return { status: response.status, body };
}

const http = {
  async request(method, path, { body, params, full = false, timeout } = {}) {
    const query = Object.entries(params || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const url = await authUrl(`${path}${query ? `?${query}` : ''}`, { full });
    return answerOf(await gristFetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    }));
  },
  async anonymous(method, url, { body, timeout } = {}) {
    return answerOf(await gristFetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    }), 120);
  },
  async download(id) {
    const response = await gristFetch(await authUrl(`/attachments/${Number(id)}/download`));
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    return new Uint8Array(await response.arrayBuffer());
  },
  async upload(name, bytes) {
    const form = new FormData();
    form.append('upload', new Blob([bytes]), name);
    const response = await gristFetch(await authUrl('/attachments', { full: true }), {
      method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: form,
    });
    return (await answerOf(response)).body[0];
  },
  docBaseUrl: async () => (await docIdentity()).baseUrl,
};

const {
  querySql, selectRows, journalStats, docChanges, isOwner, downloadAttachment, uploadAttachment, listWebhooks,
  createWebhook, webhookConditions, setWebhookEnabled, renameWebhook, deleteWebhook, deleteWebhookWithNotice,
  clearWebhookQueue, postRows, postToHook, publicRecords, publicAccess, shareInfo,
} = createRestPort({ docApi: { fetchRows }, http });
return { fetchRows, apply, readSchema, docIdentity, isReadOnly, withLock, querySql, selectRows, journalStats, docChanges, isOwner, downloadAttachment, uploadAttachment, listWebhooks, createWebhook, webhookConditions, setWebhookEnabled, renameWebhook, deleteWebhook, deleteWebhookWithNotice, clearWebhookQueue, postRows, postToHook, publicRecords, publicAccess, shareInfo };
})();

// ===== js/diagnostic.js =====
__M["js/diagnostic.js"] = (() => {
'use strict';
const {diagnostic: engineDiagnostic} = __M["js/engine/diagnostic.js"];
const {isReadOnly} = __M["js/grist.js"];
const {VERSION, servedFrom} = __M["js/config.js"];

const diagnostic = () => engineDiagnostic({ version: VERSION, served: servedFrom(), readOnly: isReadOnly(), agent: navigator.userAgent });
return { diagnostic };
})();

// ===== js/engine/logic/acl.js =====
__M["js/engine/logic/acl.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, HEX16, KEY_COL, KIND, LIST_COL, LOT_COL, AUTHOR_COL, MISSING_COL, RESEND_COL, TYPE_COL} = __M["js/engine/logic/common.js"];

const PUBLIC_MEMO = 'Synchro : lecture limitée aux exports publics';
const OWNER_MEMO = 'Synchro : réservée aux propriétaires';
const JOURNAL_MEMO = 'Synchro : journaux réservés aux éditeurs';
const LOCK_MEMO = 'Synchro : table reçue en lecture seule';
const KEY_MEMO = 'Synchro : clé de signature cachée aux lecteurs';
const MEMOS = [PUBLIC_MEMO, OWNER_MEMO, JOURNAL_MEMO, LOCK_MEMO, KEY_MEMO];

const isWidgetRule = r => MEMOS.includes(r.memo);
const isPublicRule = r => r.memo === PUBLIC_MEMO;

const VIEWER = 'user.Access == VIEWER';
const EDITOR = 'user.Access == EDITOR';

function publicAclRules(exportIds, { keepDeny = false } = {}) {
  const ids = exportIds.filter(id => HEX16.test(id)).sort();
  if (!ids.length && !keepDeny) return [];
  const rule = (tableId, colIds, aclFormula, permissionsText) => ({ tableId, colIds, aclFormula, permissionsText, memo: PUBLIC_MEMO });
  return [
    ...(ids.length ? [
      rule(__C.SYNC_TABLE, EXPORT_COL, VIEWER, '-R'),
      rule(__C.SYNC_TABLE, '*', `${VIEWER} and rec.${EXPORT_COL} in [${ids.map(id => `"${id}"`).join(', ')}] and rec.${TYPE_COL} in ["${KIND.full}", "${KIND.mark}"]`, '+R'),
    ] : []),
    rule('*', '*', VIEWER, '-R'),
  ];
}

function ownerAclRules(exchangeIds = []) {
  const ids = exchangeIds.filter(id => HEX16.test(id)).sort().map(id => `"${id}"`).join(', ');
  if (!ids) return [{ tableId: __C.SYNC_TABLE, colIds: '*', aclFormula: 'user.Access != OWNER', permissionsText: '-CRUD', memo: OWNER_MEMO }];
  const EXCHANGE_ROWS = `${EDITOR} and rec.${EXPORT_COL} in [${ids}] and rec.${TYPE_COL} in ["${KIND.swap}", "${KIND.lot}"]`;
  const rule = (colIds, aclFormula, permissionsText) => ({ tableId: __C.SYNC_TABLE, colIds, aclFormula, permissionsText, memo: OWNER_MEMO });
  return [
    rule(EXPORT_COL, VIEWER, '-R'),
    rule([LOT_COL, LIST_COL, MISSING_COL, AUTHOR_COL].join(','), EDITOR, '-RU'),
    rule(RESEND_COL, EXCHANGE_ROWS, '+RU'),
    rule('*', EXCHANGE_ROWS, '+R'),
    rule('*', 'user.Access != OWNER', '-CRUD'),
  ];
}

const journalAclRules = journals => [...journals].sort()
  .map(tableId => ({ tableId, colIds: '*', aclFormula: VIEWER, permissionsText: '-R', memo: JOURNAL_MEMO }));

const keyAclRules = tables => [...new Set(tables)].sort()
  .map(tableId => ({ tableId, colIds: KEY_COL, aclFormula: VIEWER, permissionsText: '-R', memo: KEY_MEMO }));

const lockAclRules = tables => [...new Set(tables)].sort()
  .map(tableId => ({ tableId, colIds: '*', aclFormula: 'user.Access != OWNER', permissionsText: '-CUD', memo: LOCK_MEMO }));

function lockedTables({ asked, current, received, released = [] }) {
  const lifted = new Set(released);
  return [...new Set([...asked, ...current.filter(table => received.has(table))])].filter(table => !lifted.has(table)).sort();
}

const lockMirrors = (journals, locked) => journals.filter(({ note }) => !note.verrou && note.tables.some(tb => locked.includes(tb.dest))).map(r => r.journal);

const ruleText = ({ tableId, colIds, aclFormula, permissionsText, memo }) => `${tableId}|${colIds}|${aclFormula}|${permissionsText}|${memo || ''}`;
const currentRules = (resources, rules) => rules.filter(isWidgetRule).sort((a, b) => (a.rulePos || 0) - (b.rulePos || 0))
  .map(r => ({ ...(resources.find(x => x.id === r.resource) || {}), ...r }));

function aclActions(resources, rules, wanted, missing = () => false) {
  if (currentRules(resources, rules).map(ruleText).join('\n') === wanted.map(ruleText).join('\n')) return [];
  const mine = rules.filter(isWidgetRule);
  const others = new Set(rules.filter(r => !isWidgetRule(r)).map(r => r.resource));
  const free = resources.filter(r => r.tableId !== '*' && missing(r.tableId) && !others.has(r.id)).map(r => r.id);
  const actions = [['BulkRemoveRecord', '_grist_ACLRules', mine.map(r => r.id)], ['BulkRemoveRecord', '_grist_ACLResources', free]].filter(a => a[2].length);
  const kept = resources.filter(r => !free.includes(r.id));
  let pos = Math.min(0, ...rules.filter(r => !isWidgetRule(r)).map(r => r.rulePos || 0)) - wanted.length - 1;
  let newRef = 0;
  const added = [];
  const resourceFor = (tableId, colIds) => {
    const found = kept.find(r => r.tableId === tableId && r.colIds === colIds) || added.find(r => r.tableId === tableId && r.colIds === colIds);
    if (found) return found.id;
    added.push({ id: --newRef, tableId, colIds });
    actions.push(['AddRecord', '_grist_ACLResources', newRef, { tableId, colIds }]);
    return newRef;
  };
  const resource = wanted.map(w => resourceFor(w.tableId, w.colIds));
  if (wanted.length) {
    actions.push(['BulkAddRecord', '_grist_ACLRules', wanted.map(() => null), {
      resource, aclFormula: wanted.map(w => w.aclFormula), permissionsText: wanted.map(w => w.permissionsText),
      rulePos: wanted.map(() => ++pos), memo: wanted.map(w => w.memo),
    }]);
  }
  return actions;
}

const deniesRead = p => p === 'none' || /-[A-Z]*R/.test(p || '');
function hiddenTables(resources, rules, tables) {
  const tableOf = id => (resources.find(r => r.id === id) || {}).tableId;
  const denied = new Set(rules.filter(r => !isWidgetRule(r) && deniesRead(r.permissionsText)).map(r => tableOf(r.resource)));
  return tables.filter(table => denied.has(table) || denied.has('*'));
}

const EDITOR_FORMULAS = ['', 'user.Access != OWNER', 'user.Access == EDITOR', 'user.Access in [EDITOR]', 'user.Access in [EDITOR, OWNER]', 'user.Access in [OWNER, EDITOR]'];
const structureSign = p => (p === 'all' ? '+' : p === 'none' ? '-' : (/([+-])[A-Z]*S/.exec(p || '') || [])[1]);
function editorsEditStructure(resources, rules) {
  const defaults = new Set(resources.filter(r => r.tableId === '*' && r.colIds === '*').map(r => r.id));
  const decisive = rules.filter(r => defaults.has(r.resource) && structureSign(r.permissionsText)
    && EDITOR_FORMULAS.includes(String(r.aclFormula || '').replace(/\s+/g, ' ').trim()))
    .sort((a, b) => (a.rulePos || 0) - (b.rulePos || 0))[0];
  return !decisive || structureSign(decisive.permissionsText) === '+';
}
return { PUBLIC_MEMO, OWNER_MEMO, JOURNAL_MEMO, LOCK_MEMO, KEY_MEMO, isWidgetRule, isPublicRule, publicAclRules, ownerAclRules, journalAclRules, keyAclRules, lockAclRules, lockedTables, lockMirrors, ruleText, currentRules, aclActions, hiddenTables, editorsEditStructure };
})();

// ===== js/engine/acl.js =====
__M["js/engine/acl.js"] = (() => {
'use strict';
const {KEY_COL, isUserTable} = __M["js/engine/logic/common.js"];
const {foreignSync, ownsSync} = __M["js/engine/logic/strays.js"];
const {LOCK_MEMO, OWNER_MEMO, aclActions, currentRules, isPublicRule, journalAclRules, keyAclRules, lockAclRules, lockMirrors, lockedTables, ownerAclRules, publicAclRules} = __M["js/engine/logic/acl.js"];
const {failure} = __M["js/engine/errors.js"];
const {apply, fetchRows, page, readSchema} = __M["js/engine/port.js"];
const {updateJournalNote} = __M["js/engine/target/journals.js"];
const {receivedJournals, signedTables} = __M["js/engine/logic/received.js"];
const {createSyncTable, readSourceNote} = __M["js/engine/source/synchro.js"];

async function syncRules({ publicIds = null, open = null, release = [], force = false, strict = false } = {}) {
  if (page.busy() && !force) return false;
  const [schema, resources, rules] = await Promise.all([readSchema(), fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules')]);
  const current = currentRules(resources, rules);
  const publicPart = publicIds === null || open === null
    ? current.filter(isPublicRule).filter(r => r.tableId === '*' || schema.has(r.tableId))
    : publicAclRules(publicIds, { keepDeny: Boolean(open) && current.some(isPublicRule) });
  const journals = receivedJournals(schema).filter(r => r.note.reserve).map(r => r.journal);
  const exchanges = readSourceNote(schema).exports.filter(e => e.echange).map(e => e.id);
  const lockable = receivedJournals(schema).filter(r => r.note.mode !== 'echange');
  const eligible = d => isUserTable(d) && schema.has(d) && schema.columns(d).some(c => c.colId === KEY_COL);
  const destsOf = list => list.flatMap(r => r.note.tables.map(tb => tb.dest)).filter(eligible);
  const locked = lockedTables({
    asked: destsOf(lockable.filter(r => r.note.verrou)), current: current.filter(r => r.memo === LOCK_MEMO).map(r => r.tableId),
    received: new Set(destsOf(lockable)), released: release,
  });
  const wanted = [...publicPart, ...(ownsSync(schema) ? ownerAclRules(exchanges) : []), ...journalAclRules(journals), ...keyAclRules(signedTables(schema)), ...lockAclRules(locked)];
  const actions = aclActions(resources, rules, wanted, id => !schema.has(id));
  if (!actions.length) {
    refusal = null;
    for (const { journal } of receivedJournals(schema).filter(r => r.note.reserve && !r.note.reserved)) {
      await updateJournalNote(journal, n => ({ ...n, reserved: true }));
    }
    for (const journal of lockMirrors(lockable, locked)) await updateJournalNote(journal, n => ({ ...n, verrou: true }));
    return false;
  }
  try {
    await apply(actions);
  } catch (e) {
    console.warn(e);
    refusal = refusalText(e);
    if (strict) throw failure('rulesRefused', { why: refusal });
    return false;
  }
  refusal = null;
  return true;
}

let refusal = null;
const ruleRefusal = () => refusal;
function refusalText(e) {
  const text = String((e && e.message) || e || '');
  const found = /"error":"([^"]+)"/.exec(text);
  return (found ? found[1] : text).replace(/\s+/g, ' ').slice(0, 300);
}

async function protectSync() {
  const schema = await readSchema();
  if (foreignSync(schema)) throw new Error('syncTableForeign');
  const created = await createSyncTable([], schema);
  const posted = await syncRules({ force: true, strict: true });
  return created || posted;
}

async function syncUnprotected() {
  const [schema, resources, rules] = await Promise.all([readSchema(), fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules')]);
  if (foreignSync(schema)) return false; // refusé ailleurs (syncTableForeign)
  return !ownsSync(schema) || !currentRules(resources, rules).some(r => r.memo === OWNER_MEMO);
}
return { syncRules, ruleRefusal, protectSync, syncUnprotected };
})();

// ===== js/engine/form-link.js =====
__M["js/engine/form-link.js"] = (() => {
'use strict';
const {AUTHOR_COL, KEY_COL, randomHex} = __M["js/engine/logic/common.js"];
const {fetchRows, postRows, selectRows, withLock} = __M["js/engine/port.js"];
const {failure} = __M["js/engine/errors.js"];

function testUrl(url, journal) {
  const probe = randomHex(8);
  return withLock('gristsync-consolidation', async () => {
    try {
      await postRows(url, [{ [KEY_COL]: '', [AUTHOR_COL]: probe }]);
    } catch (e) {
      throw e.message === 'otherInstance' ? new Error('linkElsewhere') : failure('linkTest', { detail: e.message });
    }
    const rows = (await selectRows(journal, [AUTHOR_COL])) || await fetchRows(journal);
    if (!rows.some(r => r[AUTHOR_COL] === probe)) throw new Error('linkElsewhere');
  });
}
return { testUrl };
})();

// ===== js/engine/version.js =====
__M["js/engine/version.js"] = (() => {
'use strict';
const ENGINE_VERSION = '5.0.2';

let appVersionValue = ENGINE_VERSION;
const setAppVersion = (version) => {
  if (version !== undefined && (typeof version !== 'string' || !/^[0-9A-Za-z.+_-]{1,32}$/.test(version))) throw new Error(`version invalide : ${JSON.stringify(version)}`);
  appVersionValue = version || ENGINE_VERSION;
};
const appVersion = () => appVersionValue;
return { ENGINE_VERSION, setAppVersion, appVersion };
})();

// ===== js/engine/index.js =====
__M["js/engine/index.js"] = (() => {
'use strict';
const {ENGINE_VERSION, appVersion} = __M["js/engine/version.js"];
const {PORT_SHAPE} = __M["js/engine/port.js"];
const {createRestPort} = __M["js/engine/rest-port.js"];
const {TABLE_PREFIX_RULE} = __M["js/engine/logic/common.js"];
const {setPort} = __M["js/engine/port.js"];
const {setTablePrefix} = __M["js/engine/logic/common.js"];
const {setAppVersion} = __M["js/engine/version.js"];

function startEngine({ port, prefix = '', version } = {}) {
  setTablePrefix(prefix);
  setAppVersion(version);
  setPort(port);
}
return { startEngine, ENGINE_VERSION, appVersion, PORT_SHAPE, createRestPort, TABLE_PREFIX_RULE };
})();

// ===== js/engine/logic/clean.js =====
__M["js/engine/logic/clean.js"] = (() => {
'use strict';
const {BEFORE_COL, DATA_COL, STATE_COL, isBlank} = __M["js/engine/logic/common.js"];
const {STATES, latestByKey, rowsByTable} = __M["js/engine/logic/journal.js"];

const GONE_STATES = ['suppression', 'partie'];

function cleanPlan(journalRows, { hub = false } = {}) {
  const before = journalRows.filter(r => !isBlank(r[BEFORE_COL]) && STATES.includes(r[STATE_COL])).map(r => r.id);
  const values = [];
  if (!hub) {
    for (const rows of rowsByTable(journalRows).values()) {
      for (const version of latestByKey(rows).values()) {
        if (GONE_STATES.includes(version.row[STATE_COL]) && !isBlank(version.row[DATA_COL])) values.push(version.id);
      }
    }
  }
  return { before, values };
}
return { GONE_STATES, cleanPlan };
})();

// ===== js/engine/logic/estimate.js =====
__M["js/engine/logic/estimate.js"] = (() => {
'use strict';
const {LOT_MAX} = __M["js/engine/logic/formulas.js"];
const {BUDGET_WINDOW, RESEND_BUDGET, RESEND_CHUNK, nextChunkSize} = __M["js/engine/logic/resend.js"];

const LINE_OVERHEAD = 64;
const LOT_SECONDS = 1;

function lineBytes(sample) {
  const lines = sample.filter(Boolean);
  if (!lines.length) return LINE_OVERHEAD;
  const total = lines.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  return Math.ceil(total / lines.length) + LINE_OVERHEAD;
}

function tableCost({ rows, bytesPerLine }) {
  const fit = Math.floor(LOT_MAX / Math.max(1, bytesPerLine));
  const cutFirst = rows > 0 && fit < RESEND_CHUNK ? 1 : 0;
  const per = cutFirst ? Math.max(1, nextChunkSize(RESEND_CHUNK, RESEND_CHUNK, fit)) : RESEND_CHUNK;
  const lots = rows > 0 ? Math.ceil(rows / per) + cutFirst : 0;
  return { rows, bytes: Math.ceil(rows * bytesPerLine + cutFirst * Math.min(LOT_MAX, RESEND_CHUNK * bytesPerLine)), lots, perLot: per };
}

function estimateSend({ tables, recipients = 1 }) {
  const costs = tables.map(tableCost);
  const sum = key => costs.reduce((n, c) => n + c[key], 0);
  const copies = Math.max(1, recipients);
  const bytes = sum('bytes') * copies;
  const lots = sum('lots');
  const seconds = Math.round(Math.max(lots * LOT_SECONDS, (bytes / RESEND_BUDGET - 1) * BUDGET_WINDOW));
  return { rows: sum('rows'), bytes, lots, seconds: Math.max(0, seconds), recipients: copies };
}

function durationParts(seconds) {
  const minutes = seconds / 60;
  if (minutes < 1) return { h: 0, min: 0 };
  const step = minutes <= 10 ? 1 : minutes <= 60 ? 5 : 10;
  const rounded = Math.max(1, Math.round(minutes / step) * step);
  return { h: Math.floor(rounded / 60), min: rounded % 60 };
}

function sizeParts(bytes) {
  return bytes >= 1000000 ? { n: Math.round(bytes / 1000000), unit: 'MB' } : { n: Math.max(1, Math.round(bytes / 1000)), unit: 'KB' };
}

const LONG_SECONDS = 180;
return { LINE_OVERHEAD, LOT_SECONDS, lineBytes, tableCost, estimateSend, durationParts, sizeParts, LONG_SECONDS };
})();

// ===== js/engine/logic/keys.js =====
__M["js/engine/logic/keys.js"] = (() => {
'use strict';
const {KEY_COL, isBlank, isSafeId, chunk} = __M["js/engine/logic/common.js"];

const keyCountSql = table => (isSafeId(table)
  ? `select count(*) as n, sum(case when trim("${KEY_COL}") is null or trim("${KEY_COL}") = '' then 1 else 0 end) as blank, count(distinct case when trim("${KEY_COL}") = '' then null else "${KEY_COL}" end) as keys from "${table}"`
  : null);

function keyCounts(result) {
  const rows = Number(result && result.n) || 0;
  const blank = Number(result && result.blank) || 0;
  const keys = Number(result && result.keys) || 0;
  const dup = Math.max(0, rows - blank - keys);
  return blank || dup ? { rows, blank, dup } : null;
}

function keyProblems(rows) {
  const groups = new Map();
  const blank = [];
  for (const row of rows) {
    if (isBlank(row[KEY_COL])) blank.push(row.id);
    else groups.set(row[KEY_COL], [...(groups.get(row[KEY_COL]) || []), row.id]);
  }
  const dup = [];
  const keep = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const [first, ...others] = ids.sort((a, b) => a - b);
    keep.push(first);
    dup.push(...others);
  }
  return { blank, dup, keep, touch: [...blank, ...dup, ...keep] };
}

function repairActions(table, { blank, dup, keep }, { newId, now, order }) {
  const fresh = [...blank, ...dup];
  return [
    ...chunk(fresh).map(ids => ['BulkUpdateRecord', table, ids, { [KEY_COL]: ids.map(() => newId()), [order]: ids.map(() => now) }]),
    ...chunk(keep).map(ids => ['BulkUpdateRecord', table, ids, { [order]: ids.map(() => now) }]),
  ];
}
return { keyCountSql, keyCounts, keyProblems, repairActions };
})();

// ===== js/engine/logic/new-columns.js =====
__M["js/engine/logic/new-columns.js"] = (() => {
'use strict';
const {exportableColumns} = __M["js/engine/logic/exports.js"];
const {noteSent} = __M["js/engine/logic/descriptions.js"];
const {formulasOffered} = __M["js/engine/logic/column-formulas.js"];
const {layoutSent} = __M["js/engine/logic/layout.js"];

const knownColumns = (schema, tables) => Object.fromEntries(tables.filter(tb => schema.has(tb.table))
  .map(tb => [tb.table, exportableColumns(schema.columns(tb.table)).map(c => c.id)]));

function newColumns(schema, tables, known) {
  if (!known) return [];
  return tables.filter(tb => schema.has(tb.table) && Array.isArray(known[tb.table])).flatMap(({ table, columns }) => {
    const sent = new Set(columns.map(c => c.id));
    const old = new Set(known[table]);
    const fresh = exportableColumns(schema.columns(table)).filter(c => !sent.has(c.id) && !old.has(c.id));
    return fresh.length ? [{ table, columns: fresh.map(c => ({ id: c.id, type: c.source || c.type })) }] : [];
  });
}

function exportFlags(tables) {
  const columns = tables.flatMap(tb => tb.columns);
  const sent = noteSent(columns);
  return { links: columns.some(c => c.link), style: columns.some(c => c.fmt), notes: sent.notes, tableNote: sent.table, layout: layoutSent(columns), formulas: formulasOffered(columns) };
}

const widenedSelection = (tables, additions) => tables.map(({ table, columns, filter }) => ({
  table, filter: filter || null,
  columns: [...columns.map(c => c.id), ...(additions.find(a => a.table === table)?.columns || [])],
}));
return { knownColumns, newColumns, exportFlags, widenedSelection };
})();

// ===== js/engine/source/actions.js =====
__M["js/engine/source/actions.js"] = (() => {
'use strict';
const {RESEND_ALL} = __M["js/engine/logic/common.js"];
const {buildInvitation} = __M["js/engine/logic/codes.js"];
const {rowsSince} = __M["js/engine/logic/resend.js"];
const {docIdentity, fetchRows, readSchema, setWebhookEnabled} = __M["js/engine/port.js"];
const {removeTechnicalTables} = __M["js/engine/pages.js"];
const {dropInvitation, setExport, setPause} = __M["js/engine/logic/notes.js"];
const {closeExport, removeRecipient} = __M["js/engine/exchange.js"];
const {hookLabel} = __M["js/engine/logic/exports.js"];
const {readSourceNote, recordEvent, saveExport, sourceFrom, updateSourceNote} = __M["js/engine/source/synchro.js"];
const {resendTables} = __M["js/engine/source/resend.js"];
const {pauseHook} = __M["js/engine/source/pausing.js"];

const AFTER_S = 0.0001; // juste après l'heure de la pause (MajLe en secondes)
const who = h => hookLabel(h.fields.memo);

const pauseRecipient = (exp, h) => pauseHook(exp.id, exp.tables, h);

async function resumePlan(exp, h) {
  const entry = readSourceNote(await readSchema()).pauses.find(p => p.hook === h.id);
  const all = !entry || entry.columns !== JSON.stringify(exp.tables);
  const since = all ? RESEND_ALL : entry.at + AFTER_S; // MajLe plus récente que la pause
  let n = 0;
  for (const { table } of exp.tables) n += rowsSince(await fetchRows(table), since).length;
  return { since, n, all };
}

async function resumeRecipient(exp, h, { catchup, since }, progress) {
  await setWebhookEnabled(h.id, true);
  await updateSourceNote(note => setPause(note, h.id));
  await recordEvent(exp.id, 'resume', { who: who(h) });
  if (catchup) await resendTables(exp.id, exp.tables.map(tb => tb.table), progress, since);
}

const revokesOne = exp => Boolean(exp.echange && !exp.retour && exp.recipients.length > 1);

async function revokeRecipient(exp, h) {
  await recordEvent(exp.id, 'revoke', { who: who(h) });
  if (exp.echange && !revokesOne(exp)) await closeExport(exp.id, { keepExport: !exp.retour });
  else await removeRecipient(exp.id, h);
}

async function cancelPendingInvitation(inv) {
  await updateSourceNote(note => dropInvitation(note, inv.id));
  if (inv.journal) await removeTechnicalTables([inv.journal]);
}

const endExport = exp => closeExport(exp.id, { keepExport: false });

async function publicCode(exp, version) {
  const identity = await docIdentity();
  const { origin, baseUrl } = identity;
  return buildInvitation({ id: exp.id, exportId: exp.id, name: exp.name, origin, base: baseUrl, from: await sourceFrom(exp.email, identity), tables: exp.tables, version });
}

async function stopPublicShare(exp) {
  await updateSourceNote(note => setExport(note, exp.id, { public: false }));
  await saveExport(exp.id, exp.tables, { isPublic: false });
}
return { pauseRecipient, resumePlan, resumeRecipient, revokesOne, revokeRecipient, cancelPendingInvitation, endExport, publicCode, stopPublicShare };
})();

// ===== js/engine/source/estimate.js =====
__M["js/engine/source/estimate.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, LIST_COL, TABLE_COL, TYPE_COL} = __M["js/engine/logic/common.js"];
const {estimateSend, lineBytes} = __M["js/engine/logic/estimate.js"];
const {eligibleRows} = __M["js/engine/logic/resend.js"];
const {fetchRows, selectRows} = __M["js/engine/port.js"];
const {readHooks} = __M["js/engine/source/synchro.js"];

async function exportEstimate(exp) {
  const sync = (await selectRows(__C.SYNC_TABLE, [EXPORT_COL, TABLE_COL, TYPE_COL, LIST_COL])) || [];
  const recipients = (await readHooks()).of(exp.id).filter(h => h.fields.enabled).length;
  const tables = [];
  for (const tb of exp.tables) {
    const tableRows = await fetchRows(tb.table);
    const ids = tb.columns.map(c => c.id);
    const sample = tableRows.slice(0, 50).map(r => Object.fromEntries(ids.map(id => [id, r[id]])));
    tables.push({ rows: eligibleRows(sync, exp.id, tb.table) ?? tableRows.length, bytesPerLine: lineBytes(sample), all: tableRows.length });
  }
  return { ...estimateSend({ tables, recipients: Math.max(1, recipients) }), all: tables.reduce((n, tb) => n + tb.all, 0) };
}
return { exportEstimate };
})();

// ===== js/engine/source/export.js =====
__M["js/engine/source/export.js"] = (() => {
'use strict';
const {nowS, randomHex} = __M["js/engine/logic/common.js"];
const {exportEmail, exportableColumns, hookName, pruneRules, readTables, withDoc} = __M["js/engine/logic/exports.js"];
const {tableNoteOf, withTableNote} = __M["js/engine/logic/descriptions.js"];
const {withLayout} = __M["js/engine/logic/layout.js"];
const {withFormulas} = __M["js/engine/logic/column-formulas.js"];
const {docFormatOf} = __M["js/engine/logic/docformat.js"];
const {linkTables} = __M["js/engine/logic/links.js"];
const {hiddenTables} = __M["js/engine/logic/acl.js"];
const {putExport} = __M["js/engine/logic/notes.js"];
const {knownColumns} = __M["js/engine/logic/new-columns.js"];
const {exchangeRules} = __M["js/engine/logic/consolidation.js"];
const {STATES} = __M["js/engine/logic/journal.js"];
const {fillKeyActions, missingSyncColumns, prepareSourceActions} = __M["js/engine/logic/formulas.js"];
const {receivedDests} = __M["js/engine/logic/received.js"];
const {apply, fetchRows, readSchema, renameWebhook} = __M["js/engine/port.js"];
const {failure} = __M["js/engine/errors.js"];
const {recordEvent, saveExport, syncRows, updateSourceNote} = __M["js/engine/source/synchro.js"];
const {resendTables} = __M["js/engine/source/resend.js"];

async function prepareTables(selection, links, { style = false, notes = false, tableNote = false, layout = false, formulas = false } = {}) {
  const schema = await readSchema();
  const doc = style ? docFormatOf(await fetchRows('_grist_DocInfo')) : null;
  const sections = tableNote || layout ? await fetchRows('_grist_Views_section') : [];
  const fields = layout ? await fetchRows('_grist_Views_section_field') : [];
  const relays = receivedDests(schema).map(d => d.dest);
  const tables = [];
  for (const { table, columns: picked, filter } of selection) {
    await apply(prepareSourceActions(table, missingSyncColumns(schema.columns(table))));
    if (!relays.includes(table)) await apply(fillKeyActions(table, await fetchRows(table), () => crypto.randomUUID()));
    const columns = exportableColumns(schema.columns(table), { extras: style, doc, notes }).filter(c => picked.includes(c.id));
    const styled = style ? withDoc(pruneRules(columns), doc) : columns;
    const noted = tableNote ? withTableNote(styled, tableNoteOf(schema.table(table), sections)) : styled;
    const calculated = formulas ? withFormulas(noted, schema.columns(table)) : noted;
    tables.push({ table, columns: layout ? withLayout(calculated, schema.columns(table), schema.table(table), sections, fields) : calculated, filter: filter || null });
  }
  return linkTables(tables, links instanceof Set || Array.isArray(links) ? links : Boolean(links));
}

async function refuseHidden(tables) {
  const [resources, rules] = await Promise.all([fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules')]);
  const hidden = hiddenTables(resources, rules, readTables(tables));
  if (hidden.length) throw failure('publicHiddenEdit', { tables: hidden.join(', ') });
}

async function noteExport(rules, id, name, extra = {}) {
  const kept = rules ? exchangeRules({ regles: rules, refus: rules.refus }) : undefined;
  await updateSourceNote((note) => {
    const entry = { at: nowS(), ...note.exports.find(e => e.id === id), id, name, ...extra };
    if (rules) Object.assign(entry, { regles: kept ? Object.fromEntries(STATES.map(st => [st, kept[st]])) : undefined, refus: kept?.refus });
    return putExport(note, JSON.parse(JSON.stringify(entry)));
  });
}

async function saveChosenExport({ exp = null, name, selection, links = false, style = false, notes = false, tableNote = false, layout = false, formulas = false, rules = null, autoCols = false }) {
  const sends = !exp?.echange;
  const tables = await prepareTables(selection, links, { style: style && sends, notes: notes && sends, tableNote: tableNote && sends, layout: layout && sends, formulas: formulas && sends });
  if (exp?.public) await refuseHidden(tables);
  const id = exp ? exp.id : randomHex(8);
  const changed = await saveExport(id, tables, { isPublic: Boolean(exp?.public), swap: Boolean(exp?.echange) });
  await noteExport(rules, id, name, { known: knownColumns(await readSchema(), tables), autoCols: autoCols && sends ? true : undefined });
  const created = exp ? null : { id, name, tables, recipients: [], invitations: [], public: false, email: exportEmail(await syncRows(), id) };
  return { id, name, tables, changed, created };
}

async function finishEdit(exp, { name, changed }, progress) {
  await recordEvent(exp.id, changed.length ? 'editSent' : 'edit', { n: changed.length });
  if (name !== exp.name) for (const h of exp.recipients) await renameWebhook(h.id, hookName(name, exp.id));
  return changed.length ? resendTables(exp.id, changed, progress) : 0;
}
return { saveChosenExport, finishEdit };
})();

// ===== js/engine/target/clean.js =====
__M["js/engine/target/clean.js"] = (() => {
'use strict';
const {BEFORE_COL, DATA_COL, SEAL_COL, chunk, nowS} = __M["js/engine/logic/common.js"];
const {cleanPlan} = __M["js/engine/logic/clean.js"];
const {journalNote} = __M["js/engine/logic/received.js"];
const {sealRows} = __M["js/engine/logic/trust.js"];
const {apply, fetchRows, readSchema, withLock} = __M["js/engine/port.js"];
const {updateJournalNote} = __M["js/engine/target/journals.js"];
const {sealing, sealsSeen} = __M["js/engine/target/loop.js"];

const cleanJournal = journal => withLock('gristsync-consolidation', async () => {
  const schema = await readSchema();
  const note = journalNote(schema, journal);
  if (!note || !note.export || !Array.isArray(note.tables)) return null;
  const rows = await fetchRows(journal);
  const plan = cleanPlan(rows, { hub: note.mode === 'echange' });
  const { seal } = await sealing(schema, journal, note);
  const byId = new Map(rows.map(r => [r.id, r]));
  const blanked = seal ? await sealRows(plan.values.map(id => ({ ...byId.get(id), [DATA_COL]: '' })), note.export, seal) : plan.values.map(id => ({ ...byId.get(id), [DATA_COL]: '' }));
  const actions = [
    ...chunk(plan.before).map(part => ['BulkUpdateRecord', journal, part, { [BEFORE_COL]: part.map(() => '') }]),
    ...chunk(blanked).map(part => ['BulkUpdateRecord', journal, part.map(r => r.id), {
      [DATA_COL]: part.map(() => ''),
      ...(seal ? { [SEAL_COL]: part.map(r => r[SEAL_COL]) } : {}),
    }]),
  ];
  if (actions.length) await apply(actions);
  sealsSeen.delete(journal);
  await updateJournalNote(journal, n => ({ ...n, histo: Math.floor(nowS()) }));
  return { before: plan.before.length, values: plan.values.length };
});
return { cleanJournal };
})();

// ===== js/engine/source/history.js =====
__M["js/engine/source/history.js"] = (() => {
'use strict';
const {clearEvents} = __M["js/engine/logic/notes.js"];
const {receivedJournals} = __M["js/engine/logic/received.js"];
const {readSchema} = __M["js/engine/port.js"];
const {cleanJournal} = __M["js/engine/target/clean.js"];
const {updateSourceNote} = __M["js/engine/source/synchro.js"];

async function clearExportHistory(exportId) {
  await updateSourceNote(note => clearEvents(note, exportId));
  const back = receivedJournals(await readSchema()).filter(r => r.note.retour && r.note.export === exportId);
  const total = { before: 0, values: 0 };
  for (const { journal } of back) {
    const done = await cleanJournal(journal);
    if (done) { total.before += done.before; total.values += done.values; }
  }
  return total;
}
return { clearExportHistory };
})();

// ===== js/engine/source/hook-check.js =====
__M["js/engine/source/hook-check.js"] = (() => {
'use strict';
const {parseWebhookUrl} = __M["js/engine/logic/codes.js"];
const {pool} = __M["js/engine/logic/common.js"];
const {hookLabel} = __M["js/engine/logic/exports.js"];
const {memoMatches} = __M["js/engine/logic/trust.js"];
const {docIdentity, shareInfo} = __M["js/engine/port.js"];

const CHECK_MS = 3600000;
const CHECK_AT_ONCE = 6; // contrôles de lien simultanés au plus
const checked = new Map(); // webhook -> { at, url, other : document désigné à la place, ou '' ; bad ; docName }
const checking = new Set(); // webhooks dont le contrôle est en cours

const hookCheck = id => checked.get(id) || {};
const personLabel = h => hookLabel(h.fields.memo, hookCheck(h.id).docName) || '—';

async function checkHooks(hooks) {
  const { origin } = await docIdentity();
  const due = hooks.filter((h) => {
    const was = checked.get(h.id);
    return !checking.has(h.id) && (!was || was.url !== h.fields.url || Date.now() - was.at > CHECK_MS);
  });
  if (!due.length) return false;
  for (const h of due) checking.add(h.id);
  let changed = false;
  const note = (h, result) => {
    const was = checked.get(h.id) || { other: '', bad: false };
    const label = personLabel(h);
    checked.set(h.id, { at: Date.now(), url: h.fields.url, ...result });
    changed ||= was.other !== result.other || was.bad !== result.bad || label !== personLabel(h);
  };
  await pool(due, CHECK_AT_ONCE, async (h) => {
    try {
      const target = parseWebhookUrl(h.fields.url);
      if (!target || !target.flat || target.origin !== origin) return note(h, { other: '', bad: true });
      const info = await shareInfo(h.fields.url).catch(() => undefined);
      if (info === undefined) return undefined; // Grist ne répond pas : au prochain affichage
      const other = info && !memoMatches(h.fields.memo, info.docId) ? info.name || info.docId : '';
      return note(h, { other, bad: false, docName: info && !other ? info.name : '' });
    } finally {
      checking.delete(h.id);
    }
  });
  return changed;
}
return { hookCheck, personLabel, checkHooks };
})();

// ===== js/engine/source/invite.js =====
__M["js/engine/source/invite.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {journalId, nowS, randomHex, sha256} = __M["js/engine/logic/common.js"];
const {buildInvitation, buildWebhookUrl, loopingTables, parseFormLink, parseReply} = __M["js/engine/logic/codes.js"];
const {exportCondition, exportEmail, hookLabel, hookMemo, hookName, memoDoc, readTables} = __M["js/engine/logic/exports.js"];
const {dropInvitation, putInvitation, setExport, setPause} = __M["js/engine/logic/notes.js"];
const {codeFacts, controlCode, expiresAt, isExpired, isPrivateKey, linkKeys, newKeyPair, sameDoc} = __M["js/engine/logic/trust.js"];
const {hiddenTables} = __M["js/engine/logic/acl.js"];
const {receivedDests} = __M["js/engine/logic/received.js"];
const {createWebhook, deleteWebhook, docIdentity, fetchRows, readSchema, shareInfo, t} = __M["js/engine/port.js"];
const {appVersion} = __M["js/engine/version.js"];
const {failure} = __M["js/engine/errors.js"];
const {testUrl} = __M["js/engine/form-link.js"];
const {addDeleteColumns, markHub} = __M["js/engine/exchange.js"];
const {createJournal, storeKey, updateJournalNote} = __M["js/engine/target/journals.js"];
const {pruneKeys, putRecipientKey, readHooks, recordEvent, rememberDest, saveExport, sourceFrom, syncRows, updateSourceNote} = __M["js/engine/source/synchro.js"];
const {publicCode} = __M["js/engine/source/actions.js"];
const {resendTables} = __M["js/engine/source/resend.js"];
const {exportEstimate} = __M["js/engine/source/estimate.js"];

const invitationState = (inv, now = nowS()) => (inv.journal && !inv.ready ? 'link' : isExpired(inv.at, now) ? 'expired' : 'valid');

async function withKeys(entry) {
  if (isPrivateKey(entry.prive) && entry.pub) return entry;
  const { pub, priv } = await newKeyPair();
  return { ...entry, pub, prive: priv };
}

async function startInvitation(exp, { renforce = false, replaces = '' } = {}) {
  let current = exp;
  if (renforce && !exp.renforce) {
    await updateSourceNote(note => setExport(note, exp.id, { renforce: true }));
    current = { ...exp, renforce: true };
  }
  const secret = randomHex(16);
  const entry = await withKeys({ id: randomHex(8), export: exp.id, hash: await sha256(secret), at: nowS(), ...(renforce ? { renforce: true } : {}), ...(replaces ? { replaces } : {}) });
  await updateSourceNote(note => putInvitation(note, entry));
  return { exp: current, entry, secret };
}

const canReinforce = (exp, hook) => Boolean(!exp.echange && !exp.public && hook && hook.fields.enabled);
async function startReinforcement(exp, hook) {
  if (!canReinforce(exp, hook)) throw new Error('reinforceNot');
  return startInvitation(exp, { renforce: Boolean(exp.renforce), replaces: hook.id });
}

async function replacedHook(exp, inv, reply) {
  if (!inv.replaces) return null;
  const old = (await readHooks()).of(exp.id).find(h => h.id === inv.replaces);
  if (!old) return null;
  const { docId } = memoDoc(old.fields.memo);
  if (docId && !sameDoc(reply.share.docId, docId)) throw new Error('reinforceOtherDoc');
  return old;
}

async function invitationCode(exp, entry, secret, retour = '') {
  const [identity, rows] = await Promise.all([docIdentity(), syncRows()]);
  const { origin } = identity;
  const expire = expiresAt(entry.at);
  const code = buildInvitation({
    id: entry.id, exportId: exp.id, name: exp.name, origin, secret, from: await sourceFrom(exportEmail(rows, exp.id), identity), tables: exp.tables, retour,
    expire, renforce: Boolean(entry.renforce), pub: entry.pub, version: appVersion(),
  });
  return { code, expire, backCode: retour ? await controlCode(retour, secret, codeFacts(entry)) : null };
}

async function renewInvitation(inv) {
  if (inv.journal) return null;
  const secret = randomHex(16);
  const entry = await withKeys({ ...inv, hash: await sha256(secret), at: nowS() });
  await updateSourceNote(note => putInvitation(note, entry));
  return { entry, secret };
}

async function enablePublicLink(exp) {
  const [resources, rules] = await Promise.all([fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules')]);
  const hidden = hiddenTables(resources, rules, readTables(exp.tables));
  if (hidden.length) throw failure('publicHidden', { tables: hidden.join(', ') });
  await updateSourceNote(note => setExport(note, exp.id, { public: true }));
  await saveExport(exp.id, exp.tables, { isPublic: true });
  return publicCode(exp, appVersion());
}

async function startReturn(exp, { renforce = false } = {}) {
  let current = exp;
  if (renforce && !exp.renforce) {
    await updateSourceNote(note => setExport(note, exp.id, { renforce: true }));
    current = { ...exp, renforce: true };
  }
  const journal = journalId(exp.name, (await readSchema()).tableIds);
  const entry = await withKeys({ id: randomHex(8), export: exp.id, hash: '', at: nowS(), journal, ...(renforce ? { renforce: true } : {}) });
  await createJournal(journal, {
    id: entry.id, export: exp.id, name: exp.name, secret: '', from: {}, mode: 'echange', retour: true, reserve: true, tables: [], refused: [], missing: {},
  });
  await updateSourceNote(note => putInvitation(note, entry));
  return { exp: current, entry };
}

async function linkReturn(inv, link) {
  if (!parseFormLink(link)) throw new Error('formLink');
  const retour = buildWebhookUrl(link, inv.journal);
  await testUrl(retour, inv.journal);
  const secret = randomHex(16);
  const entry = await withKeys({ ...inv, hash: await sha256(secret), at: nowS(), ready: true });
  await updateSourceNote(note => putInvitation(note, entry));
  return { entry, secret, retour };
}

async function checkReply(exp, inv, text) {
  const reply = parseReply(text, (await docIdentity()).origin, appVersion());
  if (reply.id !== inv.id || inv.hash !== (reply.secret ? await sha256(reply.secret) : '')) throw new Error('unknownInvitation');
  if (!isPrivateKey(inv.prive)) throw new Error('inviteOld');
  if (isExpired(inv.at, nowS())) throw new Error('invitationExpired');
  if (loopingTables(exp.tables.map(tb => tb.table), reply.recipient.docId, receivedDests(await readSchema())).length) throw new Error('loop');
  if (Boolean(inv.journal) !== Boolean(reply.retour) || (reply.retour || []).some(b => !exp.tables.some(tb => tb.table === b.dest))) throw new Error('codeInvalid');
  const share = await shareInfo(reply.url);
  if (!share) throw new Error('shareUnknown');
  if (!sameDoc(share.docId, reply.recipient.docId)) throw new Error('shareOtherDoc');
  return {
    ...reply, share, keys: await linkKeys(inv.prive, reply.pub, exp.id, inv.id), code: await controlCode(reply.url, reply.secret, codeFacts(inv, reply.pub)),
    tables: reply.retour ? reply.retour.map(b => t('send.exchange.map', b)).join(', ') : exp.tables.map(tb => tb.table).join(', '),
  };
}

async function approveReply(exp, inv, reply, { compared = false } = {}) {
  if (inv.renforce && !compared) throw new Error('codeNotCompared');
  const r = reply.recipient;
  const old = await replacedHook(exp, inv, reply);
  await putRecipientKey(exp.id, inv.id, reply.keys.down);
  const memo = hookMemo({ ...r, docName: reply.share.name });
  const hook = await createWebhook({ name: hookName(exp.name, exp.id), memo: await rememberDest(memo), url: reply.url, tableId: __C.SYNC_TABLE, condition: exportCondition(exp.id) });
  await recordEvent(exp.id, old ? 'reinforce' : 'join', { who: hookLabel(memo) });
  await putRecipientKey(exp.id, hook, reply.keys.down, inv.id);
  if (old) await deleteWebhook(old.id);
  if (inv.journal) {
    await addDeleteColumns(exp.tables.map(tb => tb.table));
    await saveExport(exp.id, exp.tables, { swap: true });
    await storeKey(exp.tables.map(tb => tb.table), inv.journal, reply.keys.up);
    await updateJournalNote(inv.journal, n => ({
      ...n, from: { email: r.email, docId: r.docId, docName: reply.share.name }, hook, tables: reply.retour.map(b => ({ table: b.table, dest: b.dest, columns: [], own: [] })),
    }));
    await markHub(exp.id);
  }
  await updateSourceNote((note) => {
    const rest = dropInvitation(note, inv.id);
    const kept = old ? setPause(rest, old.id) : rest;
    return inv.journal ? setExport(kept, exp.id, { echange: true }) : kept;
  });
  await pruneKeys(exp.id);
  return hook;
}

async function loadPlan(exp) {
  let total = 0;
  for (const { table } of exp.tables) total += (await fetchRows(table)).length;
  const est = total ? await exportEstimate(exp).catch(() => null) : null;
  return { total, est, count: est ? est.rows : total };
}

const sendExisting = (exp, progress) => resendTables(exp.id, exp.tables.map(tb => tb.table), progress);

const controlResend = (exp, inv, progress) => resendTables(exp.id, exp.tables.map(tb => tb.table), progress, inv.at);
return { invitationState, startInvitation, canReinforce, startReinforcement, invitationCode, renewInvitation, enablePublicLink, startReturn, linkReturn, checkReply, approveReply, loadPlan, sendExisting, controlResend };
})();

// ===== js/engine/source/keys.js =====
__M["js/engine/source/keys.js"] = (() => {
'use strict';
const {KEY_COL, ORDER_COL, chunk, nowS} = __M["js/engine/logic/common.js"];
const {fillKeyActions, missingSyncColumns, prepareSourceActions} = __M["js/engine/logic/formulas.js"];
const {keyCountSql, keyCounts, keyProblems, repairActions} = __M["js/engine/logic/keys.js"];
const {apply, fetchRows, querySql, readSchema, selectRows} = __M["js/engine/port.js"];

const CHECK_MS = 60000;
const checked = new Map(); // table -> { at, counts }

async function checkKeys(tables) {
  const found = new Map();
  const schema = await readSchema();
  await Promise.all([...new Set(tables)].filter(table => schema.has(table)).map(async (table) => {
    const missing = missingSyncColumns(schema.columns(table));
    const was = checked.get(table);
    let counts = was && Date.now() - was.at < CHECK_MS ? was.counts : undefined;
    if (counts === undefined) {
      const sql = missing.includes(KEY_COL) ? null : keyCountSql(table);
      const rows = sql ? await querySql(sql) : null;
      if (!rows && !missing.length) return; // Grist refuse (table absente, droits) : rien n'est dit
      counts = rows ? keyCounts(rows[0]) : null;
      checked.set(table, { at: Date.now(), counts });
    }
    if (counts || missing.length) found.set(table, { rows: 0, blank: 0, dup: 0, ...counts, missing });
  }));
  return found;
}

const keyRows = async table => (await selectRows(table, [KEY_COL])) || fetchRows(table);

async function repairKeys(table) {
  const missing = missingSyncColumns((await readSchema()).columns(table));
  if (missing.length) {
    await apply(prepareSourceActions(table, missing));
    checked.delete(table);
    if (missing.includes(KEY_COL)) {
      const rows = await fetchRows(table);
      await apply(fillKeyActions(table, rows, () => crypto.randomUUID()));
      const now = nowS();
      await apply(chunk(rows.map(r => r.id)).map(ids => ['BulkUpdateRecord', table, ids, { [ORDER_COL]: ids.map(() => now) }]));
      return rows.length;
    }
  }
  const problems = keyProblems(await keyRows(table));
  if (!problems.touch.length) return 0;
  await apply(repairActions(table, problems, { newId: () => crypto.randomUUID(), now: nowS(), order: ORDER_COL }));
  checked.delete(table);
  return problems.touch.length;
}
return { checkKeys, repairKeys };
})();

// ===== js/engine/source/new-columns.js =====
__M["js/engine/source/new-columns.js"] = (() => {
'use strict';
const {exportFlags, knownColumns, newColumns, widenedSelection} = __M["js/engine/logic/new-columns.js"];
const {setExport} = __M["js/engine/logic/notes.js"];
const {readSchema, withLock} = __M["js/engine/port.js"];
const {finishEdit, saveChosenExport} = __M["js/engine/source/export.js"];
const {readSourceNote, updateSourceNote} = __M["js/engine/source/synchro.js"];

const LOCK = 'gristsync-new-columns';
const tracked = exp => !exp.retour && !exp.echange;

async function baselineNewColumns(exports) {
  const missing = exp => exp.tables.filter(tb => !Array.isArray((exp.known || {})[tb.table]));
  if (!exports.some(exp => tracked(exp) && missing(exp).length)) return false;
  const schema = await readSchema();
  const due = exports.filter(exp => tracked(exp) && missing(exp).some(tb => schema.has(tb.table)));
  if (!due.length) return false;
  await updateSourceNote(note => due.reduce((next, exp) => setExport(next, exp.id, { known: { ...(exp.known || {}), ...knownColumns(schema, exp.tables.filter(tb => !Array.isArray((exp.known || {})[tb.table]))) } }), note));
  return true;
}

async function pendingColumns(exp) {
  if (!tracked(exp)) return [];
  const schema = await readSchema();
  const entry = readSourceNote(schema).exports.find(e => e.id === exp.id) || {};
  return newColumns(schema, exp.tables, entry.known);
}

async function sendNewColumns(exp, progress) {
  return withLock(LOCK, async () => {
    const additions = (await pendingColumns(exp)).map(({ table, columns }) => ({ table, columns: columns.map(c => c.id) }));
    if (!additions.length) return false;
    const saved = await saveChosenExport({
      exp, name: exp.name, selection: widenedSelection(exp.tables, additions), ...exportFlags(exp.tables), autoCols: Boolean(exp.autoCols),
    });
    return finishEdit(exp, { name: exp.name, changed: saved.changed }, progress);
  });
}

async function dismissNewColumns(exp) {
  const schema = await readSchema();
  await updateSourceNote(note => setExport(note, exp.id, { known: knownColumns(schema, exp.tables) }));
}

async function autoSendNewColumns(exports) {
  let sent = false;
  for (const exp of exports.filter(e => tracked(e) && e.autoCols && (e.fresh === undefined || e.fresh.length))) sent = (await sendNewColumns(exp)) !== false || sent;
  return sent;
}
return { baselineNewColumns, pendingColumns, sendNewColumns, dismissNewColumns, autoSendNewColumns };
})();

// ===== js/engine/target/dest.js =====
__M["js/engine/target/dest.js"] = (() => {
'use strict';
const {EXPORT_COL, TABLE_COL} = __M["js/engine/logic/common.js"];
const {destProblem} = __M["js/engine/logic/journal.js"];
const {receivedDests} = __M["js/engine/logic/received.js"];
const {docIdentity} = __M["js/engine/port.js"];
const {failure} = __M["js/engine/errors.js"];
const {syncRows} = __M["js/engine/source/synchro.js"];

async function checkDests(schema, plans, fromDocId, exportId = null) {
  const problem = destProblem(plans, receivedDests(schema));
  if (problem) throw failure(problem.code, problem.vars);
  const dests = plans.map(p => p.dest);
  const sent = new Set((await syncRows(schema)).filter(r => !exportId || r[EXPORT_COL] !== exportId).map(r => r[TABLE_COL]));
  if (dests.some(d => sent.has(d))) throw new Error('destExported');
  if (fromDocId && fromDocId === (await docIdentity()).docId && plans.some(p => p.dest === p.table)) throw new Error('loop');
}
return { checkDests };
})();

// ===== js/engine/target/lost.js =====
__M["js/engine/target/lost.js"] = (() => {
'use strict';
const {apply, fetchRows, readSchema} = __M["js/engine/port.js"];
const {formPages} = __M["js/engine/pages.js"];
const {lostReceptions, receptionMark} = __M["js/engine/logic/lost.js"];

async function markReceptions(receptions) {
  const [forms, pages, shares] = await Promise.all([formPages(), fetchRows('_grist_Pages'), fetchRows('_grist_Shares')]);
  const actions = [];
  for (const { journal, note } of receptions) {
    const form = forms.get(journal);
    if (note.mode === 'public' || note.retour || !form || form.shared) continue;
    const page = pages.find(p => p.viewRef === form.viewRef);
    const share = page && page.shareRef ? shares.find(s => s.id === page.shareRef) : null;
    const mark = receptionMark(journal, note);
    if (share && share.description !== mark) actions.push(['UpdateRecord', '_grist_Shares', share.id, { description: mark }]);
  }
  if (actions.length) await apply(actions);
  return actions.length > 0;
}

async function readLost() {
  try {
    return lostReceptions(await readSchema(), await fetchRows('_grist_Shares'));
  } catch (e) {
    return [];
  }
}

async function dismissLost(lost) {
  await apply(lost.shares.map(id => ['RemoveRecord', '_grist_Shares', id]));
}
return { markReceptions, readLost, dismissLost };
})();

// ===== js/engine/target/receive.js =====
__M["js/engine/target/receive.js"] = (() => {
'use strict';
const {APPLIED_COL, AUTHOR_COL, EXPORT_COL, LIST_COL, journalId, nowS} = __M["js/engine/logic/common.js"];
const {buildReply, buildWebhookUrl, parseFormLink, parseInvitation} = __M["js/engine/logic/codes.js"];
const {codeFacts, controlCode, linkKeys, newKeyPair, sameDoc} = __M["js/engine/logic/trust.js"];
const {foreignSync} = __M["js/engine/logic/strays.js"];
const {keySlot, missingColumns, optionsNote, receivedJournals, receivedKey} = __M["js/engine/logic/received.js"];
const {canRevert, revertedNote, startRenf} = __M["js/engine/logic/reinforce.js"];
const {apply, docIdentity, fetchRows, isOwner, readSchema, shareInfo} = __M["js/engine/port.js"];
const {appVersion} = __M["js/engine/version.js"];
const {ensureForm, removeTechnicalTables} = __M["js/engine/pages.js"];
const {testUrl} = __M["js/engine/form-link.js"];
const {wireExchange} = __M["js/engine/exchange.js"];
const {readSourceNote, syncRows} = __M["js/engine/source/synchro.js"];
const {createJournal, dropKey, prepareDest, storeKey, updateJournalNote} = __M["js/engine/target/journals.js"];
const {consolidateAll} = __M["js/engine/target/loop.js"];
const {checkDests} = __M["js/engine/target/dest.js"];

async function readInvitation(text) {
  const invitation = parseInvitation(text, appVersion());
  const { origin } = await docIdentity();
  if (invitation.mode === 'public' && new URL(invitation.base).origin !== origin) throw new Error('otherInstance');
  if (invitation.expire && nowS() > invitation.expire) throw new Error('invitationExpired');
  if (invitation.mode !== 'echange') return invitation;
  if (invitation.retourOrigin !== origin) throw new Error('otherInstance');
  if (!(await isOwner())) throw new Error('exchangeOwner');
  const schema = await readSchema();
  if (foreignSync(schema)) throw new Error('syncTableForeign');
  const local = readSourceNote(schema).exports.some(e => e.id === invitation.export) || (await syncRows(schema)).some(r => r[EXPORT_COL] === invitation.export);
  const again = receivedJournals(schema).some(r => r.note.export === invitation.export && r.note.mode === 'echange' && !r.note.retour);
  if (local && !again) throw new Error('exportTaken');
  const share = await shareInfo(invitation.retour);
  if (!share) throw new Error('shareUnknown');
  if (!sameDoc(share.docId, invitation.from.docId || '')) throw new Error('shareOtherDoc');
  return { ...invitation, share, backCode: await controlCode(invitation.retour, invitation.secret, codeFacts(invitation)) };
}

const sourceOf = invitation => ({
  ...invitation.from,
  ...(invitation.share ? { docName: invitation.share.name, ...(invitation.share.team ? { team: invitation.share.team } : {}) } : {}),
});

async function receptionKeys(invitation) {
  const pair = await newKeyPair();
  return { pub: pair.pub, ...(await linkKeys(pair.priv, invitation.pub, invitation.export, invitation.id)) };
}
const keyNote = (invitation, keys) => ({ pub: keys.pub, pubSource: invitation.pub });

async function knownReception(invitation) {
  return receivedJournals(await readSchema()).find(r => r.note.export === invitation.export) || null;
}

const canRelink = (known, invitation) => invitation.mode !== 'public' && invitation.mode === (known.note.mode || 'reponse') && !known.note.retour
  && (known.note.from || {}).docId === invitation.from.docId;

async function isUnsignedReception(known) {
  return !known.note.sceau && !receivedKey(await readSchema(), known.journal, known.note);
}

async function relinkReception(known, invitation) {
  if (!canRelink(known, invitation)) throw new Error('alreadyReceived');
  const { id, secret, name, renforce } = invitation;
  const from = sourceOf(invitation);
  const keys = await receptionKeys(invitation);
  const wasUnsigned = await isUnsignedReception(known);
  const now = nowS();
  await updateJournalNote(known.journal, n => startRenf({ ...n, id, secret, name, from, renforce: renforce || undefined, ...keyNote(invitation, keys) }, wasUnsigned, now));
  await storeKey(known.note.tables.map(tb => tb.dest), invitation.export, keys.down);
  const note = receivedJournals(await readSchema()).find(r => r.journal === known.journal).note;
  if (invitation.mode === 'echange') await wireExchange(note, invitation.retour, keys.up);
  await ensureForm(known.journal);
  return { journal: known.journal, note };
}

const mustCompare = invitation => Boolean(invitation.renforce && invitation.mode === 'echange');
const mustHaveCompared = (invitation, compared) => {
  if (mustCompare(invitation) && !compared) throw new Error('codeNotCompared');
};

async function checkDestinations(invitation, plans, { compared = false } = {}) {
  mustHaveCompared(invitation, compared);
  const schema = await readSchema();
  await checkDests(schema, plans.map(p => ({ table: p.tb.table, dest: p.dest })), invitation.from.docId);
  return { schema, existing: plans.filter(p => schema.has(p.dest)).map(p => p.dest) };
}

function receptionNote(invitation, plans, keys, before, { reserve, options }) {
  const { mode } = invitation;
  const own = p => missingColumns(before, p.dest, p.tb.columns, p.map || {});
  return {
    id: invitation.id, export: invitation.export, name: invitation.name, secret: invitation.secret,
    from: sourceOf(invitation),
    ...(mode === 'public' ? { mode, base: invitation.base } : mode === 'echange' ? { mode } : {}),
    ...(invitation.renforce ? { renforce: true } : {}), ...(reserve !== false ? { reserve: true } : {}), ...(keys ? keyNote(invitation, keys) : {}),
    ...(mode === 'echange' ? {} : optionsNote(options || {})),
    tables: plans.map(p => ({
      table: p.tb.table, dest: p.dest, columns: p.tb.columns, own: own(p), ...(p.map ? { map: p.map } : {}), ...(p.match ? { match: p.match } : {}),
      ...(options && options.ask && mode !== 'echange' && mode !== 'public' && before.has(p.dest) ? { adopt: true } : {}),
    })),
    refused: [], missing: {},
  };
}

async function createReception(invitation, plans, { reserve = true, options = {}, compared = false, arrange = false } = {}) {
  mustHaveCompared(invitation, compared);
  const journal = journalId(invitation.name, (await readSchema()).tableIds);
  const { mode } = invitation;
  const keys = mode === 'public' ? null : await receptionKeys(invitation);
  const before = await readSchema();
  const note = receptionNote(invitation, plans, keys, before, { reserve, options });
  for (const p of plans) await prepareDest({ dest: p.dest, columns: p.tb.columns, map: p.map });
  if (keys) await storeKey(plans.map(p => p.dest), invitation.export, keys.down);
  await createJournal(journal, note);
  if (mode === 'echange') await wireExchange(note, invitation.retour, keys.up);
  const created = plans.map(p => p.dest).filter(d => !before.has(d));
  if (mode !== 'public') await ensureForm(journal, arrange ? { below: plans.map(p => p.dest), note } : {});
  else consolidateAll();
  return { journal, note, created };
}

async function undoReception({ journal, created }) {
  const empty = [];
  for (const table of created) if (!(await fetchRows(table).catch(() => [null])).length) empty.push(table);
  await removeTechnicalTables([journal]);
  await apply(empty.map(table => ['RemoveTable', table]));
}

async function myEmail(journal) {
  const id = (await apply([['AddRecord', journal, null, { [APPLIED_COL]: true, [LIST_COL]: '' }]])).retValues[0];
  return ((await fetchRows(journal)).find(r => r.id === id) || {})[AUTHOR_COL] || '';
}

async function receptionReply({ journal, note }, link) {
  if (!note.pub) throw new Error('codeOld');
  if (!parseFormLink(link)) throw new Error('formLink');
  const url = buildWebhookUrl(link, journal);
  await testUrl(url, journal);
  const identity = await docIdentity();
  const exchange = note.mode === 'echange';
  const code = buildReply({
    id: note.id, secret: note.secret, url, retour: exchange ? note.tables.map(tb => ({ table: tb.dest, dest: tb.table })) : null, pub: note.pub, version: appVersion(),
    recipient: { email: await myEmail(journal), docId: identity.docId, team: identity.team, at: new Date().toISOString().slice(0, 16).replace('T', ' ') },
  });
  return { code, control: await controlCode(url, note.secret, codeFacts({ renforce: note.renforce, pub: note.pubSource }, note.pub)) };
}

async function revertReinforcement(journal) {
  const schema = await readSchema();
  const known = receivedJournals(schema).find(r => r.journal === journal);
  if (!known || !canRevert(known.note, nowS())) throw new Error('revertNone');
  await dropKey(known.note.tables.map(tb => tb.dest), keySlot(journal, known.note));
  return updateJournalNote(journal, revertedNote);
}
return { readInvitation, sourceOf, knownReception, canRelink, isUnsignedReception, relinkReception, mustCompare, checkDestinations, createReception, undoReception, myEmail, receptionReply, revertReinforcement };
})();

// ===== js/prefs.js =====
__M["js/prefs.js"] = (() => {
'use strict';
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

const WIZARD_MS = 60000;
const sessionKey = name => `${PREFIX}wizard.${name}`;
function setWizard(name, value) {
  try { sessionStorage.setItem(sessionKey(name), value); return true; } catch (e) { return false; }
}
const askWizard = name => setWizard(name, String(Date.now()));
const dropWizard = name => setWizard(name, '');
function wizardAsked(name, { consume = false } = {}) {
  let at = 0;
  try { at = Number(sessionStorage.getItem(sessionKey(name))); } catch (e) { at = 0; }
  if (consume && at) dropWizard(name);
  return Number.isFinite(at) && at > 0 && Date.now() - at < WIZARD_MS;
}
return { readPref, writePref, applyTheme, askWizard, dropWizard, wizardAsked };
})();

// ===== js/i18n.js =====
__M["js/i18n.js"] = (() => {
'use strict';
const {readPref} = __M["js/prefs.js"];
const fr = {"app.title":"Sync+","tab.send":"Envoyer","tab.receive":"Recevoir","settings.title":"Réglages","settings.lang":"Langue","settings.theme":"Thème","settings.theme.system":"Système","settings.theme.light":"Clair","settings.theme.dark":"Sombre","settings.credits":"Crédits","settings.credits.author":"Auteur","settings.credits.site":"Site","settings.credits.license":"Licence","settings.credits.version":"Version","news.title":"Sync+ : les nouveautés","news.step.news":"Nouveautés","news.step.shares":"Vos partages","news.intro":"Voici ce qui change depuis l’Alpha : des partages plus précis et plus sûrs. Cliquez sur un point pour en savoir plus.","news.echange.title":"Échange à plusieurs, avec règles","news.echange.line":"Plusieurs documents peuvent se tenir à jour entre eux. Le vôtre sert de point central : il transmet les changements des uns aux autres, et vous choisissez s’il accepte, refuse ou vous laisse valider chaque ajout, modification ou suppression.","news.files.title":"Pièces jointes","news.files.line":"Une colonne Pièces jointes cochée part avec ses fichiers (25 Mo au plus chacun), une seule fois par destinataire, page SOURCE ouverte. Dans un Échange, les fichiers circulent dans les deux sens.","news.filter.title":"Filtre de lignes précis","news.filter.line":"Opérateurs adaptés au type de colonne (Références comprises), valeurs existantes à cocher, et le nombre de lignes qui partiront.","news.signed.title":"Envois protégés","news.signed.line":"Chaque destinataire a désormais sa propre signature : seuls les envois que vous avez signés sont acceptés. Un code de contrôle, à comparer avec la personne, vérifie que vous parlez au bon document. Pour vos partages d’avant : voir l’écran suivant.","news.taken.title":"Données mieux reprises","news.taken.line":"Les colonnes qui renvoient à une autre table (Références) restent fonctionnelles chez le destinataire. Listes de choix, formats, mise en forme et descriptions peuvent être repris sur demande ; les formules, seulement après l’accord d’un propriétaire. Vous pouvez aussi garder les lignes supprimées à la source, et mettre les tables reçues en lecture seule.","news.follow.title":"Suivi clair","news.follow.line":"Chaque export garde l’historique de ce que le widget a fait (envois, pauses, destinataires), que vous pouvez effacer. Les Réglages offrent un diagnostic à copier, sans aucune donnée de vos tables.","news.sends.title":"Envois suivis et vérifiés","news.sends.line":"Avant un gros envoi, le widget annonce la taille et la durée. Chaque destinataire a un état clair, et la réception compare les lignes annoncées aux lignes reçues. Un lien mort met le destinataire en pause tout seul.","news.errors.title":"Messages d’erreur précis","news.errors.line":"Un message précis pour chaque cas : lignes sans clé, table Synchro supprimée ou renommée, document destinataire supprimé. Chacun dit quoi faire, souvent par un bouton.","news.setup.title":"Mise en place plus simple","news.setup.line":"Deux documents ouverts dans le même navigateur s’envoient le code d’un clic, et le lien du document de l’autre côté s’ouvre dans un nouvel onglet.","news.shares.ok":"Vos partages actuels continuent de fonctionner, rien n’est obligatoire.","news.shares.only":"Seules les invitations pas encore acceptées sont à refaire.","news.shares.why":"Pourquoi renforcer la sécurité ?","news.shares.whyBody":"Sans signature propre, une personne qui connaîtrait l’adresse d’envoi d’un destinataire pourrait y écrire de fausses lignes. Avec elle, le destinataire ne retient que ce que vous avez signé. Vous le faites partage par partage, quand vous voulez.","news.shares.kept":"Repris tel quel","news.shares.todo":"Pour renforcer un partage, une fois par personne","news.kept1":"Vos exports : tables, colonnes, filtre, règles","news.kept2":"Vos destinataires et leur historique","news.kept3":"Chez eux : journal, tables reçues, correspondances, options","news.todo1":"Un nouveau code, que le widget prépare pour vous","news.todo2":"Les invitations en attente : à refaire de toute façon","news.todo3":"La personne colle le code, puis renvoie sa réponse","news.facts.title":"Dans ce document :","news.facts.exports":"{n} {n|export|exports}","news.facts.people":"{n} {n|destinataire|destinataires} que vous pouvez renforcer","news.facts.invitations":"{n} {n|invitation en attente à refaire|invitations en attente à refaire}","news.facts.receptions":"{n} {n|réception peut être renforcée|réceptions peuvent être renforcées}","news.facts.none":"rien à renforcer.","news.shares.target":"Pour les réceptions : demandez un nouveau code à leurs expéditeurs, il suffira de le coller. Sans cela, elles continuent d’arriver.","news.shares.go":"Renforcer la sécurité","settings.diag":"Diagnostic","settings.diag.help":"Si quelque chose ne marche pas, copiez ce diagnostic dans votre message : version, état des exports et des réceptions, erreurs récentes. Il ne contient aucune donnée de vos tables, ni courriel, ni code, ni lien.","settings.diag.copy":"Copier le diagnostic","settings.diag.show":"Voir ce qui sera copié","common.close":"Fermer","common.cancel":"Annuler","common.copy":"Copier","common.save":"Enregistrer","common.copied":"Copié","common.dur.under":"moins d’une minute","common.dur.min":"{n} min","common.dur.h":"{h} h","common.dur.hm":"{h} h {m}","common.size.MB":"{n} Mo","common.size.KB":"{n} Ko","common.next":"Continuer","common.back":"Retour","common.later":"Plus tard","common.filter":"Filtrer","common.none":"Aucun résultat","common.readonly":"Lecture seule : un éditeur doit ouvrir cette page pour que les actions soient possibles.","common.reloading":"Règles d’accès du widget mises à jour : Grist recharge le document…","rules.refused.title":"Les règles d’accès du widget n’ont pas pu être posées","rules.refused.body":"Grist les a refusées : « {why} ». Tant qu’elles ne sont pas posées, la table Synchro et les journaux du widget peuvent être lus par toute personne qui a accès au document, lien public compris. Dans Grist, ouvrez Paramètres du document, Règles d’accès, et corrigez la règle qui vise une colonne ou une table qui n’existe plus ; rouvrez ensuite cet onglet. Le widget ne modifie jamais vos règles.","recv.protect.title":"Protéger la table Synchro avant l’Échange","recv.protect.body":"Cet Échange renvoie des tables de ce document vers la SOURCE, par une table technique appelée Synchro. Le widget commence par lui poser des règles d’accès (réservée aux propriétaires), pour que personne d’autre ne lise ce qui y passe. Grist recharge alors le document : rouvrez ensuite « Accepter une invitation » et recollez le code. Rien d’autre n’est à refaire.","recv.protect.ok":"Protéger et recharger","send.ownersOnly":"Vous n’êtes pas propriétaire de ce document : la liste des exports et de leurs destinataires est réservée à ses propriétaires, vous ne la voyez donc pas et vous ne pouvez rien créer ici. Pour envoyer des tables depuis ce document, demandez à l’un d’eux d’ouvrir cette page.","common.code":"Code","common.codeSecret":"Ce code vaut un mot de passe : ne le collez ni dans une IA, ni dans un ticket, ni dans un salon de discussion. Transmettez-le directement à la personne.","common.controlHelp":"Comparez-le par téléphone avec l’autre personne, qui voit le même : un code différent veut dire que le lien a été remplacé en route.","common.otherVersion":"L’autre document utilise la version {theirs} du widget (ici : {mine}). Si quelque chose échoue, installez le widget à la même adresse dans les deux documents.","common.olderVersion":"L’autre document utilise une version du widget antérieure à la 0.12 (ici : {mine}). Si quelque chose échoue, installez le widget à la même adresse dans les deux documents.","common.filterIn":"Filtrer : {name}","common.choose":"— Choisir —","common.all":"Tous","common.noneChecked":"Aucun","common.checkedCount":"{n} sur {total}","common.moreItems":"{n} {n|autre valeur|autres valeurs} : précisez la recherche.","common.blank":"(vide)","common.docOpen":"Ouvrir le document dans un nouvel onglet","common.newTab":"(s’ouvre dans un nouvel onglet)","common.docChecked":"Nom vérifié chez Grist","common.docDeclared":"Nom indiqué par la SOURCE, non vérifié","common.yes":"oui","common.no":"non","type.Text":"Texte","type.Numeric":"Numérique","type.Int":"Entier","type.Bool":"Case à cocher","type.Date":"Date","type.DateTime":"Date et heure","type.Choice":"Choix","type.ChoiceList":"Choix multiple","type.Ref":"Référence","type.RefList":"Liste de références","type.Attachments":"Pièces jointes","type.Any":"Quelconque","type.Blob":"Binaire (Blob)","type.PositionNumber":"Rang","type.Id":"Identifiant de ligne","home.title":"Que voulez-vous faire dans ce document ?","home.notOwner":"Vous n’êtes pas propriétaire de ce document : envoyer des tables est réservé à ses propriétaires, et recevoir des tables demande d’en être éditeur (un lecteur voit l’état, sans pouvoir agir).","guide.title":"Qui fait quoi ?","guide.you":"vous","guide.role.source":"SOURCE","guide.role.target":"CIBLE","guide.s1":"Installe le widget, Envoyer : crée un export (ses tables et leurs colonnes), puis « Ajouter un destinataire » et transmet le code d’invitation à la CIBLE.","guide.t1":"Installe le widget, Recevoir, « Accepter une invitation » : colle le code, choisit où ranger chaque table.","guide.t2":"Ouvre la page du formulaire, apparue en bas de la liste des pages : Partager, Copier le lien. Colle ce lien dans le widget (un seul lien pour tout l’export), puis renvoie le code de réponse à la SOURCE.","guide.s2":"Sur la carte de l’export, ligne de l’invitation : « Coller la réponse », vérifie qui a accepté, « Approuver et brancher », puis « Envoyer » les lignes existantes.","guide.t3":"Ouvre de temps en temps la page du widget : la recopie dans les tables se fait page ouverte. Une table ajoutée plus tard à l’export y est proposée dans une fenêtre.","guide.p.s1":"Installe le widget, Envoyer : crée un export, « Ajouter un destinataire », mode Lien public. Transmet le code, puis dans Partager, Gérer les utilisateurs, règle « Accès public » sur Activé, en Lecture seule.","guide.p.t1":"Installe le widget, Recevoir, « Accepter une invitation » : colle le code, choisit les destinations. La lecture se fait page ouverte, toutes les 10 secondes.","guide.e.s1":"Installe le widget, Envoyer : crée un export, « Ajouter un destinataire », mode Échange. Copie le lien du formulaire de retour, publié sur sa propre page en bas de la liste des pages, puis transmet le code d’invitation à la CIBLE.","guide.e.t1":"Installe le widget dans un document dont elle est propriétaire, Recevoir, « Accepter une invitation » : colle le code, choisit où ranger chaque table.","guide.e.t3":"Chaque document ouvre de temps en temps la page du widget : chacun recopie, page ouverte, ce que l’autre a changé. La modification la plus récente l’emporte.","guide.publicNote":"En mode lien public, un seul code suffit : la CIBLE n’a pas de réponse à renvoyer.","guide.install":"Installation : dans le document, ajoutez un widget personnalisé « Constructeur » avec le même code HTML et JavaScript, et acceptez l’accès complet.","guide.copyHandoff":"Copier avec les consignes","guide.copyHandoff.help":"Le code et les étapes de l’autre document, prêts à coller dans un courriel.","guide.handoff.target":"Bonjour, je vous propose de recevoir des tables de mon document Grist. Dans votre document Grist (vous devez pouvoir le modifier) :","guide.handoff.source":"Bonjour, voici ma réponse à votre invitation de synchro Grist. Dans votre document :","guide.handoff.code":"Code :","home.send":"Envoyer des tables","home.send.desc":"Ce document est la SOURCE : ses lignes sont recopiées dans un autre document.","home.receive":"Recevoir des tables","home.receive.desc":"Ce document est la CIBLE : il reçoit et tient à jour une copie éditable.","send.empty":"Aucun export. Un export regroupe des tables et les colonnes choisies ; vous y ajoutez ensuite les personnes qui le reçoivent.","send.new":"Nouvel export","send.step.tables":"Tables","send.step.content":"Contenu","send.sec.data":"Les données","send.sec.data.sub":"Quelles colonnes et quelles lignes partent.","send.sec.with":"Envoyé avec les données","send.sec.with.sub":"Ce qui accompagne les données chez le destinataire. Ce qui est coché part.","send.sec.next":"Pour la suite","send.step.name":"Nom","send.step.options":"Options","send.step.invitation":"Invitation","send.step.reply":"Réponse","send.step.load":"Envoi","send.tables.help":"Cochez les tables à envoyer.","send.edit.tables":"Cochez les tables à envoyer. Si vous en ajoutez une, chaque destinataire choisit où la ranger chez lui.","send.edit.removed":"Ne partiront plus : {tables}. Ce que les destinataires en ont déjà reçu reste chez eux.","send.columns.help":"Par défaut, toutes les colonnes et toutes les lignes sont envoyées. Vous pouvez en retirer : ce que vous ne cochez pas ne quitte jamais ce document.","send.columns.relay":"Table reçue d’un autre document : elle est transmise telle qu’elle arrive. Les lignes que vous y ajoutez à la main restent ici, elles ne partent pas.","send.refs.aim":"renvoie à la table {target} (affiche {shown})","send.refs.values":"Envoyer seulement le texte","send.refs.link":"Garder le lien","send.refs.link.why":"La table {target} part aussi, pour que le destinataire retrouve une vraie {kind} et pas seulement du texte. Vous choisissez dessous ce qu’on en prend.","send.refs.already":"La table {target} est déjà ajoutée sous {by} : ce que vous y prenez vaut pour les deux colonnes.","send.refs.help":"Garder le lien envoie aussi la table désignée : par défaut sa seule colonne affichée, et vous pouvez en prendre toute la table ou choisir ses colonnes. Chez un destinataire où la colonne contient déjà du texte, elle reste du texte jusqu’à ce qu’il la refasse d’un clic.","send.refs.note.values":"Le destinataire reçoit le texte affiché, sans lien.","send.refs.note.inside":"La table {target} part déjà avec l’export : rien n’est ajouté, le destinataire retrouve une vraie {kind}.","send.refs.note.numbers":"Cette colonne n’affiche aucune colonne de {target} (elle montre des numéros de ligne) : choisissez-en une dans Grist pour pouvoir garder le lien.","send.refs.note.hidden":"La colonne {shown} de {target}, qu’affiche cette colonne, ne part pas : cochez-la dans {target} pour garder le lien.","send.refs.added":"Ajoutée pour un lien","send.refs.mode":"Que prendre de la table {table} ?","send.refs.mode.shown":"Seulement la colonne affichée ({cols})","send.refs.mode.all":"Toute la table ({n} {n|colonne|colonnes})","send.refs.mode.pick":"Choisir les colonnes","send.refs.mode.files":"Pièces jointes ({cols}) : elles ne partent que cochées, avec « Choisir les colonnes ».","send.refs.summary.whole":"toute la table","send.columns.files":"Pièces jointes ({cols}) : cochez-les pour les envoyer. Leurs fichiers partent quand un propriétaire a cette page ouverte (25 Mo au plus chacun), et dans les deux sens pour un Échange.","send.columns.unsent":"Ne part pas ({cols}) : Grist ne permet pas de recopier ce type de colonne (données binaires) dans un autre document. Les autres colonnes partent normalement.","send.columns.all":"Toutes les colonnes ({n})","send.columns.some":"{n} {n|colonne|colonnes} sur {total}","send.rows.all":"toutes les lignes","send.rows.filtered":"lignes où {filter}","send.columns.pick":"Choisir les colonnes","send.rows.pick":"Filtrer les lignes","send.lastOk":"Dernier envoi déposé chez le destinataire : {at}. Il apparaît dans sa table dès que la page de son widget est ouverte.","send.history.title":"Historique des envois ({n})","send.history.title.none":"Historique des envois","send.history.help":"Ce que le widget a conduit : renvois, rattrapages, pauses, destinataires. Les envois ordinaires (une ligne ajoutée ou modifiée) partent de Grist sans le widget : ils ne sont pas listés un par un. Grist n’en retient que le dernier, montré en tête avec son heure ; l’état de chaque destinataire dit leur réussite.","send.history.last":"Dernier envoi ordinaire (ligne ajoutée ou modifiée), d’après Grist.","send.history.lastWho":"Le plus récent est chez {who}.","send.history.join":"{who} reçoit désormais cet export.","send.history.resend":"Envoi de {n} {n|ligne|lignes} à tous les destinataires actifs.","send.history.catchup":"Rattrapage automatique : {n} {n|ligne renvoyée|lignes renvoyées}.","send.history.unblock":"File d’envoi vidée, tout est renvoyé.","send.history.pause":"{who} : envois mis en pause.","send.history.autopause":"{who} : mis en pause par le widget, son lien de réception ne marchait plus.","send.paused.auto":"Mise en pause par le widget : son lien de réception ne marchait plus (son document a été supprimé, la réception arrêtée, le lien coupé ou le formulaire dépublié : Grist répond la même chose dans les quatre cas), et il retenait les envois vers les autres personnes de ce document. Révoquez-la et invitez-la de nouveau ; si le lien est rétabli, reprenez ses envois.","send.paused.manual":"En pause : rien n’est envoyé à cette personne. À la reprise, vous pourrez rattraper ce qui a changé pendant la pause.","send.paused.slow":"Mise en pause par le widget : un envoi vers cette personne attendait une réponse qui ne venait pas (Grist n’abandonne jamais de lui-même), et il retenait les envois vers les autres personnes de ce document. Si son document répond de nouveau, reprenez ses envois ; sinon révoquez-la et invitez-la de nouveau.","send.history.resume":"{who} : envois repris.","send.history.revoke":"{who} : révoqué.","send.history.clear":"Effacer l’historique","send.history.clearTitle":"Effacer l’historique de « {name} » ?","send.history.clearBody":"La liste des événements de cet export (envois, pauses, modifications…) est effacée. Rien n’est retiré aux destinataires : ni les lignes déjà envoyées, ni les envois en cours. L’avis de baisse du nombre de lignes, s’il est affiché, disparaît aussi.","send.history.clearBack":"Pour un Échange, les valeurs « avant » et celles des lignes supprimées sont aussi effacées des journaux de retour de cet export, dans ce document.","send.history.clearLimits":"L’historique propre à Grist (Ctrl+Z, « Historique du document ») n’est pas touché. Cette action, elle, ne peut pas être annulée.","send.history.edit":"Export modifié.","send.history.editSent":"Export modifié, {n} {n|table renvoyée|tables renvoyées}.","send.history.shrink":"{who} : {n} {n|ligne de moins|lignes de moins} dans l’export.","send.shrink.title":"{table} : {n} {n|ligne de moins|lignes de moins} dans l’export","send.shrink.body":"Constaté le {date} : des lignes ont été supprimées de la table, ou sont sorties du filtre de l’export. Les destinataires les suppriment aussi chez eux. Une suppression faite par erreur s’annule dans Grist (Ctrl+Z, ou « Historique du document ») : les lignes repartent alors chez eux.","send.backOptions.title":"Revenir aux options ?","send.backOptions.body":"L’invitation en cours est annulée : son code ne servira plus. Vous en créerez une nouvelle, à transmettre à la place.","send.newCode.title":"Refaire le code d’invitation ?","send.newCode.body":"Un nouveau code va être créé. L’ancien ne marchera plus : transmettez le nouveau à la place.","send.newCode.ok":"Refaire le code","send.reply.ready":"J’ai la réponse","send.connected":"Branché : les ajouts, modifications et suppressions partent désormais tout seuls.","send.done":"Lignes existantes envoyées : {n}. Chez le destinataire, elles apparaissent dès que la page de son widget est ouverte.","send.name":"Nom de l’export","send.name.help":"Les destinataires voient ce nom.","send.docName":"Nom de ce document","send.docName.help":"Facultatif. Le destinataire verra ce nom, avec un lien vers votre document, pour savoir d’où viennent les données. Le widget ne peut pas lire le nom de votre document : recopiez-le tel qu’il s’affiche en haut de la page, ou collez l’adresse de la page (barre d’adresse du navigateur) et il y sera lu.","send.docName.fromAddress":"Nom lu dans l’adresse de la page. Grist l’y écrit sans accents ni ponctuation : corrigez-le si besoin.","send.docName.noName":"Cette adresse ne contient pas le nom du document (Grist l’omet quand il n’a pas de lettres latines). Saisissez-le à la main.","send.docName.otherDoc":"Cette adresse n’est pas celle de ce document : l’identifiant diffère. Copiez l’adresse de la page où ce widget est ouvert.","send.docName.otherSite":"Cette adresse est celle d’un autre site Grist que ce document. Copiez l’adresse de la page où ce widget est ouvert.","send.docName.invalid":"Adresse non reconnue. Collez l’adresse d’une page de ce document Grist, ou saisissez le nom.","send.create":"Créer l’export","send.created":"Export « {name} » créé.","send.created.next":"Vous pouvez maintenant ajouter la première personne qui le reçoit. Plus tard, depuis la carte de l’export, vous pourrez en ajouter d’autres ou en révoquer une seule.","send.edit.title":"Modifier « {name} »","send.edit.saved":"Enregistré : {n} {n|ligne est partie|lignes sont parties} vers les destinataires.","send.edit.savedNone":"Enregistré.","send.export.table":"{table} ({n} {n|colonne|colonnes})","send.export.tableFiltered":"{table} ({n} {n|colonne|colonnes}, lignes où {filter})","send.filter.title":"Lignes de {table} à envoyer","send.filter.add":"Ajouter une condition","send.filter.none":"Aucune condition : toutes les lignes partent.","send.filter.mode":"Garder les lignes qui remplissent :","send.filter.mode.all":"toutes les conditions","send.filter.mode.any":"au moins une condition","send.filter.reading":"Lecture des lignes…","send.filter.unreadable":"Lignes illisibles : valeurs et aperçu indisponibles. Les autres conditions s’enregistrent.","send.filter.count":"{n} {n|ligne partira|lignes partiront} sur {total}.","send.filter.countAll":"Toutes les lignes partent ({total}).","send.filter.incomplete":"{n} {n|condition incomplète est ignorée|conditions incomplètes sont ignorées}.","send.filter.nothing":"Aucune ligne ne partira : celles déjà envoyées seront effacées chez les destinataires.","send.filter.rows":"{n} {n|ligne|lignes}","send.filter.column":"Colonne de la condition {n}","send.filter.operator":"Opérateur de la condition {n}","send.filter.remove":"Retirer la condition {n}","send.filter.condition":"Condition {n}","send.filter.from":"Première valeur de la condition {n}","send.filter.to":"Seconde valeur de la condition {n}","send.filter.betweenAnd":"et","send.filter.and":" et ","send.filter.or":" ou ","send.filter.range":"{from} et {to}","send.filter.more":"{values} et {n} {n|autre|autres}","send.filter.quoted":"« {value} »","send.op.in":"est l’une de","send.op.notin":"n’est aucune de","send.op.eq":"est égal à","send.op.contains":"contient","send.op.notcontains":"ne contient pas","send.op.starts":"commence par","send.op.empty":"est vide","send.op.notempty":"n’est pas vide","send.op.true":"est cochée","send.op.false":"n’est pas cochée","send.op.noteq":"≠","send.op.gt":">","send.op.ge":"≥","send.op.lt":"<","send.op.le":"≤","send.op.between":"est entre","send.op.number.eq":"=","send.op.list.in":"contient l’une de","send.op.list.notin":"ne contient aucune de","send.op.refs.in":"cite l’une de","send.op.refs.notin":"ne cite aucune de","send.op.date.eq":"est le","send.op.date.lt":"est avant le","send.op.date.le":"est au plus tard le","send.op.date.gt":"est après le","send.op.date.ge":"est au plus tôt le","send.op.date.between":"est entre le","send.filter.value":"Valeur de la condition {n}","send.filter.help":"Seules les lignes qui remplissent ces conditions sont envoyées (majuscules et minuscules ne comptent pas). Une Référence se choisit par sa fiche : si la fiche est renommée, la ligne reste dans le filtre. Une ligne qui sort du filtre est effacée chez les destinataires. La liste des choix d’une colonne Choix n’est pas envoyée : chaque destinataire ne reçoit que les valeurs des lignes envoyées.","send.files.pending":"{n} {n|fichier à envoyer|fichiers à envoyer} : {n|il part|ils partent} tant que cette page reste ouverte.","send.export.lost":"Table introuvable (renommée ou supprimée) : {tables}. Ses lignes ne partent plus. Rendez-lui son nom, ou retirez-la de l’export (Modifier).","send.export.drift":"Colonnes changées depuis l’export (renommées, supprimées, d’un autre type ou masquées par une règle d’accès) : {cols}. Elles ne partent plus correctement : cochez de nouveau les bonnes colonnes (Modifier), ou vérifiez les règles d’accès du document.","send.export.nobody":"Personne ne reçoit encore cet export.","send.export.rowsGone":"Les lignes de cet export ont disparu de la table Synchro (supprimées à la main dans Grist ?) : plus rien ne part. Cliquez sur « Modifier » pour choisir de nouveau les tables et les colonnes. Les clés de signature des destinataires étaient dans ces lignes : voyez l’avis de chacun.","send.vanished.title":"{n} {n|destinataire a disparu|destinataires ont disparu}","send.vanished":"{n} {n|destinataire ajouté n’apparaît|destinataires ajoutés n’apparaissent} plus : {n|son webhook a été supprimé|leurs webhooks ont été supprimés} ou {n|modifié|modifiés} à la main dans les réglages de Grist (Paramètres du document, API). {n|Cette personne ne reçoit|Ces personnes ne reçoivent} plus rien de cet export : invitez de nouveau {n|cette personne|ces personnes} (Ajouter un destinataire).","send.action.addPerson":"Ajouter un destinataire","send.action.addParticipant":"Ajouter un participant","send.action.edit":"Modifier","send.action.delete":"Supprimer","send.delete.title":"Supprimer l’export « {name} » ?","send.delete.body":"Les envois s’arrêtent pour {n} {n|destinataire|destinataires}. {n|Ce qu’il a déjà reçu reste chez lui|Ce qu’ils ont déjà reçu reste chez eux}. Les colonnes id_sync et MajLe restent dans vos tables.","send.person.title":"Ajouter un destinataire à « {name} »","send.person.badAddress":"L’adresse d’envoi de ce destinataire a été changée dans les réglages de Grist : ce n’est plus celle d’un formulaire de cette instance. Révoquez-le s’il n’y a pas d’explication.","send.person.noKey":"La clé de signature de cette personne a été perdue (ligne « signature » de la table Synchro supprimée ?) : son document rejette vos envois comme suspects. La clé ne se refait pas : révoquez-la, puis invitez-la de nouveau (sa réception reprend).","send.person.otherDoc":"Ce destinataire envoie maintenant vers un autre document ({doc}) que celui approuvé. Révoquez-le s’il n’y a pas d’explication.","send.person.tables":"Tables de l’export : {tables}.","send.mode":"Mode","send.mode.others":"Autres modes","send.mode.reply":"Dans un seul sens (recommandé)","send.mode.public":"Lien public","send.mode.publicDone":"Lien public (déjà ouvert)","send.mode.publicStrong":"Indisponible : un export en sécurité renforcée ne peut pas passer par un lien public.","send.mode.echange":"Dans les deux sens (Échange)","send.mode.echange.more":"Un participant de plus à l’Échange (Échange à plusieurs)","send.mode.echange.moreHelp":"Une ligne qu’un participant coche Supprime reste ici, cochée, et disparaît chez les autres participants.","send.mode.echange.help":"Effacer une ligne ne l’efface que chez soi : pour l’effacer des deux côtés, cochez sa case Supprime. Le destinataire doit être propriétaire de son document. D’autres participants pourront s’ajouter ensuite : ce document administrera alors l’Échange.","send.mode.echange.off":"Indisponible : l’Échange demande un export qui n’a encore ni destinataire ni invitation, et qui n’est pas en lien public.","send.back.title":"Lien du formulaire de retour","send.back.help":"Les modifications du destinataire arriveront ici par un formulaire de retour, publié {where}. Copiez son lien et collez-le ici : il part dans l’invitation, et seul le destinataire pourra s’en servir.","send.back.again":"Refaire le code","send.back.resume":"Reprendre","send.exchange.managed":"Échange reçu d’un autre document : il se règle depuis l’onglet Recevoir. Le supprimer arrête l’Échange.","send.exchange.with":"Échange : les modifications de ce destinataire reviennent dans vos tables.","send.exchange.hub":"Échange à plusieurs ({n} participants) : les modifications de chacun reviennent dans vos tables et repartent vers les autres.","send.exchange.rules":"Changements des participants : {rules}.","send.rules.title":"Changements reçus des participants","send.rules.help":"Pour chaque type de changement : l’accepter, le refuser, ou le garder à valider. Un changement à valider attend votre décision sur la carte du participant, dans l’onglet Recevoir.","send.rules.ajout":"Ligne ajoutée","send.rules.modif":"Ligne modifiée","send.rules.suppression":"Ligne supprimée (case Supprime)","send.rules.accepter":"Accepter","send.rules.refuser":"Refuser","send.rules.valider":"À valider","send.refusal.title":"En cas de refus","send.refusal.corriger":"Le participant reprend la ligne d’ici (recommandé)","send.refusal.signaler":"Le participant garde sa version, l’écart est signalé ici","send.refusal.help":"Quand vous refusez un changement, « reprendre la ligne d’ici » remet chez le participant la version de ce document : une ligne ajoutée puis refusée est effacée chez lui (elle reste ici, cochée Supprime), et une suppression refusée est annulée.","send.exchange.map":"{dest} ↔ {table}","send.public.warn":"Le widget va ajouter des règles d’accès : les personnes qui ne font que lire ce document (le lien public compris) ne verront plus que les exports publics, rien d’autre. Ensuite, vous activerez le lien dans Partager. À éviter pour des données qui ne doivent pas être publiques.","send.public.columns":"Toute personne qui a le lien pourra lire ces colonnes : {list}.","send.public.editors":"Le lien public de ce document est réglé sur Éditeur : n’importe qui peut le modifier, et les règles du widget ne protègent plus rien. Dans Partager, Gérer les utilisateurs, remettez « Accès public » en Lecture seule.","send.public.hiddenNow":"Une règle d’accès cache maintenant une partie de {tables}, que ce lien public montre à tous. Coupez le lien public, ou retirez ces tables de l’export.","send.public.label":"lien public","send.public.turnOn":"À faire : dans le menu Partager du document, Gérer les utilisateurs : « Accès public » sur Activé, en Lecture seule, puis Confirmer.","send.public.code":"Code","send.public.help":"Transmettez ce code : il suffit au destinataire. Il ne contient aucune donnée.","send.public.revokeBody":"Les lecteurs ne verront plus cet export. Désactivez aussi le lien public dans Partager s’il ne sert plus : tant qu’il reste actif, le widget garde la règle qui cache le reste du document.","send.public.stop":"Couper le lien public","send.public.tooBig":"Trop gros pour le lien public (plus de 2 Mo) : {tables}. Le lien public n’en donne rien ; invitez plutôt la personne (webhook), ou filtrez les lignes.","send.public.stopTitle":"Couper le lien public de « {name} » ?","send.public.stay.title":"Le document reste public dans Grist","send.public.stay.body":"Vous avez coupé le lien public de l’export, mais le partage public du document est toujours activé dans Grist. Le widget n’envoie plus rien par ce lien ; il garde sa règle qui cache le reste du document aux personnes qui ne font que lire.","send.public.stay.how":"Pour fermer le partage public : menu Partager du document, Gérer les utilisateurs, « Accès public » sur Désactivé, puis Confirmer. Si le document doit rester public, confirmez-le ci-dessous : cet avis disparaît.","send.public.stay.rules":"Les visiteurs ne voient rien tant que vous ne modifiez pas les règles d’accès.","send.public.stay.keep":"Oui, je laisse le document public","send.check.missing":"En créant l’export, le widget ajoutera : {items}.","send.check.sync":"la table technique Synchro (une seule pour tous les exports)","send.renforce":"Sécurité renforcée","send.renforce.help":"Avant de brancher, vous comparerez un code de contrôle avec la personne (par téléphone, par exemple) pour être sûr de parler au bon document. Cet export ne pourra plus être partagé par lien public.","send.renforce.structure":"Sécurité renforcée : les éditeurs de ce document peuvent modifier sa structure, donc les formules qui choisissent ce qui part. Décochez « Permettre aux éditeurs de modifier la structure » dans les règles d’accès.","send.renforce.on":"sécurité renforcée","send.invite":"Créer l’invitation","send.invite.help":"Transmettez ce code à la personne qui gère le document qui recevra les tables (la CIBLE). Elle le colle dans son widget, onglet « Recevoir », puis vous renvoie un code de réponse.","send.invite.pending":"Invitation du {at}","send.invite.until":"Valable jusqu’au {at}","send.invite.expiredOn":"Expirée le {at} : refaites le code","send.invite.expired":"Cette invitation a expiré : revenez en arrière pour refaire le code.","send.invite.backCode":"Code de contrôle de l’envoi de retour :","send.reply":"Coller la réponse","send.reply.title":"Réponse du destinataire","send.reply.help":"Collez le code de réponse reçu du document CIBLE.","send.reply.check":"Vérifier","send.reply.tables":"Tables","send.reply.email":"Accepté par","send.reply.doc":"Document","send.reply.team":"Équipe","send.reply.at":"Date","send.reply.approve":"Approuver et brancher","send.reply.nosecret":"Cette invitation n’est protégée par aucun secret. Vérifiez bien la fiche ci-dessus avant d’approuver.","send.reply.sameDoc":"ce document","send.reply.verified":"Document, dossier et équipe sont donnés par Grist ; le courriel et la date viennent du code collé.","send.reply.personal":"Ce document est dans un espace personnel : Grist ne dit pas à qui il appartient. Vérifiez par téléphone avec la personne, code de contrôle à l’appui.","send.reply.personalSpace":"espace personnel","send.reply.code":"Code de contrôle :","send.reply.compared":"J’ai comparé ce code avec la personne : il est identique.","send.load.body":"Le branchement n’envoie que ce qui changera à partir de maintenant. Voulez-vous envoyer aussi {n} {n|ligne déjà présente|lignes déjà présentes} ?","send.load.ok":"Envoyer","send.load.empty":"Les tables sont vides pour l’instant : les lignes partiront dès leur ajout.","send.load.done":"Renvoi terminé : {n} {n|ligne envoyée|lignes envoyées}. Chez le destinataire, elles apparaissent dès que la page de son widget est ouverte.","send.load.queued":"Un autre envoi est déjà en cours pour ce document (sur une autre page, ou par une autre personne). Celui-ci est noté et partira ensuite tout seul, tant qu’une page du widget reste ouverte.","send.load.nobody":"Aucun destinataire branché : rien à renvoyer.","send.load.start":"Préparation de l’envoi…","send.load.nothing":"Aucune des {n} {n|ligne|lignes} de la table ne peut partir : il leur manque la clé de synchronisation, ou le filtre de l’export les écarte toutes.","send.estimate.title":"Envoi long","send.estimate.body":"{rows} {rows|ligne|lignes} à envoyer, environ {size}, en {lots} {lots|lot|lots}, pour {n} {n|destinataire|destinataires} : comptez {dur}.","send.estimate.pace":"Pour ménager le serveur de Grist, le widget n’envoie pas plus de {mb} Mo toutes les {min} minutes, tous destinataires confondus. Gardez une page du widget ouverte jusqu’à la fin : l’avancement s’affiche sur la carte de l’export.","send.flow.running":"Envoi en cours : {done} sur {total} {total|ligne|lignes} ({pct} %), lot {lot} sur environ {lots}.","send.flow.runningOther":"Un envoi est en cours depuis une autre page ou une autre personne : {done} sur {total} {total|ligne|lignes} ({pct} %), lot {lot} sur environ {lots}. Il continue seul.","send.flow.budget":"Pause pour ménager le serveur de Grist : la suite part vers {at} ({done} sur {total} {total|ligne|lignes} déjà envoyées, {pct} %). Rien n’est perdu ; gardez une page du widget ouverte.","send.flow.budgetWait":"Envois espacés pour ménager le serveur de Grist : la suite part vers {at}. Les modifications ordinaires partent toujours.","send.flow.queued":"Un autre envoi est en cours pour ce document : celui-ci part ensuite, seul.","send.flow.paused":"{n} {n|table a|tables ont} encore des lignes à envoyer, mais aucun destinataire n’est actif : elles partiront à la reprise.","send.flow.blocked":"L’envoi est bloqué : {n} {n|destinataire est|destinataires sont} en erreur (voir plus bas). Tant que ce n’est pas réglé, rien n’est renvoyé, car la file d’envoi de Grist est commune à tous les destinataires.","send.flow.interrupted":"Envoi interrompu à {done} sur {total} {total|ligne|lignes} ({pct} %) : il reprend seul dès qu’un propriétaire a la page du widget ouverte.","send.flow.waiting":"En attente : {n} {n|table|tables} à compléter. Le widget les envoie seul, toutes les 10 secondes, tant qu’une page du widget reste ouverte.","send.flow.lastPass":"Dernier passage : {at}.","send.flow.left":"Reste environ {left}.","send.flow.bar":"Avancement : {pct} %","send.load.background":"Vous pouvez fermer cette fenêtre : l’envoi continue tant que cette page reste ouverte. Sinon, il reprend la prochaine fois qu’un propriétaire ouvre le widget.","send.status.invited":"En attente de réponse","send.status.expired":"Expirée","send.status.renfWait":"Renforcement : attend sa réponse","send.status.renfExpired":"Renforcement expiré","send.renf.title":"Renforcer la sécurité de {name}","send.renf.title.n":"Renforcer la sécurité ({n})","send.renf.body":"Certains destinataires reçoivent par un envoi d’avant les clés de signature : leur partage fonctionne, mais sans clé propre à leur document. Une nouvelle invitation le protège.","send.renf.safe":"Rien n’est imposé et rien ne casse : sans geste de votre part, ces partages continuent comme avant. Renforcer remplace l’ancien envoi d’une personne à la fois, sans perdre ses données.","send.renf.how":"Pour chacune : « Renforcer la sécurité », envoyez-lui le nouveau code, puis approuvez sa réponse. Les destinataires en pause se reprennent d’abord.","send.renf.person":"Envoi d’avant les clés de signature : vous pouvez en renforcer la sécurité. Il continue de fonctionner comme avant en attendant.","send.renf.paused":"Envoi d’avant les clés de signature, en pause : reprenez-le d’abord pour pouvoir renforcer sa sécurité.","send.renf.action":"Renforcer la sécurité","send.renf.pending":"Renforcement de {who} : invitation du {at}","send.renf.someone":"un destinataire","send.renf.invite":"Cette invitation remplace l’ancien envoi de cette personne. Il continue de fonctionner jusqu’à ce que vous approuviez sa réponse.","send.renf.step.control":"Contrôle","send.renf.connected":"Nouvel envoi branché : l’ancien est arrêté.","send.renf.control":"Un envoi de contrôle part maintenant : à sa première livraison signée, la personne voit son partage renforcé. Cette fenêtre peut se fermer, l’envoi continue.","send.renf.done":"Envoi de contrôle terminé ({n} lignes). La CIBLE confirme le renforcement à sa première livraison signée.","send.history.reinforce":"{who} : sécurité renforcée (nouvel envoi signé).","send.status.people":"{n} {n|destinataire|destinataires}","send.status.participants":"{n} {n|participant|participants}","send.status.alone":"Sans destinataire","send.cancel.title":"Retirer cette invitation ?","send.cancel.body":"Son code ne pourra plus être accepté.","send.status.public":"Public","send.status.publicOff":"Lien public à activer","send.status.active":"Actif","send.status.paused":"En pause","send.status.error":"Erreur","send.waiting":"{n} {n|envoi en attente|envois en attente}","send.action.load":"Tout renvoyer","send.action.pause":"Mettre en pause","send.action.resume":"Reprendre","send.resume.title":"Reprendre « {name} »","send.resume.catchup":"Rattraper les modifications de la pause (recommandé)","send.resume.catchup.help":"Renvoie {n} {n|ligne ajoutée ou modifiée|lignes ajoutées ou modifiées} pendant la pause, et les suppressions. Le reste de la table ne repart pas.","send.resume.all":"L’heure de la pause n’est pas connue, ou les colonnes ont changé pendant la pause : tout l’export repart.","send.resume.asIs":"Reprendre sans rattraper","send.resume.asIs.help":"Seules les modifications à venir partent. Ce qui a été ajouté, modifié ou supprimé pendant la pause n’arrivera pas à la CIBLE, sauf si la ligne est modifiée de nouveau (ou avec « Tout renvoyer »).","send.action.unblock":"Débloquer la file","send.action.revoke":"Révoquer","send.action.cancel":"Retirer l’invitation","send.revoke.title":"Révoquer « {name} » ?","send.revoke.body":"Les envois s’arrêtent pour cette personne seulement ; les autres destinataires continuent. Ce qu’elle a déjà reçu reste chez elle.","send.revoke.exchange":"L’Échange s’arrête : vos modifications ne partent plus, les siennes ne reviennent plus (le journal de retour est effacé). Les tables gardent leurs lignes, des deux côtés.","send.revoke.participant":"Ce participant ne reçoit plus rien et ses modifications ne reviennent plus (son journal de retour est effacé). Les autres participants continuent. Les tables gardent leurs lignes.","send.unblock.title":"Débloquer la file d’envoi ?","send.unblock.body":"Tous les envois en attente de ce document sont abandonnés, puis le widget renvoie lui-même les exports (gardez cette page ouverte). Si une personne ne reçoit plus rien, mettez-la d’abord en pause ou révoquez-la : sinon la file se bloquera de nouveau.","send.unsafe.title":"Envoi sans filtre","send.unsafe.body":"Ces envois (webhooks de Grist) lisent la table Synchro sans filtre d’export : ils recevraient tous les exports. Supprimez-les : {who}.","send.unsafe.delete":"Supprimer ces envois","send.unsafe.confirm":"Ces envois sont supprimés de Grist. Leurs destinataires ne reçoivent plus rien.","send.stray.title":"Colonnes en trop dans la table Synchro","send.stray.body":"La table Synchro est celle du widget : elle ne doit avoir que ses {total} colonnes. Le widget y trouve {n} {n|colonne|colonnes} de plus : {list}. {n|Elle ne vient|Elles ne viennent} pas de lui : Grist ajoute des colonnes A, B et C à toute table neuve, et une table Synchro faite avant le widget peut les avoir gardées. Chaque envoi emporte toute la ligne de Synchro, et le journal du destinataire refuse une colonne qu’il ne connaît pas (« Invalid column ») : tant {n|qu’elle est|qu’elles sont} là, les envois échouent.","send.stray.filled":"Contient des valeurs ou une formule : {cols}. Sauvegardez-les avant de les retirer.","send.stray.open":"Voir et retirer","send.stray.dialog.title":"Retirer les colonnes en trop ?","send.stray.dialog.intro":"{n|Cette colonne sera retirée|Ces colonnes seront retirées} de la table Synchro. Les colonnes du widget, vos exports et vos destinataires ne changent pas.","send.stray.col.empty":"{col} ({type}) : vide","send.stray.col.filled":"{col} ({type}) : {n} {n|cellule remplie|cellules remplies}","send.stray.col.formula":"{col} ({type}) : formule {formula}","send.stray.empty":"{n|Elle est vide|Elles sont vides} : rien ne sera perdu.","send.stray.save":"{n|Cette colonne contient|Ces colonnes contiennent} des valeurs ou une formule ({cols}), et la retirer l’efface. Avant de continuer, sauvegardez-{n|la|les} : copiez les valeurs dans une autre table du document, ou dans un fichier.","send.stray.sure":"J’ai sauvegardé ce qu’il fallait garder","send.stray.unblock":"Des envois sont bloqués à cause de ces colonnes. Après le retrait, le widget abandonne les envois en attente de Grist (ils contiennent encore ces colonnes), puis renvoie lui-même les exports. Gardez cette page ouverte.","send.stray.remove":"Retirer","send.stray.done":"{n|Colonne retirée|Colonnes retirées} de la table Synchro.","send.keys.title":"Des lignes n’arriveront pas chez les destinataires","send.keys.help":"Chaque ligne porte une clé (colonne id_sync) qui permet de la reconnaître chez les destinataires. Une ligne sans clé ne part pas ; deux lignes qui ont la même clé n’en font qu’une chez eux, et l’autre n’arrive jamais. Cela arrive quand on duplique ou colle des lignes entières, ou qu’on efface des cellules de cette colonne.","send.keys.line":"Table {table} : {blank} {blank|ligne sans clé|lignes sans clé}, {dup} {dup|ligne qui partage|lignes qui partagent} la clé d’une autre.","send.keys.missing":"Table {table} : {n|colonne supprimée|colonnes supprimées} ({cols}). Ces colonnes viennent du widget ; sans elles, les modifications de cette table ne partent plus.","send.keys.dialog.missing":"Le widget remet les colonnes qu’il avait ajoutées et qui ont été supprimées. Si id_sync manquait, chaque ligne reçoit une clé neuve : chez les destinataires, les lignes déjà reçues sont remplacées par ces nouvelles lignes.","send.keys.repair":"Réparer les clés","send.keys.dialog.title":"Réparer les clés","send.keys.dialog.body":"Le widget donne une clé neuve à {n} {n|ligne|lignes} (seule la colonne id_sync change : dans chaque groupe de lignes en double, la plus ancienne garde sa clé), puis les envoie comme après une modification. Chez les destinataires, les lignes en double deviennent des lignes distinctes. Aucune autre valeur de votre table n’est modifiée.","send.error.stray":"Cette personne ne reçoit plus à cause de la colonne « {col} » de la table Synchro de ce document, qui n’est pas au widget : elle n’a rien à faire de son côté. Retirez les colonnes en trop (carte en haut de l’onglet) ; l’envoi reprendra ensuite.","send.error.gone":"La colonne « {col} » n’est plus dans la table Synchro, mais la file d’envoi de Grist garde d’anciens envois qui la portent. « Débloquer la file » les abandonne : le widget renvoie ensuite les exports seul.","send.foreign.title":"Une table nommée Synchro existe déjà","send.foreign.body":"Le widget a besoin de sa propre table nommée Synchro. Il n’utilise pas celle d’une autre personne : il y ajouterait ses colonnes, et chaque envoi emporterait aussi les colonnes de cette personne, que les destinataires refusent.","send.foreign.facts":"Votre table Synchro : {c} {c|colonne|colonnes} ({cols}), {n} {n|ligne|lignes}.","send.foreign.how":"Renommez-la pour libérer le nom : elle garde ses colonnes, ses valeurs et ses formules, seul son nom change. Le widget créera ensuite sa propre table au premier export.","send.foreign.name":"Nouveau nom de votre table","send.foreign.rename":"Renommer ma table","send.foreign.open":"Renommer la table","send.foreign.done":"Table renommée. Le widget crée sa propre table Synchro au premier export.","send.foreign.blocked":"Une table nommée Synchro existe déjà : renommez-la d’abord.","send.lost.deleted.title":"La table Synchro a été supprimée","send.lost.deleted.body":"Cette table est la mémoire du widget : la liste de vos exports et les clés de signature des destinataires y étaient. Sans elle, plus rien n’est envoyé. Grist garde pourtant {n} {n|webhook|webhooks} des anciens destinataires, qui ne servent plus à rien.","send.lost.deleted.how":"Si la suppression est récente, annulez-la : Ctrl+Z dans Grist, ou « Historique du document » (dans les outils, à gauche) pour retrouver une version d’avant. Sinon, retirez les anciens webhooks, recréez vos exports et réinvitez chaque personne : les clés de signature se refont à l’invitation.","send.lost.deleted.clean":"Retirer les anciens webhooks","send.lost.deleted.confirm":"Les {n} {n|webhook|webhooks} de l’ancienne table Synchro seront supprimés. Rien n’est effacé chez les destinataires : ils gardent les lignes déjà reçues, mais ne reçoivent plus rien tant que vous ne les aurez pas réinvités.","send.lost.deleted.done":"{n} {n|ancien webhook retiré|anciens webhooks retirés}. Vous pouvez créer un nouvel export.","send.lost.renamed.title":"La table Synchro a été renommée","send.lost.renamed.body":"Le widget la cherche sous le nom Synchro, et elle s’appelle maintenant « {name} » : plus rien n’est envoyé aux destinataires, et la liste de vos exports n’apparaît plus.","send.lost.renamed.how":"Redonnez-lui le nom Synchro (dans « Données source », cliquez sur le nom de la table) : tout reprend, rien n’est perdu.","send.lost.hidden.title":"La table Synchro n’est plus lisible par le widget","send.lost.hidden.body":"La table Synchro est là, mais le widget n’y retrouve plus sa colonne Synchro_Export : elle a été supprimée, ou une règle d’accès cache la table ou cette colonne, y compris aux propriétaires. Plus rien n’est envoyé tant que c’est le cas.","send.lost.hidden.how":"Ouvrez « Permissions avancées » (dans les outils, à gauche) et retirez la règle qui cache la table Synchro ou cette colonne. Si la colonne a été supprimée, Ctrl+Z ou « Historique du document » la rend.","send.lost.blocked":"La table Synchro du widget est perdue : réglez d’abord ce problème.","send.error.size":"Envoi trop gros pour Grist (plus de 1 Mo) : le widget vide la file et renvoie tout de lui-même. Gardez cette page ouverte.","send.error.column":"Le journal de cette personne n’a pas la colonne « {col} » que le widget envoie : demandez-lui d’ouvrir la page de son widget, qui remet son journal à jour. L’envoi reprend ensuite seul.","send.error.link":"Le lien de réception de cette personne ne marche plus (son document a été supprimé, la réception arrêtée, le lien coupé ou le formulaire dépublié : Grist répond la même chose dans les quatre cas). Tant que cela dure, les envois vers les autres personnes de ce document attendent derrière celui-ci : mettez-la en pause pour les libérer, puis révoquez-la et invitez-la de nouveau.","send.error.journal":"Le journal de réception de cette personne a été supprimé dans son document : le lien existe encore, mais il n’y a plus de table où écrire. Tant que cela dure, les envois vers les autres personnes de ce document attendent derrière celui-ci : mettez-la en pause pour les libérer, puis révoquez-la et invitez-la de nouveau (elle recrée alors sa réception).","send.behind":"{n} {n|destinataire attend|destinataires attendent} derrière l’envoi en échec vers {who} : la file d’envoi de Grist est commune à tout le document. Leurs envois repartiront dès que cette personne est mise en pause ou révoquée, ou que son envoi réussit.","send.error.rate":"Le serveur de cette personne limite le nombre d’envois (erreur 429). Grist réessaie seul pendant environ un quart d’heure : rien à faire si cela repart. Tant que cela dure, les envois vers les autres personnes de ce document attendent derrière celui-ci ; mettez-la en pause pour les libérer.","send.error.server":"Le serveur de cette personne a répondu par une erreur de son côté (erreur {status}). Grist réessaie seul pendant environ un quart d’heure : rien à faire si cela repart. Tant que cela dure, les envois vers les autres personnes de ce document attendent derrière celui-ci ; mettez-la en pause pour les libérer.","send.error.network":"Le serveur de cette personne n’a pas pu être joint (connexion refusée ou coupée). Grist réessaie seul pendant environ un quart d’heure. Si cela dure, vérifiez avec elle que son document existe encore. Tant que cela dure, les envois vers les autres personnes de ce document attendent derrière celui-ci ; mettez-la en pause pour les libérer.","send.error.slow":"Le serveur de cette personne ne répond pas : un envoi attend sa réponse depuis plus de trois minutes (Grist abandonne au bout de cinq minutes, puis réessaie). Les envois vers les autres personnes de ce document attendent derrière celui-ci ; mettez-la en pause pour les libérer.","send.error.other":"Cette personne ne reçoit plus : tant que l’envoi échoue, la file d’envoi du document est bloquée pour tous.","send.error.detail":"Détail : {detail}","recv.empty":"Aucun export reçu. Collez une invitation reçue du document SOURCE.","recv.emptyViewer":"Aucune réception visible : les journaux de ce document peuvent être réservés à ses éditeurs.","recv.new":"Accepter une invitation","recv.invite.title":"Invitation reçue","recv.invite.help":"Collez le code d’invitation que vous a transmis la personne qui envoie les tables (le document SOURCE).","recv.invite.summary":"« {name} » : {n|table|tables} {tables}.","recv.dest":"Pour chaque table reçue, choisissez où la ranger : dans une nouvelle table, ou dans une table déjà présente dans ce document.","recv.step.code":"Code","recv.step.dest":"Destinations","recv.step.link":"Lien","recv.step.reply":"Réponse","recv.from":"Données de {from}","recv.docId":"Identifiant du document : {doc}","recv.doc.open":"Document source","recv.backDoc":"Vos modifications repartiront vers le document {doc} (vérifié par Grist).","recv.backPersonal":"Ce document est dans un espace personnel : Grist ne dit pas à qui il appartient. Vérifiez par téléphone avec la personne qui vous invite.","recv.backCode":"Code de contrôle de l’envoi de retour :","recv.backCompared":"J’ai comparé ce code avec la personne qui m’invite : il est identique.","recv.renforce":"Sécurité renforcée : avant de brancher, comparez le code de contrôle avec la personne qui vous invite.","recv.reserve":"Réserver le journal de réception aux éditeurs (conseillé)","recv.reserve.owner":"Ce journal sera réservé aux éditeurs quand un propriétaire du document ouvrira cette page.","recv.structure.auto.option":"Appliquer automatiquement les colonnes que la SOURCE ajoute à l’export","recv.structure.auto.help":"Si la case est décochée, une colonne ajoutée par la SOURCE n’est créée chez vous qu’après votre accord : un bouton « Appliquer » apparaît alors sur la carte de la réception. Les lignes, elles, continuent d’arriver normalement, et la colonne se remplit d’un coup quand vous l’acceptez.","recv.structure.held.title":"La SOURCE a ajouté {n} {n|colonne|colonnes} à l’export","recv.structure.held.body":"Rien n’a été changé dans ce document. Ces colonnes ne seront créées qu’avec votre accord ; leurs valeurs sont déjà reçues. Les autres colonnes continuent d’être recopiées.","recv.structure.held.line":"{table} → {dest} : la colonne « {col} » ({type}) serait créée sous le nom « {to} ».","recv.structure.gone.line":"{table} → {dest} : la SOURCE n’envoie plus la colonne « {col} ». Elle reste ici, ses valeurs ne sont plus mises à jour.","recv.structure.retyped.line":"{table} → {dest} : la colonne « {col} » est maintenant de type {sent} dans la SOURCE. Ici elle reste de type {here}, les valeurs arrivent telles quelles.","recv.structure.info.title":"La SOURCE a changé son export","recv.structure.info.body":"Rien à décider : ces changements ne touchent pas vos tables. « Compris » ne les répète plus.","recv.structure.apply":"Appliquer","recv.structure.ok":"Compris","recv.structure.auto.action":"Appliquer, puis traiter automatiquement","recv.structure.auto.title":"Traiter automatiquement à partir de maintenant ?","recv.structure.auto.body":"Les colonnes que la SOURCE ajoutera à l’export seront créées ici sans vous demander. Vous pourrez revenir à la demande dans « Options » de la réception.","recv.structure.auto.confirm":"Appliquer et traiter automatiquement","recv.archive":"Garder ici les lignes supprimées dans la SOURCE","recv.archive.col":"Supprimée à la source","recv.lock":"Mettre les tables reçues en lecture seule","recv.lock.ownerOnly":"Seul un propriétaire du document peut changer ce réglage.","recv.lock.limit":"Cela évite les modifications par erreur. Cela n’empêche pas une personne qui peut éditer le document de modifier le journal de réception ou la structure du document.","recv.archive.off":"Si vous décochez cette option plus tard, les lignes déjà gardées restent dans la table, cochées.","recv.lock.waiting":"En lecture seule : la recopie attend qu’un propriétaire ouvre cette page.","recv.options.advanced":"Options avancées","recv.options.title":"Options de « {name} »","recv.action.options":"Options","recv.link.ok":"Le lien fonctionne.","recv.action.continue":"Continuer","recv.history.since":"Depuis votre dernière visite","recv.history.last":"Derniers changements","recv.history.n.ajout":"{n} {n|ajoutée|ajoutées}","recv.history.n.modif":"{n} {n|modifiée|modifiées}","recv.history.n.suppression":"{n} {n|supprimée|supprimées}","recv.history.n.colonne":"{n} {n|colonne ajoutée|colonnes ajoutées}","recv.history.n.refus":"{n} {n|refusée|refusées}","recv.history.colonne":"ajoutée par la SOURCE","recv.history.colLabel":"Colonne « {col} »","recv.history.more":"et {n} {n|autre|autres}","recv.history.none":"Aucune modification depuis votre dernière visite.","recv.history.ajout":"ajoutée","recv.history.modif":"modifiée","recv.history.suppression":"supprimée","recv.history.refus":"refusée","recv.history.before":"Avant","recv.history.after":"Après","recv.history.row":"Ligne {n} de la table","recv.history.rowGone":"Ligne {n} de la table, avant sa suppression","recv.drift.show":"Voir le détail ({n} {n|retouche|retouches})","recv.drift.title":"{dest} : {n} {n|modification faite|modifications faites} à la main ici","recv.drift.body":"{n|Elle reste en place|Elles restent en place} jusqu’à ce que la SOURCE modifie la même ligne. « Corriger » remet tout de suite l’état exact de la SOURCE.","recv.drift.row":"Ligne","recv.drift.col":"Colonne","recv.drift.here":"Ici","recv.drift.source":"SOURCE","recv.drift.fix":"Corriger","recv.drift.fixTitle":"Remettre les valeurs de la SOURCE dans {dest} ?","recv.drift.fixBody":"{n} {n|modification faite à la main ici est remplacée|modifications faites à la main ici sont remplacées} par l’état exact de la SOURCE.","recv.drift.fixRows":"{n} {n|ligne supprimée ici revient|lignes supprimées ici reviennent}, en fin de table.","recv.drift.fixCols":"{n} {n|colonne supprimée ici est recréée|colonnes supprimées ici sont recréées}.","recv.links.done":"Références refaites","recv.links.item":"{name} vers {target}","recv.relink.title":"{n} {n|colonne reste|colonnes restent} du texte : {name}","recv.relink.body":"La SOURCE garde {n|le lien de cette colonne|le lien de ces colonnes}, mais {n|elle contenait|elles contenaient} déjà du texte reçu avant : le widget n’y touche pas sans votre accord.","recv.relink.owner":"Un propriétaire du document peut les refaire.","recv.relink.button":"Refaire les références","recv.relink.confirmTitle":"Refaire les références de « {name} » ?","recv.relink.item":"La colonne {name} devient une Référence vers la table {target}.","recv.relink.item.list":"La colonne {name} devient une Liste de références vers la table {target}.","recv.relink.body2":"Chaque cellule reprend le lien envoyé par la SOURCE, à la place du texte déjà reçu. Si la ligne visée n’est pas encore arrivée, la cellule reste vide et se remplit à son arrivée. Une valeur que vous aviez changée à la main dans ces colonnes est remplacée. Vous pouvez revenir en arrière avec l’Historique du document (Ctrl+Z).","recv.relink.done":"Références refaites : {cols}.","recv.drift.rowGone":"Ligne supprimée ici, toujours dans la SOURCE","recv.drift.colGone":"Colonne supprimée ici, toujours envoyée par la SOURCE","recv.review.title":"{dest} : {n} {n|changement|changements} à valider","recv.review.body":"Envoyés par ce participant, ils attendent votre décision : rien n’est écrit ici ni transmis aux autres participants avant.","recv.review.accept":"Accepter","recv.review.refuse":"Refuser","recv.review.accepterAll":"Tout accepter","recv.review.refuserAll":"Tout refuser","recv.review.accepterAllBody":"{n} {n|changement à valider est recopié|changements à valider sont recopiés} ici.","recv.review.refuserAllBody":"{n} {n|changement à valider est refusé|changements à valider sont refusés}.","recv.review.here":"Ici","recv.review.proposed":"Proposé","recv.gap.title":"{dest} : {n} {n|ligne refusée reste différente|lignes refusées restent différentes} chez le participant","recv.gap.body":"Il garde sa version (réglage de l’export). L’écart disparaît à la prochaine modification de la ligne, ici ou chez lui.","recv.gap.theirs":"Chez lui","recv.gap.ajout":"Ajoutée chez lui, absente ici","recv.gap.modif":"Modifiée chez lui","recv.gap.suppression":"Supprimée chez lui, gardée ici","recv.label.change":"Changer la colonne affichée","recv.label.title":"Colonne affichée","recv.label.help":"Colonne qui nomme chaque ligne dans l’historique, par table.","recv.create":"Créer les tables","recv.existing":"Pour chaque colonne envoyée, choisissez la colonne de votre table qui la reçoit. Le widget ajoute les colonnes qui manquent, ainsi qu’une colonne masquée « id_sync » qui sert à reconnaître chaque ligne.","recv.dest.new":"Nouvelle table","recv.dest.taken":"{dest} (reçoit déjà {table})","recv.new.title":"Nouvelle table : le widget n’y sera pas","recv.new.body":"{tables} {n|sera créée|seront créées} par le widget, avec {n|sa propre page|leurs propres pages}. Le widget n’est pas ajouté tout seul à {n|cette page|ces pages} : tant que vous restez sur {n|cette page|ces pages}, il ne tourne pas et rien de nouveau n’arrive.","recv.new.safe":"Pour sécuriser la réception : créez d’abord la table vous-même, ajoutez-y le widget (« Ajouter un widget à la page », « Personnalisée », même adresse, accès complet), puis relancez cette procédure depuis cette page en choisissant la table existante.","recv.new.after":"Si vous continuez ici, la carte de la réception passera en orange (« Widget à ajouter ») jusqu’à ce que vous cliquiez sur « Ajouter le widget à la page de la table reçue » : cela pose le widget sur la page de la nouvelle table, et Grist vous demandera ensuite l’accès complet. Un seul widget ouvert suffit pour toutes les réceptions du document.","recv.new.ok":"Continuer avec une nouvelle table","recv.widget.add":"Ajouter le widget à la page de {table}","recv.widget.addSome":"Ajouter le widget à la page d’une table reçue","recv.widget.title":"Ajouter le widget à la page d’une table reçue","recv.widget.body":"Une section du widget est ajoutée à la page de {table}. Le widget y retrouve toutes les réceptions du document et recopie les données reçues dès que vous ouvrez cette page. Un seul widget ouvert suffit pour tout le document : ce bouton sert à le poser là où vous travaillez.","recv.widget.pick":"Page de la table","recv.widget.chosen":"la table choisie ci-dessous","recv.widget.access":"Grist demandera ensuite l’accès complet pour cette nouvelle section : ouvrez la page, puis le panneau de droite (icône tout en haut à droite) et cliquez sur « Accepter ». Sans cet accord, le widget ne peut rien lire.","recv.widget.ok":"Ajouter le widget","recv.widget.done":"Widget ajouté à la page de {table}. Ouvrez cette page, puis acceptez l’accès complet dans le panneau de droite (icône tout en haut à droite) : le widget démarre seul.","recv.widget.already":"Le widget est déjà sur la page de {table}.","recv.widget.missing.title":"Le widget n’est sur la page d’aucune table reçue","recv.widget.missing.one":"Le widget ne recopie les données reçues que tant que sa page est ouverte. Si vous ouvrez la page de {table}, il s’arrête et rien de nouveau n’y arrive. Ajoutez-le à cette page : la recopie continue là où vous travaillez. Un seul widget suffit pour tout le document.","recv.widget.missing.some":"Le widget ne recopie les données reçues que tant que sa page est ouverte. Si vous ouvrez la page d’une des tables reçues, il s’arrête et rien de nouveau n’y arrive. Ajoutez-le à la page de l’une d’elles : la recopie continue là où vous travaillez. Un seul widget suffit pour tout le document.","recv.widget.missing.next":"Un clic sur le bouton ci-dessous suffit ; Grist vous demandera ensuite l’accès complet (panneau de droite).","recv.lost.title":"Réception supprimée : {name}","recv.lost.body":"Le journal « {journal} » de cette réception n’existe plus dans ce document : le widget a perdu sa mémoire (export, clé de signature) et ne recopie plus rien pour elle.","recv.lost.gone":"{n|La table reçue|Les tables reçues} ({list}) {n|a été supprimée|ont été supprimées} aussi.","recv.lost.kept":"{n|La table reçue|Les tables reçues} ({list}) {n|est encore là|sont encore là}, avec les lignes déjà recopiées, mais plus rien n’y arrive.","recv.lost.effect":"La SOURCE ne le sait pas : son prochain envoi échouera, et elle mettra cette réception en pause d’office au bout d’une minute (« journal supprimé »).","recv.lost.how":"Si la suppression est récente, annulez-la : Ctrl+Z dans Grist, ou « Historique du document » (dans les outils, à gauche). Sinon, demandez à la SOURCE de révoquer cette réception puis de vous inviter de nouveau, et acceptez l’invitation ici.","recv.lost.clean":"Retirer cet avis","recv.lost.owner":"Seul un propriétaire du document peut retirer cet avis.","recv.dest.name":"Nom de la nouvelle table pour {table}","recv.dest.nameLabel":"Nom de la nouvelle table","recv.dest.from":"Table reçue","recv.dest.to":"Ranger dans","recv.undo.title":"Revenir aux destinations ?","recv.undo.body":"Le journal de cette réception et son formulaire sont supprimés, ainsi que les tables qu’elle a créées si elles sont encore vides. Vous pourrez ensuite choisir de nouveau où ranger chaque table.","recv.col.new":"Nouvelle colonne « {col} »","recv.match":"Rattacher les lignes déjà là par la colonne","recv.match.none":"Ne pas rattacher","recv.match.help":"Si une ligne de votre table a, dans cette colonne, la même valeur qu’une ligne reçue, elle est mise à jour au lieu d’être ajoutée une seconde fois. Vos autres lignes ne sont jamais modifiées.","recv.link.title":"Lien du formulaire","recv.link.where":"sur sa propre page, en bas de la liste des pages","recv.link.where.page":"sur la page « {page} », dans la liste des pages (ouvrez-la)","recv.link.help":"Le widget vient de publier un formulaire de réception {where}. Copiez son lien (Partager, puis Copier le lien) et collez-le ici : un seul lien sert pour toutes les tables de l’export.","recv.link.step1":"1. Ouvrez la page du formulaire et cliquez « Partager » dans sa carte.","recv.link.step2":"2. Cliquez « Copier le lien », puis collez-le ci-dessous.","recv.link.check":"Tester le lien","recv.reply.help":"Renvoyez ce code à la personne qui vous a invité : elle le colle dans son widget pour brancher l’envoi.","recv.reply.code":"Code de contrôle :","recv.status.waiting":"En attente du lien","recv.status.ok":"À jour","recv.status.review":"À valider","recv.status.error":"Erreur","recv.status.incomplete":"Incomplet","recv.status.ended":"Coupé par la SOURCE","recv.status.widget":"Widget à ajouter","recv.ended":"La SOURCE a coupé cet envoi le {at} (révocation, export supprimé ou Échange arrêté) : plus rien n’arrivera. Les tables gardent leurs lignes ; « Arrêter la réception » retire le journal et son formulaire.","recv.renf.suggest.title":"Vous pouvez renforcer la sécurité de ce partage","recv.renf.suggest.body":"Ce partage a été branché avant les clés de signature : qui obtient le lien du formulaire peut y écrire. Une nouvelle invitation de la SOURCE le protège avec une clé propre à ce document.","recv.renf.suggest.safe":"Rien ne s’arrête et rien n’est imposé : ce partage continue d’arriver comme avant tant que vous ne faites rien. La même réception reprend, avec ses tables et ses données.","recv.renf.start":"Renforcer la sécurité","recv.renf.pending.title":"Renforcement en cours","recv.renf.pending.body":"Les envois de la SOURCE continuent d’arriver comme avant jusqu’à sa première livraison signée, au plus tard le {end} ({days} jours). Elle doit encore approuver votre réponse.","recv.renf.pending.safe":"Passé ce délai, les envois sans signature sont refusés. Vous pouvez aussi revenir à l’ancien fonctionnement.","recv.renf.reply":"Renvoyer ma réponse","recv.renf.revert":"Revenir à l’ancien fonctionnement","recv.renf.revert.title":"Revenir à l’ancien fonctionnement ?","recv.renf.revert.body":"La clé préparée pour ce renforcement est effacée et la réception redevient telle qu’avant : les envois sans signature sont acceptés, sans protection. Vous pourrez renforcer la sécurité plus tard.","recv.renf.expired.title":"Renforcement interrompu","recv.renf.expired.body":"Le délai d’attente s’est terminé le {end} sans livraison signée. Vos données ne sont plus à jour depuis : les envois sans signature de la SOURCE sont refusés.","recv.renf.expired.how":"Pour reprendre : renvoyez votre réponse à la SOURCE (elle l’approuve et tout repart), ou revenez à l’ancien fonctionnement. Si la SOURCE n’a plus votre invitation, demandez-lui-en une nouvelle.","recv.renf.done":"Partage renforcé le {at} : les envois sont signés avec une clé propre à ce document.","recv.relink.confirm.renf":"« {name} » est déjà reçu dans ce document (journal {journal}) et n’avait pas encore de clé de signature. Cette invitation le renforce : la même réception reprend, avec ses tables et ses données, et l’ancien envoi reste accepté jusqu’à la première livraison signée. Vérifiez qu’elle vient bien de la même personne et du même document.","recv.relink.renf":"Encore deux gestes : copiez le lien du formulaire, puis renvoyez la réponse à la SOURCE. Rien ne s’arrête en attendant.","recv.relink.ok.renf":"Renforcer la sécurité","error.revertNone":"Cette réception n’a rien à défaire : le renforcement est fini ou n’a pas commencé.","error.reinforceNot":"Ce destinataire ne peut pas être renforcé ici (Échange, lien public, envoi coupé ou export introuvable).","error.reinforceOtherDoc":"Cette réponse vient d’un autre document que celui de ce destinataire : un renforcement doit venir du même document.","recv.formGone":"Le formulaire de réception n’est plus publié (dépublié ou page supprimée) : la SOURCE ne peut plus rien écrire ici, et les données n’arrivent plus. « Refaire le lien » le republie ; la SOURCE doit ensuite révoquer cette réception et vous inviter de nouveau.","recv.sync.none":"Rien de nouveau : tout est à jour.","recv.consent":"En continuant, le widget ajoute à ce document les tables et colonnes nécessaires, un journal technique et un formulaire de réception.","recv.consent.public":"En continuant, le widget ajoute à ce document les tables et colonnes nécessaires et un journal technique.","recv.consent.echange":"Échange : vos modifications de ces tables repartiront vers le document SOURCE, la plus récente l’emportant.","recv.outgoing.title":"Envoyer ces colonnes ?","recv.outgoing.body":"Dans un Échange, une table existante repart en entier vers l’autre document : les colonnes {list} partiront vers {where}, et leurs modifications suivront.","recv.outgoing.ok":"Envoyer","recv.exchange":"Échange : vos modifications de ces tables repartent vers ce document, qui peut les transmettre à d’autres participants.","recv.exchange.back":"Échange : les modifications de ce participant arrivent dans vos tables, selon les règles de l’export (onglet Envoyer).","recv.action.sync":"Synchroniser","recv.action.link":"Refaire le lien","recv.public":"Lien public : relu tant que cette page est ouverte, seulement quand l’export change.","recv.public.done":"Branché : le widget lit la SOURCE tant que cette page est ouverte.","recv.action.stop":"Arrêter la réception","recv.stop.title":"Arrêter de recevoir « {name} » ?","recv.stop.body":"Le widget supprime le journal {journal} et son formulaire de réception, avec son lien d’écriture : les envois de la SOURCE échoueront, et elle devra révoquer cette réception. Les tables de destination et leurs lignes restent.","recv.result":"{added} {added|ajoutée|ajoutées}, {updated} {updated|mise à jour|mises à jour}, {removed} {removed|supprimée|supprimées}","recv.result.none":"Rien à faire","recv.auto":"Mise à jour automatique tant que cette page est ouverte.","recv.auto.detail":"Toutes les 10 secondes, toutes les minutes quand rien n’arrive.","recv.missing":"{table} : {n} {n|ligne n’est pas encore arrivée|lignes ne sont pas encore arrivées} (envoi en plusieurs morceaux). {n|Elle part d’elle-même|Elles partent d’elles-mêmes} tant qu’un propriétaire de la SOURCE a la page de son widget ouverte : si ce nombre ne baisse pas, demandez-lui de l’ouvrir.","recv.arrival":"Dernier envoi arrivé : {at} · {n} {n|version reçue|versions reçues} (une ligne modifiée trois fois compte trois fois).","recv.arrival.raw":"{n} {n|envoi arrivé n’est pas encore recopié|envois arrivés ne sont pas encore recopiés} dans les tables : le widget le fait tant que cette page reste ouverte et visible.","recv.action.report":"Copier l’état pour la SOURCE","recv.action.clean":"Effacer l’historique","recv.clean.title":"Effacer l’historique de « {name} » ?","recv.clean.body":"L’historique affiché sur la carte repart de zéro. Dans le journal de réception, les valeurs « avant » et celles des lignes supprimées dans la SOURCE sont effacées. Vos tables ne changent pas et la synchronisation continue.","recv.clean.limits":"L’historique propre à Grist (Ctrl+Z, « Historique du document ») n’est pas touché. Cette action, elle, ne peut pas être annulée.","recv.clean.confirm":"Effacer","recv.clean.done":"Historique effacé (journal nettoyé : {before} {before|valeur d’avant|valeurs d’avant}, {values} {values|ligne supprimée|lignes supprimées}).","recv.report.copied":"État copié. Collez-le dans un message à la personne qui envoie : il ne contient ni code, ni lien, ni valeur de vos tables.","recv.report.failed":"Copie impossible depuis ici : sélectionnez et copiez le texte ci-dessous.","recv.tally":"{table} : la SOURCE annonce {expected} {expected|ligne|lignes}, mais seules {got} sont arrivées ici, et rien n’a changé depuis {min} minutes. Il en manque {gap}. Un envoi a pu se perdre (Grist redémarré, file d’envoi vidée), ou des lignes de la SOURCE partagent la même clé. Demandez à un propriétaire de la SOURCE d’ouvrir la page de son widget et de cliquer sur « Tout renvoyer » ; « Copier l’état pour la SOURCE » lui donne de quoi vérifier.","recv.big":"{table} : {n} {n|ligne ne peut pas arriver|lignes ne peuvent pas arriver}, plus {n|grosse|grosses} à elle seule que la taille maximale d’un envoi de Grist (1 Mo). Raccourcissez-la dans la SOURCE.","recv.tooBig":"{tables} : trop gros pour le lien public (plus de 2 Mo), rien n’en est lu. Demandez à la SOURCE une invitation, ou un filtre de lignes.","recv.files.waiting":"{n} {n|fichier attendu|fichiers attendus} dans {dest} : {n|il arrive|ils arrivent} quand un propriétaire du document SOURCE ouvre la page du widget.","recv.files.big":"Trop gros pour partir ({max} Mo au plus) : {files}.","recv.files.held":"{n} {n|ligne attend|lignes attendent} {n|son fichier|leurs fichiers} avant d’être {n|recopiée|recopiées} dans {dest} : {n|il arrive|ils arrivent} quand un propriétaire de l’autre document ouvre la page de son widget.","recv.files.bigHeld":"Trop gros pour être échangé ({max} Mo au plus) : {files}. La ligne qui le porte n’est pas recopiée tant qu’il est dans la cellule.","recv.files.named":"{name} ({size} Mo)","recv.files.public":"Les pièces jointes ne passent pas par le lien public : leurs colonnes restent vides dans {dest}.","recv.files.refused":"Grist refuse de déposer le fichier {name} ici ({error}) : nouvel essai dans 10 minutes.","recv.files.count":"{n} {n|fichier|fichiers}","recv.suspect.title":"Arrivées suspectes","recv.suspect.rejected":"{n} {n|ligne rejetée|lignes rejetées} dans le journal, {n|le|la dernière le} {at} : {n|elle ne pouvait|elles ne pouvaient} pas venir de la SOURCE de cet export (autre export, contenu illisible). Rien n’a été recopié.","recv.suspect.flood":"Arrivée anormale le {at} : plus de 600 lignes en une minute, traitées par petits lots.","recv.suspect.help":"Deux explications possibles. Soit le document SOURCE a été retouché à la main (colonne, formule ou table supprimée) : demandez à la personne qui le gère de regarder l’onglet Envoyer de son widget, qui le signale. Soit quelqu’un d’autre que la SOURCE écrit avec le lien du formulaire : si vous ne l’expliquez pas, coupez le lien.","recv.suspect.cut":"Couper le lien","recv.suspect.dismiss":"Effacer l’alerte","recv.cut.title":"Couper le lien du formulaire ?","recv.cut.body":"L’ancien lien n’écrira plus rien dans cette réception, et les envois de la SOURCE échoueront. Pour reprendre, la SOURCE révoque l’ancien destinataire et vous envoie une nouvelle invitation : acceptez-la ici, et la même réception reprend avec ses tables et un nouveau formulaire, sur sa propre page.","recv.cut.done":"Lien coupé. Demandez une nouvelle invitation à la SOURCE, et acceptez-la ici.","recv.shared.title":"Lien commun à d’autres formulaires","recv.shared.body":"Le formulaire de cette réception est sur une page qui porte {n} {n|autre formulaire|autres formulaires} : leur lien commun peut aussi écrire dans ce journal. Coupez le lien : cette réception reprendra avec son propre formulaire, sur sa propre page.","recv.relink":"Cet export est déjà reçu ici : la même réception reprend avec cette nouvelle invitation. Copiez le lien du formulaire (il a peut-être changé).","recv.relink.confirm":"« {name} » est déjà reçu dans ce document (journal {journal}). Cette invitation reprend la même réception, avec ses tables : vérifiez qu’elle vient bien de la même personne et du même document.","recv.relink.ok":"Reprendre la réception","recv.offer.title":"Table ajoutée à l’export : {table}","recv.offer.refuseTitle":"Refuser la table {table} ?","recv.offer.refuseBody":"Les lignes de cette table seront écartées dès qu’elles arrivent, maintenant et plus tard. Pour la recevoir finalement, il faudra arrêter la réception, puis accepter une nouvelle invitation.","recv.offer.body":"« {name} » envoie maintenant la table {table} ({n} {n|ligne|lignes} ; colonnes {cols}).","recv.offer.where":"Table qui recevra les lignes (nouvelle ou existante)","recv.offer.accept":"Recevoir","recv.offer.refuse":"Refuser","recv.offer.line":"Nouvelle table proposée : {table} ({n} {n|ligne|lignes})","recv.offer.place":"Choisir où la ranger","recv.offer.refusedList":"Tables refusées (leurs lignes sont effacées à l’arrivée) : {tables}.","error.codeFormat":"Ce texte n’est pas un code de synchro. Recopiez tout le code, de « GRISTSYNC2. » jusqu’à la fin.","error.codeOld":"Ce code vient d’une version précédente du widget. Demandez une nouvelle invitation.","error.codeNewer":"Ce code vient de la version {theirs} du widget, plus récente que celle de ce document ({mine}) : le widget de ce document est en retard, rien n'est à refaire du côté de l'autre document. Les deux documents doivent utiliser le widget à la même adresse : vérifiez-la dans les réglages du widget (panneau de droite de Grist), rechargez la page pour prendre la dernière version, puis recollez le code.","error.inviteOld":"Cette réponse vient d’une invitation faite par une version précédente du widget. Refaites le code (« Retour », puis « Refaire le code ») et transmettez le nouveau.","error.notInvitation":"Ce code est une réponse, pas une invitation.","error.notReply":"Ce code est une invitation, pas une réponse.","error.codeInvalid":"Ce code est incomplet ou modifié.","error.otherInstance":"Le document CIBLE est sur une autre instance Grist : l’envoi est refusé.","error.alreadyReceived":"Cet export est déjà reçu dans ce document, par lien public ou depuis un autre document : arrêtez d’abord cette réception.","error.exportTaken":"Cette invitation reprend l’identifiant d’un export de ce document : elle le remplacerait. Elle ne vient pas d’un widget à jour, ou a été modifiée : refusez-la.","error.unknownInvitation":"Cette réponse ne correspond à aucune invitation en attente de ce document, ou son secret est différent.","error.invitationExpired":"Cette invitation a expiré (elle vaut 7 jours). Demandez-en une nouvelle à la personne qui vous l’a envoyée, ou refaites le code.","error.shareUnreadable":"Grist ne répond pas pour vérifier le document de ce lien. Réessayez dans un instant.","error.shareUnknown":"Ce lien ne mène à aucun formulaire publié : il a été coupé, ou recopié incomplet.","error.shareOtherDoc":"Refusé : ce lien écrit dans un autre document que celui que dit le code. Ne branchez pas, et prévenez la personne.","error.codeNotCompared":"Sécurité renforcée : comparez d’abord le code de contrôle avec la personne, puis cochez la case.","error.publicHidden":"Lien public refusé : une règle d’accès cache une partie de {tables}. Le lien public la montrerait à tous ; retirez ces colonnes ou ces tables de l’export, ou invitez plutôt la personne.","error.publicHiddenEdit":"Modification refusée : cet export est partagé par lien public, et une règle d’accès cache une partie de {tables}. Le lien public la montrerait à tous ; retirez ces tables de l’export, ou coupez d’abord le lien public.","error.mapTwice":"Deux colonnes envoyées vont dans la même colonne.","error.matchUnmapped":"La colonne de rattachement doit recevoir une colonne envoyée.","error.publicClosed":"Le document SOURCE n’est plus lisible par lien public.","error.noColumn":"Cochez au moins une colonne par table.","error.loop":"Boucle refusée : une table reçue ne peut pas être renvoyée au document d’où elle vient, ni une table vers elle-même. Ce serait une synchro dans les deux sens. Le relais vers un autre document, lui, est possible.","error.destTaken":"{dest} reçoit déjà la table {table} : une table d’ici ne reçoit qu’une table envoyée. Choisissez une nouvelle table, ou une autre table existante.","error.destTwice":"Deux tables reçues vont dans {dest} : une table d’ici ne reçoit qu’une table envoyée. Choisissez une autre destination pour l’une d’elles.","error.destReserved":"{dest} est un nom réservé au widget : choisissez-en un autre.","error.destExported":"Ce document envoie déjà cette table dans un export : elle ne peut pas aussi en recevoir une (ses lignes seraient effacées). Choisissez une autre table.","error.ownerOnly":"Seul un propriétaire du document peut faire cela.","error.destMissing":"La table {dest} n’existe plus.","error.keyLost":"clé de signature introuvable (table de destination ou colonne id_sync effacée ?), rien n’est recopié. Demandez une nouvelle invitation à la SOURCE : la même réception reprend.","error.webhookForbidden":"Grist a refusé de créer le webhook : cette instance n’autorise pas les webhooks vers sa propre adresse. Rien n’a été branché. Demandez à l’administrateur de l’instance d’ajouter l’adresse de l’instance à la liste des domaines autorisés pour les webhooks (réglage ALLOWED_WEBHOOK_DOMAINS), puis recommencez.","error.gristTooOld":"Cette instance Grist ne sait pas filtrer un webhook par export (il faut Grist 1.7.11 ou plus récent). Rien n’a été branché.","error.queueStuck":"La file d’envoi ne se vide pas : un destinataire ne reçoit plus. Voyez l’erreur sur sa ligne, puis réessayez.","error.tableNameEmpty":"Donnez un nom à la table.","error.tableNameInvalid":"Le nom ne peut avoir que des lettres sans accent, des chiffres et « _ », et ne commence pas par un chiffre.","error.tableNameTaken":"Une table de ce document porte déjà ce nom.","error.syncTableForeign":"Une table nommée Synchro existe déjà dans ce document, et le widget ne reprend pas celle de quelqu’un d’autre : l’onglet Envoyer propose de la renommer. Faites-le, puis recommencez.","error.noPageForTable":"Cette table n’a pas de page dans le document : ajoutez le widget à la page de votre choix (« Ajouter un widget à la page », « Personnalisée »), il recopie toutes les réceptions du document.","error.badWidgetUrl":"L’adresse de ce widget n’est pas lisible : ajoutez-le à la page à la main (« Ajouter un widget à la page », « Personnalisée »).","error.tooLarge":"Un envoi dépasse la taille permise par Grist (1 Mo). Le widget vide la file et renvoie tout de lui-même : gardez cette page ouverte.","error.formLink":"Ce lien n’a pas la forme attendue : https://<instance>/o/<équipe>/forms/<clé>/<numéro>.","error.exchangeOwner":"Un Échange crée aussi un envoi depuis ce document : il faut en être propriétaire.","error.linkTest":"Le lien ne fonctionne pas ({detail}). Vérifiez que le formulaire est publié et que le document est dans un espace d’équipe.","error.linkElsewhere":"Ce lien n’écrit pas dans le journal de cette réception (formulaire d’une autre réception, ou d’un autre document). Copiez le lien du formulaire indiqué ci-dessus.","error.generic":"Erreur : {detail}","error.blockedRules":"Une règle d’accès de ce document empêche le widget d’écrire ici ({detail}). Dans Grist : Paramètres du document, Règles d’accès ; retirez ou assouplissez la règle qui touche cette table. Les tables du widget (Synchro, journaux) et les tables reçues doivent rester modifiables par les personnes qui s’en servent.","error.rulesRefused":"Grist a refusé de poser les règles d’accès du widget (« {why} ») : aucun export n’est créé tant que la table Synchro n’est pas protégée. Dans Grist, Paramètres du document, Règles d’accès : corrigez la règle qui vise une colonne ou une table qui n’existe plus, puis recommencez.","start.outside":"Ce widget s’ouvre dans Grist : ajoutez-le comme widget personnalisé « Constructeur » avec l’accès complet.","start.access":"Le widget a besoin de l’accès complet au document : il lit ses tables, crée sa table technique et écrit dans les tables de destination. Sans cet accès, il reste bloqué sur ce message.","start.access.where":"Le réglage est dans le panneau de droite de Grist, section « Niveau d’accès ». Cliquez d’abord sur ce widget, puis :","start.access.open":"Panneau fermé : cliquez sur l’icône encadrée, tout en haut à droite, pour l’ouvrir","start.access.accept":"Panneau ouvert : cliquez sur « Accepter »","start.access.list":"Ou choisissez « Accès complet au document » dans la liste","start.slow":"Grist ne répond pas au widget. Vérifiez qu’il a l’accès complet au document (panneau de droite : « Accepter », ou « Accès complet au document » dans « Niveau d’accès »), puis rechargez la page. Si cela dure, vérifiez votre connexion.","start.network":"Le widget ne peut pas charger l’API de Grist depuis {origin} : le réseau la bloque, ou cette instance n’est pas dans la liste du widget.","start.failed":"Le widget n’a pas pu lire le document. {detail} Rechargez la page.","start.reload":"Recharger la page","diag.title":"Diagnostic Sync+ {version} ({served})","diag.date":"Date : {value}","diag.instance":"Instance : {value}","diag.unknown":"inconnue","diag.access":"Droits : {value}","diag.access.reader":"lecteur","diag.access.editor":"éditeur","diag.access.owner":"propriétaire","diag.browser":"Navigateur : {value}","diag.send":"== Envoyer","diag.receive":"== Recevoir","diag.errors":"== Erreurs récentes","diag.errors.none":"Aucune.","diag.none":"aucune","diag.yes":"oui","diag.no":"non","diag.send.none":"Aucun export (pas de table Synchro).","diag.send.noExport":"Aucun export.","diag.send.ownerOnly":"Destinataires : lecture réservée aux propriétaires.","diag.send.unsafe":"Webhooks sur Synchro sans filtre reconnu : {n}","diag.send.charge":"Renvoi en cours : {value}","diag.send.progress":"Avancement : {value}","diag.send.catchUp":"Rattrapage : {value}","diag.send.kinds":"Lignes de Synchro : {value}","diag.recv.none":"Aucune réception.","diag.recv.compare":"Grist refuse la comparaison d’états : relecture au rythme lent.","diag.recv.visible":"Page visible : {value}","diag.recv.hidden":"non (la recopie attend)","diag.charge.alive":"signe de vie il y a {n} s","diag.charge.budget":"budget atteint, reprise dans {n} s","diag.line":"  {label} : {value}","diag.export":"Export {id} « {name} » ({mode})","diag.journal":"Réception {journal} (export {export}, {mode})","diag.journal.flags":"  signée : {signed}, sceau : {sealed}, réservée aux éditeurs : {reserve}","diag.mode.public":"public","diag.mode.return":"retour","diag.mode.exchange":"echange","diag.mode.oneway":"sens unique","diag.mode.reply":"reponse","diag.suffix.renforce":", renforcé","diag.suffix.return":", retour","diag.table":"{table} ({n} col.)","diag.table.filter":"{table} ({n} col., filtre)","diag.reserve.set":"posée","diag.reserve.waiting":"en attente","diag.arrival":"{n} lignes, dernière arrivée {when}, {raw} envois bruts pas encore recopiés","diag.arrival.nodate":"{n} lignes, aucune date d’arrivée, {raw} envois bruts pas encore recopiés","diag.gap":"{table}: {got} reçues sur {expected} annoncées","diag.suspect":"{n} (dernière {when})","diag.suspect.flood":"{n} (dernière {when}, flot)","diag.progress":"export {export}, {done} sur {total} lignes, {lots} lots sur environ {lotsTotal}","diag.progress.last":", dernier lot il y a {n} s","diag.catch.first":"en cours, premier passage","diag.catch.never":"pas encore passé","diag.catch.last":"dernier passage {when}","diag.catch.running":", en cours","diag.pass.idle":"rien à renvoyer","diag.pass.sent":"a renvoyé","diag.pass.blocked":"bloqué : un destinataire est en erreur","diag.pass.busy":"une autre page renvoie","diag.pass.nosync":"pas de table Synchro","diag.rcpt":"destinataire","diag.rcpt.on":"actif","diag.rcpt.paused":"en pause","diag.rcpt.queue":"file {n}","diag.rcpt.success":"dernier succès {when}","diag.rcpt.failure":"dernier échec {when}","diag.rcpt.attempts":"{n} essais","diag.rcpt.error":"« {error} »","diag.rcpt.none":"aucun destinataire","diag.l.tables":"tables","diag.l.lost":"tables introuvables","diag.l.changed":"colonnes changées","diag.l.invitations":"invitations en attente","diag.l.late":"lots coupés","diag.l.lists":"listes dues","diag.l.refused":"tables refusées","diag.l.offers":"tables proposées","diag.l.ended":"coupée par la SOURCE","diag.l.missing":"lignes manquantes","diag.l.announced":"lignes annoncées par la SOURCE","diag.l.gap":"manque signalé","diag.l.big":"clés trop grosses","diag.l.suspect":"arrivées suspectes","diag.l.journal":"journal","diag.l.errors":"erreurs","tab.out.button":"Envoyer à un document ouvert dans ce navigateur","tab.out.help":"Le document CIBLE est ouvert dans un autre onglet de ce navigateur ? L’invitation y arrive d’un clic, sans copier le code, et la réponse revient ici toute seule.","tab.out.sent":"Invitation envoyée. En attente de l’autre document…","tab.out.seen":"L’autre document l’a reçue : passez-y, une invitation vous y attend.","tab.out.silent":"Aucun document n’a répondu. Il doit être ouvert dans un autre onglet de ce navigateur (même profil, hors navigation privée), avec ce widget démarré à la même adresse, et ne pas être en lecture seule. Sinon, copiez le code ci-dessus.","tab.in.title":"Une invitation vous attend dans cet onglet","tab.in.line":"« {name} » : un document ouvert dans ce navigateur vous propose de recevoir des tables. Rien n’est écrit tant que vous n’avez pas accepté.","tab.in.doc":"Document source annoncé : « {doc} ».","tab.in.check":"Le navigateur ne dit pas de quel document vient l’invitation : l’étape suivante le vérifie auprès de Grist.","tab.in.use":"Recevoir","tab.in.ignore":"Ignorer","tab.back.button":"Renvoyer au document d’origine","tab.back.help":"Le document d’origine est ouvert dans un autre onglet de ce navigateur ? La réponse y arrive d’un clic.","tab.back.sent":"Réponse envoyée. En attente du document d’origine…","tab.back.got":"Le document d’origine l’a reçue : passez-y pour l’approuver, après avoir comparé les codes de contrôle.","tab.back.silent":"Aucun document n’a répondu. Le document d’origine doit être ouvert dans un autre onglet de ce navigateur, à l’étape « Invitation » ou « Réponse ». Sinon, copiez le code ci-dessous.","tab.reply.wait":"Le document CIBLE est ouvert dans ce navigateur ? Sa réponse arrive ici toute seule.","tab.reply.got":"Réponse reçue d’un autre onglet de ce navigateur : vérifiez la fiche, puis comparez le code de contrôle avec l’autre document.","tab.reply.other":"Une autre réponse est arrivée d’un autre onglet : elle n’a pas remplacé celle-ci. Si c’est elle que vous attendiez, recollez-la ci-dessus.","recv.format.title":"Langue et devise du document différentes de la SOURCE","recv.format.body":"La SOURCE écrit ses nombres en « {source} », ce document en « {here} ». Les séparateurs des nombres et la devise par défaut viennent du réglage du document, pas de la colonne : choisir l’euro dans une colonne ne change donc pas l’écriture américaine.","recv.format.owner":"Seul un propriétaire du document peut changer ce réglage.","recv.format.action":"Régler le document comme la SOURCE","recv.format.confirmTitle":"Régler la langue et la devise de ce document ?","recv.format.confirmBody":"La langue et la devise de tout le document passent à « {source} » : les nombres de toutes ses tables s’écrivent autrement. Ctrl+Z ou l’Historique du document permet de revenir en arrière.","recv.format.done":"Langue et devise réglées sur « {source} ».","recv.action.restyle":"Reprendre depuis la SOURCE","recv.restyle.title":"Reprendre des éléments de « {name} » depuis la SOURCE ?","recv.restyle.body":"Les éléments cochés sont remplacés par ceux de la SOURCE dans les colonnes reçues : ce que vous aviez changé à la main dans ces éléments est écrasé. Vous pouvez revenir en arrière avec l’Historique du document.","recv.restyle.done":"Éléments repris de la SOURCE.","send.el.style":"Mise en forme des colonnes","send.el.style.count":"{n} {n|colonne concernée|colonnes concernées}","send.el.style.help":"Couleurs, formats de nombre et de date, devise, style des en-têtes, règles de mise en forme conditionnelle simples (comparaisons sur les colonnes envoyées) et langue du document. Une règle plus complexe n’est pas envoyée, ni une règle propre à une vue. Chez le destinataire, ce qu’il a retouché n’est pas écrasé.","send.el.notes":"Descriptions des colonnes","send.el.notes.count":"{n} {n|colonne concernée|colonnes concernées}","send.el.notes.help":"Le texte de la description de chaque colonne (l’infobulle de son en-tête), 300 caractères au plus. Il est envoyé tel quel et lisible par chaque destinataire : ne l’envoyez pas s’il contient des notes internes. Chez le destinataire, une colonne créée par le widget reçoit cette description une seule fois ; ce qu’il a écrit ou effacé n’est pas écrasé.","send.el.tableNote":"Descriptions des tables","send.el.tableNote.count":"{n} {n|table concernée|tables concernées}","send.el.tableNote.help":"La description de chaque table (page « Données brutes »), 500 caractères au plus. Posée chez le destinataire quand celle de sa table est vide.","send.el.layout":"Ordre et colonnes cachées de la page","send.el.layout.count":"{n} {n|table concernée|tables concernées}","send.el.layout.help":"L’ordre des colonnes et celles que la page de chaque table cache (la page de la table, pas les données brutes). Chez le destinataire, seules les colonnes créées par le widget en profitent, une seule fois ; une colonne qui existait déjà ne bouge pas. Seul l’affichage change, jamais les données. Le destinataire peut la reprendre depuis la SOURCE à tout moment.","recv.restyle.style":"Mise en forme : formats, couleurs, style des en-têtes, règles de mise en forme conditionnelle","recv.restyle.notes":"Descriptions des colonnes","recv.restyle.table":"Description de la table","recv.restyle.layout":"Ordre et colonnes cachées de la page de la table","recv.restyle.confirm":"Reprendre","send.el.formulas":"Formules des colonnes (Python)","send.el.formulas.count":"{n} {n|formule|formules}","send.el.formulas.badge":"demande confirmation","send.el.formulas.help":"Le code Python de chaque colonne de formule, et celui de la formule par défaut d’une colonne de données (une formule qui ne joue que sur les nouvelles lignes), 1 500 caractères au plus chacun. Ne partent pas : une formule qui se recalcule quand une colonne change, ni celle d’une colonne Référence ou Pièces jointes. Le texte est envoyé tel quel et lisible par chaque destinataire, qui ne peut l’appliquer qu’après l’avoir lu. Sans cette case, le destinataire reçoit seulement les valeurs calculées.","send.formulas.title":"Envoyer aussi les formules ?","send.formulas.confirm":"Envoyer les formules","send.formulas.intro":"Une formule de colonne, ou une formule par défaut, est du code Python que Grist exécute sur les données du document. En cochant cette case, vous proposez à chaque destinataire d’en poser dans son document.","send.formulas.own":"Rien n’est posé tout seul : seul un propriétaire du document destinataire peut les reprendre, après avoir lu chaque formule.","send.formulas.run":"Il exécute alors votre code chez lui : n’y mettez rien de secret, et écrivez des formules que vous pouvez lui expliquer.","send.formulas.refused":"Le destinataire refuse d’office une formule trop longue, qui utilise un module système, un nom caché (qui commence par un tiret bas), la fonction REQUEST, une boucle « while » ou qui cite une table absente de l’export. Une colonne Référence ou Pièces jointes ne part pas avec sa formule.","send.formulas.sandbox":"Grist exécute les formules dans un espace isolé, dont la solidité dépend de la configuration de l’instance. Pour des données sensibles, renseignez-vous auprès de son administrateur.","send.formulas.slow":"Une formule trop lourde peut ralentir le document du destinataire. L’Historique du document permet de revenir en arrière.","recv.restyle.formulas":"Formules : poser celles de la SOURCE (Python) sur les colonnes créées par ce widget","recv.restyle.formulas.owner":"Les formules de la SOURCE ne se posent que par un propriétaire de ce document.","recv.formulas.count":"{n} {n|formule à poser|formules à poser}","recv.formulas.none":"rien à poser pour le moment","recv.formulas.intro":"Chaque formule ci-dessous est du code Python écrit dans le document de la SOURCE. Si vous la posez, Grist l’exécute chez vous, sur les données de ce document. Avec une formule de colonne, la colonne ne reçoit plus de valeurs de la SOURCE : elle les calcule. Avec une formule par défaut, la colonne reste une colonne de données : la formule ne remplit que les lignes que vous ajoutez à la main.","recv.formulas.replaces":"Les valeurs actuelles d’une colonne de formule sont remplacées par le résultat de la formule ; une formule par défaut ne touche à aucune valeur déjà là. Les formules refusées ne sont pas posées. L’Historique du document permet de revenir en arrière.","recv.formulas.table":"Table « {table} »","recv.formulas.state.data":"sera posée, colonne de données ici","recv.formulas.state.other":"sera posée, une autre formule est là","recv.formulas.state.same":"déjà posée","recv.formulas.refused":"ne sera pas posée","recv.formulas.read":"J’ai lu ces formules et je veux les poser dans ce document","recv.formulas.problem.notOwn":"cette colonne existait déjà dans ce document : elle n’est jamais transformée","recv.formulas.problem.unsafe":"contient « {name} », refusé dans une formule reçue","recv.formulas.problem.import":"importe « {name} », un module hors de la liste permise","recv.formulas.problem.missingCol":"cite la colonne « {name} », qui n’est pas dans ce document","recv.formulas.problem.renamedCol":"cite la colonne « {name} », qui s’appelle « {to} » ici","recv.formulas.problem.foreignTable":"cite la table « {name} », qui n’est pas une table de cet export","recv.formulas.problem.renamedTable":"cite la table « {name} », qui s’appelle « {to} » ici","recv.adopt.title":"« {dest} » contient déjà des lignes : rien n’y est encore écrit","recv.adopt.body":"Voici ce qui se passera si vous appliquez, d’après les lignes reçues pour l’instant (d’autres peuvent encore arriver). Vos lignes ne changent qu’avec votre accord.","recv.adopt.table":"{table} → {dest}","recv.adopt.add":"{n} {n|ligne sera ajoutée|lignes seront ajoutées}.","recv.adopt.attach":"{n} {n|ligne d’ici sera rattachée|lignes d’ici seront rattachées} à celles de la SOURCE par la colonne « {match} » (même valeur).","recv.adopt.over":"{n} {n|valeur d’ici sera remplacée|valeurs d’ici seront remplacées} par celles de la SOURCE.","recv.adopt.fill":"{n} {n|cellule vide sera remplie|cellules vides seront remplies}.","recv.adopt.untouched":"{n} {n|ligne d’ici ne bouge|lignes d’ici ne bougent} pas : {n|elle reste|elles restent} comme {n|elle est|elles sont}.","recv.adopt.sample":"« {key} » : {col} passe de « {here} » à « {sent} ».","recv.adopt.nomatch":"Aucune colonne commune n’a été choisie pour rattacher les lignes : si ces lignes existent déjà ici, elles seront en double. Annulez la réception et recommencez en choisissant la colonne commune pour éviter cela.","recv.fit.risky":"{col} → {to} : la SOURCE envoie le type {sent}, la colonne d’ici est de type {here}. Les valeurs qui ne conviennent pas seront gardées, mais marquées invalides par Grist.","recv.fit.bad":"{col} → {to} : la SOURCE envoie le type {sent}, la colonne d’ici est de type {here}, qui ne peut pas recevoir ces valeurs. Choisissez une autre colonne ou une nouvelle.","recv.fit.title":"Des types de colonnes ne correspondent pas","recv.fit.body":"Rien n’est modifié dans vos colonnes, mais ces valeurs risquent d’être invalides ou inutilisables :","recv.fit.ok":"Continuer quand même","send.drift.title":"{n} {n|colonne a changé|colonnes ont changé} depuis l’export","send.drift.body":"Ces colonnes ne partent plus correctement. « Modifier » remet l’export d’accord avec la table.","send.drift.gone":"{table} : la colonne « {col} » n’existe plus (supprimée, ou renommée).","send.drift.renamed":"{table} : la colonne « {col} » n’existe plus ; « {to} » est du même type, elle a sans doute été renommée.","send.drift.retyped":"{table} : la colonne « {col} » est passée du type {was} au type {now}. La CIBLE garde son type, les valeurs arrivent telles quelles.","send.drift.shown":"{table} : la colonne affichée par « {col} » a changé, les valeurs envoyées ne sont plus les mêmes.","send.new.title":"{n} {n|colonne ne part|colonnes ne partent} pas","send.new.body":"Ajoutée depuis l’enregistrement de l’export, elle ne part pas tant que vous ne l’avez pas décidé. Envoyée, elle arrive chez les destinataires comme une colonne ajoutée à l’export.","send.new.line":"{table} : {cols}","send.new.send":"Envoyer ces colonnes","send.new.dismiss":"Ne pas les envoyer","send.autoCols":"Envoyer aussi les futures colonnes que j’ajouterai à ces tables","send.autoCols.help":"Par défaut, une colonne ajoutée plus tard n’est pas envoyée : la carte de l’export vous le signale et vous laisse choisir. Si vous cochez cette case, elle part toute seule, avec son contenu, dès qu’un propriétaire ouvre cette page. Pensez à ce qu’une colonne de plus peut contenir.","send.formulas.initial":"Une formule par défaut (déclenchement « sur les nouvelles lignes ») ne change aucune valeur reçue : elle ne joue que pour une ligne que le destinataire ajoute à la main.","recv.formulas.kind.default":"formule par défaut","recv.formulas.state.defData":"sera posée comme formule par défaut, colonne de données ici","recv.formulas.state.defOther":"sera posée, remplace la formule par défaut d’ici","recv.formulas.state.defSame":"déjà posée","recv.formulas.problem.formulaHere":"cette colonne est une colonne de formule ici : elle n’est pas transformée en colonne de données","common.closeWindow":"Fermer la fenêtre","common.help":"Aide : {name}","common.helpShow":"Afficher l’explication","common.leave.title":"Quitter sans enregistrer ?","common.leave.body":"Vous avez changé des réglages dans cette fenêtre. Voulez-vous les enregistrer avant de quitter ?","common.leave.stay":"Continuer à modifier","common.leave.discard":"Abandonner les modifications","common.leave.titleNew":"Quitter cette fenêtre ?","common.leave.bodyNew":"Rien n’est encore enregistré : si vous quittez maintenant, ce que vous avez choisi est perdu.","common.leave.stayNew":"Revenir à la fenêtre","recv.archive.help":"Par défaut, une ligne supprimée dans la SOURCE est aussi supprimée chez vous. Avec cette option, elle reste dans votre table : le widget la coche dans une colonne « Supprimée à la source » (ajoutée pour l’occasion) et ne la met plus à jour. Si une personne demande l’effacement de ses données, c’est à vous de supprimer la ligne vous-même.","recv.lock.help":"Seuls les propriétaires du document pourront modifier ces tables. Conséquence : les données ne sont recopiées dans vos tables que lorsqu’un propriétaire ouvre cette page.","recv.consent.help":"Concrètement : les tables de destination qui n’existent pas encore sont créées. Dans une table déjà présente, le widget ajoute seulement les colonnes qui manquent et une colonne masquée « id_sync », qui sert à reconnaître chaque ligne. Il crée aussi un journal technique pour cet export (la table où arrivent les envois avant d’être recopiés dans vos tables) et un formulaire de réception, sur sa propre page.","recv.consent.public.help":"Concrètement : les tables de destination qui n’existent pas encore sont créées. Dans une table déjà présente, le widget ajoute seulement les colonnes qui manquent et une colonne masquée « id_sync », qui sert à reconnaître chaque ligne. Il crée aussi un journal technique sans page pour cet export.","recv.consent.name":"Ce que le widget ajoute au document","recv.consent.echange.help":"Le document SOURCE peut les transmettre à d’autres participants de l’Échange. Le widget ajoute aux tables de destination les colonnes MajLe et RecalculLe, et crée un envoi de retour (onglet Envoyer). Effacer une ligne ne l’efface que chez vous : pour l’effacer partout, cochez sa case Supprime.","recv.consent.echange.name":"Ce que change l’Échange","recv.reserve.help":"Le journal de réception est la table technique où arrive tout ce qui est envoyé, avant d’être recopié dans vos tables. Il peut contenir des colonnes que vos règles d’accès cachent dans vos tables. En le réservant aux éditeurs, les personnes qui ne font que lire le document ne peuvent pas le consulter.","send.mode.reply.help":"Vos modifications partent vers le destinataire. Il vous renvoie ensuite un code de réponse, à coller ici pour terminer le branchement.","send.mode.echange.what":"Les deux documents se tiennent à jour l’un l’autre : ce que le destinataire modifie revient ici. Si une même ligne est modifiée des deux côtés, la plus récente l’emporte.","send.mode.echange.more.help":"Ce document administre l’Échange : il reçoit les modifications de chaque participant et les renvoie aux autres, la plus récente l’emportant. Les participants ne se connaissent pas entre eux : chacun n’est relié qu’à ce document.","send.mode.public.help":"Un seul code suffit et le destinataire n’a rien à répondre : il lit directement l’export. À réserver à des données que vous pouvez publier.","send.mode.publicDone.help":"Ce lien est déjà ouvert pour cet export. Son code se trouve derrière le bouton « Code » de la carte de l’export.","send.mode.public.off":"Indisponible : cet export est déjà en Échange."};
const en = {"app.title":"Sync+","tab.send":"Send","tab.receive":"Receive","settings.title":"Settings","settings.lang":"Language","settings.theme":"Theme","settings.theme.system":"System","settings.theme.light":"Light","settings.theme.dark":"Dark","settings.credits":"Credits","settings.credits.author":"Author","settings.credits.site":"Website","settings.credits.license":"License","settings.credits.version":"Version","news.title":"Sync+: what’s new","news.step.news":"What’s new","news.step.shares":"Your shares","news.intro":"Here is what has changed since the Alpha: more precise and safer sharing. Click an item to learn more.","news.echange.title":"Multi-party Exchange, with rules","news.echange.line":"Several documents can keep each other up to date. Yours acts as the hub: it passes changes from one to the others, and you choose whether it accepts, refuses or lets you review each addition, change or deletion.","news.files.title":"Attachments","news.files.line":"A ticked Attachments column leaves with its files (25 MB each at most), once per recipient, SOURCE page open. In an Exchange, files travel both ways.","news.filter.title":"Precise row filter","news.filter.line":"Operators suited to the column type (References included), existing values to tick, and the number of rows that will leave.","news.signed.title":"Protected deliveries","news.signed.line":"Each recipient now has its own signature: only the deliveries you signed are accepted. A control code, to compare with the person, checks that you are talking to the right document. For your earlier shares: see the next screen.","news.taken.title":"Data carried over better","news.taken.line":"Columns that point to another table (References) keep working on the recipient’s side. Choice lists, formats, formatting and descriptions can be carried over on request; formulas, only once an owner agrees. You can also keep rows deleted at the source, and make received tables read-only.","news.follow.title":"Clear tracking","news.follow.line":"Each export keeps the history of what the widget did (sends, pauses, recipients), which you can erase. Settings offers a diagnostic to copy, with no data from your tables.","news.sends.title":"Deliveries tracked and checked","news.sends.line":"Before a big delivery, the widget announces size and duration. Each recipient has a clear state, and the reception compares announced rows with received rows. A dead link pauses the recipient by itself.","news.errors.title":"Precise error messages","news.errors.line":"A precise message for each case: rows without a key, Synchro table deleted or renamed, recipient document deleted. Each says what to do, often with a button.","news.setup.title":"Simpler setup","news.setup.line":"Two documents open in the same browser send each other the code in one click, and the link to the document on the other side opens in a new tab.","news.shares.ok":"Your current shares keep working, nothing is mandatory.","news.shares.only":"Only invitations not yet accepted need to be redone.","news.shares.why":"Why strengthen security?","news.shares.whyBody":"Without a signature of its own, someone who knew a recipient’s delivery address could write fake rows to it. With one, the recipient keeps only what you signed. You do it share by share, whenever you like.","news.shares.kept":"Carried over as is","news.shares.todo":"To strengthen a share, once per person","news.kept1":"Your exports: tables, columns, filter, rules","news.kept2":"Your recipients and their history","news.kept3":"On their side: journal, received tables, mappings, options","news.todo1":"A new code, which the widget prepares for you","news.todo2":"Pending invitations: to be redone anyway","news.todo3":"The person pastes the code, then sends their reply back","news.facts.title":"In this document:","news.facts.exports":"{n} {n|export|exports}","news.facts.people":"{n} {n|recipient|recipients} you can strengthen","news.facts.invitations":"{n} {n|pending invitation to redo|pending invitations to redo}","news.facts.receptions":"{n} {n|reception can be strengthened|receptions can be strengthened}","news.facts.none":"nothing to strengthen.","news.shares.target":"For receptions: ask their senders for a new code, you only have to paste it. Without that, they keep arriving.","news.shares.go":"Strengthen security","settings.diag":"Diagnostics","settings.diag.help":"If something does not work, paste these diagnostics into your message: version, state of exports and receptions, recent errors. They contain none of your table data, no email, no code and no link.","settings.diag.copy":"Copy diagnostics","settings.diag.show":"See what will be copied","common.close":"Close","common.cancel":"Cancel","common.copy":"Copy","common.save":"Save","common.copied":"Copied","common.dur.under":"under a minute","common.dur.min":"{n} min","common.dur.h":"{h} h","common.dur.hm":"{h} h {m}","common.size.MB":"{n} MB","common.size.KB":"{n} KB","common.next":"Continue","common.filter":"Filter","common.none":"No result","common.readonly":"Read only: an editor must open this page for actions to be available.","common.reloading":"The widget’s access rules were updated: Grist is reloading the document…","rules.refused.title":"The widget’s access rules could not be set","rules.refused.body":"Grist refused them: “{why}”. Until they are set, the widget’s Synchro table and journals can be read by anyone who has access to the document, public link included. In Grist, open Document settings, Access rules, and fix the rule that targets a column or table that no longer exists; then reopen this tab. The widget never changes your rules.","recv.protect.title":"Protect the Synchro table before the Exchange","recv.protect.body":"This Exchange sends tables of this document back to the SOURCE through a technical table called Synchro. The widget first sets access rules on it (owners only), so nobody else can read what goes through it. Grist then reloads the document: open “Accept an invitation” again and paste the code again. Nothing else needs to be redone.","recv.protect.ok":"Protect and reload","common.back":"Back","common.later":"Later","send.ownersOnly":"You are not an owner of this document: the list of exports and their recipients is reserved for its owners, so you cannot see it and cannot create anything here. To send tables from this document, ask one of them to open this page.","common.code":"Code","common.codeSecret":"This code is as sensitive as a password: do not paste it into an AI, a ticket or a chat room. Give it directly to the person.","common.controlHelp":"Compare it by phone with the other person, who sees the same one: a different code means the link was swapped on the way.","common.otherVersion":"The other document uses version {theirs} of the widget (here: {mine}). If something fails, install the widget from the same address in both documents.","common.olderVersion":"The other document uses a version of the widget older than 0.12 (here: {mine}). If something fails, install the widget from the same address in both documents.","common.filterIn":"Filter: {name}","common.choose":"— Choose —","common.all":"All","common.noneChecked":"None","common.checkedCount":"{n} of {total}","common.moreItems":"{n} more {n|value|values}: narrow the search.","common.blank":"(empty)","common.docOpen":"Open the document in a new tab","common.newTab":"(opens in a new tab)","common.docChecked":"Name checked with Grist","common.docDeclared":"Name given by the SOURCE, not verified","common.yes":"yes","common.no":"no","type.Text":"Text","type.Numeric":"Numeric","type.Int":"Integer","type.Bool":"Toggle","type.Date":"Date","type.DateTime":"Date and time","type.Choice":"Choice","type.ChoiceList":"Choice list","type.Ref":"Reference","type.RefList":"Reference list","type.Attachments":"Attachments","type.Any":"Any","type.Blob":"Binary (Blob)","type.PositionNumber":"Position","type.Id":"Row ID","home.title":"What do you want to do in this document?","home.notOwner":"You are not an owner of this document: sending tables is reserved for its owners, and receiving tables requires being an editor (a viewer sees the state but cannot act).","guide.title":"Who does what?","guide.you":"you","guide.role.source":"SOURCE","guide.role.target":"TARGET","guide.s1":"Installs the widget, Send: creates an export (its tables and their columns), then “Add a recipient” and sends the invitation code to the TARGET.","guide.t1":"Installs the widget, Receive, “Accept an invitation”: pastes the code, picks where each table goes.","guide.t2":"Opens the form’s page, shown at the bottom of the page list: Share, Copy link. Pastes that link in the widget (one link for the whole export), then sends the reply code back to the SOURCE.","guide.s2":"On the export card, invitation line: “Paste the reply”, checks who accepted, “Approve and connect”, then “Send” the existing rows.","guide.t3":"Opens the widget page now and then: rows are copied into the tables while the page is open. A table added to the export later is offered there in a dialog.","guide.p.s1":"Installs the widget, Send: creates an export, “Add a recipient”, Public link mode. Sends the code, then in Share, Manage users, sets “Public access” to On, as Viewer.","guide.p.t1":"Installs the widget, Receive, “Accept an invitation”: pastes the code, picks the destinations. Reading happens while the page is open, every 10 seconds.","guide.e.s1":"Installs the widget, Send: creates an export, “Add a recipient”, Exchange mode. Copies the link of the return form, published on its own page at the bottom of the page list, then sends the invitation code to the TARGET.","guide.e.t1":"Installs the widget in a document they own, Receive, “Accept an invitation”: pastes the code, picks where each table goes.","guide.e.t3":"Each document opens the widget page now and then: each copies, while the page is open, what the other changed. The most recent change wins.","guide.publicNote":"In public link mode, one code is enough: the TARGET has no reply to send back.","guide.install":"Install: in the document, add a Custom Widget Builder widget with the same HTML and JavaScript code, and accept full access.","guide.copyHandoff":"Copy with instructions","guide.copyHandoff.help":"The code and the other document’s steps, ready to paste in an email.","guide.handoff.target":"Hello, I would like to share tables of my Grist document with you. In your Grist document (you need edit rights):","guide.handoff.source":"Hello, here is my reply to your Grist sync invitation. In your document:","guide.handoff.code":"Code:","home.send":"Send tables","home.send.desc":"This document is the SOURCE: its rows are copied into another document.","home.receive":"Receive tables","home.receive.desc":"This document is the TARGET: it receives and maintains an editable copy.","send.empty":"No export yet. An export groups tables and the chosen columns; you then add the people who receive it.","send.new":"New export","send.step.tables":"Tables","send.step.content":"Content","send.sec.data":"The data","send.sec.data.sub":"Which columns and which rows are sent.","send.sec.with":"Sent along with the data","send.sec.with.sub":"What goes with the data to the recipient. Whatever is ticked is sent.","send.sec.next":"For later","send.step.name":"Name","send.step.options":"Options","send.step.invitation":"Invitation","send.step.reply":"Reply","send.step.load":"Sending","send.tables.help":"Tick the tables to send.","send.edit.tables":"Tick the tables to send. If you add one, each recipient chooses where to put it on their side.","send.edit.removed":"No longer sent: {tables}. What recipients already received stays with them.","send.columns.help":"By default, all columns and all rows are sent. You can leave some out: whatever you don’t tick never leaves this document.","send.columns.relay":"Table received from another document: it is passed on as it arrives. Rows you add to it by hand stay here, they are not sent.","send.refs.aim":"points to table {target} (shows {shown})","send.refs.values":"Send the text only","send.refs.link":"Keep the link","send.refs.link.why":"Table {target} is sent too, so the recipient gets a real {kind} and not just text. You choose below what is taken from it.","send.refs.already":"Table {target} is already added under {by}: what you take from it applies to both columns.","send.refs.help":"Keeping the link also sends the table it points to: by default only the column it shows, and you can take the whole table or choose its columns. Where the column already holds text on the recipient’s side, it stays text until they redo it with one click.","send.refs.note.values":"The recipient gets the text shown, without a link.","send.refs.note.inside":"Table {target} is already sent with the export: nothing is added, the recipient gets a real {kind}.","send.refs.note.numbers":"This column shows no column of {target} (it shows row numbers): pick one in Grist to be able to keep the link.","send.refs.note.hidden":"Column {shown} of {target}, which this column shows, is not sent: tick it in {target} to keep the link.","send.refs.added":"Added for a link","send.refs.mode":"What to take from table {table}?","send.refs.mode.shown":"Only the column it shows ({cols})","send.refs.mode.all":"The whole table ({n} {n|column|columns})","send.refs.mode.pick":"Choose the columns","send.refs.mode.files":"Attachments ({cols}): they are only sent when ticked, with “Choose the columns”.","send.refs.summary.whole":"the whole table","send.columns.files":"Attachments ({cols}): tick them to send them. Their files go out while an owner has this page open (25 MB at most each), and both ways for an Exchange.","send.columns.unsent":"Not sent ({cols}): Grist does not allow this type of column (binary data) to be copied into another document. The other columns are sent as usual.","send.columns.all":"All columns ({n})","send.columns.some":"{n} of {total} {total|column|columns}","send.rows.all":"all rows","send.rows.filtered":"rows where {filter}","send.columns.pick":"Choose columns","send.rows.pick":"Filter rows","send.lastOk":"Last delivery dropped at the recipient: {at}. It shows in their table as soon as their widget page is open.","send.history.title":"Send history ({n})","send.history.title.none":"Send history","send.history.help":"What the widget drove: resends, catch-ups, pauses, recipients. Ordinary sends (a row added or changed) leave from Grist without the widget: they are not listed one by one. Grist only keeps the last one, shown first with its time; each recipient’s state tells whether they went through.","send.history.last":"Last ordinary send (row added or changed), according to Grist.","send.history.lastWho":"The most recent went to {who}.","send.history.join":"{who} now receives this export.","send.history.resend":"Sent {n} {n|row|rows} to every active recipient.","send.history.catchup":"Automatic catch-up: {n} {n|row|rows} sent again.","send.history.unblock":"Send queue cleared, everything is sent again.","send.history.pause":"{who}: sending paused.","send.history.autopause":"{who}: paused by the widget, its receiving link no longer worked.","send.paused.auto":"Paused by the widget: its receiving link no longer worked (their document was deleted, the reception stopped, the link cut or the form unpublished: Grist answers the same in all four cases), and it was holding back deliveries to the other people of this document. Revoke them and invite them again; if the link is restored, resume their deliveries.","send.paused.manual":"Paused: nothing is sent to this person. When you resume, you can catch up on what changed during the pause.","send.paused.slow":"Paused by the widget: a send to this person was waiting for a reply that never came (Grist never gives up by itself), and it was holding back the sends to the other people of this document. If their document answers again, resume their sends; otherwise revoke them and invite them again.","send.history.resume":"{who}: sending resumed.","send.history.revoke":"{who}: revoked.","send.history.clear":"Clear the history","send.history.clearTitle":"Clear the history of “{name}”?","send.history.clearBody":"The list of this export’s events (sends, pauses, changes…) is erased. Nothing is taken away from the recipients: neither the rows already sent nor the sends under way. The notice about a drop in the number of rows, if shown, also disappears.","send.history.clearBack":"For an Exchange, the “before” values and those of deleted rows are also erased from this export’s return journals, in this document.","send.history.clearLimits":"Grist’s own history (Ctrl+Z, “Document history”) is not touched. This action, however, cannot be undone.","send.history.edit":"Export edited.","send.history.editSent":"Export edited, {n} {n|table|tables} sent again.","send.history.shrink":"{who}: {n} {n|row|rows} fewer in the export.","send.shrink.title":"{table}: {n} {n|row|rows} fewer in the export","send.shrink.body":"Noticed on {date}: rows were deleted from the table, or left the export filter. Recipients delete them too. A deletion made by mistake can be undone in Grist (Ctrl+Z, or “Document History”): the rows then go back to them.","send.backOptions.title":"Back to the options?","send.backOptions.body":"The current invitation is cancelled: its code will no longer work. You will create a new one, to send instead.","send.newCode.title":"Make the invitation code again?","send.newCode.body":"A new code will be created. The old one will no longer work: pass the new one on instead.","send.newCode.ok":"Make a new code","send.reply.ready":"I have the reply","send.connected":"Connected: additions, changes and deletions now go out on their own.","send.done":"Existing rows sent: {n}. At the recipient they show up as soon as their widget page is open.","send.name":"Export name","send.name.help":"Recipients see this name.","send.docName":"Name of this document","send.docName.help":"Optional. The recipient will see this name, with a link to your document, to know where the data comes from. The widget cannot read your document’s name: copy it as it appears at the top of the page, or paste the page address (browser address bar) and it is read from there.","send.docName.fromAddress":"Name read from the page address. Grist writes it there without accents or punctuation: correct it if needed.","send.docName.noName":"This address does not contain the document name (Grist leaves it out when it has no Latin letters). Type it by hand.","send.docName.otherDoc":"This address is not this document’s: the identifier differs. Copy the address of the page where this widget is open.","send.docName.otherSite":"This address belongs to a different Grist site than this document. Copy the address of the page where this widget is open.","send.docName.invalid":"Address not recognized. Paste the address of a page of this Grist document, or type the name.","send.create":"Create the export","send.created":"Export “{name}” created.","send.created.next":"You can now add the first person who receives it. Later, from the export’s card, you can add others or revoke just one.","send.edit.title":"Edit “{name}”","send.edit.saved":"Saved: {n} {n|row was|rows were} sent to the recipients.","send.edit.savedNone":"Saved.","send.export.table":"{table} ({n} {n|column|columns})","send.export.tableFiltered":"{table} ({n} {n|column|columns}, rows where {filter})","send.filter.title":"Rows of {table} to send","send.filter.add":"Add a condition","send.filter.none":"No condition: all rows are sent.","send.filter.mode":"Keep rows that match:","send.filter.mode.all":"all conditions","send.filter.mode.any":"at least one condition","send.filter.reading":"Reading rows…","send.filter.unreadable":"Rows could not be read: no values or preview. Other conditions are still saved.","send.filter.count":"{n} of {total} {total|row|rows} will be sent.","send.filter.countAll":"All rows are sent ({total}).","send.filter.incomplete":"{n} incomplete {n|condition is|conditions are} ignored.","send.filter.nothing":"No row will be sent: rows already sent will be deleted at the recipients.","send.filter.rows":"{n} {n|row|rows}","send.filter.column":"Column of condition {n}","send.filter.operator":"Operator of condition {n}","send.filter.remove":"Remove condition {n}","send.filter.condition":"Condition {n}","send.filter.from":"First value of condition {n}","send.filter.to":"Second value of condition {n}","send.filter.betweenAnd":"and","send.filter.and":" and ","send.filter.or":" or ","send.filter.range":"{from} and {to}","send.filter.more":"{values} and {n} more","send.filter.quoted":"“{value}”","send.op.in":"is one of","send.op.notin":"is none of","send.op.eq":"is","send.op.contains":"contains","send.op.notcontains":"does not contain","send.op.starts":"starts with","send.op.empty":"is empty","send.op.notempty":"is not empty","send.op.true":"is checked","send.op.false":"is not checked","send.op.noteq":"≠","send.op.gt":">","send.op.ge":"≥","send.op.lt":"<","send.op.le":"≤","send.op.between":"is between","send.op.number.eq":"=","send.op.list.in":"contains one of","send.op.list.notin":"contains none of","send.op.refs.in":"cites one of","send.op.refs.notin":"cites none of","send.op.date.eq":"is on","send.op.date.lt":"is before","send.op.date.le":"is on or before","send.op.date.gt":"is after","send.op.date.ge":"is on or after","send.op.date.between":"is between","send.filter.value":"Value of condition {n}","send.filter.help":"Only rows that meet these conditions are sent (upper and lower case do not matter). A Reference is chosen by its record: if the record is renamed, the row stays in the filter. A row that leaves the filter is erased at the recipients. The list of choices of a Choice column is not sent: each recipient only gets the values of the rows sent.","send.files.pending":"{n} {n|file|files} to send: {n|it goes|they go} out while this page stays open.","send.export.lost":"Table not found (renamed or deleted): {tables}. Its rows are no longer sent. Give it back its name, or remove it from the export (Edit).","send.export.drift":"Columns changed since the export (renamed, deleted, of another type or hidden by an access rule): {cols}. They are no longer sent correctly: tick the right columns again (Edit), or check the document’s access rules.","send.export.nobody":"Nobody receives this export yet.","send.export.rowsGone":"This export’s rows are gone from the Synchro table (deleted by hand in Grist?): nothing is sent any more. Click “Edit” to choose the tables and columns again. The recipients’ signing keys were in those rows: see each person’s notice.","send.vanished.title":"{n} {n|recipient has disappeared|recipients have disappeared}","send.vanished":"{n} {n|recipient you added is|recipients you added are} no longer listed: {n|the webhook was deleted|their webhooks were deleted} or changed by hand in Grist’s settings (Document settings, API). {n|This person receives|These people receive} nothing more from this export: invite {n|them|them} again (Add a recipient).","send.action.addPerson":"Add a recipient","send.action.addParticipant":"Add a participant","send.action.edit":"Edit","send.action.delete":"Delete","send.delete.title":"Delete the export “{name}”?","send.delete.body":"Deliveries stop for {n} {n|recipient|recipients}. What they already received stays with them. The id_sync and MajLe columns stay in your tables.","send.person.title":"Add a recipient to “{name}”","send.person.badAddress":"This recipient’s sending address was changed in Grist’s settings: it is no longer a form address on this instance. Revoke it if there is no explanation.","send.person.noKey":"This person’s signing key was lost (the “signature” row of the Synchro table deleted?): their document rejects your sends as suspect. The key cannot be remade: revoke them, then invite them again (their reception resumes).","send.person.otherDoc":"This recipient now sends to another document ({doc}) than the one approved. Revoke it if there is no explanation.","send.person.tables":"Tables of the export: {tables}.","send.mode":"Mode","send.mode.others":"Other modes","send.mode.reply":"One way (recommended)","send.mode.public":"Public link","send.mode.publicDone":"Public link (already open)","send.mode.publicStrong":"Not available: an export with enhanced security cannot go through a public link.","send.mode.echange":"Both ways (Exchange)","send.mode.echange.more":"One more participant in the Exchange (multi-party Exchange)","send.mode.echange.moreHelp":"A row that a participant ticks Supprime stays here, ticked, and disappears from the other participants.","send.mode.echange.help":"Deleting a row only deletes it on one side: to delete it on both, tick its Supprime box. The recipient must own their document. Other participants can join later: this document will then run the Exchange.","send.mode.echange.off":"Not available: an Exchange needs an export that has no recipient or invitation yet, and is not a public link.","send.back.title":"Return form link","send.back.help":"The recipient’s changes will arrive here through a return form, published {where}. Copy its link and paste it here: it goes into the invitation, and only the recipient can use it.","send.back.again":"Make the code again","send.back.resume":"Resume","send.exchange.managed":"Exchange received from another document: it is managed from the Receive tab. Deleting it stops the Exchange.","send.exchange.with":"Exchange: this recipient’s changes come back into your tables.","send.exchange.hub":"Multi-party Exchange ({n} participants): each one’s changes come back to your tables and go on to the others.","send.exchange.rules":"Participants’ changes: {rules}.","send.rules.title":"Changes received from participants","send.rules.help":"For each kind of change: accept it, refuse it, or keep it for review. A change to review waits for your decision on the participant’s card, in the Receive tab.","send.rules.ajout":"Row added","send.rules.modif":"Row modified","send.rules.suppression":"Row deleted (Supprime box)","send.rules.accepter":"Accept","send.rules.refuser":"Refuse","send.rules.valider":"Review","send.refusal.title":"When a change is refused","send.refusal.corriger":"The participant takes back this document’s row (recommended)","send.refusal.signaler":"The participant keeps their version, the difference is flagged here","send.refusal.help":"When you refuse a change, “take back this document’s row” puts this document’s version back on the participant’s side: a row that was added then refused is erased there (it stays here, with Supprime ticked), and a refused deletion is undone.","send.exchange.map":"{dest} ↔ {table}","send.public.warn":"The widget will add access rules: people who can only read this document (the public link included) will only see the public exports, nothing else. You will then turn the link on in Share. Avoid it for data that must not be public.","send.public.columns":"Anyone with the link will be able to read these columns: {list}.","send.public.editors":"This document’s public link is set to Editor: anyone can change it, and the widget’s rules no longer protect anything. In Share, Manage users, set “Public access” back to Viewer.","send.public.hiddenNow":"An access rule now hides part of {tables}, which this public link shows to everyone. Turn off the public link, or remove these tables from the export.","send.public.label":"public link","send.public.turnOn":"To do: in the document Share menu, Manage users: “Public access” On, as Viewer, then Confirm.","send.public.code":"Code","send.public.help":"Send this code: it is all the recipient needs. It holds no data.","send.public.revokeBody":"Viewers will no longer see this export. Also turn off the public link in Share if it is no longer used: while it stays on, the widget keeps the rule that hides the rest of the document.","send.public.stop":"Close the public link","send.public.tooBig":"Too large for the public link (over 2 MB): {tables}. The public link gives nothing of it; invite the person instead (webhook), or filter the rows.","send.public.stopTitle":"Close the public link of “{name}”?","send.public.stay.title":"The document is still public in Grist","send.public.stay.body":"You stopped the export’s public link, but public sharing is still turned on for the document in Grist. The widget no longer sends anything through it; it keeps its rule that hides the rest of the document from people who can only read.","send.public.stay.how":"To turn public sharing off: the document Share menu, Manage users, “Public access” Off, then Confirm. If the document should stay public, confirm it below and this notice goes away.","send.public.stay.rules":"Visitors see nothing until you change the access rules.","send.public.stay.keep":"Yes, keep the document public","send.check.missing":"When creating the export, the widget will add: {items}.","send.check.sync":"the Synchro technical table (one for all exports)","send.renforce":"Enhanced security","send.renforce.help":"Before connecting, you will compare a control code with the person (by phone, for example) to be sure you are talking to the right document. This export can no longer be shared by public link.","send.renforce.structure":"Enhanced security: editors of this document can change its structure, hence the formulas that choose what is sent. Untick “Allow editors to edit structure” in the access rules.","send.renforce.on":"enhanced security","send.invite":"Create the invitation","send.invite.help":"Pass this code on to the person who manages the document that will receive the tables (the TARGET). They paste it into their widget, “Receive” tab, then send you back a reply code.","send.invite.pending":"Invitation of {at}","send.invite.until":"Valid until {at}","send.invite.expiredOn":"Expired on {at}: make a new code","send.invite.expired":"This invitation has expired: go back to make a new code.","send.invite.backCode":"Control code of the return feed:","send.reply":"Paste the reply","send.reply.title":"Recipient’s reply","send.reply.help":"Paste the reply code received from the TARGET document.","send.reply.check":"Check","send.reply.tables":"Tables","send.reply.email":"Accepted by","send.reply.doc":"Document","send.reply.team":"Team","send.reply.at":"Date","send.reply.approve":"Approve and connect","send.reply.nosecret":"This invitation is not protected by any secret. Check the card above carefully before approving.","send.reply.sameDoc":"this document","send.reply.verified":"Document, folder and team come from Grist; the email and date come from the pasted code.","send.reply.personal":"This document is in a personal space: Grist does not say who owns it. Check by phone with the person, using the control code.","send.reply.personalSpace":"personal space","send.reply.code":"Control code:","send.reply.compared":"I compared this code with the person: it is the same.","send.load.body":"Connecting only sends what changes from now on. Do you also want to send {n} {n|row already there|rows already there}?","send.load.ok":"Send","send.load.empty":"The tables are empty for now: rows will go out as soon as they are added.","send.load.done":"Resend finished: {n} {n|row|rows} sent. At the recipient they show up as soon as their widget page is open.","send.load.queued":"Another sending is already under way for this document (on another page, or by another person). This one is noted and will go out afterwards by itself, as long as a widget page stays open.","send.load.nobody":"No connected recipient: nothing to resend.","send.load.start":"Preparing the send…","send.load.nothing":"None of the table’s {n} {n|row|rows} can go out: they lack the sync key, or the export’s filter leaves them all out.","send.estimate.title":"Long send","send.estimate.body":"{rows} {rows|row|rows} to send, about {size}, in {lots} {lots|batch|batches}, for {n} {n|recipient|recipients}: allow {dur}.","send.estimate.pace":"To spare Grist’s server, the widget sends no more than {mb} MB every {min} minutes, all recipients combined. Keep a widget page open until the end: progress shows on the export’s card.","send.flow.running":"Sending: {done} of {total} {total|row|rows} ({pct}%), batch {lot} of about {lots}.","send.flow.runningOther":"A send is running from another page or another person: {done} of {total} {total|row|rows} ({pct}%), batch {lot} of about {lots}. It carries on by itself.","send.flow.budget":"Paused to spare Grist’s server: the rest leaves around {at} ({done} of {total} {total|row|rows} already sent, {pct}%). Nothing is lost; keep a widget page open.","send.flow.budgetWait":"Sends spaced out to spare Grist’s server: the rest leaves around {at}. Ordinary changes always leave.","send.flow.queued":"Another send is running for this document: this one leaves afterwards, by itself.","send.flow.paused":"{n} {n|table still has|tables still have} rows to send, but no recipient is active: they leave when sending resumes.","send.flow.blocked":"Sending is blocked: {n} {n|recipient is|recipients are} failing (see below). Until that is fixed nothing is resent, because Grist’s delivery queue is shared by all recipients.","send.flow.interrupted":"Send interrupted at {done} of {total} {total|row|rows} ({pct}%): it resumes by itself as soon as an owner has the widget page open.","send.flow.waiting":"Waiting: {n} {n|table|tables} to complete. The widget sends them by itself, every 10 seconds, while a widget page stays open.","send.flow.lastPass":"Last pass: {at}.","send.flow.left":"About {left} left.","send.flow.bar":"Progress: {pct}%","send.load.background":"You can close this window: the sending carries on as long as this page stays open. Otherwise it resumes the next time an owner opens the widget.","send.status.invited":"Waiting for reply","send.status.expired":"Expired","send.status.renfWait":"Strengthening: awaiting reply","send.status.renfExpired":"Strengthening expired","send.renf.title":"Strengthen the security of {name}","send.renf.title.n":"Strengthen security ({n})","send.renf.body":"Some recipients receive through a delivery from before signing keys: their share works, but without a key of its own to their document. A new invitation protects it.","send.renf.safe":"Nothing is forced and nothing breaks: if you do nothing, these shares carry on as before. Strengthening replaces one person’s old delivery at a time, without losing their data.","send.renf.how":"For each one: “Strengthen security”, send them the new code, then approve their reply. Paused recipients must be resumed first.","send.renf.person":"Delivery from before signing keys: you can strengthen its security. It keeps working as before in the meantime.","send.renf.paused":"Delivery from before signing keys, paused: resume it first to strengthen its security.","send.renf.action":"Strengthen security","send.renf.pending":"Strengthening {who}: invitation of {at}","send.renf.someone":"a recipient","send.renf.invite":"This invitation replaces this person’s old delivery. It keeps working until you approve their reply.","send.renf.step.control":"Check","send.renf.connected":"New delivery connected: the old one is stopped.","send.renf.control":"A check delivery is leaving now: at its first signed delivery, the person sees their share strengthened. You can close this window, the delivery goes on.","send.renf.done":"Check delivery finished ({n} rows). The TARGET confirms the strengthening at its first signed delivery.","send.history.reinforce":"{who}: security strengthened (new signed delivery).","send.status.people":"{n} {n|recipient|recipients}","send.status.participants":"{n} {n|participant|participants}","send.status.alone":"No recipient","send.cancel.title":"Withdraw this invitation?","send.cancel.body":"Its code can no longer be accepted.","send.status.public":"Public","send.status.publicOff":"Public link to turn on","send.status.active":"Active","send.status.paused":"Paused","send.status.error":"Error","send.waiting":"{n} {n|pending delivery|pending deliveries}","send.action.load":"Resend all","send.action.pause":"Pause","send.action.resume":"Resume","send.resume.title":"Resume “{name}”","send.resume.catchup":"Catch up on changes made during the pause (recommended)","send.resume.catchup.help":"Sends {n} {n|row|rows} added or changed during the pause, and the deletions. The rest of the table is not sent again.","send.resume.all":"The pause time is unknown, or the columns changed during the pause: the whole export is sent.","send.resume.asIs":"Resume without catching up","send.resume.asIs.help":"Only future changes are sent. Rows added, changed or deleted during the pause will not reach the TARGET unless they change again (or with “Resend all”).","send.action.unblock":"Unblock the queue","send.action.revoke":"Revoke","send.action.cancel":"Withdraw the invitation","send.revoke.title":"Revoke “{name}”?","send.revoke.body":"Deliveries stop for this person only; other recipients go on. What they already received stays with them.","send.revoke.exchange":"The Exchange stops: your changes no longer go out, theirs no longer come back (the return log is deleted). Tables keep their rows, on both sides.","send.revoke.participant":"This participant no longer receives anything and their changes no longer come back (their return log is deleted). The other participants carry on. Tables keep their rows.","send.unblock.title":"Unblock the delivery queue?","send.unblock.body":"All the sends waiting for this document are dropped, then the widget sends the exports again by itself (keep this page open). If a person no longer receives anything, pause or revoke them first: otherwise the queue will block again.","send.unsafe.title":"Unfiltered delivery","send.unsafe.body":"These deliveries (Grist webhooks) read the Synchro table without an export filter: they would receive every export. Delete them: {who}.","send.unsafe.delete":"Delete these deliveries","send.unsafe.confirm":"These deliveries are deleted from Grist. Their recipients no longer receive anything.","send.stray.title":"Extra columns in the Synchro table","send.stray.body":"The Synchro table belongs to the widget: it should only have its {total} columns. The widget finds {n} extra {n|column|columns}: {list}. {n|It does|They do} not come from the widget: Grist adds columns A, B and C to every new table, and a Synchro table made before the widget may have kept them. Every delivery carries the whole Synchro row, and the recipient’s journal refuses a column it does not know (“Invalid column”): while {n|it is|they are} there, deliveries fail.","send.stray.filled":"Holds values or a formula: {cols}. Save them before removing.","send.stray.open":"Review and remove","send.stray.dialog.title":"Remove the extra columns?","send.stray.dialog.intro":"{n|This column will be removed|These columns will be removed} from the Synchro table. The widget’s columns, your exports and your recipients do not change.","send.stray.col.empty":"{col} ({type}): empty","send.stray.col.filled":"{col} ({type}): {n} filled {n|cell|cells}","send.stray.col.formula":"{col} ({type}): formula {formula}","send.stray.empty":"{n|It is empty|They are empty}: nothing will be lost.","send.stray.save":"{n|This column holds|These columns hold} values or a formula ({cols}), and removing {n|it erases it|them erases them}. Before going on, save {n|it|them}: copy the values to another table of the document, or to a file.","send.stray.sure":"I have saved what needed keeping","send.stray.unblock":"Deliveries are blocked because of these columns. After the removal, the widget drops Grist’s waiting deliveries (they still contain these columns), then resends the exports by itself. Keep this page open.","send.stray.remove":"Remove","send.stray.done":"{n|Column|Columns} removed from the Synchro table.","send.keys.title":"Some rows will not reach the recipients","send.keys.help":"Each row carries a key (id_sync column) that lets the recipients recognize it. A row without a key is not sent; two rows with the same key become a single row on their side, and the other never arrives. This happens when whole rows are duplicated or pasted, or when cells of this column are cleared.","send.keys.line":"Table {table}: {blank} {blank|row without a key|rows without a key}, {dup} {dup|row sharing|rows sharing} the key of another.","send.keys.missing":"Table {table}: {n|column deleted|columns deleted} ({cols}). These columns come from the widget; without them, changes to this table no longer go out.","send.keys.dialog.missing":"The widget puts back the columns it had added and that were deleted. If id_sync was missing, every row gets a fresh key: on the recipients’ side, the rows already received are replaced by these new rows.","send.keys.repair":"Repair the keys","send.keys.dialog.title":"Repair the keys","send.keys.dialog.body":"The widget gives a new key to {n} {n|row|rows} (only the id_sync column changes: in each group of duplicate rows, the oldest keeps its key), then sends them as after an edit. On the recipients’ side, duplicate rows become separate rows. No other value in your table is changed.","send.error.stray":"This person no longer receives because of the column “{col}” of this document’s Synchro table, which does not belong to the widget: nothing to do on their side. Remove the extra columns (card at the top of the tab); delivery then resumes.","send.error.gone":"The column “{col}” is no longer in the Synchro table, but Grist’s delivery queue still holds old deliveries that carry it. “Unblock the queue” drops them: the widget then resends the exports by itself.","send.foreign.title":"A table named Synchro already exists","send.foreign.body":"The widget needs its own table named Synchro. It does not use someone else’s: it would add its columns, and every delivery would carry that person’s columns too, which recipients refuse.","send.foreign.facts":"Your Synchro table: {c} {c|column|columns} ({cols}), {n} {n|row|rows}.","send.foreign.how":"Rename it to free the name: it keeps its columns, values and formulas, only its name changes. The widget will then create its own table at the first export.","send.foreign.name":"New name for your table","send.foreign.rename":"Rename my table","send.foreign.open":"Rename the table","send.foreign.done":"Table renamed. The widget creates its own Synchro table at the first export.","send.foreign.blocked":"A table named Synchro already exists: rename it first.","send.lost.deleted.title":"The Synchro table was deleted","send.lost.deleted.body":"This table is the widget’s memory: your list of exports and the recipients’ signing keys were in it. Without it nothing is sent any more. Grist still keeps {n} {n|webhook|webhooks} of the former recipients, which are now useless.","send.lost.deleted.how":"If the deletion is recent, undo it: Ctrl+Z in Grist, or “Document history” (in the tools, on the left) to get an earlier version back. Otherwise remove the old webhooks, create your exports again and invite each person again: signing keys are made again at the invitation.","send.lost.deleted.clean":"Remove the old webhooks","send.lost.deleted.confirm":"The {n} {n|webhook|webhooks} of the former Synchro table will be deleted. Nothing is erased at the recipients: they keep the rows already received, but receive nothing more until you invite them again.","send.lost.deleted.done":"{n} {n|old webhook removed|old webhooks removed}. You can create a new export.","send.lost.renamed.title":"The Synchro table was renamed","send.lost.renamed.body":"The widget looks for it under the name Synchro, and it is now called “{name}”: nothing is sent to the recipients any more, and your list of exports does not show.","send.lost.renamed.how":"Give it the name Synchro back (in “Raw data”, click the table’s name): everything resumes, nothing is lost.","send.lost.hidden.title":"The widget can no longer read the Synchro table","send.lost.hidden.body":"The Synchro table is there, but the widget no longer finds its Synchro_Export column: it was deleted, or an access rule hides the table or this column, owners included. Nothing is sent as long as this lasts.","send.lost.hidden.how":"Open “Access rules” (in the tools, on the left) and remove the rule that hides the Synchro table or this column. If the column was deleted, Ctrl+Z or “Document history” brings it back.","send.lost.blocked":"The widget’s Synchro table is lost: fix that first.","send.error.size":"Delivery too big for Grist (over 1 MB): the widget clears the queue and resends everything on its own. Keep this page open.","send.error.column":"This person’s journal does not have the column “{col}” that the widget sends: ask them to open their widget page, which updates their journal. Delivery then resumes on its own.","send.error.link":"This person’s receiving link no longer works (their document was deleted, the reception stopped, the link cut or the form unpublished: Grist answers the same in all four cases). While this lasts, deliveries to the other people of this document wait behind this one: pause them to free those, then revoke them and invite them again.","send.error.journal":"This person’s receiving journal was deleted in their document: the link still exists, but there is no table left to write to. While this lasts, sends to the other people of this document wait behind this one: pause this person to free them, then revoke them and invite them again (they then set up their reception again).","send.behind":"{n} {n|recipient is|recipients are} waiting behind the failing delivery to {who}: Grist’s delivery queue is shared by the whole document. Their deliveries will resume as soon as that person is paused or revoked, or their delivery succeeds.","send.error.rate":"This person’s server limits the number of deliveries (error 429). Grist retries on its own for about a quarter of an hour: nothing to do if it recovers. Meanwhile, deliveries to the other people of this document wait behind this one; pause them to free those.","send.error.server":"This person’s server answered with an error on its side (error {status}). Grist retries on its own for about a quarter of an hour: nothing to do if it recovers. Meanwhile, deliveries to the other people of this document wait behind this one; pause them to free those.","send.error.network":"This person’s server could not be reached (connection refused or cut). Grist retries on its own for about a quarter of an hour. If it lasts, check with them that their document still exists. Meanwhile, deliveries to the other people of this document wait behind this one; pause them to free those.","send.error.slow":"This person’s server does not answer: a delivery has been waiting for its answer for more than three minutes (Grist gives up after five minutes, then retries). Deliveries to the other people of this document wait behind this one; pause them to free those.","send.error.other":"This person no longer receives: while the delivery fails, the document’s delivery queue is blocked for everyone.","send.error.detail":"Details: {detail}","recv.empty":"No export received. Paste an invitation received from the SOURCE document.","recv.emptyViewer":"No visible reception: this document’s journals may be reserved to its editors.","recv.new":"Accept an invitation","recv.invite.title":"Invitation received","recv.invite.help":"Paste the invitation code sent to you by the person who is sending the tables (the SOURCE document).","recv.invite.summary":"“{name}”: {n|table|tables} {tables}.","recv.dest":"For each received table, choose where to put it: in a new table, or in a table already in this document.","recv.step.code":"Code","recv.step.dest":"Destinations","recv.step.link":"Link","recv.step.reply":"Reply","recv.from":"Data from {from}","recv.docId":"Document identifier: {doc}","recv.doc.open":"Source document","recv.backDoc":"Your changes will go back to the document {doc} (checked by Grist).","recv.backPersonal":"This document is in a personal space: Grist does not say who owns it. Check by phone with the person who invited you.","recv.backCode":"Control code of the return feed:","recv.backCompared":"I compared this code with the person who invited me: it is the same.","recv.renforce":"Enhanced security: before connecting, compare the control code with the person who invites you.","recv.reserve":"Restrict the reception journal to editors (recommended)","recv.reserve.owner":"This journal will be restricted to editors when an owner of the document opens this page.","recv.structure.auto.option":"Apply automatically the columns the SOURCE adds to the export","recv.structure.auto.help":"If this box is unticked, a column added by the SOURCE is only created in your document once you agree: an “Apply” button then appears on the reception’s card. Rows keep arriving as usual, and the column fills in all at once when you accept it.","recv.structure.held.title":"The SOURCE added {n} {n|column|columns} to the export","recv.structure.held.body":"Nothing has been changed in this document. These columns will only be created with your agreement; their values are already received. The other columns keep being copied.","recv.structure.held.line":"{table} → {dest}: column “{col}” ({type}) would be created as “{to}”.","recv.structure.gone.line":"{table} → {dest}: the SOURCE no longer sends column “{col}”. It stays here, its values are no longer updated.","recv.structure.retyped.line":"{table} → {dest}: column “{col}” is now of type {sent} in the SOURCE. Here it stays {here}, values arrive as they are.","recv.structure.info.title":"The SOURCE changed its export","recv.structure.info.body":"Nothing to decide: these changes do not touch your tables. “Got it” stops repeating them.","recv.structure.apply":"Apply","recv.structure.ok":"Got it","recv.structure.auto.action":"Apply, then process automatically","recv.structure.auto.title":"Process automatically from now on?","recv.structure.auto.body":"Columns the SOURCE adds to the export will be created here without asking you. You can go back to asking in the reception's “Options”.","recv.structure.auto.confirm":"Apply and process automatically","recv.archive":"Keep the rows that the SOURCE deleted","recv.archive.col":"Deleted at the source","recv.lock":"Make the received tables read-only","recv.lock.ownerOnly":"Only a document owner can change this setting.","recv.lock.limit":"This prevents accidental edits. It does not stop someone who can edit the document from changing the reception journal or the document structure.","recv.archive.off":"If you untick this option later, the rows already kept stay in the table, ticked.","recv.lock.waiting":"Read-only: copying waits for an owner to open this page.","recv.options.advanced":"Advanced options","recv.options.title":"Options of “{name}”","recv.action.options":"Options","recv.link.ok":"The link works.","recv.action.continue":"Continue","recv.history.since":"Since your last visit","recv.history.last":"Latest changes","recv.history.n.ajout":"{n} added","recv.history.n.modif":"{n} changed","recv.history.n.suppression":"{n} deleted","recv.history.n.colonne":"{n} {n|column added|columns added}","recv.history.n.refus":"{n} refused","recv.history.colonne":"added by the SOURCE","recv.history.colLabel":"Column “{col}”","recv.history.more":"and {n} more","recv.history.none":"No change since your last visit.","recv.history.ajout":"added","recv.history.modif":"changed","recv.history.suppression":"deleted","recv.history.refus":"refused","recv.history.before":"Before","recv.history.after":"After","recv.history.row":"Row {n} of the table","recv.history.rowGone":"Row {n} of the table, before it was deleted","recv.drift.show":"Show details ({n} {n|edit|edits})","recv.drift.title":"{dest}: {n} {n|change|changes} made by hand here","recv.drift.body":"{n|It stays|They stay} until the SOURCE changes the same row. “Fix” puts the exact SOURCE state back now.","recv.drift.row":"Row","recv.drift.col":"Column","recv.drift.here":"Here","recv.drift.source":"SOURCE","recv.drift.fix":"Fix","recv.drift.fixTitle":"Put the SOURCE values back in {dest}?","recv.drift.fixBody":"{n} {n|change made by hand here is replaced|changes made by hand here are replaced} by the exact SOURCE state.","recv.drift.fixRows":"{n} {n|row deleted here comes|rows deleted here come} back, at the end of the table.","recv.drift.fixCols":"{n} {n|column deleted here is|columns deleted here are} created again.","recv.links.done":"References rebuilt","recv.links.item":"{name} to {target}","recv.relink.title":"{n} {n|column is|columns are} still text: {name}","recv.relink.body":"The SOURCE keeps {n|the link of this column|the links of these columns}, but {n|it already held|they already held} text received earlier: the widget does not touch {n|it|them} without your agreement.","recv.relink.owner":"An owner of the document can rebuild them.","recv.relink.button":"Rebuild the references","recv.relink.confirmTitle":"Rebuild the references of “{name}”?","recv.relink.item":"Column {name} becomes a Reference to table {target}.","recv.relink.item.list":"Column {name} becomes a Reference list to table {target}.","recv.relink.body2":"Each cell takes the link sent by the SOURCE, in place of the text already received. If the target row has not arrived yet, the cell stays empty and fills in when the row arrives. A value you changed by hand in these columns is replaced. You can go back with the document history (Ctrl+Z).","recv.relink.done":"References rebuilt: {cols}.","recv.drift.rowGone":"Row deleted here, still in the SOURCE","recv.drift.colGone":"Column deleted here, still sent by the SOURCE","recv.review.title":"{dest}: {n} {n|change|changes} to review","recv.review.body":"Sent by this participant, they await your decision: nothing is written here or passed on to the other participants before.","recv.review.accept":"Accept","recv.review.refuse":"Refuse","recv.review.accepterAll":"Accept all","recv.review.refuserAll":"Refuse all","recv.review.accepterAllBody":"{n} {n|change to review is copied|changes to review are copied} here.","recv.review.refuserAllBody":"{n} {n|change to review is refused|changes to review are refused}.","recv.review.here":"Here","recv.review.proposed":"Proposed","recv.gap.title":"{dest}: {n} refused {n|row is|rows are} still different for the participant","recv.gap.body":"They keep their version (export setting). The difference goes away at the next change of the row, here or on their side.","recv.gap.theirs":"Theirs","recv.gap.ajout":"Added on their side, not here","recv.gap.modif":"Modified on their side","recv.gap.suppression":"Deleted on their side, kept here","recv.label.change":"Change the displayed column","recv.label.title":"Displayed column","recv.label.help":"Column that names each row in the history, per table.","recv.create":"Create the tables","recv.existing":"For each sent column, choose the column of your table that receives it. The widget adds the missing columns, plus a hidden “id_sync” column used to recognize each row.","recv.dest.new":"New table","recv.dest.taken":"{dest} (already receives {table})","recv.new.title":"New table: the widget won’t be there","recv.new.body":"The widget will create {tables} with {n|its own page|their own pages}. It is not added to {n|that page|those pages} by itself: while you stay on {n|that page|those pages}, it is not running and nothing new arrives.","recv.new.safe":"To make reception safe: first create the table yourself, add the widget to its page (“Add widget to page”, “Custom”, same address, full access), then restart this procedure from that page and pick the existing table.","recv.new.after":"If you continue here, the reception’s card turns orange (“Widget to add”) until you click “Add the widget to the page of the received table”: that puts the widget on the new table’s page, and Grist then asks you for full access. A single open widget is enough for all the receptions of the document.","recv.new.ok":"Continue with a new table","recv.widget.add":"Add the widget to the page of {table}","recv.widget.addSome":"Add the widget to the page of a received table","recv.widget.title":"Add the widget to the page of a received table","recv.widget.body":"A section of the widget is added to the page of {table}. The widget finds all the receptions of the document there and copies received data as soon as you open that page. A single open widget is enough for the whole document: this button puts it where you work.","recv.widget.pick":"Table page","recv.widget.chosen":"the table chosen below","recv.widget.access":"Grist will then ask for full access for this new section: open the page, then the right panel (icon at the very top right) and click “Accept”. Without it, the widget cannot read anything.","recv.widget.ok":"Add the widget","recv.widget.done":"Widget added to the page of {table}. Open that page, then accept full access in the right panel (icon at the very top right): the widget starts by itself.","recv.widget.already":"The widget is already on the page of {table}.","recv.widget.missing.title":"The widget is not on the page of any received table","recv.widget.missing.one":"The widget only copies the received data while its page is open. If you open the page of {table}, it stops and nothing new arrives there. Add it to that page: copying carries on where you work. A single widget is enough for the whole document.","recv.widget.missing.some":"The widget only copies the received data while its page is open. If you open the page of one of the received tables, it stops and nothing new arrives there. Add it to the page of one of them: copying carries on where you work. A single widget is enough for the whole document.","recv.widget.missing.next":"One click on the button below is enough; Grist will then ask you for full access (right panel).","recv.lost.title":"Reception deleted: {name}","recv.lost.body":"The journal “{journal}” of this reception no longer exists in this document: the widget lost its memory of it (export, signing key) and copies nothing for it any more.","recv.lost.gone":"{n|The received table|The received tables} ({list}) {n|was|were} deleted too.","recv.lost.kept":"{n|The received table|The received tables} ({list}) {n|is|are} still there, with the rows already copied, but nothing arrives {n|in it|in them} any more.","recv.lost.effect":"The SOURCE doesn’t know: its next send will fail, and it will pause this reception on its own after a minute (“journal deleted”).","recv.lost.how":"If the deletion is recent, undo it: Ctrl+Z in Grist, or “Document history” (in the tools, on the left). Otherwise ask the SOURCE to revoke this reception and invite you again, then accept the invitation here.","recv.lost.clean":"Remove this notice","recv.lost.owner":"Only an owner of the document can remove this notice.","recv.dest.name":"Name of the new table for {table}","recv.dest.nameLabel":"Name of the new table","recv.dest.from":"Received table","recv.dest.to":"Store in","recv.undo.title":"Back to the destinations?","recv.undo.body":"This reception’s journal and form are deleted, along with the tables it created if they are still empty. You can then choose again where to put each table.","recv.col.new":"New column “{col}”","recv.match":"Attach existing rows by column","recv.match.none":"Do not attach","recv.match.help":"If a row of your table has, in this column, the same value as a received row, it is updated instead of being added a second time. Your other rows are never modified.","recv.link.title":"Form link","recv.link.help":"The widget has just published a reception form {where}. Copy its link (Share, then Copy link) and paste it here: a single link serves all the tables of the export.","recv.link.step1":"1. Open the form’s page and click “Share” in its card.","recv.link.step2":"2. Click “Copy link”, then paste it below.","recv.link.where":"on its own page, at the bottom of the page list","recv.link.where.page":"on page “{page}”, in the page list (open it)","recv.link.check":"Test the link","recv.reply.help":"Send this code back to the person who invited you: they paste it in their widget to connect the feed.","recv.reply.code":"Control code:","recv.status.waiting":"Waiting for the link","recv.status.ok":"Up to date","recv.status.review":"To review","recv.status.error":"Error","recv.status.incomplete":"Incomplete","recv.status.ended":"Cut by the SOURCE","recv.status.widget":"Widget to add","recv.ended":"The SOURCE cut this feed on {at} (revoked, export deleted or Exchange stopped): nothing more will arrive. Tables keep their rows; “Stop receiving” removes the journal and its form.","recv.renf.suggest.title":"You can strengthen the security of this share","recv.renf.suggest.body":"This share was set up before signing keys existed: whoever gets the form link can write to it. A new invitation from the SOURCE protects it with a key of its own to this document.","recv.renf.suggest.safe":"Nothing stops and nothing is forced: this share keeps arriving as before as long as you do nothing. The same reception resumes, with its tables and data.","recv.renf.start":"Strengthen security","recv.renf.pending.title":"Strengthening in progress","recv.renf.pending.body":"The SOURCE’s deliveries keep arriving as before until its first signed delivery, {end} at the latest ({days} days). It still has to approve your reply.","recv.renf.pending.safe":"After that, unsigned deliveries are refused. You can also go back to the old way.","recv.renf.reply":"Send my reply again","recv.renf.revert":"Go back to the old way","recv.renf.revert.title":"Go back to the old way?","recv.renf.revert.body":"The key prepared for this strengthening is erased and the reception goes back to how it was: unsigned deliveries are accepted, without protection. You can strengthen security later.","recv.renf.expired.title":"Strengthening interrupted","recv.renf.expired.body":"The waiting period ended on {end} without a signed delivery. Your data has not been up to date since: the SOURCE’s unsigned deliveries are refused.","recv.renf.expired.how":"To resume: send your reply back to the SOURCE (it approves it and everything restarts), or go back to the old way. If the SOURCE no longer has your invitation, ask it for a new one.","recv.renf.done":"Share strengthened on {at}: deliveries are signed with a key of its own to this document.","recv.relink.confirm.renf":"“{name}” is already received in this document (journal {journal}) and had no signing key yet. This invitation strengthens it: the same reception resumes, with its tables and data, and the old delivery stays accepted until the first signed delivery. Check that it comes from the same person and the same document.","recv.relink.renf":"Two more steps: copy the form link, then send the reply back to the SOURCE. Nothing stops in the meantime.","recv.relink.ok.renf":"Strengthen security","error.revertNone":"This reception has nothing to undo: the strengthening is finished or has not started.","error.reinforceNot":"This recipient cannot be strengthened here (Exchange, public link, cut off or export not found).","error.reinforceOtherDoc":"This reply comes from a different document than this recipient’s: a strengthening must come from the same document.","recv.formGone":"The receiving form is no longer published (unpublished or page deleted): the SOURCE can no longer write here, so nothing arrives. “Redo the link” publishes it again; the SOURCE must then revoke this reception and invite you again.","recv.sync.none":"Nothing new: everything is up to date.","recv.consent":"By continuing, the widget adds to this document the tables and columns it needs, a technical journal and a reception form.","recv.consent.public":"By continuing, the widget adds to this document the tables and columns it needs and a technical journal.","recv.consent.echange":"Exchange: your changes to these tables will go back to the SOURCE document, the most recent one winning.","recv.outgoing.title":"Send these columns?","recv.outgoing.body":"In an Exchange, an existing table goes back in full to the other document: the columns {list} will go to {where}, and their changes will follow.","recv.outgoing.ok":"Send","recv.exchange":"Exchange: your changes to these tables go back to that document, which may pass them on to other participants.","recv.exchange.back":"Exchange: this participant’s changes come into your tables, following the export’s rules (Send tab).","recv.action.sync":"Synchronize","recv.action.link":"Redo the link","recv.public":"Public link: read again while this page is open, only when the export changes.","recv.public.done":"Connected: the widget reads the SOURCE while this page is open.","recv.action.stop":"Stop receiving","recv.stop.title":"Stop receiving “{name}”?","recv.stop.body":"The widget deletes the journal {journal} and its reception form, with its write link: the SOURCE’s sends will fail, and it will have to revoke this reception. The destination tables and their rows stay.","recv.result":"{added} added, {updated} updated, {removed} removed","recv.result.none":"Nothing to do","recv.auto":"Updated automatically while this page is open.","recv.auto.detail":"Every 10 seconds, every minute when nothing arrives.","recv.missing":"{table}: {n} {n|row has|rows have} not arrived yet (sent in several parts). {n|It is sent|They are sent} on {n|its|their} own while an owner of the SOURCE keeps its widget page open: if this number does not go down, ask them to open it.","recv.arrival":"Last delivery arrived: {at} · {n} {n|version|versions} received (a row edited three times counts three times).","recv.arrival.raw":"{n} {n|delivery that arrived is|deliveries that arrived are} not copied into the tables yet: the widget does it while this page stays open and visible.","recv.action.report":"Copy the status for the SOURCE","recv.action.clean":"Clear the history","recv.clean.title":"Clear the history of “{name}”?","recv.clean.body":"The history shown on the card starts again from zero. In the reception journal, the “before” values and those of rows deleted in the SOURCE are erased. Your tables do not change and syncing carries on.","recv.clean.limits":"Grist’s own history (Ctrl+Z, “Document history”) is not touched. This action, however, cannot be undone.","recv.clean.confirm":"Clear","recv.clean.done":"History cleared (journal cleaned: {before} before-{before|value|values}, {values} deleted {values|row|rows}).","recv.report.copied":"Status copied. Paste it in a message to the person who sends: it holds no code, no link and no value from your tables.","recv.report.failed":"Copy is not possible from here: select and copy the text below.","recv.tally":"{table}: the SOURCE announces {expected} {expected|row|rows}, but only {got} arrived here, and nothing has changed for {min} minutes. {gap} {gap|row is|rows are} missing. A delivery may have been lost (Grist restarted, delivery queue cleared), or some SOURCE rows share the same key. Ask an owner of the SOURCE to open its widget page and click “Resend all”; “Copy the status for the SOURCE” gives them what they need to check.","recv.big":"{table}: {n} {n|row|rows} cannot arrive, each larger than the maximum size of a Grist send (1 MB). Shorten it in the SOURCE.","recv.tooBig":"{tables}: too large for the public link (over 2 MB), nothing of it is read. Ask the SOURCE for an invitation, or a row filter.","recv.files.waiting":"{n} {n|file|files} expected in {dest}: {n|it arrives|they arrive} when an owner of the SOURCE document opens the widget page.","recv.files.big":"Too big to be sent ({max} MB at most): {files}.","recv.files.held":"{n} {n|row is|rows are} waiting for {n|its file|their files} before being copied into {dest}: {n|it arrives|they arrive} when an owner of the other document opens the widget page.","recv.files.bigHeld":"Too big to be exchanged ({max} MB at most): {files}. The row that carries it is not copied while it is in the cell.","recv.files.named":"{name} ({size} MB)","recv.files.public":"Attachments do not travel through the public link: their columns stay empty in {dest}.","recv.files.refused":"Grist refuses to store the file {name} here ({error}): next try in 10 minutes.","recv.files.count":"{n} {n|file|files}","recv.suspect.title":"Suspicious arrivals","recv.suspect.rejected":"{n} {n|row|rows} rejected in the journal, {n|on|the last on} {at}: {n|it|they} could not come from this export’s SOURCE (other export, unreadable content). Nothing was copied.","recv.suspect.flood":"Abnormal arrival on {at}: more than 600 rows in a minute, processed in small batches.","recv.suspect.help":"Two possible explanations. Either the SOURCE document was edited by hand (a column, formula or table deleted): ask whoever manages it to look at the Send tab of their widget, which flags it. Or someone other than the SOURCE writes with the form link: if you cannot explain it, cut the link.","recv.suspect.cut":"Cut the link","recv.suspect.dismiss":"Clear the alert","recv.cut.title":"Cut the form link?","recv.cut.body":"The old link will write nothing more into this reception, and the SOURCE’s sends will fail. To resume, the SOURCE revokes the old recipient and sends you a new invitation: accept it here, and the same reception resumes with its tables and a new form, on its own page.","recv.cut.done":"Link cut. Ask the SOURCE for a new invitation, and accept it here.","recv.shared.title":"Link shared with other forms","recv.shared.body":"This reception’s form is on a page holding {n} other {n|form|forms}: their shared link can also write into this journal. Cut the link: this reception will resume with its own form, on its own page.","recv.relink":"This export is already received here: the same reception resumes with this new invitation. Copy the form link (it may have changed).","recv.relink.confirm":"“{name}” is already received in this document (journal {journal}). This invitation resumes the same reception, with its tables: check that it comes from the same person and the same document.","recv.relink.ok":"Resume the reception","recv.offer.title":"Table added to the export: {table}","recv.offer.refuseTitle":"Refuse the table {table}?","recv.offer.refuseBody":"The rows of this table will be set aside as soon as they arrive, now and later. To receive it after all, you will have to stop the reception, then accept a new invitation.","recv.offer.body":"“{name}” now sends the table {table} ({n} {n|row|rows}; columns {cols}).","recv.offer.where":"Table receiving the rows (new or existing)","recv.offer.accept":"Receive","recv.offer.refuse":"Refuse","recv.offer.line":"New table offered: {table} ({n} {n|row|rows})","recv.offer.place":"Choose where it goes","recv.offer.refusedList":"Refused tables (their rows are deleted on arrival): {tables}.","error.codeFormat":"This text is not a sync code. Copy the whole code, from “GRISTSYNC2.” to the end.","error.codeOld":"This code comes from a previous version of the widget. Ask for a new invitation.","error.codeNewer":"This code comes from version {theirs} of the widget, newer than the one in this document ({mine}): the widget in this document is out of date, nothing needs to be redone in the other document. Both documents must use the widget from the same address: check it in the widget settings (Grist’s right panel), reload the page to get the latest version, then paste the code again.","error.inviteOld":"This reply comes from an invitation made by a previous version of the widget. Make a new code (“Back”, then “Make a new code”) and send the new one.","error.notInvitation":"This code is a reply, not an invitation.","error.notReply":"This code is an invitation, not a reply.","error.codeInvalid":"This code is incomplete or altered.","error.otherInstance":"The TARGET document is on another Grist instance: sending is refused.","error.alreadyReceived":"This export is already received in this document, through a public link or from another document: stop that reception first.","error.exportTaken":"This invitation reuses the identifier of an export of this document: it would replace it. It does not come from an up-to-date widget, or was modified: refuse it.","error.unknownInvitation":"This reply matches no pending invitation of this document, or its secret differs.","error.invitationExpired":"This invitation has expired (it is valid for 7 days). Ask the person who sent it for a new one, or make a new code.","error.shareUnreadable":"Grist does not answer to check this link’s document. Try again in a moment.","error.shareUnknown":"This link leads to no published form: it was cut, or copied incomplete.","error.shareOtherDoc":"Refused: this link writes to another document than the one the code says. Do not connect, and warn the person.","error.codeNotCompared":"Enhanced security: first compare the control code with the person, then tick the box.","error.publicHidden":"Public link refused: an access rule hides part of {tables}. The public link would show it to everyone; remove these columns or tables from the export, or invite the person instead.","error.publicHiddenEdit":"Change refused: this export is shared by public link, and an access rule hides part of {tables}. The public link would show it to everyone; remove these tables from the export, or turn off the public link first.","error.mapTwice":"Two sent columns go to the same column.","error.matchUnmapped":"The attach column must receive a sent column.","error.publicClosed":"The SOURCE document can no longer be read by public link.","error.noColumn":"Tick at least one column per table.","error.loop":"Loop refused: a received table cannot be sent back to the document it comes from, nor a table to itself. That would be a two-way sync. Relaying to another document is fine.","error.destTaken":"{dest} already receives the table {table}: a table here receives only one sent table. Choose a new table, or another existing table.","error.destTwice":"Two received tables go to {dest}: a table here receives only one sent table. Choose another destination for one of them.","error.destReserved":"{dest} is a name reserved for the widget: choose another one.","error.destExported":"This document already sends this table in an export: it cannot also receive one (its rows would be deleted). Choose another table.","error.ownerOnly":"Only a document owner can do this.","error.destMissing":"The table {dest} no longer exists.","error.keyLost":"signing key not found (destination table or id_sync column deleted?), nothing is copied. Ask the SOURCE for a new invitation: the same reception resumes.","error.webhookForbidden":"Grist refused to create the webhook: this instance does not allow webhooks to its own address. Nothing was connected. Ask the instance administrator to add the instance’s address to the list of allowed webhook domains (ALLOWED_WEBHOOK_DOMAINS setting), then try again.","error.gristTooOld":"This Grist instance cannot filter a webhook by export (Grist 1.7.11 or later is needed). Nothing was connected.","error.queueStuck":"The delivery queue does not empty: a recipient no longer receives. See the error on its line, then try again.","error.tableNameEmpty":"Give the table a name.","error.tableNameInvalid":"The name can only have letters without accents, digits and “_”, and does not start with a digit.","error.tableNameTaken":"A table of this document already has that name.","error.syncTableForeign":"A table named Synchro already exists in this document, and the widget does not take over someone else’s: the Send tab offers to rename it. Do so, then try again.","error.noPageForTable":"This table has no page in the document: add the widget to the page of your choice (“Add widget to page”, “Custom”), it copies all the receptions of the document.","error.badWidgetUrl":"This widget’s address cannot be read: add it to the page by hand (“Add widget to page”, “Custom”).","error.tooLarge":"A delivery exceeds the size Grist allows (1 MB). The widget clears the queue and resends everything on its own: keep this page open.","error.formLink":"This link does not have the expected form: https://<instance>/o/<team>/forms/<key>/<number>.","error.exchangeOwner":"An Exchange also creates a sending from this document: you must own it.","error.linkTest":"The link does not work ({detail}). Check that the form is published and the document is in a team site.","error.linkElsewhere":"This link does not write into this reception’s journal (another reception’s form, or another document’s). Copy the link of the form named above.","error.generic":"Error: {detail}","error.blockedRules":"An access rule of this document stops the widget from writing here ({detail}). In Grist: Document settings, Access rules; remove or relax the rule that applies to this table. The widget’s tables (Synchro, journals) and the received tables must stay editable by the people who use them.","error.rulesRefused":"Grist refused to set the widget’s access rules (“{why}”): no export is created until the Synchro table is protected. In Grist, Document settings, Access rules: fix the rule that targets a column or table that no longer exists, then try again.","start.outside":"This widget opens inside Grist: add it as a Custom Widget Builder widget with full access.","start.access":"The widget needs full access to the document: it reads its tables, creates its technical table and writes to the destination tables. Without it, it stays stuck on this message.","start.access.where":"The setting is in Grist’s right panel, “Access level” section. First click this widget, then:","start.access.open":"Panel closed: click the framed icon, at the very top right, to open it","start.access.accept":"Panel open: click “Accept”","start.access.list":"Or pick “Full document access” in the list","start.slow":"Grist does not answer the widget. Check that it has full access to the document (right panel: “Accept”, or “Full document access” under “Access level”), then reload the page. If it lasts, check your connection.","start.network":"The widget cannot load the Grist API from {origin}: the network blocks it, or this instance is not in the widget’s list.","start.failed":"The widget could not read the document. {detail} Reload the page.","start.reload":"Reload the page","diag.title":"Sync+ diagnostic {version} ({served})","diag.date":"Date: {value}","diag.instance":"Instance: {value}","diag.unknown":"unknown","diag.access":"Access: {value}","diag.access.reader":"reader","diag.access.editor":"editor","diag.access.owner":"owner","diag.browser":"Browser: {value}","diag.send":"== Send","diag.receive":"== Receive","diag.errors":"== Recent errors","diag.errors.none":"None.","diag.none":"none","diag.yes":"yes","diag.no":"no","diag.send.none":"No export (no Synchro table).","diag.send.noExport":"No export.","diag.send.ownerOnly":"Recipients: only owners can read them.","diag.send.unsafe":"Webhooks on Synchro without a recognised filter: {n}","diag.send.charge":"Resend in progress: {value}","diag.send.progress":"Progress: {value}","diag.send.catchUp":"Catch-up: {value}","diag.send.kinds":"Synchro rows: {value}","diag.recv.none":"No reception.","diag.recv.compare":"Grist refuses the state comparison: slow re-reading.","diag.recv.visible":"Page visible: {value}","diag.recv.hidden":"no (copying waits)","diag.charge.alive":"sign of life {n} s ago","diag.charge.budget":"budget reached, resuming in {n} s","diag.line":"  {label}: {value}","diag.export":"Export {id} “{name}” ({mode})","diag.journal":"Reception {journal} (export {export}, {mode})","diag.journal.flags":"  signed: {signed}, seal: {sealed}, reserved for editors: {reserve}","diag.mode.public":"public","diag.mode.return":"return","diag.mode.exchange":"exchange","diag.mode.oneway":"one way","diag.mode.reply":"reply","diag.suffix.renforce":", reinforced","diag.suffix.return":", return","diag.table":"{table} ({n} cols)","diag.table.filter":"{table} ({n} cols, filter)","diag.reserve.set":"set","diag.reserve.waiting":"waiting","diag.arrival":"{n} rows, last arrival {when}, {raw} raw sends not copied yet","diag.arrival.nodate":"{n} rows, no arrival date, {raw} raw sends not copied yet","diag.gap":"{table}: {got} received out of {expected} announced","diag.suspect":"{n} (last {when})","diag.suspect.flood":"{n} (last {when}, flood)","diag.progress":"export {export}, {done} of {total} rows, {lots} batches of about {lotsTotal}","diag.progress.last":", last batch {n} s ago","diag.catch.first":"running, first pass","diag.catch.never":"not run yet","diag.catch.last":"last pass {when}","diag.catch.running":", running","diag.pass.idle":"nothing to resend","diag.pass.sent":"resent","diag.pass.blocked":"blocked: a recipient is failing","diag.pass.busy":"another page is resending","diag.pass.nosync":"no Synchro table","diag.rcpt":"recipient","diag.rcpt.on":"active","diag.rcpt.paused":"paused","diag.rcpt.queue":"queue {n}","diag.rcpt.success":"last success {when}","diag.rcpt.failure":"last failure {when}","diag.rcpt.attempts":"{n} attempts","diag.rcpt.error":"“{error}”","diag.rcpt.none":"no recipient","diag.l.tables":"tables","diag.l.lost":"tables not found","diag.l.changed":"changed columns","diag.l.invitations":"pending invitations","diag.l.late":"cut batches","diag.l.lists":"lists due","diag.l.refused":"refused tables","diag.l.offers":"offered tables","diag.l.ended":"cut by the SOURCE","diag.l.missing":"missing rows","diag.l.announced":"rows announced by the SOURCE","diag.l.gap":"shortfall reported","diag.l.big":"keys too big","diag.l.suspect":"suspect arrivals","diag.l.journal":"journal","diag.l.errors":"errors","tab.out.button":"Send to a document open in this browser","tab.out.help":"Is the TARGET document open in another tab of this browser? The invitation arrives there in one click, with no code to copy, and the reply comes back here by itself.","tab.out.sent":"Invitation sent. Waiting for the other document…","tab.out.seen":"The other document received it: go there, an invitation is waiting.","tab.out.silent":"No document answered. It must be open in another tab of this browser (same profile, not a private window), with this widget started at the same address, and not read-only. Otherwise, copy the code above.","tab.in.title":"An invitation is waiting in this tab","tab.in.line":"“{name}”: a document open in this browser offers you tables to receive. Nothing is written until you accept.","tab.in.doc":"Announced source document: “{doc}”.","tab.in.check":"The browser does not tell which document the invitation comes from: the next step checks it with Grist.","tab.in.use":"Receive","tab.in.ignore":"Ignore","tab.back.button":"Send back to the originating document","tab.back.help":"Is the originating document open in another tab of this browser? The reply arrives there in one click.","tab.back.sent":"Reply sent. Waiting for the originating document…","tab.back.got":"The originating document received it: go there to approve it, after comparing the control codes.","tab.back.silent":"No document answered. The originating document must be open in another tab of this browser, at the “Invitation” or “Reply” step. Otherwise, copy the code below.","tab.reply.wait":"Is the TARGET document open in this browser? Its reply arrives here by itself.","tab.reply.got":"Reply received from another tab of this browser: check the card, then compare the control code with the other document.","tab.reply.other":"Another reply arrived from another tab: it did not replace this one. If it is the one you expected, paste it above.","recv.format.title":"Document language and currency differ from the SOURCE","recv.format.body":"The SOURCE writes its numbers as “{source}”, this document as “{here}”. Number separators and the default currency come from the document setting, not from the column: choosing the euro in a column does not change the American style.","recv.format.owner":"Only a document owner can change this setting.","recv.format.action":"Set the document like the SOURCE","recv.format.confirmTitle":"Set the language and currency of this document?","recv.format.confirmBody":"The language and currency of the whole document become “{source}”: the numbers of all its tables are written differently. Ctrl+Z or the document history lets you go back.","recv.format.done":"Language and currency set to “{source}”.","recv.action.restyle":"Take again from the SOURCE","recv.restyle.title":"Take elements of “{name}” again from the SOURCE?","recv.restyle.body":"The ticked items are replaced by those of the SOURCE in the received columns: whatever you had changed by hand in these items is overwritten. You can go back with the document history.","recv.restyle.done":"Elements taken again from the SOURCE.","send.el.style":"Column formatting","send.el.style.count":"{n} {n|column concerned|columns concerned}","send.el.style.help":"Colors, number and date formats, currency, header style, simple conditional formatting rules (comparisons on the columns sent) and the document language. A more complex rule is not sent, nor is a rule specific to one view. On the recipient’s side, whatever they have retouched is not overwritten.","send.el.notes":"Column descriptions","send.el.notes.count":"{n} {n|column concerned|columns concerned}","send.el.notes.help":"The description text of each column (the tooltip on its header), 300 characters at most. It is sent as it is and readable by each recipient: do not send it if it holds internal notes. On the recipient’s side, a column created by the widget gets this description once; whatever they wrote or erased is not overwritten.","send.el.tableNote":"Table descriptions","send.el.tableNote.count":"{n} {n|table concerned|tables concerned}","send.el.tableNote.help":"The description of each table (“Raw data” page), 500 characters at most. Set on the receiving side when the description of its table is empty.","send.el.layout":"Order and hidden columns of the page","send.el.layout.count":"{n} {n|table concerned|tables concerned}","send.el.layout.help":"The order of the columns and those that each table’s page hides (the table’s page, not the raw data). On the recipient’s side, only columns created by the widget get it, once; a column that already existed does not move. Only the display changes, never the data. The recipient can take it again from the SOURCE at any time.","recv.restyle.style":"Formatting: formats, colors, header style, conditional formatting rules","recv.restyle.notes":"Column descriptions","recv.restyle.table":"Table description","recv.restyle.layout":"Order and hidden columns of the table’s page","recv.restyle.confirm":"Take again","send.el.formulas":"Column formulas (Python)","send.el.formulas.count":"{n} {n|formula|formulas}","send.el.formulas.badge":"asks for confirmation","send.el.formulas.help":"The Python code of each formula column, and that of the default formula of a data column (a formula that only applies to new rows), 1,500 characters at most each. Not sent: a formula that is recalculated when a column changes, nor that of a Reference or Attachments column. The text is sent as it is and readable by each recipient, who can only apply it after reading it. Without this box, the recipient only receives the computed values.","send.formulas.title":"Also send the formulas?","send.formulas.confirm":"Send the formulas","send.formulas.intro":"A column formula, or a default formula, is Python code that Grist runs on the document’s data. By ticking this box, you offer each recipient to apply some in their document.","send.formulas.own":"Nothing is applied by itself: only an owner of the receiving document can take them, after reading each formula.","send.formulas.run":"They then run your code on their side: put nothing secret in it, and write formulas you can explain to them.","send.formulas.refused":"The recipient refuses outright a formula that is too long, that uses a system module, a hidden name (starting with an underscore), the REQUEST function, a “while” loop or that names a table missing from the export. A Reference or Attachments column is not sent with its formula.","send.formulas.sandbox":"Grist runs formulas in an isolated space, whose strength depends on how the instance is set up. For sensitive data, check with its administrator.","send.formulas.slow":"A formula that is too heavy can slow down the recipient’s document. The document history lets them go back.","recv.restyle.formulas":"Formulas: apply those of the SOURCE (Python) to the columns created by this widget","recv.restyle.formulas.owner":"The formulas of the SOURCE can only be applied by an owner of this document.","recv.formulas.count":"{n} {n|formula to apply|formulas to apply}","recv.formulas.none":"nothing to apply for now","recv.formulas.intro":"Each formula below is Python code written in the SOURCE document. If you apply it, Grist runs it here, on the data of this document. With a column formula, the column no longer receives values from the SOURCE: it computes them. With a default formula, the column stays a data column: the formula only fills the rows you add by hand.","recv.formulas.replaces":"The current values of a formula column are replaced by the result of the formula; a default formula touches no value that is already there. Refused formulas are not applied. The document history lets you go back.","recv.formulas.table":"Table “{table}”","recv.formulas.state.data":"will be applied, data column here","recv.formulas.state.other":"will be applied, another formula is there","recv.formulas.state.same":"already applied","recv.formulas.refused":"will not be applied","recv.formulas.read":"I have read these formulas and want to apply them in this document","recv.formulas.problem.notOwn":"this column already existed in this document: it is never transformed","recv.formulas.problem.unsafe":"contains “{name}”, refused in a received formula","recv.formulas.problem.import":"imports “{name}”, a module outside the allowed list","recv.formulas.problem.missingCol":"names the column “{name}”, which is not in this document","recv.formulas.problem.renamedCol":"names the column “{name}”, which is called “{to}” here","recv.formulas.problem.foreignTable":"names the table “{name}”, which is not a table of this export","recv.formulas.problem.renamedTable":"names the table “{name}”, which is called “{to}” here","recv.adopt.title":"“{dest}” already has rows: nothing is written to it yet","recv.adopt.body":"Here is what will happen if you apply, based on the rows received so far (more may still arrive). Your rows only change with your agreement.","recv.adopt.table":"{table} → {dest}","recv.adopt.add":"{n} {n|row will be added|rows will be added}.","recv.adopt.attach":"{n} {n|row here will be attached|rows here will be attached} to the SOURCE’s by column “{match}” (same value).","recv.adopt.over":"{n} {n|value here will be replaced|values here will be replaced} by the SOURCE’s.","recv.adopt.fill":"{n} {n|empty cell will be filled|empty cells will be filled}.","recv.adopt.untouched":"{n} {n|row here does|rows here do} not move: {n|it stays|they stay} as {n|it is|they are}.","recv.adopt.sample":"“{key}”: {col} goes from “{here}” to “{sent}”.","recv.adopt.nomatch":"No common column was chosen to attach rows: if these rows already exist here they will be duplicated. Cancel the reception and start again choosing the common column to avoid that.","recv.fit.risky":"{col} → {to}: the SOURCE sends type {sent}, the column here is of type {here}. Values that do not fit are kept, but marked invalid by Grist.","recv.fit.bad":"{col} → {to}: the SOURCE sends type {sent}, the column here is of type {here}, which cannot receive these values. Choose another column or a new one.","recv.fit.title":"Some column types do not match","recv.fit.body":"Nothing is changed in your columns, but these values may be invalid or unusable:","recv.fit.ok":"Continue anyway","send.drift.title":"{n} {n|column has|columns have} changed since the export","send.drift.body":"These columns no longer go out correctly. “Edit” brings the export back in line with the table.","send.drift.gone":"{table}: column “{col}” no longer exists (deleted, or renamed).","send.drift.renamed":"{table}: column “{col}” no longer exists; “{to}” has the same type, it was probably renamed.","send.drift.retyped":"{table}: column “{col}” went from type {was} to type {now}. The TARGET keeps its type, values arrive as they are.","send.drift.shown":"{table}: the column shown by “{col}” changed, the values sent are no longer the same.","send.new.title":"{n} {n|column is|columns are} not sent","send.new.body":"Added since the export was saved, it is not sent until you decide. Once sent, it reaches the recipients like a column added to the export.","send.new.line":"{table}: {cols}","send.new.send":"Send these columns","send.new.dismiss":"Do not send them","send.autoCols":"Also send the future columns I add to these tables","send.autoCols.help":"By default, a column added later is not sent: the export’s card flags it and lets you choose. If you tick this box, it goes out by itself, with its content, as soon as an owner opens this page. Think of what one more column may contain.","send.formulas.initial":"A default formula (trigger “on new rows”) changes no received value: it only applies to a row the recipient adds by hand.","recv.formulas.kind.default":"default formula","recv.formulas.state.defData":"will be applied as the default formula, data column here","recv.formulas.state.defOther":"will be applied, replaces the default formula here","recv.formulas.state.defSame":"already applied","recv.formulas.problem.formulaHere":"this column is a formula column here: it is not turned into a data column","common.closeWindow":"Close window","common.help":"Help: {name}","common.helpShow":"Show the explanation","common.leave.title":"Leave without saving?","common.leave.body":"You changed some settings in this window. Do you want to save them before leaving?","common.leave.stay":"Keep editing","common.leave.discard":"Discard changes","common.leave.titleNew":"Leave this window?","common.leave.bodyNew":"Nothing is saved yet: if you leave now, what you chose is lost.","common.leave.stayNew":"Back to the window","recv.archive.help":"By default, a row deleted in the SOURCE is also deleted in your document. With this option, it stays in your table: the widget ticks it in a “Deleted at the source” column (added for the purpose) and stops updating it. If someone asks for their data to be erased, you have to delete the row yourself.","recv.lock.help":"Only the document owners will be able to edit these tables. As a result, data is only copied into your tables when an owner opens this page.","recv.consent.help":"In practice: destination tables that do not exist yet are created. In a table that already exists, the widget only adds the missing columns and a hidden “id_sync” column, used to recognize each row. It also creates a technical journal for this export (the table where deliveries arrive before being copied into your tables) and a reception form, on its own page.","recv.consent.public.help":"In practice: destination tables that do not exist yet are created. In a table that already exists, the widget only adds the missing columns and a hidden “id_sync” column, used to recognize each row. It also creates a technical journal without a page for this export.","recv.consent.name":"What the widget adds to the document","recv.consent.echange.help":"The SOURCE document may pass them on to other participants of the Exchange. The widget adds the MajLe and RecalculLe columns to the destination tables and creates a return export (Send tab). Deleting a row only deletes it here: to delete it everywhere, tick its Supprime box.","recv.consent.echange.name":"What the Exchange changes","recv.reserve.help":"The reception journal is the technical table where everything that is sent arrives, before being copied into your tables. It may contain columns that your access rules hide in your tables. By restricting it to editors, people who can only read the document cannot see it.","send.mode.reply.help":"Your changes go to the recipient. They then send you back a reply code, to paste here to finish connecting.","send.mode.echange.what":"The two documents keep each other up to date: what the recipient changes comes back here. If the same row is changed on both sides, the most recent change wins.","send.mode.echange.more.help":"This document runs the Exchange: it receives each participant’s changes and passes them on to the others, the most recent one winning. Participants do not know each other: each is only connected to this document.","send.mode.public.help":"A single code is enough and the recipient has nothing to reply: they read the export directly. Keep it for data you can publish.","send.mode.publicDone.help":"This link is already open for this export. Its code is behind the “Code” button on the export’s card.","send.mode.public.off":"Not available: this export is already in an Exchange."};

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

const frenchSpaces = text => text.replace(/ ([:;?!»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');

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

const dateText = ms => new Date(ms).toLocaleString(LANG, { dateStyle: 'short', timeStyle: 'short' });
const timeText = sec => new Date(sec * 1000).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });

function typeName(type) {
  const [base, target] = String(type || '').split(':');
  const name = t(`type.${base}`) === `type.${base}` ? base : t(`type.${base}`);
  return /^Ref(List)?$/.test(base) && target ? `${name} (${target})` : name;
}

function translatePage() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    el.title = t(el.dataset.i18nLabel);
  }
}
return { LANG, frenchSpaces, format, t, dateText, timeText, typeName, translatePage };
})();

// ===== js/ui.js =====
__M["js/ui.js"] = (() => {
'use strict';
const {t} = __M["js/i18n.js"];
const {errorText, failure, known, noteError, recentErrors} = __M["js/engine/errors.js"];

const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const matches = (label, query) => fold(query).split(/\s+/).filter(Boolean).every(w => fold(label).includes(w));

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

function docLink(text, url, note = '') {
  if (!url) return text;
  return el('a', { class: 'doc-link', href: url, target: '_blank', rel: 'noopener noreferrer', title: [t('common.docOpen'), note].filter(Boolean).join(' — ') },
    text, icon('external'), el('span', { class: 'sr-only' }, ` ${t('common.newTab')}`));
}

const pill = (text, tone) => el('span', { class: `pill pill-${tone}` }, text);

const smallButton = (label, iconName, onclick, { kind = '', disabled = false, title = null } = {}) => el('button', {
  class: `btn btn-small ${kind}`, type: 'button', disabled, title, onclick,
}, icon(iconName), label);

function notice({ tone = 'info', title = '', lines = [], body = [], actions = [], className = '', ...attrs } = {}) {
  return el('div', { class: `msg msg-${tone} notice${className ? ` ${className}` : ''}`, role: tone === 'err' ? 'alert' : 'status', ...attrs },
    title ? el('strong', { class: 'notice-title' }, title) : null,
    lines.filter(Boolean).map(line => el('p', { class: 'small' }, line)),
    body,
    actions.length ? el('div', { class: 'card-actions' }, actions) : null);
}

let helpCount = 0;
function helpButton(text, name) {
  const id = `gristsync-help-${++helpCount}`;
  const panel = el('div', { class: 'help-panel hidden', id, role: 'note' }, [text].flat().map(paragraph => el('p', {}, paragraph)));
  const button = el('button', {
    class: 'help-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': id,
    'aria-label': t('common.help', { name }), title: t('common.helpShow'),
  }, '?');
  const open = (on) => {
    panel.classList.toggle('hidden', !on);
    button.setAttribute('aria-expanded', String(on));
  };
  button.addEventListener('click', () => open(button.getAttribute('aria-expanded') !== 'true'));
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || button.getAttribute('aria-expanded') !== 'true') return;
    event.stopPropagation(); // la fenêtre reste ouverte : Échap ne ferme que l'explication
    event.preventDefault();
    open(false);
  });
  return { button, panel };
}

function withHelp(control, text, name = '') {
  const { button, panel } = helpButton(text, name || control.textContent.replace(/\s+/g, ' ').trim().slice(0, 90));
  return el('div', { class: 'has-help' }, el('div', { class: 'help-row' }, control, button), panel);
}

function message(kind, text, title = '') {
  return title ? notice({ tone: kind, title, lines: [text] }) : el('p', { class: `msg msg-${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);
}

const stack = [];

const FOCUS_KINDS = 'button, summary, a[href]';
const focusName = node => node.getAttribute('aria-label') || node.textContent.trim();
const sameKind = (root, tag, name) => [...root.querySelectorAll(tag)].filter(node => focusName(node) === name);
function focusSpot(root, node = document.activeElement) {
  if (!node || node === root || !root.contains(node) || !node.matches(FOCUS_KINDS)) return null;
  const name = focusName(node);
  return { tag: node.tagName, name, index: sameKind(root, node.tagName, name).indexOf(node) };
}
function restoreFocus(root, spot) {
  if (!spot) return false;
  const found = sameKind(root, spot.tag, spot.name);
  const target = found[spot.index] || found[0];
  if (!target || target.disabled) return false;
  target.focus({ preventScroll: true });
  return true;
}
function redraw(root, nodes) {
  const spot = focusSpot(root);
  root.replaceChildren(...nodes);
  restoreFocus(root, spot);
}

function openModal({ title, body, buttons = [], width = 480, onClose, guard = null }) {
  const opener = document.activeElement;
  const main = document.getElementById('main');
  const spot = main ? focusSpot(main, opener) : null;
  const titleId = `modal-title-${stack.length}`;
  const footer = el('div', { class: 'modal-footer' });
  const closer = el('button', { class: 'modal-x', type: 'button', 'aria-label': t('common.closeWindow'), title: t('common.closeWindow'),
    onclick: () => modal.requestClose() }, el('span', { 'aria-hidden': 'true' }, '×'));
  const frame = el('div', { class: `modal modal-${width}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    el('div', { class: 'modal-head' }, el('h2', { class: 'modal-title', id: titleId }, title), closer),
    el('div', { class: 'modal-body' }, body),
    footer);
  const scrim = el('div', { class: 'scrim' }, frame);
  let touched = false;
  const touch = (event) => { if (!(event.target.matches && event.target.matches('input[type="search"], textarea, .help-btn'))) touched = true; };
  if (guard) for (const kind of ['input', 'change', EDITED]) frame.addEventListener(kind, touch);
  const modal = {
    frame, footer,
    isDirty: () => Boolean(guard) && touched && (!guard.changed || guard.changed()),
    clean() { touched = false; },
    touch() { touched = true; },
    async requestClose(result) {
      if (!modal.isDirty()) return modal.close(result);
      const answer = await leaveDialog(Boolean(guard.save));
      if (answer === 'discard') modal.close(result);
      else if (answer === 'save') await guard.save(modal);
    },
    close(result) {
      scrim.remove();
      stack.splice(stack.indexOf(modal), 1);
      if (opener && opener.focus) opener.focus();
      if (onClose) onClose(result);
      if (spot) for (const ms of [150, 600, 1500]) setTimeout(() => { if (!stack.length && (!document.activeElement || document.activeElement === document.body)) restoreFocus(main, spot); }, ms);
    },
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
  if (event.key === 'Escape') { event.preventDefault(); modal.requestClose(false); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...modal.frame.querySelectorAll('button, input, textarea, select, summary, [tabindex="0"]')]
    .filter(n => !n.disabled && n.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  const inside = modal.frame.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
});

const EDITED = 'gristsync-edited';
const edited = node => node.dispatchEvent(new Event(EDITED, { bubbles: true }));

function leaveDialog(canSave) {
  return new Promise((resolve) => {
    let answer = 'stay';
    const pick = (value, m) => { answer = value; m.close(); };
    const modal = openModal({
      title: t(canSave ? 'common.leave.title' : 'common.leave.titleNew'), width: 560,
      body: el('p', {}, t(canSave ? 'common.leave.body' : 'common.leave.bodyNew')),
      onClose: () => resolve(answer),
      buttons: [
        { label: t(canSave ? 'common.leave.stay' : 'common.leave.stayNew'), kind: canSave ? '' : 'btn-primary', onClick: m => pick('stay', m) },
        { label: t('common.leave.discard'), kind: 'btn-danger', onClick: m => pick('discard', m) },
        ...(canSave ? [{ label: t('common.save'), kind: 'btn-primary', onClick: m => pick('save', m) }] : []),
      ],
    });
    (modal.footer.querySelector('.btn-primary') || modal.footer.querySelector('button')).focus();
  });
}

function openWizard({ title, steps, onClose, guard = null }) {
  const stepList = el('ol', { class: 'steps' });
  const content = el('div', { class: 'form' });
  const modal = openModal({ title, body: [stepList, content], onClose: () => onClose && onClose(), width: 720, guard });
  let shown = -1;
  return {
    close: () => modal.close(),
    clean: () => modal.clean(),
    touch: () => modal.touch(),
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
    async start(fn) {
      const report = el('div', { class: 'report' });
      if ((await run(null, report, async () => { await fn(); return true; })) === undefined) {
        content.replaceChildren(report);
        modal.setButtons(closeButtons());
      }
    },
  };
}

const cancelButton = () => ({ label: t('common.cancel') });
const laterButton = () => ({ label: t('common.later') });
const backButton = onClick => ({ label: t('common.back'), back: true, onClick });
const closeButtons = () => [{ label: t('common.close'), kind: 'btn-primary' }];

function confirmDialog({ title, body, confirmLabel, kind = 'btn-danger' }) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title, body: typeof body === 'string' ? el('p', {}, body) : el('div', {}, body), width: 400,
      onClose: () => { if (!answered) resolve(false); },
      buttons: [
        { label: t('common.cancel'), onClick: m => { answered = true; resolve(false); m.close(); } },
        { label: confirmLabel, kind, onClick: m => { answered = true; resolve(true); m.close(); } },
      ],
    });
    modal.footer.querySelector('button').focus();
  });
}

function copyField(value, label = t('common.code')) {
  const area = el('textarea', { class: 'code', readonly: true, rows: 3, spellcheck: 'false', 'aria-label': label });
  area.value = value;
  return el('div', { class: 'copy-field' }, area, copyButton(() => value, t('common.copy'), () => area.select()));
}

const codeField = value => el('div', {}, copyField(value), el('p', { class: 'muted small' }, t('common.codeSecret')));

const versionNote = (theirs, mine) => (theirs === mine ? null
  : message('info', theirs ? t('common.otherVersion', { theirs, mine }) : t('common.olderVersion', { mine })));

const controlLine = (label, code) => el('p', { class: 'control-code' }, label, ' ', el('strong', {}, code), el('br'),
  el('span', { class: 'muted small' }, t('common.controlHelp')));

function copyButton(text, label, onFail = () => {}) {
  const button = el('button', { class: 'btn', type: 'button' }, icon('copy'), label);
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text()); } catch (e) { onFail(); return; }
    button.lastChild.textContent = t('common.copied');
    setTimeout(() => { button.lastChild.textContent = label; }, 1500);
  });
  return button;
}

const LONG_LIST = 8;
const SHOWN_MAX = 300;
function checkList({ items, checked = [], label = '', onChange, wide = false }) {
  const name = label ? t('common.filterIn', { name: label }) : t('common.filter');
  const filter = el('input', { class: 'search-input', type: 'search', placeholder: t('common.filter'), 'aria-label': name, autocomplete: 'off' });
  const long = items.length > LONG_LIST;
  const list = el('div', { class: `check-list${wide ? ' check-grid' : ''}${long ? ' check-long' : ''}`, role: 'group', 'aria-label': label || null });
  const locked = new Set(items.filter(it => it.locked).map(it => it.value));
  const chosen = new Set([...checked, ...locked]);
  const count = el('span', { class: 'check-count muted small', 'aria-live': 'polite' });
  const found = () => items.filter(it => matches(`${it.label} ${it.keywords || ''}`, filter.value));
  const changed = () => {
    count.textContent = t('common.checkedCount', { n: chosen.size, total: items.length });
    edited(list);
    onChange(items.map(i => i.value).filter(v => chosen.has(v)));
  };
  const render = () => {
    const all = found();
    const shown = all.slice(0, SHOWN_MAX);
    const more = all.length - shown.length;
    list.replaceChildren(...[...(shown.length ? shown.map(it => el('label', {},
      el('input', {
        type: 'checkbox', checked: chosen.has(it.value), disabled: locked.has(it.value),
        onchange: (e) => { if (e.target.checked) chosen.add(it.value); else chosen.delete(it.value); changed(); },
      }), el('span', { class: 'check-label' }, it.label), it.hint ? el('span', { class: 'hint' }, it.hint) : null)) : [el('p', { class: 'muted small' }, t('common.none'))]),
      more > 0 ? el('p', { class: 'muted small check-more' }, t('common.moreItems', { n: more })) : null].filter(Boolean));
  };
  const setShown = (on) => {
    for (const it of found()) if (on) chosen.add(it.value); else if (!locked.has(it.value)) chosen.delete(it.value);
    render();
    changed();
  };
  filter.addEventListener('input', render);
  render();
  count.textContent = t('common.checkedCount', { n: chosen.size, total: items.length });
  if (long) fitHeight(list);
  const tools = items.length > 1 ? el('div', { class: 'check-tools' }, filter,
    el('button', { class: 'btn btn-small', type: 'button', onclick: () => setShown(true) }, t('common.all')),
    el('button', { class: 'btn btn-small', type: 'button', onclick: () => setShown(false) }, t('common.noneChecked')),
    count) : filter;
  return el('div', { class: 'check-select' }, tools, list);
}

function fitHeight(list) {
  if (typeof ResizeObserver === 'undefined') return;
  const watch = new ResizeObserver(() => {
    if (!list.offsetHeight) return;
    watch.disconnect();
    list.style.height = `${Math.min(list.scrollHeight + 2, Math.max(160, Math.round(window.innerHeight * 0.45)))}px`;
    list.style.maxHeight = 'none';
  });
  watch.observe(list);
}

function pickField({ items, value, label, onChange = () => {} }) {
  let current = value;
  const button = el('button', { class: 'btn pick-button', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
  const filter = el('input', { class: 'search-input', type: 'search', placeholder: t('common.filter'), 'aria-label': t('common.filter'), autocomplete: 'off' });
  const list = el('div', { class: 'check-list', role: 'listbox', 'aria-label': label });
  const panel = el('div', { class: 'pick-panel hidden' }, filter, list);
  const field = el('div', { class: 'pick-field' }, button, panel);
  const shown = () => (items.find(it => it.value === current) || items[0] || { label: t('common.choose') }).label;
  const showChoice = () => { button.textContent = shown(); button.setAttribute('aria-label', `${label} : ${shown()}`); };
  const toggle = (open) => {
    panel.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) { filter.value = ''; render(); filter.focus(); } else button.focus();
  };
  const choose = (v) => { current = v; showChoice(); toggle(false); edited(field); onChange(v); };
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

const unreachable = e => e instanceof TypeError && /fetch|load failed|network/i.test(e.message);

async function run(button, out, fn) {
  if (button) button.disabled = true;
  if (out) out.replaceChildren();
  try {
    return await fn();
  } catch (e) {
    if (!known(e)) (unreachable(e) ? console.warn : console.error)(e);
    noteError(e);
    if (out) out.replaceChildren(message('err', errorText(e)));
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

const RELOAD_MS = 8000;
function reloading(root, render) {
  root.replaceChildren(message('info', t('common.reloading')));
  setTimeout(() => { if (root.isConnected) render(); }, RELOAD_MS);
}
return { el, icon, docLink, pill, smallButton, notice, helpButton, withHelp, message, redraw, openModal, edited, openWizard, cancelButton, laterButton, backButton, closeButtons, confirmDialog, copyField, codeField, versionNote, controlLine, copyButton, checkList, pickField, unreachable, run, reloading, errorText, failure, noteError, recentErrors };
})();

// ===== js/form-link.js =====
__M["js/form-link.js"] = (() => {
'use strict';
const {formPages} = __M["js/engine/pages.js"];
const {el} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

async function formWhere(journal) {
  const page = (await formPages()).get(journal);
  return page ? t('recv.link.where.page', { page: page.name }) : t('recv.link.where');
}

const linkFigures = () => ['recv.link.step1', 'recv.link.step2'].map(key => el('p', { class: 'small' }, t(key)));
return { formWhere, linkFigures };
})();

// ===== js/guide.js =====
__M["js/guide.js"] = (() => {
'use strict';
const {t} = __M["js/i18n.js"];
const {copyButton, copyField, el} = __M["js/ui.js"];

const STEPS = {
  reponse: [['source', 'guide.s1'], ['target', 'guide.t1'], ['target', 'guide.t2'], ['source', 'guide.s2'], ['target', 'guide.t3']],
  public: [['source', 'guide.p.s1'], ['target', 'guide.p.t1']],
  echange: [['source', 'guide.e.s1'], ['target', 'guide.e.t1'], ['target', 'guide.t2'], ['source', 'guide.s2'], ['target', 'guide.e.t3']],
};

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

const handoffButton = (role, mode, from, code) => el('div', { class: 'handoff' },
  copyButton(() => handoffText(role, mode, from, code), t('guide.copyHandoff')), el('span', { class: 'muted small' }, t('guide.copyHandoff.help')));

function handoffText(role, mode, from, code) {
  const lines = STEPS[mode].slice(from).filter(([r]) => r === role).map(([, key], i) => `${i + 1}. ${t(key)}`);
  return [t(`guide.handoff.${role}`), '', ...lines, '', t('guide.install'), '', t('guide.handoff.code'), code].join('\n');
}
return { roleGuide, handoffButton };
})();

// ===== js/news.js =====
__M["js/news.js"] = (() => {
'use strict';
const {readPref, writePref} = __M["js/prefs.js"];
const {backButton, el, laterButton, message, openWizard} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

const NEWS_VERSION = '0.21';
const POINTS = ['echange', 'files', 'filter', 'signed', 'taken', 'follow', 'sends', 'errors', 'setup'];

const newsSeen = () => readPref('news') === NEWS_VERSION;
const markNewsSeen = () => writePref('news', NEWS_VERSION);

function openNews({ facts, onGo, onClose }) {
  const steps = [t('news.step.news'), t('news.step.shares')];
  const wizard = openWizard({ title: t('news.title'), steps, onClose: () => { markNewsSeen(); if (onClose) onClose(); } });
  wizard.start(() => showNews(wizard, facts, onGo));
  return wizard;
}

function showNews(wizard, facts, onGo) {
  const detail = el('p', { class: 'msg msg-info', role: 'status' }, t(`news.${POINTS[0]}.line`));
  const buttons = POINTS.map((point, i) => el('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(i === 0), 'data-news': point,
    onclick: () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === buttons[i]));
      detail.textContent = t(`news.${point}.line`);
    },
  }, t(`news.${point}.title`)));
  wizard.show(0, [el('p', {}, t('news.intro')), el('div', { class: 'tuto-filter', role: 'group', 'aria-label': t('news.step.news') }, buttons), detail],
    [laterButton(), { label: t('common.next'), kind: 'btn-primary', onClick: () => showShares(wizard, facts, onGo) }]);
}

function factsLine(facts) {
  const parts = [];
  if (facts.exports) parts.push(t('news.facts.exports', { n: facts.exports }));
  if (facts.people) parts.push(t('news.facts.people', { n: facts.people }));
  if (facts.invitations) parts.push(t('news.facts.invitations', { n: facts.invitations }));
  if (facts.receptions) parts.push(t('news.facts.receptions', { n: facts.receptions }));
  return parts.length ? parts.join(' · ') : t('news.facts.none');
}

function showShares(wizard, facts, onGo) {
  const group = (title, lines) => el('div', {}, el('p', { class: 'field-title' }, title), el('ul', {}, lines.map(line => el('li', {}, t(line)))));
  const go = (facts.people || facts.invitations) ? 'send' : facts.receptions ? 'receive' : '';
  wizard.show(1, [
    message('ok', t('news.shares.ok')), el('p', { class: 'small' }, t('news.shares.only')),
    el('details', {}, el('summary', {}, t('news.shares.why')), el('p', { class: 'small' }, t('news.shares.whyBody'))),
    group(t('news.shares.kept'), ['news.kept1', 'news.kept2', 'news.kept3']),
    group(t('news.shares.todo'), ['news.todo1', 'news.todo2', 'news.todo3']),
    el('p', {}, el('strong', {}, t('news.facts.title')), ' ', factsLine(facts)),
    facts.receptions ? el('p', { class: 'small' }, t('news.shares.target', { n: facts.receptions })) : null,
  ], [backButton(() => showNews(wizard, facts, onGo)), laterButton(),
    go ? { label: t('news.shares.go'), kind: 'btn-primary', onClick: (modal) => { modal.close(); onGo(go); } } : { label: t('common.close'), kind: 'btn-primary' }]);
}
return { NEWS_VERSION, newsSeen, markNewsSeen, openNews };
})();

// ===== js/rules-notice.js =====
__M["js/rules-notice.js"] = (() => {
'use strict';
const {ruleRefusal} = __M["js/engine/acl.js"];
const {message} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

function rulesRefusedNotice() {
  const why = ruleRefusal();
  return why ? message('err', t('rules.refused.body', { why }), t('rules.refused.title')) : null;
}
return { rulesRefusedNotice };
})();

// ===== js/source/public-stay.js =====
__M["js/source/public-stay.js"] = (() => {
'use strict';

const KEY = 'publicCoupe';

const isOpen = access => typeof access === 'string' && access !== '';

const staysPublic = note => Boolean(note) && note[KEY] === true;

const markStay = note => (staysPublic(note) ? note : { ...note, [KEY]: true });
function clearStay(note) {
  if (!note || !(KEY in note)) return note;
  const { [KEY]: gone, ...rest } = note;
  return rest;
}

const hasPublicExport = exports => (exports || []).some(e => e.public);

const lingering = ({ note, exports, access }) => staysPublic(note) && isOpen(access) && !hasPublicExport(exports);

const forgettable = ({ note, access }) => staysPublic(note) && access === '';

const watchesAccess = ({ note, exports, access }) => hasPublicExport(exports) || staysPublic(note) || access === 'editors';

const accessMoved = (shown, read) => read !== null && read !== undefined && read !== shown;

const waitsForAccess = ({ note, exports, access }) =>
  (hasPublicExport(exports) && !isOpen(access)) || lingering({ note, exports, access });
return { isOpen, staysPublic, markStay, clearStay, lingering, forgettable, watchesAccess, accessMoved, waitsForAccess };
})();

// ===== js/source/shown.js =====
__M["js/source/shown.js"] = (() => {
'use strict';
const {hookLabel, memoDoc} = __M["js/engine/logic/exports.js"];
const {docUrl} = __M["js/engine/logic/codes.js"];

function hookShown(memo, docName = '') {
  const parts = hookLabel(memo, docName).split(' · ').filter(Boolean);
  return (parts.length === 3 ? [parts[0], parts[2]] : parts).join(' · ');
}

function hookDoc(memo, docName = '', origin = '') {
  const doc = memoDoc(memo);
  const name = String(docName || '').trim() || doc.name;
  const place = [doc.team, name].filter(Boolean).join('/') || doc.docId;
  return { who: doc.email, place, url: docUrl(origin, doc.team, doc.docId, name) };
}
return { hookShown, hookDoc };
})();

// ===== js/source/flow.js =====
__M["js/source/flow.js"] = (() => {
'use strict';
const {LONG_SECONDS, durationParts, sizeParts} = __M["js/engine/logic/estimate.js"];
const {BUDGET_WINDOW, RESEND_BUDGET} = __M["js/engine/logic/resend.js"];
const {el, openModal} = __M["js/ui.js"];
const {t, timeText} = __M["js/i18n.js"];

function durationText(seconds) {
  const { h, min } = durationParts(seconds);
  if (!h && !min) return t('common.dur.under');
  if (!h) return t('common.dur.min', { n: min });
  return min ? t('common.dur.hm', { h, m: min }) : t('common.dur.h', { h });
}

function sizeText(bytes) {
  const { n, unit } = sizeParts(bytes);
  return t(`common.size.${unit}`, { n });
}

const TONE = { blocked: 'err', paused: 'warn', interrupted: 'warn' };
const MOVING = ['running', 'runningOther', 'budget'];

function flowView(flow) {
  if (!flow) return null;
  const v = flow.vars;
  const parts = [t(`send.flow.${flow.key}`, { ...v, at: v.at ? timeText(v.at) : '' })];
  if (v.left && MOVING.includes(flow.key)) parts.push(t('send.flow.left', { left: durationText(v.left) }));
  if (flow.key === 'waiting' && v.at) parts.push(t('send.flow.lastPass', { at: timeText(v.at) }));
  const box = el('div', { class: 'flow', 'data-flow': flow.key },
    el('p', { class: `msg msg-${TONE[flow.key] || 'info'}`, role: TONE[flow.key] === 'err' ? 'alert' : null }, parts.join(' ')));
  if (v.total && MOVING.includes(flow.key)) box.append(el('progress', { max: v.total, value: Math.min(v.done, v.total), 'aria-label': t('send.flow.bar', { pct: v.pct }) }));
  return box;
}

const progressTo = out => out && ((flow) => {
  if (flow === null) {
    out.replaceChildren();
    return;
  }
  out.replaceChildren(flowView(flow));
  out.scrollIntoView({ block: 'nearest' });
});

function estimateLines(est) {
  return [
    el('p', {}, t('send.estimate.body', {
      rows: est.rows, size: sizeText(est.bytes), lots: est.lots, n: est.recipients, dur: durationText(est.seconds),
    })),
    est.seconds >= LONG_SECONDS ? el('p', { class: 'muted small' }, t('send.estimate.pace', { mb: RESEND_BUDGET / 1000000, min: BUDGET_WINDOW / 60 })) : null,
  ];
}

function confirmSend(est) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title: t('send.estimate.title'), body: estimateLines(est), width: 480,
      onClose: () => { if (!answered) resolve(false); },
      buttons: [
        { label: t('common.cancel'), onClick: (m) => { answered = true; resolve(false); m.close(); } },
        { label: t('send.load.ok'), kind: 'btn-primary', onClick: (m) => { answered = true; resolve(true); m.close(); } },
      ],
    });
  });
}
return { flowView, progressTo, estimateLines, confirmSend };
})();

// ===== js/source/actions.js =====
__M["js/source/actions.js"] = (() => {
'use strict';
const {VERSION} = __M["js/config.js"];
const {cancelPendingInvitation, pauseRecipient, publicCode: makePublicCode, endExport, resumePlan, resumeRecipient, revokeRecipient, revokesOne, stopPublicShare} = __M["js/engine/source/actions.js"];
const {clearAndMark} = __M["js/engine/source/resend.js"];
const {clearExportHistory} = __M["js/engine/source/history.js"];
const {updateSourceNote} = __M["js/engine/source/synchro.js"];
const {markStay} = __M["js/source/public-stay.js"];
const {hookShown} = __M["js/source/shown.js"];
const {progressTo} = __M["js/source/flow.js"];
const {closeButtons, confirmDialog, copyField, el, openModal} = __M["js/ui.js"];
const {handoffButton} = __M["js/guide.js"];
const {t} = __M["js/i18n.js"];

const pause = pauseRecipient;

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

async function resume(exp, h, out) {
  const { since, n, all } = await resumePlan(exp, h);
  const help = [t('send.resume.catchup.help', { n }), all ? t('send.resume.all') : ''].filter(Boolean).join(' ');
  const picked = await resumeChoice(t('send.resume.title', { name: hookShown(h.fields.memo) || exp.name }), help);
  if (!picked) return;
  await resumeRecipient(exp, h, { catchup: picked === 'catchup', since }, progressTo(out));
}

async function revoke(exp, h) {
  const one = revokesOne(exp);
  const body = t(one ? 'send.revoke.participant' : exp.echange ? 'send.revoke.exchange' : 'send.revoke.body');
  if (!(await confirmDialog({ title: t('send.revoke.title', { name: h.fields.memo || exp.name }), body, confirmLabel: t('send.action.revoke') }))) return;
  await revokeRecipient(exp, h);
}

async function cancelInvitation(inv) {
  if (!(await confirmDialog({ title: t('send.cancel.title'), body: t('send.cancel.body'), confirmLabel: t('send.action.cancel') }))) return;
  await cancelPendingInvitation(inv);
}

async function unblockQueue() {
  if (await confirmDialog({ title: t('send.unblock.title'), body: t('send.unblock.body'), confirmLabel: t('send.action.unblock') })) await clearAndMark();
}

async function deleteExport(exp) {
  const body = t('send.delete.body', { n: exp.recipients.length });
  if (!(await confirmDialog({ title: t('send.delete.title', { name: exp.name }), body, confirmLabel: t('send.action.delete') }))) return;
  await endExport(exp);
  if (exp.public) await rememberStay(); // le partage public de Grist, lui, reste ouvert (voir public-stay.js)
}

async function clearHistory(exp) {
  const body = [el('p', {}, t('send.history.clearBody')), exp.echange && !exp.retour ? el('p', {}, t('send.history.clearBack')) : null, el('p', { class: 'muted small' }, t('send.history.clearLimits'))];
  if (!(await confirmDialog({ title: t('send.history.clearTitle', { name: exp.name }), body, confirmLabel: t('send.history.clear') }))) return;
  await clearExportHistory(exp.id);
}

const publicCode = exp => makePublicCode(exp, VERSION);

async function showPublicCode(exp) {
  const code = await publicCode(exp);
  await new Promise(resolve => openModal({ title: exp.name, onClose: resolve,
    body: [el('p', {}, t('send.public.help')), copyField(code), handoffButton('target', 'public', 1, code)], buttons: closeButtons() }));
}

async function stopPublic(exp) {
  const body = t('send.public.revokeBody');
  if (!(await confirmDialog({ title: t('send.public.stopTitle', { name: exp.name }), body, confirmLabel: t('send.public.stop') }))) return;
  await stopPublicShare(exp);
  await rememberStay();
}

const rememberStay = () => updateSourceNote(markStay).catch(console.warn);
return { pause, resume, revoke, cancelInvitation, unblockQueue, deleteExport, clearHistory, publicCode, showPublicCode, stopPublic };
})();

// ===== js/source/doc-name.js =====
__M["js/source/doc-name.js"] = (() => {
'use strict';
const {docNameFrom} = __M["js/engine/logic/codes.js"];
const {docIdentity} = __M["js/grist.js"];
const {el, withHelp} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

const NOTES = {
  address: ['info', 'send.docName.fromAddress'],
  noName: ['warn', 'send.docName.noName'],
  otherDoc: ['err', 'send.docName.otherDoc'],
  otherSite: ['err', 'send.docName.otherSite'],
  invalid: ['err', 'send.docName.invalid'],
};

async function docNameField(initial) {
  const here = await docIdentity().catch(() => null);
  const note = el('p', { role: 'status', hidden: true });
  const input = el('input', { type: 'text', class: 'input', id: 'gristsync-doc-name', maxlength: 2000, autocomplete: 'off', value: initial });
  const read = () => {
    const { kind, name } = docNameFrom(input.value, here);
    if (kind === 'typed') return name;
    const [tone, key] = NOTES[kind];
    input.value = name;
    note.className = `msg msg-${tone}`;
    note.setAttribute('role', tone === 'err' ? 'alert' : 'status');
    note.textContent = t(key);
    note.hidden = false;
    return name;
  };
  input.addEventListener('input', () => {
    if (docNameFrom(input.value, here).kind !== 'typed') read();
    else note.hidden = true;
  });
  const node = el('div', { class: 'form' }, withHelp(el('label', { for: 'gristsync-doc-name' }, t('send.docName')), t('send.docName.help')), input, note);
  return { node, value: () => docNameFrom(input.value, here).name };
}
return { docNameField };
})();

// ===== js/source/filter-editor.js =====
__M["js/source/filter-editor.js"] = (() => {
'use strict';
const {OPERATORS, columnValues, filterKind, filterTester, operandOf, rowFilter} = __M["js/engine/logic/filters.js"];
const {fetchRows} = __M["js/grist.js"];
const {checkList, el, icon, message, pickField, withHelp} = __M["js/ui.js"];
const {LANG, t} = __M["js/i18n.js"];

function opLabel(kind, op) {
  const own = `send.op.${kind}.${op}`;
  return t(own) === own ? t(`send.op.${op}`) : t(own);
}

const dayText = day => new Date(`${day}T00:00:00`).toLocaleDateString(LANG);
function valueText(kind, value) {
  if (kind === 'date') return dayText(value);
  return kind === 'number' ? Number(value).toLocaleString(LANG) : t('send.filter.quoted', { value });
}
function pickedText(cond) {
  const shown = (cond.labels || cond.values).map(String);
  const first = shown.slice(0, 3).map(value => t('send.filter.quoted', { value })).join(', ');
  return shown.length > 3 ? t('send.filter.more', { values: first, n: shown.length - 3 }) : first;
}

function filterSummary(filter) {
  const spec = rowFilter(filter);
  if (!spec) return '';
  return spec.conds.map((cond) => {
    const kind = filterKind(cond.source);
    const need = operandOf(cond.op);
    const values = need === 'pick' ? pickedText(cond)
      : need === 'two' ? t('send.filter.range', { from: valueText(kind, cond.values[0]), to: valueText(kind, cond.values[1]) })
        : need === 'one' ? valueText(kind, cond.values[0]) : '';
    return [cond.id, opLabel(kind, cond.op), values].filter(Boolean).join(' ');
  }).join(t(spec.mode === 'any' ? 'send.filter.or' : 'send.filter.and'));
}

const freshCond = col => ({ id: col.id, source: col.source, visible: col.visible, op: OPERATORS[filterKind(col.source)][0], values: [] });

function filterData(table) {
  const tableData = { rows: null, labels: {}, loading: null, failed: false };
  const cache = new Map();
  tableData.labelsFor = async (cond) => {
    const kind = filterKind(cond.source);
    if (kind !== 'ref' && kind !== 'refs') return;
    const target = cond.source.split(':')[1];
    const key = `${target}.${cond.visible}`;
    if (!cache.has(key)) cache.set(key, fetchRows(target).then(rows => new Map(rows.map(r => [r.id, cond.visible ? r[cond.visible] : r.id]))));
    tableData.labels[cond.id] = await cache.get(key);
  };
  tableData.read = async (conds) => {
    try {
      tableData.rows = await fetchRows(table);
      await Promise.all(conds.map(tableData.labelsFor));
    } catch (e) {
      tableData.rows = null;
      tableData.failed = true;
    }
  };
  return tableData;
}

function pickEditor(cond, tableData, name, changed) {
  if (!tableData.rows) return el('p', { class: 'muted small' }, t(tableData.failed ? 'send.filter.unreadable' : 'send.filter.reading'));
  const found = columnValues(cond, tableData.rows, tableData.labels[cond.id]);
  const labels = new Map(found.map(v => [v.value, v.label]));
  (cond.values || []).forEach((v, i) => { if (!labels.has(v)) { labels.set(v, String((cond.labels || [])[i] ?? v)); found.push({ value: v, label: labels.get(v), n: 0 }); } });
  return checkList({
    items: found.map(v => ({ value: v.value, label: v.label, hint: t('send.filter.rows', { n: v.n }) })),
    checked: cond.values, label: name, wide: true,
    onChange: (values) => { cond.values = values; cond.labels = values.map(v => labels.get(v)); changed(); },
  });
}

function typedEditor(cond, kind, tableData, { table, index, name }, changed) {
  const need = operandOf(cond.op);
  const type = kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text';
  const listId = `gristsync-filter-values-${table}-${index}`;
  const input = i => el('input', {
    class: 'input', type, step: type === 'number' ? 'any' : null, value: cond.values[i] ?? '', list: type === 'text' && tableData.rows ? listId : null,
    'aria-label': need === 'two' ? t(i ? 'send.filter.to' : 'send.filter.from', { n: index + 1 }) : name,
    oninput: (e) => { cond.values[i] = e.target.value; changed(); },
  });
  const suggestions = type === 'text' && tableData.rows
    ? el('datalist', { id: listId }, columnValues(cond, tableData.rows, tableData.labels[cond.id]).slice(0, 200).map(v => el('option', { value: v.label }))) : null;
  return el('div', { class: 'filter-values' }, input(0), need === 'two' ? [el('span', { class: 'muted' }, t('send.filter.betweenAnd')), input(1)] : null, suggestions);
}

function countView(tableData, state) {
  const total = tableData.rows.length;
  const spec = rowFilter({ mode: state.mode, conds: state.conds });
  const n = spec ? tableData.rows.filter(filterTester(spec, tableData.labels)).length : total;
  const ignored = state.conds.length - (spec ? spec.conds.length : 0);
  return [
    el('p', {}, spec ? t('send.filter.count', { n, total }) : t('send.filter.countAll', { total })),
    ignored ? el('p', { class: 'muted' }, t('send.filter.incomplete', { n: ignored })) : null,
    spec && !n && total ? message('warn', t('send.filter.nothing')) : null].filter(Boolean);
}

const columnPicker = (usable, labelOf, cond, index, onPick) => pickField({
  items: usable.map(c => ({ value: c.id, label: labelOf(c) })), value: cond.id, label: t('send.filter.column', { n: index + 1 }),
  onChange: id => onPick(freshCond(usable.find(c => c.id === id))),
});

const operatorPicker = (kind, cond, index, onPick) => pickField({
  items: (OPERATORS[kind].includes(cond.op) ? OPERATORS[kind] : [...OPERATORS[kind], cond.op]).map(op => ({ value: op, label: opLabel(kind, op) })),
  value: cond.op, label: t('send.filter.operator', { n: index + 1 }), onChange: onPick,
});

const removeButton = (index, onclick) => el('button', {
  class: 'icon-button', type: 'button', title: t('send.filter.remove', { n: index + 1 }), 'aria-label': t('send.filter.remove', { n: index + 1 }), onclick,
}, icon('trash'));

const modeRadios = (table, state, changed) => [el('span', {}, t('send.filter.mode')), ...['all', 'any'].map(value => el('label', { class: 'check' },
  el('input', { type: 'radio', name: `gristsync-filter-mode-${table}`, value, checked: state.mode === value, onchange: () => { state.mode = value; changed(); } }),
  t(`send.filter.mode.${value}`)))];

function filterEditor({ table, columns, current, labelOf, onChange }) {
  const usable = columns.filter(c => filterKind(c.source));
  const start = rowFilter(current);
  const state = { mode: start ? start.mode : 'all', conds: start ? start.conds.map(c => ({ ...c })) : [] };
  const tableData = filterData(table);
  const conds = el('div', { class: 'filter-conds' });
  const mode = el('div', { class: 'filter-mode', role: 'radiogroup', 'aria-label': t('send.filter.mode') });
  const count = el('div', { class: 'small', 'aria-live': 'polite' });
  const add = el('button', { class: 'btn btn-small', type: 'button', onclick: () => addCond() }, icon('plus'), t('send.filter.add'));

  const changed = () => {
    onChange(state.conds.length ? { mode: state.mode, conds: state.conds.map(c => ({ ...c })) } : null);
    showCount();
  };

  function load() {
    tableData.loading ||= (async () => {
      count.replaceChildren(el('p', { class: 'muted' }, t('send.filter.reading')));
      await tableData.read(state.conds);
      render();
      if (tableData.failed) count.replaceChildren(message('warn', t('send.filter.unreadable')));
    })();
    return tableData.loading;
  }

  function showCount() {
    if (tableData.rows) count.replaceChildren(...countView(tableData, state));
  }

  async function addCond() {
    if (!usable.length) return;
    const cond = freshCond(usable[0]);
    state.conds.push(cond);
    if (tableData.rows) await tableData.labelsFor(cond).catch(() => null);
    render();
    changed();
    load();
  }

  function valueEditor(cond, kind, index) {
    const need = operandOf(cond.op);
    const name = t('send.filter.value', { n: index + 1 });
    if (need === 'none') return null;
    return need === 'pick' ? pickEditor(cond, tableData, name, changed) : typedEditor(cond, kind, tableData, { table, index, name }, changed);
  }

  function condBlock(cond, index) {
    const kind = filterKind(cond.source);
    const column = columnPicker(usable, labelOf, cond, index, async (fresh) => {
      state.conds[index] = fresh;
      await tableData.labelsFor(fresh).catch(() => null);
      render();
      changed();
    });
    const operator = operatorPicker(kind, cond, index, (op) => {
      if (operandOf(op) !== operandOf(cond.op)) Object.assign(cond, { values: [], labels: undefined });
      cond.op = op;
      render();
      changed();
    });
    const remove = removeButton(index, () => { state.conds.splice(index, 1); render(); changed(); });
    return el('div', { class: 'filter-cond', role: 'group', 'aria-label': t('send.filter.condition', { n: index + 1 }) },
      el('div', { class: 'filter-cond-head' }, column, operator, remove), valueEditor(cond, kind, index));
  }

  function render() {
    conds.replaceChildren(...(state.conds.length ? state.conds.map(condBlock) : [el('p', { class: 'muted small' }, t('send.filter.none'))]));
    mode.replaceChildren(...(state.conds.length > 1 ? modeRadios(table, state, changed) : []));
    add.hidden = !usable.length;
    showCount();
  }

  render();
  const node = el('div', { class: 'filter-field' }, withHelp(el('p', { class: 'field-title' }, t('send.filter.title', { table })), t('send.filter.help')),
    conds, add, mode, count);
  return { node, load };
}
return { filterSummary, filterEditor };
})();

// ===== js/source/pull.js =====
__M["js/source/pull.js"] = (() => {
'use strict';
const {isFileColumn} = __M["js/engine/logic/exports.js"];

const PULL_MODES = ['shown', 'all', 'pick'];

function pullColumns({ mode = 'shown', usable = [], required = [], extras = [] }) {
  const more = mode === 'all' ? usable.filter(c => !isFileColumn(c)).map(c => c.id) : mode === 'pick' ? extras : [];
  return [...new Set([...required, ...more])];
}

const pullLeftOut = ({ mode = 'shown', usable = [] }) => (mode === 'all' ? usable.filter(isFileColumn) : []);

const extrasFor = ({ usable = [], required = [], columns = [] }) => columns.filter(id => !required.includes(id) && usable.some(c => c.id === id));
return { PULL_MODES, pullColumns, pullLeftOut, extrasFor };
})();

// ===== js/source/export-parts.js =====
__M["js/source/export-parts.js"] = (() => {
'use strict';
const {el} = __M["js/ui.js"];

const columnLabel = c => (c.label === c.id ? c.id : `${c.label} (${c.id})`);

function togglePart(part, label, open, onOpen = () => {}) {
  part.classList.toggle('hidden', !open);
  const button = el('button', { class: 'btn btn-small', type: 'button', 'aria-expanded': String(open), onclick: () => {
    const now = part.classList.toggle('hidden') === false;
    button.setAttribute('aria-expanded', String(now));
    if (now) onOpen();
  } }, label);
  return button;
}
return { columnLabel, togglePart };
})();

// ===== js/source/export-links.js =====
__M["js/source/export-links.js"] = (() => {
'use strict';
const {exportableColumns} = __M["js/engine/logic/exports.js"];
const {linkOffers} = __M["js/engine/logic/links.js"];
const {checkList, el, withHelp} = __M["js/ui.js"];
const {filterEditor, filterSummary} = __M["js/source/filter-editor.js"];
const {PULL_MODES, extrasFor, pullColumns, pullLeftOut} = __M["js/source/pull.js"];
const {columnLabel, togglePart} = __M["js/source/export-parts.js"];
const {t, typeName} = __M["js/i18n.js"];

const pullMode = (ctx, table) => ctx.pulls.get(table) || 'shown';
const pulledColumns = (ctx, schema, table, required = []) => pullColumns({
  mode: pullMode(ctx, table), usable: exportableColumns(schema.columns(table) || []), required, extras: [...(ctx.extras.get(table) || [])],
});
const offersOf = (ctx, schema) => linkOffers({
  chosen: ctx.chosen, columnsOf: table => exportableColumns(schema.columns(table) || []),
  picked: table => (ctx.chosen.includes(table) ? ctx.selected.get(table) : pulledColumns(ctx, schema, table)),
  choices: ctx.choices, saved: ctx.saved,
});

function pulledBlock(ctx, schema, { table, required, onChange }) {
  const usable = exportableColumns(schema.columns(table) || []);
  const mode = () => pullMode(ctx, table);
  const picked = () => pulledColumns(ctx, schema, table, required);
  const labels = ids => usable.filter(c => ids.includes(c.id)).map(c => c.label);
  const summary = el('p', { class: 'small' });
  const leftOut = el('p', { class: 'muted small' });
  const describe = () => {
    const rows = filterSummary(ctx.filters.get(table));
    const names = mode() === 'all' ? t('send.refs.summary.whole') : labels(picked()).join(', ');
    summary.textContent = `${t('send.columns.some', { n: picked().length, total: usable.length })} (${names}) · ${rows ? t('send.rows.filtered', { filter: rows }) : t('send.rows.all')}`;
    const files = pullLeftOut({ mode: mode(), usable }).map(c => c.label);
    leftOut.textContent = files.length ? t('send.refs.mode.files', { cols: files.join(', ') }) : '';
    leftOut.classList.toggle('hidden', !files.length);
  };
  const columns = el('div', { class: 'form' });
  const drawColumns = () => {
    columns.replaceChildren(checkList({
      items: usable.map(c => ({ value: c.id, label: columnLabel(c), hint: typeName(c.source), keywords: typeName(c.source), locked: required.includes(c.id) })), wide: true,
      checked: picked(), label: table, onChange: (values) => { ctx.extras.set(table, values.filter(v => !required.includes(v))); describe(); onChange(); },
    }));
    columns.classList.toggle('hidden', mode() !== 'pick');
  };
  const choose = (next) => {
    if (next === 'pick' && mode() !== 'pick') ctx.extras.set(table, extrasFor({ usable, required, columns: picked() }));
    ctx.pulls.set(table, next);
    drawColumns();
    describe();
    onChange();
  };
  const name = `gristsync-pull-${table}`;
  const texts = {
    shown: t('send.refs.mode.shown', { cols: labels(required).join(', ') }),
    all: t('send.refs.mode.all', { n: usable.filter(c => !pullLeftOut({ mode: 'all', usable }).includes(c)).length }),
    pick: t('send.refs.mode.pick'),
  };
  const modes = el('div', { class: 'radios pull-modes', role: 'radiogroup', 'aria-label': t('send.refs.mode', { table }) },
    PULL_MODES.map(value => el('label', { class: 'check' },
      el('input', { type: 'radio', name, value, checked: mode() === value, onchange: () => choose(value) }), el('span', {}, texts[value]))));
  const editor = filterEditor({ table, columns: usable, current: ctx.filters.get(table), labelOf: columnLabel, onChange: (filter) => { ctx.filters.set(table, filter); describe(); } });
  const filtered = Boolean(filterSummary(ctx.filters.get(table)));
  if (filtered) editor.load();
  drawColumns();
  describe();
  const slot = el('div', { class: 'ref-slot' });
  return {
    slot,
    node: el('div', { class: 'form table-block table-added', 'data-pulled': table },
      el('div', { class: 'added-head' }, el('h3', {}, table), el('span', { class: 'pill pill-ok' }, t('send.refs.added'))),
      el('p', { class: 'field-title' }, t('send.refs.mode', { table })), modes, summary, leftOut,
      el('div', { class: 'block-actions' }, togglePart(editor.node, t('send.rows.pick'), filtered, editor.load)),
      columns, editor.node, slot),
  };
}

function refRow(ctx, offer, onPick) {
  const id = `gristsync-ref-${offer.key}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const kind = t(offer.list ? 'type.RefList' : 'type.Ref');
  const choice = (link, labelKey) => {
    const slug = link ? 'keep' : 'text';
    const what = el('span', { class: 'what', id: `${id}-${slug}` }, t(labelKey));
    const why = el('span', { class: 'why', id: `${id}-${slug}-why` });
    const input = el('input', { type: 'radio', name: `gristsync-ref-${offer.key}`, checked: false, 'aria-labelledby': `${id}-${slug}`, 'aria-describedby': `${id}-${slug}-why`,
      onchange: () => { ctx.choices.set(offer.key, link); onPick(); } });
    return { input, why, node: el('label', { class: 'choice' }, input, what, why) };
  };
  const text = choice(false, 'send.refs.values');
  const keep = choice(true, 'send.refs.link');
  text.why.textContent = t('send.refs.note.values');
  const keepWhy = (now, by) => {
    const vars = { target: now.target, shown: now.shown, kind, by };
    if (!now.ok) return t(`send.refs.note.${now.why}`, vars);
    if (now.inside) return t('send.refs.note.inside', vars);
    return t(now.link && by ? 'send.refs.already' : 'send.refs.link.why', vars);
  };
  const update = (now, by = '') => {
    text.input.checked = !now.link;
    keep.input.checked = now.link;
    keep.input.disabled = !now.ok;
    keep.why.textContent = keepWhy(now, by);
  };
  update(offer);
  const panel = el('div', { class: 'ref-panel' });
  const name = `${offer.table}.${offer.label}`;
  return {
    update, panel,
    node: el('div', { class: 'ref-item', 'data-ref': offer.key },
      withHelp(el('div', { class: 'col' }, el('strong', {}, offer.label), el('span', { class: 'pill pill-off' }, kind),
        el('span', { class: 'muted small' }, t('send.refs.aim', { target: offer.target, shown: offer.shown || '—' }))), t('send.refs.help'), offer.label),
      el('div', { class: 'choices', role: 'radiogroup', 'aria-label': name }, text.node, keep.node), panel),
  };
}

function setChildren(parent, nodes) {
  const same = parent.children.length === nodes.length && nodes.every((node, i) => parent.children[i] === node);
  if (!same) parent.replaceChildren(...nodes);
}

function place(ctx, offers, rows, blocks) {
  const taken = new Map(); // table ajoutée -> colonne sous laquelle son panneau est posé
  const fill = (table, slot) => {
    const mine = offers.rows.filter(r => r.table === table);
    for (const r of mine) {
      const block = r.link && !r.inside ? blocks.get(r.target) : null;
      const first = block && !taken.has(r.target);
      if (first) taken.set(r.target, `${r.table}.${r.label}`);
      rows.get(r.key).update(r, block && !first ? taken.get(r.target) : '');
      setChildren(rows.get(r.key).panel, first ? [block.node] : []);
      if (first) fill(r.target, block.slot);
    }
    setChildren(slot, mine.map(r => rows.get(r.key).node));
  };
  for (const table of ctx.chosen) if (ctx.refSlots.has(table)) fill(table, ctx.refSlots.get(table));
}

function linkSection(ctx, schema, onTables) {
  if (ctx.exp?.echange) return false;
  const rows = new Map(); // refKey -> ligne (gardée d'un dessin à l'autre : le focus reste)
  const blocks = new Map(); // table ajoutée -> { sig, node, slot }
  function refresh() {
    const offers = offersOf(ctx, schema);
    for (const map of [ctx.extras, ctx.pulls]) for (const table of [...map.keys()]) if (!offers.pulled.has(table)) map.delete(table);
    for (const r of offers.rows) if (!rows.has(r.key)) rows.set(r.key, refRow(ctx, r, refresh));
    for (const table of [...blocks.keys()]) if (!offers.pulled.has(table)) blocks.delete(table);
    for (const [table, required] of offers.pulled) {
      const sig = JSON.stringify(required);
      if (blocks.get(table)?.sig !== sig) blocks.set(table, { sig, ...pulledBlock(ctx, schema, { table, required, onChange: refresh }) });
    }
    place(ctx, offers, rows, blocks);
    onTables([...ctx.chosen, ...offers.pulled.keys()]);
  }
  ctx.refresh = refresh;
  refresh();
  return true;
}
return { pulledColumns, offersOf, linkSection };
})();

// ===== js/tab-link.js =====
__M["js/tab-link.js"] = (() => {
'use strict';
const {cleanLabel} = __M["js/engine/logic/codes.js"];
const {HEX16} = __M["js/engine/logic/common.js"];

const CHANNEL = 'gristsync-link';
const APP = 'gristsync';
const PREFIX = 'GRISTSYNC2.';
const MAX_CODE = 400000; // un code porte les colonnes de toutes les tables : bien plus que le texte d'une invitation courante
const KINDS = ['offer', 'want', 'seen', 'reply', 'wantReply', 'got'];

const supported = () => typeof BroadcastChannel === 'function';

const text = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');

function peek(code) {
  const raw = code.replace(/\s+/g, '');
  if (!raw.startsWith(PREFIX)) return null;
  try {
    const binary = atob(raw.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0))));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch (e) {
    return null;
  }
}

const ID_KINDS = ['seen', 'wantReply', 'got'];
const CODE_KINDS = { offer: 'invitation', reply: 'reponse' }; // genre de message -> genre de code qu'il porte

function offerLabels(payload) {
  const from = payload.from && typeof payload.from === 'object' ? payload.from : {};
  return { name: cleanLabel(payload.name), docName: cleanLabel(from.docName), docId: text(from.docId) };
}

function parseCoded(data) {
  if (typeof data.code !== 'string' || data.code.length > MAX_CODE) return null;
  const payload = peek(data.code);
  if (!payload || payload.kind !== CODE_KINDS[data.k] || !HEX16.test(payload.id)) return null;
  return { k: data.k, id: payload.id, code: data.code.trim(), ...(data.k === 'offer' ? offerLabels(payload) : {}) };
}

function parseMessage(data) {
  if (!data || typeof data !== 'object' || data.app !== APP || !KINDS.includes(data.k)) return null;
  if (data.k === 'want') return { k: 'want' };
  if (ID_KINDS.includes(data.k)) return HEX16.test(data.id) ? { k: data.k, id: data.id } : null;
  return parseCoded(data);
}

function openLink(name) {
  let channel = null;
  const handlers = new Set();
  const open = () => {
    if (!channel && supported()) {
      channel = new BroadcastChannel(name);
      channel.onmessage = (event) => {
        const message = parseMessage(event.data);
        if (message) for (const handle of [...handlers]) handle(message);
      };
    }
    return channel;
  };
  return {
    open,
    post(message) {
      const live = open();
      if (!live) return false;
      try { live.postMessage({ app: APP, ...message }); return true; } catch (e) { return false; }
    },
    listen(handler, alive) {
      open();
      const handle = (message) => {
        if (!alive()) handlers.delete(handle);
        else handler(message);
      };
      handlers.add(handle);
      return () => handlers.delete(handle);
    },
    close() { handlers.clear(); if (channel) channel.close(); channel = null; },
  };
}

function sourceSide({ post, listen }) {
  return {
    offerInvitation(code, { alive = () => true, onSeen = () => {} } = {}) {
      const mine = parseMessage({ app: APP, k: 'offer', code });
      if (!mine || !supported()) return null;
      const stop = listen((m) => {
        if (m.k === 'want') post({ k: 'offer', code });
        else if (m.k === 'seen' && m.id === mine.id) onSeen();
      }, alive);
      post({ k: 'offer', code });
      return stop;
    },

    awaitReply(id, onReply, { alive = () => true } = {}) {
      if (!supported() || !HEX16.test(id)) return null;
      const stop = listen((m) => {
        if (m.k === 'reply' && m.id === id) {
          onReply(m.code);
          post({ k: 'got', id });
        }
      }, alive);
      post({ k: 'wantReply', id });
      return stop;
    },
  };
}

function targetSide({ post, listen }) {
  return {
    watchOffers(onOffer, { alive = () => true } = {}) {
      if (!supported()) return null;
      const stop = listen((m) => {
        if (m.k === 'offer' && onOffer(m)) post({ k: 'seen', id: m.id });
      }, alive);
      post({ k: 'want' });
      return stop;
    },
    acknowledge: id => HEX16.test(id) && post({ k: 'seen', id }),

    sendReply(code, { alive = () => true, onGot = () => {} } = {}) {
      const mine = parseMessage({ app: APP, k: 'reply', code });
      if (!mine || !supported()) return null;
      const stop = listen((m) => {
        if (m.k === 'wantReply' && m.id === mine.id) post({ k: 'reply', code });
        else if (m.k === 'got' && m.id === mine.id) onGot();
      }, alive);
      post({ k: 'reply', code });
      return stop;
    },
  };
}

function createLink(name = CHANNEL) {
  const link = openLink(name);
  return { supported, close: link.close, ...sourceSide(link), ...targetSide(link) };
}

let shared = null;
const tabLink = () => {
  shared ||= createLink();
  return shared;
};
return { supported, parseMessage, createLink, tabLink };
})();

// ===== js/tab-link-ui.js =====
__M["js/tab-link-ui.js"] = (() => {
'use strict';
const {tabLink} = __M["js/tab-link.js"];
const {el, icon, notice, smallButton} = __M["js/ui.js"];
const {docIdentity, isReadOnly} = __M["js/grist.js"];
const {t} = __M["js/i18n.js"];

const SILENT_MS = 3000; // sans nouvelle de l'autre onglet au bout de ce temps, le texte dit à quoi tient son silence

function tabSendBlock({ texts, start, auto = false }) {
  if (!tabLink().supported()) return null;
  const status = el('p', { class: 'muted small', role: 'status' });
  const block = el('div', { class: 'tab-link' });
  let stop = null;
  const go = () => {
    if (stop) stop();
    let acked = false;
    status.replaceChildren(texts.sent);
    stop = start(() => block.isConnected, () => { acked = true; status.replaceChildren(texts.done); });
    setTimeout(() => { if (!acked && block.isConnected) status.replaceChildren(texts.silent); }, SILENT_MS);
  };
  block.append(el('div', { class: 'handoff' }, el('button', { class: 'btn', type: 'button', onclick: go }, icon('send'), texts.button),
    auto ? null : el('span', { class: 'muted small' }, texts.help)), status); // envoyé d'office : le statut suffit
  if (auto) setTimeout(go, 0); // le temps que l'assistant affiche le bloc : un bloc hors de l'écran ne reçoit rien
  return block;
}

function startOfferNotice(host, open) {
  const link = tabLink();
  if (!link.supported()) return;
  const ignored = new Set();
  const clear = () => host.replaceChildren();
  const show = (offer) => {
    const use = async () => { if ((await open(offer.code)) !== false) clear(); };
    const ignore = () => { ignored.add(offer.id); clear(); };
    host.replaceChildren(notice({
      tone: 'info', title: t('tab.in.title'), 'data-offer': offer.id,
      lines: [t('tab.in.line', { name: offer.name || '—' }), offer.docName ? t('tab.in.doc', { doc: offer.docName }) : null, t('tab.in.check')],
      actions: [smallButton(t('tab.in.use'), 'plus', use, { kind: 'btn-primary' }), smallButton(t('tab.in.ignore'), 'ignore', ignore)],
    }));
  };
  link.watchOffers((offer) => {
    if (isReadOnly() || ignored.has(offer.id)) return false;
    docIdentity().then(({ docId }) => {
      if (offer.docId && offer.docId === docId) return; // l'invitation vient de ce document : un autre onglet du même document
      show(offer);
      link.acknowledge(offer.id);
    }).catch(() => {});
    return false; // « vue » n'est dit qu'une fois l'avis affiché (acknowledge)
  });
}
return { tabSendBlock, startOfferNotice };
})();

// ===== js/source/recipient-wizard.js =====
__M["js/source/recipient-wizard.js"] = (() => {
'use strict';
const {nowS} = __M["js/engine/logic/common.js"];
const {docUrl, maskKey} = __M["js/engine/logic/codes.js"];
const {docIdentity} = __M["js/grist.js"];
const {VERSION} = __M["js/config.js"];
const {ensureForm} = __M["js/engine/pages.js"];
const {formWhere, linkFigures} = __M["js/form-link.js"];
const {cancelPendingInvitation} = __M["js/engine/source/actions.js"];
const {rememberDocName, sourceDocName} = __M["js/engine/source/synchro.js"];
const {approveReply, checkReply, controlResend, enablePublicLink, invitationCode, invitationState, linkReturn, loadPlan, renewInvitation, sendExisting, startInvitation, startReturn} = __M["js/engine/source/invite.js"];
const {docNameField} = __M["js/source/doc-name.js"];
const {estimateLines, progressTo} = __M["js/source/flow.js"];
const {backButton, cancelButton, closeButtons, codeField, confirmDialog, controlLine, copyField, docLink, el, laterButton, message, openWizard, run, withHelp, versionNote} = __M["js/ui.js"];
const {handoffButton, roleGuide} = __M["js/guide.js"];
const {tabLink} = __M["js/tab-link.js"];
const {tabSendBlock} = __M["js/tab-link-ui.js"];
const {dateText, t} = __M["js/i18n.js"];

const STEP = { options: 0, invitation: 1, reply: 2, load: 3 };
const later = laterButton();
const back = backButton;

const at = (ctx, step) => (ctx.renf ? step - 1 : step);

async function recipientWizard(exp, pending, onClose, started = null) {
  const expired = pending && invitationState(pending) === 'expired';
  if (expired && !(await confirmNewCode())) return null;
  const renf = Boolean((started || pending || {}).replaces || ((started || {}).entry || {}).replaces);
  const keys = renf ? ['send.step.invitation', 'send.step.reply', 'send.renf.step.control'] : ['send.step.options', 'send.step.invitation', 'send.step.reply', 'send.step.load'];
  const steps = keys.map(k => t(k));
  const title = renf ? t('send.renf.title', { name: exp.name }) : t('send.person.title', { name: exp.name });
  const ctx = { exp, steps, onClose, renf, codes: new Map(), wizard: openWizard({ title, steps, onClose }) };
  return ctx.wizard.start(() => {
    if (started) return showInvitation(ctx, started.entry, started.secret);
    if (!pending) return showOptions(ctx);
    if (pending.journal && !pending.ready) return showBack(ctx, pending);
    return expired ? renew(ctx, pending) : showReply(ctx, pending);
  });
}

async function showOptions(ctx) {
  const { exp } = ctx;
  const docName = await docNameField(await sourceDocName());
  const more = (exp.echange && !exp.retour) || exp.invitations.some(inv => inv.journal);
  const strongBox = el('input', { type: 'checkbox', checked: Boolean(exp.renforce) });
  const strongPart = el('div', { class: 'form' }, withHelp(el('label', { class: 'check' }, strongBox, t('send.renforce')), t('send.renforce.help'), t('send.renforce')));
  const parts = {
    public: el('div', { class: 'hidden' }, message('err', t('send.public.columns', { list: publicList(exp) })), message('warn', t('send.public.warn'))),
    echange: el('div', { class: more ? '' : 'hidden' }, message('info', t(more ? 'send.mode.echange.moreHelp' : 'send.mode.echange.help'))),
  };
  const report = el('div', { class: 'report' });
  const mode = () => (document.querySelector('input[name="gristsync-mode"]:checked') || {}).value;
  ctx.wizard.show(STEP.options, [
    el('p', { class: 'muted small' }, t('send.person.tables', { tables: exp.tables.map(tb => tb.table).join(', ') })),
    el('p', { class: 'field-title', id: 'gristsync-mode-title' }, t('send.mode')),
    modeChoices(exp, { more, strongBox, parts }),
    strongPart, docName.node, parts.public, parts.echange, report, roleGuide({ you: 'source', current: 0 }),
  ], [cancelButton(), { label: t('send.invite'), kind: 'btn-primary', onClick: () => run(null, report, async () => {
    await rememberDocName(docName.value());
    return invite(ctx, mode(), mode() !== 'public' && strongBox.checked);
  }) }]);
}

function modeChoices(exp, { more, strongBox, parts }) {
  const radio = (value, label, checked, disabled, help) => withHelp(el('label', { class: 'check' },
    el('input', { type: 'radio', name: 'gristsync-mode', value, checked, disabled, onchange: () => {
      strongBox.disabled = value === 'public';
      for (const [key, part] of Object.entries(parts)) part.classList.toggle('hidden', value !== key);
    } }), label), help, label);
  const exchangeOk = more || (!exp.recipients.length && !exp.invitations.length && !exp.public);
  return el('div', { class: 'form', role: 'radiogroup', 'aria-labelledby': 'gristsync-mode-title' },
    radio('reponse', t('send.mode.reply'), !more, more, t('send.mode.reply.help')),
    el('p', { class: 'muted small' }, t('send.mode.others')),
    radio('echange', more ? t('send.mode.echange.more') : t('send.mode.echange'), more, !exchangeOk,
      t(more ? 'send.mode.echange.more.help' : exchangeOk ? 'send.mode.echange.what' : 'send.mode.echange.off')),
    radio('public', exp.public ? t('send.mode.publicDone') : t('send.mode.public'), false, exp.public || more || exp.renforce,
      t(exp.public ? 'send.mode.publicDone.help' : exp.renforce ? 'send.mode.publicStrong' : more ? 'send.mode.public.off' : 'send.mode.public.help')));
}

const publicList = exp => exp.tables.map(tb => `${tb.table} (${tb.columns.map(c => c.id).join(', ')})`).join(' ; ');

async function invite(ctx, mode, renforce) {
  if (mode === 'public') return invitePublic(ctx);
  if (mode === 'echange') return openBack(ctx, renforce);
  const { exp, entry, secret } = await startInvitation(ctx.exp, { renforce });
  ctx.exp = exp;
  return showInvitation(ctx, entry, secret);
}

async function invitePublic({ exp, wizard, steps }) {
  const code = await enablePublicLink(exp);
  wizard.setSteps(steps.slice(0, 2));
  wizard.show(STEP.invitation, [el('p', {}, t('send.public.help')), copyField(code), handoffButton('target', 'public', 1, code), inviteOnTab(code),
    message('warn', t('send.public.turnOn')), roleGuide({ you: 'source', mode: 'public', current: 1 })], closeButtons());
}

const inviteOnTab = code => tabSendBlock({
  texts: { button: t('tab.out.button'), help: t('tab.out.help'), sent: t('tab.out.sent'), done: t('tab.out.seen'), silent: t('tab.out.silent') },
  start: (alive, ack) => tabLink().offerInvitation(code, { alive, onSeen: ack }),
});

async function showInvitation(ctx, entry, secret, retour = '') {
  const mode = retour ? 'echange' : 'reponse';
  const { code, expire, backCode: control } = await invitationCode(ctx.exp, entry, secret, retour);
  ctx.codes.set(entry.id, { secret, retour });
  const report = el('div', { class: 'report' });
  const backCode = control ? controlLine(t('send.invite.backCode'), control) : null;
  const onTab = inviteOnTab(code);
  ctx.wizard.show(at(ctx, STEP.invitation), [ctx.renf ? message('info', t('send.renf.invite')) : null, el('p', {}, t('send.invite.help')), codeField(code),
    el('p', { class: 'muted small' }, t('send.invite.until', { at: dateText(expire * 1000) })), backCode, handoffButton('target', mode, 1, code), onTab, report,
    roleGuide({ you: 'source', mode, current: 1 })],
  [ctx.renf ? cancelButton() : back(() => run(null, report, () => backToOptions(ctx, entry))), later, { label: t('send.reply.ready'), kind: 'btn-primary', onClick: () => showReply(ctx, entry) }]);
  if (onTab) tabLink().awaitReply(entry.id, reply => showReply(ctx, entry, reply), { alive: () => report.isConnected });
}

async function backToOptions(ctx, inv) {
  if (!(await confirmDialog({ title: t('send.backOptions.title'), body: t('send.backOptions.body'), confirmLabel: t('common.back') }))) return;
  await cancelPendingInvitation(inv);
  await showOptions(ctx);
}

async function backToInvitation(ctx, inv) {
  const kept = ctx.codes.get(inv.id);
  if (kept && invitationState(inv) !== 'expired') return showInvitation(ctx, inv, kept.secret, kept.retour);
  if (!(await confirmNewCode())) return null;
  return renew(ctx, inv);
}

const confirmNewCode = () => confirmDialog({ title: t('send.newCode.title'), body: t('send.newCode.body'), confirmLabel: t('send.newCode.ok') });

async function renew(ctx, inv) {
  if (inv.journal) return showBack(ctx, inv);
  const { entry, secret } = await renewInvitation(inv);
  return showInvitation(ctx, entry, secret);
}

async function openBack(ctx, renforce) {
  const { exp, entry } = await startReturn(ctx.exp, { renforce });
  ctx.exp = exp;
  return showBack(ctx, entry);
}

async function showBack(ctx, inv) {
  await ensureForm(inv.journal);
  const input = el('input', { type: 'url', class: 'input', spellcheck: 'false', 'aria-label': t('send.back.title') });
  const report = el('div', { class: 'report' });
  const check = async () => {
    const { entry, secret, retour } = await linkReturn(inv, input.value);
    await showInvitation(ctx, entry, secret, retour);
  };
  ctx.wizard.show(STEP.invitation, [el('p', {}, t('send.back.help', { where: await formWhere(inv.journal) })), ...linkFigures(), input, report,
    roleGuide({ you: 'source', mode: 'echange', current: 0 })],
  [back(() => run(null, report, () => backToOptions(ctx, inv))), later, { label: t('recv.link.check'), kind: 'btn-primary', onClick: () => run(null, report, check) }]);
}

function showReply(ctx, inv, arrived = '') {
  const area = el('textarea', { class: 'code', rows: 4, spellcheck: 'false', 'aria-label': t('send.reply.title') });
  const fiche = el('div');
  const report = el('div', { class: 'report' });
  const tabLine = tabLink().supported() ? el('p', { class: 'muted small', role: 'status' }, t('tab.reply.wait')) : null;
  const body = [el('p', {}, t('send.reply.help')), area, tabLine, fiche, report, roleGuide({ you: 'source', current: 3 })];
  const check = async () => {
    const reply = await checkReply(ctx.exp, inv, area.value);
    const compared = el('input', { type: 'checkbox' });
    const identity = await docIdentity();
    fiche.replaceChildren(...replyFiche(reply, identity),
      ...(inv.renforce ? [el('label', { class: 'check' }, compared, t('send.reply.compared'))] : []));
    const go = () => approve(ctx, inv, reply, compared.checked); // le moteur refuse sans elle en sécurité renforcée
    ctx.wizard.show(at(ctx, STEP.reply), body, [toInvitation, later, { label: t('send.reply.approve'), kind: 'btn-primary', onClick: () => run(null, report, go) }]);
  };
  const toInvitation = back(() => run(null, report, () => backToInvitation(ctx, inv)));
  if (invitationState(inv) === 'expired') report.replaceChildren(message('warn', t('send.invite.expired')));
  ctx.wizard.show(at(ctx, STEP.reply), body, [toInvitation, later, { label: t('send.reply.check'), kind: 'btn-primary', onClick: () => run(null, report, check) }]);
  let taken = '';
  const take = (code) => {
    if (area.value === code) return; // la même réponse redite par l'autre onglet
    if (taken) { tabLine.replaceChildren(t('tab.reply.other')); return; }
    taken = code;
    area.value = code;
    tabLine.replaceChildren(t('tab.reply.got'));
    run(null, report, check);
  };
  if (tabLine) tabLink().awaitReply(inv.id, take, { alive: () => area.isConnected });
  if (arrived) take(arrived);
}

const replyDate = (at) => {
  const ms = Date.parse(`${String(at).replace(' ', 'T')}:00Z`);
  return Number.isNaN(ms) ? at : dateText(ms);
};

function replyFiche(reply, { docId, origin }) {
  const r = reply.recipient;
  const { share } = reply;
  const place = ` (${share.folder || '—'}${share.personal ? '' : ` · ${share.teamName || share.team}`})`;
  const doc = [docLink(share.name, docUrl(origin, share.team, share.docId, share.name), t('common.docChecked')), place];
  const fiche = [[t('send.reply.tables'), reply.tables], [t('send.reply.doc'), r.docId === docId ? [...doc, ` · ${t('send.reply.sameDoc')}`] : doc],
    [t('send.reply.team'), share.personal ? t('send.reply.personalSpace') : share.teamName || share.team], [t('send.reply.email'), r.email], [t('send.reply.at'), replyDate(r.at)]];
  return [el('dl', { class: 'fiche' }, fiche.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v || '—')])),
    el('p', { class: 'muted small' }, t('send.reply.verified')),
    share.personal ? message('warn', t('send.reply.personal')) : null,
    reply.secret ? null : message('warn', t('send.reply.nosecret')),
    versionNote(reply.version, VERSION),
    controlLine(t('send.reply.code'), reply.code),
    el('p', { class: 'muted small' }, maskKey(reply.url))].filter(Boolean);
}

async function approve(ctx, inv, reply, compared) {
  await approveReply(ctx.exp, inv, reply, { compared });
  await (ctx.renf ? showControl(ctx, inv) : showLoad(ctx));
}

async function showControl({ exp, wizard, onClose }, inv) {
  const report = el('div', { class: 'report' });
  wizard.show(2, [message('ok', t('send.renf.connected')), el('p', {}, t('send.renf.control')), report, el('p', { class: 'muted small' }, t('send.load.background'))], closeButtons());
  report.replaceChildren(message('info', t('send.load.start')));
  await run(null, report, async () => {
    const n = await controlResend(exp, inv, progressTo(report));
    if (!report.isConnected) return onClose && onClose();
    return wizard.show(3, n === null ? message('info', t('send.load.queued')) : message('ok', t('send.renf.done', { n })), closeButtons());
  });
  return null;
}

async function showLoad({ exp, wizard, onClose }) {
  const { total, est, count } = await loadPlan(exp);
  const report = el('div', { class: 'report' });
  if (!total) {
    wizard.show(STEP.load, [message('ok', t('send.connected')), el('p', {}, t('send.load.empty'))], closeButtons());
    return;
  }
  const send = async () => {
    wizard.show(STEP.load, [message('ok', t('send.connected')), report, el('p', { class: 'muted small' }, t('send.load.background'))], closeButtons());
    report.replaceChildren(message('info', t('send.load.start')));
    const n = await sendExisting(exp, progressTo(report));
    if (!report.isConnected) return onClose && onClose();
    return wizard.show(STEP.load + 1, n === null ? message('info', t('send.load.queued')) : message('ok', t('send.done', { n })), closeButtons());
  };
  const intro = count ? [el('p', {}, t('send.load.body', { n: count })), ...(est ? estimateLines(est) : [])]
    : [message('warn', t('send.load.nothing', { n: total }))];
  wizard.show(STEP.load, [message('ok', t('send.connected')), ...intro, report],
    [later, { label: t('send.load.ok'), kind: 'btn-primary', onClick: () => run(null, report, send) }]);
}
return { recipientWizard };
})();

// ===== js/source/export-wizard.js =====
__M["js/source/export-wizard.js"] = (() => {
'use strict';
const {isUserTable} = __M["js/engine/logic/common.js"];
const {ownsSync} = __M["js/engine/logic/strays.js"];
const {elementCounts, exportableColumns, isFileColumn, unsentColumns} = __M["js/engine/logic/exports.js"];
const {noteSent} = __M["js/engine/logic/descriptions.js"];
const {formulasOffered} = __M["js/engine/logic/column-formulas.js"];
const {layoutSent} = __M["js/engine/logic/layout.js"];
const {refKey, refOf} = __M["js/engine/logic/links.js"];
const {REFUSALS, RULES, exchangeRules} = __M["js/engine/logic/consolidation.js"];
const {missingSyncColumns} = __M["js/engine/logic/formulas.js"];
const {STATES} = __M["js/engine/logic/journal.js"];
const {fetchRows, readSchema} = __M["js/grist.js"];
const {finishEdit, saveChosenExport} = __M["js/engine/source/export.js"];
const {receivedDests} = __M["js/engine/logic/received.js"];
const {recipientWizard} = __M["js/source/recipient-wizard.js"];
const {progressTo} = __M["js/source/flow.js"];
const {backButton, cancelButton, checkList, closeButtons, confirmDialog, el, laterButton, message, notice, openWizard, pickField, run, withHelp} = __M["js/ui.js"];
const {filterEditor, filterSummary} = __M["js/source/filter-editor.js"];
const {columnLabel, togglePart} = __M["js/source/export-parts.js"];
const {linkSection, offersOf, pulledColumns} = __M["js/source/export-links.js"];
const {roleGuide} = __M["js/guide.js"];
const {t, typeName} = __M["js/i18n.js"];

const cancel = cancelButton();

function exportWizard(exp, onClose) {
  const ctx = {
    exp, onClose,
    chosen: exp ? exp.tables.map(tb => tb.table) : [],
    selected: new Map(exp ? exp.tables.map(tb => [tb.table, tb.columns.map(c => c.id)]) : []), // table -> colonnes cochées
    filters: new Map(exp ? exp.tables.map(tb => [tb.table, tb.filter]) : []), // table -> filtre de lignes, ou null
    choices: new Map(), // colonne Référence (refKey) -> garder son lien ? (choix fait dans cette fenêtre)
    extras: new Map(), // table ajoutée pour un lien -> colonnes cochées en plus de celle que le lien affiche (choix « Choisir les colonnes »)
    pulls: new Map(), // table ajoutée pour un lien -> ce qu'elle envoie : 'shown' (d'emblée), 'all' ou 'pick' (voir pull.js)
    saved: savedLinks(exp), // refKey -> la colonne de l'export enregistré gardait son lien
  };
  ctx.wizard = openWizard({
    title: exp ? t('send.edit.title', { name: exp.name }) : t('send.new'),
    steps: ['send.step.tables', 'send.step.content', 'send.step.name'].map(k => t(k)),
    onClose,
    guard: { save: exp ? () => quickSave(ctx) : null },
  });
  ctx.wizard.start(() => showTables(ctx));
}

const savedLinks = exp => (exp && !exp.echange
  ? new Map(exp.tables.flatMap(tb => tb.columns.filter(c => refOf(c)).map(c => [refKey(tb.table, c.id), Boolean(c.link)]))) : null);

async function showTables(ctx) {
  const tables = (await readSchema()).tableIds.filter(isUserTable);
  ctx.chosen = ctx.chosen.filter(table => tables.includes(table));
  const report = ctx.report = el('div', { class: 'report' });
  const next = { label: t('common.next'), kind: 'btn-primary', disabled: !ctx.chosen.length, onClick: () => run(null, report, () => showColumns(ctx)) };
  const list = checkList({
    items: tables.map(id => ({ value: id, label: id })), checked: ctx.chosen, label: t('send.step.tables'),
    onChange: (values) => {
      for (const table of values.filter(v => !ctx.chosen.includes(v))) for (const map of [ctx.extras, ctx.pulls, ctx.selected, ctx.filters]) map.delete(table);
      ctx.chosen = values; next.disabled = !values.length; ctx.wizard.buttons([cancel, next]);
    },
  });
  ctx.wizard.show(0, [el('p', {}, t(ctx.exp ? 'send.edit.tables' : 'send.tables.help')), list, report, ctx.exp ? null : roleGuide({ you: 'source', current: 0 })], [cancel, next]);
}

function columnsBlock(ctx, schema, table, relayed) {
  const usable = exportableColumns(schema.columns(table));
  if (!ctx.selected.has(table)) ctx.selected.set(table, usable.filter(c => !isFileColumn(c)).map(c => c.id));
  const files = usable.filter(isFileColumn).map(c => c.label);
  const unsent = unsentColumns(schema.columns(table)).map(c => `${c.label} · ${typeName(c.type)}`);
  const summary = el('p', { class: 'small' });
  const describe = () => {
    const n = ctx.selected.get(table).length;
    const filter = ctx.filters.get(table);
    const rows = filterSummary(filter);
    summary.textContent = `${n === usable.length ? t('send.columns.all', { n }) : t('send.columns.some', { n, total: usable.length })} · ${
      rows ? t('send.rows.filtered', { filter: rows }) : t('send.rows.all')}`;
  };
  const columns = el('div', { class: 'form' },
    checkList({ items: usable.map(c => ({ value: c.id, label: columnLabel(c), hint: typeName(c.source), keywords: typeName(c.source) })), wide: true,
      checked: ctx.selected.get(table), label: table, onChange: (values) => { ctx.selected.set(table, values); describe(); if (ctx.refresh) ctx.refresh(); } }),
    files.length ? el('p', { class: 'muted small' }, t('send.columns.files', { cols: files.join(', ') })) : null);
  const editor = filterEditor({
    table, columns: usable, current: ctx.filters.get(table), labelOf: columnLabel,
    onChange: (filter) => { ctx.filters.set(table, filter); describe(); },
  });
  const filtered = Boolean(filterSummary(ctx.filters.get(table)));
  if (filtered) editor.load();
  describe();
  const refs = el('div', { class: 'ref-slot' }); // les colonnes Référence de la table (voir export-links.js)
  ctx.refSlots.set(table, refs);
  return el('div', { class: 'form table-block' }, el('h3', {}, table),
    relayed ? message('info', t('send.columns.relay')) : null, summary,
    unsent.length ? message('info', t('send.columns.unsent', { cols: unsent.join(', ') })) : null,
    el('div', { class: 'block-actions' },
      togglePart(columns, t('send.columns.pick'), ctx.selected.get(table).length !== usable.length),
      togglePart(editor.node, t('send.rows.pick'), filtered, editor.load)),
    columns, editor.node, refs);
}

function autoColsBlock(ctx) {
  if (ctx.exp?.echange) {
    ctx.autoCols = false;
    return null;
  }
  if (ctx.autoCols === undefined) ctx.autoCols = Boolean(ctx.exp?.autoCols);
  const box = el('input', { type: 'checkbox', checked: ctx.autoCols, onchange: () => { ctx.autoCols = box.checked; } });
  return el('div', { class: 'opts auto-cols' }, withHelp(el('label', { class: 'check' }, box, t('send.autoCols')), t('send.autoCols.help'), t('send.autoCols')));
}

const ELEMENTS = [['style', 'send.el.style', 'send.el.style.count'], ['notes', 'send.el.notes', 'send.el.notes.count'], ['tableNote', 'send.el.tableNote', 'send.el.tableNote.count'], ['layout', 'send.el.layout', 'send.el.layout.count']];
async function elementsBlock(ctx, schema) {
  if (ctx.exp?.echange) {
    ctx.elements = { style: false, notes: false, tableNote: false, layout: false, formulas: false };
    return null;
  }
  if (!ctx.elements) {
    const sent = ctx.exp ? noteSent(ctx.exp.tables.flatMap(tb => tb.columns)) : null;
    ctx.elements = ctx.exp
      ? { style: ctx.exp.tables.some(tb => tb.columns.some(c => c.fmt)), notes: sent.notes, tableNote: sent.table, layout: layoutSent(ctx.exp.tables.flatMap(tb => tb.columns)), formulas: formulasOffered(ctx.exp.tables.flatMap(tb => tb.columns)) }
      : { style: false, notes: false, tableNote: false, layout: false, formulas: false };
  }
  const counts = elementCounts(schema, ctx.chosen, await fetchRows('_grist_Views_section'));
  const boxes = ELEMENTS.map(([key, name, count]) => {
    const box = el('input', { type: 'checkbox', checked: ctx.elements[key], onchange: () => { ctx.elements[key] = box.checked; } });
    return withHelp(el('label', { class: 'check' }, box, t(name), el('span', { class: 'muted small' }, ` · ${t(count, { n: counts[key] })}`)), t(`${name}.help`), t(name));
  });
  return el('div', { class: 'opts' }, ...boxes, formulasBox(ctx, counts.formulas));
}

function formulasBox(ctx, count) {
  const box = el('input', {
    type: 'checkbox', checked: ctx.elements.formulas, disabled: !count && !ctx.elements.formulas,
    onchange: async () => {
      if (box.checked && !(await formulasWarning())) box.checked = false;
      ctx.elements.formulas = box.checked;
    },
  });
  return el('div', { class: 'form formulas-box' },
    withHelp(el('label', { class: 'check' }, box, t('send.el.formulas'), el('span', { class: 'muted small' }, ` · ${t('send.el.formulas.count', { n: count })}`),
      el('span', { class: 'pill pill-pending badge' }, t('send.el.formulas.badge'))), t('send.el.formulas.help'), t('send.el.formulas')));
}

const formulasWarning = () => confirmDialog({
  title: t('send.formulas.title'), confirmLabel: t('send.formulas.confirm'), kind: 'btn-primary',
  body: [el('p', {}, t('send.formulas.intro')), el('ul', {}, ['own', 'run', 'refused', 'initial', 'sandbox', 'slow'].map(k => el('li', {}, t(`send.formulas.${k}`))))],
});

const section = (title, sub, nodes) => el('section', { class: 'sec' },
  el('div', {}, el('h3', { class: 'sec-title' }, t(title)), sub ? el('p', { class: 'sec-sub' }, t(sub)) : null), ...nodes);

function stepIntro() {
  return [el('div', { class: 'step-intro' }, el('p', {}, t('send.columns.help')))];
}

async function showColumns(ctx) {
  const schema = await readSchema();
  const relays = receivedDests(schema).map(d => d.dest);
  const report = ctx.report = el('div', { class: 'report' });
  ctx.refresh = null;
  ctx.refSlots = new Map(); // table de l'export -> emplacement de ses colonnes Référence, dans sa fiche
  const blocks = ctx.chosen.map(table => columnsBlock(ctx, schema, table, relays.includes(table)));
  const addsNode = el('p', { class: 'muted small' });
  const showAdds = (tables) => {
    const adds = tables.flatMap(table => missingSyncColumns(schema.columns(table)).map(col => `${table}.${col}`));
    if (!ownsSync(schema)) adds.push(t('send.check.sync'));
    addsNode.textContent = adds.length ? t('send.check.missing', { items: adds.join(', ') }) : '';
    addsNode.classList.toggle('hidden', !adds.length);
  };
  if (!linkSection(ctx, schema, showAdds)) showAdds(ctx.chosen);
  const removed = ctx.exp ? ctx.exp.tables.map(tb => tb.table).filter(table => !ctx.chosen.includes(table)) : [];
  const elementsNode = await elementsBlock(ctx, schema);
  const next = () => {
    if (ctx.chosen.some(table => !(ctx.selected.get(table) || []).length)) throw new Error('noColumn');
    showName(ctx);
  };
  const auto = autoColsBlock(ctx);
  const dataBlocks = [removed.length ? message('warn', t('send.edit.removed', { tables: removed.join(', ') })) : null, ...blocks];
  const sections = elementsNode ? [section('send.sec.data', 'send.sec.data.sub', dataBlocks), section('send.sec.with', 'send.sec.with.sub', [elementsNode]),
    section('send.sec.next', null, [auto])] : dataBlocks;
  ctx.wizard.show(1, [...stepIntro(), ...sections, addsNode, report], [
    backButton(() => showTables(ctx)), cancel,
    { label: t('common.next'), kind: 'btn-primary', onClick: () => run(null, report, next) }]);
}

function rulesBlock(ctx) {
  const rules = exchangeRules(ctx.exp) || { ajout: RULES[0], modif: RULES[0], suppression: RULES[0], refus: REFUSALS[0] };
  ctx.rules = { ...rules, ...ctx.rules };
  const refusal = el('div', { class: 'form', role: 'radiogroup', 'aria-labelledby': 'gristsync-refusal-title' },
    withHelp(el('p', { class: 'field-title', id: 'gristsync-refusal-title' }, t('send.refusal.title')), t('send.refusal.help')),
    REFUSALS.map(value => el('label', { class: 'check' },
      el('input', { type: 'radio', name: 'gristsync-refusal', value, checked: ctx.rules.refus === value, onchange: () => { ctx.rules.refus = value; } }),
      t(`send.refusal.${value}`))));
  const showRefusal = () => refusal.classList.toggle('hidden', STATES.every(st => ctx.rules[st] === RULES[0]));
  const pickers = el('div', { class: 'rules-grid' }, STATES.map(st => [el('span', {}, t(`send.rules.${st}`)), pickField({
    items: RULES.map(value => ({ value, label: t(`send.rules.${value}`) })), value: ctx.rules[st], label: t(`send.rules.${st}`),
    onChange: (value) => { ctx.rules[st] = value; showRefusal(); },
  })]));
  showRefusal();
  return el('div', { class: 'form table-block' }, withHelp(el('h3', {}, t('send.rules.title')), t('send.rules.help')), pickers, refusal);
}

function showName(ctx) {
  const fallback = ctx.chosen.join(' + ');
  const nameInput = ctx.nameInput = el('input', { type: 'text', class: 'input', id: 'gristsync-export-name', value: ctx.exp ? ctx.exp.name : fallback });
  const report = ctx.report = el('div', { class: 'report' });
  const hub = ctx.exp && ctx.exp.echange && !ctx.exp.retour;
  ctx.wizard.show(2, [el('label', { for: 'gristsync-export-name' }, t('send.name')), nameInput, el('p', { class: 'muted small' }, t('send.name.help')),
    hub ? rulesBlock(ctx) : null, report], [
    backButton(() => run(null, report, () => showColumns(ctx))), cancel,
    { label: ctx.exp ? t('common.save') : t('send.create'), kind: 'btn-primary', onClick: () => run(null, report, () => save(ctx, nameInput.value.trim() || fallback, report)) }]);
}

async function choicesOf(ctx) {
  const schema = await readSchema();
  const offers = ctx.exp?.echange ? null : offersOf(ctx, schema);
  const added = offers ? [...offers.pulled].map(([table, required]) => ({ table, columns: pulledColumns(ctx, schema, table, required), filter: ctx.filters.get(table) || null })) : [];
  const explicit = ctx.chosen.map(table => ({ table, columns: ctx.selected.get(table), filter: ctx.filters.get(table) || null }));
  return { selection: [...explicit, ...added], links: new Set(offers ? offers.rows.filter(r => r.link).map(r => r.key) : []) };
}

async function quickSave(ctx) {
  await run(null, ctx.report, async () => {
    if (!ctx.elements) await showColumns(ctx);
    if (!ctx.chosen.length || ctx.chosen.some(table => !(ctx.selected.get(table) || []).length)) throw new Error('noColumn');
    await save(ctx, (ctx.nameInput && ctx.nameInput.value.trim()) || ctx.exp.name, ctx.report);
  });
}

async function save(ctx, name, report) {
  const { exp } = ctx;
  const { selection, links } = await choicesOf(ctx);
  const saved = await saveChosenExport({ exp, name, selection, links, ...ctx.elements, rules: ctx.rules, autoCols: Boolean(ctx.autoCols) });
  ctx.wizard.clean(); // enregistré : plus rien à perdre en fermant
  return exp ? showEdited(ctx, { name, changed: saved.changed, report }) : showCreated(ctx, { name, created: saved.created });
}

async function showCreated({ wizard, onClose }, { name, created }) {
  wizard.show(3, [message('ok', t('send.created', { name })), el('p', {}, t('send.created.next'))], [
    laterButton(),
    { label: t('send.action.addPerson'), kind: 'btn-primary', onClick: () => { wizard.close(); recipientWizard(created, null, onClose); } }]);
}

async function showEdited({ exp, wizard, onClose }, { name, changed, report }) {
  if (changed.length) wizard.show(3, [report, el('p', { class: 'muted small' }, t('send.load.background'))], closeButtons());
  const n = await finishEdit(exp, { name, changed }, progressTo(report));
  if (changed.length && !report.isConnected) return onClose && onClose();
  const saved = n === null ? message('info', t('send.load.queued')) : message('ok', n ? t('send.edit.saved', { n }) : t('send.edit.savedNone'));
  return wizard.show(3, saved, closeButtons());
}
return { exportWizard };
})();

// ===== js/source/keys.js =====
__M["js/source/keys.js"] = (() => {
'use strict';
const {repairKeys} = __M["js/engine/source/keys.js"];
const {confirmDialog, el, notice, run, smallButton} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

function keysBlock(problems, onDone, { ownerOnly = false } = {}) {
  const out = el('div', { class: 'report' });
  const repair = smallButton(t('send.keys.repair'), 'edit', event => run(event.currentTarget, out, async () => {
    const lost = [...problems.values()].some(c => c.missing.length);
    const body = [lost ? t('send.keys.dialog.missing') : '', total(problems) ? t('send.keys.dialog.body', { n: total(problems) }) : ''].filter(Boolean).join(' ');
    if (!(await confirmDialog({ title: t('send.keys.dialog.title'), body, confirmLabel: t('send.keys.repair') }))) return;
    for (const table of problems.keys()) await repairKeys(table);
    await onDone();
  }), { kind: 'btn-primary', disabled: ownerOnly });
  const box = notice({
    tone: 'warn', title: t('send.keys.title'), lines: [t('send.keys.help')], 'data-keys': '',
    body: el('ul', { class: 'small' }, [...problems].flatMap(([table, c]) => [
      c.missing.length ? el('li', {}, t('send.keys.missing', { table, cols: c.missing.join(', '), n: c.missing.length })) : null,
      c.blank || c.dup ? el('li', {}, t('send.keys.line', { table, blank: c.blank, dup: c.dup })) : null,
    ].filter(Boolean))),
    actions: [repair],
  });
  box.append(out);
  return box;
}

const total = problems => [...problems.values()].reduce((n, c) => n + c.blank + c.dup, 0);
return { keysBlock };
})();

// ===== js/source/last-send.js =====
__M["js/source/last-send.js"] = (() => {
'use strict';

const deliveredAt = h => {
  const at = Number(((h || {}).usage || {}).lastSuccessTime);
  return Number.isFinite(at) && at > 0 && at < 4e12 ? at : 0;
};

function lastSend(recipients) {
  const list = Array.isArray(recipients) ? recipients : [];
  let best = null;
  let n = 0;
  for (const hook of list) {
    const at = deliveredAt(hook);
    if (!at) continue;
    n += 1;
    if (!best || at > best.at) best = { at, hook };
  }
  return best && { ...best, n, of: list.length };
}
return { lastSend };
})();

// ===== js/source/new-columns.js =====
__M["js/source/new-columns.js"] = (() => {
'use strict';
const {el, message, notice} = __M["js/ui.js"];
const {t, typeName} = __M["js/i18n.js"];

function driftLine(d) {
  const vars = { table: d.table, col: d.id, to: d.to || '', was: d.was ? typeName(d.was) : '', now: d.now ? typeName(d.now) : '' };
  const key = { gone: d.to ? 'send.drift.renamed' : 'send.drift.gone', retyped: 'send.drift.retyped', shown: 'send.drift.shown' }[d.kind];
  return key ? t(key, vars) : '';
}

function driftNotice(exp) {
  if (!exp.details.length) return exp.changed.length ? message('warn', t('send.export.drift', { cols: exp.changed.join(', ') })) : null;
  return notice({
    tone: 'warn', title: t('send.drift.title', { n: exp.details.length }), lines: [t('send.drift.body')], className: 'drift', 'data-drift': exp.id,
    body: [el('ul', { class: 'small' }, ...exp.details.map(d => el('li', {}, driftLine(d))))],
  });
}

function newColumnsNotice(exp, actions) {
  if (!exp.fresh.length) return null;
  const n = exp.fresh.reduce((sum, f) => sum + f.columns.length, 0);
  return notice({
    tone: 'info', title: t('send.new.title', { n }), lines: [t('send.new.body')], className: 'new-columns', 'data-new-columns': exp.id,
    body: [el('ul', { class: 'small' }, ...exp.fresh.map(f => el('li', {}, t('send.new.line', { table: f.table, cols: f.columns.map(c => c.id).join(', ') }))))],
    actions: [actions.send, actions.dismiss],
  });
}
return { driftNotice, newColumnsNotice };
})();

// ===== js/source/strays.js =====
__M["js/source/strays.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {freeTableName, hasContent, tableNameProblem} = __M["js/engine/logic/strays.js"];
const {fetchRows, readSchema} = __M["js/grist.js"];
const {removeStrayColumns, renameForeignSync} = __M["js/engine/source/synchro.js"];
const {clearAndMark} = __M["js/engine/source/resend.js"];
const {el, message, openModal, run} = __M["js/ui.js"];
const {t, typeName} = __M["js/i18n.js"];

const columnLine = (stray) => {
  const col = stray.label && stray.label !== stray.id ? `${stray.label} (${stray.id})` : stray.id;
  const vars = { col, type: typeName(stray.type), n: stray.filled, formula: stray.formula };
  const key = stray.filled ? 'send.stray.col.filled' : stray.formula ? 'send.stray.col.formula' : 'send.stray.col.empty';
  return el('li', {}, t(key, vars));
};

function strayDialog(strays, { stuck = false } = {}) {
  const risky = strays.some(hasContent);
  const sure = el('input', { type: 'checkbox', onchange: () => modal.setButtons(buttons()) });
  const report = el('div', { class: 'report' });
  let removed = false;
  let resolveDialog;
  const done = new Promise((resolve) => { resolveDialog = resolve; });
  const buttons = () => [
    { label: t('common.later') },
    {
      label: t('send.stray.remove'), kind: 'btn-danger', disabled: risky && !sure.checked,
      onClick: m => run(null, report, async () => {
        await removeStrayColumns(strays.map(s => s.id));
        if (stuck) await clearAndMark();
        removed = true;
        m.close();
      }),
    },
  ];
  const modal = openModal({
    title: t('send.stray.dialog.title'),
    body: el('div', { class: 'form' },
      el('p', {}, t('send.stray.dialog.intro', { n: strays.length })),
      el('ul', { class: 'stray-list' }, strays.map(columnLine)),
      risky ? message('warn', t('send.stray.save', { n: strays.filter(hasContent).length, cols: strays.filter(hasContent).map(s => s.id).join(', ') })) : el('p', { class: 'small' }, t('send.stray.empty', { n: strays.length })),
      risky ? el('label', { class: 'check' }, sure, t('send.stray.sure')) : null,
      stuck ? el('p', { class: 'muted small' }, t('send.stray.unblock')) : null,
      report),
    buttons: buttons(),
    onClose: () => resolveDialog(removed),
  });
  return done;
}

async function foreignDialog() {
  const schema = await readSchema();
  const taken = schema.tableIds;
  const cols = schema.columns(__C.SYNC_TABLE).map(c => c.colId).filter(id => id !== 'manualSort');
  const rows = (await fetchRows(__C.SYNC_TABLE)).length;
  const name = el('input', { type: 'text', class: 'input', id: 'gristsync-foreign-name', value: freeTableName(taken), spellcheck: 'false' });
  const report = el('div', { class: 'report' });
  let renamed = false;
  let resolveDialog;
  const done = new Promise((resolve) => { resolveDialog = resolve; });
  openModal({
    title: t('send.foreign.title'),
    body: el('div', { class: 'form' },
      el('p', {}, t('send.foreign.body')),
      el('p', { class: 'muted small' }, t('send.foreign.facts', { c: cols.length, cols: cols.slice(0, 8).join(', ') + (cols.length > 8 ? '…' : ''), n: rows })),
      el('p', {}, t('send.foreign.how')),
      el('label', { for: 'gristsync-foreign-name' }, t('send.foreign.name')),
      name,
      report),
    buttons: [
      { label: t('common.later') },
      {
        label: t('send.foreign.rename'), kind: 'btn-primary',
        onClick: m => run(null, report, async () => {
          const problem = tableNameProblem(name.value, taken);
          if (problem === 'empty') throw new Error('tableNameEmpty');
          if (problem === 'invalid') throw new Error('tableNameInvalid');
          if (problem === 'taken') throw new Error('tableNameTaken');
          await renameForeignSync(name.value.trim());
          renamed = true;
          m.close();
        }),
      },
    ],
    onClose: () => resolveDialog(renamed),
  });
  return done;
}
return { strayDialog, foreignDialog };
})();

// ===== js/source/tab.js =====
__M["js/source/tab.js"] = (() => {
'use strict';
const __C = __M["js/engine/logic/common.js"];
const {EXPORT_COL, KIND, LOT_COL, RESEND_COL, SCHEMA_COL, TABLE_COL, TYPE_COL, nowS} = __M["js/engine/logic/common.js"];
const {known} = __M["js/engine/errors.js"];
const {maskKey} = __M["js/engine/logic/codes.js"];
const {conditionExport, driftDetails, exportDrift, exportEmail, exportStatus, exportTables, failureStatus, hookBusy, hookErrorKey, hookStatus, hooksOf, NO_UNBLOCK, queueBlocker, readTables} = __M["js/engine/logic/exports.js"];
const {editorsEditStructure, hiddenTables} = __M["js/engine/logic/acl.js"];
const {STATES, parseLot} = __M["js/engine/logic/journal.js"];
const {eventsOf, recentDrops, vanishedRecipients} = __M["js/engine/logic/notes.js"];
const {exchangeRules} = __M["js/engine/logic/consolidation.js"];
const {listDue, lotLate, parseCharge, trackedCounts} = __M["js/engine/logic/resend.js"];
const {flowMoves} = __M["js/engine/logic/health.js"];
const {LONG_SECONDS} = __M["js/engine/logic/estimate.js"];
const {deleteWebhook, docIdentity, fetchRows, listWebhooks, publicAccess, readSchema, webhookConditions} = __M["js/grist.js"];
const {expiresAt, unkeyedRecipients} = __M["js/engine/logic/trust.js"];
const {unsignedHooks} = __M["js/engine/logic/reinforce.js"];
const {columnFault, foreignSync, hasContent, lostSync, ownsSync, refusedColumn, strayColumns, syncColumnIds} = __M["js/engine/logic/strays.js"];
const {protectSync, ruleRefusal, syncRules} = __M["js/engine/acl.js"];
const {ensureSyncTable, identified, isCharge, protectMemos, readHooks, readSourceNote, refreshMajLe, refreshOptions, updateSourceNote, watchRows} = __M["js/engine/source/synchro.js"];
const {catchUp, currentCharge, flowOf, resendTables} = __M["js/engine/source/resend.js"];
const {exportEstimate} = __M["js/engine/source/estimate.js"];
const {newColumns} = __M["js/engine/logic/new-columns.js"];
const {autoSendNewColumns, baselineNewColumns, dismissNewColumns, sendNewColumns} = __M["js/engine/source/new-columns.js"];
const {driftNotice, newColumnsNotice} = __M["js/source/new-columns.js"];
const {checkHooks, hookCheck, personLabel} = __M["js/engine/source/hook-check.js"];
const {canReinforce, invitationState, startReinforcement} = __M["js/engine/source/invite.js"];
const {confirmSend, flowView, progressTo} = __M["js/source/flow.js"];
const {filesPending, resendFiles} = __M["js/engine/source/files.js"];
const {cancelInvitation, clearHistory, deleteExport, pause, resume, revoke, showPublicCode, stopPublic, unblockQueue} = __M["js/source/actions.js"];
const {exportWizard} = __M["js/source/export-wizard.js"];
const {foreignDialog, strayDialog} = __M["js/source/strays.js"];
const {checkKeys} = __M["js/engine/source/keys.js"];
const {keysBlock} = __M["js/source/keys.js"];
const {lastSend} = __M["js/source/last-send.js"];
const {accessMoved, clearStay, forgettable, lingering, waitsForAccess, watchesAccess} = __M["js/source/public-stay.js"];
const {filterSummary} = __M["js/source/filter-editor.js"];
const {recipientWizard} = __M["js/source/recipient-wizard.js"];
const {hookDoc, hookShown} = __M["js/source/shown.js"];
const {rulesRefusedNotice} = __M["js/rules-notice.js"];
const {confirmDialog, docLink, el, icon, message, noteError, notice: noticeBox, pill, redraw, reloading, run, smallButton} = __M["js/ui.js"];
const {roleGuide} = __M["js/guide.js"];
const {dateText, t} = __M["js/i18n.js"];
const {askWizard, dropWizard, wizardAsked} = __M["js/prefs.js"];

const personShown = h => hookShown(h.fields.memo, hookCheck(h.id).docName) || '—';

let here = '';

const personNameOf = (exp, inv) => {
  const h = exp.recipients.find(r => r.id === inv.replaces);
  return h ? personShown(h) : t('send.renf.someone');
};

function personWho(h) {
  const { other, bad, docName } = hookCheck(h.id);
  const { who, place, url } = hookDoc(h.fields.memo, docName, other || bad ? '' : here);
  if (!place) return personShown(h);
  return [who, who ? ' · ' : null, docLink(place, url)];
}

let container;
let notice = null; // message à montrer au prochain affichage (fin d'un renvoi)
let resumed = false; // l'assistant d'un Échange ne se rouvre seul qu'une fois par chargement
let shownAccess = { base: '', access: null, watch: false, waiting: false };

async function loadState() {
  let hooks = [];
  let ownerOnly = false;
  try { hooks = await listWebhooks(); } catch (e) { if (e.message !== 'ownerOnly') throw e; ownerOnly = true; }
  const conditions = ownerOnly ? new Map() : await webhookConditions();
  const schema = await readSchema();
  const all = ownsSync(schema) ? await fetchRows(__C.SYNC_TABLE) : [];
  const rows = all.filter(r => !isCharge(r));
  const note = readSourceNote(schema);
  hooks = identified(hooks, note); // le mémo de chaque webhook devient la fiche de son destinataire (rangée dans la note)
  const [resources, aclRules] = ownerOnly ? [[], []] : await Promise.all([fetchRows('_grist_ACLResources'), fetchRows('_grist_ACLRules')]);
  const acl = { resources, rules: aclRules };
  const ids = [...new Set([...note.exports.map(e => e.id), ...rows.map(r => r[EXPORT_COL])])];
  const exports = ids.map(id => exportState(id, { note, rows, schema, acl, recipients: hooksOf(hooks, conditions, id) }));
  const unsafe = hooks.filter(h => h.fields.tableId === __C.SYNC_TABLE && !conditionExport(conditions.get(h.id)));
  const charge = parseCharge((all.find(isCharge) || {})[RESEND_COL]);
  const syncCols = ownsSync(schema) ? schema.columns(__C.SYNC_TABLE).map(c => c.colId) : [];
  const strays = ownerOnly || !syncCols.length ? [] : strayColumns(schema.columns(__C.SYNC_TABLE), all);
  const keys = ownerOnly ? new Map() : await checkKeys(exports.flatMap(exp => exp.tables.map(tb => tb.table)));
  const blocker = queueBlocker(exports.flatMap(exp => exp.recipients));
  const lost = ownerOnly ? null : lostSync(schema, hooks, conditions);
  return { ownerOnly, schema, rows, note, exports, unsafe, charge, strays, syncCols, keys, blocker, lost, foreign: !ownerOnly && !lost && foreignSync(schema) };
}

async function reinforceFacts() {
  const { exports, note } = await loadState();
  const mine = exports.filter(exp => !exp.retour);
  const people = mine.filter(exp => !exp.echange && !exp.public).reduce((n, exp) => n + exp.recipients.filter(h => exp.unsigned.has(h.id)).length, 0);
  return { exports: mine.length, people, invitations: note.invitations.filter(inv => !inv.pub && !inv.journal).length };
}

function exportState(id, { note, rows, schema, acl, recipients }) {
  const mine = rows.filter(r => r[EXPORT_COL] === id);
  const tables = exportTables(rows, id);
  const entry = note.exports.find(e => e.id === id) || { id, name: id };
  return {
    ...entry, tables, recipients, invitations: note.invitations.filter(i => i.export === id),
    hidden: entry.public ? hiddenTables(acl.resources, acl.rules, readTables(tables)) : [],
    structure: Boolean(entry.renforce) && editorsEditStructure(acl.resources, acl.rules),
    email: exportEmail(mine, id),
    events: eventsOf(note, id),
    ledger: eventsOf(note, id, { all: true }),
    unkeyed: new Set(unkeyedRecipients((mine.find(r => r[TYPE_COL] === KIND.sign) || {})[SCHEMA_COL], recipients.map(h => h.id), eventsOf(note, id, { all: true }).some(e => e.kind === 'join'))),
    unsigned: new Set(unsignedHooks((mine.find(r => r[TYPE_COL] === KIND.sign) || {})[SCHEMA_COL], recipients)),
    owed: recipients.length ? new Set(mine.filter(r => lotLate(r) || listDue(r)).map(r => r[TABLE_COL])).size : 0,
    tooBig: mine.filter(r => r[TYPE_COL] === KIND.full && (parseLot(r[LOT_COL]) || {}).tooBig).map(r => r[TABLE_COL]),
    ...exportDrift(schema, tables),
    details: driftDetails(schema, tables),
    fresh: entry.retour || entry.echange ? [] : newColumns(schema, tables, entry.known),
  };
}

async function refreshSource() {
  if (container && container.isConnected && !document.querySelector('.scrim')) await renderSource(container, { periodic: true });
}

async function renderSource(root = container, { periodic = false } = {}) {
  container = root;
  const state = await upgradeSource(await loadState());
  const { access, open } = await readPublicAccess(state);
  if (!periodic && !state.ownerOnly && await syncRules({ publicIds: state.exports.filter(e => e.public).map(e => e.id), open })) {
    reloading(container, renderSource);
    return;
  }
  redraw(container, sourceView(state, access, open));
  if (!periodic && wizardAsked('export', { consume: true }) && !state.ownerOnly && !state.foreign && !blocksNew(state.lost)) run(null, container.querySelector('.out'), newExport);
  watchSource(state);
  if (state.ownerOnly) return;
  resumeExchange(state);
  if (!periodic) askAboutSync(state);
  if (await checkHooks(state.exports.flatMap(exp => exp.recipients))) await renderSource(root, { periodic });
}

async function readPublicAccess(state) {
  const identity = await docIdentity();
  here = identity.origin;
  const access = await publicAccess(identity.baseUrl);
  const facts = { note: state.note, exports: state.exports, access };
  shownAccess = { base: identity.baseUrl, access, watch: !state.ownerOnly && watchesAccess(facts), waiting: !state.ownerOnly && waitsForAccess(facts) };
  if (!state.ownerOnly && forgettable(facts)) updateSourceNote(clearStay).catch(console.warn); // lien fermé : le lien coupé est oublié
  return { access, open: access === null ? null : Boolean(access) };
}

function watchSource(state) {
  if ([...flowSlots.values()].some(slot => slot.moving) || state.exports.some(exp => exp.recipients.some(hookBusy))) watchFlows();
  else if (state.exports.some(exp => exp.recipients.length) || shownAccess.watch) watchFlows(restMs());
}

async function upgradeSource(state) {
  if (state.ownerOnly || !ownsSync(state.schema)) return state;
  let current = state;
  if (await ensureSyncTable(current.schema, current.rows)) current = await loadState();
  if (await refreshMajLe(current.schema, current.rows)) current = await loadState();
  if (await refreshOptions(current.schema, current.rows)) current = await loadState();
  if (await protectMemos()) current = await loadState(); // fiches des destinataires hors du mémo des webhooks (lisible par tous)
  const recipientsOf = id => (current.exports.find(exp => exp.id === id) || { recipients: [] }).recipients.length;
  if (await watchRows(current.note, trackedCounts(current.rows), recipientsOf)) current = await loadState();
  if (await baselineNewColumns(current.exports)) current = await loadState();
  if (await autoSendNewColumns(current.exports).catch(noteError)) current = await loadState();
  catchUp(refreshSource);
  return current;
}

function sourceCards(state, open, out) {
  const cards = state.ownerOnly || state.foreign ? [] : state.exports.map(exp => exportCard(exp, state, open, out));
  if (state.unsafe.length) cards.unshift(unsafeCard(state.unsafe, state.ownerOnly, out));
  if (state.strays.length) cards.unshift(strayCard(state, out));
  if (state.foreign) cards.unshift(foreignCard(state, out));
  if (state.lost) cards.unshift(lostCard(state.lost, out));
  return cards;
}

function newExportButton(state, out) {
  const why = state.foreign ? t('send.foreign.blocked') : blocksNew(state.lost) ? t('send.lost.blocked') : null;
  return el('button', {
    class: 'btn btn-primary', type: 'button', disabled: state.ownerOnly || Boolean(why), title: why,
    onclick: e => run(e.currentTarget, out, newExport),
  }, icon('plus'), t('send.new'));
}

async function newExport() {
  askWizard('export'); // noté AVANT : le rechargement de Grist coupe le widget en plein appel, avant que protectSync rende la main
  let posted;
  try {
    posted = await protectSync();
  } catch (e) {
    if (known(e)) {
      dropWizard('export');
      throw e;
    }
    posted = true;
  }
  if (posted) {
    reloading(container, renderSource);
    return;
  }
  dropWizard('export');
  exportWizard(null, renderSource);
}

function sourceView(state, access, open) {
  flowSlots.clear();
  personSlots.clear();
  const out = el('div', { class: 'out' }, notice);
  notice = null;
  const cards = sourceCards(state, open, out);
  return [el('div', { class: 'toolbar' }, newExportButton(state, out)),
    state.ownerOnly ? message('info', t('send.ownersOnly')) : null,
    access && access !== 'viewers' ? message('err', t('send.public.editors')) : null,
    stayNotice(state, access, out),
    state.ownerOnly ? null : rulesRefusedNotice(),
    out,
    cards.length ? el('div', { class: 'cards' }, cards) : state.ownerOnly ? null : el('p', { class: 'muted' }, t('send.empty')),
    roleGuide({ you: 'source' })].filter(Boolean);
}

function resumeExchange(state) {
  const pending = state.exports.flatMap(exp => exp.invitations.filter(inv => inv.journal && !inv.ready).map(inv => [exp, inv]))[0];
  if (pending && !resumed && !document.querySelector('.scrim')) openRecipient(...pending);
}

const openRecipient = (exp, pending = null, started = null) => {
  resumed = true;
  recipientWizard(exp, pending, renderSource, started);
};

const reinforce = async (exp, hook) => {
  const started = await startReinforcement(exp, hook);
  openRecipient(started.exp, null, started);
};

const actionButton = (label, iconName, fn, ownerOnly, out, { kind = '', reason = '' } = {}) => smallButton(label, iconName,
  e => run(e.currentTarget, out, async () => { await fn(); await renderSource(); }), { kind, disabled: ownerOnly || Boolean(reason), title: reason || null });

const wizardButton = (label, iconName, onclick, { primary = false, ownerOnly = false, reason = '' } = {}) =>
  smallButton(label, iconName, onclick, { kind: primary ? 'btn-primary' : '', disabled: ownerOnly || Boolean(reason), title: reason || null });

const statusPill = (key, tone, vars) => pill(t(`send.status.${key}`, vars), tone);

function rulesLine(exp) {
  const rules = exchangeRules(exp);
  if (!rules) return null;
  const list = STATES.filter(st => rules[st] !== 'accepter').map(st => `${t(`send.rules.${st}`)} (${t(`send.rules.${rules[st]}`)})`);
  return el('p', { class: 'muted small' }, t('send.exchange.rules', { rules: list.join(', ') }));
}

const exportNotes = (exp, newColumnsActions) => [
  !exp.tables.length && !exp.retour ? message('err', t('send.export.rowsGone')) : null,
  exp.hidden.length ? message('err', t('send.public.hiddenNow', { tables: exp.hidden.join(', ') })) : null,
  exp.structure ? message('warn', t('send.renforce.structure')) : null,
  exp.lost.length ? message('warn', t('send.export.lost', { tables: exp.lost.join(', ') })) : null,
  driftNotice(exp),
  newColumnsNotice(exp, newColumnsActions),
  filesPending(exp.id) ? message('info', t('send.files.pending', { n: filesPending(exp.id) })) : null,
  exp.retour ? message('info', t('send.exchange.managed')) : null,
  exp.echange && !exp.retour ? el('p', { class: 'muted small' }, exp.recipients.length > 1 ? t('send.exchange.hub', { n: exp.recipients.length }) : t('send.exchange.with')) : null,
  exp.echange && !exp.retour ? rulesLine(exp) : null,
];

const tablesLine = exp => exp.tables.map(tb => t(tb.filter ? 'send.export.tableFiltered' : 'send.export.table',
  { table: tb.table, n: tb.columns.length, filter: filterSummary(tb.filter) })).join(' · ') || '—';

function exportCard(exp, state, open, out) {
  const { ownerOnly } = state;
  const n = exp.recipients.length;
  const [status, tone] = exportStatus(exp);
  const rows = [
    ...exp.recipients.map(h => personRow(exp, h, ownerOnly, out, state)),
    ...exp.invitations.map(inv => inviteRow(exp, inv, ownerOnly, out)),
    exp.public ? publicRow(exp, open, ownerOnly, out) : null,
  ].filter(Boolean);
  const load = async () => {
    const est = await exportEstimate(exp).catch(() => null);
    if (est && est.seconds >= LONG_SECONDS && !(await confirmSend(est))) return;
    await resendFiles(exp.id);
    loading++;
    watchFlows();
    try {
      const total = await resendTables(exp.id, exp.tables.map(tb => tb.table), null);
      notice = total === null ? message('info', t('send.load.queued')) : message('ok', t('send.load.done', { n: total }));
    } finally {
      loading--;
    }
  };
  return el('article', { class: 'card', 'data-export': exp.id },
    el('div', { class: 'card-head' }, el('strong', {}, exp.name), statusPill(status, tone, { n: n + (exp.public ? 1 : 0) })),
    el('p', { class: 'muted small' }, tablesLine(exp)),
    keyNotice(exp, state),
    reinforceNotice(exp),
    behindNotice(exp, state),
    vanishedNotice(exp),
    shrinkNotices(exp),
    exportNotes(exp, newColumnsButtons(exp, ownerOnly, out)),
    flowSlot(exp, state.charge),
    rows.length ? el('ul', { class: 'people' }, rows) : el('p', { class: 'small' }, t('send.export.nobody')),
    eventsBlock(exp, out, ownerOnly),
    el('div', { class: 'card-actions' },
      exp.retour ? null : wizardButton(t(exp.echange ? 'send.action.addParticipant' : 'send.action.addPerson'), 'plus', () => openRecipient(exp), { primary: !rows.length, ownerOnly }),
      exp.retour ? null : wizardButton(t('send.action.edit'), 'edit', () => exportWizard(exp, renderSource), { ownerOnly }),
      actionButton(t('send.action.load'), 'send', load, ownerOnly, out, { reason: n ? '' : t('send.load.nobody') }),
      actionButton(t('send.action.delete'), 'trash', () => deleteExport(exp), ownerOnly, out, { kind: 'btn-danger-text' })));
}

const newColumnsButtons = (exp, ownerOnly, out) => ({
  send: actionButton(t('send.new.send'), 'send', async () => {
    const n = await sendNewColumns(exp, progressTo(out));
    notice = n === null ? message('info', t('send.load.queued')) : message('ok', n ? t('send.edit.saved', { n }) : t('send.edit.savedNone'));
  }, ownerOnly, out, { kind: 'btn-primary' }),
  dismiss: actionButton(t('send.new.dismiss'), 'x', () => dismissNewColumns(exp), ownerOnly, out),
});

function behindNotice(exp, { blocker }) {
  if (!blocker) return null;
  const n = exp.recipients.filter(h => h.id !== blocker.id && hookStatus(h)[0] !== 'error' && (h.usage || {}).numWaiting > 0).length;
  return n ? message('warn', t('send.behind', { n, who: personShown(blocker) })) : null;
}

function vanishedNotice(exp) {
  const n = exp.retour || exp.public ? 0 : vanishedRecipients(exp.ledger, exp.recipients.length);
  return n ? message('warn', t('send.vanished', { n }), t('send.vanished.title', { n })) : null;
}

const shrinkNotices = exp => recentDrops(exp.events, nowS()).map(d => message('warn',
  t('send.shrink.body', { date: dateText(d.at * 1000) }), t('send.shrink.title', { table: d.table, n: d.n })));

function keyNotice(exp, state) {
  const problems = new Map([...state.keys].filter(([table]) => exp.tables.some(tb => tb.table === table)));
  return problems.size ? keysBlock(problems, () => renderSource(), { ownerOnly: state.ownerOnly }) : null;
}

const eventsOpen = new Set();
const eventLine = e => el('li', { class: 'send-event' },
  el('time', { class: 'chg-time', datetime: new Date(e.at * 1000).toISOString() }, dateText(e.at * 1000)),
  el('span', {}, t(`send.history.${e.kind}`, { who: e.who || '—', n: e.n || 0 })));

function fillLast(row, recipients) {
  const last = lastSend(recipients);
  row.hidden = !last;
  if (!last) return;
  const text = [t('send.history.last')];
  if (last.of > 1) text.push(' ', t('send.history.lastWho', { who: personShown(last.hook), n: last.n, of: last.of }));
  row.replaceChildren(
    el('time', { class: 'chg-time', datetime: new Date(last.at).toISOString() }, dateText(last.at)),
    el('span', {}, ...text));
}

const lastRow = exp => {
  const row = el('li', { class: 'send-event send-last', 'data-last-send': exp.id });
  fillLast(row, exp.recipients);
  return row;
};
const eventsBlock = (exp, out, ownerOnly) => (exp.events.length || lastSend(exp.recipients) ? el('details', {
  class: 'history', open: eventsOpen.has(exp.id), ontoggle: e => (e.currentTarget.open ? eventsOpen.add(exp.id) : eventsOpen.delete(exp.id)),
}, el('summary', {}, el('span', { class: 'history-title' }, t(exp.events.length ? 'send.history.title' : 'send.history.title.none', { n: exp.events.length }))),
  el('p', { class: 'muted small' }, t('send.history.help')), el('ul', { class: 'history-rows' }, [lastRow(exp), ...exp.events.map(eventLine)]),
  exp.events.length ? actionButton(t('send.history.clear'), 'trash', () => clearHistory(exp), ownerOnly, out, { kind: 'btn-link' }) : null) : null);

function errorText(h, syncCols) {
  const fault = columnFault(h.usage, syncCols);
  if (fault === 'stray') return t('send.error.stray', { col: refusedColumn(h.usage) });
  if (fault === 'gone') return t('send.error.gone', { col: refusedColumn(h.usage) });
  return t(hookErrorKey(h), { col: refusedColumn(h.usage) || '?', status: failureStatus(h) || '' });
}

function personRow(exp, h, ownerOnly, out, { syncCols, note }) {
  const [status] = hookStatus(h);
  const slot = { pill: el('span', {}), lines: el('div', {}), syncCols, status };
  personSlots.set(h.id, slot);
  fillPerson(slot, h);
  return el('li', { class: 'person', 'data-memo': h.fields.memo || '' },
    el('div', { class: 'person-head' }, el('span', { class: 'person-who', title: personLabel(h) }, personWho(h)), slot.pill),
    personNotices(exp, h, status, note),
    slot.lines,
    personActions(exp, h, { status, ownerOnly, out, syncCols }));
}

function personNotices(exp, h, status, note) {
  const autoPaused = status === 'paused' ? note.pauses.find(p => p.hook === h.id && p.auto) : null;
  const { other, bad } = hookCheck(h.id);
  return [
    bad ? message('err', t('send.person.badAddress')) : null,
    other ? message('err', t('send.person.otherDoc', { doc: other })) : null,
    exp.unkeyed.has(h.id) && !renfPossible(exp, h) ? message('err', t('send.person.noKey')) : null,
    reinforceLine(exp, h),
    autoPaused ? message('info', t(autoPaused.why === 'slow' ? 'send.paused.slow' : 'send.paused.auto')) : null,
    status === 'paused' && !autoPaused ? message('info', t('send.paused.manual')) : null,
  ];
}

function personActions(exp, h, { status, ownerOnly, out, syncCols }) {
  const action = (label, iconName, fn, options) => actionButton(label, iconName, fn, ownerOnly, out, options);
  const failing = status === 'error';
  const waits = failing && !columnFault(h.usage, syncCols) && NO_UNBLOCK.includes(hookErrorKey(h));
  return el('div', { class: 'person-actions' },
    reinforceable(exp, h) ? smallButton(t('send.renf.action'), 'key', () => run(null, out, () => reinforce(exp, h)), { disabled: ownerOnly }) : null,
    status === 'paused' ? action(t('send.action.resume'), 'play', () => resume(exp, h, out)) : action(t('send.action.pause'), 'pause', () => pause(exp, h)),
    failing && !waits ? action(t('send.action.unblock'), 'unblock', unblockQueue) : null,
    action(t('send.action.revoke'), 'revoke', () => revoke(exp, h), { kind: 'btn-danger-text' }));
}

function fillPerson(slot, h) {
  const [status, tone] = hookStatus(h);
  const u = h.usage || {};
  const failing = status === 'error';
  slot.status = status;
  slot.pill.replaceChildren(statusPill(status, tone));
  slot.lines.replaceChildren(...[
    u.lastSuccessTime ? el('p', { class: 'muted small' }, t('send.lastOk', { at: dateText(u.lastSuccessTime) })) : null,
    u.numWaiting ? el('p', { class: 'small' }, t('send.waiting', { n: u.numWaiting })) : null,
    failing ? el('p', { class: 'small text-danger' }, errorText(h, slot.syncCols)) : null,
    failing && u.lastErrorMessage ? el('p', { class: 'muted small' }, t('send.error.detail', { detail: maskKey(`${failureStatus(h) || ''} ${u.lastErrorMessage}`.trim()) })) : null,
  ].filter(Boolean));
}

const FLOW_MS = 10000;
const IDLE_MS = 30000;
const flowSlots = new Map(); // export -> { node, exp, moving }
const personSlots = new Map(); // webhook -> { pill, lines, syncCols, status }
let flowTimer = 0;
let flowDue = 0;
let loading = 0; // envois lancés depuis cette page par « Tout renvoyer »

function flowSlot(exp, charge) {
  const node = el('div', { class: 'flow-slot', 'data-export-flow': exp.id });
  const flow = flowOf(exp, charge);
  const view = flowView(flow);
  if (view) node.append(view);
  flowSlots.set(exp.id, { node, exp, moving: flowMoves(flow) });
  return node;
}

function watchFlows(ms = FLOW_MS) {
  const due = Date.now() + ms;
  if (flowTimer && flowDue <= due) return;
  clearTimeout(flowTimer);
  flowDue = due;
  flowTimer = setTimeout(tickFlows, ms);
}

function refreshFlows(charge, hooks, conditions, moving) {
  let changed = false;
  for (const [id, slot] of flowSlots) {
    if (!slot.node.isConnected) {
      flowSlots.delete(id);
      continue;
    }
    slot.exp = { ...slot.exp, recipients: hooksOf(hooks, conditions, id) };
    const flow = flowOf(slot.exp, charge);
    const view = flowView(flow);
    slot.node.replaceChildren(...(view ? [view] : []));
    const row = slot.node.parentElement && slot.node.parentElement.querySelector('[data-last-send]');
    if (row) fillLast(row, slot.exp.recipients);
    else changed ||= Boolean(lastSend(slot.exp.recipients));
    changed ||= slot.moving && !flowMoves(flow);
    slot.moving = flowMoves(flow);
    moving ||= slot.moving;
  }
  return { moving, changed };
}

function refreshPeople(hooks, state) {
  let { moving, changed } = state;
  for (const h of hooks) {
    const slot = personSlots.get(h.id);
    if (!slot || !slot.pill.isConnected) continue;
    changed ||= hookStatus(h)[0] !== slot.status;
    moving ||= hookBusy(h);
    fillPerson(slot, h);
  }
  return { moving, changed };
}

async function tickFlows() {
  flowTimer = 0;
  if (!container || !container.isConnected) return;
  if (document.visibilityState === 'hidden' && !loading && ![...flowSlots.values()].some(slot => slot.moving)) {
    watchFlows(IDLE_MS);
    return;
  }
  let charge;
  let hooks;
  let conditions;
  try {
    let read;
    [charge, read] = await Promise.all([currentCharge(), readHooks()]);
    ({ hooks, conditions } = read);
  } catch (e) {
    watchFlows(loading ? FLOW_MS : IDLE_MS);
    return;
  }
  const { moving, changed } = refreshPeople(hooks, refreshFlows(charge, hooks, conditions, loading > 0));
  const moved = await accessChanged();
  if ((changed || moved) && !document.querySelector('.scrim')) await refreshSource();
  else watchFlows(moving || changed || moved ? FLOW_MS : restMs());
}

const restMs = () => (shownAccess.waiting ? FLOW_MS : IDLE_MS);

async function accessChanged() {
  if (!shownAccess.watch) return false;
  return accessMoved(shownAccess.access, await publicAccess(shownAccess.base));
}

const pendingFor = (exp, h) => exp.invitations.find(inv => inv.replaces === h.id);
const renfPossible = (exp, h) => exp.unsigned.has(h.id) && !exp.echange && !exp.public && Boolean(pendingFor(exp, h) || canReinforce(exp, h));
const reinforceable = (exp, h) => exp.unsigned.has(h.id) && !pendingFor(exp, h) && canReinforce(exp, h);

function reinforceLine(exp, h) {
  if (!exp.unsigned.has(h.id) || pendingFor(exp, h) || exp.echange || exp.public) return null;
  return message('info', t(canReinforce(exp, h) ? 'send.renf.person' : 'send.renf.paused'));
}

function reinforceNotice(exp) {
  if (!exp.unsigned.size || exp.echange || exp.public || exp.retour) return null;
  return noticeBox({ tone: 'info', title: t('send.renf.title.n', { n: exp.unsigned.size }), lines: [t('send.renf.body'), t('send.renf.safe'), t('send.renf.how')], 'data-renf': 'suggest' });
}

function inviteRow(exp, inv, ownerOnly, out) {
  const state = invitationState(inv);
  const back = state === 'link';
  const expired = state === 'expired';
  const until = t(expired ? 'send.invite.expiredOn' : 'send.invite.until', { at: dateText(expiresAt(inv.at) * 1000) });
  return el('li', { class: 'person' },
    el('div', { class: 'person-head' },
      el('span', { class: 'person-who' }, inv.replaces ? t('send.renf.pending', { who: personNameOf(exp, inv), at: dateText(inv.at * 1000) }) : t('send.invite.pending', { at: dateText(inv.at * 1000) })),
      expired ? statusPill(inv.replaces ? 'renfExpired' : 'expired', 'err') : statusPill(inv.replaces ? 'renfWait' : 'invited', 'pending')),
    el('p', { class: 'muted small' }, [back ? t('send.mode.echange') : until, inv.renforce ? t('send.renforce.on') : ''].filter(Boolean).join(' · ')),
    el('div', { class: 'person-actions' },
      wizardButton(back ? t('send.back.resume') : expired ? t('send.newCode.ok') : t('send.reply'), back ? 'link' : expired ? 'key' : 'paste', () => openRecipient(exp, inv), { primary: true, ownerOnly }),
      inv.journal && inv.ready ? wizardButton(t('send.back.again'), 'key', () => openRecipient(exp, { ...inv, ready: false }), { ownerOnly }) : null,
      actionButton(t('send.action.cancel'), 'trash', () => cancelInvitation(inv), ownerOnly, out, { kind: 'btn-danger-text' })));
}

function publicRow(exp, open, ownerOnly, out) {
  return el('li', { class: 'person' },
    el('div', { class: 'person-head' }, el('span', { class: 'person-who' }, t('send.public.label')), statusPill(open ? 'public' : 'publicOff', open ? 'ok' : 'pending')),
    open ? null : el('p', { class: 'small' }, t('send.public.turnOn')),
    exp.tooBig.length ? message('warn', t('send.public.tooBig', { tables: exp.tooBig.join(', ') })) : null,
    el('div', { class: 'person-actions' },
      actionButton(t('send.public.code'), 'key', () => showPublicCode(exp), ownerOnly, out),
      actionButton(t('send.public.stop'), 'unlink', () => stopPublic(exp), ownerOnly, out, { kind: 'btn-danger-text' })));
}

function stayNotice(state, access, out) {
  if (state.ownerOnly || !lingering({ note: state.note, exports: state.exports, access })) return null;
  return noticeBox({
    tone: 'warn', title: t('send.public.stay.title'), lines: [t('send.public.stay.body'), t('send.public.stay.how'), t('send.public.stay.rules')], 'data-public-stay': '',
    actions: [actionButton(t('send.public.stay.keep'), 'check', () => updateSourceNote(clearStay), false, out)],
  });
}

function cleanupCard({ title, body, status, clean, confirm, ownerOnly, out, fn }) {
  return el('article', { class: 'card' },
    el('div', { class: 'card-head' }, el('strong', {}, title), status),
    el('p', { class: 'small' }, body),
    el('div', { class: 'card-actions' }, actionButton(clean, 'trash', async () => {
      if (await confirmDialog({ title, body: confirm, confirmLabel: clean })) await fn();
    }, ownerOnly, out, { kind: 'btn-danger-text' })));
}

const unsafeCard = (hooks, ownerOnly, out) => cleanupCard({
  title: t('send.unsafe.title'), status: statusPill('error', 'err'), body: t('send.unsafe.body', { who: hooks.map(h => h.fields.memo || h.fields.name).join(', ') }),
  clean: t('send.unsafe.delete'), confirm: t('send.unsafe.confirm'), ownerOnly, out,
  fn: async () => { for (const h of hooks) await deleteWebhook(h.id); },
});

const strayCard = (state, out) => {
  const risky = state.strays.filter(hasContent);
  return el('article', { class: 'card', 'data-stray': '' },
    el('div', { class: 'card-head' }, el('strong', {}, t('send.stray.title')), statusPill('error', 'err')),
    el('p', { class: 'small' }, t('send.stray.body', { n: state.strays.length, list: state.strays.map(s => s.id).join(', '), total: syncColumnIds().size })),
    risky.length ? message('warn', t('send.stray.filled', { cols: risky.map(s => s.id).join(', ') })) : null,
    el('div', { class: 'card-actions' }, actionButton(t('send.stray.open'), 'trash', () => removeStrays(state), false, out, { kind: 'btn-primary' })));
};

async function lostSynchro(schema) {
  try {
    return lostSync(schema, await listWebhooks(), await webhookConditions());
  } catch (e) {
    return null;
  }
}
async function isOwnerHere() {
  try {
    await listWebhooks();
    return true;
  } catch (e) {
    return e.message === 'ownerOnly' ? false : null;
  }
}
const blocksNew = lost => Boolean(lost) && lost.kind !== 'deleted';
function lostCard(lost, out) {
  const vars = { name: lost.name, n: lost.hooks.length };
  const title = t(`send.lost.${lost.kind}.title`, vars);
  const clean = lost.kind !== 'deleted' ? null : actionButton(t('send.lost.deleted.clean'), 'trash', async () => {
    if (!(await confirmDialog({ title, body: t('send.lost.deleted.confirm', vars), confirmLabel: t('send.lost.deleted.clean') }))) return;
    for (const id of lost.hooks) await deleteWebhook(id);
    notice = message('ok', t('send.lost.deleted.done', vars));
  }, false, out, { kind: 'btn-danger-text' });
  return el('article', { class: 'card', 'data-lost': lost.kind },
    el('div', { class: 'card-head' }, el('strong', {}, title), statusPill('error', 'err')),
    el('p', { class: 'small' }, t(`send.lost.${lost.kind}.body`, vars)),
    el('p', { class: 'small' }, t(`send.lost.${lost.kind}.how`, vars)),
    clean ? el('div', { class: 'card-actions' }, clean) : null);
}

const foreignCard = (state, out) => el('article', { class: 'card', 'data-foreign': '' },
  el('div', { class: 'card-head' }, el('strong', {}, t('send.foreign.title')), statusPill('error', 'err')),
  el('p', { class: 'small' }, t('send.foreign.body')),
  el('div', { class: 'card-actions' }, actionButton(t('send.foreign.open'), 'edit', renameForeign, false, out, { kind: 'btn-primary' })));

async function removeStrays(state) {
  const stuck = state.exports.some(exp => exp.recipients.some(h => columnFault(h.usage, state.syncCols) === 'stray'));
  if (await strayDialog(state.strays, { stuck })) notice = message('ok', t('send.stray.done', { n: state.strays.length }));
}

async function renameForeign() {
  if (await foreignDialog()) notice = message('ok', t('send.foreign.done'));
}

const asked = new Set();
function askAboutSync(state) {
  if (state.ownerOnly || document.querySelector('.scrim')) return;
  const [kind, open] = state.foreign ? ['foreign', renameForeign] : state.strays.length ? ['stray', () => removeStrays(state)] : [];
  if (!kind || asked.has(kind)) return;
  asked.add(kind);
  open().then(() => renderSource()).catch((e) => { console.error(e); noteError(e); });
}
return { reinforceFacts, refreshSource, renderSource, lostSynchro, isOwnerHere };
})();

// ===== js/sync-port.js =====
__M["js/sync-port.js"] = (() => {
'use strict';
const {apply, clearWebhookQueue, createWebhook, deleteWebhook, deleteWebhookWithNotice, docChanges, docIdentity, downloadAttachment, fetchRows, isOwner, journalStats, listWebhooks, postRows, postToHook, publicAccess, publicRecords, querySql, readSchema, renameWebhook, selectRows, setWebhookEnabled, shareInfo, uploadAttachment, webhookConditions, withLock} = __M["js/grist.js"];
const {t} = __M["js/i18n.js"];
const {readPref, writePref} = __M["js/prefs.js"];

const syncPort = {
  apply,
  clearWebhookQueue,
  createWebhook,
  deleteWebhook,
  deleteWebhookWithNotice,
  docChanges,
  docIdentity,
  downloadAttachment,
  fetchRows,
  isOwner,
  journalStats,
  listWebhooks,
  postRows,
  postToHook,
  publicAccess,
  publicRecords,
  querySql,
  readSchema,
  renameWebhook,
  selectRows,
  setWebhookEnabled,
  shareInfo,
  uploadAttachment,
  webhookConditions,
  withLock,
  text: t,
  page: {
    visible: () => document.visibilityState === 'visible',
    busy: () => Boolean(document.querySelector('.scrim')),
    onShow: (callback) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') callback();
      });
    },
    onLeave: callback => window.addEventListener('pagehide', callback),
  },
  prefs: { read: readPref, write: writePref },
};
return { syncPort };
})();

// ===== js/target/dest.js =====
__M["js/target/dest.js"] = (() => {
'use strict';
const {KEY_COL, destTableId, isUserTable} = __M["js/engine/logic/common.js"];
const {isOwner, readSchema} = __M["js/grist.js"];
const {exportSchema} = __M["js/engine/logic/codes.js"];
const {exportableColumns} = __M["js/engine/logic/exports.js"];
const {wireExchange} = __M["js/engine/exchange.js"];
const {destColumns} = __M["js/engine/logic/journal.js"];
const {fitIssues} = __M["js/engine/logic/adopt.js"];
const {checkDests} = __M["js/engine/target/dest.js"];
const {prepareDest, storeKey, updateJournalNote} = __M["js/engine/target/journals.js"];
const {keySlot, missingColumns, receivedDests, receivedJournals, receivedKey} = __M["js/engine/logic/received.js"];
const {consolidateAll} = __M["js/engine/target/loop.js"];
const {backButton, confirmDialog, el, laterButton, message, openModal, pickField, run, withHelp} = __M["js/ui.js"];
const {t, typeName} = __M["js/i18n.js"];

function destField(schema, table) {
  const tables = schema.tableIds.filter(isUserTable);
  const feeds = new Map(receivedDests(schema).map(r => [r.dest, r.table]));
  const label = id => (feeds.has(id) ? t('recv.dest.taken', { dest: id, table: feeds.get(id) }) : id);
  const name = el('input', { type: 'text', class: 'input', value: destTableId(table), 'aria-label': t('recv.dest.name', { table }) });
  const nameBox = el('div', { class: 'dest-pick' }, el('span', { class: 'muted small' }, t('recv.dest.nameLabel')), name);
  const field = pickField({
    label: table, value: '',
    items: [{ value: '', label: t('recv.dest.new') }, ...tables.map(id => ({ value: id, label: label(id) }))],
    onChange: (v) => { nameBox.classList.toggle('hidden', v !== ''); },
  });
  const typed = () => destTableId(name.value, table);
  return { node: el('div', { class: 'dest-pick' }, field, nameBox), dest: () => field.value() || schema.resolve(typed()) || typed() };
}

function mappingBlock(schema, table, dest, columns) {
  const hereCols = schema.columns(dest);
  const destCols = hereCols.filter(c => !c.isFormula && c.colId !== KEY_COL).map(c => c.colId);
  const notes = el('div', { class: 'fit-notes' });
  const refresh = () => notes.replaceChildren(...fitIssues(columns, mapNow(), hereCols).map(issue => el('p', {
    class: `small msg msg-${issue.level === 'bad' ? 'err' : 'warn'}`, role: 'status',
  }, fitText(issue))));
  const maps = destColumns(columns).map(c => ({
    id: c.id,
    field: pickField({
      label: c.id, value: destCols.includes(c.id) ? c.id : '',
      items: [...(destCols.includes(c.id) ? [] : [{ value: '', label: t('recv.col.new', { col: c.id }) }]), ...destCols.map(d => ({ value: d, label: d }))],
      onChange: refresh,
    }),
  }));
  const mapNow = () => Object.fromEntries(maps.map(m => [m.id, m.field.value() || m.id]));
  const match = pickField({
    label: t('recv.match'), value: '',
    items: [{ value: '', label: t('recv.match.none') }, ...destCols.map(d => ({ value: d, label: d }))],
  });
  refresh();
  const node = el('div', { class: 'form' },
    el('h3', {}, `${table} → ${dest}`),
    ...maps.map(m => el('div', { class: 'dest-row' }, el('span', {}, `${m.id} →`), m.field)),
    notes,
    withHelp(el('label', {}, t('recv.match')), t('recv.match.help')), match);
  const read = () => {
    const map = mapNow();
    const targets = Object.values(map);
    if (new Set(targets).size !== targets.length) throw new Error('mapTwice');
    if (match.value() && !targets.includes(match.value())) throw new Error('matchUnmapped');
    return { map, match: match.value() };
  };
  return { node, read, issues: () => fitIssues(columns, mapNow(), hereCols) };
}

const fitText = issue => t(`recv.fit.${issue.level}`, { col: issue.id, to: issue.to, sent: typeName(issue.sent), here: typeName(issue.here) });

async function confirmFit(issues) {
  if (!issues.length) return true;
  return confirmDialog({
    title: t('recv.fit.title'), body: [el('p', {}, t('recv.fit.body')), el('ul', { class: 'small' }, ...issues.map(issue => el('li', {}, fitText(issue))))],
    confirmLabel: t('recv.fit.ok'),
  });
}

function confirmNewTables(dests) {
  return confirmDialog({
    title: t('recv.new.title'),
    body: [el('p', {}, t('recv.new.body', { tables: dests.join(', '), n: dests.length })), el('p', {}, t('recv.new.safe')), el('p', {}, t('recv.new.after'))],
    confirmLabel: t('recv.new.ok'), kind: 'btn-primary',
  });
}

async function confirmOutgoing(schema, dests, where) {
  const existing = dests.filter(d => schema.has(d));
  if (!existing.length) return true;
  const list = existing.map(d => `${d} (${exportableColumns(schema.columns(d) || []).map(c => c.id).join(', ')})`).join(' ; ');
  return confirmDialog({ title: t('recv.outgoing.title'), body: t('recv.outgoing.body', { list, where }), confirmLabel: t('recv.outgoing.ok') });
}

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
  const accept = async (picked, m) => {
    const before = await readSchema();
    const entry = { ...picked, own: missingColumns(before, picked.dest, offer.columns, picked.map || {}), ...(group.note.ask && !exchange && before.has(picked.dest) ? { adopt: true } : {}) };
    await prepareDest({ dest: entry.dest, columns: offer.columns, map: entry.map });
    await storeKey([entry.dest], keySlot(group.journal, group.note), receivedKey(await readSchema(), group.journal, group.note));
    await updateJournalNote(group.journal, note => (note.tables.some(tb => tb.table === entry.table) ? note : { ...note, tables: [...note.tables, entry] }));
    if (exchange && !group.note.retour && await isOwner()) await wireExchange(receivedJournals(await readSchema()).find(r => r.journal === group.journal).note);
    await finish(m);
  };
  const refuse = async (m) => {
    if (!(await confirmDialog({ title: t('recv.offer.refuseTitle', { table: offer.table }), body: t('recv.offer.refuseBody'), confirmLabel: t('recv.offer.refuse') }))) return;
    await updateJournalNote(group.journal, note => ({ ...note, refused: [...(note.refused || []), offer.table] }));
    await finish(m);
  };
  const choose = async (m) => {
    const dest = pick.dest();
    await checkDests(schema, [{ table: offer.table, dest }], (group.note.from || {}).docId, exchange ? group.note.export : null);
    const entry = { table: offer.table, dest, columns: exportSchema(offer.columns) };
    if (!schema.has(dest)) return (await confirmNewTables([dest])) ? accept(entry, m) : null;
    const from = group.note.from || {};
    if (exchange && !(await confirmOutgoing(schema, [dest], from.docName || from.docId || group.note.name))) return null;
    const mapping = mappingBlock(schema, offer.table, dest, offer.columns);
    step.replaceChildren(el('p', {}, t('recv.existing')), mapping.node);
    m.setButtons([backButton(() => { step.replaceChildren(first); m.setButtons(buttons); }),
      { label: t('recv.offer.accept'), kind: 'btn-primary', onClick: mm => run(null, report, () => {
        const { map, match } = mapping.read();
        return confirmFit(mapping.issues()).then(go => (go ? accept({ ...entry, map, ...(match ? { match } : {}) }, mm) : null));
      }) }]);
    return null;
  };
  const first = el('div', { class: 'form' },
    message('info', t('recv.offer.body', { name: group.note.name, table: offer.table, n: offer.n, cols: offer.columns.map(c => c.id).join(', ') })),
    el('label', {}, t('recv.offer.where')), pick.node);
  step.replaceChildren(first);
  const buttons = [
    laterButton(),
    { label: t('recv.offer.refuse'), kind: 'btn-danger-text', onClick: m => run(null, report, () => refuse(m)) },
    { label: t('recv.offer.accept'), kind: 'btn-primary', onClick: m => run(null, report, () => choose(m)) },
  ];
  openModal({ title: t('recv.offer.title', { table: offer.table }), body: [step, report], buttons });
}
return { destField, mappingBlock, confirmFit, confirmNewTables, confirmOutgoing, offerDialog };
})();

// ===== js/target/options.js =====
__M["js/target/options.js"] = (() => {
'use strict';
const {syncRules} = __M["js/engine/acl.js"];
const {updateJournalNote} = __M["js/engine/target/journals.js"];
const {optionsNote} = __M["js/engine/logic/received.js"];
const {cancelButton, el, openModal, run, withHelp} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

function receptionOptions(current, { lockable = true, change = false } = {}) {
  const archive = el('input', { type: 'checkbox', checked: Boolean(current.archive) });
  const verrou = el('input', { type: 'checkbox', checked: Boolean(current.verrou), disabled: !lockable });
  const auto = el('input', { type: 'checkbox', checked: !current.ask });
  return {
    node: el('div', { class: 'form' },
      withHelp(el('label', { class: 'check' }, auto, t('recv.structure.auto.option')), t('recv.structure.auto.help'), t('recv.structure.auto.option')),
      withHelp(el('label', { class: 'check' }, archive, t('recv.archive')), [t('recv.archive.help'), change ? t('recv.archive.off') : null].filter(Boolean), t('recv.archive')),
      withHelp(el('label', { class: 'check' }, verrou, t('recv.lock')), [t('recv.lock.help'), t('recv.lock.limit')], t('recv.lock')),
      lockable ? null : el('p', { class: 'muted small' }, t('recv.lock.ownerOnly'))),
    read: () => ({ archive: archive.checked, verrou: verrou.checked, ask: !auto.checked }),
  };
}

function optionsDialog(group, owner, render) {
  const { note } = group;
  const options = receptionOptions(note, { lockable: owner, change: true });
  const report = el('div', { class: 'report' });
  const save = async (m) => {
    const { archive, verrou, ask } = options.read();
    const release = owner && note.verrou && !verrou ? note.tables.map(tb => tb.dest) : [];
    await updateJournalNote(group.journal, ({ archive: a, verrou: v, ask: k, ...rest }) => ({ ...rest, ...optionsNote({ archive, verrou: owner ? verrou : v, ask }) }));
    m.close();
    if (release.length) await syncRules({ release });
    await render();
  };
  const initial = JSON.stringify(options.read());
  const saveHere = m => run(null, report, () => save(m));
  openModal({
    title: t('recv.options.title', { name: note.name }), width: 480,
    body: [options.node, report],
    guard: { save: saveHere, changed: () => JSON.stringify(options.read()) !== initial },
    buttons: [cancelButton(), { label: t('common.save'), kind: 'btn-primary', onClick: saveHere }],
  });
}
return { receptionOptions, optionsDialog };
})();

// ===== js/target/source-line.js =====
__M["js/target/source-line.js"] = (() => {
'use strict';
const {docUrl} = __M["js/engine/logic/codes.js"];
const {docLink, el} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

function sourceLine(from, { verified = false, origin = '' } = {}) {
  const { email, docName, docId, team } = from || {};
  const url = docUrl(origin, team, docId, docName);
  const provenance = docName ? t(verified ? 'common.docChecked' : 'common.docDeclared') : '';
  const doc = docName || url ? docLink(docName || t('recv.doc.open'), url, provenance) : null;
  if (!email && !doc) return null;
  const title = [docId ? t('recv.docId', { doc: docId }) : '', url ? '' : provenance].filter(Boolean).join(' — ');
  return el('p', { class: 'small', title: title || null }, email ? t('recv.from', { from: email }) : null, email && doc ? ' · ' : null, doc);
}
return { sourceLine };
})();

// ===== js/target/wizard.js =====
__M["js/target/wizard.js"] = (() => {
'use strict';
const {docIdentity, readSchema} = __M["js/grist.js"];
const {VERSION} = __M["js/config.js"];
const {formWhere, linkFigures} = __M["js/form-link.js"];
const {protectSync, syncUnprotected} = __M["js/engine/acl.js"];
const {known} = __M["js/engine/errors.js"];
const {canRelink, checkDestinations, isUnsignedReception, createReception, knownReception, mustCompare, readInvitation, receptionReply, relinkReception, sourceOf, undoReception} = __M["js/engine/target/receive.js"];
const {sourceLine} = __M["js/target/source-line.js"];
const {confirmFit, confirmNewTables, confirmOutgoing, destField, mappingBlock} = __M["js/target/dest.js"];
const {backButton, cancelButton, closeButtons, codeField, confirmDialog, controlLine, el, laterButton, message, openWizard, run, versionNote, withHelp} = __M["js/ui.js"];
const {handoffButton, roleGuide} = __M["js/guide.js"];
const {receptionOptions} = __M["js/target/options.js"];
const {tabLink} = __M["js/tab-link.js"];
const {tabSendBlock} = __M["js/tab-link-ui.js"];
const {askWizard, dropWizard} = __M["js/prefs.js"];
const {t} = __M["js/i18n.js"];

const STEP = { code: 0, dest: 1, link: 2, reply: 3 };
const cancel = cancelButton();
const back = backButton;
const flowOf = note => (note.mode === 'echange' ? 'echange' : 'reponse');

function receiveWizard(group, onClose, offered = '') {
  const steps = ['recv.step.code', 'recv.step.dest', 'recv.step.link', 'recv.step.reply'].map(k => t(k));
  const ctx = { steps, onClose, offered, viaTab: Boolean(offered), wizard: openWizard({ title: t('recv.new'), steps, onClose }) };
  return ctx.wizard.start(() => (group ? showLink(ctx, group) : showCode(ctx)));
}

function showCode(ctx) {
  const area = el('textarea', { class: 'code', rows: 4, spellcheck: 'false', 'aria-label': t('recv.invite.title') });
  const report = el('div', { class: 'report' });
  area.value = ctx.offered;
  const next = async () => {
    const invitation = await readInvitation(area.value);
    if (invitation.mode === 'echange' && await syncUnprotected()) return showProtect(ctx);
    ctx.origin = (await docIdentity()).origin; // pour le lien vers le document de la SOURCE (voir sourceLine)
    const known = await knownReception(invitation);
    return known ? showRelink(ctx, known, invitation) : showDest(ctx, invitation);
  };
  ctx.wizard.show(STEP.code, [el('p', {}, t('recv.invite.help')), area, report, roleGuide({ you: 'target', current: 1 })],
    [cancel, { label: t('common.next'), kind: 'btn-primary', onClick: () => run(null, report, next) }]);
  if (ctx.offered && !ctx.offeredRead) { // une seule fois : « Retour » depuis l'étape suivante laisse le code, sans le relire
    ctx.offeredRead = true;
    run(null, report, next);
  }
}

function showProtect(ctx) {
  const report = el('div', { class: 'report' });
  const protect = async () => {
    askWizard('reception'); // le widget qui repart rouvre l'assistant (le rechargement coupe cet appel avant son retour)
    try {
      await protectSync();
    } catch (e) {
      if (known(e)) {
        dropWizard('reception');
        throw e;
      }
    }
    ctx.wizard.show(STEP.code, [message('info', t('common.reloading'))], []);
  };
  ctx.wizard.show(STEP.code, [message('info', t('recv.protect.body'), t('recv.protect.title')), report],
    [cancel, { label: t('recv.protect.ok'), kind: 'btn-primary', onClick: () => run(null, report, protect) }]);
}

const shareText = share => `${share.name} (${[share.folder, share.personal ? t('send.reply.personalSpace') : share.teamName || share.team].filter(Boolean).join(' · ')})`;

async function showRelink(ctx, known, invitation) {
  if (!canRelink(known, invitation)) throw new Error('alreadyReceived');
  const reinforcing = await isUnsignedReception(known);
  const report = el('div', { class: 'report' });
  const relink = async () => showLink(ctx, await relinkReception(known, invitation), message('info', t(reinforcing ? 'recv.relink.renf' : 'recv.relink')));
  ctx.wizard.show(STEP.dest, [message('info', t(reinforcing ? 'recv.relink.confirm.renf' : 'recv.relink.confirm', { name: known.note.name, journal: known.journal })), sourceFiche(invitation, ctx.origin), report],
    [back(() => showCode(ctx)), cancel, { label: t(reinforcing ? 'recv.relink.ok.renf' : 'recv.relink.ok'), kind: 'btn-primary', onClick: () => run(null, report, relink) }]);
}

function sourceFiche(invitation, origin) {
  const { share } = invitation;
  return el('div', {},
    message('info', t('recv.invite.summary', { name: invitation.name, n: invitation.tables.length, tables: invitation.tables.map(tb => tb.table).join(', ') })),
    sourceLine(sourceOf(invitation), { verified: Boolean(share), origin }),
    share ? el('p', { class: 'small' }, t('recv.backDoc', { doc: shareText(share) })) : null,
    share && share.personal ? message('warn', t('recv.backPersonal')) : null,
    invitation.backCode ? controlLine(t('recv.backCode'), invitation.backCode) : null,
    invitation.renforce ? el('p', { class: 'small' }, t('recv.renforce')) : null,
    versionNote(invitation.version, VERSION));
}

async function showDest(ctx, invitation) {
  const schema = await readSchema();
  const rows = invitation.tables.map(tb => ({ tb, pick: destField(schema, tb.table) }));
  const report = el('div', { class: 'report' });
  const reserveBox = el('input', { type: 'checkbox', checked: ctx.reserve !== false });
  const compared = el('input', { type: 'checkbox' });
  const askCompared = mustCompare(invitation);
  const options = ['echange', 'public'].includes(invitation.mode) ? null : receptionOptions(ctx.options || { ask: true });
  const next = async () => {
    ctx.compared = compared.checked; // le moteur refuse sans elle (codeNotCompared)
    ctx.reserve = reserveBox.checked;
    ctx.options = options ? options.read() : {};
    const plans = rows.map(({ tb, pick }) => ({ tb, dest: pick.dest() }));
    const { schema: current, existing } = await checkDestinations(invitation, plans, { compared: ctx.compared });
    const fresh = plans.map(p => p.dest).filter(dest => !current.has(dest));
    if (fresh.length && !(await confirmNewTables(fresh))) return null;
    if (existing.length) return showColumns(ctx, invitation, plans, current);
    return create(ctx, invitation, plans);
  };
  ctx.wizard.show(STEP.dest, [
    sourceFiche(invitation, ctx.origin),
    el('p', {}, t('recv.dest')),
    el('div', { class: 'dest-grid' }, el('span', { class: 'dest-head' }, t('recv.dest.from')), el('span', { class: 'dest-head' }, t('recv.dest.to')),
      ...rows.flatMap(r => [el('span', { class: 'dest-from' }, r.tb.table), r.pick.node])),
    invitation.mode === 'echange' ? withHelp(message('info', t('recv.consent.echange')), t('recv.consent.echange.help'), t('recv.consent.echange.name')) : null,
    withHelp(el('p', { class: 'muted small' }, t(invitation.mode === 'public' ? 'recv.consent.public' : 'recv.consent')),
      t(invitation.mode === 'public' ? 'recv.consent.public.help' : 'recv.consent.help'), t('recv.consent.name')),
    withHelp(el('label', { class: 'check' }, reserveBox, t('recv.reserve')), t('recv.reserve.help'), t('recv.reserve')),
    options ? el('details', { class: 'guide options-more' }, el('summary', {}, t('recv.options.advanced')), options.node) : null,
    askCompared ? el('label', { class: 'check' }, compared, t('recv.backCompared')) : null,
    report, roleGuide({ you: 'target', mode: invitation.mode, current: 1 }),
  ], [back(() => showCode(ctx)), cancel, { label: t('common.next'), kind: 'btn-primary', onClick: () => run(null, report, next) }]);
}

function showColumns(ctx, invitation, plans, schema) {
  const report = el('div', { class: 'report' });
  const blocks = plans.filter(p => schema.has(p.dest)).map(p => ({ p, block: mappingBlock(schema, p.tb.table, p.dest, p.tb.columns) }));
  const next = async () => {
    for (const { p, block } of blocks) Object.assign(p, block.read());
    if (!(await confirmFit(blocks.flatMap(({ block }) => block.issues())))) return null;
    if (invitation.mode === 'echange' && !(await confirmOutgoing(schema, plans.map(p => p.dest), shareText(invitation.share)))) return null;
    return create(ctx, invitation, plans);
  };
  ctx.wizard.show(STEP.dest, [el('p', {}, t('recv.existing')), ...blocks.map(b => b.block.node), report], [
    back(() => showDest(ctx, invitation)),
    { label: t('recv.create'), kind: 'btn-primary', onClick: () => run(null, report, next) },
  ]);
}

async function create(ctx, invitation, plans) {
  const { mode } = invitation;
  const { journal, note, created } = await createReception(invitation, plans, { reserve: ctx.reserve, options: ctx.options, compared: ctx.compared, arrange: true });
  ctx.made = mode === 'reponse' || !mode ? { invitation, journal, created } : null;
  if (mode !== 'public') return showLink(ctx, { journal, note });
  ctx.wizard.setSteps(ctx.steps.slice(0, 2));
  ctx.wizard.show(STEP.link, [message('ok', t('recv.public.done')), roleGuide({ you: 'target', mode: 'public', current: 1 })], closeButtons());
  return null;
}

async function showLink(ctx, group, intro = null) {
  const input = el('input', { type: 'url', class: 'input', spellcheck: 'false', 'aria-label': t('recv.link.title') });
  const report = el('div', { class: 'report' });
  const where = await formWhere(group.journal);
  const made = ctx.made && ctx.made.journal === group.journal ? ctx.made : null;
  ctx.wizard.show(STEP.link, [intro, el('p', {}, t('recv.link.help', { where, n: group.note.tables.length })),
    ...linkFigures(), input, report, roleGuide({ you: 'target', mode: flowOf(group.note), current: 2 })],
  [made ? back(() => run(null, report, () => undoCreate(ctx, made))) : null, laterButton(),
    { label: t('recv.link.check'), kind: 'btn-primary', onClick: () => run(null, report, () => showReply(ctx, group, input.value)) }].filter(Boolean));
}

async function undoCreate(ctx, made) {
  if (!(await confirmDialog({ title: t('recv.undo.title'), body: t('recv.undo.body'), confirmLabel: t('common.back') }))) return null;
  await undoReception(made);
  ctx.made = null;
  return showDest(ctx, made.invitation);
}

async function showReply(ctx, { journal, note }, link) {
  const { code, control } = await receptionReply({ journal, note }, link);
  const flow = flowOf(note);
  const onTab = tabSendBlock({
    texts: { button: t('tab.back.button'), help: t('tab.back.help'), sent: t('tab.back.sent'), done: t('tab.back.got'), silent: t('tab.back.silent') },
    start: (alive, ack) => tabLink().sendReply(code, { alive, onGot: ack }),
    auto: ctx.viaTab,
  });
  ctx.wizard.show(STEP.reply, [message('ok', t('recv.link.ok')), el('p', {}, t('recv.reply.help')), codeField(code),
    controlLine(t('recv.reply.code'), control), onTab,
    handoffButton('source', flow, 3, code),
    roleGuide({ you: 'target', mode: flow, current: 3 })],
  [back(() => showLink(ctx, { journal, note })), ...closeButtons()]);
}
return { receiveWizard };
})();

// ===== js/target/reinforce.js =====
__M["js/target/reinforce.js"] = (() => {
'use strict';
const {GRACE_DAYS, graceEnd, renfState} = __M["js/engine/logic/reinforce.js"];
const {revertReinforcement} = __M["js/engine/target/receive.js"];
const {confirmDialog, notice, run, smallButton} = __M["js/ui.js"];
const {dateText, t} = __M["js/i18n.js"];
const {receiveWizard} = __M["js/target/wizard.js"];

const DONE_SHOWN_S = 30 * 86400; // « Partage renforcé » reste affiché un mois
const nowS = () => Math.floor(Date.now() / 1000);

function reinforceKind(group, now = nowS()) {
  const state = renfState(group.note, now);
  if (state === 'done') return now - group.note.renf.done < DONE_SHOWN_S ? 'done' : '';
  if (state !== 'none') return state;
  return group.unsigned && !group.waiting && !group.public ? 'suggest' : '';
}

function reinforceNotes(group, { rerender, out, readOnly = false }) {
  const kind = reinforceKind(group);
  const end = dateText(graceEnd(group.note) * 1000);
  const start = () => receiveWizard(null, rerender);
  const again = () => receiveWizard(group, rerender);
  const revert = async (event) => {
    const ok = await confirmDialog({ title: t('recv.renf.revert.title'), body: t('recv.renf.revert.body'), confirmLabel: t('recv.renf.revert'), kind: 'btn-primary' });
    if (!ok) return;
    await run(event.currentTarget, out(), async () => { await revertReinforcement(group.journal); await rerender(); });
  };
  const act = (label, onClick, primary = false, icon = 'link') => smallButton(label, icon, onClick, { kind: primary ? 'btn-primary' : '', disabled: readOnly });
  const make = ({ tone, title, lines, actions = [] }) => notice({ tone, title, lines, 'data-renf': kind, actions });
  switch (kind) {
    case 'suggest':
      return make({ tone: 'info', title: t('recv.renf.suggest.title'), lines: [t('recv.renf.suggest.body'), t('recv.renf.suggest.safe')], actions: [act(t('recv.renf.start'), start, true)] });
    case 'pending':
      return make({ tone: 'info', title: t('recv.renf.pending.title'), lines: [t('recv.renf.pending.body', { end, days: GRACE_DAYS }), t('recv.renf.pending.safe')], actions: [act(t('recv.renf.reply'), again), act(t('recv.renf.revert'), revert, false, 'undo')] });
    case 'expired':
      return make({ tone: 'err', title: t('recv.renf.expired.title'), lines: [t('recv.renf.expired.body', { end }), t('recv.renf.expired.how')], actions: [act(t('recv.renf.reply'), again, true), act(t('recv.renf.revert'), revert, false, 'undo')] });
    case 'done':
      return make({ tone: 'info', title: '', lines: [t('recv.renf.done', { at: dateText(group.note.renf.done * 1000) })] });
    default:
      return null;
  }
}
return { reinforceKind, reinforceNotes };
})();

// ===== js/target/restyle.js =====
__M["js/target/restyle.js"] = (() => {
'use strict';
const {el, message, openModal} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

function itemView(item) {
  const state = item.kind === 'default' ? { data: 'defData', other: 'defOther', same: 'defSame' }[item.state] : item.state;
  const head = item.ok ? t(`recv.formulas.state.${state}`) : t('recv.formulas.refused');
  const kind = item.kind === 'default' ? ` · ${t('recv.formulas.kind.default')}` : '';
  return el('li', { class: 'formula-item' },
    el('div', {}, el('strong', {}, item.label === item.to ? item.to : `${item.label} (${item.to})`), el('span', { class: 'muted small' }, `${kind} · ${head}`)),
    el('pre', { class: 'code formula-code' }, item.formula),
    item.problems.length ? el('ul', { class: 'small' }, item.problems.map(p => el('li', {}, t(`recv.formulas.problem.${p.code}`, { name: p.name, to: p.to || '' })))) : null);
}

function restyleDialog({ name, kinds, owner, formulas }) {
  return new Promise((resolve) => {
    const plain = kinds.filter(kind => kind !== 'formulas');
    const chosen = new Set(plain);
    const items = formulas.flatMap(f => f.items);
    const todo = items.filter(i => i.ok && i.state !== 'same').length;
    let answered = false;
    let read = false;
    const refresh = () => modal.setButtons(buttons());
    const boxes = plain.map((kind) => {
      const box = el('input', { type: 'checkbox', checked: true, onchange: () => { if (box.checked) chosen.add(kind); else chosen.delete(kind); refresh(); } });
      return el('label', { class: 'check' }, box, t(`recv.restyle.${kind}`));
    });
    const sure = el('input', { type: 'checkbox', onchange: () => { read = sure.checked; refresh(); } });
    const panel = el('div', { class: 'form formulas-panel hidden' },
      message('warn', t('recv.formulas.intro')), el('p', { class: 'small' }, t('recv.formulas.replaces')),
      formulas.map(f => [el('h3', {}, t('recv.formulas.table', { table: f.table })), el('ul', { class: 'formula-list' }, f.items.map(itemView))]),
      el('label', { class: 'check' }, sure, t('recv.formulas.read')));
    const formulaBox = () => {
      if (!kinds.includes('formulas')) return null;
      if (!owner) return el('p', { class: 'muted small' }, t('recv.restyle.formulas.owner'));
      const box = el('input', {
        type: 'checkbox', checked: false, disabled: !todo,
        onchange: () => { if (box.checked) chosen.add('formulas'); else chosen.delete('formulas'); panel.classList.toggle('hidden', !box.checked); refresh(); },
      });
      return el('div', { class: 'form formulas-box' }, el('label', { class: 'check' }, box, t('recv.restyle.formulas'),
        el('span', { class: 'muted small' }, ` · ${todo ? t('recv.formulas.count', { n: todo }) : t('recv.formulas.none')}`)), panel);
    };
    const buttons = () => [
      { label: t('common.cancel'), onClick: (m) => { answered = true; resolve(null); m.close(); } },
      { label: t('recv.restyle.confirm'), kind: 'btn-primary', disabled: !chosen.size || (chosen.has('formulas') && !read), onClick: (m) => { answered = true; resolve(new Set(chosen)); m.close(); } },
    ];
    const modal = openModal({
      title: t('recv.restyle.title', { name }), width: 720, buttons: buttons(),
      body: el('div', {}, el('p', {}, t('recv.restyle.body')), el('div', { class: 'form' }, ...boxes), formulaBox()),
      onClose: () => { if (!answered) resolve(null); },
    });
    modal.footer.querySelector('button').focus();
  });
}
return { restyleDialog };
})();

// ===== js/target/structure.js =====
__M["js/target/structure.js"] = (() => {
'use strict';
const {approveStructure, state, tableKey} = __M["js/engine/target/loop.js"];
const {confirmDialog, el, notice, run, smallButton} = __M["js/ui.js"];
const {t, typeName} = __M["js/i18n.js"];

function details(group) {
  return group.note.tables.flatMap((entry) => {
    const found = (state.results.get(tableKey(group.journal, entry.table)) || {}).structure;
    if (!found) return [];
    const where = { table: entry.table, dest: entry.dest };
    return [
      ...found.held.map(c => ({ held: true, text: t('recv.structure.held.line', { ...where, col: c.label, to: c.to, type: typeName(c.type) }) })),
      ...found.gone.map(c => ({ held: false, text: t('recv.structure.gone.line', { ...where, col: c.id, to: c.to }) })),
      ...found.retyped.map(c => ({ held: false, text: t('recv.structure.retyped.line', { ...where, col: c.id, to: c.to, sent: typeName(c.sent), here: typeName(c.here) }) })),
    ];
  });
}

function adoptions(group) {
  return group.note.tables.flatMap((entry) => {
    const found = (state.results.get(tableKey(group.journal, entry.table)) || {}).structure;
    return found && found.adoption ? [{ table: entry.table, dest: entry.dest, ...found.adoption }] : [];
  });
}

function adoptionBlock(item) {
  const lines = [
    item.added ? t('recv.adopt.add', { n: item.added }) : null,
    item.attached ? t('recv.adopt.attach', { n: item.attached, match: item.match }) : null,
    item.overwritten ? t('recv.adopt.over', { n: item.overwritten }) : null,
    item.filled ? t('recv.adopt.fill', { n: item.filled }) : null,
    item.untouched ? t('recv.adopt.untouched', { n: item.untouched }) : null,
  ].filter(Boolean);
  return el('li', {},
    el('strong', {}, t('recv.adopt.table', { table: item.table, dest: item.dest })),
    el('ul', { class: 'small' }, ...lines.map(line => el('li', {}, line)), ...item.samples.map(sample => el('li', { class: 'muted' }, t('recv.adopt.sample', sample)))),
    !item.match && item.added && item.untouched ? el('p', { class: 'small' }, t('recv.adopt.nomatch')) : null);
}

function structureNotes(group, { rerender, out, readOnly = false }) {
  if (group.waiting || group.public || group.note.mode === 'echange') return [];
  const items = details(group);
  const adopt = adoptions(group);
  if (!items.length && !adopt.length) return [];
  const held = items.filter(i => i.held).length;
  const act = async (event, auto) => {
    if (auto && !(await confirmDialog({ title: t('recv.structure.auto.title'), body: t('recv.structure.auto.body'), confirmLabel: t('recv.structure.auto.confirm'), kind: 'btn-primary' }))) return;
    await run(event.currentTarget, out(), async () => { await approveStructure(group.journal, { auto }); await rerender(); });
  };
  const action = (label, auto, primary) => smallButton(label, auto ? 'settings' : 'check', e => act(e, auto), { kind: primary ? 'btn-primary' : '', disabled: readOnly });
  const buttons = (label, ask) => [action(label, false, true), ask ? action(t('recv.structure.auto.action'), true, false) : null].filter(Boolean);
  return [
    adopt.length ? notice({
      tone: 'warn', className: 'structure', 'data-structure': 'adopt',
      title: t('recv.adopt.title', { dest: adopt.map(a => a.dest).join(', ') }),
      lines: [t('recv.adopt.body')],
      body: [el('ul', { class: 'small structure-list' }, ...adopt.map(adoptionBlock))],
      actions: buttons(t('recv.structure.apply'), group.note.ask),
    }) : null,
    items.length ? notice({
      tone: held ? 'warn' : 'info', className: 'structure', 'data-structure': held ? 'held' : 'info',
      title: held ? t('recv.structure.held.title', { n: held }) : t('recv.structure.info.title'),
      lines: [t(held ? 'recv.structure.held.body' : 'recv.structure.info.body')],
      body: [el('ul', { class: 'small structure-list' }, ...items.map(item => el('li', {}, item.text)))],
      actions: adopt.length ? [] : buttons(t(held ? 'recv.structure.apply' : 'recv.structure.ok'), group.note.ask),
    }) : null,
  ].filter(Boolean);
}
return { structureNotes };
})();

// ===== js/target/widget-page.js =====
__M["js/target/widget-page.js"] = (() => {
'use strict';
const {addWidgetToPage, widgetSpots} = __M["js/engine/pages.js"];
const {servedAt} = __M["js/config.js"];
const {el, openModal, pickField} = __M["js/ui.js"];
const {t} = __M["js/i18n.js"];

let spots = new Map(); // table -> { view, there }, relu à chaque ouverture de l'onglet (pas à chaque redessin périodique)

const receivingTables = group => [...new Set(group.note.tables.map(tb => tb.dest))];

async function readWidgetSpots(groups) {
  const dests = [...new Set(groups.filter(g => !g.waiting && !g.note.retour).flatMap(receivingTables))];
  spots = new Map(); // pas de bouton « ajouter le widget » dans le Constructeur
  void dests;
}

function widgetCandidates(group) {
  if (group.waiting || group.note.retour) return [];
  const dests = receivingTables(group).filter(dest => spots.has(dest));
  return dests.some(dest => spots.get(dest).there) ? [] : dests.filter(dest => spots.get(dest).view);
}

const widgetLabel = candidates => (candidates.length === 1 ? t('recv.widget.add', { table: candidates[0] }) : t('recv.widget.addSome'));

function chooseTable(candidates) {
  return new Promise((resolve) => {
    let answered = false;
    const field = candidates.length > 1 ? pickField({ items: candidates.map(dest => ({ value: dest, label: dest })), value: candidates[0], label: t('recv.widget.pick') }) : null;
    const table = field ? t('recv.widget.chosen') : candidates[0];
    const answer = (value, modal) => { answered = true; resolve(value); modal.close(); };
    openModal({
      title: t('recv.widget.title'), width: 480,
      body: el('div', {}, el('p', {}, t('recv.widget.body', { table })), field ? el('div', { class: 'form' }, el('label', {}, t('recv.widget.pick')), field) : null,
        el('p', { class: 'small muted' }, t('recv.widget.access'))),
      onClose: () => { if (!answered) resolve(null); },
      buttons: [
        { label: t('common.cancel'), onClick: modal => answer(null, modal) },
        { label: t('recv.widget.ok'), kind: 'btn-primary', onClick: modal => answer(field ? field.value() : candidates[0], modal) },
      ],
    });
  });
}

async function addWidgetFor(group) {
  const dest = await chooseTable(widgetCandidates(group));
  if (!dest) return null;
  const { added } = await addWidgetToPage(dest, servedAt());
  return { dest, added };
}
return { readWidgetSpots, widgetCandidates, widgetLabel, addWidgetFor };
})();

// ===== js/target/tab.js =====
__M["js/target/tab.js"] = (() => {
'use strict';
const {RECEIVED_COL, TYPE_COL, isBlank} = __M["js/engine/logic/common.js"];
const {REFUSED, STATES, awaitingPartner} = __M["js/engine/logic/journal.js"];
const {FILE_MAX, fileList} = __M["js/engine/logic/files.js"];
const {docIdentity, fetchRows, isOwner, isReadOnly, journalStats, readSchema} = __M["js/grist.js"];
const {diagnostic} = __M["js/diagnostic.js"];
const {syncRules} = __M["js/engine/acl.js"];
const {dropPages, ensureForm, formPages, removeTechnicalTables, renewFormLink} = __M["js/engine/pages.js"];
const {closeExport} = __M["js/engine/exchange.js"];
const {updateJournalNote} = __M["js/engine/target/journals.js"];
const {dismissLost, markReceptions, readLost} = __M["js/engine/target/lost.js"];
const {receivedJournals, receivedKey} = __M["js/engine/logic/received.js"];
const {currencyOf, formatGap} = __M["js/engine/logic/docformat.js"];
const {consolidateAll, decide, forgetJournal, isAccessError, relink, restoreSource, restyle, state, tableKey} = __M["js/engine/target/loop.js"];
const {alignDocFormat, readDocFormat} = __M["js/engine/target/style.js"];
const {SHOWN} = __M["js/engine/logic/report.js"];
const {TALLY_GRACE_S} = __M["js/engine/logic/tally.js"];
const {uploadErrors} = __M["js/engine/target/files.js"];
const {offerDialog} = __M["js/target/dest.js"];
const {rulesRefusedNotice} = __M["js/rules-notice.js"];
const {wizardAsked} = __M["js/prefs.js"];
const {protectMemos} = __M["js/engine/source/synchro.js"];
const {cleanJournal} = __M["js/engine/target/clean.js"];
const {ownsSync} = __M["js/engine/logic/strays.js"];
const {optionsDialog} = __M["js/target/options.js"];
const {restyleDialog} = __M["js/target/restyle.js"];
const {addWidgetFor, readWidgetSpots, widgetCandidates, widgetLabel} = __M["js/target/widget-page.js"];
const {receiveWizard} = __M["js/target/wizard.js"];
const {reinforceKind, reinforceNotes} = __M["js/target/reinforce.js"];
const {structureNotes} = __M["js/target/structure.js"];
const {sourceLine} = __M["js/target/source-line.js"];
const {cancelButton, confirmDialog, copyField, el, errorText, icon, message, noteError, notice, openModal, pickField, pill, redraw, reloading, run, smallButton} = __M["js/ui.js"];
const {roleGuide} = __M["js/guide.js"];
const {LANG, dateText, t, timeText} = __M["js/i18n.js"];

const HISTORY_MAX = 20;
let container;
let wizardOpened = false; // l'assistant ne se rouvre seul qu'une fois par chargement
let flash = null; // { node, until }
const NOTICE_MS = 60000;
const lastNotice = () => (flash && Date.now() < flash.until ? flash.node : null);
const offered = new Set(); // tables déjà proposées en fenêtre pendant ce chargement
let lostList = []; // réceptions dont le journal a été supprimé, relues à chaque ouverture de l'onglet (voir readLost)
const opened = new Set();
const keepOpen = id => e => (e.currentTarget.open ? opened.add(id) : opened.delete(id));

async function refreshTarget() {
  if (container && container.isConnected) await renderTarget(container, { periodic: true });
}

async function receivedGroups(schema, owner) {
  const forms = await formPages();
  const docHere = await readDocFormat().catch(() => null); // langue et monnaie de ce document (voir formatNotes)
  const groups = [];
  for (const { journal, note } of receivedJournals(schema).filter(r => !awaitingPartner(r.note))) {
    const known = state.results.get(journal);
    const rows = known && Number.isFinite(known.rows) ? known.rows : (await fetchRows(journal)).length;
    const waiting = note.mode !== 'public' && !note.retour && !rows;
    const stats = waiting ? null : await journalStats(journal, RECEIVED_COL, TYPE_COL);
    groups.push({ journal, note, public: note.mode === 'public', waiting, ...receptionFlags({ schema, journal, note, waiting, owner, forms }), owner, docHere, stats, shared: (forms.get(journal) || {}).shared || 0 });
  }
  return groups;
}

function receptionFlags({ schema, journal, note, waiting, owner, forms }) {
  const linked = note.mode !== 'public';
  return {
    unsigned: linked && !note.sceau && !receivedKey(schema, journal, note),
    unreserved: Boolean(note.reserve) && !note.reserved && !owner,
    formGone: linked && !note.retour && !waiting && !forms.has(journal),
  };
}

async function reinforceReceptions() {
  const schema = await readSchema();
  return receivedJournals(schema).filter(({ journal, note }) => note.mode === 'reponse' || !note.mode)
    .filter(({ journal, note }) => !note.retour && !note.sceau && !receivedKey(schema, journal, note)).length;
}

const button = (label, iconName, onclick, kind = '') => smallButton(label, iconName, onclick, { kind, disabled: state.readOnly });

let here = '';
const knowHere = async () => { here ||= await docIdentity().then(d => d.origin, () => ''); };

const receiveOffered = code => receiveWizard(null, renderTarget, code);

async function prepareReceptions(groups, { owner, periodic }, out) {
  try {
    for (const group of groups.filter(g => g.waiting && !periodic)) await ensureForm(group.journal, { below: group.note.tables.map(tb => tb.dest), note: group.note });
    if (!periodic && owner) await markReceptions(groups.filter(g => !g.waiting)).catch(e => console.warn(e)); // un détail : jamais une raison de passer en lecture seule
    if (!periodic) lostList = await readLost();
    if (!periodic) await readWidgetSpots(groups);
  } catch (e) {
    if (isAccessError(e)) state.readOnly = true;
    else out.append(message('err', errorText(e)));
  }
}

function targetToolbar(groups, out) {
  const sync = async () => { if ((await consolidateAll({ reread: true })) === false) out.replaceChildren(message('ok', t('recv.sync.none'))); };
  return el('div', { class: 'toolbar' },
    el('button', { class: 'btn btn-primary', type: 'button', disabled: state.readOnly, onclick: () => receiveWizard(null, renderTarget) }, icon('plus'), t('recv.new')),
    el('button', { class: 'btn', type: 'button', disabled: state.readOnly || !groups.length, onclick: e => run(e.currentTarget, out, sync) }, icon('refresh'), t('recv.action.sync')));
}

async function renderTarget(root = container, { periodic = false } = {}) {
  if (!container) state.viewer = isReadOnly();
  await knowHere();
  container = root;
  state.readOnly ||= state.viewer;
  const owner = !state.readOnly && await isOwner().catch(() => true);
  if (!periodic && owner && await syncRules()) {
    reloading(container, renderTarget);
    return;
  }
  const schema = await readSchema();
  if (!periodic && owner && ownsSync(schema)) await protectMemos(); // Échange : le webhook de retour garde la fiche de la SOURCE hors de son mémo
  const groups = await receivedGroups(schema, owner || state.viewer);
  const out = el('div', { class: 'out' }, lastNotice());
  await prepareReceptions(groups, { owner, periodic }, out);
  redraw(container, targetPage(groups, groups.map(safeCard), { owner, out }));
  if (!state.readOnly) await openPending(groups, periodic);
  if (!periodic && !state.readOnly && wizardAsked('reception', { consume: true }) && !document.querySelector('.scrim')) receiveWizard(null, renderTarget);
}

function targetPage(groups, cards, { owner, out }) {
  const empty = el('p', { class: 'muted' }, t(state.readOnly ? 'recv.emptyViewer' : 'recv.empty'));
  return [targetToolbar(groups, out),
    state.readOnly ? message('warn', t('common.readonly')) : null,
    owner ? rulesRefusedNotice() : null,
    out,
    lostList.length ? el('div', { class: 'cards' }, lostList.map(lost => lostCard(lost, owner))) : null,
    cards.length ? el('div', { class: 'cards' }, cards, el('p', { class: 'muted small', title: t('recv.auto.detail') }, t('recv.auto'))) : empty,
    roleGuide({ you: 'target' })].filter(Boolean);
}

async function openPending(groups, periodic) {
  if (!periodic) dropPages(groups.map(g => g.journal)).catch(() => {});
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
    run(null, container.querySelector('.out'), () => offerDialog(group, offer, renderTarget));
    return;
  }
}

function cardStatus(group) {
  const { journal, note } = group;
  if (group.waiting) return ['waiting', 'pending'];
  if (note.ended) return ['ended', 'off'];
  if (reinforceKind(group) === 'expired') return ['error', 'err'];
  const tables = note.tables.map(tb => state.results.get(tableKey(journal, tb.table)) || {});
  if ((state.results.get(journal) || {}).error || tables.some(r => r.error)) return ['error', 'err'];
  if (tables.some(r => r.pendingCount || (r.structure && (r.structure.adoption || r.structure.held.length)))) return ['review', 'pending'];
  const incomplete = Object.keys({ ...note.missing, ...note.big, ...(state.results.get(journal) || {}).tally }).length || tables.some(r => r.files && (r.files.waiting || r.files.held));
  if (incomplete) return ['incomplete', 'pending'];
  return widgetCandidates(group).length ? ['widget', 'pending'] : ['ok', 'ok'];
}

const MB = 1024 * 1024;
const megabytes = bytes => (bytes / MB).toLocaleString(LANG, { maximumFractionDigits: 1 });
function filesNotes(group, entry) {
  const { files } = state.results.get(tableKey(group.journal, entry.table)) || {};
  if (!files) return null;
  const named = list => list.map(f => t('recv.files.named', { name: f.name, size: megabytes(f.size) })).join(', ');
  return [
    files.public ? message('info', t('recv.files.public', { dest: entry.dest })) : null,
    files.held ? message('info', t('recv.files.held', { n: files.held, dest: entry.dest }))
      : files.waiting ? message('info', t('recv.files.waiting', { n: files.waiting, dest: entry.dest })) : null,
    files.big.length ? message('warn', t(files.held ? 'recv.files.bigHeld' : 'recv.files.big', { files: named(files.big), max: FILE_MAX / MB })) : null,
  ];
}

function tableLine(group, entry) {
  const journalResult = state.results.get(group.journal) || {};
  const result = state.results.get(tableKey(group.journal, entry.table)) || (journalResult.error ? journalResult : null);
  const detail = result && !group.waiting ? ` · ${timeText(result.at)}${result.error ? ` · ${result.text}` : ''}` : '';
  return el('p', { class: `small ${result && result.error ? 'text-danger' : 'muted'}` }, `${entry.table} → ${entry.dest}${detail}`);
}

const cardNotes = group => [arrivalNotes(group), ...stateNotes(group), ...structureNotes(group, { rerender: renderTarget, out: () => container.querySelector('.out'), readOnly: state.readOnly }), ...gapNotes(group), ...formatNotes(group), ...linkNotes(group)];

function stateNotes(group) {
  const { note } = group;
  const locked = note.tables.some(entry => (state.results.get(tableKey(group.journal, entry.table)) || {}).locked);
  return [
    note.ended ? message('warn', t('recv.ended', { at: dateText(note.ended * 1000) })) : null,
    group.formGone ? message('err', t('recv.formGone')) : null,
    reinforceNotes(group, { rerender: renderTarget, out: () => container.querySelector('.out'), readOnly: state.readOnly }),
    group.unreserved ? message('info', t('recv.reserve.owner')) : null,
    locked ? message('info', t('recv.lock.waiting')) : null,
  ];
}

function formatNotes(group) {
  const { note } = group;
  const source = (note.tables.find(entry => entry.sourceDoc) || {}).sourceDoc;
  const gap = source && group.docHere && note.mode !== 'echange' ? formatGap(source, group.docHere) : null;
  if (!gap) return [];
  const label = format => [format.locale || 'en-US', currencyOf(format)].filter(Boolean).join(' · ');
  const align = async () => {
    if (!(await confirmDialog({ title: t('recv.format.confirmTitle'), body: t('recv.format.confirmBody', { source: label(source) }), confirmLabel: t('recv.format.action'), kind: 'btn-primary' }))) return;
    await alignDocFormat(source);
    flash = { node: message('ok', t('recv.format.done', { source: label(source) })), until: Date.now() + NOTICE_MS };
    await renderTarget();
  };
  return [notice({
    tone: 'info', className: 'format', title: t('recv.format.title'),
    lines: [t('recv.format.body', { source: label(source), here: label(group.docHere) }), group.owner ? null : t('recv.format.owner')],
    actions: group.owner ? [button(t('recv.format.action'), 'settings', e => run(e.currentTarget, container.querySelector('.out'), align))] : [],
  })];
}

const sentKinds = group => [...new Set(group.note.tables.flatMap(entry => entry.sends || []))];

async function restyleReception(group) {
  const kinds = sentKinds(group);
  const formulas = kinds.includes('formulas')
    ? group.note.tables.map(entry => ({ table: entry.dest, items: (state.results.get(tableKey(group.journal, entry.table)) || {}).formulas || [] })).filter(f => f.items.length)
    : [];
  const chosen = await restyleDialog({ name: group.note.name, kinds, owner: group.owner, formulas });
  if (!chosen || !chosen.size) return;
  await restyle(group.journal, Object.fromEntries([...chosen].map(kind => [kind, true])));
  flash = { node: message('ok', t('recv.restyle.done')), until: Date.now() + NOTICE_MS };
  await renderTarget();
}

function gapNotes(group) {
  const { note } = group;
  return [
    Object.entries(note.missing || {}).map(([table, n]) => message('warn', t('recv.missing', { table, n }))),
    Object.entries((state.results.get(group.journal) || {}).tally || {}).map(([table, g]) => message('warn', t('recv.tally', { table, ...g, min: TALLY_GRACE_S / 60 }))),
    Object.entries(note.big || {}).map(([table, keys]) => message('warn', t('recv.big', { table, n: keys.length }))),
    (note.tooBig || []).length ? message('warn', t('recv.tooBig', { tables: note.tooBig.join(', ') })) : null,
  ];
}

function linkNotes(group) {
  const { note } = group;
  return [
    group.shared && !group.public ? alertBlock(t('recv.shared.title'), [t('recv.shared.body', { n: group.shared })], [button(t('recv.suspect.cut'), 'unlink', () => cutLink(group), 'btn-danger-text')]) : null,
    note.suspect ? suspectBlock(group) : null,
    (state.offers.get(group.journal) || []).map(o => el('div', { class: 'offer' }, el('span', { class: 'small' }, t('recv.offer.line', { table: o.table, n: o.n })),
      button(t('recv.offer.place'), 'plus', e => run(e.currentTarget, container.querySelector('.out'), () => offerDialog(group, o, renderTarget)), 'btn-primary'))),
    note.refused.length ? el('p', { class: 'muted small' }, t('recv.offer.refusedList', { tables: note.refused.join(', ') })) : null,
  ];
}

function arrivalNotes({ stats, waiting }) {
  if (waiting || !stats || !stats.n) return null;
  return [
    stats.last ? el('p', { class: 'muted small' }, t('recv.arrival', { at: dateText(stats.last * 1000), n: stats.n })) : null,
    stats.raw ? message('info', t('recv.arrival.raw', { n: stats.raw })) : null,
  ];
}

const reportButton = () => smallButton(t('recv.action.report'), 'copy', (e) => {
  const out = e.currentTarget.closest('.card').querySelector('.report-out');
  return run(e.currentTarget, out, () => copyReport(out));
});

async function copyReport(out) {
  const text = await diagnostic();
  try {
    await navigator.clipboard.writeText(text);
    out.replaceChildren(message('ok', t('recv.report.copied')));
  } catch (e) {
    out.replaceChildren(message('warn', t('recv.report.failed')), copyField(text, t('recv.action.report')));
  }
}

function syncCard(group) {
  const { note } = group;
  const [status, tone] = cardStatus(group);
  return el('article', { class: 'card', 'data-journal': group.journal },
    el('div', { class: 'card-head' }, el('strong', {}, note.name), pill(t(`recv.status.${status}`), tone)),
    cardOrigin(group),
    note.tables.map(entry => tableLine(group, entry)),
    widgetNotice(group),
    cardNotes(group),
    note.tables.map(entry => filesNotes(group, entry)),
    uploadErrors(group.journal).map(e => message('warn', t('recv.files.refused', { name: e.name, error: e.error }))),
    note.tables.map(entry => [reviewBlock(group, entry), gapBlock(group, entry), driftBlock(group, entry), linksBlock(group, entry)]),
    group.waiting ? null : history(group),
    el('div', { class: 'report-out' }),
    el('div', { class: 'card-actions' },
      group.public || note.retour ? null : linkButton(group),
      group.public || note.mode === 'echange' ? null : button(t('recv.action.options'), 'settings', () => optionsDialog(group, group.owner, renderTarget)),
      group.waiting || note.mode === 'echange' || !sentKinds(group).length ? null : button(t('recv.action.restyle'), 'column', e => run(e.currentTarget, container.querySelector('.out'), () => restyleReception(group))),
      group.waiting || !group.owner ? null : button(t('recv.action.clean'), 'trash', e => run(e.currentTarget, container.querySelector('.out'), () => cleanReception(group))),
      group.waiting ? null : reportButton(),
      button(t('recv.action.stop'), 'stop', () => stopReceiving(group), 'btn-danger-text')));
}

function widgetNotice(group) {
  const candidates = widgetCandidates(group);
  if (!candidates.length) return null;
  const add = async () => {
    const done = await addWidgetFor(group);
    if (!done) return;
    flash = { node: message(done.added ? 'ok' : 'info', t(done.added ? 'recv.widget.done' : 'recv.widget.already', { table: done.dest })), until: Date.now() + NOTICE_MS };
    await renderTarget();
  };
  return notice({
    tone: 'warn', title: t('recv.widget.missing.title'), 'data-widget-missing': '',
    lines: [candidates.length === 1 ? t('recv.widget.missing.one', { table: candidates[0] }) : t('recv.widget.missing.some'), t('recv.widget.missing.next')],
    actions: [button(widgetLabel(candidates), 'plus', e => run(e.currentTarget, container.querySelector('.out'), add), 'btn-primary')],
  });
}

function cardOrigin({ note, public: isPublic }) {
  return [
    sourceLine(note.from, { verified: note.mode === 'echange', origin: here }),
    isPublic ? el('p', { class: 'muted small' }, t('recv.public')) : null,
    note.mode === 'echange' ? el('p', { class: 'muted small' }, t(note.retour ? 'recv.exchange.back' : 'recv.exchange')) : null,
  ];
}

const linkButton = group => button(t(group.waiting ? 'recv.action.continue' : 'recv.action.link'), 'link',
  () => receiveWizard(group, renderTarget), group.waiting ? 'btn-primary' : '');

function lostCard(lost, owner) {
  const list = there => lost.dests.filter(d => d.there === there).map(d => d.dest);
  const [gone, kept] = [list(false), list(true)];
  const clean = async () => {
    await dismissLost(lost);
    lostList = lostList.filter(l => l !== lost);
    await renderTarget();
  };
  return el('article', { class: 'card', 'data-lost-reception': lost.journal },
    el('div', { class: 'card-head' }, el('strong', {}, t('recv.lost.title', { name: lost.name || lost.journal })), pill(t('recv.status.error'), 'err')),
    el('p', { class: 'small' }, t('recv.lost.body', { journal: lost.journal })),
    gone.length ? el('p', { class: 'small' }, t('recv.lost.gone', { list: gone.join(', '), n: gone.length })) : null,
    kept.length ? el('p', { class: 'small' }, t('recv.lost.kept', { list: kept.join(', '), n: kept.length })) : null,
    el('p', { class: 'small' }, t('recv.lost.effect')),
    el('p', { class: 'small' }, t('recv.lost.how')),
    el('div', { class: 'card-actions' }, owner
      ? button(t('recv.lost.clean'), 'trash', e => run(e.currentTarget, container.querySelector('.out'), clean), 'btn-danger-text')
      : el('span', { class: 'muted small' }, t('recv.lost.owner'))));
}

function safeCard(group) {
  try {
    return syncCard(group);
  } catch (e) {
    console.error(e);
    noteError(e);
    return el('article', { class: 'card', 'data-journal': group.journal },
      el('div', { class: 'card-head' }, el('strong', {}, String(group.note.name || group.journal)), pill(t('recv.status.error'), 'err')),
      message('err', errorText(e)),
      el('div', { class: 'card-actions' },
        group.public ? null : button(t('recv.suspect.cut'), 'unlink', () => cutLink(group), 'btn-danger-text'),
        button(t('recv.action.stop'), 'stop', () => stopReceiving(group), 'btn-danger-text')));
  }
}

const alertBlock = (title, lines, actions) => notice({ tone: 'warn', className: 'suspect', title, lines, actions });

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
  ], [button(t('recv.suspect.cut'), 'unlink', () => cutLink(group), 'btn-danger-text'), button(t('recv.suspect.dismiss'), 'ignore', dismiss)]);
}

async function cutLink(group) {
  if (!(await confirmDialog({ title: t('recv.cut.title'), body: t('recv.cut.body'), confirmLabel: t('recv.suspect.cut') }))) return;
  await updateJournalNote(group.journal, ({ suspect, ...note }) => note);
  await renewFormLink(group.journal);
  flash = { node: message('ok', t('recv.cut.done')), until: Date.now() + NOTICE_MS };
  await renderTarget();
}

async function cleanReception(group) {
  const body = [el('p', {}, t('recv.clean.body')), el('p', { class: 'muted small' }, t('recv.clean.limits'))];
  if (!(await confirmDialog({ title: t('recv.clean.title', { name: group.note.name }), body, confirmLabel: t('recv.clean.confirm') }))) return;
  const done = await cleanJournal(group.journal);
  state.results.clear();
  await consolidateAll();
  if (done) flash = { node: message('ok', t('recv.clean.done', done)), until: Date.now() + NOTICE_MS };
  await renderTarget();
}

async function stopReceiving(group) {
  const { note } = group;
  const exchange = note.mode === 'echange';
  const body = t(exchange ? 'send.revoke.exchange' : 'recv.stop.body', { journal: group.journal });
  if (!(await confirmDialog({ title: t('recv.stop.title', { name: note.name }), body, confirmLabel: t('recv.action.stop') }))) return;
  if (exchange) await closeExport(note.export, { keepExport: Boolean(note.retour) });
  else await removeTechnicalTables([group.journal]);
  forgetJournal(group.journal);
  await renderTarget();
}

function cellText(value, type = '') {
  if (type === 'Attachments' && Array.isArray(value)) return filesText(value);
  if (Array.isArray(value)) return value[0] === 'L' ? value.slice(1).join(', ') : JSON.stringify(value);
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (typeof value === 'number' && /^Date/.test(type)) return dateCell(value, type);
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function filesText(value) {
  const files = fileList(value);
  return files.length ? files.map(file => file.name).join(', ') : t('recv.files.count', { n: value.length - (value[0] === 'L' ? 1 : 0) });
}

function dateCell(value, type) {
  const zone = type.startsWith('DateTime:') ? type.slice(9) : 'UTC';
  try {
    const date = new Date(value * 1000);
    return type.startsWith('DateTime') ? date.toLocaleString(LANG, { timeZone: zone }) : date.toLocaleDateString(LANG, { timeZone: 'UTC' });
  } catch (e) {
    return String(value);
  }
}

const cell = (value, type, kind = '') => {
  if (isBlank(value)) return el('td', { class: `${kind} mg-blank` }, t('common.blank'));
  const text = cellText(value, type);
  return el('td', { class: kind, title: text }, text);
};

const valuesRow = (kind, heading, values, typesOf) => el('tr', { class: `mg-${kind}` }, el('th', { scope: 'row' }, heading),
  values.map((v, i) => cell(v, typesOf(i))));

const changeHead = ({ n, state: change, label }, nTitle = null) => [
  el('span', { class: 'chg-n', title: nTitle }, n ? String(n) : ''),
  el('span', { class: 'chg-dot', title: t(`recv.history.${change}`) }, icon(STATE_ICON[change])),
  el('span', { class: 'chg-label' }, label || '—'),
  el('span', { class: 'chg-state' }, t(`recv.history.${change}`))];

const miniGrid = (head, rows) => el('div', { class: 'mini-grid-wrap' }, el('table', { class: 'mini-grid' },
  el('thead', {}, el('tr', {}, head.map(h => el('th', { scope: 'col' }, h)))), el('tbody', {}, rows)));

function diffGrid(lines, { types = {}, labelCol = '', otherHead }) {
  const said = (text, span) => el('td', { class: 'mg-here', colspan: String(span) }, text);
  const head = l => [el('td', { class: 'mg-n' }, l.n ? String(l.n) : ''), el('td', { title: l.label }, l.label)];
  const all = lines.flatMap((l, i) => {
    if (l.col) return [[i, el('tr', {}, el('td', {}), el('td', {}), el('td', {}, l.col), said(l.said, 2))]];
    if (l.said) return [[i, el('tr', {}, head(l), said(l.said, 3))]];
    return l.cells.map(([from, to, here, other]) => [i, el('tr', {}, head(l), el('td', {}, to), cell(here, types[from], 'mg-here'), cell(other, types[from], 'mg-source'))]);
  });
  const shown = all.slice(0, SHOWN);
  const columns = [t('recv.drift.row'), labelCol, t('recv.drift.col'), t('recv.drift.here'), otherHead];
  return { grid: miniGrid(columns, shown.map(([, tr]) => tr)), rows: shown.length, lines: new Set(shown.map(([i]) => i)).size };
}

const more = n => (n > 0 ? el('p', { class: 'small' }, t('recv.history.more', { n })) : null);

const FOLD_FROM = 5;
const fold = (id, summary, content) => el('details', { class: 'fold', open: opened.has(id), ontoggle: keepOpen(id) }, el('summary', {}, summary), content);

function driftBlock(group, entry) {
  const result = state.results.get(tableKey(group.journal, entry.table)) || {};
  const total = result.driftCount || 0;
  if (!total) return null;
  const lines = [
    ...(result.droppedCols || []).map(([, to]) => ({ col: to, said: t('recv.drift.colGone') })),
    ...(result.drift || []).map(d => (d.gone ? { label: d.label, said: t('recv.drift.rowGone') } : d)),
  ];
  const { grid, rows } = diffGrid(lines, { types: result.types, labelCol: result.labelCol, otherHead: t('recv.drift.source') });
  const detail = [grid, more(total - rows)];
  return notice({
    tone: 'info', className: 'drift', title: t('recv.drift.title', { dest: entry.dest, n: total }), lines: [t('recv.drift.body', { n: total })],
    body: total > FOLD_FROM ? fold(`drift:${group.journal}:${entry.table}`, t('recv.drift.show', { n: total }), detail) : detail,
    actions: [button(t('recv.drift.fix'), 'undo', e => run(e.currentTarget, container.querySelector('.out'), () => correct(group, entry, result)))],
  });
}

function linksBlock(group, entry) {
  const result = state.results.get(tableKey(group.journal, entry.table)) || {};
  const made = (result.links || []).map(s => ({ ...s, name: `${entry.dest}.${s.to}` }));
  const text = (result.relinkable || []).map(s => ({ ...s, name: `${entry.dest}.${s.to}` }));
  const done = made.length ? notice({ tone: 'ok', className: 'links-done', title: t('recv.links.done'), lines: [made.map(s => t('recv.links.item', { name: s.name, target: s.target })).join(' · ')] }) : null;
  if (!text.length) return done;
  return [done, notice({
    tone: 'warn', className: 'links-text', title: t('recv.relink.title', { n: text.length, name: text.map(s => s.name).join(', ') }), lines: [t('recv.relink.body', { n: text.length }),
      group.owner ? '' : t('recv.relink.owner')],
    actions: group.owner ? [button(t('recv.relink.button'), 'column', e => run(e.currentTarget, container.querySelector('.out'), () => relinkReception(group, entry, text)))] : [],
  })];
}

async function relinkReception(group, entry, text) {
  const body = [
    el('ul', {}, text.map(s => el('li', {}, t(s.list ? 'recv.relink.item.list' : 'recv.relink.item', { name: s.name, target: s.target })))),
    el('p', {}, t('recv.relink.body2')),
  ];
  if (!(await confirmDialog({ title: t('recv.relink.confirmTitle', { name: group.note.name }), body, confirmLabel: t('recv.relink.button'), kind: 'btn-primary' }))) return;
  await relink(group.journal);
  flash = { node: message('ok', t('recv.relink.done', { cols: text.map(s => s.name).join(', ') })), until: Date.now() + NOTICE_MS };
  await renderTarget();
}

async function correct(group, entry, { driftCount, driftGone = 0, droppedCols = [] }) {
  const body = [t('recv.drift.fixBody', { n: driftCount }), driftGone ? t('recv.drift.fixRows', { n: driftGone }) : '',
    droppedCols.length ? t('recv.drift.fixCols', { n: droppedCols.length }) : ''].filter(Boolean).join(' ');
  if (!(await confirmDialog({ title: t('recv.drift.fixTitle', { dest: entry.dest }), body, confirmLabel: t('recv.drift.fix') }))) return;
  await restoreSource(group.journal, entry.table);
  await renderTarget();
}

function reviewBlock(group, entry) {
  const result = state.results.get(tableKey(group.journal, entry.table)) || {};
  const total = result.pendingCount || 0;
  if (!total) return null;
  const types = result.types || {};
  const out = () => container.querySelector('.out');
  const choose = async (e, ids, choice) => run(e.currentTarget, out(), async () => {
    await decide(group.journal, ids, choice);
    await renderTarget();
  });
  const all = async (e, choice) => {
    const target = e.currentTarget;
    const label = t(`recv.review.${choice}All`);
    if (await confirmDialog({ title: label, body: t(`recv.review.${choice}AllBody`, { n: total }), confirmLabel: label })) await choose({ currentTarget: target }, result.pendingIds, choice);
  };
  const values = (kind, cells, at) => valuesRow(kind, t(`recv.review.${kind === 'before' ? 'here' : 'proposed'}`), cells.map(c => c[at]), i => types[cells[i][0]]);
  const items = result.pending.slice(0, SHOWN).map(p => el('li', { class: `review-item chg-${p.state}` },
    el('div', { class: 'review-head' },
      changeHead(p),
      el('span', { class: 'review-actions' },
        button(t('recv.review.accept'), 'check', e => choose(e, [p.id], 'accepter')),
        button(t('recv.review.refuse'), 'refuse', e => choose(e, [p.id], 'refuser'), 'btn-danger-text'))),
    p.cells.length ? miniGrid(['', ...p.cells.map(([, to]) => to)], [
      p.state === 'ajout' ? null : values('before', p.cells, 2),
      p.state === 'suppression' ? null : values('after', p.cells, 3)].filter(Boolean)) : null));
  return notice({
    tone: 'warn', className: 'review', title: t('recv.review.title', { dest: entry.dest, n: total }), lines: [t('recv.review.body')],
    body: [el('ul', { class: 'review-rows' }, items), more(total - items.length)],
    actions: [button(t('recv.review.accepterAll'), 'check', e => all(e, 'accepter')), button(t('recv.review.refuserAll'), 'refuse', e => all(e, 'refuser'), 'btn-danger-text')],
  });
}

function gapBlock(group, entry) {
  const result = state.results.get(tableKey(group.journal, entry.table)) || {};
  const total = result.gapCount || 0;
  if (!total) return null;
  const lines = result.gaps.map(g => (g.state !== 'modif' || !g.cells.length ? { n: g.n, label: g.label, said: t(`recv.gap.${g.state}`) } : g));
  const { grid, lines: shown } = diffGrid(lines, { types: result.types, labelCol: result.labelCol, otherHead: t('recv.gap.theirs') });
  return notice({ tone: 'info', className: 'drift', title: t('recv.gap.title', { dest: entry.dest, n: total }), lines: [t('recv.gap.body')], body: [grid, more(total - shown)] });
}

const STATE_ICON = { ajout: 'plus', modif: 'edit', suppression: 'minus', colonne: 'column', [REFUSED]: 'refuse' };
const COUNTED = [...STATES, 'colonne', REFUSED];

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
  const label = c.state === 'colonne' ? t('recv.history.colLabel', { col: c.label }) : c.label;
  const line = [
    changeHead({ ...c, label }, c.n ? t(gone ? 'recv.history.rowGone' : 'recv.history.row', { n: c.n }) : null),
    el('time', { class: 'chg-time', datetime: new Date(c.at * 1000).toISOString() }, when(c.at))];
  const rowClass = `chg-row chg-${c.state}`;
  if (!c.detail) return el('li', { class: `chg-item chg-${c.state}` }, el('div', { class: rowClass }, line));
  const { cols, before, after } = c.detail;
  const heading = kind => (c.state === REFUSED ? t(`recv.review.${kind === 'before' ? 'here' : 'proposed'}`) : t(`recv.history.${kind}`));
  const values = (kind, list) => list && valuesRow(kind, heading(kind), list, i => types[cols[i][0]]);
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
  const chosen = () => JSON.stringify(pickers.map(p => p.field.value()));
  const initial = chosen();
  const saveHere = m => run(null, report, () => save(m));
  openModal({
    title: t('recv.label.title'), width: 400,
    body: [el('p', { class: 'small' }, t('recv.label.help')), ...pickers.map(p => el('div', { class: 'dest-row' }, el('span', {}, p.entry.dest), p.field)), report],
    guard: { save: saveHere, changed: () => chosen() !== initial },
    buttons: [cancelButton(), { label: t('common.save'), kind: 'btn-primary', onClick: saveHere }],
  });
}
return { refreshTarget, reinforceReceptions, receiveOffered, renderTarget };
})();

// ===== js/main.js =====
__M["js/main.js"] = (() => {
'use strict';
const {VERSION} = __M["js/config.js"];
const {LANG, t, translatePage} = __M["js/i18n.js"];
const {applyTheme, readPref, wizardAsked, writePref} = __M["js/prefs.js"];
const {sleep} = __M["js/engine/logic/common.js"];
const {ownsSync} = __M["js/engine/logic/strays.js"];
const {isReadOnly, readSchema} = __M["js/grist.js"];
const {readSourceNote} = __M["js/engine/source/synchro.js"];
const {receivedJournals} = __M["js/engine/logic/received.js"];
const {readLost} = __M["js/engine/target/lost.js"];
const {copyField, el, errorText, icon, message, noteError, openModal, unreachable} = __M["js/ui.js"];
const {startOfferNotice} = __M["js/tab-link-ui.js"];
const {diagnostic} = __M["js/diagnostic.js"];
const {roleGuide} = __M["js/guide.js"];
const {isOwnerHere, lostSynchro, reinforceFacts, refreshSource, renderSource} = __M["js/source/tab.js"];
const {startAutoCatchUp} = __M["js/engine/source/resend.js"];
const {receiveOffered, refreshTarget, reinforceReceptions, renderTarget} = __M["js/target/tab.js"];
const {newsSeen, openNews} = __M["js/news.js"];
const {consolidateAll, startAutoConsolidation} = __M["js/engine/target/loop.js"];
const {startEngine} = __M["js/engine/index.js"];
const {syncPort} = __M["js/sync-port.js"];

const $ = id => document.getElementById(id);
const RETRY_MS = 3000; // Grist injoignable un instant : nouvel essai de l'onglet
const START_MS = 15000; // au démarrage, au-delà : Grist est injoignable

function showScreen(...nodes) {
  $('main').replaceChildren(...nodes.filter(Boolean));
}

function showStartProblem(text, { withAddress = false, reload = false, access = false } = {}) {
  for (const button of document.querySelectorAll('[data-tab]')) button.disabled = true;
  showScreen(message('warn', text), 
    reload ? el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, t('start.reload')) : null);
}

async function select(tab, retry = true) {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  const view = el('div', { class: 'view' });
  showScreen(view);
  try {
    await (tab === 'send' ? renderSource(view) : renderTarget(view));
  } catch (e) {
    if (!unreachable(e)) console.error(e);
    else console.warn(e);
    noteError(e);
    if (unreachable(e) && retry) {
      await sleep(RETRY_MS);
      return view.isConnected ? select(tab, false) : undefined;
    }
    view.replaceChildren(message('err', errorText(e)));
  }
  return undefined;
}

function showHome(notOwner = false) {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', 'false');
  const tile = (tab, title, desc) => el('button', { class: 'tile', type: 'button', onclick: () => select(tab) },
    el('span', { class: 'tile-title' }, title), el('span', { class: 'tile-desc' }, desc));
  showScreen(el('h2', { class: 'home-title' }, t('home.title')),
    notOwner ? message('info', t('home.notOwner')) : null,
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
      radios('lang', t('settings.lang'), [['fr', 'Français'], ['en', 'English']], LANG, (lang, input) => {
        if (writePref('lang', lang)) location.reload();
        else { input.checked = false; document.querySelector(`input[name="lang"][value="${LANG}"]`).checked = true; }
      }),
      el('h3', {}, t('settings.theme')),
      radios('theme', t('settings.theme'), [['system', t('settings.theme.system')], ['light', t('settings.theme.light')], ['dark', t('settings.theme.dark')]],
        readPref('theme') || 'system', (theme) => { writePref('theme', theme); applyTheme(); }),
      diagnosticBlock(),
      el('h3', {}, t('settings.credits')),
      el('dl', { class: 'fiche small' }, credits.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))),
  });
}

function diagnosticBlock() {
  const area = el('textarea', { class: 'code', readonly: true, rows: 8, spellcheck: 'false', 'aria-label': t('settings.diag') });
  const shown = el('details', {}, el('summary', { class: 'small' }, t('settings.diag.show')), area);
  const out = el('div', { class: 'out' });
  const text = diagnostic().catch((e) => { out.append(message('err', errorText(e))); return ''; });
  text.then((value) => { area.value = value; });
  const copy = el('button', { class: 'btn', type: 'button', onclick: async () => {
    const value = await text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copy.lastChild.textContent = t('common.copied');
      setTimeout(() => { copy.lastChild.textContent = t('settings.diag.copy'); }, 1500);
    } catch (e) {
      shown.open = true;
      area.select();
    }
  } }, icon('copy'), t('settings.diag.copy'));
  return [el('h3', {}, t('settings.diag')), el('p', { class: 'muted small' }, t('settings.diag.help')), copy, out, shown];
}

async function start() {
  startEngine({ port: syncPort, version: VERSION }); // le moteur parle à Grist par ce port (js/sync-port.js), noms de tables d'avant
  applyTheme();
  translatePage();
  $('settings').addEventListener('click', openSettings);
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => { picked = button.dataset.tab; if (ready) select(picked); });
  }

  if (window.parent === window || typeof grist === 'undefined') return showStartProblem(t('start.outside'));
  grist.ready({ requiredAccess: 'full' });
  try {
    await Promise.race([grist.docApi.fetchTable('_grist_Tables'), sleep(START_MS).then(() => { throw new Error('timeout'); })]);
  } catch (e) {
    return showStartProblem(t(e.message === 'timeout' ? 'start.slow' : 'start.access'), { reload: true, access: true });
  }

  startAutoConsolidation(refreshTarget);
  startAutoCatchUp(refreshSource);
  startOfferNotice($('offer'), useOffer);
  try {
    await openFirstScreen();
  } catch (e) {
    console.warn(e);
    showStartProblem(t('start.failed', { detail: errorText(e) }), { reload: true });
  }
}

async function useOffer(code) {
  await select('receive');
  if (document.querySelector('.scrim')) return false;
  receiveOffered(code);
  return true;
}

let picked = null;
let ready = false;

async function openFirstScreen() {
  const schema = await readSchema();
  const journals = receivedJournals(schema);
  const backLink = readSourceNote(schema).invitations.some(inv => inv.journal && !inv.ready);
  ready = true;
  if (picked) await select(picked);
  else if (wizardAsked('reception')) await select('receive'); // « Accepter une invitation » demandé juste avant le rechargement des règles
  else if (wizardAsked('export') && ownsSync(schema)) await select('send'); // « Nouvel export » demandé juste avant le rechargement des règles
  else if (!backLink && journals.some(r => !r.note.retour)) await select('receive');
  else if ((ownsSync(schema) && readSourceNote(schema).exports.length) || await lostSynchro(schema)) await select('send');
  else if ((await readLost()).length) await select('receive');
  else showHome(await isOwnerHere() === false);
  if (journals.length) consolidateAll();
  await showNews(schema, journals);
}

async function showNews(schema, journals) {
  const installed = journals.length || (ownsSync(schema) && readSourceNote(schema).exports.length);
  if (!installed || newsSeen() || document.querySelector('.scrim') || isReadOnly()) return;
  const [source, receptions] = await Promise.all([reinforceFacts().catch(() => ({})), reinforceReceptions().catch(() => 0)]);
  if (document.querySelector('.scrim')) return;
  openNews({ facts: { exports: 0, people: 0, invitations: 0, ...source, receptions }, onGo: tab => select(tab) });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
return {  };
})();

