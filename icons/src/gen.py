# -*- coding: utf-8 -*-
"""大川原染色本舗 アプリアイコン
   共通ルール: 藍地 #1a365d ／ 生成り #f7f3e8 ／ アプリごとのアクセント1色 ／ 塗りのみ・細線なし"""
import os

AI     = "#1a365d"   # 藍（共通の地）
KINA   = "#f7f3e8"   # 生成り
ORANGE = "#e8853a"   # 在庫のアクセント
SORA   = "#63b3ed"   # 顧客のアクセント
KIN    = "#e0a83c"   # 竿の金・見積もりの円マーク
MIDORI = "#5aa87c"   # 経営のアクセント
ORI    = "#d8d2c2"   # 紙の折り返し

def frame(body, rx):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
            f'<rect width="1024" height="1024" rx="{rx}" fill="{AI}"/>{body}</svg>')

# ---- ① ポータル：暖簾（のれん）＝店の入口 ----
def portal(rx):
    b  = f'<rect x="128" y="236" width="768" height="52" rx="26" fill="{KIN}"/>'            # 竿（暖簾より横に出す）
    b += f'<path d="M170 288 H854 V836 Q512 892 170 836 Z" fill="{KINA}"/>'                 # 暖簾（裾が波打つ）
    b += f'<rect x="392" y="560" width="30" height="300" fill="{AI}"/>'                     # 切れ目（下半分だけ）
    b += f'<rect x="602" y="560" width="30" height="300" fill="{AI}"/>'
    b += f'<circle cx="512" cy="428" r="118" fill="{AI}"/>'                                 # 丸紋
    b += f'<rect x="452" y="368" width="30" height="124" rx="15" fill="{KINA}"/>'           # 「川」
    b += f'<rect x="497" y="384" width="30" height="92"  rx="15" fill="{KINA}"/>'
    b += f'<rect x="542" y="356" width="30" height="148" rx="15" fill="{KINA}"/>'
    return frame(b, rx)

# ---- ② 在庫管理：畳んで積んだ布（棚の在庫） ----
def zaiko(rx):
    def layer(x, y, w, fill):
        h = 140
        s  = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="30" fill="{fill}"/>'
        s += f'<rect x="{x+48}" y="{y+38}" width="{34}" height="{64}" rx="17" fill="{AI}"/>'  # 畳んだ布の端
        return s
    b  = layer(160, 596, 704, KINA)
    b += layer(200, 440, 624, KINA)
    b += layer(248, 284, 528, ORANGE)
    return frame(b, rx)

# ---- ③ 顧客管理：重なる人影（お客さん） ----
def kokyaku(rx):
    def person(cx, head_cy, hr, bw, btop, bbot, fill):
        r = bw / 2
        s  = f'<circle cx="{cx}" cy="{head_cy}" r="{hr}" fill="{fill}"/>'
        s += (f'<path d="M{cx-r} {bbot} V{btop+r} A{r} {r} 0 0 1 {cx+r} {btop+r} V{bbot} Z" fill="{fill}"/>')
        return s
    # 奥（青）
    b  = person(648, 392, 104, 320, 546, 848, SORA)
    # 手前は藍で一回り大きく抜いてから生成りを重ねる＝隙間ができて2人に見える
    b += person(408, 424, 136, 388, 570, 878, AI)
    b += person(408, 424, 118, 352, 588, 878, KINA)
    return frame(b, rx)


# ---- ④ 経営ダッシュボード：右肩上がりの棒グラフ ----
def dashboard(rx):
    b  = f'<rect x="150" y="812" width="724" height="46" rx="23" fill="{KINA}"/>'       # 基準線
    b += f'<rect x="212" y="536" width="164" height="252" rx="34" fill="{KINA}"/>'
    b += f'<rect x="430" y="404" width="164" height="384" rx="34" fill="{KINA}"/>'
    b += f'<rect x="648" y="248" width="164" height="540" rx="34" fill="{MIDORI}"/>'    # 伸びている月
    return frame(b, rx)

# ---- ⑤ 見積もり計算：見積書に円マーク ----
def quote(rx):
    b  = f'<path d="M252 172h330l190 190v490a34 34 0 0 1-34 34H252a34 34 0 0 1-34-34V206a34 34 0 0 1 34-34z" fill="{KINA}"/>'
    b += f'<path d="M582 172l190 190H616a34 34 0 0 1-34-34z" fill="{ORI}"/>'            # 折り返し
    b += f'<rect x="404" y="470" width="34" height="150" rx="17" transform="rotate(-32 421 545)" fill="{KIN}"/>'
    b += f'<rect x="552" y="470" width="34" height="150" rx="17" transform="rotate(32 569 545)" fill="{KIN}"/>'
    b += f'<rect x="478" y="566" width="34" height="140" rx="17" fill="{KIN}"/>'
    b += f'<rect x="404" y="614" width="182" height="30" rx="15" fill="{KIN}"/>'
    b += f'<rect x="404" y="672" width="182" height="30" rx="15" fill="{KIN}"/>'
    return frame(b, rx)

APPS = {"portal": portal, "zaiko": zaiko, "kokyaku": kokyaku,
        "dashboard": dashboard, "quote": quote}
out = os.path.dirname(os.path.abspath(__file__))
for name, fn in APPS.items():
    open(f"{out}/{name}-round.svg", "w").write(fn(224))   # favicon用（角丸）
    open(f"{out}/{name}-square.svg", "w").write(fn(0))    # PNG用（iOSが自分で角を丸めるため角丸なし）
print("ok")
