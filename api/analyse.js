import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // On gère manuellement pour accepter form-data
  },
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID; // ton assistant doit être entraîné avec ton Manuel STR 2025

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!ASST_ID)
      return res.status(500).json({ error: "ASST_ID manquante" });

    let text = "";
    let imageUrl = null;

    // Si c’est du form-data (upload direct)
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      const { fields, files } = await parseMultipart(req);
      text = fields.text?.[0] || "";
      if (files.image?.[0]?.filepath) {
        // Conversion temporaire en base64 (pour test)
        const data = fs.readFileSync(files.image[0].filepath);
        imageUrl = `data:image/jpeg;base64,${data.toString("base64")}`;
      }
    } else {
      // Si c’est du JSON
      const body = await new Promise((resolve) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          try {
            resolve(JSON.parse(raw || "{}"));
          } catch {
            resolve({});
          }
        });
      });
      text = body.text || "";
      imageUrl = body.image_url || null;
    }

    if (!imageUrl || !imageUrl.startsWith("http"))
      return res
        .status(400)
        .json({ error: "Image manquante ou URL invalide (https://... requis)" });

    if (!text)
      return res.status(400).json({ error: "Texte descriptif manquant" });

    // Création du message pour analyse
    const prompt = `
Tu es un assistant QHSE expert en sécurité sur chantier.
Analyse la situation suivante à partir de la photo et du texte fourni :
- Texte : "${text}"

Détaille ta réponse en 4 rubriques :
1️⃣ Risques ou dangers identifiés
2️⃣ EPI à porter
3️⃣ Documents et vérifications préalables
4️⃣ Bonnes pratiques de sécurité
    `;

    // Création d’un thread
    const thread = await client.beta.threads.create({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: imageUrl },
          ],
        },
      ],
    });

    // Lancer le run sur l’assistant
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASST_ID,
    });

    // Attente du résultat
    const start = Date.now();
    while (run.status !== "completed") {
      if (["failed", "cancelled", "expired"].includes(run.status))
        throw new Error(`Run ${run.status}`);
      if (Date.now() - start > 30000) throw new Error("Timeout");
      await new Promise((r) => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Lecture du message final
    const msgs = await client.beta.threads.messages.list(thread.id, {
      order: "desc",
      limit: 1,
    });
    const last = msgs.data[0];
    const answer =
      last?.content?.[0]?.type === "text"
        ? last.content[0].text.value
        : "Aucune réponse.";

    res.status(200).json({ resultat: answer });
  } catch (e) {
    console.error("Erreur analyse:", e);
    res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
