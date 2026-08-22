import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "..", "..", "client", "dist");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

app.post("/api/valuate", upload.single("photo"), async (req, res) => {
  if (!anthropic) {
    res.status(503).json({
      error:
        "Waardebepaling is niet geconfigureerd. Zet ANTHROPIC_API_KEY in de server-omgeving.",
    });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Geen foto ontvangen." });
    return;
  }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    res.status(400).json({ error: "Alleen JPEG, PNG of WebP foto's worden ondersteund." });
    return;
  }

  try {
    const base64 = file.buffer.toString("base64");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: file.mimetype as "image/jpeg" | "image/png" | "image/webp",
                data: base64,
              },
            },
            {
              type: "text",
              text: `Je bent een expert in tweedehands spullen en kringloopwinkels in Nederland. Kijk naar deze foto van een voorwerp dat iemand mogelijk naar een kringloopwinkel wil brengen of tweedehands wil verkopen.

Geef een inschatting van de actuele tweedehandswaarde in euro's, gebaseerd op wat vergelijkbare spullen typisch opbrengen op platforms als Marktplaats of in Nederlandse kringloopwinkels. Wees realistisch en voorzichtig: als je het object niet goed kunt herkennen of de staat niet kunt beoordelen, geef dat aan.

Antwoord UITSLUITEND met geldige JSON in exact dit formaat, zonder markdown-codeblok eromheen:
{
  "item": "korte omschrijving van het object",
  "conditie": "inschatting van de staat (bv. nieuwstaat, goed, gebruikssporen, slecht) of 'onbekend'",
  "waarde_min": <getal in euro's>,
  "waarde_max": <getal in euro's>,
  "toelichting": "1-3 zinnen uitleg over de inschatting",
  "zekerheid": "laag" | "gemiddeld" | "hoog"
}`,
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(502).json({ error: "Onverwacht antwoord van het waarderingsmodel." });
      return;
    }

    let parsed: unknown;
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock.text);
    } catch {
      res.status(502).json({ error: "Kon de waardebepaling niet verwerken." });
      return;
    }

    res.json({ result: parsed });
  } catch (err) {
    console.error("Valuation error:", err);
    res.status(500).json({ error: "Er ging iets mis bij het waarderen van de foto." });
  }
});

app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Kringloop-server draait op http://localhost:${port}`);
});
