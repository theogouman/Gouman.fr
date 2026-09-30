// Fait échouer le build si une route de premier niveau entre en collision
// avec un ancien slug Taap.it redirigé vers hi.gouman.fr (voir vercel.json).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, parse } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHORTLINK_HOST = "https://hi.gouman.fr/";

const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

// 1. Slugs réservés, lus depuis la règle de redirection elle-même.
const rule = (vercel.redirects ?? []).find((r) => r.destination?.startsWith(SHORTLINK_HOST));
if (!rule) fail("Règle de redirection vers hi.gouman.fr introuvable dans vercel.json. Elle ne doit jamais être supprimée.");
const match = rule.source.match(/^\/:slug\((.+)\)$/);
if (!match) fail(`Format inattendu pour le source de la règle hi.gouman.fr : ${rule.source}`);
const reserved = new Map(match[1].split("|").map((s) => [s.toLowerCase(), s]));

// 2. Routes de premier niveau du projet.
const routes = new Map(); // nom de route -> origine
const IGNORED = new Set(["node_modules", "scripts", "package.json", "package-lock.json", "vercel.json", "CLAUDE.md", "README.md"]);

function entries(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs).filter((n) => !n.startsWith("."));
}

function add(name, origin) {
  if (!name || name.startsWith("[") || name.startsWith("_") || name.startsWith("@")) return;
  routes.set(name, origin);
}

// Fichiers statiques servis à la racine (site sans framework) et dans public/.
for (const dir of [".", "public"]) {
  for (const n of entries(dir)) {
    if (dir === "." && (IGNORED.has(n) || ["app", "pages", "src", "public"].includes(n))) continue;
    add(parse(n).name, join(dir, n));
  }
}

// Next.js : pages/ et app/ (les groupes de routes "(xxx)" ne créent pas de segment).
function walkApp(dir) {
  for (const n of entries(dir)) {
    const abs = join(ROOT, dir, n);
    if (!statSync(abs).isDirectory()) continue;
    if (n.startsWith("(") && n.endsWith(")")) walkApp(join(dir, n));
    else add(n, join(dir, n));
  }
}
for (const base of [".", "src"]) {
  walkApp(join(base, "app"));
  for (const n of entries(join(base, "pages"))) add(parse(n).name, join(base, "pages", n));
}

// Rewrites déclarés dans vercel.json.
const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [
  ...(vercel.rewrites?.beforeFiles ?? []), ...(vercel.rewrites?.afterFiles ?? []), ...(vercel.rewrites?.fallback ?? []),
];
for (const r of rewrites) {
  const first = r.source?.split("/")[1];
  if (first && !first.startsWith(":")) add(first, `rewrite ${r.source}`);
}

// 3. Collisions, insensibles à la casse.
const collisions = [...routes].filter(([name]) => reserved.has(name.toLowerCase()));
if (collisions.length) {
  fail(
    "Collision avec des anciens liens courts gouman.fr redirigés vers hi.gouman.fr :\n" +
      collisions.map(([name, origin]) => `  - /${name} (${origin}) = slug réservé "${reserved.get(name.toLowerCase())}"`).join("\n") +
      "\nRenommer la page. Ne jamais retirer le slug de la redirection dans vercel.json.",
  );
}
console.log(`check-reserved-slugs : ${routes.size} route(s) vérifiée(s), ${reserved.size} slugs réservés, aucune collision.`);

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
