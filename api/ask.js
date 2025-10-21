import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;

// Fonction handler principale
export default async function handler(req, res) {
  // Autoriser les appels depuis ton site (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question manquante" });
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "Clé OpenAI manquante" });
    if (!VECTOR_STORE_ID)
      return res.status(500).json({ error: "VECTOR_STORE_ID manquant" });

    // 🔧 Nouvelle syntaxe correcte (OpenAI v4)
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "Tu es un assistant QHSSE. Réponds uniquement avec les informations issues du document QHSSE TOTAL. " +
            "Si l’information n’est pas trouvée, réponds exactement : 'Non précisé dans le document QHSSE TOTAL.'",
        },
        { role: "user", content: question },
      ],
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: [VECTOR_STORE_ID],
        },
      },
      max_output_tokens: 400,
    });

    // ✅ La réponse finale
    const answer = response.output_text?.trim() || "Non précisé dans le document QHSSE TOTAL.";
    res.status(200).json({ answer });
  } catch (error) {
    console.error("Erreur /api/ask:", error);
    res.status(500).json({
      error: error?.message || "Erreur inconnue côté serveur",
      details: error,
    });
  }
}
