# SafeRoute: Anonymous Community Safety Map

An anonymous, mobile-first web app where people report unsafe places, see a risk map built from those reports, get an alarm when they come within 100 m of a high-risk point, and send their location to someone they trust with one tap.

Built for HERHACK 2026 (Student Innovation track and the Women Safety special award).

- **Live app:** https://womensaferoute.vercel.app
- **Demo video:** https://youtu.be/Jgfl9Vchxt4
- **Source code:** https://github.com/commandofss/saferoute

## What it does

- **Anonymous reports.** 13 case types: rape / sexual assault, kidnapping, physical assault, robbery, theft, harassment, stalking, gang or cult activity, unsafe transport, poor lighting, isolated road, blocked path, other. Each report has a seriousness level and a time of day.
- **Pick the place four ways.** Use the phone's GPS, tap the map, type latitude and longitude, or type UTM easting and northing (WGS84, zones 31, 32 and 33).
- **100 m points.** Reports within 100 m of each other count as one point. The map draws one 100 m circle per point, coloured by risk score.
- **Case filter.** Show all types, only serious crimes, or any single type. There is also an evening and night filter.
- **Map views.** Street map, satellite imagery, and satellite with place names.
- **Danger alarm.** While the app is open, it rings and vibrates when the user is within 100 m of a point above a chosen risk level. Tones: soft chime, urgent beeps, siren, or the user's own audio file (under 1 MB, kept on the phone only).
- **Offline alerts.** After pressing "Save this area for offline use", the risk points around the user are stored on the phone, so the alarm still works without internet.
- **SOS.** One tap shares the current location by SMS or the phone's share sheet. Nothing is stored.
- **Installable.** It is a progressive web app, so it can be installed on a phone or computer. An in-app guide explains how to use it.

## Privacy and safety by design

- No accounts, no names, no personal data stored.
- A random device token is used only to limit each device to 5 reports per hour.
- For rape / sexual assault, kidnapping and physical assault, no free-text note is collected and seriousness is always set to the highest level.
- The public can only read and add reports. This is enforced with PostgreSQL row-level security and column-level permissions. The app uses only the public (anon) key.
- The map shows a 100 m circle, not an exact home or shop.
- The user's position is never saved. For alerts, the app asks the database for risk points inside a box of about 1 km around the user.

## How it works

- **App:** Next.js 14, React, TypeScript.
- **Map:** Leaflet with OpenStreetMap tiles and Esri World Imagery for satellite.
- **Database:** Supabase (PostgreSQL).
- **100 m grouping:** each new report is assigned to the nearest existing point within 100 m (real ground distance, haversine). The first report of a point is its anchor, so clusters cannot chain into long strips.
- **Risk score:** calculated in the database function `risk_points`: severity x time-of-day weight (night 1.5, evening 1.2, day 1.0) x recency (older reports count less). The function can filter by case type.
- **Coordinates:** `lib/coords.ts` converts between WGS84 and UTM. It was checked against a reference library (pyproj) and matched to the millimetre at six test points in zones 31, 32 and 33.
- **Alarm:** the phone's GPS (watchPosition), the Web Audio API, vibration, and a screen wake lock while alerts are on.
- **Offline and install:** a service worker (`public/sw.js`) and a web app manifest.
- **Hosting:** Vercel.

## Setup

1. Create a **new** Supabase project. In the SQL Editor, run these files **once each, in this order**:
   1. `saferoute_setup.sql`
   2. `saferoute_update_100m.sql`
   3. `saferoute_update_categories.sql`
   4. `saferoute_update_filter.sql`

   Do not run `saferoute_update_100m.sql` again after the filter file. It would bring back an older version of `risk_points` and cause a "could not choose the best candidate function" error. If that happens, run:
   `drop function if exists public.risk_points(double precision, double precision, double precision, double precision, boolean);`
2. Copy `.env.example` to `.env.local` and fill in the project URL and the **anon** key. Never use the `service_role` key in this project.
3. Run `npm install`, then `npm run dev`, and open http://localhost:3000.
4. Deploy on Vercel: import the repository and add the same two variables (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`), then redeploy.

### Testing the alarm without walking
In Chrome press F12, open the three-dot menu, then More tools, then Sensors, and set a custom location near a risk point. The app also has a "Test alert and sound" button.

## Project structure

- `app/` : page layout and styles
- `components/MapApp.tsx` : map, filters, report form, coordinate entry
- `components/AlertPanel.tsx` : proximity alarm, tones, offline saving
- `components/InstallButton.tsx` : service worker registration and the Install app button
- `lib/coords.ts` : WGS84 and UTM conversion
- `lib/supabase.ts` : database client
- `public/` : manifest, service worker, logo and icons
- `*.sql` : database setup and updates

## Limits

- Alarms ring only while the app is open with the screen on. Phone browsers cannot read location in the background.
- Coordinates must be WGS84. The Minna datum is not supported yet.
- The points shown in the demo are made-up test data (marked `is_demo` in the database).
- There is no moderation page yet. Rate limits and 100 m merging reduce false or repeated reports.
- Satellite imagery and map tiles need an internet connection.

## Next steps

- A native Android and iPhone app with background alerts.
- A moderation page to remove false reports.
- A Minna datum option.
- Local languages.
- Partnerships with campus security and local authorities who can act on the hotspots.

## Credits and data

- Map data: OpenStreetMap contributors.
- Satellite imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community.
- Map library: Leaflet.

## Team

- **Ahmed Muhammed Omokunmi:** web app, database, deployment
- **Ruqayah Shehu:** GIS expertise, risk-scoring review, research, testing, presentation

Both team members designed the idea and tested the app. Both are MSc Surveying and Geo-Informatics students.

