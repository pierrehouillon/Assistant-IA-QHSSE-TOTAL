import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Lecture JSON compatible Vercel
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

// Télécharge une image en Buffer depuis une URL https://
async function downloadImageAsBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Téléchargement image échoué (${r.status})`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!ASST_ID) return res.status(500).json({ error: "ASST_ID manquante" });

    const { text, image_url } = await readJson(req);

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Texte descriptif manquant" });
    }
    if (!image_url || !/^https?:\/\//i.test(image_url)) {
      return res.status(400).json({ error: "Image manquante ou URL invalide (https://... requis)" });
    }

    // 1) Télécharger l'image et l'uploader chez OpenAI
    const imgBuf = await downloadImageAsBuffer(image_url);
    const file = await client.files.create({
      file: new File([imgBuf], "photo.jpg", { type: "image/jpeg" }),
      // Pour Assistants avec vision, le purpose approprié est "vision"
      purpose: "vision"
    });

    // 2) Créer un thread avec texte + image_file (PAS image_url)
    const prompt = `
Tu es un assistant QHSE expert en sécurité sur chantier.
Analyse la situation suivante à partir de la photo et du texte fourni :
- Texte : "${text}"

Réponds en 4 rubriques claires (sans bloc "source") :
1) Risques ou dangers identifiés
2) EPI à porter
3) Documents et vérifications préalables
4) Bonnes pratiques de sécurité
`.trim();

    const thread = await client.beta.threads.create({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_file", image_file: { file_id: file.id } }
          ]
        }
      ]
    });

    // 3) Lancer le run et attendre la fin
    let run = await client.beta.threads.runs.create(thread.id, { assistant_id: ASST_ID });

    const start = Date.now();
    while (run.status !== "completed") {
      if (["failed", "cancelled", "expired"].includes(run.status)) {
        throw new Error(`Run ${run.status}`);
      }
      if (Date.now() - start > 30000) throw new Error("Timeout");
      await new Promise(r => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // 4) Récupérer la réponse
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
