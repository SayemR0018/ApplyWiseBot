import { z } from "zod";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { jsonError, readJsonBody, UserFacingError } from "@/lib/server/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const s = z.string().nullish();
const Bullet = z.object({ text: z.string(), source_ref: z.string().optional() });
const Body = z.object({
  kind: z.enum(["cv", "cover_letter"]),
  job: z.object({ title: z.string(), company: z.string() }),
  contact: z.object({ name: s, email: s, phone: s, location: s }),
  tailoredCv: z.object({
    summary: z.string(),
    skills: z.array(z.string()),
    experience: z.array(z.object({ company: s, title: s, start: s, end: s, bullets: z.array(Bullet) })),
    projects: z.array(z.object({ name: s, bullets: z.array(Bullet) })).default([]),
    education: z.array(z.object({ institution: s, degree: s, year: s })),
    certifications: z.array(z.string()),
    languages: z.array(z.string()),
  }),
  coverLetter: z.string(),
});

function sanitize(part: string) {
  return (
    part
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "_")
      .slice(0, 50) || "Job"
  );
}

const heading = (text: string) =>
  new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    border: { bottom: { color: "999999", style: BorderStyle.SINGLE, size: 6, space: 2 } },
  });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } });
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await readJsonBody(req));
    if (!parsed.success) throw new UserFacingError("Invalid export request.");
    const { kind, job, contact, tailoredCv: cv, coverLetter } = parsed.data;

    const header = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: contact.name ?? "", bold: true, size: 36 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: join(contact.email, contact.phone, contact.location), size: 20 })],
      }),
    ];

    const children: Paragraph[] = [...header];
    if (kind === "cv") {
      if (cv.summary) children.push(heading("Summary"), new Paragraph({ text: cv.summary }));
      if (cv.skills.length) children.push(heading("Skills"), new Paragraph({ text: cv.skills.join(", ") }));
      if (cv.experience.length) {
        children.push(heading("Experience"));
        for (const e of cv.experience) {
          children.push(
            new Paragraph({
              spacing: { before: 120 },
              children: [
                new TextRun({ text: join(e.title, e.company), bold: true }),
                new TextRun({ text: `   ${[e.start, e.end].filter(Boolean).join(" – ")}`, italics: true }),
              ],
            }),
            ...e.bullets.map((b) => bullet(b.text)),
          );
        }
      }
      if (cv.projects.length) {
        children.push(heading("Projects"));
        for (const p of cv.projects) {
          children.push(
            new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: p.name ?? "", bold: true })] }),
            ...p.bullets.map((b) => bullet(b.text)),
          );
        }
      }
      if (cv.education.length) {
        children.push(heading("Education"));
        for (const ed of cv.education) children.push(new Paragraph({ text: join(ed.degree, ed.institution, ed.year) }));
      }
      if (cv.certifications.length) children.push(heading("Certifications"), ...cv.certifications.map(bullet));
      if (cv.languages.length) children.push(heading("Languages"), new Paragraph({ text: cv.languages.join(", ") }));
    } else {
      children.push(
        new Paragraph({ spacing: { after: 200 }, text: new Date().toLocaleDateString("en-GB", { dateStyle: "long" }) }),
        new Paragraph({ spacing: { after: 200 }, text: `Re: ${job.title} at ${job.company}` }),
        ...coverLetter
          .split(/\n\s*\n|\n/)
          .filter((p) => p.trim())
          .map((p) => new Paragraph({ text: p.trim(), spacing: { after: 160 } })),
      );
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
    });
    const buffer = await Packer.toBuffer(doc);
    const filename = `${sanitize(job.title)}_${sanitize(job.company)}_${kind === "cv" ? "CV" : "CoverLetter"}.docx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
