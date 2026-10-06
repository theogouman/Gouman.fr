// Injecte la maquette Finder de design/finder-public.html dans public/index.html.
//
// design/finder-public.html reste la source de verite : on l'ouvre telle quelle
// dans un navigateur pour travailler le visuel. Ce script en extrait la CSS et
// le markup, scope la CSS sous .finder-win pour qu'elle ne deborde pas sur la
// page d'accueil, et remplace le contenu entre les marqueurs de index.html.
//
// Lance par `npm run prebuild`, mais aussi directement :  node scripts/build-finder.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "design/finder-public.html");
const DEST = resolve(root, "public/index.html");
const SCOPE = ".finder-win";

/* ---------------------------------------------------------------- CSS ----- */

// Index de la premiere occurrence de `ch` hors chaine et hors commentaire.
function findTop(css, ch, from) {
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === ch) {
      return i;
    }
  }
  return -1;
}

// Index de l'accolade fermante correspondant a celle ouverte en `open`.
function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return css.length;
}

// Un selecteur -> zero, un ou plusieurs selecteurs scopes.
function mapSelector(sel, scope) {
  const s = sel.trim();
  if (!s) return [];
  // Purement propre a la page de previsualisation : rien a injecter.
  if (s === "body" || s === "html" || s === ".finder") return [];
  // Les variables de :root deviennent celles de la racine du composant.
  if (s === ":root") return [scope];
  // Le reset universel doit aussi atteindre la racine elle-meme.
  if (s === "*" || s.startsWith("*:")) {
    const tail = s.slice(1);
    return [`${scope}${tail}`, `${scope} *${tail}`];
  }
  return [`${scope} ${s}`];
}

function scopeCss(css, scope) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const brace = findTop(css, "{", i);
    if (brace === -1) {
      out += css.slice(i);
      break;
    }
    const close = matchBrace(css, brace);
    const body = css.slice(brace + 1, close);

    // Les commentaires qui precedent le selecteur le suivent dans la sortie.
    const prelude = css.slice(i, brace);
    const lastComment = prelude.lastIndexOf("*/");
    const lead = lastComment === -1 ? "" : prelude.slice(0, lastComment + 2);
    const selector = lastComment === -1 ? prelude : prelude.slice(lastComment + 2);
    const head = selector.trim();

    if (head.startsWith("@")) {
      // Une requete sur une preference utilisateur traverse la capture sans
      // dommage : elle repond pareil dans le SVG et dans la page.
      if (/prefers-/.test(head)) {
        const inner = scopeCss(body, scope);
        out += inner.trim() ? `${lead}${selector}{${inner}}` : lead;
      } else {
        // En revanche genie.js rasterise la fenetre dans un SVG dont la largeur
        // n'est pas celle du navigateur : une requete sur le viewport y
        // repondrait a la mauvaise question, et la texture ne correspondrait
        // plus a ce qui est affiche. Mieux vaut echouer que mentir.
        throw new Error(
          `build-finder : requete media « ${head} » dans la maquette. ` +
            `La capture de texture ne peut pas la respecter : exprime la ` +
            `variante par une classe posee depuis index.html, et traduis-la ici.`
        );
      }
    } else {
      const mapped = selector.split(",").flatMap((s) => mapSelector(s, scope));
      // On reprend l'indentation d'origine du selecteur, pour que la CSS
      // injectee se relise comme la source.
      const ws = selector.match(/^\s*/)[0] || "\n  ";
      out += mapped.length ? `${lead}${ws}${mapped.join("," + ws)} {${body}}` : lead;
    }
    i = close + 1;
  }
  return out;
}

/* ------------------------------------------------------------- Injection -- */

function between(text, startTag, endTag, what) {
  const a = text.indexOf(startTag);
  const b = text.indexOf(endTag);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`build-finder : ${what} introuvable (${startTag} … ${endTag})`);
  }
  return [a + startTag.length, b];
}

const src = readFileSync(SRC, "utf8");

const [cssA, cssB] = between(src, "<style>", "</style>", "le bloc <style> de la source");
const css = scopeCss(src.slice(cssA, cssB), SCOPE);

const [bodyA, bodyB] = between(src, "<body>", "</body>", "le <body> de la source");
const markup = src
  .slice(bodyA, bodyB)
  .trim()
  .split("\n")
  .map((l) => (l.trim() ? "        " + l : l))
  .join("\n");

let dest = readFileSync(DEST, "utf8");

const slots = [
  ["/* finder:css:start */\n", "    /* finder:css:end */", css + "\n"],
  ["<!-- finder:markup:start -->\n", "      <!-- finder:markup:end -->", markup + "\n"],
];

for (const [startTag, endTag, payload] of slots) {
  const [a, b] = between(dest, startTag, endTag, `le marqueur ${startTag.trim()}`);
  dest = dest.slice(0, a) + payload + dest.slice(b);
}

writeFileSync(DEST, dest);

const kb = (n) => (n / 1024).toFixed(1).replace(".", ",") + " ko";
console.log(
  `build-finder : maquette injectee (${kb(css.length)} de CSS scopee, ${kb(markup.length)} de markup).`
);
