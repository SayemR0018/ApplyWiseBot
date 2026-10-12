import { z } from "zod";
import { generateJson, jsonError, readJsonBody, UserFacingError } from "@/lib/server/ai";
import { ProfileSchema, TailorResponseSchema, type Profile, type TailorResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  profile: ProfileSchema,
  job: z.object({
    id: z.string(),
    title: z.string(),
    company: z.string(),
    location: z.string(),
    description: z.string(),
  }),
});

const SYSTEM = `You tailor a candidate's CV and write a cover letter for one job. ABSOLUTE RULE: NO FABRICATION.
You may only reorder, select and rephrase facts already present in the candidate profile.
Never add employers, titles, dates, metrics, tools, skills, degrees or achievements that are not in the profile.

The profile's experience entries are referenced as "exp:<index>" and project entries as "proj:<index>" (0-based, as given).
Return JSON:
{
 "tailored_cv": {
   "summary": "2-3 sentence summary built only from profile facts, angled at this job",
   "skills": ["subset of profile.skills, most relevant first, exact spelling from the profile"],
   "experience": [{"company","title","start","end","bullets":[{"text","source_ref":"exp:<index>"}]}],
   "projects": [{"name","bullets":[{"text","source_ref":"proj:<index>"}]}],
   "education": [{"institution","degree","year"}],
   "certifications": [], "languages": []
 },
 "cover_letter": "plain text, max 230 words, addressed to the hiring team at the company, signed with the candidate's name. No placeholders like [Company] or [Date].",
 "keyword_report": {"matched": ["job keywords evidenced in the profile"], "missing": ["important job keywords not evidenced"]},
 "unverified_requirements": ["job requirements the profile does not prove; do NOT claim them anywhere"]
}
Keep experience entries in the profile's company/title/start/end exactly. Every bullet's source_ref must point to the entry it was rephrased from.`;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function guard(profile: Profile, out: TailorResponse) {
  let removed = 0;
  const cv = out.tailored_cv;
  const validRef = (ref: string, kind: "exp" | "proj") => {
    const m = /^(exp|proj):(\d+)$/.exec(ref.trim());
    if (!m || m[1] !== kind) return false;
    const idx = Number(m[2]);
    return kind === "exp" ? idx < profile.experience.length : idx < profile.projects.length;
  };

  const experience = cv.experience
    .map((e) => {
      const bullets = e.bullets.filter((b) => validRef(b.source_ref, "exp"));
      removed += e.bullets.length - bullets.length;
      // Restore the factual header (company/title/dates) from the referenced profile entry.
      const ref = bullets[0] ? Number(bullets[0].source_ref.split(":")[1]) : -1;
      const src =
        profile.experience[ref] ??
        profile.experience.find((p) => norm(p.company) === norm(e.company) && norm(p.title) === norm(e.title));
      if (!src) {
        removed += bullets.length + (bullets.length === 0 ? 1 : 0);
        return null;
      }
      return { company: src.company, title: src.title, start: src.start, end: src.end, bullets };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const projects = cv.projects
    .map((p) => {
      const bullets = p.bullets.filter((b) => validRef(b.source_ref, "proj"));
      removed += p.bullets.length - bullets.length;
      const ref = bullets[0] ? Number(bullets[0].source_ref.split(":")[1]) : -1;
      const src = profile.projects[ref] ?? profile.projects.find((x) => norm(x.name) === norm(p.name));
      if (!src) {
        removed += bullets.length + (bullets.length === 0 ? 1 : 0);
        return null;
      }
      return { name: src.name, bullets };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const profileSkills = new Map(profile.skills.map((s) => [norm(s), s]));
  const skills: string[] = [];
  for (const s of cv.skills) {
    const hit = profileSkills.get(norm(s));
    if (hit && !skills.includes(hit)) skills.push(hit);
    else if (!hit) removed++;
  }

  const certSet = new Set(profile.certifications.map(norm));
  const certifications = cv.certifications.filter((c) => certSet.has(norm(c)));
  removed += cv.certifications.length - certifications.length;

  return {
    tailored_cv: {
      summary: cv.summary,
      skills,
      experience,
      projects,
      // Education and languages are copied verbatim from the profile: nothing to tailor, nothing to invent.
      education: profile.education,
      certifications: certifications.length ? certifications : profile.certifications,
      languages: profile.languages,
    },
    cover_letter: out.cover_letter,
    keyword_report: out.keyword_report,
    unverified_requirements: out.unverified_requirements,
    removed_count: removed,
  };
}

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await readJsonBody(req));
    if (!parsed.success) throw new UserFacingError("Send a profile and one job to tailor for.");
    const { profile, job } = parsed.data;
    if (profile.experience.length === 0 && profile.projects.length === 0) {
      throw new UserFacingError("Your profile has no experience or projects to tailor. Add them in the review step.");
    }

    const indexed = {
      name: profile.name,
      location: profile.location,
      summary: profile.summary,
      skills: profile.skills,
      experience: profile.experience.map((e, i) => ({ ref: `exp:${i}`, ...e })),
      projects: profile.projects.map((p, i) => ({ ref: `proj:${i}`, ...p })),
      education: profile.education,
      certifications: profile.certifications,
      languages: profile.languages,
      total_years_experience: profile.total_years_experience,
    };

    const out = await generateJson({
      system: SYSTEM,
      user: `CANDIDATE PROFILE:\n${JSON.stringify(indexed)}\n\nJOB:\n${JSON.stringify({
        ...job,
        description: job.description.slice(0, 3000),
      })}`,
      schema: TailorResponseSchema,
      budgetMs: 55_000,
      maxTokens: 3500,
    });

    return Response.json(guard(profile, out));
  } catch (err) {
    return jsonError(err);
  }
}
