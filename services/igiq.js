'use strict';

const { Pool } = require('pg');

// ── Database connection ──

const IS_DEMO = !process.env.IGIQ_DATABASE_URL;

let pool = null;

function getPool() {
  if (!pool && !IS_DEMO) {
    pool = new Pool({
      connectionString: process.env.IGIQ_DATABASE_URL,
      ssl: process.env.IGIQ_DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const p = getPool();
  try {
    const res = await p.query(sql, params);
    return res.rows;
  } catch (err) {
    if (err.code === '28P01' || err.code === '28000') {
      throw new Error('AUTH_FAILED: Check IGIQ database credentials in .env');
    }
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      throw new Error('NETWORK_ERROR: Could not reach IGIQ database — ' + err.message);
    }
    throw new Error('DB_ERROR: ' + err.message);
  }
}

// ── Live database functions ──

async function getVocsByDate(date) {
  return query(`
    SELECT
      v.id,
      v.slug,
      v.order_date,
      v.type_of_order,
      v.order_status,
      v.currency,
      v.total_mrc,
      v.total_nrc,
      vc.name AS vendor_name
    FROM "Procurement_voc" v
    LEFT JOIN "Procurement_vendorcatalog" vc ON v.related_vendor_id = vc.id
    WHERE v.order_date::date = $1
    ORDER BY v.id DESC
  `, [date]);
}

async function getVocLines(vocId) {
  return query(`
    SELECT
      vl.id,
      vl.slug,
      vl.service,
      vl.description,
      CAST(vl.mrc AS numeric) AS mrc,
      CAST(vl.nrc AS numeric) AS nrc,
      vl.status,
      vl.type_of_charge,
      vl.related_service_inventory_id,
      vl.related_proc_vq_id
    FROM "Procurement_vocline" vl
    WHERE vl.related_voc_id = $1
      AND vl.type_of_charge = 're'
      AND vl.mrc IS NOT NULL
    ORDER BY vl.id
  `, [vocId]);
}

async function getPriorMrcForService(serviceInventoryId, currentVocId) {
  if (!serviceInventoryId) return null;

  const rows = await query(`
    SELECT
      vl.mrc::numeric AS mrc,
      v.order_date,
      v.currency,
      vc.name AS vendor_name,
      v.id AS voc_id
    FROM "Procurement_vocline" vl
    JOIN "Procurement_voc" v ON vl.related_voc_id = v.id
    LEFT JOIN "Procurement_vendorcatalog" vc ON v.related_vendor_id = vc.id
    WHERE vl.related_service_inventory_id = $1
      AND vl.type_of_charge = 're'
      AND vl.mrc IS NOT NULL
      AND v.id != $2
    ORDER BY v.order_date DESC
    LIMIT 1
  `, [serviceInventoryId, currentVocId]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    mrc: parseFloat(row.mrc),
    vocDate: row.order_date,
    vendorName: row.vendor_name,
    vocId: row.voc_id,
  };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
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
      type_of_order: 'ne',
      order_status: null,
      currency: 'BRL-Brazil, Real',
      total_mrc: String(mrc.toFixed(2)),
      total_nrc: '0.00',
      vendor_name: vendor,
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
    const serviceInvId = randomBetween(1000, 9999);
    const mrc = randomBetween(200, 5000) + randomBetween(0, 99) / 100;
    _demoCurrentMrc.set(serviceInvId, mrc);
    lines.push({
      id: 40000 + vocId * 10 + i,
      slug: `demo-vocline-${vocId}-${i}`,
      service: svc,
      description: `${svc.toUpperCase()} for ${code}`,
      mrc,
      nrc: 0,
      status: 'delivered',
      type_of_charge: 're',
      related_service_inventory_id: serviceInvId,
      related_proc_vq_id: null,
    });
  }
  return lines;
}

function generateDemoPriorMrc(serviceInventoryId) {
  const roll = Math.random();
  if (roll < 0.15) return null; // 15% NEW ITEM

  const currentMrc = _demoCurrentMrc.get(serviceInventoryId) || 1000;
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
    return getVocsByDate(date);
  },

  async getVocLines(vocId) {
    if (IS_DEMO) return generateDemoVocLines(vocId);
    return getVocLines(vocId);
  },

  async getPriorMrcForService(serviceInventoryId, currentVocId) {
    if (IS_DEMO) return generateDemoPriorMrc(serviceInventoryId);
    return getPriorMrcForService(serviceInventoryId, currentVocId);
  },

  closePool,
};
