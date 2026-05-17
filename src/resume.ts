import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Downloads the latest resume from the given URL and writes it to a file
 * inside the OS temp directory. Returns the absolute path of the saved file
 * so callers can hand it to Playwright's `setInputFiles()` (or any other
 * upload mechanism).
 *
 * @throws if the HTTP request fails or the response body is empty.
 */
export async function downloadResume(url: string): Promise<string> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `Resume fetch failed: ${res.status} ${res.statusText} (url: ${url})`,
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Resume fetch returned an empty body (url: ${url})`);
  }

  const filename = inferFilename(res) ?? 'naukri-resume.pdf';
  const targetPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(targetPath, buffer);

  return targetPath;
}

/**
 * Tries to extract a filename from the response's `Content-Disposition`
 * header. Returns `null` if the header is absent or doesn't contain one.
 */
function inferFilename(res: Response): string | null {
  const disposition = res.headers.get('content-disposition');
  if (!disposition) return null;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}
