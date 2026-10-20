"""Generate the Google Wallet pass images: logo.png (512x512) and hero.png (1024x640).

Both are referenced by the loyalty class (programLogo / heroImage). Google
requires them to be publicly reachable PNG/JPEG, so they are committed to the
repo root and served by whatever host the site is deployed to.

Run:  python make_images.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))

NAVY = (10, 31, 51)
GREEN = (14, 188, 123)
MINT = (231, 247, 239)
WHITE = (255, 255, 255)


def font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                pass
    return ImageFont.load_default()


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def build_logo(size=1024):
    """Google Wallet masks the logo into a circle.

    Spec: PNG, 1:1, min 660px, artwork inside an 840px safe area (15% margin)
    within the image. We use 1024x1024 and keep all artwork inside the safe
    circle so nothing is clipped by the mask.
    """
    img = Image.new("RGB", (size, size), MINT)
    d = ImageDraw.Draw(img)

    # Full-bleed navy disc, sized to sit inside the 840px safe area.
    disc = int(size * 0.78)
    r = disc / 2.0
    cx, cy = size / 2.0, size / 2.0
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=NAVY)

    # Loyalty card glyph: rounded card with a green stripe.
    cw = int(disc * 0.50)
    cx0 = int(cx - cw / 2)
    cy0 = int(size * 0.235)
    rounded(d, (cx0, cy0, cx0 + cw, cy0 + int(cw * 0.74)), int(size * 0.030), WHITE)
    d.rectangle((cx0, cy0 + int(cw * 0.16), cx0 + cw, cy0 + int(cw * 0.31)), fill=GREEN)

    # Stamp circle
    sr = int(disc * 0.14)
    scx, scy = int(cx), cy0 + int(cw * 0.62)
    d.ellipse((scx - sr, scy - sr, scx + sr, scy + sr), outline=NAVY, width=max(3, int(size * 0.009)))
    d.ellipse((scx - sr + int(size * 0.015), scy - sr + int(size * 0.015),
               scx + sr - int(size * 0.015), scy + sr - int(size * 0.015)),
              outline=NAVY, width=max(2, int(size * 0.006)))

    # Wordmark: white, auto-fitted so the circular mask never clips it.
    # The text sits below centre, so the tightest constraint is the chord at
    # the BOTTOM of the glyph (descenders of "y"/"p"), not at its top.
    text_y = int(size * 0.600)
    fs = int(disc * 0.20)
    while fs > 10:
        f = font(fs, bold=True)
        bb = d.textbbox((0, 0), "LoyalUp", font=f)
        w = bb[2] - bb[0]
        h = bb[3] - bb[1]
        bottom = text_y + h
        chord = 2 * math.sqrt(max(r * r - (bottom - cy) ** 2, 1.0))
        if w <= chord * 0.82 and bottom <= cy + r * 0.97:
            break
        fs -= 2
    f = font(fs, bold=True)
    bb = d.textbbox((0, 0), "LoyalUp", font=f)
    tw = bb[2] - bb[0]
    d.text((cx - tw / 2 - bb[0], text_y - bb[1]), "LoyalUp", font=f, fill=WHITE)
    return img


def build_hero(w=1032, h=812):
    """Hero image spec: PNG, 1032x812 px, ~5:4 aspect ratio."""
    img = Image.new("RGB", (w, h), NAVY)
    d = ImageDraw.Draw(img)

    # Soft mint glow blobs
    blob = Image.new("RGB", (w, h), NAVY)
    bd = ImageDraw.Draw(blob)
    bd.ellipse((int(w * 0.58), -int(h * 0.42), int(w * 1.30), int(h * 0.72)), fill=(14, 188, 123))
    bd.ellipse((int(w * 0.76), int(h * 0.58), int(w * 1.20), int(h * 1.50)), fill=(10, 168, 110))
    img = Image.blend(img, blob, 0.30)
    d = ImageDraw.Draw(img)

    # Left text block
    x, y = int(w * 0.075), int(h * 0.26)
    d.text((x, y), "LoyalUp", font=font(int(h * 0.155), bold=True), fill=WHITE)
    d.text((x, y + int(h * 0.185)), "Collect stamps. Earn rewards.",
           font=font(int(h * 0.052)), fill=(190, 226, 210))

    # Stamps row
    sy = int(h * 0.66)
    r = int(h * 0.048)
    for i in range(5):
        cx = x + r + i * int(r * 2.6)
        filled = i < 3
        d.ellipse((cx - r, sy - r, cx + r, sy + r),
                  fill=GREEN if filled else (0, 0, 0),
                  outline=(120, 190, 160), width=3)
        if filled:
            d.ellipse((cx - r + 7, sy - r + 7, cx + r - 7, sy + r - 7), outline=WHITE, width=3)
    return img


def main():
    logo = build_logo()
    hero = build_hero()
    lp = os.path.join(ROOT, "logo.png")
    hp = os.path.join(ROOT, "hero.png")
    logo.save(lp, "PNG", optimize=True)
    hero.save(hp, "PNG", optimize=True)
    print("wrote", lp, os.path.getsize(lp), "bytes")
    print("wrote", hp, os.path.getsize(hp), "bytes")


if __name__ == "__main__":
    main()
