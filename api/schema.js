// Le schema de la base Notion, en un seul endroit.
//
// api/evenement.js s'en sert pour ecrire, scripts/creer-base-notion.mjs pour
// creer la base. Les deux lisent donc exactement les memes noms de proprietes :
// ils ne peuvent pas diverger, et une base creee par le script est forcement
// compatible avec la fonction qui l'alimente.

// Le libelle n'est jamais celui que le navigateur envoie, seulement une cle
// qu'on y retrouve. Sans cela, n'importe qui pourrait ecrire ce qu'il veut dans
// la base en appelant l'adresse a la main.
const EVENEMENTS = {
  site: { titre: "A ouvert le site", url: null },
  dossier: { titre: "A ouvert le dossier", url: null },
  whatsapp: { titre: "A ouvert WhatsApp", url: "https://wa.me/33646262610" },
  mail: { titre: "A ouvert le mail", url: "mailto:theo@gouman.fr" },
  linkedin: { titre: "A ouvert LinkedIn", url: "https://www.linkedin.com/in/theogouman/" },
  instagram: { titre: "A ouvert Instagram", url: "https://www.instagram.com/theo.gouman/" },
  youtube: { titre: "A ouvert YouTube", url: "https://youtube.com/@theogouman" },
  formation: { titre: "A ouvert la formation Notion", url: "https://www.consultant-notion.fr" },
  club: { titre: "A ouvert le Notion Club", url: "https://www.notionclub.fr" },
};

const TITRE_BASE = "Journal du site gouman.fr";

// Les noms sont ceux qui apparaitront dans Notion, accents compris.
const PROPRIETES = {
  "Événement": { title: {} },
  "Date": { date: {} },
  "Adresse IP": { rich_text: {} },
  "Ville": { rich_text: {} },
  // Pays est une selection : les codes ISO sont peu nombreux et se pretent aux
  // etiquettes colorees. Notion cree l'option toute seule a la premiere visite
  // depuis un pays inconnu.
  "Pays": { select: { options: [] } },
  "Appareil": {
    select: {
      options: [
        { name: "Mobile", color: "orange" },
        { name: "Desktop", color: "blue" },
      ],
    },
  },
  "URL": { url: {} },
};

const VERSION_API = "2022-06-28";

module.exports = { EVENEMENTS, PROPRIETES, TITRE_BASE, VERSION_API };
