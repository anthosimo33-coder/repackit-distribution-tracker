/**
 * Décide si l'entrée en scène du hero se joue — et rien d'autre : la
 * chorégraphie elle-même est en CSS, suspendue à `html[data-entrance="on"]`.
 *
 * SCRIPT EN LIGNE, volontairement. Un `useEffect` ne s'exécute qu'après
 * l'hydratation : le hero s'affichait, puis disparaissait pour s'animer — un
 * clignotement. Ici le navigateur pose l'attribut en lisant le HTML, avant le
 * premier affichage, comme on le fait pour un thème sombre.
 *
 * Conséquence voulue : par DÉFAUT (pas de JavaScript, robot d'indexation,
 * lecteur d'écran) l'attribut n'existe pas, donc rien n'est animé et rien
 * n'est caché. L'animation est un bonus, jamais une condition pour lire.
 *
 * Elle ne se joue pas non plus :
 *   - avec `prefers-reduced-motion` ;
 *   - à la deuxième page vue de la session (`sessionStorage`) : une entrée de
 *     2,5 s est belle la première fois, pénible à chaque retour depuis /login.
 *
 * L'attribut tombe à 3,6 s, quand la dernière carte a fini (1,99 s de retard
 * + 1 s d'animation) : après ça, plus une seule règle d'animation ne pèse sur
 * le hero.
 */
const ENTRANCE_SCRIPT = `(function(){try{
if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
if(sessionStorage.getItem('jarvia.home.entrance')==='1')return;
sessionStorage.setItem('jarvia.home.entrance','1');
document.documentElement.setAttribute('data-entrance','on');
setTimeout(function(){document.documentElement.removeAttribute('data-entrance')},3600);
}catch(e){}})()`;

export function EntranceGate() {
  return (
    <script
      // i18n-exempt: script d'amorçage, pas du texte d'interface.
      dangerouslySetInnerHTML={{ __html: ENTRANCE_SCRIPT }}
    />
  );
}
