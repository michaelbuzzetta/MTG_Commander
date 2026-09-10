import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = path.join(ROOT, '.cache', 'scryfall', 'card-catalog.json');

function cardCatalogPlugin() {
  const sendCatalog = (_req, res) => {
    if (!fs.existsSync(CATALOG_FILE)) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Card catalog has not been generated yet.' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    fs.createReadStream(CATALOG_FILE).pipe(res);
  };

  return {
    name: 'mtg-scryfall-card-catalog',
    configureServer(server) {
      server.middlewares.use('/api/card-catalog', sendCatalog);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/card-catalog', sendCatalog);
    },
    generateBundle() {
      if (!fs.existsSync(CATALOG_FILE)) return;
      this.emitFile({
        type: 'asset',
        fileName: 'data/scryfall-card-catalog.json',
        source: fs.readFileSync(CATALOG_FILE)
      });
    }
  };
}

export default defineConfig({ plugins: [react(), cardCatalogPlugin()] });
