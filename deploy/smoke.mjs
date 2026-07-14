const baseUrl = String(process.env.NOVEL_STUDIO_BASE_URL ?? 'http://127.0.0.1:8790').replace(/\/+$/, '');

async function check(path, validator) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: path === '/' ? 'text/html' : 'application/json' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} 返回 HTTP ${response.status}: ${body.slice(0, 300)}`);
  if (!validator(response, body)) throw new Error(`${path} 响应内容不符合预期。`);
  console.log(`PASS ${path} HTTP ${response.status}`);
}

await check('/api/health/live', (_response, body) => JSON.parse(body).ok === true);
await check('/api/health/ready', (_response, body) => JSON.parse(body).ok === true);
await check('/api/projects', (_response, body) => Array.isArray(JSON.parse(body).projects));
await check('/', (response, body) => response.headers.get('content-type')?.includes('text/html') && /<div id="root"><\/div>/.test(body));
