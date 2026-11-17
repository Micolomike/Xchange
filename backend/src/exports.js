/**
 * Exports de données en trois formats : CSV (tableur, séparateur « ; »), Excel (.xlsx) et JSON.
 *
 * Un export est décrit par des feuilles : { name, headers, rows } (rows = tableaux de valeurs),
 * et par un objet JSON. CSV : une seule feuille (ou un tableau aplati pour les exports à plusieurs
 * feuilles). Excel : une feuille par table, en-tête figé, filtres, largeurs ajustées.
 */
const ExcelJS = require('exceljs');
const { HttpError } = require('./utils');

const FORMATS = {
  csv: { ext: 'csv', type: 'text/csv; charset=utf-8', label: 'CSV' },
  xlsx: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  json: { ext: 'json', type: 'application/json; charset=utf-8', label: 'JSON' },
};

/** Format demandé (csv par défaut) ; refuse une valeur inconnue. */
function parseFormat(value, fallback = 'csv') {
  const f = String(value || fallback).toLowerCase();
  if (!FORMATS[f]) throw new HttpError(400, 'Format inconnu : choisissez csv, xlsx ou json.');
  return f;
}

// ------------------------------------------------------------------------------------------- CSV

const csvCell = (v) => {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v);
  // Pas de formule interprétée par le tableur.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

function toCsv(headers, rows) {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------------------------------- Excel

const sheetName = (name, used) => {
  let base = String(name || 'Feuille')
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .slice(0, 31) || 'Feuille';
  let n = 2;
  let candidate = base;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Valeur prête pour une cellule : les dates ISO deviennent de vraies dates, le reste du texte ou des nombres. */
function cellValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (ISO_DATE.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Excel limite une cellule à 32 767 caractères.
  return s.length > 32000 ? `${s.slice(0, 32000)}…` : s;
}

async function toXlsx(sheets, { title } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Xchange';
  wb.created = new Date();
  if (title) wb.title = title;
  const used = new Set();
  for (const sheet of sheets.length ? sheets : [{ name: 'Export', headers: [], rows: [] }]) {
    const ws = wb.addWorksheet(sheetName(sheet.name, used), { views: [{ state: 'frozen', ySplit: sheet.headers.length ? 1 : 0 }] });
    if (sheet.headers.length) {
      const head = ws.addRow(sheet.headers);
      head.font = { bold: true };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF7' } };
    }
    for (const r of sheet.rows) ws.addRow(r.map(cellValue));
    // Largeurs : selon le contenu, entre 8 et 60 caractères ; dates au format français.
    sheet.headers.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      let width = String(h).length;
      let dates = 0;
      for (const r of sheet.rows.slice(0, 500)) {
        const v = cellValue(r[i]);
        if (v instanceof Date) dates += 1;
        width = Math.max(width, v instanceof Date ? 16 : String(v ?? '').split('\n')[0].length);
      }
      col.width = Math.min(Math.max(width + 2, 8), 60);
      if (dates) col.numFmt = 'dd/mm/yyyy hh:mm';
      col.alignment = { vertical: 'top', wrapText: width > 60 };
    });
    if (sheet.headers.length && sheet.rows.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.headers.length } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------------------------------- Envoi

const asciiName = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'export';

/** Lignes d'objets JSON à partir d'une table (clé = intitulé de colonne). */
const tableToObjects = (headers, rows) => rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])));

/**
 * Contenu d'un export : { body, type, fileName }.
 * - sheets : tables de l'export ;
 * - json : objet à écrire en JSON (par défaut : chaque feuille en tableau d'objets) ;
 * - csv : table à écrire en CSV quand il y a plusieurs feuilles (par défaut : la première).
 */
async function buildExport(format, { baseName, sheets, json, csv, title }) {
  const f = FORMATS[format];
  const fileName = `${asciiName(baseName)}.${f.ext}`;
  let body;
  if (format === 'csv') {
    const t = csv || sheets[0] || { headers: [], rows: [] };
    body = toCsv(t.headers, t.rows);
  } else if (format === 'xlsx') {
    body = await toXlsx(sheets, { title });
  } else {
    const data =
      json ?? (sheets.length === 1 ? tableToObjects(sheets[0].headers, sheets[0].rows) : Object.fromEntries(sheets.map((s) => [s.name, tableToObjects(s.headers, s.rows)])));
    body = `${JSON.stringify(data, null, 2)}\n`;
  }
  return { body, type: f.type, fileName };
}

async function sendExport(res, format, spec) {
  const { body, type, fileName } = await buildExport(format, spec);
  res.set('Content-Type', type);
  res.set('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(body);
}

// ------------------------------------------------------------------- Objet imbriqué → tables (RGPD)

/** Aplatit un objet en { 'a.b': valeur } (les tableaux de valeurs simples sont joints). */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else if (Array.isArray(v) && v.every((x) => x == null || typeof x !== 'object')) out[key] = v.join(', ');
    else out[key] = v;
  }
  return out;
}

const isTable = (v) => Array.isArray(v) && v.some((x) => x && typeof x === 'object');

/**
 * Transforme un objet imbriqué (export RGPD) en tables : une table « clé / valeur » pour les champs
 * simples, une table par liste ; les listes contenues dans une liste (ex. messages d'une demande)
 * deviennent leur propre table, avec le numéro de la ligne parente.
 */
function objectToSheets(obj, labels = {}) {
  const sheets = [];
  const label = (path) => labels[path] || path;
  const summary = [];

  function table(path, list, parent) {
    const rows = list.map((x) => (x && typeof x === 'object' ? x : { valeur: x }));
    const childLists = new Set();
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (isTable(v)) childLists.add(k);
    const flat = rows.map((r) => flatten(Object.fromEntries(Object.entries(r).filter(([k]) => !childLists.has(k)))));
    const headers = [...new Set(flat.flatMap((r) => Object.keys(r)))];
    const parentHead = parent ? [parent.header] : [];
    sheets.push({
      name: label(path),
      headers: [...parentHead, ...headers],
      rows: flat.map((r, i) => [...(parent ? [parent.ids[i]] : []), ...headers.map((h) => r[h] ?? null)]),
    });
    for (const k of childLists) {
      const ids = [];
      const items = [];
      rows.forEach((r, i) => {
        for (const child of r[k] || []) {
          ids.push(r.id ?? i + 1);
          items.push(child);
        }
      });
      table(`${path}.${k}`, items, { header: `${label(path)} n°`, ids });
    }
  }

  function walk(value, path) {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (isTable(v)) table(p, v);
      else if (Array.isArray(v) && v.length === 0) sheets.push({ name: label(p), headers: [], rows: [] });
      else if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some((x) => isTable(x) || Array.isArray(x))) walk(v, p);
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        sheets.push({ name: label(p), headers: ['Champ', 'Valeur'], rows: Object.entries(flatten(v)).map(([a, b]) => [a, b]) });
      } else summary.push([label(p), Array.isArray(v) ? v.join(', ') : v]);
    }
  }
  walk(obj, '');
  if (summary.length) sheets.unshift({ name: 'Export', headers: ['Champ', 'Valeur'], rows: summary });
  return sheets;
}

/** Toutes les tables en une seule pour un CSV : Rubrique ; Ligne ; Champ ; Valeur. */
function sheetsToLongTable(sheets) {
  const rows = [];
  for (const s of sheets) {
    if (s.headers[0] === 'Champ' && s.headers[1] === 'Valeur' && s.headers.length === 2) {
      for (const r of s.rows) rows.push([s.name, '', r[0], r[1]]);
    } else {
      s.rows.forEach((r, i) => s.headers.forEach((h, j) => rows.push([s.name, i + 1, h, r[j]])));
    }
  }
  return { headers: ['Rubrique', 'Ligne', 'Champ', 'Valeur'], rows };
}

module.exports = { FORMATS, parseFormat, toCsv, toXlsx, buildExport, sendExport, objectToSheets, sheetsToLongTable, csvCell };
