"use client";

import { useEffect, useState } from "react";
import { loadState, type AppState, type Pkg } from "@/lib/client/store";

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 mt-4 border-b border-slate-400 pb-0.5 text-sm font-bold uppercase tracking-wide">{children}</h2>
  );
}

export default function PrintPage() {
  const [data, setData] = useState<{ pkg: Pkg | null; profile: AppState["profile"] } | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    const s = loadState();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage once on mount
    setData({ pkg: id ? (s.packages[id] ?? null) : null, profile: s.profile });
  }, []);

  useEffect(() => {
    if (data?.pkg) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [data]);

  if (!data) return null;
  if (!data.pkg)
    return (
      <p className="p-8 text-sm text-slate-600">
        Package not found in this browser. Open it from the Package screen first.
      </p>
    );

  const { pkg, profile } = data;
  const cv = pkg.tailoredCv;
  const contact = [profile?.email, profile?.phone, profile?.location].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] leading-snug text-black print:p-0">
      <div className="mb-4 flex items-center justify-between rounded bg-slate-100 p-3 text-sm print:hidden">
        <span>Use &quot;Save as PDF&quot; in the print dialog.</span>
        <button className="rounded bg-indigo-600 px-3 py-1.5 text-white" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <header className="text-center">
        <h1 className="text-2xl font-bold">{profile?.name}</h1>
        <p className="text-xs">{contact}</p>
      </header>
      {cv.summary && (
        <>
          <H>Summary</H>
          <p>{cv.summary}</p>
        </>
      )}
      {cv.skills.length > 0 && (
        <>
          <H>Skills</H>
          <p>{cv.skills.join(", ")}</p>
        </>
      )}
      {cv.experience.length > 0 && <H>Experience</H>}
      {cv.experience.map((e, i) => (
        <div key={i} className="mb-2 break-inside-avoid">
          <div className="flex justify-between font-semibold">
            <span>
              {e.title} · {e.company}
            </span>
            <span className="font-normal italic">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
          </div>
          <ul className="list-disc pl-5">
            {e.bullets.map((b, j) => (
              <li key={j}>{b.text}</li>
            ))}
          </ul>
        </div>
      ))}
      {cv.projects.length > 0 && <H>Projects</H>}
      {cv.projects.map((p, i) => (
        <div key={i} className="mb-2 break-inside-avoid">
          <div className="font-semibold">{p.name}</div>
          <ul className="list-disc pl-5">
            {p.bullets.map((b, j) => (
              <li key={j}>{b.text}</li>
            ))}
          </ul>
        </div>
      ))}
      {cv.education.length > 0 && (
        <>
          <H>Education</H>
          {cv.education.map((ed, i) => (
            <p key={i}>{[ed.degree, ed.institution, ed.year].filter(Boolean).join(", ")}</p>
          ))}
        </>
      )}
      {cv.certifications.length > 0 && (
        <>
          <H>Certifications</H>
          <p>{cv.certifications.join(", ")}</p>
        </>
      )}
      {cv.languages.length > 0 && (
        <>
          <H>Languages</H>
          <p>{cv.languages.join(", ")}</p>
        </>
      )}

      <section className="page-break mt-10 print:mt-0">
        <p className="mb-4">{profile?.name}</p>
        <p className="mb-4">
          Re: {pkg.job.title} at {pkg.job.company}
        </p>
        {pkg.coverLetter
          .split(/\n+/)
          .filter((x) => x.trim())
          .map((para, i) => (
            <p key={i} className="mb-3">
              {para}
            </p>
          ))}
      </section>
    </div>
  );
}
