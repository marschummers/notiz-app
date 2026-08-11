from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
COPPER = "#b97c45"


def render(size: int, target: str) -> None:
    scale = 4
    canvas = size * scale
    ratio = canvas / 512
    image = Image.new("RGB", (canvas, canvas), "#e8e8e8")
    draw = ImageDraw.Draw(image)

    def box(cx: float, cy: float, radius: float) -> tuple[float, float, float, float]:
        return tuple(value * ratio for value in (cx - radius, cy - radius, cx + radius, cy + radius))

    draw.ellipse(box(256, 256, 236), fill="white")
    center = (256 * ratio, 256 * ratio)
    for x, y in ((188, 124), (350, 154), (130, 302), (400, 322), (254, 420)):
        draw.line((center, (x * ratio, y * ratio)), fill=COPPER, width=round(20 * ratio))

    for x, y, radius in ((256, 256, 52), (188, 124, 38), (350, 154, 32), (130, 302, 40), (400, 322, 32), (254, 420, 31)):
        draw.ellipse(box(x, y, radius), fill=COPPER)

    image.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / target, optimize=True)


render(512, "icon-512.png")
render(192, "icon-192.png")
render(180, "apple-touch-icon.png")
render(32, "favicon-32.png")
