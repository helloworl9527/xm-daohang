import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { safeFetch, type BoundedResponse } from "@/lib/fetch/safeFetch";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_CONTENT_CHARS = 200_000;
const TEXT_MIME = ["text/plain", "text/markdown"];
const ALLOWED_MIME = ["text/html", ...TEXT_MIME, "application/pdf"];
const WEB_USER_AGENT = "Mozilla/5.0 (compatible; CollectionBot/1.0; +https://sc.xmcode.tech/)";

export interface ExtractedContent {
  title: string | null;
  content: string;
  type: "web" | "doc";
}

export interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<{
    getTextContent(): Promise<{ items: Array<{ str?: unknown }> }>;
  }>;
}

export interface WebExtractDependencies {
  loadPdf?: (data: Uint8Array) => Promise<PdfDocument>;
}

export class ContentExtractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ContentExtractError";
  }
}

function normalizeContent(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) throw new ContentExtractError("EXTRACT_EMPTY_CONTENT");
  return normalized.slice(0, MAX_CONTENT_CHARS);
}

function decodeUtf8(body: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ContentExtractError("EXTRACT_TEXT_ENCODING");
  }
}

async function defaultLoadPdf(data: Uint8Array): Promise<PdfDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise as unknown as Promise<PdfDocument>;
}

async function extractPdf(
  response: BoundedResponse,
  loadPdf: NonNullable<WebExtractDependencies["loadPdf"]>,
): Promise<ExtractedContent> {
  if (new TextDecoder().decode(response.body.slice(0, 5)) !== "%PDF-") {
    throw new ContentExtractError("EXTRACT_PDF_MAGIC");
  }

  let document: PdfDocument;
  try {
    document = await loadPdf(response.body);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ContentExtractError("EXTRACT_PDF_ENCRYPTED");
    }
    throw new ContentExtractError("EXTRACT_PDF_INVALID");
  }
  if (!Number.isInteger(document.numPages) || document.numPages < 1) {
    throw new ContentExtractError("EXTRACT_PDF_INVALID");
  }
  if (document.numPages > MAX_PDF_PAGES) {
    throw new ContentExtractError("EXTRACT_PDF_TOO_MANY_PAGES");
  }

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    pages.push(text.items.map((item) => (typeof item.str === "string" ? item.str : "")).join(" "));
  }
  return { title: null, content: normalizeContent(pages.join("\n\n")), type: "doc" };
}

export async function extractBoundedContent(
  response: BoundedResponse,
  dependencies: WebExtractDependencies = {},
): Promise<ExtractedContent> {
  if (response.body.byteLength > MAX_BODY_BYTES) {
    throw new ContentExtractError("EXTRACT_BODY_TOO_LARGE");
  }

  if (TEXT_MIME.includes(response.mime)) {
    return { title: null, content: normalizeContent(decodeUtf8(response.body)), type: "doc" };
  }
  if (response.mime === "application/pdf") {
    return extractPdf(response, dependencies.loadPdf ?? defaultLoadPdf);
  }
  if (response.mime !== "text/html") throw new ContentExtractError("EXTRACT_MIME_NOT_ALLOWED");

  const dom = new JSDOM(decodeUtf8(response.body), { url: response.url });
  dom.window.document.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
  const article = new Readability(dom.window.document).parse();
  const content = article?.textContent ?? dom.window.document.body?.textContent ?? "";
  const title = (article?.title ?? dom.window.document.title).trim() || null;
  return { title, content: normalizeContent(content), type: "web" };
}

export async function fetchAndExtractContent(url: string): Promise<ExtractedContent> {
  const response = await safeFetch(url, {
    maxBytes: MAX_BODY_BYTES,
    timeoutMs: 15_000,
    allowedMime: ALLOWED_MIME,
    requestHeaders: {
      accept: ALLOWED_MIME.join(", "),
      "user-agent": WEB_USER_AGENT,
    },
  });
  return extractBoundedContent(response);
}
