# eReferral App (DOH Connectathon)

Local eReferral UI + API that talks to the PH eReferral FHIR CDR and terminology server.

## Prerequisites

- Node.js 18+ (20+ recommended)
- Network access to:
  - FHIR: `https://cdr.pheref.fhirlab.net/fhir`
  - Terminology: `https://tx.fhirlab.net/fhir`

SQL Server is optional. With the default `.env`, the app uses an in-memory local DB and treats FHIR as the source of truth.

## Setup (another machine)

```bash
cd ereferral-app
copy .env.example .env
npm install
npm start
```

On macOS/Linux use `cp .env.example .env` instead of `copy`.

Open: [http://localhost:3000](http://localhost:3000)

## Configure `.env`

At minimum, review:

| Variable | Purpose |
|----------|---------|
| `PORT` | App port (default `3000`) |
| `FHIR_BASE_URL` | Connectathon CDR base |
| `TX_BASE_URL` | Terminology server base |
| `TEAM_PREFIX` | Your team prefix (e.g. `TEAM07`) |
| `DEFAULT_FACILITY_*` | Home facility shown on Generate Referral |
| `USE_PERSISTENT_LOCAL_DB` | `false` = in-memory only; `true` = local SQLite file |

Do **not** commit `.env`. Only `.env.example` is in git.

## Scripts

```bash
npm start   # run server
npm run dev # run with --watch
```

## Deploying to Netlify

The repository is configured for one-click deployment on Netlify with Serverless Functions:

1. **Connect GitHub repository** in Netlify dashboard.
2. Netlify will auto-detect `netlify.toml`.
3. In **Site Configuration > Environment Variables**, optionally configure:
   - `FHIR_BASE_URL` (default: `https://cdr.pheref.fhirlab.net/fhir`)
   - `TX_BASE_URL` (default: `https://tx.fhirlab.net/fhir`)
   - `TEAM_PREFIX` (e.g. `TEAM07`)
   - `DEFAULT_FACILITY_FHIR_ID`, `DEFAULT_FACILITY_NAME`, etc.
4. Click **Deploy**. The static UI is served at `/` and API routes are served via Netlify Functions at `/api/*`.

## Notes for teammates

- Generate Referral loads **Referral Priority** from `/api/psgc/referral-categories` (DOH `referral-category` ValueSet).
- Sending/receiving practitioner roles load **only after** you select a facility (`/api/practitioners/roles?organization=...`).
- Hard-refresh the browser (Ctrl+F5) after pulling new UI changes.
