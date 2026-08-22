# Kringloop App

Een webapp om kringloopwinkels bij jou in de buurt te vinden (met openingstijden)
en om een foto van een voorwerp te uploaden voor een indicatie van de actuele
tweedehandswaarde.

## Functionaliteit

- **Kringloopwinkels vinden**: gebruikt je browserlocatie en zoekt via de
  OpenStreetMap Overpass API naar kringloopwinkels/tweedehandswinkels binnen
  15 km, gesorteerd op afstand, met openingstijden en een "nu open/gesloten"
  indicatie.
- **Foto waarderen**: upload een foto van een voorwerp; de server stuurt de
  foto naar Claude (vision) en geeft een indicatieve waarde-range in euro's,
  conditie-inschatting en toelichting terug. Dit is een AI-schatting, geen
  officiële taxatie.

## Projectstructuur

```
client/   Vite + React + TypeScript frontend
server/   Express + TypeScript backend (proxy naar Anthropic API)
```

## Installeren

```bash
cd server && npm install
cd ../client && npm install
```

## Ontwikkelen

Backend (poort 3001):

```bash
cd server
cp .env.example .env   # vul ANTHROPIC_API_KEY in
npm run dev
```

Frontend (poort 5173, proxyt /api naar de backend):

```bash
cd client
npm run dev
```

Open http://localhost:5173.

## Productie build

```bash
cd client && npm run build
cd ../server && npm run build && npm start
```

De server serveert dan zowel de API als de gebouwde frontend (`client/dist`).

## Omgevingsvariabelen (server)

- `ANTHROPIC_API_KEY` — vereist voor foto-waardebepaling. Zonder deze key
  geeft `/api/valuate` een duidelijke foutmelding, maar blijft de
  kringloopwinkel-zoekfunctie gewoon werken (die draait volledig client-side).
- `PORT` — poort voor de server (standaard 3001).

## Beperkingen

- De kringloopwinkel-data komt uit OpenStreetMap; niet elke winkel of elke
  openingstijd staat daar (correct) in.
- De waardebepaling is een AI-inschatting op basis van de foto en is niet
  altijd accuraat, met name bij onduidelijke foto's of onbekende merken.
