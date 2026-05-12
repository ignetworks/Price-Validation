'use strict';

require('events').defaultMaxListeners = 30;

const crypto = require('crypto');
const axios = require('axios');
const OAuth = require('oauth-1.0a');
const pLimit = require('p-limit');

const limit = pLimit(5);

// ── Credentials ──

const NS_ACCOUNT_ID = process.env.NS_ACCOUNT_ID;
const NS_CONSUMER_KEY = process.env.NS_CONSUMER_KEY;
const NS_CONSUMER_SECRET = process.env.NS_CONSUMER_SECRET;
const NS_TOKEN_ID = process.env.NS_TOKEN_ID;
const NS_TOKEN_SECRET = process.env.NS_TOKEN_SECRET;

const IS_DEMO = !(NS_ACCOUNT_ID && NS_CONSUMER_KEY && NS_CONSUMER_SECRET && NS_TOKEN_ID && NS_TOKEN_SECRET);

const BASE_URL = IS_DEMO
  ? null
  : `https://${NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

// ── OAuth 1.0 TBA setup ──

let oauth = null;
let token = null;

if (!IS_DEMO) {
  oauth = new OAuth({
    consumer: { key: NS_CONSUMER_KEY, secret: NS_CONSUMER_SECRET },
    signature_method: 'HMAC-SHA256',
    hash_function(baseString, key) {
      return crypto.createHmac('sha256', key).update(baseString).digest('base64');
    },
    realm: NS_ACCOUNT_ID,
  });

  token = { key: NS_TOKEN_ID, secret: NS_TOKEN_SECRET };
}

function getAuthHeaders(url, method) {
  const requestData = { url, method };
  return oauth.toHeader(oauth.authorize(requestData, token));
}

// ── HTTP helpers ──

async function nsGet(path) {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await axios.get(url, {
      headers: { ...getAuthHeaders(url, 'GET'), 'Content-Type': 'application/json' },
    });
    return res.data;
  } catch (err) {
    if (!err.response) throw new Error('NETWORK_ERROR: Could not reach NetSuite — ' + err.message);
    const status = err.response.status;
    if (status === 401 || status === 403) {
      const body = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
      throw new Error(`AUTH_FAILED (${status}): ${body}`);
    }
    if (status === 404) return null;
    const body = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
    throw new Error(`NS_API_ERROR (${status}): ${body}`);
  }
}

async function nsSuiteQL(sql) {
  const QUERY_BASE = `https://${NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
  const url = `${QUERY_BASE}?limit=1000`;
  try {
    const res = await axios.post(url, { q: sql }, {
      headers: { ...getAuthHeaders(url, 'POST'), 'Content-Type': 'application/json', 'prefer': 'transient' },
    });
    return res.data?.items || [];
  } catch (err) {
    if (!err.response) throw new Error('NETWORK_ERROR: ' + err.message);
    const body = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
    throw new Error(`NS_SUITEQL_ERROR (${err.response.status}): ${body}`);
  }
}

// ── Live NetSuite functions ──

function toNsDateFull(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

async function getVocsByDateLive(date) {
  const nsDate = toNsDateFull(date);
  const rows = await nsSuiteQL(
    `SELECT t.id, t.tranid, t.otherrefnum, t.trandate, curr.symbol AS currency_symbol, e.entityid AS vendor_name, e.id AS vendor_id ` +
    `FROM transaction t ` +
    `LEFT JOIN entity e ON e.id = t.entity ` +
    `LEFT JOIN currency curr ON curr.id = t.currency ` +
    `WHERE t.type = 'VendBill' AND t.trandate = TO_DATE('${nsDate}', 'MM/DD/YYYY')`
  );
  return rows.map(r => ({
    id: String(r.id),
    tranId: r.tranid || `VENDBILL${r.id}`,
    otherRefNum: r.otherrefnum,
    tranDate: r.trandate,
    currency: { refName: r.currency_symbol || 'USD' },
    vendor: { refName: r.vendor_name || 'Unknown', id: r.vendor_id },
  }));
}

async function getVocLinesLive(billId) {
  const rows = await nsSuiteQL(
    `SELECT tl.item, i.displayname AS item_name, tl.rate, tl.quantity, tl.amount, tl.memo ` +
    `FROM transactionLine tl LEFT JOIN item i ON i.id = tl.item ` +
    `WHERE tl.transaction = ${billId} AND tl.mainline = 'F' AND tl.taxline = 'F' AND tl.item IS NOT NULL`
  );
  return rows.map(r => ({
    itemId: r.item ? String(r.item) : null,
    itemName: r.item_name || r.memo || `Item #${r.item}`,
    description: r.memo || '',
    rate: parseFloat(r.rate) || 0,
    quantity: parseFloat(r.quantity) || 0,
    amount: parseFloat(r.amount) || 0,
  }));
}

async function getPriorMrcForServiceLive(itemId, currentBillId, currentBillDate) {
  const nsDate = currentBillDate
    ? (String(currentBillDate).includes('/') ? String(currentBillDate).slice(0, 10) : toNsDateFull(String(currentBillDate).slice(0, 10)))
    : null;
  const dateFilter = nsDate ? `AND t.trandate < TO_DATE('${nsDate}', 'MM/DD/YYYY') ` : '';
  const rows = await nsSuiteQL(
    `SELECT t.id, t.trandate, tl.rate, e.entityid AS vendor_name ` +
    `FROM transaction t ` +
    `JOIN transactionLine tl ON tl.transaction = t.id ` +
    `LEFT JOIN entity e ON e.id = t.entity ` +
    `WHERE t.type = 'VendBill' AND tl.item = ${itemId} AND t.id != ${currentBillId} ` +
    `AND tl.mainline = 'F' AND tl.taxline = 'F' ` +
    dateFilter +
    `ORDER BY t.trandate DESC`
  );
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    mrc: parseFloat(r.rate) || 0,
    vocDate: r.trandate,
    vendorName: r.vendor_name || 'Unknown',
    vocId: String(r.id),
  };
}

// ── Demo mock data ──

const DEMO_VENDORS = [
  'LL Inteliglobe', 'Networld Telecom', 'Brasil Conecta', 'Vox Datacenter',
  'Fibra Sul Telecom', 'Rede Nacional', 'CloudBR Services', 'TechLink Brasil',
];

const DEMO_SERVICES = ['dia', 'eth', 'mpls', 'vpls', 'sdwan', 'iplc', 'wavelength'];
const DEMO_CODES = ['SPO', 'RIO', 'BSB', 'CWB', 'BHZ', 'REC', 'POA', 'SSA', 'FOR', 'MAN'];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateDemoVocs(date) {
  const count = randomBetween(8, 15);
  const vocs = [];
  for (let i = 0; i < count; i++) {
    const vendor = DEMO_VENDORS[randomBetween(0, DEMO_VENDORS.length - 1)];
    const mrc = randomBetween(200, 5000) + randomBetween(0, 99) / 100;
    vocs.push({
      id: 30000 + i,
      slug: `demo-voc-${i}`,
      order_date: date,
      tranDate: date,
      currency: 'BRL-Brazil, Real',
      total_mrc: String(mrc.toFixed(2)),
      vendor_name: vendor,
      vendor: { refName: vendor },
    });
  }
  return vocs;
}

const _demoCurrentMrc = new Map();

function generateDemoVocLines(vocId) {
  const count = randomBetween(1, 4);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const svc = DEMO_SERVICES[randomBetween(0, DEMO_SERVICES.length - 1)];
    const code = DEMO_CODES[randomBetween(0, DEMO_CODES.length - 1)];
    const itemId = randomBetween(1000, 9999);
    const mrc = randomBetween(200, 5000) + randomBetween(0, 99) / 100;
    _demoCurrentMrc.set(itemId, mrc);
    lines.push({
      itemId,
      itemName: `V${itemId} - ${svc.toUpperCase()} for ${code} | MRC`,
      description: `${svc.toUpperCase()} for ${code}`,
      rate: mrc,
      quantity: 1,
      amount: mrc,
    });
  }
  return lines;
}

function generateDemoPriorMrc(itemId) {
  const roll = Math.random();
  if (roll < 0.15) return null;

  const currentMrc = _demoCurrentMrc.get(itemId) || 1000;
  const vendor = DEMO_VENDORS[randomBetween(0, DEMO_VENDORS.length - 1)];
  const now = new Date();
  const priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

  let variancePct;
  const dist = Math.random();
  if (dist < 0.40) {
    variancePct = (Math.random() - 0.5) * 0.8;
  } else if (dist < 0.65) {
    variancePct = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 2.5);
  } else {
    variancePct = (Math.random() < 0.5 ? -1 : 1) * (3.1 + Math.random() * 12);
  }

  const priorMrc = Math.round(currentMrc / (1 + variancePct / 100) * 100) / 100;

  return {
    mrc: priorMrc,
    vocDate: priorMonth.toISOString().slice(0, 10),
    vendorName: vendor,
    vocId: randomBetween(20000, 29999),
  };
}

// ── Exported API (switches between live and demo) ──

module.exports = {
  isDemoMode() {
    return IS_DEMO;
  },

  async getVocsByDate(date) {
    if (IS_DEMO) return generateDemoVocs(date);
    return limit(() => getVocsByDateLive(date));
  },

  async getVocLines(billId) {
    if (IS_DEMO) return generateDemoVocLines(billId);
    return limit(() => getVocLinesLive(billId));
  },

  async getPriorMrcForService(itemId, currentBillId, currentBillDate) {
    if (IS_DEMO) return generateDemoPriorMrc(itemId);
    return limit(() => getPriorMrcForServiceLive(itemId, currentBillId, currentBillDate));
  },

  closePool() {
    // No-op for REST API (no connection pool to close)
  },
};
