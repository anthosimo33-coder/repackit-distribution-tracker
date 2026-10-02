/**
 * Les DOMAINES d'écriture du serveur MCP, dans l'ordre de « Connecter Claude ».
 * Chacun ne montre ses outils qu'à une connexion autorisée, dans l'app, à le
 * modifier (`writeScopes`) — cf convex/mcpWriteCommon.
 */

import { DOMAINE_COMPTA } from "./mcpWrites";
import { DOMAINE_MISSIONS } from "./mcpWritesMissions";
import { DOMAINE_SCRIPTS } from "./mcpWritesScripts";
import { DOMAINE_PUBLICATIONS } from "./mcpWritesPublications";
import { DOMAINE_VEILLE } from "./mcpWritesVeille";
import { DOMAINE_EXPERIENCES } from "./mcpExperiences";
import type { DomaineEcriture } from "./mcpWriteCommon";

export const DOMAINES_ECRITURE: readonly DomaineEcriture[] = [
  DOMAINE_COMPTA,
  DOMAINE_MISSIONS,
  DOMAINE_EXPERIENCES,
  DOMAINE_SCRIPTS,
  DOMAINE_PUBLICATIONS,
  DOMAINE_VEILLE,
];
