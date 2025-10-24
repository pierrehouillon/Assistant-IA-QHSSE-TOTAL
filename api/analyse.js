import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Lecture corps JSON « à la main » (compatible Vercel)
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!ASST_ID) return res.status(500).json({ error: "ASST_ID manquante" });

    const { text, image_url } = await readJson(req);

    if (!image_url || !/^https?:\/\//i.test(image_url)) {
      return res.status(400).json({ error: "Image manquante ou URL invalide (https://... requis)" });
    }
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Texte descriptif manquant" });
    }

    const prompt = `
Tu es un assistant QHSE expert en sécurité sur chantier.
Analyse la situation suivante à partir de la photo et du texte fourni :
- Texte : "${text}"

Réponds en 4 rubriques claires (sans bloc "source") :
1) Risques ou dangers identifiés
2) EPI à porter
3) Documents et vérifications préalables
4) Bonnes pratiques de sécurité
`;

    // 1) thread avec texte + image_url
    const thread = await client.beta.threads.create({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url }
          ]
        }
      ]
    });

    // 2) run assistant
    let run = await client.beta.threads.runs.create(thread.id, { assistant_id: ASST_ID });

    // 3) polling simple
    const start = Date.now();
    while (run.status !== "completed") {
      if (["failed", "cancelled", "expired"].includes(run.status)) {
        throw new Error(`Run ${run.status}`);
      }
      if (Date.now() - start > 30000) throw new Error("Timeout");
      await new Promise(r => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // 4) récupérer la réponse
    const msgs = await client.beta.threads.messages.list(thread.id, { order: "desc", limit: 1 });
    const last = msgs.data[0];
    const answer = (last?.content?.[0]?.type === "text")
      ? last.content[0].text.value
      : "Aucune réponse.";

    return res.status(200).json({ resultat: answer });
  } catch (e) {
    console.error("analyse:", e?.response?.data || e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
