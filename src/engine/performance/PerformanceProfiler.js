function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export class PerformanceProfiler {
  constructor({ enabled = false, maxSamplesPerMetric = 2000 } = {}) {
    this.enabled = !!enabled;
    this.maxSamplesPerMetric = Math.max(10, Number(maxSamplesPerMetric) || 2000);
    this.metrics = new Map();
  }

  setEnabled(enabled = true) {
    this.enabled = !!enabled;
    return this.enabled;
  }

  record(name, durationMs, metadata = null) {
    if (!this.enabled) return durationMs;
    const key = String(name || 'unnamed');
    const row = this.metrics.get(key) || { count: 0, totalMs: 0, maxMs: 0, samples: [], metadata: null };
    const value = Math.max(0, Number(durationMs) || 0);
    row.count += 1;
    row.totalMs += value;
    row.maxMs = Math.max(row.maxMs, value);
    row.samples.push(value);
    if (row.samples.length > this.maxSamplesPerMetric) row.samples.splice(0, row.samples.length - this.maxSamplesPerMetric);
    if (metadata != null) row.metadata = metadata;
    this.metrics.set(key, row);
    return value;
  }

  measure(name, callback, metadata = null) {
    if (!this.enabled) return callback();
    const started = nowMs();
    try {
      return callback();
    } finally {
      this.record(name, nowMs() - started, metadata);
    }
  }

  reset() {
    this.metrics.clear();
  }

  snapshot() {
    const out = {};
    for (const [name, row] of this.metrics.entries()) {
      out[name] = {
        count: row.count,
        totalMs: Number(row.totalMs.toFixed(3)),
        averageMs: Number((row.count ? row.totalMs / row.count : 0).toFixed(3)),
        p50Ms: Number(percentile(row.samples, 50).toFixed(3)),
        p95Ms: Number(percentile(row.samples, 95).toFixed(3)),
        maxMs: Number(row.maxMs.toFixed(3)),
        ...(row.metadata != null ? { metadata: structuredClone(row.metadata) } : {})
      };
    }
    return out;
  }
}
