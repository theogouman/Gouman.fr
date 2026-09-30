# gouman.fr

## Anciens liens courts (règle permanente)

gouman.fr servait de domaine de liens courts Taap.it. Les anciens slugs sont redirigés en 301 vers hi.gouman.fr par la première règle de `redirects` dans `vercel.json`.

- Ne jamais supprimer, réduire ou déplacer cette règle derrière une règle plus générale, même en cas de refonte.
- La liste des slugs est figée : les nouveaux liens courts se créent directement sur hi.gouman.fr, rien à ajouter ici.
- Les redirects Vercel passent avant les pages. Avant de créer, renommer ou déplacer une route de premier niveau `/xxx`, vérifier que `xxx` n'est pas dans la liste (y compris variante de casse). En cas de collision : changer le chemin de la page et le signaler à Théo, ne jamais retirer le slug.
- `scripts/check-reserved-slugs.mjs` (lancé en `prebuild`) fait échouer le build en cas de collision.

## À ne pas faire

- Ne pas commiter d'export CSV Taap.it (données personnelles de prospects).
- Ne pas toucher aux enregistrements DNS MX, SPF, DKIM de gouman.fr (messagerie theo@gouman.fr).
