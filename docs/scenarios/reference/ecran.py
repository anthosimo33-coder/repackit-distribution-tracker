#!/usr/bin/env python3
"""Écran choc : capture façon WhatsApp iOS (1170x2532) des derniers messages d'un export.
Usage : python3 ecran.py --prenom Kelly --lui Yanis --export "WhatsApp Chat - Kelly, Yanis.txt" --out ecran.png
"""
import argparse, os
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--lui", default="Yanis")
ap.add_argument("--prenom", required=True)
ap.add_argument("--export", required=True)
ap.add_argument("--out", required=True)
A = ap.parse_args()

S = 3                       # échelle iPhone @3x
W, H = 390 * S, 844 * S
F = os.environ.get("INTER_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")) + "/Inter-"
def font(w, pt): return ImageFont.truetype(F + w + ".ttf", int(pt * S))
f_msg, f_time, f_name = font("Regular", 17), font("Regular", 11), font("SemiBold", 16.5)
f_sub, f_status, f_pill = font("Regular", 12.5), font("SemiBold", 17), font("Medium", 12.5)

BG, NAVBG = (234, 227, 218), (246, 246, 246)
OUT, IN = (217, 253, 211), (255, 255, 255)
GREY, TIMEC, BLUE, TICK, BLACK = (134, 150, 160), (102, 119, 129), (0, 122, 255), (83, 189, 235), (17, 27, 33)

import re, datetime as dt
LINE = re.compile(r"^\[(\d\d/\d\d/\d{4}) (\d\d:\d\d):\d\d\] ([^:]+): (.*)$")
rows = []
for l in open(A.export, encoding="utf-8"):
    m = LINE.match(l.rstrip("\n"))
    if not m or m.group(4).startswith("\u200e"): continue
    rows.append((dt.datetime.strptime(m.group(1), "%d/%m/%Y").date(), m.group(2), m.group(3), m.group(4)))
last = rows[-1][0]
MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
JOURS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."]
def label(d):
    if d == last: return "Aujourd'hui"
    if d == last - dt.timedelta(days=1): return "Hier"
    return f"{JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]}"
MSGS, prev_day = [], None
for d, hhmm, who, text in rows[-16:]:
    if d != prev_day:
        MSGS.append(("pill", label(d), None)); prev_day = d
    MSGS.append(("me" if who == A.prenom else "them", text, hhmm))

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
p = lambda v: int(v * S)

def wrap(text, maxw):
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if f_msg.getlength(t) <= maxw: cur = t
        else: lines.append(cur); cur = w
    lines.append(cur)
    return lines

def ticks(x, y):  # double coche bleue, (x, y) = coin bas-gauche
    for dx in (0, p(4.5)):
        d.line([(x + dx, y - p(4)), (x + dx + p(3), y - p(1)), (x + dx + p(9), y - p(8))], fill=TICK, width=p(1.4), joint="curve")

# --- Bulles, du bas vers le haut
INPUT_H, HOME_H = 52, 34
bottom = H - p(INPUT_H + HOME_H) - p(10)
maxw = p(258)
layout, y = [], bottom
for i in range(len(MSGS) - 1, -1, -1):
    who, text, hhmm = MSGS[i]
    if who == "pill":
        y -= p(30)
        layout.append(("pill", text, None, y, 0, 0, False))
        y -= p(8)
        continue
    lines = wrap(text, maxw)
    meta_w = f_time.getlength(hhmm) + (p(19) if who == "me" else 0)
    last_w = f_msg.getlength(lines[-1])
    widest = max(f_msg.getlength(l) for l in lines)
    lh = p(22)
    if last_w + meta_w + p(8) <= maxw:
        bw = max(widest, last_w + meta_w + p(8)); extra = 0
    else:
        bw = max(widest, meta_w); extra = p(15)
    bh = lh * len(lines) + extra + p(14)
    bw += p(20)
    nxt_same = i + 1 < len(MSGS) and MSGS[i + 1][0] == who
    y -= bh
    layout.append((who, lines, hhmm, y, bw, bh, not nxt_same))
    prev_same = i - 1 >= 0 and MSGS[i - 1][0] == who
    y -= p(2) if prev_same else p(8)
pill_y = y - p(30)

def pill(label, top):
    pw = f_pill.getlength(label) + p(20)
    d.rounded_rectangle([(W - pw) / 2, top, (W + pw) / 2, top + p(22)], radius=p(8), fill=(255, 255, 255))
    d.text(((W - f_pill.getlength(label)) / 2, top + p(4)), label, font=f_pill, fill=TIMEC)

for who, lines, hhmm, top, bw, bh, last in layout:
    if who == "pill":
        pill(lines, top); continue
    x = W - p(10) - bw if who == "me" else p(10)
    col = OUT if who == "me" else IN
    d.rounded_rectangle([x, top, x + bw, top + bh], radius=p(14), fill=col)
    if last:  # petite queue en bas
        if who == "me":
            d.polygon([(x + bw - p(14), top + bh), (x + bw + p(6), top + bh), (x + bw - p(2), top + bh - p(12))], fill=col)
        else:
            d.polygon([(x + p(14), top + bh), (x - p(6), top + bh), (x + p(2), top + bh - p(12))], fill=col)
    ty = top + p(6)
    for l in lines:
        d.text((x + p(10), ty), l, font=f_msg, fill=BLACK); ty += p(22)
    tx_end = x + bw - p(9)
    tyy = top + bh - p(17)
    if who == "me":
        ticks(tx_end - p(14), tyy + p(12))
        tx_end -= p(19)
    d.text((tx_end - f_time.getlength(hhmm), tyy), hhmm, font=f_time, fill=TIMEC)


# --- Barre d'état + navigation (dessinées par-dessus)
NAV_TOP, NAV_H = 54, 52
d.rectangle([0, 0, W, p(NAV_TOP + NAV_H)], fill=NAVBG)
d.line([0, p(NAV_TOP + NAV_H), W, p(NAV_TOP + NAV_H)], fill=(210, 210, 210), width=1)
d.text((p(44), p(17)), "22:34", font=f_status, fill=(0, 0, 0))
d.rounded_rectangle([p(130), p(11), p(256), p(43)], radius=p(16), fill=(0, 0, 0))   # Dynamic Island
bx = p(292)
for k in range(4):  # réseau
    h = p(4 + 2.6 * k)
    d.rounded_rectangle([bx + k * p(5), p(31) - h, bx + k * p(5) + p(3), p(31)], radius=p(1), fill=(0, 0, 0))
cx, cy = p(326), p(31)
for r in (p(12), p(8), p(4)):  # wifi
    d.pieslice([cx - r, cy - r, cx + r, cy + r], 225, 315, fill=(0, 0, 0))
    d.pieslice([cx - r + p(2.2), cy - r + p(2.2), cx + r - p(2.2), cy + r - p(2.2)], 225, 315, fill=NAVBG) if r > p(4) else None
d.rounded_rectangle([p(342), p(20), p(367), p(32)], radius=p(3.5), outline=(0, 0, 0), width=p(1))   # batterie
d.rounded_rectangle([p(344), p(22), p(358), p(30)], radius=p(2), fill=(0, 0, 0))
d.rounded_rectangle([p(368.5), p(24), p(370), p(28)], radius=p(1), fill=(0, 0, 0))

ny = p(NAV_TOP) + p(NAV_H) / 2
d.line([(p(22), ny - p(10)), (p(13), ny), (p(22), ny + p(10))], fill=BLUE, width=p(3), joint="curve")
d.text((p(27), ny - p(10)), "12", font=font("Regular", 17), fill=BLUE)
ax = p(70)
d.ellipse([ax, ny - p(18), ax + p(36), ny + p(18)], fill=(214, 220, 224))
d.ellipse([ax + p(12), ny - p(10), ax + p(24), ny + p(2)], fill=(255, 255, 255))
d.chord([ax + p(6), ny + p(4), ax + p(30), ny + p(24)], 180, 360, fill=(255, 255, 255))
d.text((ax + p(46), ny - p(17)), A.lui, font=f_name, fill=(0, 0, 0))
d.text((ax + p(46), ny + p(2)), "en ligne", font=f_sub, fill=GREY)
vx = p(338)  # caméra
d.rounded_rectangle([vx, ny - p(8), vx + p(19), ny + p(8)], radius=p(4), outline=BLUE, width=p(2))
d.polygon([(vx + p(20), ny - p(2)), (vx + p(28), ny - p(7)), (vx + p(28), ny + p(7)), (vx + p(20), ny + p(2))], outline=BLUE, width=p(2))

# --- Barre de saisie + indicateur d'accueil
iy = H - p(INPUT_H + HOME_H)
d.rectangle([0, iy, W, H], fill=NAVBG)
d.line([0, iy, W, iy], fill=(210, 210, 210), width=1)
my = iy + p(INPUT_H / 2)
d.line([(p(16), my), (p(32), my)], fill=BLUE, width=p(2.4)); d.line([(p(24), my - p(8)), (p(24), my + p(8))], fill=BLUE, width=p(2.4))
d.rounded_rectangle([p(46), my - p(17), p(292), my + p(17)], radius=p(17), fill=(255, 255, 255), outline=(220, 220, 220), width=p(1))
d.rounded_rectangle([p(305), my - p(8), p(327), my + p(9)], radius=p(4), outline=BLUE, width=p(2))   # appareil photo
d.ellipse([p(311), my - p(4), p(321), my + p(6)], outline=BLUE, width=p(2))
d.rounded_rectangle([p(350), my - p(11), p(359), my + p(3)], radius=p(4.5), outline=BLUE, width=p(2))  # micro
d.arc([p(346), my - p(4), p(363), my + p(8)], 0, 180, fill=BLUE, width=p(2))
d.line([(p(354.5), my + p(8)), (p(354.5), my + p(12))], fill=BLUE, width=p(2))
d.rounded_rectangle([(W - p(134)) / 2, H - p(13), (W + p(134)) / 2, H - p(8)], radius=p(3), fill=(0, 0, 0))

img.save(A.out)
print(A.out, img.size)
