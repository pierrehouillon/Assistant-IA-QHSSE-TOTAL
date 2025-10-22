import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: "Question manquante" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!VECTOR_STORE_ID) return res.status(500).json({ error: "VECTOR_STORE_ID manquante" });

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "file_search" }],  // on déclare l’outil
      input: [
        {
          role: "system",
          content:
            "Tu es un assistant QHSSE. Réponds uniquement à partir du document QHSSE TOTAL indexé. " +
            "Si l’information n’est pas présente, réponds : « Non précisé dans le document QHSSE TOTAL. » " +
            "Réponds toujours en français."
        },
        {
          role: "user",
          content: question,
          // 🔹 ICI on attache le vector store pour file_search
          attachments: [
            {
              tools: [{ type: "file_search" }],
              vector_store_id: VECTOR_STORE_ID
            }
          ]
        }
      ],
      max_output_tokens: 500
    });

    const answer = (response.output_text || "").trim();
    res.status(200).json({ answer: answer || "Non précisé dans le document QHSSE TOTAL." });
  } catch (e) {
    console.error("Erreur API:", e?.response?.data || e);
    res.status(500).json({ error: e?.message || "Erreur interne lors de l'appel à l'API OpenAI" });
  }
}
