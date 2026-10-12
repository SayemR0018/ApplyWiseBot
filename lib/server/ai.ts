import "server-only";
import OpenAI from "openai";
import type { z } from "zod";

export class UserFacingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function jsonError(err: unknown) {
  if (err instanceof UserFacingError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    let message = "The AI service returned an error. Please try again.";
    if (err instanceof OpenAI.APIConnectionTimeoutError) message = "The AI service timed out. Please try again.";
    else if (err instanceof OpenAI.APIConnectionError) message = "Could not reach the AI service. Please try again.";
    else if (status === 401) message = "The server's OpenAI API key is invalid. Ask the site owner to update it.";
    else if (status === 429)
      message = "The AI service is rate-limited or out of quota right now. Wait a minute and try again.";
    else if (status === 404) message = "The configured OpenAI model is not available for this API key.";
    console.error("OpenAI error", status, err.message.slice(0, 200));
    return Response.json({ error: message }, { status: status === 429 ? 429 : 502 });
  }
  console.error("Unhandled error", err instanceof Error ? err.message : err);
  return Response.json({ error: "Something went wrong on the server. Please try again." }, { status: 500 });
}

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new UserFacingError("The server is missing OPENAI_API_KEY. Ask the site owner to configure it.", 503);
  }
  return new OpenAI({ apiKey, maxRetries: 0 });
}

const model = () => process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * One JSON-mode completion validated by zod. On a validation failure it retries once,
 * feeding the validation error back, then gives up. Total wall time is capped by `budgetMs`.
 */
export async function generateJson<S extends z.ZodTypeAny>(opts: {
  system: string;
  user: string;
  schema: S;
  budgetMs?: number;
  maxTokens?: number;
}): Promise<z.output<S>> {
  const openai = client();
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let lastIssue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 5_000) break;
    const res = await openai.chat.completions.create(
      {
        model: model(),
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_tokens: opts.maxTokens ?? 4000,
        messages,
      },
      { timeout: Math.min(remaining, 40_000) },
    );
    const content = res.choices[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      lastIssue = "Response was not valid JSON.";
      messages.push({ role: "assistant", content }, { role: "user", content: `${lastIssue} Return only valid JSON.` });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return result.data;
    lastIssue = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    messages.push(
      { role: "assistant", content },
      { role: "user", content: `Your JSON failed validation: ${lastIssue}. Fix it and return the full corrected JSON.` },
    );
  }
  throw new UserFacingError(
    `The AI returned data in an unexpected format${lastIssue ? ` (${lastIssue.slice(0, 160)})` : ""}. Please try again.`,
    502,
  );
}

export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new UserFacingError("Request body must be valid JSON.");
  }
}
