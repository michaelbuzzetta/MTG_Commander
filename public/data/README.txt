MTG AI Trainer local database

cards.json = one master record for every unique card.
decks.json = deck lists referencing cards by name.

The game now loads these files directly and does not build them at startup.
