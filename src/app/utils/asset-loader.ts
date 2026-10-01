/**
 * Asset loading with transparent gzip support.
 *
 * The per-school datasets are large (the infrastructure one is ~121 MB of
 * plain JSON). Gzipped they come down to 4-18% of that, which keeps the repo
 * inside GitHub's 100 MB per-file limit and makes a static deploy practical.
 *
 * Each asset is published as `<name>.json.gz`. Some hosts serve a `.gz` file
 * with `Content-Encoding: gzip`, in which case the browser has already
 * inflated it by the time we see the bytes; others serve it verbatim. Rather
 * than guess, we sniff the gzip magic number and only inflate when the payload
 * really is still compressed. Plain `.json` remains a fallback so a freshly
 * generated, uncompressed working copy also runs.
 */

/** gzip streams start with 0x1f 0x8b. */
function isGzip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const b = new Uint8Array(buf, 0, 2);
  return b[0] === 0x1f && b[1] === 0x8b;
}

function canInflate(): boolean {
  return typeof (globalThis as any).DecompressionStream === 'function';
}

async function inflate(buf: ArrayBuffer): Promise<string> {
  const ds = new (globalThis as any).DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

const decoder = new TextDecoder();

/**
 * Loads a JSON asset, preferring the gzipped copy.
 *
 * @param path logical asset path, e.g. 'assets/infra-schools.json'.
 *             '.gz' is appended for the first attempt.
 */
export async function loadAsset<T>(path: string): Promise<T> {
  try {
    const res = await fetch(`${path}.gz`, { cache: 'force-cache' });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      // guard against a dev server answering 200 with an HTML fallback page
      if (buf.byteLength > 0) {
        if (isGzip(buf)) {
          if (!canInflate()) throw new Error('gzip asset but no DecompressionStream');
          return JSON.parse(await inflate(buf)) as T;
        }
        // the host already decompressed it for us
        const text = decoder.decode(buf);
        if (text.trimStart().startsWith('<')) throw new Error('not json');
        return JSON.parse(text) as T;
      }
    }
  } catch {
    // fall through to the uncompressed copy
  }

  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
