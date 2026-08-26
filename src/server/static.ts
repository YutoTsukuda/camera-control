/** PWA の静的ファイル配信（依存パッケージ無しの最小実装）。 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * `root` 配下のファイルを返す。ディレクトリトラバーサルは弾く。
 * 見つからなければ false を返し、呼び出し側で 404 を返す。
 */
export async function serveStatic(
  root: string,
  urlPath: string,
  res: ServerResponse,
): Promise<boolean> {
  const relative = decodeURIComponent(urlPath.replace(/^\/+/, '')) || 'index.html';
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root))) return false;

  let info;
  try {
    info = await stat(resolved);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  res.writeHead(200, {
    'content-type': MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resolved);
    stream.on('error', reject);
    stream.on('end', () => resolve());
    stream.pipe(res);
  });
  return true;
}
