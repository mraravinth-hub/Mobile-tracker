require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const ONLINE_SECONDS = Number(process.env.ONLINE_SECONDS || 120);

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------- helpers ---------------------------- */
function admin(req, res, next) {
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function deviceAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const device = db.prepare('SELECT * FROM devices WHERE token = ?').get(token);
  if (!device) return res.status(401).json({ error: 'invalid device token' });
  req.device = device;
  next();
}

const validCoord = (lat, lon) =>
  typeof lat === 'number' && typeof lon === 'number' &&
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

/* ------------------------ device (phone) API ------------------------ */
// Phone registers itself. Requires explicit consent=true from the device owner.
app.post('/api/register', (req, res) => {
  const { name, consent } = req.body || {};
  if (consent !== true) return res.status(400).json({ error: 'Consent is required to share location' });
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  const token = crypto.randomBytes(24).toString('hex');
  const info = db
    .prepare('INSERT INTO devices (name, token, consent_at) VALUES (?, ?, ?)')
    .run(name.trim().slice(0, 60), token, Date.now());
  res.json({ id: info.lastInsertRowid, token });
});

// Phone posts its location
app.post('/api/location', deviceAuth, (req, res) => {
  const { lat, lon, accuracy, battery } = req.body || {};
  if (!validCoord(lat, lon)) return res.status(400).json({ error: 'invalid coordinates' });
  db.prepare(
    'INSERT INTO locations (device_id, lat, lon, accuracy, battery, recorded_at) VALUES (?,?,?,?,?,?)'
  ).run(req.device.id, lat, lon, accuracy ?? null, battery ?? null, Date.now());
  res.json({ ok: true });
});

// Phone stops sharing and deletes all its data
app.delete('/api/me', deviceAuth, (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.device.id);
  res.json({ ok: true, deleted: true });
});

/* --------------------------- dashboard API --------------------------- */
// All devices with latest position + online status (uses scalar function is_online)
app.get('/api/devices', admin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.id, d.name, d.consent_at,
              l.lat, l.lon, l.accuracy, l.battery, l.recorded_at AS last_seen,
              is_online(l.recorded_at, ?) AS online
         FROM devices d
         LEFT JOIN locations l ON l.id = (
           SELECT id FROM locations WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1
         )
        ORDER BY d.name`
    )
    .all(ONLINE_SECONDS);
  res.json(rows);
});

// Location history for one device
app.get('/api/devices/:id/history', admin, (req, res) => {
  const since = Number(req.query.since || Date.now() - 24 * 3600 * 1000);
  const rows = db
    .prepare(
      `SELECT lat, lon, accuracy, battery, recorded_at FROM locations
        WHERE device_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC`
    )
    .all(req.params.id, since);
  res.json(rows);
});

// Trip stats: total distance & avg speed, computed in SQL with haversine() / speed_kmh()
app.get('/api/devices/:id/stats', admin, (req, res) => {
  const since = Number(req.query.since || Date.now() - 24 * 3600 * 1000);
  const row = db
    .prepare(
      `WITH ordered AS (
         SELECT lat, lon, recorded_at,
                LAG(lat) OVER (ORDER BY recorded_at) AS plat,
                LAG(lon) OVER (ORDER BY recorded_at) AS plon,
                LAG(recorded_at) OVER (ORDER BY recorded_at) AS ptime
           FROM locations WHERE device_id = ? AND recorded_at >= ?
       )
       SELECT COUNT(*) AS points,
              COALESCE(SUM(haversine(plat, plon, lat, lon)), 0) AS distance_m,
              speed_kmh(SUM(haversine(plat, plon, lat, lon)),
                        (MAX(recorded_at) - MIN(recorded_at)) / 1000.0) AS avg_speed_kmh
         FROM ordered`
    )
    .get(req.params.id, since);
  res.json(row);
});

// Devices within radius (meters) of a point, using haversine() in WHERE
app.get('/api/nearby', admin, (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon), radius = Number(req.query.radius || 1000);
  if (!validCoord(lat, lon)) return res.status(400).json({ error: 'invalid lat/lon' });
  const rows = db
    .prepare(
      `SELECT d.id, d.name, l.lat, l.lon, haversine(?, ?, l.lat, l.lon) AS distance_m
         FROM devices d
         JOIN locations l ON l.id = (SELECT id FROM locations WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1)
        WHERE haversine(?, ?, l.lat, l.lon) <= ?
        ORDER BY distance_m`
    )
    .all(lat, lon, lat, lon, radius);
  res.json(rows);
});

// Geofences
app.get('/api/geofences', admin, (req, res) => res.json(db.prepare('SELECT * FROM geofences').all()));
app.post('/api/geofences', admin, (req, res) => {
  const { name, lat, lon, radius_m } = req.body || {};
  if (!name || !validCoord(lat, lon) || !(radius_m > 0)) return res.status(400).json({ error: 'invalid geofence' });
  const info = db.prepare('INSERT INTO geofences (name, lat, lon, radius_m) VALUES (?,?,?,?)').run(name, lat, lon, radius_m);
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/geofences/:id', admin, (req, res) => {
  db.prepare('DELETE FROM geofences WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Devices currently inside each geofence
app.get('/api/geofences/status', admin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.id AS geofence_id, g.name AS geofence, d.id AS device_id, d.name AS device,
              haversine(g.lat, g.lon, l.lat, l.lon) AS distance_m,
              CASE WHEN haversine(g.lat, g.lon, l.lat, l.lon) <= g.radius_m THEN 1 ELSE 0 END AS inside
         FROM geofences g
         CROSS JOIN devices d
         JOIN locations l ON l.id = (SELECT id FROM locations WHERE device_id = d.id ORDER BY recorded_at DESC LIMIT 1)`
    )
    .all();
  res.json(rows);
});

app.delete('/api/devices/:id', admin, (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mobile tracker running on http://localhost:${PORT}`);
    console.log(`Dashboard: /   |   Phone page: /device.html`);
  });
}

module.exports = app;
