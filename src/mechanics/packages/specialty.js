export const SPECIALTY_MECHANICS = [
  { id: 'persist', name: 'Persist', category: 'specialty', dependencies: ['triggers','zones','counters'], hooks: ['dies-trigger'], oraclePatterns: [/\bpersist\b/], conformance: ['triggers','zones','counters'] },
  { id: 'undying', name: 'Undying', category: 'specialty', dependencies: ['triggers','zones','counters'], hooks: ['dies-trigger'], oraclePatterns: [/\bundying\b/], conformance: ['triggers','zones','counters'] },
  { id: 'exploit', name: 'Exploit', category: 'specialty', dependencies: ['triggers','zones','choices'], hooks: ['etb-sacrifice-choice'], oraclePatterns: [/\bexploit\b/], conformance: ['triggers','zones','choices'] },
  { id: 'devour', name: 'Devour', category: 'specialty', dependencies: ['replacement','zones','counters','choices'], hooks: ['entry-replacement'], oraclePatterns: [/\bdevour\b/], conformance: ['replacement','zones','counters'] },
  { id: 'dredge', name: 'Dredge', category: 'specialty', dependencies: ['replacement','zones'], hooks: ['draw-replacement'], oraclePatterns: [/\bdredge\b/], conformance: ['replacement','zones'] },
  { id: 'storm', name: 'Storm', category: 'specialty', dependencies: ['triggers','stack','copy'], hooks: ['cast-trigger','spell-copy'], oraclePatterns: [/\bstorm\b/], conformance: ['triggers','stack'] },
  { id: 'rebound', name: 'Rebound', category: 'specialty', dependencies: ['replacement','zones','triggers','stack'], hooks: ['resolution-replacement','upkeep-cast'], oraclePatterns: [/\brebound\b/], conformance: ['replacement','zones','triggers'] },
  { id: 'morph', name: 'Morph', category: 'specialty', dependencies: ['card-faces','costs','continuous'], hooks: ['face-down-cast','special-action'], oraclePatterns: [/\bmorph\b/], conformance: ['costs','continuous'] },
  { id: 'manifest', name: 'Manifest', category: 'specialty', dependencies: ['card-faces','zones','continuous'], hooks: ['face-down-entry'], oraclePatterns: [/\bmanifest\b/], conformance: ['zones','continuous'] },
  { id: 'disguise', name: 'Disguise', category: 'specialty', dependencies: ['card-faces','costs','continuous'], hooks: ['face-down-cast','special-action'], oraclePatterns: [/\bdisguise\b/], conformance: ['costs','continuous'] },
  { id: 'saga', name: 'Saga', category: 'specialty', dependencies: ['counters','triggers','sba'], hooks: ['lore-counter','chapter-trigger'], oraclePatterns: [/\bsaga\b/], conformance: ['counters','triggers','sba'] },
  { id: 'battle', name: 'Battle', category: 'specialty', dependencies: ['combat','counters','sba'], hooks: ['defending-entity','defense-counter'], oraclePatterns: [/\bbattle\b/], conformance: ['combat','counters','sba'] },
  { id: 'vehicle', name: 'Vehicle', category: 'specialty', dependencies: ['costs','continuous'], hooks: ['crew'], oraclePatterns: [/\bvehicle\b/, /\bcrew\s+\d+/], conformance: ['costs','continuous'] },
  { id: 'infect', name: 'Infect', category: 'specialty', dependencies: ['damage','counters'], hooks: ['damage-consequence'], oraclePatterns: [/\binfect\b/], conformance: ['damage','counters'] },
  { id: 'wither', name: 'Wither', category: 'specialty', dependencies: ['damage','counters'], hooks: ['damage-consequence'], oraclePatterns: [/\bwither\b/], conformance: ['damage','counters'] },
  { id: 'changeling', name: 'Changeling', category: 'specialty', dependencies: ['continuous'], hooks: ['characteristic-subtype'], oraclePatterns: [/\bchangeling\b/], conformance: ['continuous'] },
  { id: 'mentor', name: 'Mentor', category: 'specialty', dependencies: ['combat','triggers','targeting','counters'], hooks: ['attack-trigger','counter-placement'], oraclePatterns: [/\bmentor\b/], conformance: ['combat','triggers','targeting','counters'] }
];
