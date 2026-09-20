import { ABILITY_KINDS, CARD_SCRIPT_VERSION } from './AbilityIR.js';
import { validateSelector } from './SelectorDSL.js';

const CONTROL_OPS = new Set(['sequence','if','forEach','repeat','may','customHook']);
const VALID_ZONES = new Set(['library','hand','battlefield','graveyard','exile','command','stack']);

const TIMING_SPEEDS = new Set(['instant','flash','any','sorcery','special','mana']);
const TIMING_KEYS = new Set([
  'speed','kind','requiresPriority','yourTurn','combatOnly','onlyDuringCombat',
  'phases','phase','steps','step','phaseGroups','phaseGroup',
  'beforeStep','onlyBeforeStep','before','afterStep','onlyAfterStep','after',
  'notUsedSinceStep','notActivatedSinceStep','notUsedSince',
  'oncePerTurn','maxPerTurn','oncePerCombat','maxPerCombat',
  'condition','customCondition','message','source','metadata','sorcerySpeed'
]);

function validateTiming(timing, path, diagnostics) {
  if (timing == null) return;
  if (typeof timing === 'string') {
    if (!TIMING_SPEEDS.has(timing.toLowerCase())) add(diagnostics, path, `unknown timing speed "${timing}"`);
    return;
  }
  if (typeof timing !== 'object' || Array.isArray(timing)) return add(diagnostics, path, 'timing must be a string or object');
  for (const key of Object.keys(timing)) if (!TIMING_KEYS.has(key)) add(diagnostics, `${path}.${key}`, `unknown timing field "${key}"`);
  const speed = timing.speed || timing.kind;
  if (speed != null && !TIMING_SPEEDS.has(String(speed).toLowerCase())) add(diagnostics, `${path}.speed`, `unknown timing speed "${speed}"`);
  for (const key of ['maxPerTurn','maxPerCombat']) if (timing[key] != null && (!Number.isFinite(Number(timing[key])) || Number(timing[key]) < 0)) add(diagnostics, `${path}.${key}`, `${key} must be a non-negative number`);
  for (const key of ['phases','steps','phaseGroups']) if (timing[key] != null && !Array.isArray(timing[key])) add(diagnostics, `${path}.${key}`, `${key} must be an array`);
  validateCondition(timing.condition ?? timing.customCondition, `${path}.condition`, diagnostics);
}

export class ScriptValidationError extends Error {
  constructor(diagnostics = []) {
    const summary = diagnostics.slice(0, 8).map(item => `${item.path}: ${item.message}`).join('; ');
    super(`Card script validation failed${summary ? ` — ${summary}` : ''}`);
    this.name = 'ScriptValidationError';
    this.diagnostics = diagnostics;
  }
}

function add(diagnostics, path, message) { diagnostics.push({ path, message }); }

function validateCondition(condition, path, diagnostics) {
  if (condition == null) return;
  if (typeof condition === 'boolean') return;
  if (typeof condition !== 'object') return add(diagnostics, path, 'condition must be boolean or object');
  const allowed = new Set(['always','not','and','or','sourceHasCounter','controllerLifeAtMost','controllerLifeAtLeast','eventFieldEquals','targetExists','variableExists','controllerControls','opponentControls']);
  for (const key of Object.keys(condition)) if (!allowed.has(key)) add(diagnostics, `${path}.${key}`, `unknown condition operator "${key}"`);
  if (condition.and) [].concat(condition.and).forEach((child, index) => validateCondition(child, `${path}.and[${index}]`, diagnostics));
  if (condition.or) [].concat(condition.or).forEach((child, index) => validateCondition(child, `${path}.or[${index}]`, diagnostics));
  if (condition.not) validateCondition(condition.not, `${path}.not`, diagnostics);
}

function validateEffect(node, path, diagnostics, primitives, customHooks = null) {
  if (node == null) return add(diagnostics, path, 'effect node is required');
  if (Array.isArray(node)) {
    node.forEach((child, index) => validateEffect(child, `${path}[${index}]`, diagnostics, primitives, customHooks));
    return;
  }
  if (typeof node !== 'object') return add(diagnostics, path, 'effect node must be an object');
  const op = node.op || node.primitive;
  if (!op) return add(diagnostics, path, 'effect node requires op/primitive');
  if (CONTROL_OPS.has(op)) {
    if (op === 'sequence') {
      if (!Array.isArray(node.effects) || !node.effects.length) add(diagnostics, `${path}.effects`, 'sequence requires a non-empty effects array');
      (node.effects || []).forEach((child, index) => validateEffect(child, `${path}.effects[${index}]`, diagnostics, primitives, customHooks));
    } else if (op === 'if') {
      validateCondition(node.condition, `${path}.condition`, diagnostics);
      validateEffect(node.then, `${path}.then`, diagnostics, primitives, customHooks);
      if (node.otherwise != null) validateEffect(node.otherwise, `${path}.otherwise`, diagnostics, primitives, customHooks);
    } else if (op === 'forEach') {
      diagnostics.push(...validateSelector(node.selector, { path: `${path}.selector` }));
      if (!node.as || typeof node.as !== 'string') add(diagnostics, `${path}.as`, 'forEach requires a variable name in "as"');
      validateEffect(node.effect, `${path}.effect`, diagnostics, primitives, customHooks);
    } else if (op === 'repeat') {
      if (!(Number(node.times) >= 0) && typeof node.times !== 'object') add(diagnostics, `${path}.times`, 'repeat times must be a non-negative number or value expression');
      validateEffect(node.effect, `${path}.effect`, diagnostics, primitives, customHooks);
    } else if (op === 'may') {
      validateEffect(node.effect, `${path}.effect`, diagnostics, primitives, customHooks);
    } else if (op === 'customHook') {
      const hookId = node.hookId || node.hook;
      if (!hookId) add(diagnostics, `${path}.hookId`, 'customHook requires hookId');
      if (!node.version) add(diagnostics, `${path}.version`, 'customHook requires an explicit version');
      if (hookId && node.version && customHooks && !customHooks.has(hookId, node.version)) add(diagnostics, path, `custom hook "${hookId}" version ${node.version} is not registered`);
    }
    return;
  }
  const primitive = primitives.resolve(op);
  if (!primitive) return add(diagnostics, path, `unknown effect primitive "${op}"`);
  for (const field of primitive.required || []) if (node[field] == null) add(diagnostics, `${path}.${field}`, `${primitive.id} requires field "${field}"`);
  if (node.toZone && !VALID_ZONES.has(String(node.toZone))) add(diagnostics, `${path}.toZone`, `unknown destination zone "${node.toZone}"`);
  if (node.selector) diagnostics.push(...validateSelector(node.selector, { path: `${path}.selector` }));
}

export class ScriptValidator {
  constructor({ primitives, customHooks = null } = {}) { this.primitives = primitives; this.customHooks = customHooks; }

  validateCard(card = {}) {
    const diagnostics = [];
    const script = card.script || card.cardScript;
    if (!script) return diagnostics;
    if (Number(script.version ?? CARD_SCRIPT_VERSION) !== CARD_SCRIPT_VERSION) add(diagnostics, 'script.version', `unsupported script version ${script.version}; expected ${CARD_SCRIPT_VERSION}`);
    const abilities = script.abilities || [];
    if (!Array.isArray(abilities)) add(diagnostics, 'script.abilities', 'abilities must be an array');
    else abilities.forEach((ability, index) => {
      const path = `script.abilities[${index}]`;
      const kind = String(ability.kind || ability.type || '').toLowerCase();
      if (!ABILITY_KINDS.has(kind)) add(diagnostics, `${path}.kind`, `unknown ability kind "${kind || '(missing)'}"`);
      if (kind === 'triggered' && !ability.event) add(diagnostics, `${path}.event`, 'triggered ability requires event');
      validateTiming(ability.timing, `${path}.timing`, diagnostics);
      if (kind === 'replacement' && !ability.event) add(diagnostics, `${path}.event`, 'replacement ability requires event');
      if (kind === 'activated' && !ability.cost) add(diagnostics, `${path}.cost`, 'activated ability requires a cost object');
      if (ability.targets || ability.target) diagnostics.push(...validateSelector(ability.targets || ability.target, { path: `${path}.targets` }));
      if (ability.filter) diagnostics.push(...validateSelector(ability.filter, { path: `${path}.filter` }));
      if (ability.affectedFilter) diagnostics.push(...validateSelector(ability.affectedFilter, { path: `${path}.affectedFilter` }));
      if (kind === 'characteristic') {
        if (!ability.characteristic && !ability.derive) add(diagnostics, `${path}.characteristic`, 'characteristic ability requires characteristic/derive data');
      } else if (kind === 'static') {
        if (!ability.effect && !ability.ruleObject && !Array.isArray(ability.ruleObjects)) add(diagnostics, `${path}.effect`, 'static ability requires an effect object or legality rule object');
      } else if (kind === 'replacement') {
        if (!ability.replacement && ability.effect == null) add(diagnostics, `${path}.replacement`, 'replacement ability requires replacement/effect data');
      } else if (ability.effect == null && ability.effects == null && !(kind === 'triggered' && Array.isArray(ability.modes) && ability.modes.length)) add(diagnostics, `${path}.effect`, `${kind || 'ability'} requires effect/effects`);
      if (Array.isArray(ability.modes)) for (const [modeIndex, mode] of ability.modes.entries()) { const mp = `${path}.modes[${modeIndex}]`; if (!mode.id) add(diagnostics, `${mp}.id`, 'mode requires an id'); if (mode.targets || mode.target) diagnostics.push(...validateSelector(mode.targets || mode.target, { path: `${mp}.targets` })); validateEffect(mode.effect ?? mode.effects, `${mp}.effect`, diagnostics, this.primitives, this.customHooks); }
      if (!['static','replacement','characteristic'].includes(kind) && ability.effect != null) validateEffect(ability.effect ?? ability.effects, `${path}.effect`, diagnostics, this.primitives, this.customHooks);
    });
    for (const [index, mode] of (script.modes || []).entries()) {
      const path = `script.modes[${index}]`;
      if (!mode.id) add(diagnostics, `${path}.id`, 'mode requires an id');
      validateTiming(mode.timing, `${path}.timing`, diagnostics);
      if (mode.targets || mode.target) diagnostics.push(...validateSelector(mode.targets || mode.target, { path: `${path}.targets` }));
      validateEffect(mode.effect ?? mode.effects, `${path}.effect`, diagnostics, this.primitives, this.customHooks);
    }
    return diagnostics;
  }

  assertValid(card) {
    const diagnostics = this.validateCard(card);
    if (diagnostics.length) throw new ScriptValidationError(diagnostics);
    return true;
  }
}
