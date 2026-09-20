export const LOOP_CLASS = Object.freeze({
  MANDATORY_INFINITE: 'mandatory_infinite',
  OPTIONAL: 'optional_loop',
  DETERMINISTIC_RESOURCE: 'deterministic_resource',
  WITH_CHOICES: 'loop_with_choices',
  PROGRESS_TOWARD_TERMINATION: 'progress_toward_termination'
});

export const SHORTCUT_CONDITION = Object.freeze({
  MANA_AT_LEAST: 'MANA_AT_LEAST',
  LIFE_AT_MOST: 'LIFE_AT_MOST',
  LIFE_AT_LEAST: 'LIFE_AT_LEAST',
  HAND_SIZE_AT_LEAST: 'HAND_SIZE_AT_LEAST',
  COUNTER_AT_LEAST: 'COUNTER_AT_LEAST'
});

export const LOOP_SHORTCUT_ACTION = 'LOOP_SHORTCUT';
