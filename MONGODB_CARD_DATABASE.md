# Local MongoDB card database

The trainer now uses a local MongoDB database as its complete card catalog. This is intentionally local-only; no hosted database is required.

## First setup (Windows/macOS/Linux)

1. Install Docker Desktop (recommended) or MongoDB Community Server.
2. From this project folder run `docker compose up -d` if using Docker.
3. Run `npm install` once. This installs the MongoDB driver and streaming JSON parser.
4. Run `npm run sync-mongo`. The importer downloads Scryfall's current `oracle_cards` and `default_cards` bulk datasets and streams them into MongoDB without loading the huge files into one JavaScript string.
5. Run `npm run dev`.

`npm run dev` performs a current-catalog check/import before Vite starts. MongoDB persists the data between launches in the `mtg_card_database` Docker volume.

## What is stored

- `cards`: one record per Oracle identity, including rules text, faces, legalities, color identity, keywords and artwork URLs.
- `printings`: every Scryfall printing, including set/collector metadata and printing-specific artwork URLs.
- `metadata`: sync status and record counts.

The application catalog endpoint now reads `cards` from MongoDB. Missing Oracle-card artwork is patched during import from the newest English printing with usable artwork. Multi-face cards preserve per-face image URLs.

## Offline bulk import

If you already downloaded Scryfall bulk files, run:

`node scripts/sync-scryfall-mongodb.mjs --oracle-file="PATH_TO_ORACLE_FILE" --printing-file="PATH_TO_DEFAULT_CARDS_FILE"`

Both normal JSON arrays and `.jsonl` / `.jsonl.gz` snapshots are supported.

## Diagnostics

Open MongoDB Shell and run:

`use mtg_commander`

`db.cards.countDocuments()`

`db.printings.countDocuments()`

`db.cards.findOne({name:"Jon Irenicus, Shattered One"})`

A healthy full catalog should contain far more than 10,000 Oracle identities. The exact count changes as Scryfall adds cards. Jon Irenicus should return a document regardless of whether his gameplay rules are implemented by the trainer.
