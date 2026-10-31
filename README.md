# Luce

Editor video per il telefono. Tagli, colore, titoli, audio e velocità, poi esporti un file. Non c’è account e i video non vengono caricati: restano nel browser, sul dispositivo. Chiudi la pagina e riaprila: il montaggio torna da solo, con i file salvati in locale.

Il flusso riprende le due pagine che usi di più su un editor desktop: il montaggio in timeline e la correzione colore con ruote per ombre, mezzi toni e luci.

## Cosa puoi fare

- Aprire uno o più video dal rullino, oppure generare due clip di prova
- Accorciare una clip trascinando i bordi sulla timeline. Il bordo destro segue il dito e si aggancia ai tagli, ai segni e al cursore. Il bordo sinistro sposta l’attacco e tiene le clip attaccate
- Riordinare una clip trascinandola di lato, oppure con Prima e Dopo
- Dividere al cursore, duplicare, scegliere Secco, Nero o Mix tra una clip e la successiva
- Scala, posizione, rotazione e opacità. Il pulsante Fotogramma ricorda scala, opacità ed esposizione e li fonde nel tempo
- Maschera rettangolare sfumata, chroma key, inversione e fermo immagine
- Stabilizzazione leggera, misurata sui fotogrammi della clip
- Una traccia sopra per un riquadro (Metti sopra) o per un altro file
- Musica o voce: Aggiungi audio, oppure Registra dal microfono. Volume e inizio sono indipendenti dal video
- Titoli con allineamento, sfondo, contorno, entrata e uscita. Si trascinano sull’anteprima
- Sottotitoli incollando un SRT o un VTT
- Segni sulla timeline: la bandierina ne aggiunge uno, e lo toglie se il cursore è già sopra
- Copiare e incollare il colore, applicarlo a tutte le clip, caricare una LUT `.cube`
- Forma d’onda e vettorscopio nel pannello colore, mentre correggi
- Formati 16:9, 9:16 e 1:1, in 720p o 1080p
- Esporta video, in tempo reale, con la pagina aperta
- Esporta veloce, quando il browser ha i codec: scrive un WebM senza aspettare tutta la durata. Se non parte, usa Esporta video

## Scorciatoie da tastiera

| Tasto | Azione |
| --- | --- |
| Spazio | Play / pausa |
| S o B | Dividi al cursore |
| I / O | Taglia inizio / fine al cursore |
| ← → | Un fotogramma (con Maiusc, un secondo) |
| Canc | Elimina clip, traccia sopra, audio o titolo |
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
