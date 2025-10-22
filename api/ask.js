import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;

// CORS basique
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");           // ou ton domaine Glide si tu veux restreindre
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
      // ⚠️ Le schéma 'input' doit être une liste de messages avec des "content parts"
      input: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text:
                "Tu es un assistant QHSSE. Réponds uniquement à partir du document QHSSE TOTAL. " +
                'Si la réponse n’est pas dans le document, dis : "Non précisé dans le document QHSSE TOTAL." ' +
                "Réponds en français, de manière claire et concise.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: question }],
        },
      ],

      // On active l’outil de recherche
      tools: [{ type: "file_search" }],
      tool_choice: "auto",

      // ✅ C'est ICI qu'on branche le Vector Store
      tool_resources: {
        file_search: { vector_store_ids: [VECTOR_STORE_ID] },
      },

      max_output_tokens: 400,
    });

    const answer = response.output_text?.trim() || "Aucune réponse.";
    return res.status(200).json({ answer });
  } catch (e) {
    // renvoyer l'erreur brute aide au debug dans l'onglet Network
    return res.status(500).json({
      error: e?.message || "Erreur serveur",
      raw: e?.response?.data || null,
    });
  }
}
