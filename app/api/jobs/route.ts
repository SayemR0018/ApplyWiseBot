import { jsonError, readJsonBody, UserFacingError } from "@/lib/server/ai";
import { discoverJobs } from "@/lib/server/jobs";
import { ProfileSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ profile?: unknown }>(req);
    const parsed = ProfileSchema.safeParse(body.profile);
    if (!parsed.success) throw new UserFacingError("A valid profile is required to search for jobs.");
    const profile = parsed.data;
    if (profile.target_titles.length === 0 && profile.skills.length === 0) {
      throw new UserFacingError("Add at least one target title or skill to your profile before searching.");
    }
    const result = await discoverJobs(profile);
    if (result.jobs.length === 0 && result.sourceErrors.length === result.queries.length + 1) {
      throw new UserFacingError("Both job sources are unreachable right now. Please try again shortly.", 502);
    }
    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
