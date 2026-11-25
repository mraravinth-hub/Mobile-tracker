const Database = require('better-sqlite3');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'tracker.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ------------------------------------------------------------------
 * SCALAR FUNCTIONS (registered inside SQLite, usable in any SQL query)
 * ------------------------------------------------------------------ */
const R = 6371000; // Earth radius in meters
const toRad = (d) => (d * Math.PI) / 180;

// haversine(lat1, lon1, lat2, lon2) -> distance in meters
db.function('haversine', { deterministic: true }, (lat1, lon1, lat2, lon2) => {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined)) return null;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
});

// speed_kmh(distance_m, seconds) -> km/h
db.function('speed_kmh', { deterministic: true }, (meters, seconds) => {
  if (!seconds || seconds <= 0 || meters === null) return null;
  return (meters / seconds) * 3.6;
});

// is_online(last_seen_epoch_ms, threshold_seconds) -> 1/0
db.function('is_online', (lastSeen, thresholdSec) => {
  if (!lastSeen) return 0;
  return Date.now() - lastSeen <= (thresholdSec || 120) * 1000 ? 1 : 0;
});

/* ------------------------------ SCHEMA ------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  consent_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  accuracy    REAL,
  battery     REAL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loc_device_time ON locations(device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS geofences (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  lat       REAL NOT NULL,
  lon       REAL NOT NULL,
  radius_m  REAL NOT NULL
);
`);

module.exports = db;
