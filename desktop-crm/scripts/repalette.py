"""화면별 CSS 의 색을 역할에 따라 토스 팔레트로 일괄 치환한다.

색 이름을 하나하나 나열하지 않고, 각 색의 밝기·채도·계열(색상환 각도)을
계산해 어떤 자리에 쓰이는 색인지 추정한 뒤 대응하는 팔레트 값으로 바꾼다.
"""
import colorsys, glob, re, sys, collections

# 토스 팔레트
WHITE   = "#FFFFFF"
BG      = "#F2F4F6"
PANEL2  = "#FAFBFC"
FILL    = "#F2F4F6"
FILLH   = "#E8EBED"
LINE    = "#E5E8EB"
LINE2   = "#DFE3E8"
DIM     = "#B0B8C1"
MUTED   = "#8B95A1"
SOFT    = "#4E5968"
INK     = "#191F28"
BLUE    = "#3182F6"
BLUE_D  = "#1B64DA"
BLUE_L  = "#E8F3FF"
BLUE_M  = "#8FBFFB"

RED     = "#F04452"; RED_D = "#E0303F"; RED_L = "#FFEFF0"; RED_M = "#F7A6AD"
GREEN   = "#00C471"; GREEN_D = "#04A66B"; GREEN_L = "#E6F8F0"; GREEN_M = "#7FDDB4"
AMBER   = "#FFB020"; AMBER_D = "#C77A00"; AMBER_L = "#FFF6E5"; AMBER_M = "#FFD98A"

def family(h_deg, sat):
    if sat < 0.10:
        return "neutral"
    if h_deg < 18 or h_deg >= 336:  return "red"
    if 18 <= h_deg < 46:            return "amber"
    if 46 <= h_deg < 74:            return "amber"
    if 74 <= h_deg < 166:           return "green"
    if 166 <= h_deg < 258:          return "blue"
    return "purple"

def pick(fam, light, sat):
    """밝기 구간에 맞는 같은 역할의 팔레트 색을 고른다."""
    if fam == "neutral" or fam == "blue":
        # 브랜드 파랑으로 볼 수 있는 건 '또렷하고 중간 밝기' 인 색뿐이다.
        # 짙은 남색 글자(예: #315d75)까지 파랑으로 바꾸면 본문이 파래진다.
        if fam == "blue" and sat >= 0.46 and 0.40 <= light <= 0.72:
            return BLUE if light >= 0.50 else BLUE_D
        if light >= 0.975: return WHITE
        if light >= 0.945: return PANEL2
        if light >= 0.895: return BLUE_L if (fam == "blue" and sat >= 0.30) else FILL
        if light >= 0.855: return LINE
        if light >= 0.795: return LINE2
        if light >= 0.700: return DIM
        if light >= 0.520: return MUTED
        if light >= 0.300: return SOFT
        return INK
    table = {
        "red":   (RED_L, RED_M, RED, RED_D),
        "green": (GREEN_L, GREEN_M, GREEN, GREEN_D),
        "amber": (AMBER_L, AMBER_M, AMBER, AMBER_D),
    }
    if fam not in table:
        return None  # 보라 등은 건드리지 않는다
    lite, mid, base, dark = table[fam]
    if light >= 0.90: return lite
    if light >= 0.72: return mid
    if light >= 0.46: return base
    return dark

def convert(hexstr):
    r = int(hexstr[1:3], 16) / 255
    g = int(hexstr[3:5], 16) / 255
    b = int(hexstr[5:7], 16) / 255
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return pick(family(h * 360, s), l, s)

def main(apply_changes):
    stats = collections.Counter()
    pairs = collections.Counter()
    for path in sorted(glob.glob("*.css")):
        if path == "toss.css":
            continue
        src = open(path, encoding="utf-8").read()
        def repl(m):
            old = m.group(0).lower()
            new = convert(old)
            if new is None or new.lower() == old:
                stats["그대로"] += 1
                return m.group(0)
            stats["바꿈"] += 1
            pairs[(old, new)] += 1
            return new
        out = re.sub(r'#[0-9a-fA-F]{6}\b', repl, src)
        if apply_changes and out != src:
            open(path, "w", encoding="utf-8").write(out)
    print(f"바꾼 색 {stats['바꿈']}곳, 그대로 둔 색 {stats['그대로']}곳")
    print(f"서로 다른 (원래→바뀐) 조합 {len(pairs)}가지")
    return pairs

if __name__ == "__main__":
    main("--apply" in sys.argv)
