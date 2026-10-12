import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { generateJson, jsonError, UserFacingError } from "@/lib/server/ai";
import { ProfileSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

const SYSTEM = `You extract a structured candidate profile from CV text.
Return a single JSON object with exactly these keys:
{"name","email","phone","location","summary","target_titles":[],"skills":[],
"experience":[{"company","title","start","end","bullets":[]}],
"education":[{"institution","degree","year"}],
"projects":[{"name","bullets":[]}],
"certifications":[],"languages":[],"total_years_experience","seniority",
"preferences":{"locations":[],"remote_ok","sectors":[]}}
Rules:
- Extract ONLY information present in the CV. Never invent employers, dates, skills, degrees or contact details.
- Use null for missing scalar fields and [] for missing lists.
- Copy experience/project bullets faithfully (light cleanup of whitespace only).
- "summary": the CV's own summary/profile statement if present, else null.
- "target_titles": 3-5 job titles this candidate is realistically suited for, inferred from their actual roles and skills (this is the only inferred field besides seniority/total_years_experience).
- "total_years_experience": a number computed from the experience dates, or null if dates are missing.
- "seniority": one of "intern","junior","mid","senior","lead","executive", inferred from titles and years, or null.
- "preferences": only what the CV states (e.g. "open to remote", desired location). remote_ok is null unless stated.`;

export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new UserFacingError("Upload the CV as multipart/form-data with a 'file' field.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserFacingError("No file uploaded. Choose a PDF or DOCX CV.");
    if (file.size === 0) throw new UserFacingError("The uploaded file is empty.");
    if (file.size > MAX_BYTES) throw new UserFacingError("File is too large. The maximum size is 4 MB.", 413);

    const name = file.name.toLowerCase();
    const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
    const isDocx =
      name.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!isPdf && !isDocx) throw new UserFacingError("Unsupported file type. Upload a PDF or DOCX file.", 415);

    const buf = new Uint8Array(await file.arrayBuffer());
    let text = "";
    try {
      if (isPdf) {
        if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
          throw new UserFacingError("This file is not a valid PDF.", 415);
        }
        const pdf = await getDocumentProxy(buf);
        const out = await extractText(pdf, { mergePages: true });
        text = out.text;
      } else {
        if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new UserFacingError("This file is not a valid DOCX.", 415);
        const out = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
        text = out.value;
      }
    } catch (e) {
      if (e instanceof UserFacingError) throw e;
      throw new UserFacingError("Could not read this file. It may be corrupted or password-protected.", 422);
    }

    text = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.replace(/\s/g, "").length < 50) {
      throw new UserFacingError(
        "No extractable text found in this file. It looks like a scanned/image-only document; upload a text-based PDF or a DOCX.",
        422,
      );
    }

    const profile = await generateJson({
      system: SYSTEM,
      user: `CV TEXT:\n"""\n${text.slice(0, 24_000)}\n"""`,
      schema: ProfileSchema,
      budgetMs: 52_000,
    });

    return Response.json({ profile, cvText: text });
  } catch (err) {
    return jsonError(err);
  }
}
