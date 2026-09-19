import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_CATALOG = path.join(ROOT, '.cache', 'scryfall', 'card-catalog.json');

function sendJson(res, status, body) { res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store, max-age=0'); res.end(JSON.stringify(body)); }

function mongoCardCatalogPlugin() {
  const handler = async (req, res) => {
    try {
      const { mongoDb } = await import('./scripts/mongo-card-store.mjs');
      const db = await mongoDb();
      const meta = await db.collection('metadata').findOne({ _id: 'scryfall' });
      const cards = await db.collection('cards').find({}, { projection: { _id: 0, searchName: 0 } }).sort({ name: 1 }).toArray();
      if (cards.length < 10000) return sendJson(res,503,{error:`MongoDB catalog is incomplete (${cards.length} cards). Run npm run sync-mongo.`});
      sendJson(res,200,{schemaVersion:4,source:'MongoDB / Scryfall',sourceType:'oracle_cards',sourceUpdatedAt:meta?.oracleUpdatedAt||null,generatedAt:meta?.updatedAt||null,complete:meta?.complete===true,count:cards.length,cards});
    } catch (error) { sendJson(res,503,{error:`MongoDB card catalog unavailable: ${error.message}`}); }
  };
  return {
    name:'mtg-mongodb-card-catalog',
    configureServer(server){server.middlewares.use('/api/card-catalog',handler);},
    configurePreviewServer(server){server.middlewares.use('/api/card-catalog',handler);},
    generateBundle(){
      // Keep a legacy snapshot only as an emergency offline build artifact. The dev/preview
      // application always reads MongoDB first and never silently treats this as complete.
      if(fs.existsSync(LEGACY_CATALOG)) this.emitFile({type:'asset',fileName:'data/scryfall-card-catalog.json',source:fs.readFileSync(LEGACY_CATALOG)});
    }
  };
}
export default defineConfig({plugins:[react(),mongoCardCatalogPlugin()]});
