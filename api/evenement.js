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

// Le libelle n'est jamais celui que le navigateur envoie, seulement une cle
// qu'on y retrouve. Sans cela, n'importe qui pourrait ecrire ce qu'il veut
// dans la base en appelant l'adresse a la main.
const EVENEMENTS = {
  site: { titre: "A ouvert le site", url: null },
  whatsapp: { titre: "A ouvert WhatsApp", url: "https://wa.me/33646262610" },
  mail: { titre: "A ouvert le mail", url: "mailto:theo@gouman.fr" },
  linkedin: { titre: "A ouvert LinkedIn", url: "https://www.linkedin.com/in/theogouman/" },
  instagram: { titre: "A ouvert Instagram", url: "https://www.instagram.com/theo.gouman/" },
  youtube: { titre: "A ouvert YouTube", url: "https://youtube.com/@theogouman" },
  formation: { titre: "A ouvert la formation Notion", url: "https://www.consultant-notion.fr" },
  club: { titre: "A ouvert le Notion Club", url: "https://www.notionclub.fr" },
};

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

function texte(valeur) {
  return { rich_text: valeur ? [{ text: { content: String(valeur).slice(0, 2000) } }] : [] };
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

  const ville = entete(req, "x-vercel-ip-city");
  const pays = entete(req, "x-vercel-ip-country");

  try {
    const reponse = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: base },
        properties: {
          "Événement": { title: [{ text: { content: evenement.titre } }] },
          Date: { date: { start: new Date().toISOString() } },
          "Adresse IP": texte(adresse(req)),
          Ville: texte(ville),
          Pays: texte(pays),
          Appareil: { select: { name: appareil(req) } },
          URL: { url: evenement.url },
        },
      }),
    });
    if (!reponse.ok) {
      // On trace dans les journaux Vercel, mais on ne fait jamais echouer la
      // page du visiteur pour un probleme de journalisation.
      console.error("Notion a refuse l'ecriture :", reponse.status, await reponse.text());
    }
  } catch (e) {
    console.error("Notion injoignable :", e && e.message);
  }

  res.status(204).end();
};
