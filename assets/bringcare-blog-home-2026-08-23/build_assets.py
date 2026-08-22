from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
NAVY = "#071A3D"
BLUE = "#153FD1"
COBALT = "#2157FF"
PALE = "#EAF1FF"
GREEN = "#66B84F"
WHITE = "#FFFFFF"

FONT_B = r"C:\Windows\Fonts\malgunbd.ttf"
FONT_R = r"C:\Windows\Fonts\malgun.ttf"


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT_R, size)


def cover_crop(im, size):
    sw, sh = im.size
    tw, th = size
    scale = max(tw / sw, th / sh)
    nw, nh = round(sw * scale), round(sh * scale)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return im.crop((x, y, x + tw, y + th))


def logo_crop():
    ref = Image.open(ROOT / "brand-reference.png").convert("RGB")
    w, h = ref.size
    return ref.crop((int(w * .785), int(h * .012), int(w * .982), int(h * .105)))


def add_logo(canvas, xy, width):
    logo = logo_crop()
    ratio = width / logo.width
    logo = logo.resize((width, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    canvas.paste(logo, xy)
    return logo.size


def make_cover(size, out_name):
    bg = cover_crop(Image.open(ROOT / "source-cover.png").convert("RGB"), size)
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    w, h = size
    od.rectangle((0, 0, w * .63, h), fill=(255, 255, 255, 210))
    for x in range(int(w * .45), int(w * .72)):
        alpha = int(210 * (1 - (x - w * .45) / (w * .27)))
        od.line((x, 0, x, h), fill=(255, 255, 255, max(0, alpha)))
    bg = Image.alpha_composite(bg.convert("RGBA"), overlay).convert("RGB")
    d = ImageDraw.Draw(bg)
    scale = w / 2560
    left = int(250 * scale)
    add_logo(bg, (left, int(125 * scale)), int(390 * scale))
    d.text((left, int(345 * scale)), "건물 관리의 모든 것,", font=font(int(90 * scale), True), fill=NAVY)
    d.text((left, int(455 * scale)), "브링케어", font=font(int(108 * scale), True), fill=COBALT)
    d.rounded_rectangle((left, int(610 * scale), int(1080 * scale), int(684 * scale)), radius=int(35 * scale), fill=BLUE)
    d.text((int(298 * scale), int(621 * scale)), "현장 확인부터 완료 보고까지", font=font(int(42 * scale), True), fill=WHITE)
    d.text((left, int(755 * scale)), "공실관리  ·  세입자 응대  ·  청소  ·  수리조율  ·  사진보고", font=font(int(32 * scale)), fill=NAVY)
    d.rectangle((left, int(842 * scale), int(560 * scale), int(852 * scale)), fill=GREEN)
    bg.save(ROOT / out_name, quality=95)


def make_profile():
    size = 1024
    im = Image.new("RGB", (size, size), PALE)
    d = ImageDraw.Draw(im)
    d.ellipse((85, 85, 939, 939), fill=WHITE, outline=COBALT, width=14)
    logo = logo_crop()
    ratio = 650 / logo.width
    logo = logo.resize((650, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    im.paste(logo, ((size - logo.width) // 2, 345))
    d.rounded_rectangle((280, 660, 744, 732), radius=36, fill=BLUE)
    d.text((512, 696), "건물관리 전문", font=font(36, True), anchor="mm", fill=WHITE)
    im.save(ROOT / "bringcare-profile-1024.png")


def category(source, title, subtitle, out_name, accent):
    size = 1080
    bg = cover_crop(Image.open(ROOT / source).convert("RGB"), (size, size))
    bg = bg.filter(ImageFilter.GaussianBlur(.3)).convert("RGBA")
    shade = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    sd.rectangle((0, 0, size, 250), fill=(7, 26, 61, 220))
    sd.rectangle((0, 790, size, size), fill=(255, 255, 255, 238))
    sd.rectangle((0, 250, 18, 790), fill=accent)
    bg = Image.alpha_composite(bg, shade).convert("RGB")
    d = ImageDraw.Draw(bg)
    d.text((70, 75), title, font=font(66, True), fill=WHITE)
    d.text((72, 165), subtitle, font=font(31), fill="#D7E4FF")
    d.rounded_rectangle((70, 845, 235, 905), radius=30, fill=accent)
    d.text((152, 875), "BRING CARE", font=font(23, True), anchor="mm", fill=WHITE)
    d.text((70, 940), "관리의 기준을 기록합니다", font=font(38, True), fill=NAVY)
    bg.save(ROOT / out_name)


def contact_sheet():
    items = [
        ("상단 커버", Image.open(ROOT / "bringcare-blog-cover-1920x640.png")),
        ("프로필", Image.open(ROOT / "bringcare-profile-1024.png")),
        ("생활 속 관리정보", Image.open(ROOT / "category-living-info-1080.png")),
        ("브링케어 현장기록", Image.open(ROOT / "category-field-records-1080.png")),
        ("건물주 관리가이드", Image.open(ROOT / "category-owner-guide-1080.png")),
    ]
    sheet = Image.new("RGB", (1800, 1420), "#F5F8FF")
    d = ImageDraw.Draw(sheet)
    d.text((80, 55), "브링케어 네이버 블로그 홈 디자인", font=font(52, True), fill=NAVY)
    cover = cover_crop(items[0][1], (1640, 547))
    sheet.paste(cover, (80, 145))
    d.text((80, 710), items[0][0], font=font(28, True), fill=NAVY)
    for i, (label, im) in enumerate(items[1:]):
        thumb = cover_crop(im, (370, 370))
        x = 80 + i * 410
        sheet.paste(thumb, (x, 790))
        d.text((x, 1180), label, font=font(26, True), fill=NAVY)
    d.text((80, 1300), "건물주 우선 · 현장성과 생활정보를 함께 보여주는 통합형 디자인", font=font(32, True), fill=BLUE)
    sheet.save(ROOT / "bringcare-blog-home-preview.png")


if __name__ == "__main__":
    make_cover((2560, 960), "bringcare-blog-cover-master.png")
    make_cover((1920, 640), "bringcare-blog-cover-1920x640.png")
    make_profile()
    category("source-living.png", "생활 속 관리정보", "건물과 생활을 오래 지키는 실용 관리 팁", "category-living-info-1080.png", COBALT)
    category("source-field.png", "브링케어 현장기록", "점검부터 처리 완료까지, 현장 그대로", "category-field-records-1080.png", BLUE)
    category("source-owner.png", "건물주 관리가이드", "공실·민원·유지보수를 체계적으로", "category-owner-guide-1080.png", GREEN)
    contact_sheet()
