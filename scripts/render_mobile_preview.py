"""Render a dependency-free M0 layout preview. This is not a browser capture."""
from html import escape
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, PANEL = 844, 390, 296
STAGE = WIDTH - PANEL
SCALE = min((STAGE - 32) / (28 * 40), (HEIGHT - 40) / (28 * 20))
TW, TH = 40 * SCALE, 20 * SCALE
OUT = Path(__file__).resolve().parents[1] / "artifacts" / "m0-mobile-layout-preview.svg"
PNG_OUT = OUT.with_suffix(".png")


def project(x, y):
    return STAGE / 2 + (x - y) * TW / 2, HEIGHT / 2 + (x + y - 28) * TH / 2


def diamond(x, y, fill, stroke="rgba(42,61,40,.19)", inset=1):
    cx, cy = project(x + .5, y + .5)
    return f'<polygon points="{cx:.2f},{cy - TH/2 + inset:.2f} {cx + TW/2 - inset:.2f},{cy:.2f} {cx:.2f},{cy + TH/2 - inset:.2f} {cx - TW/2 + inset:.2f},{cy:.2f}" fill="{fill}" stroke="{stroke}" stroke-width=".55"/>'


parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">
<defs>
 <linearGradient id="land" x2="1" y2="1"><stop stop-color="#91ad68"/><stop offset="1" stop-color="#647f4e"/></linearGradient>
 <linearGradient id="paper" x2="0" y2="1"><stop stop-color="#fbf8ef"/><stop offset="1" stop-color="#f5f0e3"/></linearGradient>
 <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#344435" flood-opacity=".16"/></filter>
</defs>
<rect width="{STAGE}" height="{HEIGHT}" fill="url(#land)"/>''']

for y in range(28):
    for x in range(28):
        in_build = 2 <= x <= 25 and 2 <= y <= 25
        in_ring = x < 2 or x > 25 or y < 2 or y > 25
        color = "#637c4d" if in_ring else ("#98b66f" if in_build else "#748b55")
        if in_build and (x + y) % 2:
            color = "#83a45b"
        parts.append(diamond(x, y, color))

# The documented E1 starter layout: core, barracks, arrow tower, and twelve separate wood walls.
wall_cells = (
    [(x, 11) for x in range(11, 16) if x != 13]
    + [(x, 15) for x in range(11, 16) if x != 13]
    + [(11, y) for y in range(12, 15) if y != 13]
    + [(15, y) for y in range(12, 15) if y != 13]
)
for x, y in wall_cells:
    cx, cy = project(x + .5, y + .5)
    parts.append(f'<polygon points="{cx-TW*.39:.1f},{cy-TH*.1:.1f} {cx:.1f},{cy-TH*.48:.1f} {cx+TW*.39:.1f},{cy-TH*.1:.1f} {cx:.1f},{cy+TH*.26:.1f}" fill="#bd8450" stroke="#715239" stroke-width=".8"/>')


def building(x, y, size, label, top, left, right, glyph):
    cx, cy = project(x + size / 2, y + size / 2)
    w, h = (2 * size) * TW / 2, (2 * size) * TH / 2
    lift = 45 * SCALE if size == 3 else 27 * SCALE
    parts.extend([
        f'<polygon points="{cx:.1f},{cy-h*.37:.1f} {cx+w*.46:.1f},{cy-2*SCALE:.1f} {cx:.1f},{cy+h*.37:.1f} {cx-w*.46:.1f},{cy-2*SCALE:.1f}" fill="#586f44" opacity=".84"/>',
        f'<polygon points="{cx-w/2:.1f},{cy-lift:.1f} {cx:.1f},{cy-h/2-lift:.1f} {cx:.1f},{cy-h/2:.1f} {cx-w/2:.1f},{cy+h/2-lift:.1f}" fill="{left}" stroke="#61533d" stroke-width=".7"/>',
        f'<polygon points="{cx:.1f},{cy-h/2-lift:.1f} {cx+w/2:.1f},{cy-lift:.1f} {cx+w/2:.1f},{cy+h/2-lift:.1f} {cx:.1f},{cy+h/2:.1f}" fill="{right}" stroke="#61533d" stroke-width=".7"/>',
        f'<polygon points="{cx:.1f},{cy-h/2-lift:.1f} {cx+w/2:.1f},{cy-lift:.1f} {cx:.1f},{cy-lift+h*.13:.1f} {cx-w/2:.1f},{cy-lift:.1f}" fill="{top}" stroke="#61533d" stroke-width=".7"/>',
        f'<text x="{cx:.1f}" y="{cy-lift*.76:.1f}" text-anchor="middle" font-size="{max(8,8*SCALE):.1f}" font-weight="700" fill="#f8eed3">{escape(glyph)}</text>',
        f'<text x="{cx:.1f}" y="{cy+4*SCALE:.1f}" text-anchor="middle" font-size="{max(7,8*SCALE):.1f}" fill="#fff5dc">{escape(label)}</text>',
    ])


building(12, 12, 3, "核心", "#bfac67", "#917b4b", "#705d3c", "✧")
building(8, 18, 2, "军营", "#c48955", "#926c49", "#735b43", "⌂")
building(8, 10, 2, "箭塔", "#a8ccd0", "#789298", "#5d7477", "♜")
for x, y in [(7, 13), (18, 15)]:
    cx, cy = project(x + .5, y + .5)
    parts.append(f'<ellipse cx="{cx:.1f}" cy="{cy+2:.1f}" rx="4.4" ry="2" fill="#455943"/><circle cx="{cx:.1f}" cy="{cy-2:.1f}" r="3.5" fill="#53aab5" stroke="#f1e7cd" stroke-width=".8"/><path d="M{cx+1:.1f} {cy-4:.1f}l4 -4" stroke="#eee1bd" stroke-width="1.2"/>')

parts.append(f'''<g font-family="system-ui,-apple-system,'Microsoft YaHei',sans-serif">
<g fill="#fff7df" filter="url(#shadow)"><rect x="18" y="14" width="34" height="34" rx="12" fill="#425c43" opacity=".74" stroke="#fff4d0"/><path d="M35 23l-6 8h12l-6 8M31 27l8 8" fill="none" stroke="#d9c878" stroke-width="2" stroke-linecap="round"/><text x="61" y="29" font-size="15" font-weight="800" letter-spacing="2">WAR</text><text x="105" y="29" font-size="9" opacity=".8">工作名</text><text x="61" y="43" font-size="9" opacity=".84">工匠城邦 · 美术与世界观占位</text></g>
<rect x="18" y="68" width="149" height="25" rx="8" fill="#384d3d" fill-opacity=".27" stroke="#fff" stroke-opacity=".18"/><circle cx="29" cy="80.5" r="3" fill="#e1c676"/><text x="38" y="84" fill="#f6f1dc" font-size="10" font-weight="700">基地蓝图</text><text x="102" y="84" fill="#f6f1dc" fill-opacity=".72" font-size="8">固定 2.5D 斜视</text>
<text x="18" y="373" fill="#faf8e6" font-size="9" opacity=".9">逆投影命中格 (14, 14) · 建造区</text>
<rect x="466" y="328" width="68" height="38" rx="11" fill="#f9f6e7" fill-opacity=".96" stroke="#fff" filter="url(#shadow)"/><text x="478" y="352" fill="#536749" font-size="19">−</text><text x="494" y="351" fill="#727969" font-size="8" font-weight="700">100%</text><text x="517" y="352" fill="#536749" font-size="17">+</text>
</g>
<rect x="{STAGE}" y="0" width="{PANEL}" height="{HEIGHT}" fill="url(#paper)"/><path d="M{STAGE} 0v390" stroke="#d8d4c8"/>
<g font-family="system-ui,-apple-system,'Microsoft YaHei',sans-serif" fill="#303c33">
<text x="565" y="23" fill="#84907e" font-size="8" font-weight="700" letter-spacing="1">单人基地 · 本地原型</text>
<rect x="687" y="10" width="141" height="32" rx="10" fill="#f3ead3" stroke="#e8ddc1"/><circle cx="703" cy="26" r="8" fill="#e6c76b"/><text x="700" y="29" font-size="10" fill="#8f7134">✦</text><text x="716" y="22" font-size="7" fill="#8c8063">金币</text><text x="716" y="35" font-size="13" font-weight="700" fill="#493f2d">2,500</text><text x="783" y="28" font-size="6" fill="#998960">初始存档</text>
<path d="M560 52h272" stroke="#e2dccb"/><text x="565" y="70" font-size="13" font-weight="800">地图总览</text><rect x="785" y="58" width="43" height="18" rx="9" fill="#e9efe3"/><text x="792" y="70" font-size="7" font-weight="700" fill="#58734d">28 × 28</text><text x="565" y="86" fill="#879081" font-size="8">完整缩放视图 · 24 × 24 建造区 · 外缘为部署环</text>
<rect x="565" y="96" width="126" height="26" rx="7" fill="#f2efe5"/><rect x="698" y="96" width="130" height="26" rx="7" fill="#f2efe5"/><text x="574" y="112" font-size="7" fill="#8d9488">当前格</text><text x="646" y="112" font-size="8" fill="#4c5d49">(14, 14)</text><text x="707" y="112" font-size="7" fill="#8d9488">区域</text><text x="778" y="112" font-size="8" fill="#4c5d49">建造区</text>
<path d="M560 133h272" stroke="#e2dccb"/><text x="565" y="150" font-size="10" font-weight="800">蓝图一览</text><text x="780" y="150" font-size="7" fill="#9da393">可在 M1 编辑</text>
<g font-size="8"><rect x="565" y="158" width="23" height="23" rx="7" fill="#e3ebdc"/><text x="572" y="173" fill="#6f8872" font-size="12">✧</text><text x="595" y="169" font-weight="700">基地核心</text><text x="595" y="178" fill="#9a9e92" font-size="6">3 × 3 · L1</text><text x="817" y="172" fill="#617458" font-weight="700">1</text>
<rect x="565" y="185" width="23" height="23" rx="7" fill="#f1e2cf"/><text x="572" y="201" fill="#aa7046" font-size="12">⌂</text><text x="595" y="196" font-weight="700">军营</text><text x="595" y="205" fill="#9a9e92" font-size="6">2 × 2 · L1</text><text x="817" y="199" fill="#617458" font-weight="700">1</text>
<rect x="565" y="212" width="23" height="23" rx="7" fill="#dfebeb"/><text x="572" y="228" fill="#597d85" font-size="12">♜</text><text x="595" y="223" font-weight="700">箭塔</text><text x="595" y="232" fill="#9a9e92" font-size="6">2 × 2 · L1</text><text x="817" y="226" fill="#617458" font-weight="700">1</text>
<rect x="565" y="239" width="23" height="23" rx="7" fill="#eee4d4"/><text x="572" y="255" fill="#8a6747" font-size="12">▤</text><text x="595" y="250" font-weight="700">木墙</text><text x="595" y="259" fill="#9a9e92" font-size="6">独立墙段 · 400 HP</text><text x="817" y="253" fill="#617458" font-weight="700">12</text></g>
<path d="M560 273h272" stroke="#e2dccb"/><text x="565" y="290" font-size="10" font-weight="800">驻军编组</text><text x="789" y="290" font-size="7" fill="#9da393">2 名弩手</text><rect x="565" y="297" width="22" height="22" rx="7" fill="#e7eee8"/><text x="570" y="313" fill="#57909a" font-size="14">➶</text><rect x="590" y="297" width="22" height="22" rx="7" fill="#e7eee8"/><text x="595" y="313" fill="#57909a" font-size="14">➶</text><text x="619" y="307" font-size="8" font-weight="700">站位已保存</text><text x="619" y="316" font-size="6" fill="#8a9588">当前版本没有防守演练入口</text><text x="565" y="330" font-size="7" fill="#92998e">驻军随蓝图保存与调整；首发不会用于防守战斗。</text>
<rect x="565" y="338" width="263" height="24" rx="8" fill="#edf0e7" stroke="#e2e7dc"/><circle cx="576" cy="348" r="3" fill="#75a36c"/><text x="584" y="351" font-size="7" font-weight="700">原型运行状态</text><text x="810" y="351" font-size="7" fill="#8a9a83">M0</text><text x="574" y="358" font-size="6" fill="#788677">存档原型 · 固定步长 50 ms · 20 tick/s</text>
</g>
<text x="565" y="379" font-family="system-ui,-apple-system,'Microsoft YaHei',sans-serif" font-size="6.5" fill="#a2a798">M0 横屏布局预览 · 非浏览器运行截图</text>
</svg>''')

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(parts), encoding="utf-8")

# A raster companion is useful in viewers that cannot display SVG. It is a layout render,
# not a screenshot from a running browser.
R = 2
image = Image.new("RGB", (WIDTH * R, HEIGHT * R), "#718b53")
draw = ImageDraw.Draw(image)
regular_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size, bold=False):
    return ImageFont.truetype(bold_path if bold else regular_path, max(8, round(size * R)))


def box(coords, fill, outline=None, radius=0, width=1):
    coords = tuple(round(value * R) for value in coords)
    if radius:
        draw.rounded_rectangle(coords, radius=radius * R, fill=fill, outline=outline, width=width * R)
    else:
        draw.rectangle(coords, fill=fill, outline=outline, width=width * R)


def text(x, y, value, size=9, color="#303c33", bold=False):
    draw.text((round(x * R), round(y * R)), value, fill=color, font=font(size, bold))


def poly(points, fill, outline=None, width=1):
    coords = [(round(x * R), round(y * R)) for x, y in points]
    draw.polygon(coords, fill=fill)
    if outline:
        draw.line(coords + [coords[0]], fill=outline, width=width * R, joint="curve")


for y in range(28):
    for x in range(28):
        cx, cy = project(x + .5, y + .5)
        inside = 2 <= x <= 25 and 2 <= y <= 25
        ring = x < 2 or x > 25 or y < 2 or y > 25
        tile = "#637c4d" if ring else "#98b66f" if not inside else ("#83a45b" if (x + y) % 2 else "#779e52")
        poly([(cx, cy - TH / 2), (cx + TW / 2, cy), (cx, cy + TH / 2), (cx - TW / 2, cy)], tile, "#687e50", 1)

for x, y in wall_cells:
    cx, cy = project(x + .5, y + .5)
    poly([(cx - TW * .39, cy - TH * .1), (cx, cy - TH * .48), (cx + TW * .39, cy - TH * .1), (cx, cy + TH * .26)], "#bd8450", "#715239", 1)


def raster_building(x, y, size, label, top, left, right):
    cx, cy = project(x + size / 2, y + size / 2)
    w, h = 2 * size * TW / 2, 2 * size * TH / 2
    lift = 45 * SCALE if size == 3 else 27 * SCALE
    poly([(cx, cy - h * .37), (cx + w * .46, cy - 2 * SCALE), (cx, cy + h * .37), (cx - w * .46, cy - 2 * SCALE)], "#586f44")
    poly([(cx - w/2, cy - lift), (cx, cy - h/2 - lift), (cx, cy - h/2), (cx - w/2, cy + h/2 - lift)], left, "#61533d", 1)
    poly([(cx, cy - h/2 - lift), (cx + w/2, cy - lift), (cx + w/2, cy + h/2 - lift), (cx, cy + h/2)], right, "#61533d", 1)
    poly([(cx, cy - h/2 - lift), (cx + w/2, cy - lift), (cx, cy - lift + h*.13), (cx - w/2, cy - lift)], top, "#61533d", 1)
    text(cx - len(label) * 2.3, cy + 1, label, 7, "#fff5dc", True)


raster_building(12, 12, 3, "CORE", "#bfac67", "#917b4b", "#705d3c")
raster_building(8, 18, 2, "CAMP", "#c48955", "#926c49", "#735b43")
raster_building(8, 10, 2, "TOWER", "#a8ccd0", "#789298", "#5d7477")
for x, y in [(7, 13), (18, 15)]:
    cx, cy = project(x + .5, y + .5)
    draw.ellipse(((cx-4)*R, (cy-1)*R, (cx+4)*R, (cy+4)*R), fill="#455943")
    draw.ellipse(((cx-3.5)*R, (cy-5.5)*R, (cx+3.5)*R, (cy+1.5)*R), fill="#53aab5", outline="#f1e7cd", width=R)

box((0, 0, STAGE, HEIGHT), None)
box((STAGE, 0, WIDTH, HEIGHT), "#f8f5eb")
draw.line((STAGE * R, 0, STAGE * R, HEIGHT * R), fill="#d8d4c8", width=R)
box((17, 14, 52, 49), "#496348", "#fff4d0", 12)
text(25, 19, "✦", 16, "#d9c878", True)
text(61, 15, "WAR", 15, "#fff7df", True)
text(105, 19, "WORKING TITLE", 7, "#fff7df")
text(61, 35, "CRAFT TOWN · ART PLACEHOLDER", 7, "#f8efcf")
box((18, 68, 167, 93), "#536a4a", "#9eae8a", 8)
text(28, 75, "BASE BLUEPRINT", 8, "#f6f1dc", True)
text(104, 76, "2.5D ISO", 7, "#e0e5d1")
text(18, 367, "GRID (14, 14) · BUILD ZONE", 8, "#fff8e8", True)
box((466, 328, 534, 366), "#f9f6e7", "#ffffff", 11)
text(476, 337, "−    100%    +", 10, "#536749", True)

text(565, 13, "SINGLE-PLAYER HOME · LOCAL", 7, "#84907e", True)
box((687, 10, 828, 42), "#f3ead3", "#e8ddc1", 10)
draw.ellipse((695*R, 18*R, 711*R, 34*R), fill="#e6c76b")
text(699, 20, "*", 10, "#8f7134", True)
text(716, 13, "COINS", 6, "#8c8063")
text(716, 23, "2,500", 12, "#493f2d", True)
text(781, 21, "STARTER", 6, "#998960")
draw.line((560*R, 52*R, 832*R, 52*R), fill="#e2dccb", width=R)
text(565, 58, "Map overview", 12, "#303c33", True)
box((785, 58, 828, 76), "#e9efe3", None, 9)
text(791, 63, "28 × 28", 7, "#58734d", True)
text(565, 79, "24 × 24 build area · Deployment ring outside", 7, "#879081")
box((565, 96, 691, 122), "#f2efe5", None, 7)
box((698, 96, 828, 122), "#f2efe5", None, 7)
text(574, 104, "CELL", 6, "#8d9488")
text(640, 103, "(14, 14)", 7, "#4c5d49", True)
text(707, 104, "ZONE", 6, "#8d9488")
text(778, 103, "BUILD", 7, "#4c5d49", True)
draw.line((560*R, 133*R, 832*R, 133*R), fill="#e2dccb", width=R)
text(565, 140, "Blueprint", 9, "#303c33", True)
text(780, 142, "M1 EDIT", 6, "#9da393")
rows = [("✧", "CORE", "3×3 · LV1", "#e3ebdc", "#6f8872"), ("⌂", "BARRACKS", "2×2 · LV1", "#f1e2cf", "#aa7046"), ("♜", "ARROW TOWER", "2×2 · LV1", "#dfebeb", "#597d85"), ("▤", "WOOD WALL", "12 SEGMENTS · 400 HP", "#eee4d4", "#8a6747")]
for i, (icon, label, detail, back, fore) in enumerate(rows):
    yy = 158 + i * 27
    box((565, yy, 588, yy+23), back, None, 7)
    text(571, yy+4, icon, 11, fore, True)
    text(595, yy+3, label, 7, "#303c33", True)
    text(595, yy+13, detail, 6, "#9a9e92")
    text(816, yy+5, "12" if i == 3 else "1", 8, "#617458", True)
draw.line((560*R, 273*R, 832*R, 273*R), fill="#e2dccb", width=R)
text(565, 280, "Garrison", 9, "#303c33", True)
text(789, 282, "2 CROSSBOW", 6, "#9da393")
box((565, 297, 587, 319), "#e7eee8", None, 7)
box((590, 297, 612, 319), "#e7eee8", None, 7)
text(570, 301, ">", 12, "#57909a", True)
text(595, 301, ">", 12, "#57909a", True)
text(619, 297, "Positions saved", 7, "#303c33", True)
text(619, 308, "No home defense battle in launch", 6, "#8a9588")
text(565, 322, "Garrison data is saved with the blueprint.", 6, "#92998e")
box((565, 338, 828, 362), "#edf0e7", "#e2e7dc", 8)
draw.ellipse((573*R, 345*R, 579*R, 351*R), fill="#75a36c")
text(584, 342, "PROTOTYPE STATUS", 6, "#596c56", True)
text(808, 342, "M0", 6, "#8a9a83", True)
text(574, 352, "50 ms fixed tick · seed replay check", 6, "#788677")
text(565, 371, "M0 layout preview · NOT A LIVE SCREEN CAPTURE", 6, "#a2a798")
image = image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
image.save(PNG_OUT, optimize=True)
print(OUT)
print(PNG_OUT)
