import "server-only";
import type { Job, Profile } from "@/lib/schemas";

const TIMEOUT_MS = 8_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UA = "ApplyWiseBot/1.0 (job-search MVP)";

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function truncate(s: string, n = 3000) {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  description?: string;
  publication_date?: string;
};

async function fetchRemotive(query: string): Promise<Job[]> {
  const data = (await fetchJson(
    `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=20`,
  )) as { jobs?: RemotiveJob[] };
  return (data.jobs ?? []).map((j) => ({
    id: `remotive-${j.id}`,
    source: "Remotive" as const,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Remote",
    remote: true,
    description: truncate(stripHtml(j.description ?? "")),
    url: j.url,
    postedAt: j.publication_date ? new Date(j.publication_date).toISOString() : null,
  }));
}

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  tags?: string[];
  location?: string;
  created_at?: number;
};

async function fetchArbeitnow(): Promise<Job[]> {
  const data = (await fetchJson("https://www.arbeitnow.com/api/job-board-api")) as { data?: ArbeitnowJob[] };
  return (data.data ?? []).map((j) => ({
    id: `arbeitnow-${j.slug}`,
    source: "Arbeitnow" as const,
    title: j.title,
    company: j.company_name,
    location: j.location || (j.remote ? "Remote" : "Not specified"),
    remote: Boolean(j.remote),
    description: truncate(stripHtml(j.description ?? "")),
    url: j.url,
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
  }));
}

function canonicalUrl(u: string) {
  try {
    const url = new URL(u);
    return `${url.host.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|[^a-z0-9 ]/g, " ")
    .replace(/\b(m|f|w|d|x)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tokens(s: string) {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}
const STOP = new Set(["and", "the", "of", "for", "in", "to", "with", "a", "an", "or", "senior", "junior", "mid", "lead"]);

export function buildQueries(profile: Profile): string[] {
  const titles = profile.target_titles.slice(0, 2).map((t) => t.replace(/\b(senior|junior|lead|principal|sr\.?|jr\.?)\b/gi, "").trim());
  const skills = profile.skills.slice(0, 1);
  const qs = [...titles, ...skills].filter(Boolean).map((q) => q.slice(0, 60));
  return Array.from(new Set(qs.map((q) => q.toLowerCase()))).slice(0, 3);
}

export async function discoverJobs(profile: Profile) {
  const queries = buildQueries(profile);
  if (queries.length === 0) throw new Error("NO_QUERIES");

  const tasks: { source: Job["source"]; label: string; run: Promise<Job[]> }[] = [
    ...queries.map((q) => ({ source: "Remotive" as const, label: `Remotive "${q}"`, run: fetchRemotive(q) })),
    { source: "Arbeitnow" as const, label: "Arbeitnow", run: fetchArbeitnow() },
  ];
  const settled = await Promise.allSettled(tasks.map((t) => t.run));

  const sourceErrors: string[] = [];
  const all: Job[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") all.push(...r.value);
    else sourceErrors.push(`${tasks[i].label}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
  });

  // Relevance: overlap between job title/description and the profile's titles + skills.
  const titleTokens = new Set(profile.target_titles.flatMap(tokens));
  const skillSet = profile.skills.slice(0, 25).map((s) => s.toLowerCase());
  const relevance = (j: Job) => {
    const t = tokens(j.title);
    const titleHits = t.filter((x) => titleTokens.has(x)).length;
    const hay = `${j.title} ${j.description}`.toLowerCase();
    const skillHits = skillSet.filter((s) => s.length > 1 && hay.includes(s)).length;
    return titleHits * 3 + skillHits;
  };

  const now = Date.now();
  const seenUrl = new Set<string>();
  const seenKey = new Set<string>();
  const deduped: (Job & { relevance: number })[] = [];
  for (const j of all) {
    if (!j.url || !j.title) continue;
    if (j.postedAt && now - new Date(j.postedAt).getTime() > MAX_AGE_MS) continue;
    const cu = canonicalUrl(j.url);
    const key = `${norm(j.title)}|${norm(j.company)}`;
    if (seenUrl.has(cu) || seenKey.has(key)) continue;
    seenUrl.add(cu);
    seenKey.add(key);
    deduped.push({ ...j, relevance: relevance(j) });
  }

  // Arbeitnow has no search parameter, so keep only its listings with some relevance.
  const jobs = deduped
    .filter((j) => j.source === "Remotive" || j.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, 30)
    .map((j) => {
      const { relevance, ...rest } = j;
      void relevance;
      return rest;
    });

  return { jobs, queries, sourceErrors, fetchedTotal: all.length };
}
