function normalizeId(value) { return String(value || '').trim().toLowerCase(); }

export class CustomHookRegistry {
  constructor() { this.hooks = new Map(); }

  register({ id, version, handler, description = null, testIds = [] } = {}) {
    const key = normalizeId(id);
    if (!key) throw new Error('Custom hook requires an id');
    if (!version) throw new Error(`Custom hook ${key} requires a version`);
    if (typeof handler !== 'function') throw new Error(`Custom hook ${key} requires a handler function`);
    if (this.hooks.has(key)) throw new Error(`Custom hook ${key} is already registered`);
    const record = Object.freeze({ id: key, version: String(version), handler, description, testIds: Object.freeze([...(testIds || [])]) });
    this.hooks.set(key, record);
    return record;
  }

  get(id) { return this.hooks.get(normalizeId(id)) || null; }
  has(id, version = null) {
    const hook = this.get(id);
    return !!hook && (version == null || hook.version === String(version));
  }

  execute(id, version, context = {}, args = {}) {
    const hook = this.get(id);
    if (!hook) throw new Error(`Custom hook "${id}" is not registered`);
    if (String(version) !== hook.version) throw new Error(`Custom hook "${id}" version mismatch: script requires ${version}, registered ${hook.version}`);
    return hook.handler(context, structuredClone(args || {}));
  }

  snapshot() {
    return [...this.hooks.values()].map(({ id, version, description, testIds }) => ({ id, version, description, testIds: [...testIds] }));
  }
}
