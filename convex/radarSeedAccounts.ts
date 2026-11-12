/**
 * NOUVEAU RADAR — comptes de départ des réseaux d'apps : des ambassadrices
 * VÉRIFIÉES à la main (bio, légendes, activité) lors du sourcing des 30/10 et
 * 31/10/2026 (`out/recrutement/tous.json`). Rattachés au premier passage, sans
 * attendre qu'une recherche les retrouve. Données seulement : les règles sont
 * dans convex/radarNetworkMath.
 *
 * RECHERCHE APPROFONDIE du 10/11/2026 (demande du fondateur : « pas de doublons, pas de comptes qui ne sont pas
 * des comptes de créateurs ») : 85 pages de hashtag TikTok déroulées en entier pour les 46 apps, 2 331 comptes
 * vus, puis une page vidéo lue par compte (bio, abonnés). Est entré ici un compte dont :
 *  - le pseudo porte le nom de l'app, ou la bio la nomme ;
 *  - ou au moins deux vidéos la citent (ou la bio dit « ambassadrice »), s'il a moins de 20 000 abonnés ou si
 *    son pseudo ou sa bio sont dans la niche de l'app (histoires de textos, comptes secrets, étude).
 * Sans pseudo ni bio au nom de l'app, il faut en plus qu'au moins 2 de ses 10 dernières vidéos la citent : un
 * compte qui l'a citée par le passé et n'en parle plus n'est pas un compte créateur actif (42 écartés ainsi).
 * Écartés aussi : 906 comptes vus sur une seule vidéo, 69 gros comptes généralistes, les comptes de la marque,
 * ceux de recrutement, les comptes privés ou de moins de 3 vidéos. Un compte vu sous plusieurs apps est rangé
 * sous celle que son pseudo ou sa bio nomme, sinon celle qu'il cite le plus.
 *
 * RECHERCHE FRANCOPHONE du 11/11/2026 (le fondateur : « on a que 127 comptes de créateurs français ? », puis
 * « cherche-en plus ») : les pages de hashtag de 29 apps déroulées jusqu'à trois fois (46 chargements, 3 340
 * auteurs vus), mêmes critères que la veille, relecture un par un. 400 comptes créateurs nouveaux toutes
 * langues, dont 37 francophones — SEULS ajoutés ici (les autres : out/radar, CSV du 11/11). Ce qui n'a rien
 * donné, pour ne pas le refaire : les hashtags français généraux (#tromperie, #stalk, #enquete, #etudiante,
 * #revision… : 0 créateur d'app sur 600 auteurs) et les pseudos types (« etudie.avec.prénom », « prénom.stalk »…
 * : 2 483 pseudos testés, 4 créateurs). Écartés à la relecture : marie.shady et shadytime6 (homonymes),
 * k4tch3 (un streamer), astuces_revisions_ (marque probable), et ceux qui publient depuis la France en
 * anglais, en arabe ou en birman.
 */
export const SEED_ACCOUNTS: Readonly<Record<string, readonly string[]>> = {
  // + 34 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  airbuds: ["xiooo.airbuds", "nanawskii.airbuds", "ximena.airbuds", "rebeca.airbuds", "andy.airbuds", "mem.airbuds", "aaliyah.airbuds", "airbuds4ever", "airbudspesoo_", "alecm.toys", "ali.airbuds", "alison.airbuds", "anabeatriz.airbuds", "andres.airbuds", "aranza.airbuds", "ariana.airbudss", "azul.airbuds", "beelcity", "brady.airbuds", "caitlyn.airbuds", "connorairbuds.brcc", "dianatowersss", "discoverairbuds", "dre.airbuds", "emilee.airbuds", "emily.airbuds", "isi.airbuds", "jadehou.airbuds", "julia.airbuds", "laila.airbuds", "livii.airbuds", "lula.airbuds", "max.airbuds", "meli.airbuds", "ola.airbuds", "rachel.airbuds", "ryder.airbuds", "sarah.on.airbuds", "via.airbuds", "zan.airbuds"],
  // + 57 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  airlearn: ["learn.w.gised", "learn.with.enol", "learn.with.leti", "airlearn.amanda.g", "airlearn.arina", "airlearn.nul", "angelanguages", "bayleeonajourney", "belen_thepolyglot", "carols.learning", "darya_learn", "fluentnaya_", "fluentwithjosephine", "frenchwithpierre01", "german.w.rudii", "japanese.with.yuki", "justin.speaks", "katielearningjourney", "language_pop", "languageexplorermars", "languages_with_belu", "languageswithnova", "learn.w.diego2.0", "learn.with.aruna", "learn.with.eileen", "learn.with.minaa", "learningwithsoph", "learnnwithgeo", "learnwith.dani", "learnwith_nicolas", "learnwith_viky", "learnwithamie", "learnwithantonio", "learnwithcarly88", "learnwithcathy", "learnwithelma", "learnwithgui8", "learnwithimran0", "learnwithlory", "learnwithmanu", "learnwithmichel", "learnwithnadss", "learnwithsera", "learnwithsherry03", "learnwithshrimpik", "learnwithtrepp", "learnwithty8", "learnwithvicki", "learnwithwiki6", "manuslearningpath", "marispeaksfrench2", "mochislearningpath", "my_fluentjourney", "olgalearning", "raedandlanguages", "talklikeclaudia", "tatandlanguagess", "thatkoreangirl1", "xiexiesumi", "yenslearningpath"],
  // Relevés le 10/11/2026 : les 3 comptes de la marque, puis des comptes d'étude dont une légende (ou le texte
  // à l'écran) nomme l'app — pages TikTok #astraai et #astraaiapp déroulées en entier, et celles des numéros de
  // vidéo fournie (#4001, #4303, #4401, #4402, #4403, #4502, #4503, #4506, #3803). Tous marchés. Écartés : un
  // compte de recrutement (lisa_aicreatorclub) et les homonymes (illuma.amulli, astraa_ai).
  // + 59 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 4 francophones de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  astraai: ["astra_ai_official", "astra_ai_es", "astra_ai_si", "study.with.doina", "study_with_chlox", "an.lle3.study", "learnwithmarine", "studywithl0u", "loussshacks", "tips_revision_calli", "studyblondie", "joanaritastudy", "matildediaries", "studywithyaniree", "learnwithmariaa_", "learnwnevia", "studywithsophiatalea", "ssai741", "studymetem", "learnwithanne6", "rociotips_", "studytipslaia", "isskos_ia", "kristudyy", "learnwithbeatriz", "studyclubbyinda", "studywso_", "_learnwithnati_", "adre.mokosi", "arivoila", "belajarbarengbintangg", "coolkidzstudy", "estudiaconandreaa", "estudiobyana", "learnwithandj", "learnwithfab", "profe_atelau", "remistudy", "studie.tips5", "study_tipsdeea19", "study_with_marco", "studybypaulaa", "studyingwithcaroline", "studytipsmanu", "studywithninaa_", "verofocus", "_notesbyvi_", "_studywithlisa", "ambre_revise", "anniopiskelee", "aroastudy_", "belajarbarengbening", "belajarbarengjulian", "belajarbarengnabila", "belajarbarengrico", "belajarbersamaespi", "carduinsessione", "carlarevise", "ele.vs.uni", "elise.chm.hc", "estudazone", "estudiaconalba", "estudiaconambardelol", "estudiaconlacata", "estudiaconmaja", "estudiaconmanu", "estudiaconmishh", "estudiandoconpaula", "goodmanstudy", "hocba.tapsu", "karferstudies", "languageswithtata", "learn_with_denisa", "learn.luna", "learningcore_", "learnw.ila", "learnwith_mae7", "learnwith.cala", "learnwithaeyu", "learnwithalin", "learnwithcarolina", "learnwithdorcsy", "learnwithemilia0", "learnwithemmas", "learnwithginz", "learnwithjoanamarise", "learnwithkaylaa", "learnwithkira2", "learnwithmariac", "learnwithmarta", "learnwithmateja", "learnwithmattia", "learnwithmina", "learnwithrory", "learnwithtamara", "learnwithvalerie", "learnwithzoraa", "lernenmitpauline", "liamustika.study6", "lockinwmarianne", "mariestudytips", "miamihamhoc", "nancystudy", "nikki.study", "ninuxx_vibes", "noemienurschlauer", "punhippo_study", "rebeccarevise", "santientreapuntes2", "siiri_astraai", "studersmartere", "studijuoksu_agneta", "studuj_chytre", "study_tips_evagge", "study_withhana", "study.dmitrievna", "study.fio9", "study.girl695", "study.session0", "study.vikys", "study.with_sami", "study.with.dmtrv", "study.with.klara", "study.with.neremn", "studydiarywithspoqen", "studyginzzz", "studyhackswithsara", "studying.withdidi", "studymetannefleur", "studytipsandy", "studywith_elsie", "studywithbirgit", "studywithcelt", "studywithdg", "studywithdixon", "studywithguts", "studywithkatea", "studywithmelaa", "studywithsarah81", "studywithsumeyyee", "studywithzsof", "studywmarco", "studywrobi", "ubay.studytips", "uni.with.denn", "veraaszaboo", "vikush.study", "studywithtosia", "velko_veche_uchi", "learnwithzsofii", "learnwith_lara", "study_with_alexi", "learnwithdorina", "studywmarta", "study_tips_oliwia", "bietgichinay.studytip", "studyhacks.bymich", "aleee.studies", "alvas.pluggtips", "miyxzstudytips", "studyvibe32", "study.addie", "studywith.elly1", "gerkataaa23", "learnwithquy", "study_tipstomi", "learn_with_niki", "learnwithkata", "hadelisstudy", "learnwith_nhy", "mina.notesss", "thuphunxinh1", "mex_diaries", "learn.with.zeynep", "hoc.di.roi.biet", "studywithsophiemarie", "learnwithme_sellu", "studiemetliv", "shaezadniaa", "estudiandoandoconsofi", "vivianopiskelee", "studywithreka", "learnwithdelio", "study_with_nicole", "studywith.adri", "dylansstudyroom", "studywithmar1a", "studytips_tea", "learnwithpaola", "estudecomcaroll", "ceritaregia", "studywithpaney", "ira.belajaryuk", "belajarbareng.she", "studylikegoodman", "studywith.gina", "jessicas_studie_tips", "learnwithhanna", "laermedkeerthu", "learnwith_chel", "study.with.nhim", "gowithnewy", "studywithines_", "estudytips.ali", "studywchrissie", "studywithm25", "_mariafq", "alba.study.tips", "alexxstudytips", "belajarbarengjames", "creaconangely", "dariwdarling", "daskalaolatina", "davigoal", "duihamhoc", "easy_learning78", "estudia_con_dianaraquel", "estudiaconaida", "estudiaconlexi", "estudiaconyaz", "ferestudia", "ivylearns8", "jcstudio50", "kika.study1", "kuliahwitharya", "ladastudy", "laridicasdeestudo", "learnwith.sipos", "learnwithbeaa", "learnwithchoksa", "learnwithjoel1", "learnwithmarija", "learnwithmisa", "learnwithrebus", "lern_modus", "lernenmitdiana", "martinstudytips", "natalia_estudiando", "nilamstudylog", "nstudytips", "nuriaperezf.study_", "reviseavecnoa2", "smart_floww", "sofi.studytips", "studietipsmedmaya", "study.deyy", "study.with.phiphi", "study.with.pinky", "study_with_risko", "studyholic_lin", "studymetsoofx", "studytipsbyaida", "studywith_yona", "studywithfidaa", "studywithisaa_", "studywithmarine", "studywithmuhammadarief._", "studywithnoemii", "studywithorii", "studywithruney", "studywithterculaa", "studywithzosia", "sunnivaugc", "tipsconfrann", "unabelajar", "learnwith_tesnime", "van.learns", "studywithmarinette", "studybytyna"],
  // + 20 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  biblechat: ["alin.biblechat", "alyssa.biblechat", "biblestudieswit_twan", "biblestudieswithag", "biblestudieswithbeth", "biblestudieswitholivia", "charlotte.biblechat", "cleide.biblechat", "della.biblechat", "emmy.biblechat", "eze.biblechat", "jaz.biblechat", "karen.biblechat", "ken.bible.app", "nessa.biblechat", "pearl.biblechat", "roz.biblechat1", "sam_biblechat", "twan_biblechats", "yasmin.biblechat"],
  // + 1 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  calai: ["app_calai"],
  // + 12 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  creed: ["ember_faithh", "estherrsbiblestudy", "faithwithkate", "faithwithrachell", "glauben.mitalin", "hada.prayer", "iara.con.fe", "jackie.creed", "jackie.prays", "katesbiblestudy", "mahya.believes", "taylor.creed2"],
  // + 8 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  finch: ["alexandbeepo", "bokari.the.birb", "consistentlyalyssa", "miaandwaffles", "miacicit", "moragwoods0", "softlybecoming.milleth", "yoursisterkacey"],
  // + 12 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  flo: ["geovana.cgg", "joi.diario", "ray.flo_", "_diariodacami", "cycletalks_brook", "cycletalks_kay", "dani.girlythings", "emiko.floapp", "floappbrasil", "floappemily", "gabrielas.health7", "kiraflo234", "kristin__floapp", "maria_flo_app_", "periodtalks_mackenzie", "tonisav333"],
  // + 109 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  fluencify: ["daniely..almeida", "arthurtreixeira", "bia_soilo_", "pe.explores", "clarissa_ugc", "estelamaria.ugc", "bycarolugc1", "thay.tries.it", "jessugc_", "asm_secret", "lethicia.muller.ugc", "nathalia.salvianougc", "eubiancafroes", "rox.reviews", "karol.creator", "_so_raya", "aleciya.salazar", "alves.ugc.creator2", "ana.tries.it", "anaclara.ccosta", "anaisa7579", "anfanty8", "ange.remoto", "angelinemind", "audrey.curates1012", "ayu.lifestyle", "babizielle", "bellaugctech", "bet.finds", "biaaraujocreator", "borgesmaryela", "bruna.fp7", "bruna.guimares06", "brunopessoafy", "cait.tries08", "camij.ugc", "carlamae_fluencif", "carolforcreators", "carolineproencaugc", "cassia.criando", "danitestacoisas", "darksoul7237", "dave_hustles1", "dayane.carlos47", "dayane.ugc.tech", "dienita.fy", "diulia.truyliougc", "dylan.fluencify", "elisandra.gois3", "erikamoreira.ugc", "esterreis.ugc", "eu.amandarissardo", "faisal.tests.it", "fernanda.fashionbrands", "fernanda.kelly1988", "fernanda.rodrigues026", "fernandahs96", "g4bspsilva", "gabix.indica", "geddy.influencer", "gii_works", "giu.lantyer", "heyitsgiuli8", "heyqueren5", "its.me.liivs", "jasmine.wycherley", "jes.cuello323", "jessica.lima4484", "jessicamdpp", "jessicreatortech", "jessonly01", "jhessycreator", "joseph.ngugi.jr", "ju.testa.tudo", "karina.embaixora", "karolsds1", "kaylascontentt", "kellie.fluencify", "kelly.fran55", "laisribeiro514", "laramariabpilla", "leh_freitaas", "leticiareviews", "lissalle08c", "liversongomes", "luan.porai", "luanaandradefe", "lukas_is.here", "marcelapcfreitass", "marcele.santos96", "marcinhaugc", "marianarodrico", "marianna.tries.it", "mauryn_discovers", "mayla.cria", "meirellesfluencify", "milenamota.ugctech", "monicas.picks", "nanaccunha", "natalia.finds1", "natalia.venancio46", "nayhugc", "paola.antoniella", "patricia.creative", "pombili.pn", "raphashell", "reh7736", "rh.ugc", "samuel.descobre", "scrsara99", "semilogo_01", "sillva.andressaa", "tacio.pereira4", "tainara.molec", "tais.ugc2", "talmonramos", "tania.gmm", "thais.silva5180", "thais_879", "thatgal612", "ugc.jeci", "ugcluise", "ugcmarisales", "vitorialisboaugc"],
  // + 3 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  followspy: ["azufollow", "liana.chisme", "angie_detective", "julieta.chisme", "by.mafe27", "lolii_023", "maaarluch10", "scar_factos", "vale.spyhacks", "pili.chisme0", "pao_2fs", "fernanda.herrera2915", "alexa.valentin_", "babigirltea", "stephie.girlcode"],
  // + 19 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  glamai: ["aiwithglam", "alexia.glamai", "cande.glamai", "contenttipsbyelona", "createwithelisa", "filtrezz", "glamai7", "glamairobyn", "goviralwithmary", "guada.glamai", "iamglamai", "jc.glamai", "jp.glamai", "matiglamai", "mikki_glamai1", "miss.kris.glamai", "popia.glamai", "xoxomxii", "yulliaglam"],
  // + 1 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  kairo: ["juliakairoapp1", "bellacordacedo", "acordandocomgabi", "essenmitkairo"],
  // + 6 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  katch: ["sofia.71714", "paciencia.gossip", "gossip4sab", "alicia.mikey0", "annaagrace.secret", "divaas.spam", "enjoy.gossip", "oliwia._secret", "toni.spam05"],
  // + 9 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 4 francophones de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  knowunity: ["capistudios", "clouudstudies", "lydiaqcnykj", "patrickstudiess", "study.with.zoi", "studyluise", "studywithjasminn", "studywithlilla", "toni4school", "noah_031108", "btwuserbtw", "kayllis8", "study_with_louise"],
  // + 1 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  leakeddms: ["vapimediary"],
  // Relevés le 10/11/2026 dans les vidéos de la découverte (légende ou texte à l'écran qui nomme l'app).
  // + 19 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 2 francophones de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  love8: ["bontlelove8", "johan_love8", "saraf.love8", "lour.love8", "asxheqqlove8", "atacansevgilove8", "bi.vibe08", "cande.love8", "dariadaidai", "daudaulove8", "desi_love8", "emiulove8", "furkanngulsuunnlove8", "halu_love8", "hektorlove8", "jaylove8895", "kelllylove8", "love8_allforcouples", "love8app_ad", "love_infinity8_", "luvysalove8", "mamtv.13", "martinaalove8", "laure_love8", "pharellove8"],
  // + 31 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  loverzz: ["loveby_cami", "loveby.felipe", "adamloverzz", "arielandziah", "babesjewelss", "carlyloverzzjeff", "connordoeslove", "coupletalk_dillan.bella", "formenmylove", "love.by.franbih", "loveby.davina", "loveby.kay", "loveby_benny", "loveby_erica", "loveby_joanieandv", "loveby_kalai.mileni", "loveby_karo", "loveby_matilde", "loveby_mayaandilyan", "loveby_mileni.kalai", "loveby_mona", "lovebyleniii", "lovenotes.kalai", "lovenotes.yara", "lovenotes_pam", "lovenotesdaisy", "lovenotesnadi", "loverzz16", "loverzz60", "loverzzoff", "pumpkinlovee99", "ravenandtayla", "talklovetruth"],
  // + 1 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  lurk: ["glau.lurk", "valen.lurk", "delfi.lurk", "moralurk", "vanalurk", "joaco.lurk", "chloe_heals1"],
  // + 7 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 1 francophone de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  palima: ["erin8521", "juliaenvoyage", "_palimaa", "palima13", "palima195", "palimaabramkina", "palimapassion", "pt_daurulang", "voyagesarah", "damien.voyage5"],
  // + 21 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  plugai: ["animalchaos281", "brigitwilbur42", "dailydose_of_texts0", "dailytextory", "dr.rizziology", "jxcreator1", "love.xo57", "momyrizzler", "mrrizzking4", "ray.texts", "rizzkyybusiness", "smoothrizz07", "text.give", "textfwooshh", "textinlett", "texts_message", "textulull", "textwavve", "therizzlermonarch", "tim886087", "user7002799158680"],
  // + 46 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  praktika: ["nick_study_1", "evadestravaingles", "analaorenn.praktika", "daiastudy", "daianapraktika", "learnwithcare", "angielski.z.iza", "angielski_z_pauli", "der_praktikant3", "dropshipwithdinda", "engishvibeswithhajar", "english.with.emma3", "english.with.samira", "english_with_asma3", "english_with_dimi", "englishmitminh", "englishwith.martu", "englishwithkerry", "englishwithouma5", "erica.praktika.ai", "imparaconluana6", "karin.praktika", "katerinaa.praktika", "langlaisavecbouch", "language.with.tat", "languageswithwis", "langwithrebeca", "learn.with.shar", "learn_linda", "learningenglishwjose", "learnwithkaren8", "lernenmitsabrina", "lernenmitsezai", "lernenmitsharon.a", "maridement.pl", "nais.languagejourney", "natalia.lingua", "peter.practices.english", "praktika21", "praktika27", "praktikaaiemi", "praktikaalyssa", "praktikabrasil", "spanishwithabel7", "spanishwithmariii", "sprachen.mit.adriana", "sprachenmitsophie", "sstudiaconsara", "studyandlearn00", "studywithangel_111", "studywithem.daily", "talkwith.chels"],
  // + 7 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  recentfollow: ["lu.alterego", "sonia.sinfiltro", "javinthefields", "juli.chisme", "guadi.chisme", "mora.data", "des.girlhacks", "fran.factoss", "giuligirlcode", "guada_2204", "jj.girlhacks", "sarah.girlhacks", "steph.girltea"],
  // Relevés le 10/11/2026 : les comptes de la marque, puis des comptes d'étude dont une légende (ou le texte à
  // l'écran) nomme l'app — pages TikTok #retaincards, #retaincard, #retaincardapp et #retain déroulées en entier.
  // Surtout FR et DE. Écartés : les comptes de recrutement (retaincards.criadores, marine.talentscoutretain) et
  // un compte généraliste (dunja.nfs).
  // + 16 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 15 francophones de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  retaincards: ["retain.cards", "learnwithlanto", "arno.revisions", "julie.tipsetudes", "etudie.avec.marin", "etudie.avec.ema", "study.withcharlie", "linda.studytips", "amandasstudier0", "studyingwithlaura", "study.mit.sophia", "studytips.by.franzi", "isa.studycontent", "studywithmaylin", "studywithchre", "leah_studyy", "study.cara", "etudier.avec.chloe", "study.mit.lauri", "ana.baystudy", "studywithdenise", "estudiaconlauu", "maya.lerntipps", "marystudylife", "retain.cards.offi", "etudie.avec.chloe", "comestudywithanna", "marietipsstudy", "shasha.revisions", "study.mit.sarina", "liv.studylife", "studywith.elisa", "study.with.fey", "sophia.lerntipps", "studytipsjurando", "studymiyuki_jp", "julia_lerntipps", "hollystudytips", "studytipswithme2", "retain.cards8", "estudiaconalex3", "franci.studytips", "keillaestuda", "study.with.marta", "studytimelisa", "etudieavecjulie", "caroline.estuda", "studybuddystasia", "toriasstudytips", "study.with.elica", "jasi_studywithme", "study_with_kayley", "studytippsella", "studyflow.with.angi", "annalena.studywithme", "studying.withjulie", "blandine.retain", "maylistudent", "studywithjustiine", "etudie_avec_alex", "kerstinstudiert", "study.with.clea", "vic.studytips", "camille.etudes.astuces", "etudie.avec.manal", "luca.consigli.studio", "studywith.kat", "learnwith_paula", "gracy.learns", "klausurphase.laura", "study.with.mira", "estudia.conclara", "just.learnss", "etudie.avec.chlo", "julie.studyxme", "marine.revisions", "leaa.revisions", "sena.studytips", "stud.y_laure", "tipsestudioconand", "stud.withannika", "studying.with.amelia", "retaincard.pimmada", "study._laure", "adri.study2", "alice.dicasdeestudo", "amalas.welt", "anastasia.studyhacks", "brooke_studies_hard", "etudieaveccha", "laure._study", "mailine.wilgo", "minimum20.study", "ophe.tipsrevisions", "porady.naukowe.marsi", "study.with.ida", "studytimesarah", "studywithtekoa", "themarbrain", "ugc.marou", "emma.studytips", "study.avec.margot", "study.with.cassou", "studywith_kelly", "shirley.study", "cultive_ton_esprit_", "study.vene", "juli_revisions", "lara.retain.cards", "lucsey.revisions", "etudie.avec.cass", "etudie.avec.thoma", "study.with.eva5", "jennyfer.revisions", "chloe.revisions"],
  // + 12 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  rizzapp: ["buldogtexts", "hyperpoptexts", "itext_", "nur.ein.chat", "storybyte_0", "tedaord", "text.core_", "text.flix", "textcube", "textnerve", "texttyyful", "zaplouco.mp4"],
  // + 7 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  rizzmaster: ["rizzmaster_app", "chen12944", "daily.textingstories6", "josephstill165", "julianrizzmaster", "rizzmaster240", "rizzmasterclips", "thatboiinaldo"],
  // + 1 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  safenow: ["safenow_br", "safenow_es", "safenow_fr", "safenow_stories"],
  // + 7 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  serializd: ["casscvp", "darino.cine", "noirettedelrey", "sdrun", "simplykhryn", "thetvyapper", "user051297294"],
  // + 3 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 1 francophone de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  shady: ["maii8589", "charlottebarry_8", "duda.shody", "dakota_welle", "marai_shady", "angies.diary1", "lilyshadyapp", "baguetteli", "appshadyonly", "dorcsyy_shady", "pharelwithshady", "shady_dorcsyy", "misshadyapp"],
  // + 3 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  snitchy: ["lilimystery", "lscarla3", "enjoysecrets", "les.secrets.de.sak", "nanousecrets", "ilham.enquetes", "laure_snitchy", "juliettesnitchy", "detective.sn1tchy", "emma_4033", "snjulica", "carlasrk5", "laure_secrett", "snchases99"],
  // + 38 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 5 francophones de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  stalkie: ["ageobarboza", "janilzagndv63", "l.auradiary", "will70mvj6", "isabellaai2m9e", "rossellihwxt4j", "anduplays5", "constanzaiexkt9", "yolo_cuento", "paolavqys02", "irisfcajea", "cintiapgx4r2", "giovannarrtsay", "andre6yykif", "esteladit331", "dora639uhm", "marim2bmxe", "santiagol696jr", "luzdaryejpfqk", "oriadny85mtv9", "lily.mkp4", "meli83.fit", "manon797f2q", "_sophiiie_021", "aglaupekwlckc", "amandassted3", "angelawg00f9", "anshua0th67", "beatrizscluju", "bonniekirschner", "delfinalqz9l5", "diegopk6yjr", "evelynawffiy", "francinevntuah", "gluciauo9pfj", "heloisax4pkun", "joanna5bs6oi", "joaquin2t4zpe", "juliakozwl", "khlo65087", "laurenhu8sp0", "leinysl5r7s5", "linseyugroeg", "lisgaminglife", "marcio3zsbgb", "mariahf8wjps", "maygim1ww", "melimin4xz", "miacore.jpg", "naomi0kr4j5", "nataliafm0ite", "nicolei9tre8", "oscar96wzlm", "sandranm2gll", "sarahtwdy4e", "sarauqyrh7", "sarax7ndcu", "sofiacquq1a", "sofiat7f1sp", "tainara2y9ic2", "thamara2s54ug", "hajarxp7fem", "jekzneb", "nelyziaa", "jeanna5696", "sandrashh5o4"],
  // + 6 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  susly: ["carol.secretaccount", "trust.gazelle1", "bususlyy", "dailysecret.tamy", "ingrid.dethdheb", "susly87", "suslyyy", "valery.secretaccount"],
  // + 8 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  sweatcoin: ["victoria_sweatcoins0", "jaquesweatcoin", "jimenez26291", "rossme.sweat", "yacultdog", "chellmyyroja", "coin_free4", "milly.scarllet", "never.give.up8448", "pauloveshanni", "sephorawishliist", "sweatcoin2.1", "wd.soluciones.spo"],
  // + 3 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 1 francophone de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  thecringe: ["juan.privateaccount", "laure_privateacco", "shana_privateaccount", "paul.crown4"],
  // + 15 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 2 francophones de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  theick: ["anafssecretaccount", "guilherme.l282", "matildesecretaccount", "thesecretaccount020", "eneassecretaccoun", "valeriasecretaccountttt", "guasecretacc", "lulussecretacc_", "choluji", "candesecretaccount_", "lour.secretacc", "danielmrtin", "mai.closefriends", "catarinasecretaccount", "maraisecret", "the.ickapp", "loukasecretaccount", "niiniinhaaaa", "ilonasecretaccountt", "ilionasecretaccount", "venesecretaccount", "milaasecretaccount", "pharelensecret", "aleksecretacc", "hana.ssc", "johansecretacc", "johansecretaccount", "katharinassecretacc", "laure._.theick", "loolaa6385", "maraisecretaccoun", "marti.theick", "martinasharessuvida07", "martutheick", "maya_theick", "morasecretaccount8", "secret.maddy.17", "victorsecretaccount0", "milaa.secretaccount", "iliona.theick"],
  // + 1 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  umax: ["reemhealth"],
  // + 29 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  // + 1 francophone de la recherche du 11/11/2026 (en fin de liste, voir l'en-tête).
  vocaai: ["nicole.vocaai", "analaoren.vocaai", "kinhasantosvocaai", "giovanna.vocaai", "fatima.vocaai", "molkasfarr", "hassan.vocaai", "carolinavocaai", "millivocaai", "taiane.vocaai", "alex.vocaai", "analaura.vocaai", "anya.vocaai", "biggestgodgermanybackup", "conorvocaai", "dayana.vocaai", "eduard.vocaai", "emma.vocaai", "fairuzenglish", "gaabsvocaai", "isalearningerman", "jana_voca", "jubjang.vocaai", "karen.spanishwithvoca", "livia.voca.ai", "margarita.vocaai", "mari.vocaai", "mariaclara.claravocaai", "nya.vocaai", "ranosy01", "rebeca.vocaai", "sarah.vocaai", "tainaradovocaai", "tali.do.voca.ai", "thainara.vocaai", "tony.vocaai", "vale.vocaai", "violla.vocaai", "yuliia.vocaai", "ksenia.vocaai"],
  // Aucun compte de départ jusqu'au 11/11/2026 : 1 francophone de la recherche de ce jour (voir l'en-tête).
  whatbrandonthinks: ["johan.wbt"],
  // + 10 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  wingaiapp: ["aatrqrdha4", "chaat.stories", "chatt.historiass", "clw0lj8ir8", "historias.texteadas", "it6cngaih0", "text.zumal", "textivio", "textscad", "y2fakk2ae1"],
  // + 9 trouvés par la recherche approfondie du 10/11/2026 (voir l'en-tête).
  wrizz: ["botrizzclips", "mono_edge.edits", "mrrizz515", "rizz.clips53", "rizzshoots", "rizztok64", "viral.rizz5", "wmoveit", "wsrizz4"],
};

/**
 * Comptes RETIRÉS de la liste de départ : la synchro les met en pause s'ils étaient entrés par elle (jamais un
 * compte ajouté à la main ou trouvé par une légende). Le 10/11/2026 : deux comptes de recrutement de créateurs
 * de Retain Cards, et trois comptes personnels entrés sur une seule vidéo pour Astra AI.
 */
export const SEED_REMOVED: readonly string[] = ["nadegellg", "luca.lss", "chiara23091", "lauraretain", "mar.retainmx"];

/**
 * Comptes suivis mis en pause À LA MAIN, quelle que soit leur origine (décision du fondateur, 10/11/2026) : la
 * synchro les met en pause une fois, « hors sujet ». Réactivé depuis l'écran, un compte n'y est plus remis
 * (radarNetworkMath.handPause), et le rejugement automatique ne les relance pas (radarNetworkMath.canRejudge).
 *  - 36 gros comptes généralistes : plus de 20 000 abonnés, ni pseudo ni bio au nom de l'app, et au plus une de
 *    leurs 10 dernières légendes la cite (une vidéo sponsorisée de passage) ;
 *  - 5 boutiques et revendeurs de téléphones rangés sous Airbuds : « airbuds » y désigne des écouteurs.
 * Des 61 comptes proposés, 20 n'y sont pas : 8 citent l'app dans au moins 5 de leurs dernières vidéos (ce sont
 * des créateurs), 1 est un compte de la marque (floteens), 11 ne sont pas tranchés.
 */
export const OFF_TOPIC_BY_HAND: readonly string[] = [
  // Gros comptes généralistes.
  "_szonjaaa._", "_yeahbert24", "anaylunagarcia", "annetll", "arganaca", "awadesandia62", "banginout009", "birdtart01", "calithekid_", "camii_.grwm_", "cedesugc", "celesste_apps", "dorriecherry", "ezgityp", "fix.with.zabit", "haileygracieee", "happylittledesign", "herasuns", "johnniehartmann", "larrylegend145", "lotte_1862", "maggiemurphyxo", "massi2elegant", "nashgotnyash", "ntando_bash", "praiize", "profsnider", "queenofvitality", "renduh", "salsa6ell", "samy.aasmr", "sarahandjk", "soya_ning", "tylerbtopg", "valeatoire", "z_zeika",
  // Boutiques d'écouteurs « airbuds ».
  "techzoneelectronix", "fawadmobile.ak", "fawad.mobile.zone75", "hamzamartofficialpk", "bilal_mobile_pakistan",
];

/**
 * Langue DÉCLARÉE À LA MAIN de comptes suivis, quand celle que TikTok donne à leurs légendes trompe : la synchro
 * la pose et le relevé la garde (radarNetworkMath.accountLang). Sans langue, un compte n'est dans aucune langue
 * de l'onglet Créateurs. Le 12/11/2026, cinq des 37 francophones entrés la veille n'étaient pas sous « Français »,
 * alors que le texte à l'écran de leurs vidéos relevées est en français (« Mes notes l'année dernière vs cette
 * année », « Imagine une app où tu dois fouiller un téléphone… ») :
 *  - learnwith_tesnime (Astra AI), kayllis8 et study_with_louise (Knowunity), sandrashh5o4 (Stalkie) : des
 *    légendes faites de hashtags (« #lycee #bac #knowunity »), auxquelles TikTok ne donne aucune langue ;
 *  - hajarxp7fem (Stalkie) : classée en anglais pour trois mots de légende (« My favorite game »).
 * La clé est une langue de l'onglet (radarCreatorsMath.CREATOR_LANGS).
 */
export const LANG_BY_HAND: Readonly<Record<string, readonly string[]>> = {
  fr: ["learnwith_tesnime", "kayllis8", "study_with_louise", "sandrashh5o4", "hajarxp7fem"],
};
