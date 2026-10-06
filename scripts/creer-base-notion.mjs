// Cree la base Notion qui recoit le journal du site, avec exactement les
// proprietes qu'attend api/evenement.js.
//
// A lancer une seule fois, depuis n'importe quel workspace Notion - il suffit
// d'un jeton qui y a acces, aucun connecteur n'est necessaire :
//
//   1. Notion > Reglages > Connexions > Developper ou gerer les integrations
//      > Nouvelle integration, dans le workspace voulu. Copier le jeton.
//   2. Ouvrir la page qui doit accueillir la base, menu ..., Connexions,
//      ajouter l'integration. Copier l'identifiant de la page : c'est la
//      suite de 32 caracteres a la fin de son adresse.
//   3. NOTION_TOKEN=ntn_xxx PAGE=xxx node scripts/creer-base-notion.mjs
//
// Le script affiche l'identifiant de la base : c'est la valeur a poser dans
// la variable Vercel NOTION_DB_EVENEMENTS.

import { createRequire } from "node:module";
const { PROPRIETES, TITRE_BASE, VERSION_API } = createRequire(import.meta.url)("../api/schema.js");

const jeton = process.env.NOTION_TOKEN;
const page = (process.env.PAGE || "").trim().replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];

if (!jeton || !page) {
  console.error(
    "Il manque quelque chose.\n\n" +
      "  NOTION_TOKEN  le jeton de l'integration Notion\n" +
      "  PAGE          l'adresse ou l'identifiant de la page qui accueille la base\n\n" +
      "  NOTION_TOKEN=ntn_xxx PAGE=https://www.notion.so/... node scripts/creer-base-notion.mjs"
  );
  process.exit(1);
}

const reponse = await fetch("https://api.notion.com/v1/databases", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${jeton}`,
    "Notion-Version": VERSION_API,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    parent: { type: "page_id", page_id: page },
    title: [{ type: "text", text: { content: TITRE_BASE } }],
    properties: PROPRIETES,
  }),
});

const corps = await reponse.json();

if (!reponse.ok) {
  console.error(`\nNotion a refuse (${reponse.status}) : ${corps.message || JSON.stringify(corps)}`);
  if (corps.code === "object_not_found") {
    console.error(
      "\nCette erreur veut presque toujours dire la meme chose : la page existe,\n" +
        "mais l'integration n'y a pas ete ajoutee. Page > menu ... > Connexions."
    );
  }
  process.exit(1);
}

console.log(`\nBase creee : ${corps.url}\n`);
console.log("A poser dans les variables d'environnement Vercel :");
console.log(`  NOTION_DB_EVENEMENTS = ${corps.id.replace(/-/g, "")}`);
console.log(`  NOTION_TOKEN         = le jeton utilise ici\n`);
console.log("Puis redeployer, pour que les variables soient prises en compte.");
