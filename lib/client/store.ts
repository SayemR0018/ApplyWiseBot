"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, MatchResult, Profile, TailoredCv } from "@/lib/schemas";

export type PkgStatus = "prepared" | "approved" | "rejected" | "applied" | "unknown";
export const STATUS_LABEL: Record<PkgStatus, string> = {
  prepared: "Prepared",
  approved: "Approved",
  rejected: "Rejected",
  applied: "Applied (manual)",
  unknown: "Submission status unknown",
};

export type Pkg = {
  jobId: string;
  job: Job;
  match: MatchResult | null;
  tailoredCv: TailoredCv;
  coverLetter: string;
  keywordReport: { matched: string[]; missing: string[] };
  unverified: string[];
  removedCount: number;
  status: PkgStatus;
  approval: { hash: string; at: string } | null;
  needsReapproval: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
};

export type AuditEvent =
  | "profile_extracted"
  | "jobs_fetched"
  | "package_generated"
  | "approved"
  | "edited_invalidated"
  | "rejected"
  | "marked_applied";

export type AppState = {
  fileName: string | null;
  cvText: string | null; // master CV text: kept read-only in the browser, never mutated
  originalProfile: Profile | null; // as extracted, never mutated
  profile: Profile | null; // user-edited working copy
  jobs: Job[];
  sourceErrors: string[];
  matches: MatchResult[];
  packages: Record<string, Pkg>;
  approvals: { jobId: string; hash: string; at: string }[];
  audit: { event: AuditEvent; at: string; detail: string }[];
  activeJobId: string | null;
  step: 1 | 2 | 3 | 4;
};

export const EMPTY: AppState = {
  fileName: null,
  cvText: null,
  originalProfile: null,
  profile: null,
  jobs: [],
  sourceErrors: [],
  matches: [],
  packages: {},
  approvals: [],
  audit: [],
  activeJobId: null,
  step: 1,
};

export const STORAGE_KEY = "applywisebot:v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<AppState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const skipSave = useRef(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: state still works in memory */
    }
  }, [state, hydrated]);

  const update = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  const log = useCallback(
    (event: AuditEvent, detail: string) =>
      setState((s) => ({ ...s, audit: [{ event, at: new Date().toISOString(), detail }, ...s.audit].slice(0, 500) })),
    [],
  );
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.clear();
    } catch {
      /* ignore */
    }
    skipSave.current = true;
    setState(EMPTY);
  }, []);

  return { state, hydrated, update, log, reset };
}

export async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const packageHash = (p: Pick<Pkg, "jobId" | "tailoredCv" | "coverLetter">) =>
  sha256(JSON.stringify({ jobId: p.jobId, tailoredCv: p.tailoredCv, coverLetter: p.coverLetter }));

export async function api<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      if (res.status === 504) msg = "The server took too long to respond. Please try again.";
      if (res.status === 413) msg = "File is too large. The maximum size is 4 MB.";
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}
