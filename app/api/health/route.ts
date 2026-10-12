export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ ok: true, openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY) });
  } catch {
    return Response.json({ error: "Health check failed." }, { status: 500 });
  }
}
