# 📱 Mobile Tracker

A **consent-based** online mobile device tracker (like a "find my phone" / family-sharing tool).
Each phone opens a web page, the owner ticks a consent box, and the phone shares its location with a live dashboard.

**Features**
- Live map dashboard (Leaflet + OpenStreetMap)
- Phone page with explicit consent, pause, and "stop & delete my data"
- Location history trail, trip distance & average speed
- Geofences (inside / outside status)
- "Devices near a point" search
- **SQL scalar functions**: `haversine()`, `speed_kmh()`, `is_online()` (SQLite) and `fn_Haversine`, `fn_SpeedKmh`, `fn_IsOnline` (SQL Server)

## Quick start

```bash
git clone https://github.com/<your-username>/mobile-tracker.git
cd mobile-tracker
npm install
cp .env.example .env     # then edit ADMIN_KEY
npm test                 # tests the scalar functions
npm start
```

- Dashboard: http://localhost:3000/
- Phone page: http://localhost:3000/device.html

> Phones need **HTTPS** for GPS access (except on localhost). Deploy behind HTTPS (Render, Railway, Fly.io, or Nginx + Let's Encrypt), or use a tunnel like `cloudflared` for testing.

## Project structure

```
mobile-tracker/
├── server.js                      # Express API
├── db.js                          # SQLite schema + scalar functions
├── public/
│   ├── index.html                 # Admin dashboard with map
│   └── device.html                # Phone page (consent + sharing)
├── sql/sqlserver_scalar_function.sql   # T-SQL scalar functions
├── test/db.test.js
├── .env.example
└── package.json
```

## Scalar functions

### SQLite (registered in `db.js`)

| Function | Returns | Example |
|---|---|---|
| `haversine(lat1, lon1, lat2, lon2)` | distance in meters | `SELECT haversine(13.08,80.27,13.05,80.28)` |
| `speed_kmh(meters, seconds)` | km/h | `SELECT speed_kmh(1000, 100)` |
| `is_online(last_seen_ms, threshold_s)` | 1 / 0 | `SELECT is_online(1700000000000, 120)` |

### SQL Server

See [`sql/sqlserver_scalar_function.sql`](sql/sqlserver_scalar_function.sql) for `dbo.fn_Haversine`, `dbo.fn_SpeedKmh`, `dbo.fn_IsOnline` and example queries.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/register` | – | Phone registers (`consent: true` required) |
| POST | `/api/location` | Bearer device token | Phone sends location |
| DELETE | `/api/me` | Bearer device token | Phone deletes itself & its data |
| GET | `/api/devices` | `x-admin-key` | Devices + latest position |
| GET | `/api/devices/:id/history` | admin | Location history |
| GET | `/api/devices/:id/stats` | admin | Distance & avg speed |
| GET | `/api/nearby?lat=&lon=&radius=` | admin | Devices within radius |
| GET/POST/DELETE | `/api/geofences` | admin | Manage geofences |
| GET | `/api/geofences/status` | admin | Who is inside which fence |

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: mobile tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/mobile-tracker.git
git push -u origin main
```

## Privacy & legal

Only track devices **you own or whose owners have knowingly agreed**. This app requires an explicit consent tick-box, only shares while the phone page is open, and lets the owner delete their data. Secretly tracking another person is illegal in many places (including under India's IT Act and privacy laws). Always keep the consent flow intact.

## Production tips
- Set a long random `ADMIN_KEY` and serve over HTTPS.
- Add rate-limiting (`express-rate-limit`) and a data-retention job to delete old locations.
- For native background tracking, build an Android/iOS app that uses the same `/api/register` and `/api/location` endpoints.

## License
MIT
