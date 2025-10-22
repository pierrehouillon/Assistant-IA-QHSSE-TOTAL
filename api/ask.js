import OpenAI from "openai";

// CORS simple
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!ASST_ID) return res.status(500).json({ error: "ASST_ID manquante" });

    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: "Question manquante" });

    // 1) Créer un thread avec le message de l’utilisateur
    const thread = await client.beta.threads.create({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question }
          ]
        }
      ]
    });

    // 2) Lancer un run sur l’assistant
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASST_ID
    });

    // 3) Polling jusqu’à "completed" (timeout simple)
    const started = Date.now();
    while (run.status !== "completed") {
      if (["failed", "cancelled", "expired"].includes(run.status)) {
        throw new Error(`Run ${run.status}`);
      }
      if (Date.now() - started > 30000) { // 30s
        throw new Error("Timeout de génération");
      }
      await new Promise(r => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // 4) Récupérer la dernière réponse de l’assistant
    const msgs = await client.beta.threads.messages.list(thread.id, { order: "desc", limit: 1 });
    const last = msgs.data[0];
    const text = last?.content?.[0]?.type === "text" ? last.content[0].text.value : null;

    res.status(200).json({ answer: text || "Aucune réponse." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
