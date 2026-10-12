import { z } from "zod";
import { generateJson, jsonError, readJsonBody, UserFacingError } from "@/lib/server/ai";
import { MatchResponseSchema, ProfileSchema, SCORE_MAX, type MatchResult, type ScoreKey } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const JobInput = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  description: z.string(),
});
const Body = z.object({ profile: ProfileSchema, jobs: z.array(JobInput).min(1).max(12) });

const SYSTEM = `You are a strict, evidence-based recruiter screening one candidate against several job postings.
For EVERY job return one entry in {"results":[...]} with:
- "job_id": the job's id exactly as given
- "hard_filter_failures": list of mandatory requirements the candidate clearly fails. Only use these categories:
  location/remote mismatch (e.g. on-site in a country the candidate is not in and no remote/relocation stated; or "US only" when candidate is elsewhere),
  required years of experience far above the candidate's (e.g. requires 8+ and candidate has 3),
  a mandatory degree, license or certification the candidate lacks,
  a required spoken language the candidate does not list.
  Use [] when nothing mandatory is clearly failed. Do not list nice-to-haves here.
- "scores": {"skills":0-25,"experience":0-25,"education":0-15,"responsibilities":0-15,"goals_sector":0-10,"location_salary_arrangement":0-10}
- "total": sum of scores
- "matched_evidence": 2-4 short points quoting or citing the CV (e.g. "5 yrs React at Acme") that support the match. Only cite what is in the profile.
- "missing_requirements": important requirements from the posting not evidenced in the CV
- "one_line_verdict": one sentence
Keyword overlap must never override a mandatory requirement: if a hard requirement fails, list it even if skills overlap strongly.
Be concise. Return only JSON.`;

export async function POST(req: Request) {
  try {
    const raw = await readJsonBody(req);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("Send a profile and 1-12 jobs to match.");
    const { profile, jobs } = parsed.data;

    const compactProfile = {
      location: profile.location,
      summary: profile.summary,
      skills: profile.skills.slice(0, 40),
      total_years_experience: profile.total_years_experience,
      seniority: profile.seniority,
      experience: profile.experience.slice(0, 6).map((e) => ({
        company: e.company,
        title: e.title,
        start: e.start,
        end: e.end,
        bullets: e.bullets.slice(0, 4).map((b) => b.slice(0, 200)),
      })),
      education: profile.education,
      certifications: profile.certifications,
      languages: profile.languages,
      preferences: profile.preferences,
    };
    const compactJobs = jobs.map((j) => ({ ...j, description: j.description.slice(0, 1600) }));

    const data = await generateJson({
      system: SYSTEM,
      user: `CANDIDATE PROFILE:\n${JSON.stringify(compactProfile)}\n\nJOBS:\n${JSON.stringify(compactJobs)}`,
      schema: MatchResponseSchema,
      budgetMs: 55_000,
      maxTokens: 6000,
    });

    const ids = new Set(jobs.map((j) => j.id));
    const results: MatchResult[] = data.results
      .filter((r) => ids.has(r.job_id))
      .map((r) => {
        const scores = { ...r.scores };
        for (const k of Object.keys(SCORE_MAX) as ScoreKey[]) {
          scores[k] = Math.round(Math.min(SCORE_MAX[k], Math.max(0, scores[k])) * 10) / 10;
        }
        // Never trust the model's total: recompute from the clamped parts.
        const total = Math.round(Object.values(scores).reduce((a, b) => a + b, 0));
        return { ...r, scores, total, eligible: r.hard_filter_failures.length === 0 };
      });
    // Deduplicate on job_id (keep first) in case the model repeated one.
    const seen = new Set<string>();
    const unique = results.filter((r) => (seen.has(r.job_id) ? false : (seen.add(r.job_id), true)));
    unique.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.total - a.total);

    return Response.json({ results: unique, unmatched: jobs.filter((j) => !seen.has(j.id)).map((j) => j.id) });
  } catch (err) {
    return jsonError(err);
  }
}
