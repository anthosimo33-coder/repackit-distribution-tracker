// Accueil — vue admin (lecture seule) de l'espace d'un créateur. L'écran rendu
// dépend de la POPULATION observée (cf ViewAsHomeScreen) : tableau de bord pour
// un partenaire, espace de dépôt pour un talent, comptes et clips pour un
// clippeur. Les données viennent des hooks d'indirection + du contexte view-as
// posé par le layout.
export { default } from "@/components/portal/ViewAsHomeScreen";
