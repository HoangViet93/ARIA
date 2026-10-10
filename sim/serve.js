#!/usr/bin/env node
// Server tĩnh không phụ thuộc thư viện ngoài, CHỈ nghe trên 127.0.0.1.
//   node serve.js [cổng]   -> mở http://127.0.0.1:5180/
// Phục vụ thư mục sim/ (UI + engine + projects). Thêm hai API nhỏ:
//   GET /api/projects                         danh sách project trong projects/
//   PUT /api/projects/<tên>/calibration.json  lưu calibration đã chỉnh từ UI
// Không có API nào khác ghi đĩa. Dữ liệu không rời khỏi máy.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS = path.join(ROOT, 'projects');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.dcm': 'text/plain; charset=utf-8',
};

function listProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs.readdirSync(PROJECTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PROJECTS, d.name, 'project.json')))
    .map((d) => {
      let name = d.name;
      try { name = JSON.parse(fs.readFileSync(path.join(PROJECTS, d.name, 'project.json'), 'utf8')).name || d.name; } catch { /* giữ tên thư mục */ }
      return { dir: d.name, name };
    });
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    try {
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        return send(200, JSON.stringify(listProjects()), TYPES['.json']);
      }
      const save = /^\/api\/projects\/([\w.-]+)\/calibration\.json$/.exec(url.pathname);
      if (save && req.method === 'PUT') {
        const dir = path.join(PROJECTS, save[1]);
        if (!fs.existsSync(path.join(dir, 'project.json'))) return send(404, 'không có project');
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
        const target = path.resolve(dir, pj.calibration || 'calibration.json');
        if (!target.startsWith(dir + path.sep)) return send(400, 'đường dẫn calibration không hợp lệ');
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
        req.on('end', () => {
          try {
            const obj = JSON.parse(body);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('calibration phải là object');
            fs.writeFileSync(target, JSON.stringify(obj, null, 2) + '\n');
            send(200, 'ok');
          } catch (e) {
            send(400, e.message);
          }
        });
        return undefined;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'chỉ hỗ trợ GET');
      let rel = decodeURIComponent(url.pathname);
      // UI dùng đường dẫn tương đối (../engine, ../projects) nên phải nằm ở /ui/.
      if (rel === '/' || rel === '/ui') {
        res.writeHead(302, { Location: `/ui/${url.search}` });
        return res.end();
      }
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(ROOT, `.${rel}`);
      if (!file.startsWith(ROOT + path.sep)) return send(403, 'cấm');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, `không có ${rel}`);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
      return undefined;
    } catch (e) {
      return send(500, e.message);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 5180);
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`aria-sim: http://127.0.0.1:${port}/  (Ctrl+C để dừng)`);
  });
}
