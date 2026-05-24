/**
 * scripts/serve.mjs
 * 로컬 정적 서버 — 페이지 동작 확인용. 의존성 없음.
 *
 * 페이지(index.html)는 build/gold/geojson/paldal_current.geojson 을 fetch 로
 * 읽으므로 file:// 로는 동작하지 않는다. 로컬 검증 시 이 서버로 연다.
 *
 * 실행:
 *   npm run serve              # 기본 포트 8848
 *   npm run serve:port         # 포트 명시 예시
 *   node scripts/serve.mjs --port=9000
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';

// 프로젝트 루트 = scripts/ 의 부모. cwd 와 무관하게 동작.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const portArg = (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1];
const PORT = portArg && /^\d+$/.test(portArg) ? parseInt(portArg, 10) : 8848;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = normalize(join(ROOT, urlPath));
  // 루트 밖 접근 차단
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
    console.log(`200 ${urlPath} (${data.length})`);
  } catch {
    res.writeHead(404); res.end('Not Found');
    console.log(`404 ${urlPath}`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`정적 서버 가동: http://127.0.0.1:${PORT}/`);
  console.log(`루트: ${ROOT}`);
  console.log('종료: Ctrl+C');
});
