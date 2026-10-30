# SafeRoute: community hazard map (HERHACK 2026)

Anonymous web app where people report unsafe places, see a risk heatmap built from those reports,
filter for evening and night risk, and share their location by SMS or share sheet with one tap.

## Setup
1. Create a new Supabase project. In the SQL Editor, run `saferoute_setup.sql` once.
2. Copy `.env.example` to `.env.local` and fill in the project URL and the **anon** key.
3. `npm install` then `npm run dev`, and open http://localhost:3000.
4. Deploy on Vercel: add the same two variables in the project settings.

## How it works
- Next.js, TypeScript, Leaflet with OpenStreetMap tiles, Supabase (Postgres).
- No accounts and no personal data. A random device token only limits spam to 5 reports per hour.
- Public users can read and add reports only. Access is enforced with Postgres row level security.
- The risk score is calculated in the database function `risk_cells`: severity x time-of-day weight x recency.
- The SOS button shares a one-time location link through the phone's own SMS or share sheet. Nothing is stored.

## Limits and next steps
- Sample points are made-up demo data.
- Safer-route suggestions that avoid high-risk cells are planned.
- Live location tracking is not built. SOS sends the position at the moment it is pressed.

## Team
- Ahmed Muhammed Omokunmi: app, database, deployment
- Ruqayah Shehu: risk scoring logic, map data, research, testing, pitch

## AI disclosure
An AI assistant (Claude) helped write parts of the code. The team designed, tested and directed the project.
