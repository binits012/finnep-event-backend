/**
 * Rolling-window HTTP stats for queue /metrics (last WINDOW_MS per process).
 */
const WINDOW_MS = parseInt(process.env.HTTP_METRICS_WINDOW_MS || '60000', 10) || 60000;

const samples = [];

function prune(now) {
  const cutoff = now - WINDOW_MS;
  while (samples.length > 0 && samples[0].t < cutoff) {
    samples.shift();
  }
}

/**
 * @param {number} durationMs
 * @param {number} statusCode
 */
export function recordRequestSample(durationMs, statusCode) {
  const now = Date.now();
  const err = statusCode >= 500;
  samples.push({ t: now, ms: durationMs, err });
  prune(now);
}

/**
 * @returns {{ avgResponseTime: number, errorRate: number, sampleCount: number }}
 */
export function getHttpMetricsSnapshot() {
  const now = Date.now();
  prune(now);
  if (samples.length === 0) {
    return { avgResponseTime: 0, errorRate: 0, sampleCount: 0 };
  }
  const totalMs = samples.reduce((a, s) => a + s.ms, 0);
  const errs = samples.filter((s) => s.err).length;
  return {
    avgResponseTime: totalMs / samples.length,
    errorRate: (errs / samples.length) * 100,
    sampleCount: samples.length
  };
}

/**
 * Express middleware: record response time and status when the response finishes.
 */
export function httpMetricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Math.max(0, Date.now() - start);
    recordRequestSample(duration, res.statusCode);
  });
  next();
}
