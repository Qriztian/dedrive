# Delegat Transport Stockholm (MVP)

MVP for koordinering av delegattransporter med tre roller:
- `volunteer` (chauffor)
- `admin`
- `airport` (flygplatsteam)

## Starta lokalt

```bash
npm install
npm run dev
```

Oppna `http://localhost:3000`.

## Demo-inloggning

- Admin: `admin` / `2468`
- Airport team: `airport` / `1357`
- Volontar: `1` / `1001` (upp till 300 forkonfigurerade volontarer)

## Funktioner i MVP

- ID + PIN-inloggning utan e-post/namn.
- Admin kan skapa akuta/planerade korningar.
- Admin valjer fordonstyp per korning: bil, minibuss eller buss.
- Volontarer svarar ja/nej med ETA i minuter.
- Automatisk tilldelning (kortast ETA inom 2 minuter fran publicering).
- Sateskontroll mellan behov och volontarbil.
- Airport/admin kan skicka driftnotiser.
- Schema visar bokade/klarade korningar med status.
- Admin kan importera volontarer via CSV i UI.
- UI ar uppdaterad till mork mobil-forst design for snabb drift.

## Datalagring

Data sparas server-side i SQLite: `data/transport.db`.

Sessioner lagras persistenta i databasen.

## CSV-format for import

En rad per volontar:

`volontarnummer,PIN,saten`

Exempel:

`301,1301,4`
