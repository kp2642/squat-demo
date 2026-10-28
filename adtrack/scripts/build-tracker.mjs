// tracker/tracker.js 를 압축해 src/generated/tracker.ts 로 만든다. 5KB(gzip 전)를 넘으면 실패.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';

const LIMIT = 5 * 1024;
const src = readFileSync(new URL('../tracker/tracker.js', import.meta.url), 'utf8');
const { code } = await transform(src, { minify: true, target: 'es2017', loader: 'js', legalComments: 'none' });
if (!code.includes('__ATK_CONFIG__')) throw new Error('__ATK_CONFIG__ 자리가 사라졌어요');
const size = Buffer.byteLength(code);
console.log(`tracker: ${size} bytes, gzip ${gzipSync(code).length} bytes`);
if (size > LIMIT) {
  console.error(`추적 코드가 ${LIMIT} bytes 를 넘어요`);
  process.exit(1);
}
mkdirSync(new URL('../src/generated/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../src/generated/tracker.ts', import.meta.url),
  `// 자동 생성 파일: npm run build:tracker (원본 tracker/tracker.js)\nexport const TRACKER_JS = ${JSON.stringify(code.trim())};\n`,
);
