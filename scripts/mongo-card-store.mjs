import { MongoClient } from 'mongodb';

export const MONGO_URI = process.env.MTG_MONGO_URI || 'mongodb://127.0.0.1:27017';
export const MONGO_DB = process.env.MTG_MONGO_DB || 'mtg_commander';

let clientPromise;
export async function mongoDb() {
  if (!clientPromise) {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    clientPromise = client.connect().then(() => client);
  }
  return (await clientPromise).db(MONGO_DB);
}

export async function ensureCardIndexes(db) {
  const cards = db.collection('cards');
  const printings = db.collection('printings');
  await Promise.all([
    cards.createIndex({ oracleId: 1 }, { unique: true, sparse: true }),
    cards.createIndex({ name: 1 }),
    cards.createIndex({ aliases: 1 }),
    cards.createIndex({ searchName: 1 }),
    printings.createIndex({ scryfallId: 1 }, { unique: true }),
    printings.createIndex({ oracleId: 1 }),
    printings.createIndex({ name: 1 }),
    printings.createIndex({ oracleId: 1, releasedAt: -1 })
  ]);
}
