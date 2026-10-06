// Cree la base Notion qui recoit le journal du site, avec exactement les
// proprietes qu'attend api/evenement.js.
//
// A lancer une seule fois, depuis n'importe quel workspace Notion. Aucun
// connecteur n'est necessaire, un jeton d'integration suffit :
//
//   1. Dans Notion, creer une page vide la ou la base doit vivre. Une page
//      privee convient : une integration ne voit que ce qu'on lui partage,
//      et l'API ne permet a personne de creer a la racine du workspace. Cette
//      page est donc le point d'entree, et le seul.
//   2. Reglages > Connexions > Developper ou gerer les integrations >
//      Nouvelle integration. Copier le jeton.
//   3. Sur la page, menu ... > Connexions > ajouter l'integration.
//   4. NOTION_TOKEN=ntn_xxx node scripts/creer-base-notion.mjs
//
// Pas d'adresse a copier : le script demande a Notion ce que le jeton voit.
// S'il ne voit qu'une page, c'est celle-la. S'il en voit plusieurs, il les
// affiche et on choisit avec PAGE=...

import { createRequire } from "node:module";
const { PROPRIETES, TITRE_BASE, VERSION_API } =
  createRequire(import.meta.url)("../api/schema.js");

const jeton = process.env.NOTION_TOKEN;
if (!jeton) {
  console.error(
    "\nIl manque le jeton.\n\n" +
      "  NOTION_TOKEN=ntn_xxx node scripts/creer-base-notion.mjs\n"
  );
  process.exit(1);
}

async function notion(chemin, corps) {
  const r = await fetch(`https://api.notion.com/v1/${chemin}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jeton}`,
      "Notion-Version": VERSION_API,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corps),
  });
  const json = await r.json();
  if (!r.ok) {
    const e = new Error(json.message || JSON.stringify(json));
    e.code = json.code;
    e.statut = r.status;
    throw e;
  }
  return json;
}

function titreDe(page) {
  const prop = Object.values(page.properties || {}).find((p) => p.type === "title");
  const texte = (prop?.title || []).map((t) => t.plain_text).join("").trim();
  return texte || "(sans titre)";
}

// L'identifiant est les 32 derniers caracteres du dernier segment, pas les 32
// premiers qu'on y trouve : dans .../db-3f1bad05...331e, le prefixe « db » du
// slug est lui-meme hexadecimal et serait avale par une recherche naive.
function idDePage(brut) {
  const sansQuery = String(brut || "").trim().split(/[?#]/)[0].replace(/\/+$/, "");
  const segment = sansQuery.split("/").pop().replace(/-/g, "");
  return segment.match(/[0-9a-f]{32}$/i)?.[0] || null;
}

let page = idDePage(process.env.PAGE);

if (!page) {
  // On demande a Notion ce que ce jeton voit : inutile de copier une adresse.
  const vues = await notion("search", {
    filter: { value: "page", property: "object" },
    page_size: 50,
  });
  const pages = (vues.results || []).filter((p) => p.object === "page" && !p.archived);

  if (pages.length === 0) {
    console.error(
      "\nL'integration ne voit aucune page.\n\n" +
        "C'est l'etape qui manque presque toujours : ouvrir la page dans Notion,\n" +
        "menu ... en haut a droite, Connexions, et y ajouter l'integration.\n"
    );
    process.exit(1);
  }

  if (pages.length > 1) {
    console.error("\nL'integration voit plusieurs pages. Choisis celle qui accueille la base :\n");
    for (const p of pages) {
      console.error(`  PAGE=${p.id.replace(/-/g, "")}   ${titreDe(p)}`);
    }
    console.error("\n  NOTION_TOKEN=ntn_xxx PAGE=... node scripts/creer-base-notion.mjs\n");
    process.exit(1);
  }

  page = pages[0].id;
  console.log(`\nPage trouvee : ${titreDe(pages[0])}`);
}

let base;
try {
  base = await notion("databases", {
    parent: { type: "page_id", page_id: page },
    title: [{ type: "text", text: { content: TITRE_BASE } }],
    properties: PROPRIETES,
  });
} catch (e) {
  console.error(`\nNotion a refuse (${e.statut}) : ${e.message}`);
  if (e.code === "object_not_found") {
    console.error(
      "\nCette erreur veut presque toujours dire la meme chose : la page existe,\n" +
        "mais l'integration n'y a pas ete ajoutee. Page > menu ... > Connexions.\n"
    );
  }
  process.exit(1);
}

console.log(`\nBase creee : ${base.url}\n`);
console.log("A poser dans les variables d'environnement Vercel :\n");
console.log(`  NOTION_DB_EVENEMENTS = ${base.id.replace(/-/g, "")}`);
console.log(`  NOTION_TOKEN         = le jeton utilise ici\n`);
console.log("Puis redeployer, pour que les variables soient prises en compte.\n");
