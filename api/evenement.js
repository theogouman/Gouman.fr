// Journal des evenements du site, ecrit dans une base Notion.
//
// Le navigateur appelle cette fonction a l'ouverture de la page et a chaque
// lien suivi. Elle y ajoute ce que seul le serveur peut savoir - l'adresse IP,
// la ville, l'appareil - puis cree une ligne dans la base.
//
// Deux variables d'environnement sont attendues cote Vercel :
//   NOTION_TOKEN          jeton d'une integration interne Notion, partagee
//                         avec la base (secret, jamais cote navigateur)
//   NOTION_DB_EVENEMENTS  identifiant de la base
//
// Sans elles, la fonction repond 204 sans rien ecrire : le site continue de
// fonctionner normalement, il ne se passe simplement rien.

const { EVENEMENTS, PROPRIETES, VERSION_API } = require("./schema.js");

// Le type de chaque propriete tel qu'on l'a creee. Il ne sert que de repli :
// c'est le schema reel de la base qui fait foi, voir typesDeLaBase().
const TYPES_PAR_DEFAUT = Object.fromEntries(
  Object.entries(PROPRIETES).map(([nom, definition]) => [nom, Object.keys(definition)[0]])
);

function corpsJson(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (e) {
    return {};
  }
}

// Vercel pose les en-tetes de geolocalisation lui-meme ; elles sont encodees
// pour supporter les accents (Rouen, Montreal...).
function entete(req, nom) {
  const brut = req.headers[nom];
  if (!brut) return "";
  try {
    return decodeURIComponent(brut);
  } catch (e) {
    return brut;
  }
}

function adresse(req) {
  // x-forwarded-for accumule les relais : le visiteur est le premier.
  const chaine = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "";
  return String(chaine).split(",")[0].trim();
}

// L'appareil se lit cote serveur : une valeur venue du navigateur serait
// declarative, donc peu sure.
function appareil(req) {
  const mobile = req.headers["sec-ch-ua-mobile"];
  if (mobile === "?1") return "Mobile";
  if (mobile === "?0") return "Desktop";
  const ua = String(req.headers["user-agent"] || "");
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua) ? "Mobile" : "Desktop";
}

function entetes(jeton) {
  return {
    Authorization: `Bearer ${jeton}`,
    "Notion-Version": VERSION_API,
    "Content-Type": "application/json",
  };
}

// Le schema reel de la base, relu une fois par instance.
//
// C'est le coeur de l'affaire : la base vit dans Notion, ou ses colonnes se
// changent d'un clic. Ecrire en supposant leurs types, c'est accepter qu'une
// retouche faite la-bas casse l'ecriture ici - et en silence, puisque seul le
// journal de Vercel le dirait. On demande donc a Notion ce qu'elle attend.
let schemaConnu = null;

async function typesDeLaBase(jeton, base) {
  if (schemaConnu) return schemaConnu;
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${base}`, {
      headers: entetes(jeton),
    });
    if (!r.ok) return null;
    const d = await r.json();
    schemaConnu = Object.fromEntries(
      Object.entries(d.properties || {}).map(([nom, p]) => [nom, p.type])
    );
    return schemaConnu;
  } catch (e) {
    return null;
  }
}

function valeur(type, brut) {
  const vide = brut === null || brut === undefined || brut === "";
  switch (type) {
    case "title":
      return { title: vide ? [] : [{ text: { content: String(brut).slice(0, 2000) } }] };
    case "select":
      return { select: vide ? null : { name: String(brut).slice(0, 100) } };
    case "multi_select":
      return { multi_select: vide ? [] : [{ name: String(brut).slice(0, 100) }] };
    case "status":
      return { status: vide ? null : { name: String(brut).slice(0, 100) } };
    case "url":
      return { url: vide ? null : String(brut) };
    case "date":
      return { date: vide ? null : { start: String(brut) } };
    case "number":
      return { number: vide ? null : Number(brut) };
    default:
      return { rich_text: vide ? [] : [{ text: { content: String(brut).slice(0, 2000) } }] };
  }
}

function proprietes(valeurs, types) {
  const sortie = {};
  // Le titre se reconnait a son type, pas a son nom : renommer la colonne dans
  // Notion ne doit pas suffire a perdre le libelle.
  const nomDuTitre = types
    ? Object.keys(types).find((n) => types[n] === "title")
    : "Événement";

  for (const [nom, brut] of Object.entries(valeurs)) {
    const estLeTitre = TYPES_PAR_DEFAUT[nom] === "title";
    const cible = estLeTitre ? nomDuTitre || nom : nom;
    // Une colonne absente de la base est passee sous silence : mieux vaut une
    // ligne incomplete qu'aucune ligne.
    if (types && !(cible in types)) continue;
    sortie[cible] = valeur(types ? types[cible] : TYPES_PAR_DEFAUT[nom], brut);
  }
  return sortie;
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end();
    return;
  }

  const evenement = EVENEMENTS[corpsJson(req).evenement];
  if (!evenement) {
    res.status(400).end();
    return;
  }

  const jeton = process.env.NOTION_TOKEN;
  const base = process.env.NOTION_DB_EVENEMENTS;
  if (!jeton || !base) {
    res.status(204).end();
    return;
  }

  const valeurs = {
    "Événement": evenement.titre,
    "Date": new Date().toISOString(),
    "Adresse IP": adresse(req),
    "Ville": entete(req, "x-vercel-ip-city"),
    "Pays": entete(req, "x-vercel-ip-country"),
    "Appareil": appareil(req),
    "URL": evenement.url,
  };

  try {
    const types = await typesDeLaBase(jeton, base);
    const reponse = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: entetes(jeton),
      body: JSON.stringify({
        parent: { database_id: base },
        properties: proprietes(valeurs, types),
      }),
    });
    if (!reponse.ok) {
      // Le schema a peut-etre change depuis la derniere lecture : on l'oublie,
      // la prochaine visite le relira.
      schemaConnu = null;
      console.error("Notion a refuse l'ecriture :", reponse.status, await reponse.text());
    }
  } catch (e) {
    console.error("Notion injoignable :", e && e.message);
  }

  res.status(204).end();
};
