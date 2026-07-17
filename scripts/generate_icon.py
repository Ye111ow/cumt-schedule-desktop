from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SIZE = 256


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def build_icon() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (SIZE, SIZE))
    pixels = gradient.load()
    top = (35, 93, 112)
    bottom = (31, 166, 128)
    for y in range(SIZE):
        ratio = y / (SIZE - 1)
        for x in range(SIZE):
            glow = max(0.0, 1.0 - ((x - 195) ** 2 + (y - 35) ** 2) ** 0.5 / 260)
            pixels[x, y] = tuple(
                min(255, int(top[channel] * (1 - ratio) + bottom[channel] * ratio + glow * 12))
                for channel in range(3)
            ) + (255,)
    image.alpha_composite(Image.composite(gradient, Image.new("RGBA", image.size), rounded_mask(SIZE, 54)))
    draw = ImageDraw.Draw(image)

    # Soft calendar body.
    draw.rounded_rectangle((46, 50, 210, 211), radius=29, fill=(8, 25, 39, 92), outline=(255, 255, 255, 88), width=4)
    draw.line((48, 94, 208, 94), fill=(255, 255, 255, 92), width=4)
    draw.rounded_rectangle((78, 36, 91, 69), radius=7, fill=(218, 255, 243, 255))
    draw.rounded_rectangle((165, 36, 178, 69), radius=7, fill=(218, 255, 243, 255))

    # Three clean timetable blocks form a subtle “课” rhythm without tiny text.
    draw.rounded_rectangle((67, 113, 111, 185), radius=12, fill=(112, 232, 190, 255))
    draw.rounded_rectangle((121, 113, 189, 143), radius=11, fill=(161, 143, 244, 255))
    draw.rounded_rectangle((121, 153, 189, 185), radius=11, fill=(245, 160, 108, 255))
    draw.rounded_rectangle((77, 124, 100, 130), radius=3, fill=(16, 70, 59, 170))
    draw.rounded_rectangle((77, 137, 98, 143), radius=3, fill=(16, 70, 59, 105))
    draw.rounded_rectangle((132, 124, 175, 130), radius=3, fill=(45, 32, 96, 120))
    draw.rounded_rectangle((132, 165, 173, 171), radius=3, fill=(107, 47, 23, 120))
    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    icon = build_icon()
    icon.save(ASSETS / "icon.png", format="PNG", optimize=True)
    icon.save(ASSETS / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
