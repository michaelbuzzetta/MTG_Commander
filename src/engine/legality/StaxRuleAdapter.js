import { LEGALITY_OPERATION, RULE_KIND } from './RuleTypes.js';

function cloneRules(rules = [], source) {
  return rules.filter(Boolean).map((rule, index) => ({
    ...structuredClone(rule),
    id: rule.id || `${source.instanceId}:rule:${index + 1}`,
    sourceId: source.instanceId,
    sourceController: source.controller
  }));
}

function staticRuleObjects(definition = {}, source) {
  const rules = [...(definition.ruleObjects || [])];
  for (const ability of definition.abilities || []) {
    if (ability.type !== 'static') continue;
    if (ability.ruleObject) rules.push(ability.ruleObject);
    if (Array.isArray(ability.ruleObjects)) rules.push(...ability.ruleObjects);
    if (ability.effect?.ruleObject) rules.push(ability.effect.ruleObject);
    if (Array.isArray(ability.effect?.ruleObjects)) rules.push(...ability.effect.ruleObjects);
  }
  return cloneRules(rules, source);
}

function rule(id, source, payload) {
  return { id: `${source.instanceId}:${id}`, sourceId: source.instanceId, sourceController: source.controller, ...payload };
}

/**
 * Step 21 compatibility migration for common stax/lock Oracle sentences.
 * It intentionally recognizes exact recurring rules patterns rather than
 * interpreting arbitrary natural language at runtime. Card scripting can
 * provide ruleObjects directly and should be preferred for migrated cards.
 */
export function staxRulesForPermanent(engine, source) {
  const definition = engine.static?.definitionFor(source) || engine.db[source.cardId] || {};
  const out = staticRuleObjects(definition, source);
  const text = String(definition.oracleText || '').replace(/[’]/g, "'");

  if (/each player can't cast more than one spell each turn/i.test(text)) {
    out.push(rule('rule-of-law', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.CAST,
      appliesTo: 'each-player',
      maxPerTurn: 1,
      message: 'A player cannot cast more than one spell each turn.'
    }));
  } else if (/your opponents can't cast more than one spell each turn/i.test(text)) {
    out.push(rule('opponent-rule-of-law', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.CAST,
      appliesTo: 'opponent',
      maxPerTurn: 1,
      message: 'An opponent cannot cast more than one spell each turn.'
    }));
  }

  if (/players can't search libraries/i.test(text)) {
    out.push(rule('players-cant-search', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.SEARCH,
      appliesTo: 'each-player',
      message: 'Players cannot search libraries.'
    }));
  } else if (/your opponents can't search libraries/i.test(text)) {
    out.push(rule('opponents-cant-search', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.SEARCH,
      appliesTo: 'opponent',
      message: 'Opponents cannot search libraries.'
    }));
  }

  if (/each player can't draw more than one card each turn/i.test(text)) {
    out.push(rule('one-draw-each-turn', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.DRAW,
      appliesTo: 'each-player',
      maxPerTurn: 1,
      message: 'A player cannot draw more than one card each turn.'
    }));
  }

  if (/your opponents can't gain life/i.test(text)) {
    out.push(rule('opponents-cant-gain-life', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.GAIN_LIFE,
      appliesTo: 'opponent',
      message: 'Opponents cannot gain life.'
    }));
  }

  if (/no more than one creature can attack each combat/i.test(text)) {
    out.push(rule('one-attacker', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.ATTACK,
      appliesTo: 'each-player',
      maxObjects: 1,
      message: 'No more than one creature can attack each combat.'
    }));
  }

  if (/no more than one creature can block each combat/i.test(text)) {
    out.push(rule('one-blocker', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.BLOCK,
      appliesTo: 'each-player',
      maxObjects: 1,
      message: 'No more than one creature can block each combat.'
    }));
  }

  const prison = text.match(/creatures can't attack you unless their controller pays \{(\d+)\} for each creature they control that's attacking you/i);
  if (prison) {
    out.push(rule('attack-tax', source, {
      kind: RULE_KIND.REQUIREMENT,
      operation: LEGALITY_OPERATION.ATTACK,
      appliesTo: 'opponent',
      when: { targetPlayerIsSourceController: true },
      genericCostPerObject: Number(prison[1]),
      message: `Attacking this player costs {${Number(prison[1])}} per creature.`
    }));
  }

  if (/nonbasic lands don't untap during their controllers' untap steps/i.test(text)) {
    out.push(rule('nonbasic-land-untap', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.UNTAP,
      appliesTo: 'each-player',
      filter: { type: 'Land', nonbasic: true },
      message: 'Nonbasic lands do not untap during their controllers\' untap steps.'
    }));
  }

  if (/players can cast spells only during their own turns/i.test(text)) {
    out.push(rule('own-turn-casting', source, {
      kind: RULE_KIND.RESTRICTION,
      operation: LEGALITY_OPERATION.CAST,
      appliesTo: 'each-player',
      when: { notOwnTurn: true },
      message: 'Players can cast spells only during their own turns.'
    }));
  }

  return out;
}
