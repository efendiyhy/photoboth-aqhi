#!/usr/bin/env python3
"""
Generator template Photobooth AQHI Lab.

Menghasilkan 10 template PNG (slot foto transparan) + public/templates/templates.json.
Jalankan ulang jika ingin mengubah desain bawaan:

    pip install pillow
    python3 tools/generate_templates.py

Template buatan Figma tinggal menggantikan file PNG di public/templates/
dan mengedit koordinat slot di templates.json (lihat README.md).
"""
import json
import math
import os
import random
from contextlib import contextmanager

from PIL import Image, ImageChops, ImageDraw, ImageFont

S = 2  # supersampling agar tepi halus
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_DIR = os.path.join(ROOT, "public", "templates")

FONT_BOLD = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "/usr/share/fonts/truetype/google-fonts/ofl/comicrelief/ComicRelief-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
FONT_MED = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def font(size, bold=True):
    for path in (FONT_BOLD if bold else FONT_MED):
        if os.path.exists(path):
            return ImageFont.truetype(path, int(size * S))
    return ImageFont.load_default()


# ---- palet ---------------------------------------------------------------
NAVY = "#12466b"
DEEP_TEAL = "#0b6f73"
SKY = "#8fd8ff"
SKY_L = "#e6f7ff"
TEAL = "#3fd6c4"
TEAL_L = "#d7faf4"
MINT = "#aef0c8"
WHITE = "#ffffff"
PINK = "#ff9bb8"
PINK_D = "#e0577f"
SUN = "#ffd84a"
SUN_D = "#f0a800"
LEAF = "#5fd08a"
LEAF_D = "#2f9e5a"
BROWN = "#a9703f"
DARK = "#23323f"

# Skala AQHI 1-10+ (standar Kanada)
AQHI = ["#01cbff", "#0099cb", "#016797", "#fffe03", "#ffcb00", "#ff9835",
        "#fd6866", "#fe0002", "#cc0001", "#9a0100", "#640100"]
AQHI_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10+"]


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class P:
    """Kanvas RGBA dengan koordinat dalam piksel template (otomatis x S)."""

    def __init__(self, w, h, base=None):
        self.W, self.H = w, h
        self.im = base if base is not None else Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def _w(self, w):
        return max(int(round(w * S)), 0)

    def circ(self, cx, cy, r, fill=None, outline=None, w=0):
        self.d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S],
                       fill=fill, outline=outline, width=self._w(w))

    def ell(self, cx, cy, rx, ry, fill=None, outline=None, w=0):
        self.d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S],
                       fill=fill, outline=outline, width=self._w(w))

    def rr(self, x, y, w, h, r, fill=None, outline=None, ow=0):
        self.d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S],
                                 radius=r * S, fill=fill, outline=outline, width=self._w(ow))

    def poly(self, pts, fill=None, outline=None, w=0):
        self.d.polygon([(x * S, y * S) for x, y in pts], fill=fill)
        if outline and w:
            self.line(pts + [pts[0]], outline, w)

    def line(self, pts, fill, w):
        sp = [(x * S, y * S) for x, y in pts]
        self.d.line(sp, fill=fill, width=self._w(w), joint="curve")
        r = w / 2.0
        for x, y in (pts[0], pts[-1]):
            self.circ(x, y, r, fill=fill)

    def arc(self, cx, cy, r, a0, a1, fill, w):
        self.d.arc([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S],
                   a0, a1, fill=fill, width=self._w(w))

    def text(self, x, y, s, f, fill, anchor="mm", stroke=0, stroke_fill=None):
        self.d.text((x * S, y * S), s, font=f, fill=fill, anchor=anchor,
                    stroke_width=self._w(stroke), stroke_fill=stroke_fill)

    @contextmanager
    def alpha(self, a):
        q = P(self.W, self.H)
        yield q
        if a < 1:
            ch = q.im.split()[3].point(lambda v: int(v * a))
            q.im.putalpha(ch)
        self.im.alpha_composite(q.im)


def gradient(w, h, c1, c2):
    g = Image.linear_gradient("L").resize((w, h))
    return Image.composite(Image.new("RGB", (w, h), c2), Image.new("RGB", (w, h), c1), g)


# ---- ikon lucu -------------------------------------------------------------
def face(p, cx, cy, r, blush=True, mouth="smile"):
    ex, ey, er = r * 0.38, cy - r * 0.05, max(r * 0.11, 2.5)
    for sx in (-1, 1):
        p.circ(cx + sx * ex, ey, er, fill=DARK)
        p.circ(cx + sx * ex - er * 0.3, ey - er * 0.3, er * 0.38, fill=WHITE)
        if blush:
            p.ell(cx + sx * r * 0.62, cy + r * 0.24, r * 0.17, r * 0.1, fill="#ff9fb0")
    mw = max(r * 0.05, 1.6)
    if mouth == "smile":
        p.arc(cx, cy + r * 0.06, r * 0.2, 20, 160, DARK, mw)
    elif mouth == "o":
        p.circ(cx, cy + r * 0.3, r * 0.08, fill=DARK)
    else:  # grin
        p.d.pieslice([(cx - r * 0.2) * S, (cy + r * 0.02) * S, (cx + r * 0.2) * S, (cy + r * 0.38) * S],
                     0, 180, fill=DARK)


def sparkle(p, cx, cy, r, col=WHITE, outline=None):
    pts = []
    for i in range(8):
        a = math.radians(i * 45 - 90)
        rad = r if i % 2 == 0 else r * 0.28
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    p.poly(pts, fill=col, outline=outline, w=2 if outline else 0)


def star(p, cx, cy, r, col=SUN, outline=SUN_D):
    pts = []
    for i in range(10):
        a = math.radians(i * 36 - 90)
        rad = r if i % 2 == 0 else r * 0.5
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    p.poly(pts, fill=col, outline=outline, w=max(r * 0.09, 2))


def heart(p, cx, cy, r, col=PINK, outline=PINK_D):
    pts = []
    for i in range(60):
        t = i / 60.0 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * r / 17.0, cy - y * r / 17.0 - r * 0.05))
    p.poly(pts, fill=col, outline=outline, w=max(r * 0.08, 2))


def drop(p, cx, cy, r, col=SKY, outline="#2a9bd6", with_face=True):
    c = (cx, cy + 0.3 * r)
    rho = 0.68 * r
    tip = (cx, cy - r)
    beta = math.degrees(math.acos(rho / (1.3 * r)))
    pts = [tip]
    a = -90 + beta
    while a <= -90 - beta + 360:
        pts.append((c[0] + rho * math.cos(math.radians(a)), c[1] + rho * math.sin(math.radians(a))))
        a += 6
    p.poly(pts, fill=col, outline=outline, w=max(r * 0.07, 2))
    p.ell(cx - rho * 0.45, c[1] - rho * 0.25, rho * 0.12, rho * 0.22, fill="#ffffffaa")
    if with_face:
        face(p, cx, c[1] + rho * 0.12, rho * 0.8)


def cloud(p, cx, cy, r, fill=WHITE, outline="#7cc4ec", with_face=True, ow=None):
    ow = ow if ow is not None else max(r * 0.07, 2.5)
    shapes = [("c", -0.55, 0.12, 0.42), ("c", -0.15, -0.22, 0.55), ("c", 0.42, -0.02, 0.45), ("c", 0.72, 0.2, 0.3)]
    for grow, col in ((ow, outline), (0, fill)):
        for _, dx, dy, rad in shapes:
            p.circ(cx + dx * r, cy + dy * r, rad * r + grow, fill=col)
        p.rr(cx - 0.95 * r - grow, cy + 0.05 * r - grow, 1.95 * r + 2 * grow, 0.62 * r + 2 * grow, 0.3 * r, fill=col)
    if with_face:
        face(p, cx - 0.05 * r, cy + 0.15 * r, r * 0.62)


def sun(p, cx, cy, r, with_face=True):
    for i in range(12):
        a = math.radians(i * 30)
        x0, y0 = cx + r * 1.12 * math.cos(a), cy + r * 1.12 * math.sin(a)
        x1, y1 = cx + r * 1.5 * math.cos(a), cy + r * 1.5 * math.sin(a)
        p.line([(x0, y0), (x1, y1)], SUN_D, r * 0.2)
        p.line([(x0, y0), (x1, y1)], SUN, r * 0.1)
    p.circ(cx, cy, r, fill=SUN, outline=SUN_D, w=max(r * 0.07, 2.5))
    if with_face:
        face(p, cx, cy, r)


def leaf(p, cx, cy, r, ang=-30, fill=LEAF, outline=LEAF_D):
    pts = []
    n = 24
    for sgn in (1, -1):
        for i in range(n + 1):
            t = i / float(n) if sgn == 1 else 1 - i / float(n)
            x = -r + 2 * r * t
            y = sgn * 0.55 * r * math.sin(math.pi * t) * (1 - 0.25 * t)
            pts.append((x, y))
    rot = math.radians(ang)
    rp = [(cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)) for x, y in pts]
    p.poly(rp, fill=fill, outline=outline, w=max(r * 0.07, 2))
    a = (cx - r * 0.8 * math.cos(rot), cy - r * 0.8 * math.sin(rot))
    b = (cx + r * 0.75 * math.cos(rot), cy + r * 0.75 * math.sin(rot))
    p.line([a, b], outline, max(r * 0.06, 1.8))


def flask(p, cx, cy, r, liquid=TEAL):
    outline = "#2b8fb5"
    body = [(-0.2, -0.95), (0.2, -0.95), (0.2, -0.35), (0.8, 0.75), (0.7, 0.9), (-0.7, 0.9), (-0.8, 0.75), (-0.2, -0.35)]
    pts = [(cx + x * r, cy + y * r) for x, y in body]
    p.poly(pts, fill="#f2fbff", outline=outline, w=max(r * 0.07, 2.5))
    liq = [(-0.44, 0.15), (0.44, 0.15), (0.8, 0.75), (0.7, 0.9), (-0.7, 0.9), (-0.8, 0.75)]
    p.poly([(cx + x * r, cy + y * r) for x, y in liq], fill=liquid)
    p.rr(cx - 0.3 * r, cy - 1.05 * r, 0.6 * r, 0.16 * r, r * 0.07, fill=outline)
    for dx, dy, rad in ((-0.2, 0.0, 0.07), (0.25, -0.1, 0.05), (0.1, -0.3, 0.06)):
        p.circ(cx + dx * r, cy + dy * r, rad * r, fill="#ffffffcc", outline=outline, w=1.5)
    face(p, cx, cy + 0.5 * r, r * 0.5)


def testtube(p, cx, cy, r, col=PINK, ang=20):
    rot = math.radians(ang)
    def T(x, y):
        return (cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot))
    w = 0.3 * r
    top, bot = -r, r
    pts = [T(-w, top)] + [T(-w, bot - w)] + [T(w * math.cos(math.radians(a)), bot - w + w * math.sin(math.radians(a))) for a in range(180, -1, -15)][::-1] + [T(w, top)]
    pts = [T(-w, top), T(w, top)] + [T(w * math.cos(math.radians(a)), bot - w + w * math.sin(math.radians(a))) for a in range(0, 181, 15)]
    p.poly(pts, fill="#f2fbff", outline="#2b8fb5", w=max(r * 0.06, 2))
    liq = [T(-w, 0.1 * r), T(w, 0.1 * r)] + [T(w * math.cos(math.radians(a)), bot - w + w * math.sin(math.radians(a))) for a in range(0, 181, 15)]
    p.poly(liq, fill=col)
    p.circ(*T(0, 0.55 * r), r * 0.07, fill="#ffffffcc")


def atom(p, cx, cy, r, col="#2b8fb5"):
    for ang in (0, 60, 120):
        rot = math.radians(ang)
        pts = []
        for i in range(48):
            t = i / 48.0 * 2 * math.pi
            x, y = r * math.cos(t), r * 0.38 * math.sin(t)
            pts.append((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)))
        p.poly(pts, outline=col, w=max(r * 0.07, 2))
    p.circ(cx, cy, r * 0.26, fill=SUN, outline=SUN_D, w=2)
    face(p, cx, cy, r * 0.26, blush=False, mouth="o")
    for ang, t in ((0, 0.0), (60, 2.0), (120, 4.2)):
        rot = math.radians(ang)
        x, y = r * math.cos(t), r * 0.38 * math.sin(t)
        p.circ(cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot), r * 0.1, fill=PINK, outline=PINK_D, w=1.5)


def lungs(p, cx, cy, r):
    out = "#e0577f"
    p.rr(cx - 0.07 * r, cy - 1.0 * r, 0.14 * r, 0.7 * r, 0.06 * r, fill="#ffc2d3", outline=out, ow=max(r * 0.04, 1.5))
    p.line([(cx, cy - 0.35 * r), (cx - 0.45 * r, cy - 0.05 * r)], out, r * 0.07)
    p.line([(cx, cy - 0.35 * r), (cx + 0.45 * r, cy - 0.05 * r)], out, r * 0.07)
    for s in (-1, 1):
        p.ell(cx + s * 0.5 * r, cy + 0.25 * r, 0.5 * r, 0.75 * r, fill=PINK, outline=out, w=max(r * 0.05, 2))
        p.ell(cx + s * 0.62 * r, cy - 0.05 * r, 0.12 * r, 0.2 * r, fill="#ffffff88")
    face(p, cx, cy + 0.32 * r, r * 0.7)


def mask(p, cx, cy, r):
    p.circ(cx, cy, r, fill="#ffe2c6", outline="#e8b48a", w=max(r * 0.06, 2))
    p.line([(cx - r * 0.95, cy + 0.0 * r), (cx - r * 1.2, cy + 0.4 * r)], "#7cc4ec", r * 0.05)
    p.line([(cx + r * 0.95, cy + 0.0 * r), (cx + r * 1.2, cy + 0.4 * r)], "#7cc4ec", r * 0.05)
    ex, ey, er = r * 0.38, cy - r * 0.2, r * 0.11
    for s in (-1, 1):
        p.circ(cx + s * ex, ey, er, fill=DARK)
        p.circ(cx + s * ex - er * 0.3, ey - er * 0.3, er * 0.38, fill=WHITE)
        p.ell(cx + s * r * 0.66, cy + r * 0.12, r * 0.15, r * 0.09, fill="#ff9fb0")
    p.rr(cx - 0.85 * r, cy + 0.05 * r, 1.7 * r, 0.8 * r, 0.25 * r, fill="#bfe8ff", outline="#5ab2e6", ow=max(r * 0.05, 2))
    for k in (0.28, 0.5, 0.72):
        p.line([(cx - 0.7 * r, cy + k * r), (cx + 0.7 * r, cy + k * r)], "#8fd0f5", r * 0.04)
    p.circ(cx, cy + 0.45 * r, r * 0.1, fill=WHITE)


def shield(p, cx, cy, r):
    pts = [(-0.8, -0.8), (0, -1.0), (0.8, -0.8), (0.8, 0.0)]
    pts = [(cx + x * r, cy + y * r) for x, y in pts]
    for a in range(0, 181, 12):
        pts.append((cx + 0.8 * r * math.cos(math.radians(a)), cy + 0.0 * r + 0.95 * r * math.sin(math.radians(a))))
    p.poly(pts, fill=TEAL, outline="#1aa393", w=max(r * 0.07, 2.5))
    p.poly([(cx - 0.62 * r, cy - 0.65 * r), (cx, cy - 0.82 * r), (cx + 0.62 * r, cy - 0.65 * r),
            (cx + 0.62 * r, cy + 0.0 * r), (cx, cy + 0.72 * r), (cx - 0.62 * r, cy + 0.0 * r)], fill="#c7fbf3")
    face(p, cx, cy - 0.05 * r, r * 0.55)
    p.line([(cx - 0.2 * r, cy + 0.38 * r), (cx - 0.02 * r, cy + 0.52 * r), (cx + 0.26 * r, cy + 0.2 * r)], "#1aa393", r * 0.09)


def bubble(p, cx, cy, r, col="#ffffff"):
    with p.alpha(0.55) as q:
        q.circ(cx, cy, r, fill="#ffffff55", outline=col, w=max(r * 0.07, 1.5))
    with p.alpha(0.9) as q:
        q.arc(cx, cy, r * 0.72, 200, 260, "#ffffff", max(r * 0.09, 1.5))


def wind(p, cx, cy, r, col="#ffffff", outline="#7cc4ec"):
    def swirl(y, length, curl, w, color):
        p.line([(cx - r, y), (cx - r + length, y)], color, w)
        p.arc(cx - r + length, y - curl, curl, -90, 180, color, w)
    for color, w in ((outline, r * 0.16), (col, r * 0.09)):
        swirl(cy - 0.35 * r, 1.5 * r, 0.3 * r, w, color)
        swirl(cy + 0.15 * r, 1.9 * r, 0.25 * r, w, color)
        p.line([(cx - r, cy + 0.6 * r), (cx + 0.5 * r, cy + 0.6 * r)], color, w)


def tree(p, cx, cy, r):
    p.rr(cx - 0.12 * r, cy + 0.1 * r, 0.24 * r, 0.9 * r, 0.05 * r, fill=BROWN, outline="#7a4c24", ow=2)
    for grow, col in ((max(r * 0.06, 2), LEAF_D), (0, LEAF)):
        p.circ(cx, cy - 0.45 * r, 0.55 * r + grow, fill=col)
        p.circ(cx - 0.45 * r, cy - 0.05 * r, 0.45 * r + grow, fill=col)
        p.circ(cx + 0.45 * r, cy - 0.05 * r, 0.45 * r + grow, fill=col)
        p.circ(cx, cy + 0.05 * r, 0.45 * r + grow, fill=col)
    face(p, cx, cy - 0.12 * r, r * 0.62)


def molecule(p, cx, cy, r):
    atoms = [(0, 0, 0.36, TEAL, "#1aa393"), (-0.7, 0.45, 0.24, WHITE, "#7cc4ec"), (0.7, 0.45, 0.24, WHITE, "#7cc4ec")]
    for x, y, *_ in atoms[1:]:
        p.line([(cx, cy), (cx + x * r, cy + y * r)], "#7cc4ec", r * 0.1)
    for x, y, rad, col, ol in atoms:
        p.circ(cx + x * r, cy + y * r, rad * r, fill=col, outline=ol, w=max(r * 0.05, 1.5))
    face(p, cx, cy, r * 0.36, blush=False)


def microscope(p, cx, cy, r):
    out = "#2b8fb5"
    p.rr(cx - 0.65 * r, cy + 0.75 * r, 1.3 * r, 0.22 * r, 0.1 * r, fill="#8fd0f5", outline=out, ow=2.5)
    p.arc(cx + 0.1 * r, cy + 0.2 * r, 0.62 * r, -80, 90, out, r * 0.17)
    rot = math.radians(20)
    def T(x, y):
        return (cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot))
    p.poly([T(-0.16 * r, -0.95 * r), T(0.16 * r, -0.95 * r), T(0.16 * r, 0.1 * r), T(-0.16 * r, 0.1 * r)], fill=TEAL, outline=out, w=2.5)
    p.poly([T(-0.1 * r, -1.1 * r), T(0.1 * r, -1.1 * r), T(0.1 * r, -0.95 * r), T(-0.1 * r, -0.95 * r)], fill="#c7fbf3", outline=out, w=2)
    p.rr(cx - 0.5 * r, cy + 0.4 * r, 0.7 * r, 0.1 * r, 0.04 * r, fill="#c8e9f7", outline=out, ow=2)
    face(p, cx - 0.02 * r, cy - 0.35 * r, r * 0.34, blush=False)


def umbrella(p, cx, cy, r, col=PINK):
    p.line([(cx, cy), (cx, cy + 0.85 * r)], "#7a4c24", r * 0.08)
    p.arc(cx - 0.17 * r, cy + 0.85 * r, 0.17 * r, 0, 180, "#7a4c24", r * 0.08)
    p.d.pieslice([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], 180, 360, fill=col, outline=PINK_D, width=int(3 * S))
    for k in (-0.5, 0.5):
        p.line([(cx + k * r * 0.5, cy - 0.02 * r), (cx + k * r, cy - 0.0 * r)], WHITE, 1)
    p.line([(cx, cy), (cx - 0.55 * r, cy - 0.82 * r)], PINK_D, 2.2)
    p.line([(cx, cy), (cx + 0.55 * r, cy - 0.82 * r)], PINK_D, 2.2)
    face(p, cx, cy - 0.38 * r, r * 0.5)


def flower(p, cx, cy, r, col=PINK):
    for i in range(6):
        a = math.radians(i * 60)
        p.circ(cx + 0.55 * r * math.cos(a), cy + 0.55 * r * math.sin(a), 0.38 * r, fill=col, outline=PINK_D, w=1.8)
    p.circ(cx, cy, 0.42 * r, fill=SUN, outline=SUN_D, w=2)
    face(p, cx, cy, 0.42 * r, blush=False)


def rainbow(p, cx, cy, r, band):
    for i, col in enumerate(AQHI):
        rad = r - i * band
        p.arc(cx, cy, rad - band / 2.0, 180, 360, col, band + 1)


ICONS = {
    "sparkle": lambda p, x, y, r: sparkle(p, x, y, r, WHITE),
    "sparkle_y": lambda p, x, y, r: sparkle(p, x, y, r, SUN),
    "star": lambda p, x, y, r: star(p, x, y, r),
    "heart": lambda p, x, y, r: heart(p, x, y, r),
    "drop": lambda p, x, y, r: drop(p, x, y, r),
    "cloud": lambda p, x, y, r: cloud(p, x, y, r),
    "cloud_nf": lambda p, x, y, r: cloud(p, x, y, r, with_face=False),
    "sun": lambda p, x, y, r: sun(p, x, y, r * 0.7),
    "leaf": lambda p, x, y, r: leaf(p, x, y, r),
    "leaf2": lambda p, x, y, r: leaf(p, x, y, r, ang=40),
    "flask": lambda p, x, y, r: flask(p, x, y, r),
    "flask_p": lambda p, x, y, r: flask(p, x, y, r, liquid=PINK),
    "tube": lambda p, x, y, r: testtube(p, x, y, r),
    "atom": lambda p, x, y, r: atom(p, x, y, r),
    "lungs": lambda p, x, y, r: lungs(p, x, y, r),
    "mask": lambda p, x, y, r: mask(p, x, y, r),
    "shield": lambda p, x, y, r: shield(p, x, y, r),
    "bubble": lambda p, x, y, r: bubble(p, x, y, r),
    "wind": lambda p, x, y, r: wind(p, x, y, r),
    "tree": lambda p, x, y, r: tree(p, x, y, r),
    "molecule": lambda p, x, y, r: molecule(p, x, y, r),
    "microscope": lambda p, x, y, r: microscope(p, x, y, r),
    "umbrella": lambda p, x, y, r: umbrella(p, x, y, r),
    "flower": lambda p, x, y, r: flower(p, x, y, r),
}


# ---- komponen layout -------------------------------------------------------
def scale_bar(p, x, y, w, h, captions=False, label=True):
    """Skala indikator AQHI 1-10+."""
    n = len(AQHI)
    gap = max(w * 0.008, 3)
    seg = (w - gap * (n - 1)) / n
    p.rr(x - 10, y - 10, w + 20, h + 20 + (30 if captions else 0), (h + 20) / 2.0, fill=WHITE)
    for i, col in enumerate(AQHI):
        sx = x + i * (seg + gap)
        p.rr(sx, y, seg, h, h * 0.3, fill=col)
        tc = DARK if i in (3, 4) else WHITE
        p.text(sx + seg / 2, y + h / 2.0, AQHI_LABELS[i], font(h * (0.42 if i < 10 else 0.34)), tc)
    if captions:
        groups = [("Rendah", 0, 3), ("Sedang", 3, 6), ("Tinggi", 6, 10), ("Sangat Tinggi", 10, 11)]
        for name, a, b in groups:
            cx = x + (a * (seg + gap) + b * (seg + gap) - gap) / 2.0
            p.text(cx, y + h + 22, name, font(max(h * 0.3, 15), bold=False), NAVY)


def title(p, cx, y, text, size, color, stroke_col, sub=None, sub_size=28, sub_gap=70, sub_col=NAVY):
    p.text(cx + 4, y + 6, text, font(size), "#00000033", stroke=size * 0.06, stroke_fill="#00000033")
    p.text(cx, y, text, font(size), color, stroke=size * 0.07, stroke_fill=stroke_col)
    if sub:
        p.text(cx, y + sub_gap, sub, font(sub_size, bold=False), sub_col)


class Placer:
    """Menyebar ikon kecil di area kosong tanpa menabrak slot foto."""

    def __init__(self, slots, W, H, seed):
        self.slots, self.W, self.H = slots, W, H
        self.placed = []
        self.rects = []
        self.rng = random.Random(seed)

    def reserve(self, x, y, r):
        self.placed.append((x, y, r))

    def reserve_rect(self, x, y, w, h):
        self.rects.append((x, y, w, h))

    def free(self, x, y, r):
        for rx, ry, rw, rh in self.rects:
            if rx - r < x < rx + rw + r and ry - r < y < ry + rh + r:
                return False
        if x - r < 4 or y - r < 4 or x + r > self.W - 4 or y + r > self.H - 4:
            return False
        for s in self.slots:
            if (s["x"] - 26 - r < x < s["x"] + s["w"] + 26 + r) and (s["y"] - 26 - r < y < s["y"] + s["h"] + 26 + r):
                return False
        for px, py, pr in self.placed:
            if math.hypot(px - x, py - y) < pr + r + 6:
                return False
        return True

    def scatter(self, p, zones, kinds, n, rmin, rmax, tries=400):
        done = 0
        for _ in range(tries):
            if done >= n:
                break
            zx, zy, zw, zh = self.rng.choice(zones)
            r = self.rng.uniform(rmin, rmax)
            x, y = zx + self.rng.random() * zw, zy + self.rng.random() * zh
            if self.free(x, y, r):
                ICONS[self.rng.choice(kinds)](p, x, y, r)
                self.placed.append((x, y, r))
                done += 1


def frame_slots(p, slots, border, accent, shadow=True):
    for s in slots:
        x, y, w, h, rad = s["x"], s["y"], s["w"], s["h"], s["radius"]
        if shadow:
            with p.alpha(0.28) as q:
                q.rr(x - border + 6, y - border + 10, w + 2 * border, h + 2 * border, rad + border, fill="#0b3a5a")
        p.rr(x - border - 5, y - border - 5, w + 2 * border + 10, h + 2 * border + 10, rad + border + 5, fill=accent)
        p.rr(x - border, y - border, w + 2 * border, h + 2 * border, rad + border, fill=WHITE)


def punch(p, slots):
    mask_im = Image.new("L", p.im.size, 0)
    md = ImageDraw.Draw(mask_im)
    for s in slots:
        md.rounded_rectangle([s["x"] * S, s["y"] * S, (s["x"] + s["w"]) * S, (s["y"] + s["h"]) * S],
                             radius=s["radius"] * S, fill=255)
    alpha = p.im.split()[3]
    p.im.putalpha(ImageChops.multiply(alpha, ImageChops.invert(mask_im)))
    p.d = ImageDraw.Draw(p.im)


def tape(p, cx, cy, w, h, ang, col):
    rot = math.radians(ang)
    pts = []
    for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        pts.append((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)))
    with p.alpha(0.8) as q:
        q.poly(pts, fill=col)


# ---- layout slot -----------------------------------------------------------
def mk(rects, radius=34):
    return [dict(x=x, y=y, w=w, h=h, radius=radius) for x, y, w, h in rects]


LAYOUTS = {
    "strip3": dict(size=(600, 1800), format="strip", slots=mk([(40, 300, 520, 400), (40, 750, 520, 400), (40, 1200, 520, 400)], 30),
                   bar=(40, 1675, 520, 56), caps=False),
    "strip4": dict(size=(600, 1800), format="strip", slots=mk([(40, 235, 520, 320), (40, 591, 520, 320), (40, 947, 520, 320), (40, 1303, 520, 320)], 30),
                   bar=(40, 1695, 520, 52), caps=False),
    "r3": dict(size=(1200, 1800), format="4r", slots=mk([(80, 330, 1040, 410), (80, 780, 1040, 410), (80, 1230, 1040, 410)], 44),
               bar=(80, 1685, 1040, 70), caps=False),
    "r4": dict(size=(1200, 1800), format="4r", slots=mk([(80, 340, 500, 560), (620, 340, 500, 560), (80, 940, 500, 560), (620, 940, 500, 560)], 44),
               bar=(80, 1590, 1040, 80), caps=True),
    "r5": dict(size=(1200, 1800), format="4r", slots=mk([(80, 320, 1040, 470), (80, 830, 500, 400), (620, 830, 500, 400), (80, 1270, 500, 400), (620, 1270, 500, 400)], 44),
               bar=(80, 1700, 1040, 70), caps=False),
    "sq3": dict(size=(1200, 1200), format="square", slots=mk([(60, 240, 640, 760), (740, 240, 400, 360), (740, 640, 400, 360)], 40),
                bar=(80, 1075, 1040, 70), caps=False),
    "sq4": dict(size=(1200, 1200), format="square", slots=mk([(60, 240, 520, 370), (620, 240, 520, 370), (60, 650, 520, 370), (620, 650, 520, 370)], 40),
                bar=(80, 1085, 1040, 70), caps=False),
    "sq5": dict(size=(1200, 1200), format="square", slots=mk([(60, 215, 340, 300), (430, 215, 340, 300), (800, 215, 340, 300), (60, 555, 520, 390), (620, 555, 520, 390)], 36),
                bar=(80, 1030, 1040, 74), caps=True),
}

# ---- 10 template ----------------------------------------------------------
TEMPLATES = [
    dict(id="awan-ceria", name="Awan Ceria", layout="strip3", bg=("#8fd8ff", "#eafaff"), accent="#4cc3f5", ui="#4cc3f5",
         title="AQHI LAB", sub="Air Quality Health Impact", tsize=96, tcol=WHITE, tstroke=NAVY, dots=WHITE,
         hero=[("cloud", 80, 62, 46), ("sun", 520, 62, 44), ("cloud_nf", 300, 1768, 0)],
         scatter=["sparkle", "heart", "drop", "cloud_nf", "star", "sparkle_y"], stickers=["cloud", "heart", "star"]),
    dict(id="lab-buddies", name="Lab Buddies", layout="strip4", bg=("#7fe8d6", "#e0fcf7"), accent="#2fc9b4", ui="#2fc9b4",
         title="AQHI LAB", sub="Sains Udara Bersih", tsize=78, tcol=WHITE, tstroke=DEEP_TEAL, dots=WHITE,
         hero=[("flask", 54, 80, 40), ("atom", 548, 84, 40), ("microscope", 300, 1790, 0)],
         scatter=["molecule", "bubble", "sparkle", "tube", "drop", "sparkle_y"], stickers=["flask", "atom", "tube"]),
    dict(id="paru-sehat", name="Paru-paru Sehat", layout="r3", bg=("#bfe9ff", "#fff0f5"), accent="#ff9bb8", ui="#ff7fa3",
         title="PARU-PARU SEHAT", sub="Hirup udara bersih, hidup lebih sehat!", tsize=96, tcol=WHITE, tstroke="#d84a77", dots=WHITE,
         hero=[("lungs", 140, 150, 100), ("lungs", 1060, 150, 100)],
         scatter=["heart", "sparkle", "drop", "leaf", "cloud_nf", "bubble", "wind"], stickers=["heart", "lungs", "leaf"]),
    dict(id="clean-air-club", name="Clean Air Club", layout="r4", bg=("#b9f5d2", "#effff7"), accent="#4cc98a", ui="#4cc98a",
         title="CLEAN AIR CLUB", sub="Udara bersih untuk semua", tsize=104, tcol=WHITE, tstroke=LEAF_D, dots=WHITE,
         hero=[("tree", 120, 170, 90), ("tree", 1080, 170, 90), ("wind", 600, 1762, 0)],
         scatter=["leaf", "leaf2", "wind", "bubble", "sparkle", "flower", "cloud_nf"], stickers=["leaf", "tree", "flower", "wind"]),
    dict(id="aqhi-rainbow", name="AQHI Rainbow", layout="r5", bg=("#ffffff", "#dff4ff"), accent="#4cc3f5", ui="#ff9835",
         title="AQHI RAINBOW", sub="Skala indeks kualitas udara 1 - 10+", tsize=92, tcol=WHITE, tstroke=NAVY, dots="#bfe6fb",
         hero=[("rainbow", 600, 300, 0), ("cloud", 150, 240, 62), ("cloud", 1050, 240, 62)],
         scatter=["sparkle", "star", "heart", "drop", "sparkle_y", "cloud_nf"], stickers=["star", "cloud", "sun", "heart"]),
    dict(id="mask-hero", name="Mask Hero", layout="sq3", bg=("#8fd8ff", "#d5f7ff"), accent="#3fd6c4", ui="#3fd6c4",
         title="MASK HERO", sub="Lindungi diri dari polusi udara", tsize=104, tcol=WHITE, tstroke=NAVY, dots=WHITE,
         hero=[("mask", 120, 100, 62), ("shield", 1080, 100, 62)],
         scatter=["star", "sparkle", "sparkle_y", "cloud_nf", "drop", "heart"], stickers=["mask", "shield", "star", "cloud"]),
    dict(id="sunny-breeze", name="Sunny Breeze", layout="sq4", bg=("#dff8ff", "#ffffff"), accent="#ffd84a", ui="#ffc21a",
         title="SUNNY BREEZE", sub="Langit cerah, udara segar", tsize=104, tcol=WHITE, tstroke="#2a9bd6", dots="#bfe6fb",
         hero=[("sun", 120, 110, 50), ("cloud", 1075, 100, 56)],
         scatter=["wind", "flower", "sparkle_y", "bubble", "leaf", "cloud_nf", "heart"], stickers=["sun", "flower", "cloud", "wind"]),
    dict(id="bubble-science", name="Bubble Science", layout="sq5", bg=("#5fe0cf", "#c9f7ee"), accent="#ffffff", ui="#1fc4b0",
         title="BUBBLE SCIENCE", sub="Eksperimen seru bersama AQHI Lab", tsize=96, tcol=WHITE, tstroke=DEEP_TEAL, dots="#aef0e5",
         hero=[("flask", 115, 100, 58), ("atom", 1085, 100, 58)],
         scatter=["bubble", "bubble", "molecule", "sparkle", "tube", "drop", "sparkle_y"], stickers=["flask", "molecule", "atom", "bubble"]),
    dict(id="tree-power", name="Tree Power", layout="strip4", bg=("#a6f0c6", "#e6fcf4"), accent="#35b873", ui="#35b873",
         title="TREE POWER", sub="Pohon penyaring udara", tsize=68, tcol=WHITE, tstroke=LEAF_D, dots=WHITE,
         hero=[("tree", 58, 100, 44), ("tree", 542, 100, 44)],
         scatter=["leaf", "leaf2", "sparkle", "drop", "flower", "cloud_nf", "wind"], stickers=["tree", "leaf", "flower"]),
    dict(id="hujan-ceria", name="Hujan Ceria", layout="r4", bg=("#b7e3ff", "#eaf7ff"), accent="#6cc1f2", ui="#5eb8ef",
         title="HUJAN CERIA", sub="Hujan membersihkan udara", tsize=108, tcol=WHITE, tstroke="#2a74a8", dots=WHITE,
         hero=[("umbrella", 125, 190, 85), ("cloud", 1075, 160, 85)],
         scatter=["drop", "drop", "sparkle", "cloud_nf", "bubble", "heart", "umbrella"], stickers=["drop", "umbrella", "cloud", "heart"]),
]


def build(t):
    lay = LAYOUTS[t["layout"]]
    W, H = lay["size"]
    slots = lay["slots"]
    bg = gradient(W * S, H * S, *t["bg"]).convert("RGBA")
    p = P(W, H, base=bg)

    # polka dots halus
    with p.alpha(0.55) as q:
        step = 64
        for j in range(-1, H // step + 2):
            for i in range(-1, W // step + 2):
                ox = step / 2 if j % 2 else 0
                q.circ(i * step + ox, j * step, 7, fill=t["dots"])

    pl = Placer(slots, W, H, seed=hash(t["id"]) % 1000 + len(t["id"]))
    if t["id"] == "aqhi-rainbow":
        rainbow(p, 150, 300, 150, 9)
        rainbow(p, 1050, 300, 150, 9)
    for kind, x, y, r in t["hero"]:
        if kind == "rainbow" or r == 0:
            continue
        ICONS[kind](p, x, y, r)
        pl.reserve(x, y, r * 1.15)

    # judul
    ty = {"strip3": 150, "strip4": 105, "r3": 165, "r4": 160, "r5": 130, "sq3": 92, "sq4": 92, "sq5": 86}[t["layout"]]
    if t["layout"] in ("r3",):
        title(p, W / 2, ty, t["title"], t["tsize"] * 0.74, t["tcol"], t["tstroke"], t["sub"], 36, 85)
    else:
        sub_size = 28 if W == 600 else 38
        title(p, W / 2, ty, t["title"], t["tsize"], t["tcol"], t["tstroke"], t["sub"], sub_size, 70 if W == 600 else (72 if H == 1200 else 90))
        # judul yang tidak muat lebar strip diperkecil di bawah

    sub_off = 70 if W == 600 else (85 if t["layout"] == "r3" else (72 if H == 1200 else 90))
    pl.reserve_rect(10, ty - t["tsize"] * 0.65, W - 20, t["tsize"] * 0.65 + sub_off + 40)
    pl.reserve_rect(lay["bar"][0] - 20, lay["bar"][1] - 20, lay["bar"][2] + 40, lay["bar"][3] + 90)

    # dekorasi acak di zona kosong
    zones = [(10, 10, W - 20, lay["bar"][1] - 10), (10, lay["bar"][1] + 80, W - 20, max(H - lay["bar"][1] - 90, 1))]
    zones = [z for z in zones if z[3] > 20]
    # zona celah antar slot + tepi
    pl.scatter(p, [(0, 0, W, H)], t["scatter"], n=34 if W > 600 else 22,
               rmin=14 if W == 600 else 20, rmax=30 if W == 600 else 46)

    # foto frame + lubang
    frame_slots(p, slots, border=10 if W == 600 else 12, accent=t["accent"])
    punch(p, slots)

    # stiker menimpa sudut slot + washi tape
    rng = random.Random(len(t["id"]) * 7)
    for i, s in enumerate(slots):
        r = 40 if W == 600 else 62
        if s["w"] < 420:
            r = int(r * 0.8)
        left = (s["x"] + s["w"] / 2.0) < W / 2.0 if s["w"] < W * 0.7 else (i % 2 == 0)
        x = s["x"] - 6 if left else s["x"] + s["w"] + 6
        y = s["y"] + s["h"] * (0.1 if i % 2 == 0 else 0.9)
        tape_col = rng.choice(["#ffd84a", "#ff9bb8", "#8fe3ff", "#aef0c8"])
        tape(p, s["x"] + s["w"] * (0.2 if i % 2 else 0.8), s["y"] - 12, 110 if W > 600 else 80, 30 if W > 600 else 22, rng.choice([-8, 7, -4, 9]), tape_col)
        ICONS[t["stickers"][i % len(t["stickers"])]](p, x, y, r)

    # skala AQHI
    bx, by, bw, bh = lay["bar"]
    scale_bar(p, bx, by, bw, bh, captions=lay["caps"])

    out = p.im.resize((W, H), Image.LANCZOS)
    os.makedirs(OUT_DIR, exist_ok=True)
    fname = "%s.png" % t["id"]
    out.save(os.path.join(OUT_DIR, fname), optimize=True)
    return dict(id=t["id"], name=t["name"], file=fname, width=W, height=H, format=lay["format"],
                color=t["ui"], slots=[dict(x=s["x"], y=s["y"], w=s["w"], h=s["h"], radius=s["radius"]) for s in slots])


def main():
    items = [build(t) for t in TEMPLATES]
    cfg = {
        "version": 1,
        "note": "Koordinat slot dalam piksel template (x, y, w, h). Ganti PNG + angka ini dengan hasil Figma.",
        "templates": items,
    }
    with open(os.path.join(OUT_DIR, "templates.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("OK: %d template -> %s" % (len(items), OUT_DIR))


if __name__ == "__main__":
    main()
