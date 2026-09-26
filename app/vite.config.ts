import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFile } from 'node:fs/promises';

import { fetchSnapshot } from '../proxy/src/odpt-rt.js';
import { createRtProxy } from '../proxy/src/rt-proxy.js';
import type { StopData } from '../src/core/stopdata.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..');

/**
 * QR サイドロードで実機から読むときは dev サーバーを LAN に出し、HMR の戻り先も
 * LAN IP にする（G2 Sky View と同じ）。ポートは 5179
 * （Tokyojihatsu 5173/5175/5176、G2PeakView 5177、G2 Sky View 5178 と被らない）。
 */
const lanIp = process.env.LAN_IP;

/**
 * dev サーバーに ODPT の中継を載せる（/api/stop, /api/rt）。本番の Lambda と同じ関数
 * （proxy/src/rt-proxy.ts）で、停留所データは S3 の代わりにローカルの data/stops/ から読む。
 * ODPT のトークンはサーバー側（.env）にだけ置く。dev では共有鍵を確かめない（LAN 内だけに出ている）。
 */
function rtDevProxy(token: string): Plugin {
  const handle = createRtProxy({
    fetchSnapshot: (feed) => fetchSnapshot(feed, token),
    loadStop: async (feed, id) =>
      readFile(resolve(projectRoot, `data/stops/${feed}/${id}.json`), 'utf8').then(
        (text) => JSON.parse(text) as StopData,
        () => null,
      ),
  });
  return {
    name: 'rt-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        void handle({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), headers: {} }).then(
          (response) => {
            res.writeHead(response.status, response.headers);
            res.end(response.base64 ? Buffer.from(response.body, 'base64') : response.body);
          },
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  return {
    root: here,
    envDir: projectRoot,
    plugins: env.ODPT_TOKEN ? [rtDevProxy(env.ODPT_TOKEN)] : [],
    build: {
      outDir: resolve(projectRoot, 'dist/app'),
      emptyOutDir: true,
      target: 'es2020',
    },
    server: {
      port: 5179,
      // ポートが埋まっていたら黙ってずらさない。QR が別のサーバーを指す事故を防ぐ。
      strictPort: true,
      host: true,
      hmr: lanIp ? { host: lanIp } : undefined,
      fs: { allow: [projectRoot] },
    },
  };
});
