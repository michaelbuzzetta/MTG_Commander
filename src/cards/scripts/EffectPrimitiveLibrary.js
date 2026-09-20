const definition = (id, { required = [], lower = null, aliases = [] } = {}) => ({ id, required, lower, aliases });

const direct = type => node => ({ type, ...withoutControlFields(node) });
function withoutControlFields(node = {}) {
  const { op, primitive, then, otherwise, condition, effects, effect, each, selector, as, times, hook, hookId, version, args, ...rest } = node;
  return structuredClone(rest);
}

const DEFINITIONS = [
  definition('draw', { lower: direct('draw') }),
  definition('discard', { lower: node => ({ type: 'scriptDiscard', ...withoutControlFields(node) }) }),
  definition('mill', { lower: node => ({ type: 'scriptMill', ...withoutControlFields(node) }) }),
  definition('damage', { required: ['amount'], lower: direct('damage') }),
  definition('fight', { lower: direct('fight') }),
  definition('preventDamage', { aliases: ['prevent_damage'], required: ['amount'], lower: direct('preventDamage') }),
  definition('learn', { lower: direct('learn') }),
  definition('scry', { required: ['amount'], lower: direct('scry') }),
  definition('surveil', { required: ['amount'], lower: direct('surveil') }),
  definition('gainLife', { aliases: ['gain_life'], required: ['amount'], lower: direct('gainLife') }),
  definition('loseLife', { aliases: ['lose_life'], required: ['amount'], lower: direct('loseLife') }),
  definition('destroy', { lower: direct('destroy') }),
  definition('exile', { lower: direct('exile') }),
  definition('sacrifice', { lower: direct('sacrifice') }),
  definition('tap', { lower: node => ({ type: 'scriptTap', ...withoutControlFields(node) }) }),
  definition('untap', { lower: direct('untap') }),
  definition('skipNextUntap', { aliases: ['skip_next_untap'], lower: direct('skipNextUntap') }),
  definition('createToken', { aliases: ['create_token'], required: ['token'], lower: direct('createToken') }),
  definition('copy', { lower: node => ({ type: 'scriptCopy', ...withoutControlFields(node) }) }),
  definition('counter', { lower: node => ({ type: 'counterSpellTarget', index: Number(node.index || 0) }) }),
  definition('search', { lower: node => {
    const rest = withoutControlFields(node);
    // Land-search templates lower into the existing choice-aware search path
    // so generated scripts do not silently choose the first matching card.
    if (node.basicOnly || (node.landTypes || []).length) {
      return {
        type: 'searchLand',
        basicOnly: !!node.basicOnly,
        landTypes: [...(node.landTypes || [])],
        destination: node.toZone || node.destination || 'battlefield',
        tapped: !!node.tapped,
        shuffle: node.shuffle !== false
      };
    }
    return { type: 'scriptSearch', ...rest };
  } }),
  definition('reveal', { lower: node => ({ type: 'scriptReveal', ...withoutControlFields(node) }) }),
  definition('shuffle', { lower: node => ({ type: 'scriptShuffle', ...withoutControlFields(node) }) }),
  definition('moveZone', { aliases: ['move_zone'], required: ['toZone'], lower: node => ({ type: 'scriptMoveZone', ...withoutControlFields(node) }) }),
  definition('moveEventObject', { aliases: ['move_event_object'], required: ['toZone'], lower: node => ({ type: 'moveEventObject', ...withoutControlFields(node) }) }),
  definition('blink', { lower: node => ({ type: 'blink', ...withoutControlFields(node) }) }),
  definition('exileUntilSourceLeaves', { aliases: ['exile_until_source_leaves'], lower: node => ({ type: 'exileUntilSourceLeaves', ...withoutControlFields(node) }) }),
  definition('addCounter', { aliases: ['add_counter'], lower: direct('addCounter') }),
  definition('removeCounter', { aliases: ['remove_counter'], lower: node => ({ type: 'scriptRemoveCounter', ...withoutControlFields(node) }) }),
  definition('modifyCharacteristics', { aliases: ['modify_characteristics'], lower: node => ({ type: 'pump', ...withoutControlFields(node) }) }),
  definition('grantAbility', { aliases: ['grant_ability'], required: ['ability'], lower: node => ({ type: 'scriptGrantAbility', ...withoutControlFields(node) }) }),
  definition('removeAbility', { aliases: ['remove_ability'], lower: node => ({ type: 'scriptRemoveAbility', ...withoutControlFields(node) }) }),
  definition('extraTurn', { aliases: ['extra_turn'], lower: direct('extraTurn') }),
  definition('extraCombat', { aliases: ['extra_combat'], lower: direct('extraCombat') }),
  definition('skipTurn', { aliases: ['skip_turn'], lower: direct('skipNextTurn') }),
  definition('skipDraw', { aliases: ['skip_draw'], lower: direct('skipNextDrawStep') }),
  definition('skipCombat', { aliases: ['skip_combat'], lower: direct('skipNextCombat') }),
  definition('controlChange', { aliases: ['control_change'], lower: direct('gainControl') }),
  definition('combatRestriction', { aliases: ['combat_restriction'], lower: direct('combatRestriction') }),
  definition('transformSelf', { aliases: ['transform_self'], lower: direct('transformSelf') }),
  definition('livingWeapon', { aliases: ['living_weapon'], lower: direct('livingWeapon') }),
  definition('backup', { lower: direct('backup') }),
  definition('exileReturnTransformedSelf', { aliases: ['exile_return_transformed_self'], lower: direct('exileReturnTransformedSelf') }),
  definition('equipmentTokenAttach', { aliases: ['equipment_token_attach'], required: ['token'], lower: direct('equipmentTokenAttach') }),
  definition('cascade', { lower: direct('cascade') }),
  definition('discover', { required: ['amount'], lower: direct('discover') }),
  definition('becomeMonarch', { aliases: ['become_monarch'], lower: direct('becomeMonarch') }),
  definition('exploit', { lower: direct('exploit') }),
  definition('cumulativeUpkeep', { lower: direct('cumulativeUpkeep') }),
  definition('extort', { lower: direct('extort') }),
  definition('melee', { lower: direct('melee') }),
  definition('soulbond', { lower: direct('soulbond') })
];

export class EffectPrimitiveLibrary {
  constructor() {
    this.definitions = new Map();
    this.aliases = new Map();
    for (const entry of DEFINITIONS) this.register(entry);
  }

  register(entry) {
    if (!entry?.id) throw new Error('Effect primitive requires an id');
    if (this.definitions.has(entry.id)) throw new Error(`Effect primitive ${entry.id} is already registered`);
    this.definitions.set(entry.id, Object.freeze({ ...entry, required: Object.freeze([...(entry.required || [])]), aliases: Object.freeze([...(entry.aliases || [])]) }));
    this.aliases.set(entry.id.toLowerCase(), entry.id);
    for (const alias of entry.aliases || []) this.aliases.set(String(alias).toLowerCase(), entry.id);
    return this;
  }

  resolve(name) {
    const id = this.aliases.get(String(name || '').trim().toLowerCase());
    return id ? this.definitions.get(id) : null;
  }

  has(name) { return !!this.resolve(name); }
  list() { return [...this.definitions.values()].map(entry => ({ id: entry.id, required: [...entry.required], aliases: [...entry.aliases] })); }

  lower(node = {}) {
    const name = node.op || node.primitive;
    const entry = this.resolve(name);
    if (!entry) throw new Error(`Unknown effect primitive "${name || '(missing)'}"`);
    for (const field of entry.required) if (node[field] == null) throw new Error(`Effect primitive ${entry.id} requires field "${field}"`);
    return entry.lower ? entry.lower(node) : { type: entry.id, ...withoutControlFields(node) };
  }
}

export const STANDARD_EFFECT_PRIMITIVES = Object.freeze(DEFINITIONS.map(entry => entry.id));
