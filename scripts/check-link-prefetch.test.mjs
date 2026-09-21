import { describe, expect, it } from "vitest";
import { findRowLinks } from "./check-link-prefetch.mjs";

/**
 * Une garde qui ne sait pas dire NON ne garde rien : chaque cas décrit d'abord
 * ce qui doit ÊTRE SIGNALÉ, puis ce qui doit passer. Les sources d'exemple ont
 * la forme du dépôt (helper `portalHref`/`projectPath` autour du template), pas
 * une forme idéalisée qui rendrait la détection trop facile.
 */
describe("check-link-prefetch — ce qui doit être signalé", () => {
  it("signale un lien par ligne dont le href interpole un identifiant", () => {
    const src = `
      export function Row({ a, base }) {
        return (
          <Link href={portalHref(base, \`/assignments/\${a._id}\`)} className="block">
            {a.title}
          </Link>
        );
      }
    `;
    const hits = findRowLinks("Row.tsx", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].hasPrefetch).toBe(false);
    expect(hits[0].line).toBe(4);
  });

  it("traverse le helper : le template est un ARGUMENT, pas le href lui-même", () => {
    const src = `<Link href={projectPath(\`/comptes/\${c._id}\`)}>x</Link>`;
    expect(findRowLinks("a.tsx", src)).toHaveLength(1);
  });

  it("voit aussi un lien auto-fermant", () => {
    const src = `<Link href={\`/defis/\${c._id}\`} aria-label="voir" />`;
    const hits = findRowLinks("a.tsx", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].hasPrefetch).toBe(false);
  });

  it("ne se laisse pas berner par un autre attribut interpolé", () => {
    // `title` interpole, `href` non : ce lien n'est PAS un lien par ligne.
    const src = `<Link href="/gains" title={\`\${n} vues\`}>Gains</Link>`;
    expect(findRowLinks("a.tsx", src)).toHaveLength(0);
  });
});

describe("check-link-prefetch — ce qui doit passer", () => {
  it("laisse tranquille un lien par ligne qui a tranché", () => {
    const src = `<Link href={portalHref(base, \`/clips/\${c._id}\`)} prefetch={false}>x</Link>`;
    const hits = findRowLinks("a.tsx", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].hasPrefetch).toBe(true);
  });

  it("accepte `prefetch` sans valeur (cible statique assumée)", () => {
    const src = `<Link href={\`/accueil/\${locale}\`} prefetch>x</Link>`;
    expect(findRowLinks("a.tsx", src)[0].hasPrefetch).toBe(true);
  });

  it("ignore un href fixe, même écrit en accents graves ou via un helper", () => {
    const src = `
      <Link href="/login">a</Link>
      <Link href={\`/gains\`}>b</Link>
      <Link href={portalHref(base, "/profil")}>c</Link>
      <Link href={href}>d</Link>
    `;
    expect(findRowLinks("a.tsx", src)).toHaveLength(0);
  });

  it("ignore une balise qui n'est pas un Link", () => {
    const src = `<a href={\`/comptes/\${c._id}\`}>x</a>`;
    expect(findRowLinks("a.tsx", src)).toHaveLength(0);
  });
});
