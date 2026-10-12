# ApplyWiseBot: AI Job Search & Application Agent (MVP)

Upload a CV (PDF/DOCX). The app extracts an editable profile, pulls live jobs, hard-filters and scores them,
and prepares a tailored CV and cover letter for the job you pick. **It never submits anything.** You approve
the exact package and then apply yourself through the original vacancy URL.

## How to use
1. Upload your CV (PDF or DOCX, max 4 MB).
2. Review and correct the extracted profile, then click **Confirm & find jobs**.
3. Read the ranked matches (score, evidence, gaps, eligibility) and click **Prepare application**.
4. Review/edit the tailored CV and cover letter, download DOCX or print to PDF, then **Approve**.
5. Click **Open vacancy & apply**, apply on the employer's site, then **Mark as applied**. Track everything in **Tracker**.

## Stack
Next.js (App Router, Node.js runtime) · TypeScript · Tailwind · `openai` · `unpdf` · `mammoth` · `docx` · `zod`.
No database and no auth. All user state lives in the browser's localStorage; the server is stateless.

## API
| Route | Purpose |
|---|---|
| `GET /api/health` | `{ ok, openaiKeyConfigured }` (boolean only) |
| `POST /api/extract-profile` | multipart `file` → `{ profile, cvText }` |
| `POST /api/jobs` | `{ profile }` → normalized, deduped jobs from Remotive + Arbeitnow (≤30 days old) |
| `POST /api/match` | `{ profile, jobs[≤12] }` → one batched AI call; server clamps sub-scores and recomputes totals |
| `POST /api/tailor` | `{ profile, job }` → tailored CV + cover letter with a deterministic no-fabrication guard |
| `POST /api/export` | `{ kind: "cv" \| "cover_letter", ... }` → DOCX file |

Every AI call uses JSON mode at temperature 0.2, is validated with zod, and retries once on a validation failure.

## Setup
```bash
cp .env.example .env.local   # set OPENAI_API_KEY
npm install && npm run dev
```
Environment: `OPENAI_API_KEY` (required, server-only), `OPENAI_MODEL` (optional, default `gpt-4o-mini`, read per request).

## Decisions and deviations
- **Both job sources are live.** Remotive and Arbeitnow both responded during setup, so neither was dropped.
  Remotive is queried with up to 3 searches (two target titles plus the top skill). Arbeitnow has no search parameter,
  so its first page is fetched and filtered locally by keyword relevance. Each fetch has an 8s timeout via `Promise.allSettled`.
- **Matching** scores the 10 most keyword-relevant jobs in one call, to stay within the function time limit.
- **`cacheComponents` is disabled** in `next.config.ts`. Next 16's default template enables it, and it rejects the
  required `export const runtime = "nodejs"` route segment config.
- **Tailored CV adds a `projects` section** (bullets carry `source_ref: "proj:N"`), so project-heavy CVs aren't
  emptied. Experience bullets use `exp:N`.
- **No-fabrication guard (server):** it drops bullets whose `source_ref` is invalid; restores company/title/dates
  from the referenced profile entry; drops skills not in `profile.skills` (case-insensitive) and certifications not
  in the profile; copies education and languages verbatim from the profile. The UI shows "Removed N unsupported items".
- **Approval** is a SHA-256 of `{jobId, tailoredCv, coverLetter}`. Any edit after approval clears it and shows
  "Re-approval required". Apply actions are enabled only when the current hash equals the approved hash.
- **"Submission status unknown"** is set when you open the vacancy from an approved package but haven't marked it applied yet.
- **PDF** export is the browser's print dialog on `/print?job=<id>` (A4 print CSS). The cover letter prints on page 2.
- The profile editor edits the main fields and experience inline. Education and projects are shown read-only there.

## Next steps (out of scope for the MVP)
- Scheduled/cron job searches
- Database + auth (sync across devices)
- Telegram/email notifications
- Playwright-assisted form filling (still behind human approval)
- LinkedIn / other portal integrations (via official APIs only, no scraping)
- Multi-user support

## Privacy
Your CV is processed by OpenAI via this app's server and is not stored on the server. "Delete all my data" clears localStorage.
