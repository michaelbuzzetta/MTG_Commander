const DEFAULT_HOOKS = [
  'kicker','buyback','entwine','replicate','casualty','convoke','delve','improvise',
  'phyrexian','emerge','offering','escape','foretell','retrace','commanderTax'
];

export class CostMechanicRegistry {
  constructor() {
    this.hooks = new Map(DEFAULT_HOOKS.map(name => [name, { name, handler: null }]));
  }
  register(name, handler) { this.hooks.set(name, { name, handler: typeof handler === 'function' ? handler : null }); return this; }
  get(name) { return this.hooks.get(name) || null; }
  snapshot() { return [...this.hooks.values()].map(({ name, handler }) => ({ name, implementedHook: !!handler })); }
}
