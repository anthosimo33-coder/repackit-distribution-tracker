#!/usr/bin/env python3
"""Moteur de convs démo BLUSH.
Lit une bible de scénario (JSON) + le prénom de la créatrice, et produit un export WhatsApp iOS.
Usage : python3 moteur.py --bible bible_C2.json --prenom Kelly --out ./out
"""
import argparse, collections, datetime as dt, json, math, os, random, re, statistics, zipfile

ap = argparse.ArgumentParser()
ap.add_argument("--bible", required=True)
ap.add_argument("--prenom", required=True)
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--out", default="./out")
A = ap.parse_args()

B = json.load(open(A.bible, encoding="utf-8"))
R = random.Random(f"{B['id']}-{A.prenom}-{A.seed}")   # même prénom + même bible = même conv
NAME = {"L": A.prenom, "Y": B["lui"]}
LRM = "\u200e"
MARKERS = {  # format export iOS FR — à valider contre le parseur BLUSH
    "[image]": LRM + "image absente",
    "[supprimé]": LRM + "Ce message a été supprimé.",
    "[vocal]": LRM + "audio omis",
}
day = lambda s: dt.date.fromisoformat(s)
D0, D1 = day(B["dates"]["debut"]), day(B["dates"]["fin"])
HONEY, TP, RECORD = day(B["dates"]["lune_de_miel_fin"]), day(B["dates"]["tournant"]), day(B["dates"]["record"])
RY = B["rythme"]

FILL = {
    "food": ["sushis", "pizza", "kebab", "poke", "tacos", "burger", "pâtes", "raclette", "indien", "thaï", "chinois"],
    "fl": ["Inès", "Sarah", "Camille", "Jade"],
    "fy": ["Karim", "Mehdi", "Lucas", "Bilal"],
    "pl": ["dans le métro", "au taf", "chez Inès", "au Franprix", "à la salle", "dans le bus", "chez ma mère"],
    "py": ["chez Karim", "au taf", "à la salle", "dans le RER", "chez ma mère", "au five"],
    "show": ["la série coréenne", "Love Island", "le docu Netflix", "Koh-Lanta", "la série espagnole"],
    "mn": ["5", "10", "15", "20", "30"],
    "hr": ["18h", "18h30", "19h", "20h", "21h"],
}
fill = lambda t: re.sub(r"\{(\w+)\}", lambda m: R.choice(FILL[m.group(1)]), t)

# Remplissage générique d'un couple : (créneau, poids avant tournant, poids après, échanges)
D = [
    ("morning", 3, 2, [("L", "bien dormi ?"), ("Y", "bof"), ("Y", "et toi"), ("L", "j'ai rêvé de toi mdr"), ("Y", "mdr raconte")]),
    ("morning", 3, 2, [("L", "coucou toi"), ("Y", "wsh"), ("L", "t'es réveillé ?"), ("Y", "à moitié")]),
    ("morning", 3, 3, [("L", "je suis {pl}"), ("L", "il y a un monde de fou"), ("Y", "courage")]),
    ("morning", 3, 2, [("L", "bonjour 🌞"), ("Y", "bonjour")]),
    ("morning", 2, 2, [("L", "t'as bien dormi ?"), ("Y", "ouais"), ("L", "moi pas du tout"), ("L", "les voisins ont fait la fête jusqu'à 4h"), ("Y", "chaud")]),
    ("morning", 2, 1, [("Y", "t'es réveillée ?"), ("L", "oui !"), ("Y", "ok")]),
    ("day", 2, 1, [("L", "c'est quoi ton midi ?"), ("Y", "{food}"), ("L", "encore mdr"), ("Y", "laisse moi")]),
    ("day", 2, 2, [("L", "ma manager m'a encore saoulée"), ("L", "je vais craquer"), ("Y", "elle a fait quoi"), ("L", "je te raconte ce soir c'est trop long")]),
    ("day", 3, 2, [("L", "t'as vu ce que je t'ai envoyé ?"), ("Y", "non attends"), ("Y", "ptdr"), ("L", "c'est trop nous")]),
    ("day", 2, 2, [("L", "[image]"), ("L", "regarde ce que j'ai trouvé"), ("Y", "😂")]),
    ("day", 3, 3, [("L", "on se voit ce soir ?"), ("Y", "je sais pas encore"), ("L", "dis-moi vite"), ("Y", "je te dis après")]),
    ("day", 3, 2, [("L", "tu finis à quelle heure ?"), ("Y", "{hr}"), ("L", "je passe te chercher ?"), ("Y", "nn t'inquiète")]),
    ("day", 3, 2, [("L", "je pense à toi"), ("Y", "❤️")]),
    ("day", 2, 2, [("L", "{fl} m'a raconté un truc de fou"), ("Y", "quoi"), ("L", "je peux pas par écrit"), ("Y", "mdr ok")]),
    ("day", 1, 2, [("Y", "j'ai réunion là"), ("Y", "je te rappelle"), ("L", "ok")]),
    ("day", 1, 1, [("L", "viens on se fait un {food} ce soir"), ("Y", "chaud"), ("Y", "on verra")]),
    ("day", 1, 2, [("L", "t'as pensé à me rembourser le ciné ?"), ("Y", "ah oui"), ("Y", "ce soir"), ("L", "tu dis ça depuis 2 semaines"), ("Y", "mdr")]),
    ("day", 2, 2, [("Y", "{fy} fait un foot dimanche"), ("Y", "tu viens ?"), ("L", "pour te regarder 2h ?"), ("L", "ok")]),
    ("day", 2, 2, [("L", "pause avec {fl}"), ("L", "elle te passe le bonjour"), ("Y", "bjr")]),
    ("day", 2, 2, [("L", "j'ai réservé pour samedi"), ("Y", "réservé quoi"), ("L", "le resto ??"), ("L", "on en a parlé hier"), ("Y", "ah oui ouais")]),
    ("day", 2, 1, [("Y", "regarde"), ("Y", "[image]"), ("L", "mdrrr"), ("L", "c'est qui"), ("Y", "{fy}")]),
    ("day", 1, 3, [("L", "tu peux m'appeler 2 min ?"), ("Y", "là je peux pas"), ("L", "ok")]),
    ("day", 1, 1, [("L", "j'ai eu mon entretien"), ("L", "je crois que c'était bien"), ("Y", "trop bien"), ("L", "tu m'avais même pas demandé"), ("Y", "je savais que ça allait bien se passer")]),
    ("evening", 3, 3, [("L", "t'es où ?"), ("Y", "{py}"), ("L", "tu rentres quand ?"), ("Y", "jsp")]),
    ("evening", 2, 2, [("L", "sushis ou pizza ?"), ("Y", "pizza"), ("L", "j'ai commandé des sushis mdr"), ("Y", "pourquoi tu demandes alors")]),
    ("evening", 2, 1, [("L", "j'ai lancé {show} sans toi"), ("L", "pardon"), ("Y", "trahison"), ("L", "je reprends depuis le début si tu viens"), ("Y", "demain")]),
    ("evening", 2, 2, [("L", "je suis crevée"), ("Y", "moi aussi"), ("L", "toi t'as rien fait mdr"), ("Y", "j'ai fait du sport")]),
    ("evening", 2, 2, [("Y", "match ce soir"), ("L", "encore ?"), ("Y", "c'est la ligue des champions"), ("L", "ok bon match")]),
    ("evening", 2, 4, [("L", "tu viens dormir ?"), ("Y", "ce soir je peux pas"), ("L", "pourquoi"), ("Y", "je suis claqué"), ("L", "ok")]),
    ("evening", 2, 3, [("Y", "fifa avec {fy}"), ("Y", "je t'appelle après"), ("L", "ok")]),
    ("evening", 1, 4, [("L", "ça va toi ?"), ("Y", "ouais tranquille"), ("L", "t'es bizarre aujourd'hui"), ("Y", "nn je suis fatigué c'est tout")]),
    ("evening", 3, 2, [("L", "tu me manques"), ("Y", "toi aussi")]),
    ("evening", 3, 2, [("L", "je t'aime"), ("Y", "moi aussi")]),
    ("night", 3, 2, [("L", "je t'aime ❤️"), ("Y", "moi aussi ❤️")]),
    ("evening", 1, 3, [("L", "je t'aime"), ("Y", "mdr moi aussi")]),
    ("evening", 2, 1, [("L", "j'ai trop hâte de te voir"), ("Y", "moi aussi"), ("L", "demain ?"), ("Y", "on verra")]),
    ("evening", 3, 2, [("L", "j'arrive dans {mn} min"), ("Y", "ok"), ("L", "ouvre"), ("L", "je suis en bas"), ("Y", "j'arrive")]),
    ("evening", 2, 2, [("Y", "j'arrive dans {mn} min"), ("L", "ok"), ("P", ""), ("L", "ça fait 40 min"), ("Y", "j'ai eu un souci")]),
    ("night", 4, 3, [("L", "bonne nuit"), ("Y", "bonne nuit")]),
    ("night", 3, 2, [("L", "dors bien ❤️"), ("Y", "toi aussi")]),
    ("night", 2, 2, [("L", "tu dors ?"), ("Y", "nn"), ("L", "viens on s'appelle"), ("Y", "flemme"), ("Y", "demain")]),
    ("night", 2, 2, [("Y", "t'es réveillée ?"), ("L", "oui"), ("Y", "rien"), ("Y", "bonne nuit")]),
    ("night", 1, 3, [("Y", "jsuis encore dehors"), ("L", "il est 1h"), ("Y", "je rentre bientôt"), ("L", "préviens quand t'es rentré")]),
    ("night", 1, 2, [("Y", "dsl j'avais plus de batterie"), ("L", "ok")]),
    ("night", 1, 3, [("L", "tu rentres ?"), ("L", "?"), ("L", "allo"), ("Y", "oui je rentre")]),
    ("any", 2, 2, [("L", "regarde ce tiktok"), ("L", "[image]"), ("Y", "ptdr")]),
    ("any", 1, 1, [("Y", "[image]"), ("L", "c'est quoi ça"), ("Y", "mon plat"), ("L", "beurk")]),
    ("any", 1, 3, [("L", "tu m'en veux ?"), ("Y", "nn pourquoi"), ("L", "t'es froid"), ("Y", "je suis pas froid"), ("L", "ok.")]),
    ("any", 1, 4, [("L", "t'as vu mon message ?"), ("Y", "oui"), ("L", "et ?"), ("Y", "et rien")]),
    ("any", 2, 2, [("L", "on fait quoi ce week-end ?"), ("Y", "{fy} fait un anniv samedi"), ("L", "et moi ?"), ("Y", "viens si tu veux")]),
    ("any", 2, 2, [("L", "ma mère demande quand tu passes"), ("Y", "bientôt"), ("L", "tu dis ça depuis 3 mois"), ("Y", "mdr")]),
    ("any", 1, 1, [("Y", "t'as dîné ?"), ("L", "pas encore"), ("Y", "va"), ("L", "oui papa")]),
    ("any", 1, 2, [("L", "j'ai vu {fy} ce midi"), ("L", "il dit que t'étais pas là samedi"), ("Y", "il dit n'importe quoi")]),
    ("any", 0, 4, [("L", "?"), ("L", "allo"), ("L", "tu réponds plus ?"), ("Y", "dsl j'étais occupé")]),
    ("any", 0, 3, [("L", "on peut parler ce soir ?"), ("Y", "de quoi"), ("L", "de nous"), ("Y", "encore ?")]),
    ("any", 2, 1, [("L", "mdr"), ("Y", "quoi"), ("L", "rien je repensais à hier"), ("Y", "ptdr")]),
    ("any", 2, 2, [("Y", "jsp ce que je prends ce soir"), ("L", "{food} ?"), ("Y", "carré")]),
]
COLD = {i for i, x in enumerate(D) if x[2] >= 3 and x[1] <= 1}
TU_MEN_VEUX = {i for i, x in enumerate(D) if x[3][0][1] == "tu m'en veux ?"}
SLOT_W = [("morning", .2), ("day", .35), ("evening", .3), ("night", .15)]
SLOTS = {"morning": (450, 630), "day": (660, 1050), "evening": (1080, 1350), "night": (1380, 1530), "any": (540, 1320)}

lognorm = lambda med, s: med * math.exp(R.gauss(0, s))

def y_median(d, t):
    m = RY["lui_reponse_min"]
    if t.hour >= 23 or t.hour < 3: return m["nuit"] * 60
    if d == RECORD: return m["record"] * 60
    if d < HONEY: return m["lune_de_miel"] * 60
    return (m["avant"] if d < TP else m["apres"]) * 60

def delay(prev, spk, t, d):
    if spk == prev: return R.uniform(3, 45)
    if spk == "L": return min(lognorm(RY["elle_reponse_s"] * (0.4 if d == RECORD else 1), 1.0), 4 * 3600)
    return min(lognorm(y_median(d, t), 0.7), 2.8 * 3600)

def pick(slot, init, d, banned):
    post = d >= TP
    idx = [i for i, x in enumerate(D) if x[0] in (slot, "any") and x[3][0][0] == init and i not in banned]
    w = [D[i][2] if post else (0 if d < HONEY and i in COLD else D[i][1]) for i in idx]
    if sum(w) == 0:
        idx = [i for i, x in enumerate(D) if x[3][0][0] == init and i not in banned] or list(range(len(D)))
        w = [1] * len(idx)
    return R.choices(idx, w)[0]

DID = [0]
def run_dialog(start, lines, d):
    t, prev, out = start, None, []
    DID[0] += 1
    for spk, txt in lines:
        if spk == "P":
            t += dt.timedelta(minutes=R.uniform(35, 50)); continue
        if prev: t += dt.timedelta(seconds=delay(prev, spk, t, d))
        out.append((t, spk, fill(txt), DID[0]))
        prev = spk
    return out

late_used = set()
def gen_day(d):
    dpj = RY["dialogues_par_jour"]
    if d == RECORD: n = dpj["record"]
    else:
        lo, hi = dpj["lune_de_miel"] if d < HONEY else dpj["avant"] if d < TP else dpj["apres"]
        n = R.randint(lo, hi) + (R.choice([0, 1]) if d.weekday() >= 5 else 0)
    late = (D1 - d).days <= 15
    plans = []
    for _ in range(n):
        slot = R.choices([s for s, _ in SLOT_W], [w for _, w in SLOT_W])[0]
        p_elle = RY["elle_lance"]["apres" if d >= TP else "avant"]
        init = "L" if R.random() < p_elle else "Y"
        banned = (late_used | TU_MEN_VEUX) if late else set()
        i = pick(slot, init, d, banned)
        if late: late_used.add(i)
        lo, hi = (480, 600) if d == RECORD else SLOTS[D[i][0] if D[i][0] != "any" else slot]
        start = dt.datetime.combine(d, dt.time()) + dt.timedelta(minutes=R.uniform(lo, hi), seconds=R.uniform(0, 59))
        plans.append((start, D[i][3]))
    mav = B["mot_a_vous"]
    if d >= day(mav["debut"]) and R.random() < mav["proba_par_jour"]:
        lines = [tuple(x) for x in R.choice(mav["dialogues"])]
        start = dt.datetime.combine(d, dt.time()) + dt.timedelta(minutes=R.uniform(*SLOTS["evening"]))
        plans.append((start, lines))
    plans.sort(key=lambda p: p[0])
    msgs, cursor = [], None
    limit = dt.datetime.combine(d + dt.timedelta(days=1), dt.time(3))
    for start, lines in plans:
        if cursor and start < cursor:
            start = cursor + dt.timedelta(minutes=R.uniform(1, 4) if d == RECORD else R.uniform(5, 60))
        out = run_dialog(start, lines, d)
        if not out or out[-1][0] > limit: continue
        msgs += out
        cursor = out[-1][0]
    return msgs

def blocks(key):
    out = []
    for b in B[key]:
        bl = []
        for s, spk, txt in b:
            fmt = "%Y-%m-%d %H:%M:%S" if s.count(":") == 2 else "%Y-%m-%d %H:%M"
            t = dt.datetime.strptime(s, fmt) + (dt.timedelta() if s.count(":") == 2 else dt.timedelta(seconds=R.randint(0, 59)))
            if bl and t <= bl[-1][0]:
                t = bl[-1][0] + dt.timedelta(seconds=R.randint(4, 20))
            bl.append((t, spk, txt))
        out.append(bl)
    return out

# --- Génération
filler, d = [], D0 + dt.timedelta(days=1)
while d <= D1:
    filler += gen_day(d); d += dt.timedelta(days=1)

# vocaux omis, glissés juste après certains messages
voc = B["vocaux"]
extra = []
for t, spk, txt, did in filler:
    night = t.hour >= 23 or t.hour < 3
    p = voc["Y_nuit"] if (spk == "Y" and night) else voc[spk]
    if R.random() < p:
        extra.append((t + dt.timedelta(seconds=R.uniform(5, 40)), spk, "[vocal]", did))
filler += extra

ecran = [(dt.datetime.strptime(s, "%Y-%m-%d %H:%M:%S"), spk, txt) for s, spk, txt in B["ecran_choc"]]
planted = blocks("munitions") + blocks("derniere_semaine") + [ecran]
windows = [(b[0][0] - dt.timedelta(minutes=20), b[-1][0] + dt.timedelta(minutes=20)) for b in planted]
bad = {m[3] for m in filler if m[0].date() >= D1 or any(lo <= m[0] <= hi for lo, hi in windows)}
filler = [m[:3] for m in filler if m[3] not in bad]
msgs = sorted(filler + [m for b in planted for m in b], key=lambda m: m[0])
msgs = [(t, s, MARKERS.get(x, x)) for t, s, x in msgs]

# --- Écriture
os.makedirs(A.out, exist_ok=True)
first = dt.datetime.combine(D0, dt.time(14, 2, 11))
lines = [f"[{first:%d/%m/%Y %H:%M:%S}] {NAME['Y']}: {LRM}Les messages et les appels sont chiffrés de bout en bout. Personne en dehors de cette discussion, pas même WhatsApp, ne peut les lire ou les écouter."]
lines += [f"[{t:%d/%m/%Y %H:%M:%S}] {NAME[s]}: {x}" for t, s, x in msgs]
txt = "\n".join(lines) + "\n"
base = f"{B['id']} - {A.prenom} & {NAME['Y']}"
txt_path = os.path.join(A.out, f"WhatsApp Chat - {A.prenom}, {NAME['Y']}.txt")
open(txt_path, "w", encoding="utf-8").write(txt)
with zipfile.ZipFile(os.path.join(A.out, f"WhatsApp Chat - {NAME['Y']}.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("_chat.txt", txt)

# --- Contrôle
STOP = set("""je tu il elle on nous vous ils elles me te se moi toi lui le la les un une des de du au aux et ou mais donc or ni car que qui quoi
ce ça cet cette ces mon ma mes ton ta tes son sa ses notre votre leur leurs en y a à est es suis sont pas ne n plus très trop bien
oui non nn ok mdr ptdr jsp t c j l d s qu m dans sur pour par avec sans chez quand comment pourquoi si là ici aussi encore juste
fait faire dit dis vais va vas veux peux être avoir as ai ont tout tous rien bon ah oh hier demain soir ce soir""".split())
def stats():
    c = collections.Counter(s for _, s, _ in msgs)
    gaps, inits, prev = {"L": [], "Y": []}, collections.Counter(), None
    for m in msgs:
        if prev is None or m[0] - prev[0] > dt.timedelta(hours=3): inits[m[1]] += 1
        elif m[1] != prev[1]: gaps[m[1]].append((m[0] - prev[0]).total_seconds() / 60)
        prev = m
    per_day = collections.Counter(t.date() for t, _, _ in msgs)
    rec = per_day.most_common(1)[0]
    words = {"L": collections.Counter(), "Y": collections.Counter()}
    for _, s, x in msgs:
        if x.startswith(LRM): continue
        for w in re.findall(r"[a-zàâçéèêëîïôûùüÿœ]+", x.lower()):
            if w not in STOP and len(w) > 2: words[s][w] += 1
    shared = sorted(((words["L"][w] + words["Y"][w], w) for w in words["L"] if w in words["Y"]), reverse=True)[:6]
    tot = inits["L"] + inits["Y"]
    print(f"{base}")
    print(f"  messages : {len(msgs)} ({NAME['L']} {c['L']}, {NAME['Y']} {c['Y']})")
    print(f"  réponse médiane : {NAME['L']} {statistics.median(gaps['L']):.1f} min · {NAME['Y']} {statistics.median(gaps['Y']):.1f} min")
    print(f"  qui lance : {NAME['L']} {100 * inits['L'] / tot:.0f} %")
    print(f"  jour record : {rec[1]} messages le {rec[0]}")
    jt = lambda s: sum(1 for _, sp, x in msgs if sp == s and "je t'aime" in x.lower())
    print(f"  « je t'aime » : {NAME['L']} {jt('L')} · {NAME['Y']} {jt('Y')}")
    cnt = lambda k: sum(1 for _, _, x in msgs if k in x.lower())
    print(f"  maëlle {cnt('maëlle')} · bernadette {cnt('bernadette')} · supprimés {cnt('supprimé.')} · vocaux {cnt('audio omis')}")
    print(f"  mots partagés les plus fréquents : {', '.join(f'{w} ×{n}' for n, w in shared)}")
stats()
print("  fin :\n    " + "\n    ".join(lines[-7:]))
