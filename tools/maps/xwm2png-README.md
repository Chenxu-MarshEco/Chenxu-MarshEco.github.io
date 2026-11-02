# xwm2png

Xaero's World Map 缓存（`.xwmc`）转 PNG 工具（通用版） — 不绑定任何服务器/地图，通用转换。

Reads [Xaero's World Map](https://modrinth.com/mod/xaeros-world-map) multiplayer region caches (`.xwmc` = ZIP containing `cache.xaero`), decodes the 64x64 RGBA8 leaf/branch textures and writes:
- `tiles\` — level-0 512x512 PNG tiles (1 px = 1 block)
- `tiles_l1\` — level-1 512x512 PNG tiles (1 px = 2 blocks)
- `overview.png` — downsampled overview (1 px = 8 blocks)
- `full.png` — full-resolution stitched map (1 px = 1 block), L1 upscaled to fill gaps
- `meta.json` — dimension metadata

## 支持格式

| 缓存版本 | 世界版本 | 目录布局 |
|---|---|---|
| major 0-1 / minor 13-25 | ≤ 26.1 | `mw$default\` |
| major 2-3 / minor 13-25 | 26.2+ | `mw$<数字世界ID>\`（如 `mw$1398528471`） |

自动跳过 `*.xwmc.outdated` 残留文件和 `rX_rZ.zip` 区域备份、`caves\` 洞穴缓存。

## 用法

```
xwm2png.exe [模式] [维度...] [-i 地图根目录] [-o 输出目录]
```

- 模式：`all` / `tiles` / `overview` / `full`（不写 = `all`）
- 维度：按目录名筛选，不写 = 全部；`minecraft$zj` 可简写为 `zj`
- `-i` 默认当前目录，`-o` 默认 `xwm_output`

详见 [使用方法.md](使用方法.md)。

## 构建

```
gcc -O2 -std=c11 -o xwm2png.exe xwm2png.c miniz.c miniz_tdef.c miniz_tinfl.c miniz_zip.c -I .
```

（Windows 也可用 `xwm2png_win.c` 变体，不依赖 dirent。）

## 许可

MIT License，详见 [LICENSE](LICENSE)。内置 miniz 2.2.0 为 MIT / public domain。
