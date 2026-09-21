// GET /api/note/[token]: streams the option-agreement PDF for a valid,
// unexpired signed download link (src/lib/download-token.ts, seven-day
// expiry). An invalid or expired token gets a plain, one-line 404 page
// rather than the file.
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { verifyDownloadToken } from '../../../lib/download-token';

export const prerender = false;

const NOTE_PDF_FILENAME = 'Laterna - Option Agreements.pdf';
const NOTE_PDF_RELATIVE = path.join('src', 'assets', 'notes', NOTE_PDF_FILENAME);

// The PDF is bundled into the serverless function via includeFiles in
// astro.config.mjs, which preserves the project-relative path inside the
// bundle. We resolve from process.cwd(), with a couple of fallback
// candidates in case the runtime cwd differs between environments.
function resolveBundledNotePdf(): string | null {
  const candidates = [
    path.join(process.cwd(), NOTE_PDF_RELATIVE),
    path.join(process.cwd(), '.vercel', 'output', 'static', NOTE_PDF_RELATIVE),
    path.join('/var/task', NOTE_PDF_RELATIVE),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function notFoundPage(): Response {
  return new Response(
    '<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>Link expired</title><p>This download link has expired or is not valid. Please email hayri@laterna.partners and I will send it by hand.</p>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export const GET: APIRoute = async ({ params }) => {
  const token = params.token;
  if (!token) return notFoundPage();

  const check = verifyDownloadToken(token);
  if (!check.ok) return notFoundPage();

  const pdfPath = resolveBundledNotePdf();
  if (!pdfPath) {
    console.error('[note-download] PDF not found in bundle. cwd=', process.cwd());
    return notFoundPage();
  }

  try {
    const buffer = await readFile(pdfPath);
    return new Response(buffer, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${NOTE_PDF_FILENAME}"`,
        'cache-control': 'private, max-age=0, no-store',
      },
    });
  } catch (err) {
    console.error('[note-download] failed to read PDF', err);
    return notFoundPage();
  }
};
