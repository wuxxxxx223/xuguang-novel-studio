const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 4_000);
try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || '8790'}/api/health/ready`, {
    signal: controller.signal,
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
