'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', '.voc-cache.json');
const MAX_CACHE_SIZE = 10000;

let _cache = null;

function loadCache() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      _cache = new Set(Array.isArray(data) ? data : []);
    } else {
      _cache = new Set();
    }
  } catch {
    _cache = new Set();
  }
  return _cache;
}

function saveCache(cacheSet) {
  let arr = Array.from(cacheSet);
  // Keep only the most recent entries if cache exceeds max size
  if (arr.length > MAX_CACHE_SIZE) {
    arr = arr.slice(arr.length - MAX_CACHE_SIZE);
    cacheSet = new Set(arr);
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  _cache = cacheSet;
}

function isNew(id) {
  const cache = loadCache();
  return !cache.has(String(id));
}

function markSeen(ids) {
  const cache = loadCache();
  for (const id of ids) {
    cache.add(String(id));
  }
  saveCache(cache);
}

module.exports = { loadCache, saveCache, isNew, markSeen };
