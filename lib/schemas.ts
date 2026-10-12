import { z } from "zod";

// Lenient primitives: models sometimes return null/omit fields; normalise to null or [].
const str = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()));
const reqStr = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const arr = <T extends z.ZodTypeAny>(s: T) =>
  z
    .array(s)
    .nullish()
    .transform((v) => (v ?? []) as z.output<T>[]);
const strArr = arr(z.union([z.string(), z.number()]).transform((v) => String(v).trim())).transform((v) =>
  v.filter((x) => x.length > 0),
);

export const EducationSchema = z.object({
  institution: str,
  degree: str,
  year: str,
});

export const ProfileSchema = z.object({
  name: str,
  email: str,
  phone: str,
  location: str,
  summary: str,
  target_titles: strArr,
  skills: strArr,
  experience: arr(
    z.object({
      company: str,
      title: str,
      start: str,
      end: str,
      bullets: strArr,
    }),
  ),
  education: arr(EducationSchema),
  projects: arr(z.object({ name: str, bullets: strArr })),
  certifications: strArr,
  languages: strArr,
  total_years_experience: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  seniority: str,
  preferences: z
    .object({
      locations: strArr,
      remote_ok: z.boolean().nullish().transform((v) => v ?? null),
      sectors: strArr,
    })
    .nullish()
    .transform((v) => v ?? { locations: [], remote_ok: null, sectors: [] }),
});
export type Profile = z.output<typeof ProfileSchema>;

export type Job = {
  id: string;
  source: "Remotive" | "Arbeitnow";
  title: string;
  company: string;
  location: string;
  remote: boolean;
  description: string;
  url: string;
  postedAt: string | null;
};

export const SCORE_MAX = {
  skills: 25,
  experience: 25,
  education: 15,
  responsibilities: 15,
  goals_sector: 10,
  location_salary_arrangement: 10,
} as const;
export type ScoreKey = keyof typeof SCORE_MAX;

const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  });

export const MatchResponseSchema = z.object({
  results: z.array(
    z.object({
      job_id: reqStr,
      hard_filter_failures: strArr,
      scores: z.object({
        skills: num,
        experience: num,
        education: num,
        responsibilities: num,
        goals_sector: num,
        location_salary_arrangement: num,
      }),
      total: num,
      matched_evidence: strArr,
      missing_requirements: strArr,
      one_line_verdict: str.transform((v) => v ?? ""),
    }),
  ),
});
export type MatchResult = z.output<typeof MatchResponseSchema>["results"][number] & { eligible: boolean };

const BulletSchema = z.object({ text: reqStr, source_ref: reqStr });

export const TailorResponseSchema = z.object({
  tailored_cv: z.object({
    summary: str.transform((v) => v ?? ""),
    skills: strArr,
    experience: arr(
      z.object({
        company: str,
        title: str,
        start: str,
        end: str,
        bullets: arr(BulletSchema),
      }),
    ),
    projects: arr(z.object({ name: str, bullets: arr(BulletSchema) })),
    education: arr(EducationSchema),
    certifications: strArr,
    languages: strArr,
  }),
  cover_letter: reqStr
    .refine((v) => v.split(/\s+/).filter(Boolean).length <= 260, "cover_letter must be at most 250 words")
    .refine((v) => !/\[[^\]]{2,40}\]|\{\{|<[A-Z][A-Za-z ]+>/.test(v), "cover_letter must not contain placeholders"),
  keyword_report: z
    .object({ matched: strArr, missing: strArr })
    .nullish()
    .transform((v) => v ?? { matched: [], missing: [] }),
  unverified_requirements: strArr,
});
export type TailorResponse = z.output<typeof TailorResponseSchema>;
export type TailoredCv = TailorResponse["tailored_cv"];
