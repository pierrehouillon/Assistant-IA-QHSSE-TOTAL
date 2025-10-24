import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID; // ton assistant relié au Manuel STR 2025

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function cleanText(t = "") {
  return t
    .replace(/\[source[^\]]*\]/gi, "")
    .replace(/\(source[^\)]*\)/gi, "")
    .replace(/^\s*sources?\s*:\s*.*$/gim, "")
    .replace(/(\s|^)\[\d+\](?=\s|$)/g, " ")
    .replace(/【\d+[^】]*】/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function tryExtractJSON(s = "") {
  if (!s) return null;
  const match = s.match(/\{[\s\S]*\}$/m) || s.match(/\{[\s\S]*\}/m);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!ASST_ID) return res.status(500).json({ error: "ASST_ID manquante" });

    const { imageUrl, commentaire } = await readJsonBody(req);
    if (!imageUrl || typeof imageUrl !== "string" || !/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({ error: "Image manquante ou URL invalide (https://... requis)" });
    }

    const userParts = [
      {
        type: "text",
        text: `
Tu es un assistant QHSSE TotalEnergies.
Analyse SANS JAMAIS INVENTER, EXCLUSIVEMENT à partir du Manuel "Sécurité Travaux Réseau 2025".
Rends UNIQUEMENT un JSON strict (pas de prose autour) avec les clés suivantes :

{
  "risks": ["…"],
  "epi": ["…"],
  "checks": ["…"],
  "practices": ["…"],
  "notes": "…"
}

Règles :
- Réponds en FRANÇAIS.
- Si une info n'est pas couverte par le Manuel STR 2025, mets "Non précisé dans le Manuel STR 2025.".
- Sois concis et opérationnel (phrases brèves).
        `.trim()
      },
      ...(commentaire ? [{ type: "text", text: `Contexte utilisateur : ${commentaire}` }] : []),
      { type: "image_url", image_url: imageUrl }
    ];

    const thread = await client.beta.threads.create({
      messages: [{ role: "user", content: userParts }]
    });

    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASST_ID
    });

    if (run.status !== "completed") {
      return res.status(200).json({ error: `Analyse incomplète (${run.status})` });
    }

    const msgs = await client.beta.threads.messages.list(thread.id, { order: "desc", limit: 1 });
    const last = msgs.data?.[0];
    const raw = last?.content?.map(c => (c.type === "text" ? c.text.value : "")).join("\n").trim() || "";
    const cleaned = cleanText(raw);
    const structured = tryExtractJSON(cleaned);

    if (!structured) {
      return res.status(200).json({ result: cleaned || "Non précisé dans le Manuel STR 2025." });
    }

    const norm = (v) => Array.isArray(v) ? v : (v ? [String(v)] : []);
    const out = {
      risks: norm(structured.risks),
      epi: norm(structured.epi),
      checks: norm(structured.checks),
      practices: norm(structured.practices),
      notes: structured.notes ? String(structured.notes) : ""
    };

    return res.status(200).json({ structured: out });
  } catch (e) {
    console.error("analyse:", e?.response?.data || e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
