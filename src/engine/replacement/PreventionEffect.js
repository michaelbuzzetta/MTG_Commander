export class PreventionEffect {
  constructor({ id, source = null, targetRef, amount = Infinity, predicate = null, expires = null, metadata = {} } = {}) {
    if (!id) throw new Error('PreventionEffect requires an id');
    if (!targetRef) throw new Error('PreventionEffect requires a target');
    this.id = String(id);
    this.source = source ? structuredClone(source) : null;
    this.targetRef = String(targetRef);
    this.remaining = amount === Infinity ? Infinity : Math.max(0, Number(amount || 0));
    this.predicate = predicate;
    this.expires = expires ? structuredClone(expires) : null;
    this.metadata = structuredClone(metadata || {});
  }
}
