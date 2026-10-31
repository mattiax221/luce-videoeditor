# Luce

Editor video per il telefono. Tagli, colore, titoli, audio e velocità, poi esporti un file. Non c’è account e i video non vengono caricati: restano nel browser, sul dispositivo.

Il flusso riprende le due pagine che usi di più su un editor desktop: il montaggio in timeline e la correzione colore con ruote per ombre, mezzi toni e luci.

## Cosa puoi fare

- Aprire uno o più video dal rullino, oppure generare due clip di prova
- Tagliare con i bordi sulla striscia sorgente, dividere al cursore, riordinare
- Correggere il colore: preset, ruote, esposizione, contrasto, temperatura, grana
- Aggiungere titoli e trascinarli sull’anteprima
- Regolare volume, fade e velocità
- Scegliere 16:9, 9:16 o 1:1, in 720p o 1080p
- Esportare e scaricare o condividere il file

L’esportazione avviene in tempo reale: un video di trenta secondi richiede circa trenta secondi, con la pagina aperta.

## Scorciatoie da tastiera

| Tasto | Azione |
| --- | --- |
| Spazio | Play / pausa |
| S o B | Dividi al cursore |
| I / O | Taglia inizio / fine al cursore |
| ← → | Un fotogramma (con Maiusc, un secondo) |
| Canc | Elimina clip o titolo |
| Ctrl/⌘ Z | Annulla, con Maiusc ripeti |

## Avvio

```bash
npm install
npm run dev
```

Apri [http://127.0.0.1:43123](http://127.0.0.1:43123). Su Chrome, Edge o Safari aggiornato l’anteprima e l’esportazione usano il video del dispositivo. Firefox può riprodurre e, se il browser lo consente, esportare in WebM.

```bash
npm test
npm run lint
```
