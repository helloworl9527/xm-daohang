import { z } from "zod";

import { loadSiteFavicon } from "@/lib/favicon/siteFavicon";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

const FALLBACK = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

function response(body: Uint8Array, mime: string, maxAge: number, status = 200): Response {
  return new Response(Buffer.from(body), {
    status,
    headers: {
      "Content-Type": mime,
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, immutable`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return response(FALLBACK, "image/png", 3_600, 404);

  try {
    const favicon = await loadSiteFavicon(id.data);
    return response(favicon.body, favicon.mime, favicon.maxAge, favicon.eligible ? 200 : 404);
  } catch {
    return response(FALLBACK, "image/png", 3_600, 404);
  }
}
