// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { BoundedResponse } from "@/lib/fetch/safeFetch";
import {
  extractBoundedContent,
  type PdfDocument,
} from "@/lib/fetch/webExtract";

function response(mime: string, body: Uint8Array | string): BoundedResponse {
  return {
    url: "https://example.com/article",
    status: 200,
    mime,
    headers: { "content-type": mime },
    body: typeof body === "string" ? new TextEncoder().encode(body) : body,
  };
}

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("bounded web/document extraction", () => {
  it("extracts readable HTML while excluding scripts and styles", async () => {
    const result = await extractBoundedContent(
      response(
        "text/html",
        `<!doctype html><html><head><title>Example</title><style>.x{color:red}</style></head>
         <body><article><h1>Post title</h1><p>This is the useful article body with enough words to parse.</p></article>
         <script>SECRET_SCRIPT_TEXT</script></body></html>`,
      ),
    );

    expect(result).toMatchObject({ type: "web", title: "Example" });
    expect(result.content).toContain("useful article body");
    expect(result.content).not.toContain("SECRET_SCRIPT_TEXT");
    expect(result.content).not.toContain("color:red");
  });

  it("decodes plain text and rejects invalid UTF-8", async () => {
    await expect(extractBoundedContent(response("text/plain", "  line one\n\nline two  ")))
      .resolves.toMatchObject({ type: "doc", content: "line one\n\nline two" });

    await expect(
      extractBoundedContent(response("text/plain", new Uint8Array([0xc3, 0x28]))),
    ).rejects.toMatchObject({ code: "EXTRACT_TEXT_ENCODING" });
  });

  it("requires PDF magic, rejects encryption and enforces the 100-page limit", async () => {
    const loadPdf = vi.fn<(data: Uint8Array) => Promise<PdfDocument>>();
    await expect(
      extractBoundedContent(response("application/pdf", "not-a-pdf"), { loadPdf }),
    ).rejects.toMatchObject({ code: "EXTRACT_PDF_MAGIC" });
    expect(loadPdf).not.toHaveBeenCalled();

    loadPdf.mockRejectedValueOnce(Object.assign(new Error("password"), { name: "PasswordException" }));
    await expect(
      extractBoundedContent(response("application/pdf", "%PDF-1.7\nfixture"), { loadPdf }),
    ).rejects.toMatchObject({ code: "EXTRACT_PDF_ENCRYPTED" });

    loadPdf.mockResolvedValueOnce({ numPages: 101, getPage: vi.fn() });
    await expect(
      extractBoundedContent(response("application/pdf", "%PDF-1.7\nfixture"), { loadPdf }),
    ).rejects.toMatchObject({ code: "EXTRACT_PDF_TOO_MANY_PAGES" });
  });

  it("extracts PDF page text and rejects bodies above 2 MiB", async () => {
    const loadPdf = vi.fn(async (): Promise<PdfDocument> => ({
      numPages: 2,
      getPage: async (page) => ({
        getTextContent: async () => ({ items: [{ str: `page ${page}` }, { str: "content" }] }),
      }),
    }));
    await expect(
      extractBoundedContent(response("application/pdf", "%PDF-1.7\nfixture"), { loadPdf }),
    ).resolves.toMatchObject({ type: "doc", content: "page 1 content\n\npage 2 content" });

    await expect(
      extractBoundedContent(response("text/plain", new Uint8Array(2 * 1024 * 1024 + 1))),
    ).rejects.toMatchObject({ code: "EXTRACT_BODY_TOO_LARGE" });
  });

  it("extracts text with the production pdfjs parser", async () => {
    await expect(
      extractBoundedContent(response("application/pdf", minimalPdf("Hello bounded PDF"))),
    ).resolves.toMatchObject({ type: "doc", content: "Hello bounded PDF" });
  });
});
