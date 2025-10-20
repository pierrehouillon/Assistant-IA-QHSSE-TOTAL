import OpenAI from "openai";
import fs from "fs";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY manquante. Lance:  OPENAI_API_KEY=sk-... node upload.mjs");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  try {
    console.log("⏳ Création du Vector Store…");
    const vs = await client.vectorStores.create({ name: "QHSSE_TOTAL" });

    console.log("⏳ Téléversement du PDF…");
    const file = await client.files.create({
      file: fs.createReadStream("./document_QHSSE.pdf"),
      purpose: "assistants"
    });

    console.log("⏳ Attachement du PDF au Vector Store…");
    await client.vectorStores.files.create(vs.id, { file_id: file.id });

    console.log("\n✅ VECTOR_STORE_ID =", vs.id);
    console.log("➡️ Copie cette valeur dans les variables d'environnement Vercel.");
  } catch (e) {
    console.error("❌ Erreur:", e.message);
  }
})();
