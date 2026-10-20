#!/usr/bin/env python3
"""Draw the app icons (needs Pillow): python3 tools/make-icons.py"""
import math
from PIL import Image, ImageDraw

PLANE = [(0, -0.95), (0.12, -0.7), (0.12, -0.2), (0.95, 0.3), (0.95, 0.5), (0.12, 0.3), (0.12, 0.7),
         (0.35, 0.85), (0.35, 0.95), (0, 0.85), (-0.35, 0.95), (-0.35, 0.85), (-0.12, 0.7), (-0.12, 0.3),
         (-0.95, 0.5), (-0.95, 0.3), (-0.12, -0.2), (-0.12, -0.7)]

def icon(size, path):
    s = size * 4
    img = Image.new("RGB", (s, s), (10, 16, 32))
    d = ImageDraw.Draw(img)
    c = s / 2
    for r, a in ((0.46, 60), (0.30, 90)):
        d.ellipse([c - s * r, c - s * r, c + s * r, c + s * r], outline=(60 + a, 90 + a, 160 + a // 2), width=max(2, s // 60))
    ang = math.radians(40)
    pts = []
    for x, y in PLANE:
        x, y = x * 0.36 * s, y * 0.36 * s
        pts.append((c + x * math.cos(ang) - y * math.sin(ang), c + x * math.sin(ang) + y * math.cos(ang)))
    d.polygon(pts, fill=(94, 224, 255))
    img.resize((size, size), Image.LANCZOS).save(path)

icon(80, "app/icon.png")
icon(130, "app/largeIcon.png")
