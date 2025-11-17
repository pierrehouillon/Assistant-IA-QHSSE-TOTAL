import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID;

// CORS simple
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Lecture JSON compatible Vercel
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

// Nettoyage des citations / sources parasites
function cleanAnswer(text = "") {
  return (
    text
      .replace(/\[source[^\]]*\]/gi, "")
      .replace(/\(source[^\)]*\)/gi, "")
      .replace(/^\s*sources?\s*:\s*.*$/gim, "")
      .replace(/(\s|^)\[\d+\](?=\s|$)/g, " ")
      .replace(/【\d+[^】]*】/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

// 🔍 extrait "X m de long" + "Y m de haut" dans un texte
function extractLengthHeight(text = "") {
  const lower = text.toLowerCase();

  const hasLong = lower.includes("long") || lower.includes("longueur");
  const hasHaut = lower.includes("haut") || lower.includes("hauteur");
  if (!hasLong || !hasHaut) return null;

  // on récupère toutes les valeurs en mètres : "5 m", "6,5 m"...
  const regex = /(\d+(?:[.,]\d+)?)\s*m\b/g;
  const matches = [...lower.matchAll(regex)];
  if (matches.length < 2) return null;

  const L = parseFloat(matches[0][1].replace(",", "."));
  const H = parseFloat(matches[1][1].replace(",", "."));
  if (isNaN(L) || isNaN(H)) return null;

  return { L, H };
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

    const { question, threadId: incomingThreadId } = await readJsonBody(req);
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Question manquante" });
    }

    let threadId = incomingThreadId || null;
    let questionToSend = question;

    // 🟦 Si NOUVEAU chantier et que la phrase contient déjà longueur + hauteur
    if (!threadId) {
      const dims = extractLengthHeight(question);
      if (dims) {
        const { L, H } = dims;
        questionToSend = `
L'utilisateur commence un NOUVEAU chantier d'échafaudage ALTRAD METRIX.

Les dimensions de base sont déjà DÉFINIES et NE DOIVENT JAMAIS être redemandées :
- Type : échafaudage droit de façade.
- Longueur : ${L} m.
- Hauteur : ${H} m.

Tu dois considérer ces valeurs comme officielles du début à la fin
et NE PAS reposer de question du type "donne-moi la longueur et la hauteur".

Ensuite, applique tes règles normales :
- tu poses la question sécurité "Souhaites-tu protéger la façade côté mur ? (⚠ obligatoire si espace > 20 cm)",
- puis la question sur le grutage,
- puis tu calcules la liste de matériel complète (avec tableau, poids, rappel sécurité, phrase Peduzzi, etc.).

Pour info, voici la formulation exacte de l'utilisateur :
"${question}"
        `.trim();
      }
    }

    // 1) Créer un thread si besoin
    if (!threadId) {
      const created = await client.beta.threads.create();
      threadId = created.id;
    }

    // 2) Ajouter le message user au thread
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: questionToSend,
    });

    // 3) Lancer le run et attendre la fin
    const run = await client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASST_ID,
    });

    if (run.status !== "completed") {
      return res.status(200).json({
        answer: `La réponse n'est pas complète (état du run : ${run.status}).`,
        threadId,
      });
    }

    // 4) Récupérer la dernière réponse assistant
    const msgs = await client.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 5,
    });
    const assistantMsg = msgs.data.find((m) => m.role === "assistant");
    const rawAnswer =
      assistantMsg?.content
        ?.map((c) => (c.type === "text" ? c.text.value : ""))
        .join("\n")
        .trim() || "Pas de réponse.";

    const answer = cleanAnswer(rawAnswer);

    return res.status(200).json({ answer, threadId });
  } catch (e) {
    console.error("ask echafaudage:", e?.response?.data || e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
