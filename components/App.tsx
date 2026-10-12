"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Job, MatchResult, Profile, TailoredCv } from "@/lib/schemas";
import { SCORE_MAX } from "@/lib/schemas";
import {
  api,
  packageHash,
  STATUS_LABEL,
  useAppState,
  type AppState,
  type AuditEvent,
  type Pkg,
} from "@/lib/client/store";

/* ---------------------------------- toasts --------------------------------- */

type Toast = { id: number; kind: "error" | "success"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
const useToast = () => useContext(ToastCtx);

function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2 print:hidden">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`rounded-lg px-4 py-3 text-left text-sm shadow-lg ${
            t.kind === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- helpers --------------------------------- */

const btn =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const btnDanger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 read-only:bg-slate-50";
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

const splitList = (v: string) =>
  v
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const splitLines = (v: string) =>
  v
    .split("\n")
    .map((x) => x.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ListInput({
  value,
  onChange,
  rows,
  readOnly,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  rows?: number;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(value.join(", "));
  const joined = value.join(", ");
  const [last, setLast] = useState(joined);
  if (joined !== last) {
    setLast(joined);
    setText(joined);
  }
  return rows ? (
    <textarea
      className={input}
      rows={rows}
      value={text}
      readOnly={readOnly}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(splitList(text))}
    />
  ) : (
    <input
      className={input}
      value={text}
      readOnly={readOnly}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(splitList(text))}
    />
  );
}

function ScoreBadge({ match }: { match: MatchResult }) {
  const color = !match.eligible
    ? "bg-slate-200 text-slate-700"
    : match.total >= 70
      ? "bg-emerald-100 text-emerald-800"
      : match.total >= 50
        ? "bg-amber-100 text-amber-800"
        : "bg-rose-100 text-rose-800";
  return (
    <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full ${color}`}>
      <span className="text-lg font-bold leading-none">{match.total}</span>
      <span className="text-[10px]">/100</span>
    </div>
  );
}

/* ----------------------------------- app ----------------------------------- */

export default function App() {
  const { state, hydrated, update, log, reset } = useAppState();
  const [tab, setTab] = useState<"apply" | "tracker">("apply");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);

  const setStep = (step: AppState["step"]) => update((s) => ({ ...s, step }));

  const deleteAll = () => {
    if (!confirm("Delete all your data (CV, profile, packages, tracker and audit log) from this browser?")) return;
    reset();
    setTab("apply");
    toast("success", "All your data was deleted from this browser.");
  };

  const steps = [
    { n: 1, label: "Upload CV", enabled: true },
    { n: 2, label: "Review profile", enabled: !!state.profile },
    { n: 3, label: "Matches", enabled: state.matches.length > 0 || state.jobs.length > 0 },
    { n: 4, label: "Package & approve", enabled: !!(state.activeJobId && state.packages[state.activeJobId]) },
  ] as const;

  return (
    <ToastCtx.Provider value={toast}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <h1 className="text-lg font-semibold">ApplyWise · AI Job Search & Application Agent</h1>
              <p className="text-xs text-slate-500">
                Prepares tailored applications for your approval. It never submits anything for you.
              </p>
            </div>
            <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
              {(["apply", "tracker"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 font-medium ${tab === t ? "bg-white shadow-sm" : "text-slate-600"}`}
                >
                  {t === "apply" ? "Apply" : `Tracker (${Object.keys(state.packages).length})`}
                </button>
              ))}
            </nav>
          </div>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 pb-3 text-xs text-slate-500">
            <span>Your CV is processed by OpenAI via this app&apos;s server and is not stored on the server.</span>
            <button onClick={deleteAll} className="text-red-600 underline-offset-2 hover:underline">
              Delete all my data
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">
          {!hydrated ? (
            <div className="flex justify-center py-20 text-slate-400">
              <Spinner />
            </div>
          ) : tab === "tracker" ? (
            <Tracker
              state={state}
              update={update}
              openPackage={(id) => {
                update((s) => ({ ...s, activeJobId: id, step: 4 }));
                setTab("apply");
              }}
            />
          ) : (
            <>
              <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {steps.map((s) => (
                  <li key={s.n}>
                    <button
                      disabled={!s.enabled}
                      onClick={() => setStep(s.n)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-40 ${
                        state.step === s.n
                          ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          state.step === s.n ? "bg-indigo-600 text-white" : "bg-slate-200"
                        }`}
                      >
                        {s.n}
                      </span>
                      {s.label}
                    </button>
                  </li>
                ))}
              </ol>
              {state.step === 1 && <UploadStep state={state} update={update} log={log} />}
              {state.step === 2 && state.profile && <ProfileStep state={state} update={update} log={log} />}
              {state.step === 3 && <MatchesStep state={state} update={update} log={log} />}
              {state.step === 4 && state.activeJobId && state.packages[state.activeJobId] && (
                <PackageStep pkg={state.packages[state.activeJobId]} state={state} update={update} log={log} />
              )}
            </>
          )}
        </main>

        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-slate-500 print:hidden">
          Job listings provided by{" "}
          <a className="underline" href="https://remotive.com" target="_blank" rel="noopener noreferrer">
            Remotive
          </a>{" "}
          and{" "}
          <a className="underline" href="https://www.arbeitnow.com" target="_blank" rel="noopener noreferrer">
            Arbeitnow
          </a>
          . Applications are always submitted by you on the original vacancy page.
        </footer>
      </div>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </ToastCtx.Provider>
  );
}

type StepProps = {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  log: (e: AuditEvent, detail: string) => void;
};

/* ------------------------------- 1. upload -------------------------------- */

function UploadStep({ state, update, log }: StepProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return toast("error", "Upload a PDF or DOCX file.");
    if (file.size > 4 * 1024 * 1024) return toast("error", "File is too large. The maximum size is 4 MB.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { profile, cvText } = await api<{ profile: Profile; cvText: string }>("/api/extract-profile", {
        method: "POST",
        body: fd,
      });
      update((s) => ({
        ...s,
        fileName: file.name,
        cvText,
        originalProfile: profile,
        profile: structuredClone(profile),
        jobs: [],
        matches: [],
        step: 2,
      }));
      log("profile_extracted", `${file.name} → ${profile.name ?? "unnamed"}, ${profile.skills.length} skills`);
      toast("success", "Profile extracted. Review it before continuing.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="text-base font-semibold">Upload your CV</h2>
      <p className="mt-1 text-sm text-slate-600">
        PDF or DOCX, up to 4 MB. Everything else (target roles, skills, experience) is derived from it, and you can
        edit the result.
      </p>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) handle(e.dataTransfer.files[0]);
        }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center ${
          drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50"
        }`}
      >
        <input
          type="file"
          className="hidden"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={busy}
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {busy ? (
          <span className="flex items-center gap-2 text-sm text-slate-700">
            <Spinner /> Reading your CV and extracting your profile…
          </span>
        ) : (
          <>
            <span className="text-sm font-medium text-slate-800">Drop your CV here or click to choose a file</span>
            <span className="mt-1 text-xs text-slate-500">Scanned/image-only PDFs can&apos;t be read.</span>
          </>
        )}
      </label>
      {state.fileName && (
        <p className="mt-3 text-xs text-slate-500">
          Current CV: <strong>{state.fileName}</strong>. Uploading a new file replaces the profile but keeps your
          tracker.
        </p>
      )}
    </section>
  );
}

/* --------------------------- 2. profile review ---------------------------- */

function ProfileStep({ state, update, log }: StepProps) {
  const toast = useToast();
  const p = state.profile!;
  const [phase, setPhase] = useState<"" | "jobs" | "match">("");
  const set = (patch: Partial<Profile>) =>
    update((s) => ({ ...s, profile: s.profile ? { ...s.profile, ...patch } : s.profile }));

  const findJobs = async () => {
    setPhase("jobs");
    try {
      const jobsRes = await api<{ jobs: Job[]; sourceErrors: string[]; queries: string[] }>("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
      });
      log("jobs_fetched", `${jobsRes.jobs.length} jobs for: ${jobsRes.queries.join(", ")}`);
      update((s) => ({ ...s, jobs: jobsRes.jobs, sourceErrors: jobsRes.sourceErrors, matches: [] }));
      if (jobsRes.sourceErrors.length) toast("error", `Some sources failed: ${jobsRes.sourceErrors.join("; ")}`);
      if (jobsRes.jobs.length === 0) {
        toast("error", "No recent matching jobs found. Try different target titles or skills.");
        return;
      }
      setPhase("match");
      const top = jobsRes.jobs.slice(0, 10);
      const m = await api<{ results: MatchResult[] }>("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p, jobs: top }),
      });
      update((s) => ({ ...s, matches: m.results, step: 3 }));
      toast("success", `Scored ${m.results.length} jobs.`);
    } catch (e) {
      toast("error", (e as Error).message);
      if (state.jobs.length) update((s) => ({ ...s, step: 3 }));
    } finally {
      setPhase("");
    }
  };

  const setExp = (i: number, patch: Partial<Profile["experience"][number]>) =>
    set({ experience: p.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <section className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Review your profile</h2>
            <p className="mt-1 text-sm text-slate-600">
              Extracted from <strong>{state.fileName}</strong>. Fix anything that&apos;s wrong; only this edited copy
              is used. Your original CV text is kept unchanged.
            </p>
          </div>
          <button
            className={btnGhost}
            onClick={() => {
              if (confirm("Discard your edits and restore the profile as extracted?"))
                update((s) => ({ ...s, profile: structuredClone(s.originalProfile) }));
            }}
          >
            Reset to extracted
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={input} value={p.name ?? ""} onChange={(e) => set({ name: e.target.value || null })} />
          </Field>
          <Field label="Email">
            <input className={input} value={p.email ?? ""} onChange={(e) => set({ email: e.target.value || null })} />
          </Field>
          <Field label="Phone">
            <input className={input} value={p.phone ?? ""} onChange={(e) => set({ phone: e.target.value || null })} />
          </Field>
          <Field label="Location">
            <input
              className={input}
              value={p.location ?? ""}
              onChange={(e) => set({ location: e.target.value || null })}
            />
          </Field>
          <Field label="Seniority">
            <input
              className={input}
              value={p.seniority ?? ""}
              onChange={(e) => set({ seniority: e.target.value || null })}
            />
          </Field>
          <Field label="Total years of experience">
            <input
              className={input}
              type="number"
              min={0}
              step={0.5}
              value={p.total_years_experience ?? ""}
              onChange={(e) =>
                set({ total_years_experience: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Summary">
              <textarea
                className={input}
                rows={3}
                value={p.summary ?? ""}
                onChange={(e) => set({ summary: e.target.value || null })}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Target titles (comma separated, used for the job search)">
              <ListInput value={p.target_titles} onChange={(v) => set({ target_titles: v })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Skills (comma separated)">
              <ListInput value={p.skills} rows={3} onChange={(v) => set({ skills: v })} />
            </Field>
          </div>
          <Field label="Certifications">
            <ListInput value={p.certifications} onChange={(v) => set({ certifications: v })} />
          </Field>
          <Field label="Languages">
            <ListInput value={p.languages} onChange={(v) => set({ languages: v })} />
          </Field>
          <Field label="Preferred locations">
            <ListInput
              value={p.preferences.locations}
              onChange={(v) => set({ preferences: { ...p.preferences, locations: v } })}
            />
          </Field>
          <Field label="Preferred sectors">
            <ListInput
              value={p.preferences.sectors}
              onChange={(v) => set({ preferences: { ...p.preferences, sectors: v } })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={p.preferences.remote_ok === true}
              onChange={(e) => set({ preferences: { ...p.preferences, remote_ok: e.target.checked } })}
            />
            Open to remote work
          </label>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold">Experience</h3>
        {p.experience.length === 0 && <p className="mt-2 text-sm text-slate-500">No experience found in the CV.</p>}
        <div className="mt-3 space-y-4">
          {p.experience.map((e, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-4">
                <input
                  className={input}
                  aria-label="Title"
                  value={e.title ?? ""}
                  onChange={(ev) => setExp(i, { title: ev.target.value || null })}
                />
                <input
                  className={input}
                  aria-label="Company"
                  value={e.company ?? ""}
                  onChange={(ev) => setExp(i, { company: ev.target.value || null })}
                />
                <input
                  className={input}
                  aria-label="Start"
                  value={e.start ?? ""}
                  onChange={(ev) => setExp(i, { start: ev.target.value || null })}
                />
                <input
                  className={input}
                  aria-label="End"
                  value={e.end ?? ""}
                  onChange={(ev) => setExp(i, { end: ev.target.value || null })}
                />
              </div>
              <textarea
                className={`${input} mt-2`}
                rows={Math.min(8, e.bullets.length + 1)}
                value={e.bullets.join("\n")}
                onChange={(ev) => setExp(i, { bullets: ev.target.value.split("\n") })}
                onBlur={(ev) => setExp(i, { bullets: splitLines(ev.target.value) })}
              />
            </div>
          ))}
        </div>
        {(p.education.length > 0 || p.projects.length > 0) && (
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <h4 className="font-medium">Education</h4>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {p.education.map((ed, i) => (
                  <li key={i}>{[ed.degree, ed.institution, ed.year].filter(Boolean).join(", ")}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium">Projects</h4>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {p.projects.map((pr, i) => (
                  <li key={i}>{pr.name}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {state.matches.length > 0 && (
          <button className={btnGhost} onClick={() => update((s) => ({ ...s, step: 3 }))}>
            View previous matches
          </button>
        )}
        <button className={btnPrimary} onClick={findJobs} disabled={!!phase}>
          {phase && <Spinner />}
          {phase === "jobs" ? "Fetching live jobs…" : phase === "match" ? "Scoring matches…" : "Confirm & find jobs"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------ 3. matches -------------------------------- */

function MatchesStep({ state, update, log }: StepProps) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const jobsById = useMemo(() => new Map(state.jobs.map((j) => [j.id, j])), [state.jobs]);

  const prepare = async (job: Job, match: MatchResult) => {
    if (!state.profile) return;
    setBusyId(job.id);
    try {
      const r = await api<{
        tailored_cv: TailoredCv;
        cover_letter: string;
        keyword_report: { matched: string[]; missing: string[] };
        unverified_requirements: string[];
        removed_count: number;
      }>("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: state.profile, job }),
      });
      const now = new Date().toISOString();
      const pkg: Pkg = {
        jobId: job.id,
        job,
        match,
        tailoredCv: r.tailored_cv,
        coverLetter: r.cover_letter,
        keywordReport: r.keyword_report,
        unverified: r.unverified_requirements,
        removedCount: r.removed_count,
        status: "prepared",
        approval: null,
        needsReapproval: false,
        notes: state.packages[job.id]?.notes ?? "",
        createdAt: now,
        updatedAt: now,
        appliedAt: null,
      };
      update((s) => ({ ...s, packages: { ...s.packages, [job.id]: pkg }, activeJobId: job.id, step: 4 }));
      log("package_generated", `${job.title} @ ${job.company}${match.eligible ? "" : " (eligibility override)"}`);
      toast("success", "Application package ready for review.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (state.matches.length === 0) {
    return (
      <section className={card}>
        <p className="text-sm text-slate-600">
          {state.jobs.length
            ? `${state.jobs.length} jobs were fetched but not scored yet. Go back to the profile step and run the search again.`
            : "No matches yet."}
        </p>
        <button className={`${btnGhost} mt-3`} onClick={() => update((s) => ({ ...s, step: 2 }))}>
          Back to profile
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Top {state.matches.length} of {state.jobs.length} recent jobs, ranked. Jobs failing a mandatory requirement
          are listed last.
        </p>
        <button className={btnGhost} onClick={() => update((s) => ({ ...s, step: 2 }))}>
          Edit profile / search again
        </button>
      </div>
      {state.sourceErrors.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Some sources failed: {state.sourceErrors.join("; ")}
        </p>
      )}
      {state.matches.map((m) => {
        const job = jobsById.get(m.job_id);
        if (!job) return null;
        const existing = state.packages[job.id];
        const applied = existing?.status === "applied";
        return (
          <article key={m.job_id} className={`${card} ${m.eligible ? "" : "opacity-80"}`}>
            <div className="flex gap-4">
              <ScoreBadge match={m} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{job.title}</h3>
                  {!m.eligible && (
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">
                      Not eligible
                    </span>
                  )}
                  {applied && (
                    <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
                      Already applied
                    </span>
                  )}
                  {existing && !applied && (
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">
                      {STATUS_LABEL[existing.status]}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600">
                  {job.company} · {job.location}
                  {job.remote ? " · Remote" : ""} · {job.source} · posted {fmtDate(job.postedAt)}
                </p>
                <p className="mt-2 text-sm italic text-slate-700">{m.one_line_verdict}</p>
                {m.hard_filter_failures.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                    {m.hard_filter_failures.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-emerald-700">Evidence</h4>
                    <ul className="mt-1 list-disc pl-5 text-slate-700">
                      {m.matched_evidence.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-rose-700">Gaps</h4>
                    <ul className="mt-1 list-disc pl-5 text-slate-700">
                      {m.missing_requirements.length ? (
                        m.missing_requirements.map((x, i) => <li key={i}>{x}</li>)
                      ) : (
                        <li>None identified</li>
                      )}
                    </ul>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  {(Object.keys(SCORE_MAX) as (keyof typeof SCORE_MAX)[]).map((k) => (
                    <span key={k}>
                      {k.replaceAll("_", " ")}: {m.scores[k]}/{SCORE_MAX[k]}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    className={btnPrimary}
                    disabled={applied || !!busyId || (!m.eligible && !override[job.id])}
                    onClick={() => prepare(job, m)}
                  >
                    {busyId === job.id && <Spinner />}
                    {busyId === job.id ? "Tailoring CV & letter…" : existing ? "Regenerate package" : "Prepare application"}
                  </button>
                  {existing && (
                    <button
                      className={btnGhost}
                      onClick={() => update((s) => ({ ...s, activeJobId: job.id, step: 4 }))}
                    >
                      Open package
                    </button>
                  )}
                  <a className={btnGhost} href={job.url} target="_blank" rel="noopener noreferrer">
                    View original vacancy
                  </a>
                  {!m.eligible && !applied && (
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!override[job.id]}
                        onChange={(e) => setOverride((o) => ({ ...o, [job.id]: e.target.checked }))}
                      />
                      Prepare anyway (I understand I may not meet a mandatory requirement)
                    </label>
                  )}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

/* --------------------------- 4. package & approve ------------------------- */

function PackageStep({ pkg, state, update, log }: StepProps & { pkg: Pkg }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const { job, match, tailoredCv: cv } = pkg;

  useEffect(() => {
    let alive = true;
    packageHash(pkg).then((h) => alive && setHash(h));
    return () => {
      alive = false;
    };
  }, [pkg]);

  const approvedAndCurrent = !!pkg.approval && hash === pkg.approval.hash;
  const applied = pkg.status === "applied";

  const patch = (fn: (p: Pkg) => Pkg) =>
    update((s) => {
      const cur = s.packages[pkg.jobId];
      return cur ? { ...s, packages: { ...s.packages, [pkg.jobId]: { ...fn(cur), updatedAt: new Date().toISOString() } } } : s;
    });

  // Any content edit after approval invalidates it: the approved hash no longer matches.
  const editContent = (fn: (p: Pkg) => Pkg) => {
    const wasApproved = !!pkg.approval;
    patch((p) => {
      const next = fn(p);
      return p.approval ? { ...next, approval: null, needsReapproval: true, status: "prepared" } : next;
    });
    if (wasApproved) log("edited_invalidated", `${job.title} @ ${job.company}: content changed after approval`);
  };
  const setCv = (c: Partial<TailoredCv>) => editContent((p) => ({ ...p, tailoredCv: { ...p.tailoredCv, ...c } }));

  const approve = async () => {
    const h = await packageHash(pkg);
    const at = new Date().toISOString();
    patch((p) => ({ ...p, approval: { hash: h, at }, needsReapproval: false, status: "approved" }));
    update((s) => ({ ...s, approvals: [{ jobId: pkg.jobId, hash: h, at }, ...s.approvals] }));
    log("approved", `${job.title} @ ${job.company} sha256:${h.slice(0, 12)}…`);
    setEditing(false);
    toast("success", "Approved. You can now open the vacancy and apply manually.");
  };
  const reject = () => {
    patch((p) => ({ ...p, status: "rejected", approval: null }));
    log("rejected", `${job.title} @ ${job.company}`);
    setEditing(false);
    toast("success", "Package rejected.");
  };
  const openVacancy = () => {
    window.open(job.url, "_blank", "noopener,noreferrer");
    if (pkg.status === "approved") patch((p) => ({ ...p, status: "unknown" }));
  };
  const markApplied = () => {
    if (!approvedAndCurrent || applied) return;
    const at = new Date().toISOString();
    patch((p) => ({ ...p, status: "applied", appliedAt: at }));
    log("marked_applied", `${job.title} @ ${job.company} sha256:${pkg.approval!.hash.slice(0, 12)}…`);
    toast("success", "Marked as applied.");
  };

  const download = async (kind: "cv" | "cover_letter") => {
    setDownloading(kind);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          job: { title: job.title, company: job.company },
          contact: {
            name: state.profile?.name ?? null,
            email: state.profile?.email ?? null,
            phone: state.profile?.phone ?? null,
            location: state.profile?.location ?? null,
          },
          tailoredCv: cv,
          coverLetter: pkg.coverLetter,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        (kind === "cv" ? "CV.docx" : "CoverLetter.docx");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  const ro = !editing || applied;
  const words = pkg.coverLetter.split(/\s+/).filter(Boolean).length;

  return (
    <section className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{job.title}</h2>
            <p className="text-sm text-slate-600">
              {job.company} · {job.location} · {job.source}
            </p>
            <a
              className="break-all text-sm text-indigo-700 underline"
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {job.url}
            </a>
          </div>
          {match && <ScoreBadge match={match} />}
        </div>
        {match && (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold uppercase text-emerald-700">Strengths</h4>
              <ul className="mt-1 list-disc pl-5">
                {match.matched_evidence.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase text-rose-700">Gaps</h4>
              <ul className="mt-1 list-disc pl-5">
                {[...match.hard_filter_failures, ...match.missing_requirements].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {pkg.unverified.length > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Not claimed (your CV doesn&apos;t prove these): {pkg.unverified.join("; ")}
          </p>
        )}
        {pkg.removedCount > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Removed {pkg.removedCount} unsupported item{pkg.removedCount === 1 ? "" : "s"} that could not be traced to
            your CV.
          </p>
        )}
        <div className="mt-2 text-xs text-slate-500">
          Keywords matched: {pkg.keywordReport.matched.join(", ") || "—"} · missing:{" "}
          {pkg.keywordReport.missing.join(", ") || "—"}
        </div>
      </div>

      {/* Approval bar */}
      <div className={`${card} sticky top-2 z-10`}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-1 text-xs font-semibold ${
              applied
                ? "bg-emerald-600 text-white"
                : approvedAndCurrent
                  ? "bg-emerald-100 text-emerald-800"
                  : pkg.status === "rejected"
                    ? "bg-slate-200 text-slate-700"
                    : "bg-amber-100 text-amber-800"
            }`}
          >
            {applied
              ? "Already applied"
              : pkg.needsReapproval
                ? "Re-approval required"
                : approvedAndCurrent
                  ? `Approved ${new Date(pkg.approval!.at).toLocaleString()}`
                  : STATUS_LABEL[pkg.status]}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={approve} disabled={applied || approvedAndCurrent || !hash}>
              Approve
            </button>
            <button className={btnGhost} onClick={() => setEditing((e) => !e)} disabled={applied}>
              {editing ? "Done editing" : "Edit"}
            </button>
            <button className={btnDanger} onClick={reject} disabled={applied || pkg.status === "rejected"}>
              Reject
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <button className={btnPrimary} onClick={openVacancy} disabled={!approvedAndCurrent || applied}>
            Open vacancy & apply
          </button>
          <button className={btnGhost} onClick={markApplied} disabled={!approvedAndCurrent || applied}>
            {applied ? "Already applied" : "Mark as applied"}
          </button>
          <span className="mx-1 hidden w-px bg-slate-200 sm:block" />
          <button className={btnGhost} onClick={() => download("cv")} disabled={!!downloading}>
            {downloading === "cv" && <Spinner />} CV (.docx)
          </button>
          <button className={btnGhost} onClick={() => download("cover_letter")} disabled={!!downloading}>
            {downloading === "cover_letter" && <Spinner />} Cover letter (.docx)
          </button>
          <a className={btnGhost} href={`/print?job=${encodeURIComponent(pkg.jobId)}`} target="_blank">
            PDF (print)
          </a>
        </div>
        {hash && (
          <p className="mt-2 break-all font-mono text-[10px] text-slate-400">
            content sha256: {hash}
            {pkg.approval && hash !== pkg.approval.hash ? " (differs from approved hash)" : ""}
          </p>
        )}
      </div>

      {/* CV preview / editor */}
      <div className={card}>
        <h3 className="font-semibold">Tailored CV {editing && <span className="text-xs text-indigo-600">(editing)</span>}</h3>
        <div className="mt-3 space-y-4">
          <Field label="Summary">
            <textarea className={input} rows={3} readOnly={ro} value={cv.summary} onChange={(e) => setCv({ summary: e.target.value })} />
          </Field>
          <Field label="Skills">
            <ListInput value={cv.skills} readOnly={ro} onChange={(v) => setCv({ skills: v })} />
          </Field>
          {cv.experience.map((e, i) => (
            <div key={i}>
              <p className="text-sm font-semibold">
                {e.title} · {e.company}{" "}
                <span className="font-normal text-slate-500">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
              </p>
              {e.bullets.map((b, j) => (
                <div key={j} className="mt-1 flex items-start gap-2">
                  <textarea
                    className={input}
                    rows={2}
                    readOnly={ro}
                    value={b.text}
                    onChange={(ev) =>
                      setCv({
                        experience: cv.experience.map((x, xi) =>
                          xi !== i
                            ? x
                            : { ...x, bullets: x.bullets.map((y, yi) => (yi === j ? { ...y, text: ev.target.value } : y)) },
                        ),
                      })
                    }
                  />
                  <span className="mt-2 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500" title="Source in your CV">
                    {b.source_ref}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {cv.projects.map((p, i) => (
            <div key={`p${i}`}>
              <p className="text-sm font-semibold">Project: {p.name}</p>
              {p.bullets.map((b, j) => (
                <div key={j} className="mt-1 flex items-start gap-2">
                  <textarea
                    className={input}
                    rows={2}
                    readOnly={ro}
                    value={b.text}
                    onChange={(ev) =>
                      setCv({
                        projects: cv.projects.map((x, xi) =>
                          xi !== i
                            ? x
                            : { ...x, bullets: x.bullets.map((y, yi) => (yi === j ? { ...y, text: ev.target.value } : y)) },
                        ),
                      })
                    }
                  />
                  <span className="mt-2 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {b.source_ref}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <h4 className="text-xs font-medium uppercase text-slate-500">Education</h4>
              {cv.education.map((ed, i) => (
                <p key={i}>{[ed.degree, ed.institution, ed.year].filter(Boolean).join(", ")}</p>
              ))}
            </div>
            <div>
              <h4 className="text-xs font-medium uppercase text-slate-500">Certifications</h4>
              <p>{cv.certifications.join(", ") || "—"}</p>
            </div>
            <div>
              <h4 className="text-xs font-medium uppercase text-slate-500">Languages</h4>
              <p>{cv.languages.join(", ") || "—"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Cover letter</h3>
          <span className={`text-xs ${words > 250 ? "text-red-600" : "text-slate-500"}`}>{words} / 250 words</span>
        </div>
        <textarea
          className={`${input} mt-3 leading-relaxed`}
          rows={14}
          readOnly={ro}
          value={pkg.coverLetter}
          onChange={(e) => editContent((p) => ({ ...p, coverLetter: e.target.value }))}
        />
      </div>
    </section>
  );
}

/* -------------------------------- tracker --------------------------------- */

function Tracker({
  state,
  update,
  openPackage,
}: {
  state: AppState;
  update: StepProps["update"];
  openPackage: (id: string) => void;
}) {
  const pkgs = Object.values(state.packages).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <section className="space-y-6">
      <div className={card}>
        <h2 className="text-base font-semibold">Applications</h2>
        {pkgs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No application packages yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Approved hash</th>
                  <th className="py-2 pr-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {pkgs.map((p) => (
                  <tr key={p.jobId} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <button className="text-left font-medium text-indigo-700 hover:underline" onClick={() => openPackage(p.jobId)}>
                        {p.job.title}
                      </button>
                      <div className="text-xs text-slate-500">
                        {p.job.company} · {p.job.source}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {fmtDate(p.appliedAt ?? p.updatedAt)}
                    </td>
                    <td className="py-2 pr-3">{p.match?.total ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <span className="whitespace-nowrap rounded bg-slate-100 px-2 py-0.5 text-xs">
                        {p.needsReapproval ? "Prepared (re-approval required)" : STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-500" title={p.approval?.hash}>
                      {p.approval ? `${p.approval.hash.slice(0, 12)}…` : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <textarea
                        className={`${input} min-w-[180px]`}
                        rows={2}
                        value={p.notes}
                        onChange={(e) =>
                          update((s) => ({
                            ...s,
                            packages: { ...s.packages, [p.jobId]: { ...s.packages[p.jobId], notes: e.target.value } },
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={card}>
        <h2 className="text-base font-semibold">Audit log</h2>
        {state.audit.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No events yet.</p>
        ) : (
          <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto text-xs">
            {state.audit.map((a, i) => (
              <li key={i} className="flex gap-3 border-b border-slate-100 py-1">
                <span className="shrink-0 text-slate-400">{new Date(a.at).toLocaleString()}</span>
                <span className="shrink-0 font-mono font-semibold text-slate-700">{a.event}</span>
                <span className="text-slate-600">{a.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
