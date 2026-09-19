export function normalizeCounterType(type) {
  const value = String(type || '').trim();
  if (!value) throw new Error('Counter type is required');
  return value;
}

export class CounterStore {
  static ensure(target) {
    if (!target || typeof target !== 'object') throw new Error('Counter target is required');
    if (!target.counters || typeof target.counters !== 'object' || Array.isArray(target.counters)) target.counters = {};
    return target.counters;
  }

  static count(target, type) {
    if (!target) return 0;
    const key = normalizeCounterType(type);
    return Math.max(0, Number(target.counters?.[key] || 0));
  }

  static entries(target) {
    if (!target?.counters) return [];
    return Object.entries(target.counters)
      .map(([type, amount]) => [type, Math.max(0, Number(amount || 0))])
      .filter(([, amount]) => amount > 0)
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
  }

  static types(target) {
    return this.entries(target).map(([type]) => type);
  }

  static has(target, type) {
    return this.count(target, type) > 0;
  }

  static snapshot(target) {
    return Object.fromEntries(this.entries(target));
  }

  static addDirect(target, type, amount) {
    const key = normalizeCounterType(type);
    const n = Math.max(0, Number(amount || 0));
    if (!n) return { prior: this.count(target, key), added: 0, next: this.count(target, key) };
    const counters = this.ensure(target);
    const prior = Math.max(0, Number(counters[key] || 0));
    counters[key] = prior + n;
    return { prior, added: n, next: counters[key] };
  }

  static removeDirect(target, type, amount) {
    const key = normalizeCounterType(type);
    const n = Math.max(0, Number(amount || 0));
    const counters = this.ensure(target);
    const prior = Math.max(0, Number(counters[key] || 0));
    const removed = Math.min(prior, n);
    const next = prior - removed;
    if (next > 0) counters[key] = next;
    else delete counters[key];
    return { prior, removed, next };
  }
}
