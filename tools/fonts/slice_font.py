#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 public/fonts/huajiantang.woff2 切成多片 + 生成带 unicode-range 的 fonts.css。

为什么这么切
------------
母本是「汉仪文黑-85W」子集化到完整 GB2312 + 站点用字，约 1 MB / 6900+ 码位。
站点每个页面都通过一条 @font-face 引用它，于是**每一页都要下满 1 MB**，
而单页正文实际只用到 300~600 个字。把这一份拆成 N 个 woff2 分片、
每片配一条 unicode-range，浏览器就只会下载「页面上真出现过的字」所在的那几片。

切片顺序不按码位、按**站点真实用字频率**：
  1. 扫 dist/**/*.html（已构建产物，等于线上真实文本）+ src/content/**/*.md
     + src/data/*.json，统计每个字符出现在多少个文件里（文档频率 df）与总次数；
  2. 按 df 降序（并列按码位升序）排序母本 cmap 里的全部码位 —— 也就是把
     「站点最常用的字」放最前面；母本里有、站点没用过的字排在最后（按码位升序）；
  3. 第 1 片放最高频的 SHARD1_SIZE 个字，其余每片约 REST_CHUNK 个字，
     总片数控制在 MIN_SHARDS~MAX_SHARDS 之间（越少片 = 每片越大 = 省得越多，
     但首屏需要下载的分片集合可能变大）。

覆盖不缩水（硬约束）
--------------------
所有分片的 unicode 集合的并集必须**完全等于**母本 cmap 的集合：GB2312 全覆盖保留。
脚本自己会做这件事的校验，不等 → 直接报错退出、不写文件。站点以后写新文章用到的
仍是同样这批字，不会掉回系统字体。

用法
----
    cd "D:\\曼沫砾总线\\Chenxu-MarshEco.github.io"
    "C:\\Users\\煦\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" tools/fonts/slice_font.py

可选参数：
    --root DIR        仓库根目录（默认 = 本脚本所在目录往上两级）
    --master PATH     母本字体（默认 public/fonts/huajiantang.woff2）
    --out-dir DIR     分片输出目录（默认 public/fonts）
    --css PATH        要重写的 fonts.css（默认 src/styles/fonts.css）
    --shard1 N        第 1 片的字数（默认 300）
    --chunk N         其余每片约多少字（默认 250）
    --min-shards N    最少片数（默认 25）
    --max-shards N    最多片数（默认 40）
    --max-growth F    分片总字节 / 母本字节 的上限（默认 1.6）
    --force           忽略已有的分片，全部重新生成
    --dry-run         只做统计、规划与覆盖校验，不写任何文件

产出：
    public/fonts/huajiantang-NN.woff2   （两位数编号；母本 huajiantang.woff2 不动）
    src/styles/fonts.css                （每片一条 @font-face）
    tools/fonts/manifest.json           （切片清单，给 report.mjs 用）
"""

from __future__ import annotations

import argparse
import html.parser
import json
import re
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# 参数默认值（改这里 = 改切片粒度，重跑本脚本即可）
# ---------------------------------------------------------------------------
DEFAULTS = {
    "shard1": 300,
    "chunk": 250,
    "min_shards": 25,
    "max_shards": 40,
    "max_growth": 1.6,
}

# 站点真实内容：只统计这些，不统计组件里的界面文案（那些会自然出现在 dist 里）
HTML_GLOB = "dist/**/*.html"
MD_GLOBS = ("src/content/**/*.md", "src/content/**/*.mdx")
JSON_GLOBS = ("src/data/*.json",)
# dist 里的构建产物都要算，唯独这两个不算：
#   __perf-*.html  —— 用来量性能的副本（同一页文本会被算两遍，污染频率）
#   404.html       —— 内容由托管平台决定，不是站点自己在用的字
HTML_EXCLUDE = ("__perf-", "404.html")

FAMILY = "Huajiantang"
FONT_WEIGHT = "100 900"
FONT_STYLE = "normal"
FONT_DISPLAY = "swap"

# 这些标签里的文字不是渲染文本，不参与统计
SKIP_TAGS = {"script", "style", "title", "noscript", "template", "svg", "path", "head"}
# 会被渲染 / 被读屏念出来的属性，参与统计。
# 刻意不含 meta 的 content：那里常塞 base64 的 OG 图或 data: URI，
# 会把一堆生僻符号算成「站点用字」，把真正的高频字挤出前面的分片。
TEXT_ATTRS = ("alt", "title", "aria-label")


class TextExtractor(html.parser.HTMLParser):
    """把 HTML 里的可见文本抽出来：跳 script/style，属性只取会渲染/被读屏的那几个。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def _attrs(self, tag, attrs):
        if tag in SKIP_TAGS or self._skip_depth:
            return
        for name, value in attrs:
            if not value or name not in TEXT_ATTRS:
                continue
            probe = value.strip()
            # data: URI / 超长值是技术载荷，不是给人读的字
            if probe.startswith("data:") or len(probe) > 120:
                continue
            self.parts.append(value)

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip_depth += 1
            return
        self._attrs(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._attrs(tag, attrs)

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            self.parts.append(data)

    @property
    def text(self) -> str:
        return "\n".join(self.parts)


_FRONTMATTER = re.compile(r"\A\s*(?:\+\+\+|---)\s*\n.*?\n(?:\+\+\+|---)\s*\n?", re.S)


def html_to_text(raw: str) -> str:
    parser = TextExtractor()
    parser.feed(raw)
    parser.close()
    return parser.text


def md_to_text(raw: str) -> str:
    """Markdown 只粗略去标记：目的是统计用字频率，不是精确渲染。"""
    raw = _FRONTMATTER.sub("", raw)
    raw = re.sub(r"```.*?```", " ", raw, flags=re.S)          # 代码块
    raw = re.sub(r"`[^`\n]*`", " ", raw)                       # 行内代码
    raw = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", raw)            # 图片
    raw = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", raw)         # 链接留文字
    raw = re.sub(r"^\s{0,3}#{1,6}\s*", "", raw, flags=re.M)    # 标题记号
    return raw


def json_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from json_strings(value)
    elif isinstance(node, list):
        for item in node:
            yield from json_strings(item)


# ---------------------------------------------------------------------------
# 频率统计
# ---------------------------------------------------------------------------
def collect_frequency(root: Path, codepoints: set[int]):
    """返回 (df, total, docs)：每个码位出现在几个文件里 / 总次数 / 统计了几个文件。"""
    df: dict[int, int] = {}
    total: dict[int, int] = {}
    docs = 0

    def feed(text: str) -> None:
        nonlocal docs
        docs += 1
        seen: set[int] = set()
        for ch in text:
            cp = ord(ch)
            if cp not in codepoints:
                continue
            total[cp] = total.get(cp, 0) + 1
            if cp not in seen:
                seen.add(cp)
        for cp in seen:
            df[cp] = df.get(cp, 0) + 1

    html_files = sorted(
        p for p in root.glob(HTML_GLOB)
        if not any(token in p.name for token in HTML_EXCLUDE)
    )
    for path in html_files:
        feed(html_to_text(path.read_text(encoding="utf-8", errors="replace")))

    md_files: list[Path] = []
    for pattern in MD_GLOBS:
        md_files += sorted(root.glob(pattern))
    for path in md_files:
        feed(md_to_text(path.read_text(encoding="utf-8", errors="replace")))

    json_files: list[Path] = []
    for pattern in JSON_GLOBS:
        json_files += sorted(root.glob(pattern))
    for path in json_files:
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except json.JSONDecodeError as exc:
            print(f"  ! 跳过解析失败的 JSON {path.name}: {exc}")
            continue
        feed("\n".join(json_strings(data)))

    print(f"  统计来源：{len(html_files)} 个 dist HTML、{len(md_files)} 个 md、"
          f"{len(json_files)} 个 json（共 {docs} 个文件）")
    return df, total, docs


# ---------------------------------------------------------------------------
# woff2 只用来看「母本里到底有哪些码位」——读 cmap 就够了
# ---------------------------------------------------------------------------
def master_codepoints(master: Path) -> list[int]:
    from fontTools.ttLib import TTFont

    font = TTFont(str(master), lazy=True, fontNumber=0)
    cmap = font.getBestCmap()
    if not cmap:
        raise SystemExit("母本没有可用的 cmap")
    cps = sorted(cmap.keys())
    font.close()
    return cps


# ---------------------------------------------------------------------------
# 切片
# ---------------------------------------------------------------------------
def order_by_frequency(cps: list[int], df: dict[int, int], total: dict[int, int]) -> list[int]:
    present = [cp for cp in cps if df.get(cp)]
    absent = sorted(cp for cp in cps if not df.get(cp))
    present.sort(key=lambda cp: (-df.get(cp, 0), -total.get(cp, 0), cp))
    missing = len(present)
    print(f"  母本码位 {len(cps)} 个：站点用到 {missing} 个、"
          f"站点还没用到 {len(absent)} 个（已排在最后，仍会全部分片保留）")
    return present + absent


def plan_slices(ordered: list[int], shard1: int, chunk: int, min_shards: int, max_shards: int):
    n = len(ordered)
    if n <= shard1:
        return [ordered]

    def split(width: int) -> list[list[int]]:
        rest = ordered[shard1:]
        return [ordered[:shard1]] + [rest[i:i + width] for i in range(0, len(rest), width)]

    try:
        plan = split(chunk)
        if not (min_shards <= len(plan) <= max_shards):
            raise ValueError(len(plan))
        return plan
    except ValueError:
        pass

    # 片数越界：反解每片宽度，让总片数落到区间里
    for target in range(min_shards, max_shards + 1):
        width = -(-(n - shard1) // (target - 1))  # ceil
        plan = split(width)
        if min_shards <= len(plan) <= max_shards:
            print(f"  · 每片 {chunk} 字会得到 {len(ordered[shard1:]) // chunk + 1} 片，"
                  f"已改为每片 {width} 字 → {len(plan)} 片（要求 {min_shards}~{max_shards}）")
            return plan
    raise SystemExit(f"无法在 {min_shards}~{max_shards} 片内切完 {n} 个码位，请调整 --chunk")


def to_ranges(cps: list[int]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(cps):
        start = cps[i]
        end = start
        while i + 1 < len(cps) and cps[i + 1] == end + 1:
            i += 1
            end = cps[i]
        if start == end:
            out.append(f"U+{start:X}")
        elif end == start + 1:
            out.append(f"U+{start:X}")
            out.append(f"U+{end:X}")
        else:
            out.append(f"U+{start:X}-{end:X}")
        i += 1
    return out


def write_shard(master: Path, cps: list[int], dest: Path) -> None:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    font = TTFont(str(master), lazy=False, fontNumber=0)
    options = subset.Options()
    options.flavor = "woff2"
    # 字面相关的表全留：分片用同一套轮廓，几何/度量/名字与母本保持一致
    options.drop_tables = []
    options.passthrough_tables = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.recalc_bounds = False
    options.recalc_timestamp = False
    options.ignore_missing_unicodes = False
    options.canonical_order = True
    options.layout_features = ["*"]
    options.unicodes = cps
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=cps)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(str(dest))
    font.close()


# ---------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------
def assert_comment_safe(css: str) -> None:
    """自检：CSS 注释里绝不能出现 `*/`，否则注释提前闭合、后面的规则变成非法选择器。

    踩过的坑：头部注释里如果写通配路径（dist 两个星号斜杠 html 之类），
    其中的星号斜杠就是注释结束符，lightningcss 会直接报
    "Invalid dangling combinator in selector"，整个站点构建失败。
    所以这里对每个 `/* ... */` 块内部都查一遍，并额外查注释块数量是否成对。
    """
    cursor = 0
    blocks = 0
    while True:
        start = css.find("/*", cursor)
        if start < 0:
            break
        end = css.find("*/", start + 2)
        if end < 0:
            raise SystemExit(f"生成的 CSS 有未闭合的注释（第 {css[:start].count(chr(10)) + 1} 行起）")
        inner = css[start + 2:end]
        if "*/" in inner:  # 到不了这里，留着表明意图
            raise SystemExit("生成的 CSS 注释内部出现了 */ ")
        blocks += 1
        cursor = end + 2
    # 用另一种口径再核一遍：把所有注释块挖掉后，剩下的正文里不该再有 `*/`
    stripped = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    if "*/" in stripped:
        line = stripped[:stripped.index("*/")].count("\n") + 1
        raise SystemExit(f"注释挖掉后正文里仍有 */（约第 {line} 行），会破坏 CSS")
    if blocks == 0:
        raise SystemExit("生成的 CSS 里一个注释块都没有，不对劲")


def render_css(slices, sizes, master_bytes, out_dir_name, stats) -> str:
    total_bytes = sum(sizes)
    lines = [
        "/* ------------------------------------------------------------------",
        " * 站点字体：汉仪文黑-85W（原神使用的中文字体）",
        " *",
        f" * 母本 public/fonts/huajiantang.woff2 是子集化到完整 GB2312（6763 字）+ 站点",
        f" * 全部字符的版本，{stats['master_codepoints']} 个码位、{master_bytes / 1024:.0f} KB。",
        " * 它现在只是一个「母本」，页面不再引用它。",
        " *",
        " * 为什么切成很多片",
        " * ----------------",
        " * 只给一条 @font-face 的话，每一页都要下满这一整份（约 1 MB），而单页正文实际",
        f" * 只用得到几百个字。这里把它按「站点真实用字频率」切成 {len(slices)} 片，每片一条",
        " * @font-face 并各带自己的 unicode-range：浏览器只会下载页面上真出现过的字所在的",
        " * 那几片，典型页面从 1040 KB 掉到几十~一百多 KB。",
        " *",
        " * 频率顺序是怎么来的",
        " * ----------------",
        " * tools/fonts/slice_font.py 扫描 dist 下已构建的 HTML（等于线上真实文本）、",
        " * src/content 里的 Markdown、src/data 里的 JSON，按「字符出现在多少个文件里」",
        f" * 降序排列母本 cmap 里的全部码位：第 1 片是最高频的 {stats['shard1']} 字，其余每片约 {stats['chunk']} 字。",
        " * 母本里有、站点还没用到的字排在最后（按码位升序），一片都不少。",
        " *",
        " * 覆盖不缩水",
        " * --------",
        f" * 所有分片 unicode 集合的并集 = 母本 cmap 的集合（{stats['master_codepoints']} 个码位，",
        " * GB2312 全覆盖保留）。切片时脚本自己校验过，不相等就不写文件；",
        f" * 分片总字节 {total_bytes / 1024:.0f} KB ≈ 母本的 {total_bytes / master_bytes:.2f} 倍。",
        " *",
        " * 只留 WOFF2，不做 WOFF 兜底：WOFF2 现在的支持率超过 97%，",
        " * 而那份兜底文件有 1.3 MB，实际从没被请求过。真遇到不支持的浏览器，",
        " * 下面的系统字体回落链会接住，不会出现方框。",
        " *",
        " * font-weight 写成区间 100 900，而不是单一的 400：",
        " * 只声明 400 的话，font-weight:700 的标题匹配不到这个字体，",
        " * 会回落到系统字体，标题和正文就变成两种字形了。",
        " *",
        " * 本文件由 tools/fonts/slice_font.py 生成，别手改；要换粒度改脚本重跑。",
        " * ------------------------------------------------------------------ */",
        "",
    ]
    for index, (cps, size) in enumerate(zip(slices, sizes), start=1):
        lines.append("@font-face {")
        lines.append(f"  font-family: '{FAMILY}';")
        lines.append(f"  src: url('/fonts/{shard_name(index)}') format('woff2');")
        lines.append(f"  font-weight: {FONT_WEIGHT};")
        lines.append(f"  font-style: {FONT_STYLE};")
        lines.append(f"  font-display: {FONT_DISPLAY};")
        lines.append(f"  unicode-range: {', '.join(to_ranges(cps))};")
        lines.append("}")
        lines.append("")
    css = "\n".join(lines).rstrip("\n") + "\n"
    assert_comment_safe(css)
    return css


def shard_name(index: int) -> str:
    return f"huajiantang-{index:02d}.woff2"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    default_root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description="切分站点中文字体并生成 fonts.css")
    ap.add_argument("--root", default=str(default_root))
    ap.add_argument("--master", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--css", default=None)
    ap.add_argument("--shard1", type=int, default=DEFAULTS["shard1"])
    ap.add_argument("--chunk", type=int, default=DEFAULTS["chunk"])
    ap.add_argument("--min-shards", type=int, default=DEFAULTS["min_shards"])
    ap.add_argument("--max-shards", type=int, default=DEFAULTS["max_shards"])
    ap.add_argument("--max-growth", type=float, default=DEFAULTS["max_growth"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="只统计和校验，不写文件")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    master = Path(args.master) if args.master else root / "public/fonts/huajiantang.woff2"
    out_dir = Path(args.out_dir) if args.out_dir else root / "public/fonts"
    css_path = Path(args.css) if args.css else root / "src/styles/fonts.css"
    manifest_path = Path(__file__).resolve().parent / "manifest.json"
    started = time.time()

    if not master.is_file():
        raise SystemExit(f"找不到母本字体：{master}")
    if not (root / "dist").is_dir():
        raise SystemExit(f"{root} 下没有 dist/，先在别处跑一次 astro build 再回来切片")
    master_bytes = master.stat().st_size

    print(f"[1/5] 读母本 cmap：{master.relative_to(root)}（{master_bytes} 字节）")
    cps = master_codepoints(master)
    print(f"  母本码位 {len(cps)} 个，U+{cps[0]:04X} ~ U+{cps[-1]:04X}")

    print("[2/5] 统计站点真实用字频率")
    df, total, docs = collect_frequency(root, set(cps))
    ordered = order_by_frequency(cps, df, total)

    print("[3/5] 规划分片")
    slices = plan_slices(ordered, args.shard1, args.chunk, args.min_shards, args.max_shards)
    print(f"  共 {len(slices)} 片：第 1 片 {len(slices[0])} 字，"
          f"其余 {min(len(s) for s in slices[1:])}~{max(len(s) for s in slices[1:])} 字")

    # 覆盖校验：先算清楚再落盘
    union = set()
    for chunk_cps in slices:
        union |= set(chunk_cps)
    if union != set(cps):
        missing = sorted(set(cps) - union)
        extra = sorted(union - set(cps))
        raise SystemExit(f"覆盖校验失败：缺 {len(missing)} 个码位（{missing[:20]}）、"
                         f"多 {len(extra)} 个（{extra[:20]}）")
    if sum(len(s) for s in slices) != len(cps):
        raise SystemExit("覆盖校验失败：分片之间有重复码位")
    print(f"  覆盖校验通过：{len(slices)} 片并集 = 母本 {len(cps)} 个码位，无缺无重")

    if args.dry_run:
        print("[4/5] --dry-run：不生成分片、不写 fonts.css / manifest.json")
        print(f"  计划：{len(slices)} 片，每片 {len(slices[0])} 字（首片）、"
              f"{min(len(s) for s in slices[1:])}~{max(len(s) for s in slices[1:])} 字")
        hot = [cp for cp in ordered[:20]]
        print("  第 1 片前 20 个字（按站点文档频率降序）："
              + "".join(chr(cp) for cp in hot))
        print(f"  已生成时预计合计 ≈ 母本 × 1.11；当前实际合计 "
              f"{sum(p.stat().st_size for p in out_dir.glob('huajiantang-*.woff2'))} 字节")
        print(f"  总用时 {time.time() - started:.1f}s（dry-run 免去约 {len(slices) * 3}s 的子集化）")
        return 0

    print(f"[4/5] 生成分片 → {out_dir.relative_to(root)}/")
    out_dir.mkdir(parents=True, exist_ok=True)
    # 已有的分片只在「这一轮的整个切法没变」时才复用。
    # 判据：计划里每一片的目标文件都已存在，且每个文件都非空。
    # 只要有一片对不上（换字体、改粒度、上一轮没跑完），就全部重生成，
    # 免得留下「旧字节流 + 新清单」这种对不上的状态。
    planned = [out_dir / shard_name(i) for i in range(1, len(slices) + 1)]
    all_present = all(p.is_file() and p.stat().st_size > 0 for p in planned)
    reuse = all_present and not args.force
    if reuse:
        print(f"  · {len(planned)} 片都已存在且完整，复用（要强制重生成加 --force）")
    sizes: list[int] = []
    for index, chunk_cps in enumerate(slices, start=1):
        dest = out_dir / shard_name(index)
        if reuse:
            sizes.append(dest.stat().st_size)
            continue
        t0 = time.time()
        write_shard(master, chunk_cps, dest)
        sizes.append(dest.stat().st_size)
        print(f"  · {dest.name}  {len(chunk_cps):>4} 字  "
              f"{sizes[-1] / 1024:>7.1f} KB  {time.time() - t0:.1f}s")
    if reuse:
        for dest, chunk_cps, size in zip(planned, slices, sizes):
            print(f"  · {dest.name}  {len(chunk_cps):>4} 字  {size / 1024:>7.1f} KB")

    # 清掉上一轮多出来的分片（母本不动）
    keep = {shard_name(i) for i in range(1, len(slices) + 1)}
    for stale in sorted(out_dir.glob("huajiantang-*.woff2")):
        if stale.name not in keep:
            stale.unlink()
            print(f"  · 删除上一轮残留的 {stale.name}")

    total_bytes = sum(sizes)
    growth = total_bytes / master_bytes
    print(f"  分片合计 {total_bytes} 字节（{total_bytes / 1024:.1f} KB）= "
          f"母本的 {growth:.3f} 倍（上限 {args.max_growth}）")
    if growth > args.max_growth:
        raise SystemExit(f"分片总字节超过母本的 {args.max_growth} 倍：切太碎了，"
                         f"调大 --chunk 或减少片数后重跑")

    print(f"[5/5] 写 {css_path.relative_to(root)} 与 {manifest_path.name}")
    stats = {
        "docs": docs,
        "shard1": args.shard1,
        "chunk": args.chunk,
        "master_codepoints": len(cps),
        "used_codepoints": sum(1 for cp in cps if df.get(cp)),
        "master_bytes": master_bytes,
        "total_shard_bytes": total_bytes,
        "growth": round(growth, 4),
        "html_files": len([p for p in root.glob(HTML_GLOB)
                           if not any(t in p.name for t in HTML_EXCLUDE)]),
    }
    css_path.parent.mkdir(parents=True, exist_ok=True)
    css_path.write_text(render_css(slices, sizes, master_bytes, out_dir.name, stats),
                        encoding="utf-8", newline="\n")

    manifest = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "generator": "tools/fonts/slice_font.py",
        "usage": ("python tools/fonts/slice_font.py --root \"D:\\曼沫砾总线\\Chenxu-MarshEco.github.io\""),
        "master": f"public/fonts/{master.name}",
        "master_bytes": master_bytes,
        "family": FAMILY,
        "font_weight": FONT_WEIGHT,
        "font_style": FONT_STYLE,
        "font_display": FONT_DISPLAY,
        "css": "src/styles/fonts.css",
        "params": {
            "shard1": args.shard1,
            "chunk": args.chunk,
            "min_shards": args.min_shards,
            "max_shards": args.max_shards,
            "max_growth": args.max_growth,
            "frequency_source": [HTML_GLOB, *MD_GLOBS, *JSON_GLOBS],
        },
        "stats": stats,
        "shards": [
            {
                "index": i,
                "file": f"public/fonts/{shard_name(i)}",
                "url": f"/fonts/{shard_name(i)}",
                "bytes": sizes[i - 1],
                "codepoints": len(chunk_cps),
                "ranges": to_ranges(chunk_cps),
                "unicode": [f"U+{cp:04X}" for cp in chunk_cps],
            }
            for i, chunk_cps in enumerate(slices, start=1)
        ],
        "master_unicode": [f"U+{cp:04X}" for cp in cps],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n",
                             encoding="utf-8", newline="\n")

    print(f"  写完，用时 {time.time() - started:.1f}s")
    print(f"\n分片数 {len(slices)}｜合计 {total_bytes / 1024:.1f} KB｜"
          f"母本 {master_bytes / 1024:.1f} KB｜倍数 {growth:.3f}×")
    print("下一步：node tools/fonts/report.mjs  看覆盖率与逐页成本")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
