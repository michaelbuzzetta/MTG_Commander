// Read-only production database facade.
import cards from '../data/generated/cards.json' with { type: 'json' };
import decks from '../data/generated/decks.json' with { type: 'json' };

export function getBuiltInCardDatabase() {
  return cards;
}

export function getBuiltInDecks() {
  return decks;
}

export * from './update/index.js';
export {
  loadCardCatalog,
  mergeBuilderDatabase,
  promoteCatalogCard,
  promoteCatalogDefinitions,
  promoteCatalogNames
} from '../utils/cardCatalog.js';
