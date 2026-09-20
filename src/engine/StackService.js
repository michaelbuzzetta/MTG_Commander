import { createStackObject, stackObjectPublicSnapshot, validateStackObject } from './StackObject.js';

/** Single mutation/query gateway for GameState.stack introduced in Step 5. */
export class StackService {
  constructor(engine) { this.engine = engine; }

  push(fields) {
    const item = createStackObject(fields);
    validateStackObject(item, { throwOnError: true });
    this.engine.state.stack.push(item);
    this.engine.performance?.markTopology?.('stack:push');
    return item;
  }

  pop() { const item = this.engine.state.stack.pop() || null; if (item) this.engine.performance?.markTopology?.('stack:pop'); return item; }
  peek() { return this.engine.state.stack.at(-1) || null; }
  isEmpty() { return this.engine.state.stack.length === 0; }
  size() { return this.engine.state.stack.length; }
  find(id) { return this.engine.state.stack.find(item => item.id === id || item.gameObjectId === id) || null; }

  remove(id) {
    const index = this.engine.state.stack.findIndex(item => item.id === id || item.gameObjectId === id);
    if (index < 0) return null;
    const removed = this.engine.state.stack.splice(index, 1)[0] || null;
    if (removed) this.engine.performance?.markTopology?.('stack:remove');
    return removed;
  }

  removeWhere(predicate) {
    const removed = [];
    for (let index = this.engine.state.stack.length - 1; index >= 0; index--) {
      const item = this.engine.state.stack[index];
      if (!predicate(item, index)) continue;
      removed.unshift(this.engine.state.stack.splice(index, 1)[0]);
    }
    if (removed.length) this.engine.performance?.markTopology?.('stack:removeWhere');
    return removed;
  }

  getSnapshot() { return this.engine.state.stack.map(stackObjectPublicSnapshot); }
}
