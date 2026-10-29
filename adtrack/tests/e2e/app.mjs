// 빌드된 서비스를 띄우고 끄는 도우미. DATABASE_URL 로 PostgreSQL 에 직접 붙는다.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export async function waitFor(fn, what, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what} 을(를) 기다리다 시간 초과`);
    await sleep(100);
  }
}

export async function startApp(port, env = {}) {
  const child = spawn('node_modules/.bin/next', ['start', '-p', String(port)], {
    detached: true, // 끝날 때 next-server 자식 프로세스까지 한꺼번에 끄기 위해
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  const url = `http://127.0.0.1:${port}`;
  await waitFor(() => fetch(`${url}/login`).then((r) => r.ok).catch(() => false), `서비스 시작\n${log}`, 60000);
  return {
    url,
    log: () => log,
    stop: () => {
      try {
        process.kill(-child.pid);
      } catch {
        /* 이미 꺼짐 */
      }
    },
  };
}
