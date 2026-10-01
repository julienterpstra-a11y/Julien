# Mijn Financiën — persoonlijke financiële dashboard

Zelf-gehoste dashboard die je koppelt aan je eigen bankrekening(en). Je gegevens blijven op je eigen computer/server; er is geen cloud-account of database nodig en de app heeft **geen npm-dependencies**.

## Functies

- **Bankkoppeling via PSD2** (alleen-lezen, max. 180 dagen toestemming, daarna opnieuw inloggen bij je bank):
  - [Enable Banking](https://enablebanking.com) — gratis voor je eigen rekeningen
  - [GoCardless Bank Account Data](https://bankaccountdata.gocardless.com) (voorheen Nordigen)
  - Werkt met o.a. ING, Rabobank, ABN AMRO, SNS, ASN, RegioBank, bunq, Triodos, Knab en de meeste Europese banken
- **CSV-import** als alternatief: ING, Rabobank, ABN AMRO (TXT/TAB) en generieke CSV's met `Datum`/`Bedrag` (bunq, SNS, ASN, …). Dubbele transacties worden overgeslagen.
- **Dashboard**: totaal saldo per rekening, inkomsten/uitgaven, spaarquote, grafiek per maand, saldoverloop, uitgaven per categorie, vaste lasten en een doorzoekbare transactielijst
- **Automatisch categoriseren** met regels voor Nederlandse winkels/bedrijven; pas een categorie aan en de app onthoudt het voor die tegenpartij
- **Maandbudgetten** per categorie
- Automatische synchronisatie elke 6 uur, licht/donker thema, werkt op mobiel
- Optionele wachtwoordbeveiliging

## Snel starten

Vereist [Node.js](https://nodejs.org) 20 of nieuwer.

```bash
cd finance-dashboard
cp .env.example .env     # optioneel: instellingen
npm start
```

Open <http://localhost:3000> en kies **Probeer met demodata**, **CSV importeren** of **Bank koppelen**.

## Je bank koppelen

### Optie A — Enable Banking (aanbevolen, gratis voor eigen gebruik)

1. Maak een account op <https://enablebanking.com/cp/applications> en registreer een nieuwe applicatie:
   - Environment: **Production**
   - Redirect URL: `http://localhost:3000/callback/enablebanking` (of je eigen `BASE_URL` + `/callback/enablebanking`)
2. Bij het aanmaken genereer je een private key; download het `.pem`-bestand en zet het in `data/enablebanking.pem`.
3. Activeer de applicatie door je **eigen rekeningen** te koppelen in het Enable Banking-portaal ("Activate by linking accounts"). Zo krijg je gratis toegang tot je eigen rekeningen.
4. Zet in `.env`:
   ```
   ENABLE_BANKING_APP_ID=<application id>
   ENABLE_BANKING_KEY_PATH=./data/enablebanking.pem
   ```
5. Herstart (`npm start`), open **Banken & instellingen → Bank koppelen**, zoek je bank en log in.

### Optie B — GoCardless Bank Account Data

1. Maak een account op <https://bankaccountdata.gocardless.com> en maak onder *User secrets* een nieuw secret aan.
2. Zet in `.env`:
   ```
   GOCARDLESS_SECRET_ID=...
   GOCARDLESS_SECRET_KEY=...
   ```
3. Herstart en koppel je bank via de dashboard.

> Let op: GoCardless accepteert niet altijd nieuwe aanmeldingen voor Bank Account Data. Lukt het niet, gebruik dan Enable Banking.

### Optie C — CSV-import (geen koppeling nodig)

Download je transacties bij je bank:
- **ING**: Mijn ING → Af- en bijschrijvingen downloaden → *Kommagescheiden CSV* of *Puntkomma*
- **Rabobank**: Rabo Internetbankieren → Downloaden transacties → *CSV*
- **ABN AMRO**: Internet Bankieren → Af- en bijschrijvingen downloaden → *TXT*

Sleep het bestand in **Banken & instellingen → CSV importeren**. Je kunt steeds overlappende periodes importeren; duplicaten worden herkend.

## Veiligheid & privacy

- De app is alleen-lezen: PSD2-toegang voor rekeninginformatie kan **geen betalingen** doen.
- Alle data staat lokaal in `data/db.json` (bestandsrechten `600`). Deze map staat in `.gitignore` — commit hem nooit.
- De server luistert standaard alleen op `127.0.0.1`. Wil je hem op een server/NAS draaien, zet dan `HOST=0.0.0.0`, **stel `DASHBOARD_PASSWORD` in** en zet hem achter HTTPS (bijv. Caddy of een Cloudflare Tunnel). Pas `BASE_URL` en de redirect-URL bij je koppeldienst aan.
- Schrijfacties vereisen een custom header (CSRF-bescherming); de pagina heeft een strikte Content-Security-Policy.

## Instellingen (`.env`)

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `3000` | Poort |
| `HOST` | `127.0.0.1` | Luisteradres |
| `BASE_URL` | `http://localhost:PORT` | Publieke URL (voor terugkeer na bank-login) |
| `DATA_DIR` | `./data` | Opslagmap |
| `DASHBOARD_PASSWORD` | — | Wachtwoord voor de dashboard |
| `ENABLE_BANKING_APP_ID` / `ENABLE_BANKING_KEY_PATH` | — | Enable Banking |
| `GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY` | — | GoCardless |

## Ontwikkelen

```bash
npm run dev   # herstart automatisch bij wijzigingen
npm test      # tests voor CSV-parsers, categorisatie en bank-API's (gemockt)
```

Structuur:

```
src/server.js              HTTP-server, API en koppel-flow
src/providers/*.js         Enable Banking & GoCardless
src/csv.js                 CSV-import per bank
src/categorize.js          Categorisatieregels
src/store.js               Opslag (JSON-bestand)
src/demo.js                Demodata
public/                    Dashboard (HTML/CSS/JS, grafieken in SVG)
```
