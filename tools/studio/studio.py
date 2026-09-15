#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
花娅陌质流 —— 写作台

一个蒸汽波风格的控制窗口，替代原来那个黑底白字的菜单。
所有东西都在画布上手绘：渐变天空、CRT 扫描线、塔吊剪影、霓虹辉光。
不依赖任何第三方库，只用 Python 自带的 tkinter。

配色取自用户提供的参考图，逐带采样得到：
    顶部 #4a0f61 → 中段最亮 #d4007b → 压暗 #8f0050 → 剪影 #050004
扫描线把整体平均值压到 #8c0055 一带，所以背景要画得比"看起来"更亮一点。
"""

import ctypes
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path

# ---------------------------------------------------------------- 路径

ROOT = Path(__file__).resolve().parents[2]      # 项目根目录
IS_WIN = sys.platform == 'win32'

# 所有子进程都带这个标记，不弹控制台黑框。
# 早先只有启动 pnpm 那一处加了，结果每 4 秒一次的状态检查
# 会闪一个黑窗口出来 —— 就是用户看到的"时不时弹窗然后立马关掉"。
NO_WINDOW = subprocess.CREATE_NO_WINDOW if IS_WIN else 0

# ---------------------------------------------------------------- 配色

CJK_FONT = 'Microsoft YaHei UI'
MONO_FONT = 'Consolas'

# 天空渐变，取自参考图
SKY_STOPS = [
    (0.00, (74, 15, 97)),
    (0.10, (110, 12, 115)),
    (0.22, (165, 0, 126)),
    (0.38, (200, 5, 125)),
    (0.48, (212, 0, 123)),
    (0.60, (184, 0, 106)),
    (0.72, (143, 0, 80)),
    (0.84, (90, 0, 56)),
    (1.00, (26, 0, 19)),
]

SILHOUETTE = (5, 0, 4)
SCANLINE_FACTOR = 0.78          # 扫描线压暗程度
NEON = '#ff3ea5'                # 霓虹粉
NEON_RGB = (255, 62, 165)       # 同上的 RGB 形式，画辉光时要拿来做混合
NEON_SOFT = '#ff8fd0'
CYAN = '#5ff0ff'                # 点缀青（蒸汽波经典配色）
DIM = '#c9a3c9'

W, H = 940, 660


def hexof(rgb):
    return '#%02x%02x%02x' % rgb


def to_rgb(c):
    """颜色可能是 (r,g,b) 元组，也可能是 '#rrggbb' 字符串。

    画辉光的时候这两种会混着传进来，统一在这里转换，
    免得每个调用点都要记住该传哪种。
    """
    if isinstance(c, str):
        c = c.lstrip('#')
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
    return tuple(c)


def blend(c1, c2, t):
    """在两个颜色之间插值，t=0 取 c1，t=1 取 c2。"""
    a = to_rgb(c1)
    b = to_rgb(c2)
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def sky_at(t):
    """按纵向比例取天空颜色。"""
    t = max(0.0, min(1.0, t))
    for i in range(len(SKY_STOPS) - 1):
        p0, c0 = SKY_STOPS[i]
        p1, c1 = SKY_STOPS[i + 1]
        if p0 <= t <= p1:
            local = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return blend(c0, c1, local)
    return SKY_STOPS[-1][1]


def rounded_points(x1, y1, x2, y2, r, steps=10):
    """生成圆角矩形的多边形顶点。tkinter 没有圆角矩形，只能自己算。"""
    r = min(r, (x2 - x1) / 2, (y2 - y1) / 2)
    pts = []
    corners = [
        (x2 - r, y1 + r, -90, 0),      # 右上
        (x2 - r, y2 - r, 0, 90),       # 右下
        (x1 + r, y2 - r, 90, 180),     # 左下
        (x1 + r, y1 + r, 180, 270),    # 左上
    ]
    import math
    for cx, cy, a0, a1 in corners:
        for i in range(steps + 1):
            a = math.radians(a0 + (a1 - a0) * i / steps)
            pts.extend([cx + r * math.cos(a), cy + r * math.sin(a)])
    return pts


def auto_message():
    """自动生成提交说明。

    早先这里是弹一个输入框让用户手填，但那个框只有「按回车」一条提交路径，
    窗口一旦没拿到键盘焦点（从 .cmd 用 start 拉起来时很常见），
    敲回车毫无反应，界面就永久卡在那一屏 —— 用户遇到的就是这个。

    既然要的是傻瓜式一键发布，说明就自动生成，带上日期时间，
    在提交历史里仍能看出「这次是哪天发的」。
    """
    return time.strftime('更新内容 %Y-%m-%d %H:%M')


# ---------------------------------------------------------------- 主程序

class Studio:

    def __init__(self, root):
        self.root = root
        self.bg_rows = []          # 背景逐行颜色，重绘时复用
        self.mode = 'menu'
        # 可以同时跑多个后台进程（编辑器 + 预览），用 key 区分。
        # 以前只有一个 self.proc，开一个就把另一个顶掉。
        self.procs = {}
        # 当前在日志页里看着哪个进程
        self.active = None
        self.outq = queue.Queue()
        self.busy = False
        self.buttons = {}
        self.hover = None

        root.title('花娅陌质流')
        root.configure(bg=hexof(sky_at(0.5)))
        root.geometry(f'{W}x{H}')
        root.resizable(False, False)

        self._dark_titlebar()

        self.canvas = tk.Canvas(root, width=W, height=H, highlightthickness=0,
                                bg=hexof(sky_at(0.5)))
        self.canvas.pack(fill='both', expand=True)

        self.f_title = tkfont.Font(family=CJK_FONT, size=34, weight='bold')
        self.f_sub = tkfont.Font(family=CJK_FONT, size=12)
        self.f_btn = tkfont.Font(family=CJK_FONT, size=15, weight='bold')
        self.f_hint = tkfont.Font(family=CJK_FONT, size=10)
        self.f_log = tkfont.Font(family=MONO_FONT, size=10)
        self.f_tag = tkfont.Font(family=CJK_FONT, size=9, weight='bold')

        root.bind('<Escape>', lambda e: self.on_escape())

        self.draw_menu()
        self.root.after(120, self.poll_queue)
        self.root.after(150, self.refresh_status)

    # ------------------------------------------------------------ 外观

    def _dark_titlebar(self):
        """把 Windows 的标题栏改成深色，跟窗口内部协调。"""
        if not IS_WIN:
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            for attr in (20, 19):      # 20 = Win10 1903+，19 = 更早版本
                val = ctypes.c_int(1)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, attr, ctypes.byref(val), ctypes.sizeof(val))
        except Exception:
            pass

    def paint_sky(self):
        """画渐变天空，并把扫描线直接揉进逐行颜色里（省掉一层图元）。"""
        self.bg_rows = []
        for y in range(H):
            t = y / (H - 1)
            c = sky_at(t)
            if (y % 3) == 0:
                c = tuple(int(v * SCANLINE_FACTOR) for v in c)
            self.bg_rows.append(c)
            self.canvas.create_line(0, y, W, y, fill=hexof(c), tags='bg')

        self.draw_ground()
        self.draw_cranes()

    def draw_ground(self):
        """底部的地面剪影：树丛、楼顶、起重机的底座轮廓。"""
        base = H - 44
        pts = [0, H, 0, base + 18]
        # 几组树冠，用折线堆出高低起伏
        bumps = [
            (30, 16), (70, 30), (105, 12), (150, 26), (196, 34),
            (240, 14), (285, 22), (330, 30), (372, 16), (420, 26),
            (470, 34), (520, 18), (566, 12), (610, 28), (660, 20),
            (705, 32), (750, 16), (800, 26), (850, 14), (900, 22),
        ]
        for x, hgt in bumps:
            pts.extend([x, base - hgt])
        pts.extend([W, base + 18, W, H])
        self.canvas.create_polygon(pts, fill=hexof(SILHOUETTE), outline='',
                                   tags='bg')

    def draw_crane(self, x, base_y, height, jib, counter, flip=False, tags='bg'):
        """画一台塔吊剪影。参考图里右侧那台是主体，左侧几台更远更小。"""
        s = -1 if flip else 1
        top = base_y - height
        col = hexof(SILHOUETTE)

        # 塔身：两根竖线 + 交叉支撑
        half = 7
        self.canvas.create_line(x - half, base_y, x - half, top, fill=col,
                                width=2, tags=tags)
        self.canvas.create_line(x + half, base_y, x + half, top, fill=col,
                                width=2, tags=tags)
        steps = max(3, int(height / 16))
        for i in range(steps):
            y0 = base_y - height * i / steps
            y1 = base_y - height * (i + 1) / steps
            self.canvas.create_line(x - half, y0, x + half, y1, fill=col,
                                    width=1, tags=tags)

        # 顶部的塔尖
        apex = top - height * 0.16
        self.canvas.create_line(x, apex, x - half, top, fill=col, width=2, tags=tags)
        self.canvas.create_line(x, apex, x + half, top, fill=col, width=2, tags=tags)

        # 起重臂与平衡臂
        jib_end = x + s * jib
        cw_end = x - s * counter
        self.canvas.create_line(x, top, jib_end, top, fill=col, width=3, tags=tags)
        self.canvas.create_line(x, top, cw_end, top, fill=col, width=3, tags=tags)

        # 拉索
        self.canvas.create_line(apex, apex + 2, jib_end, top, fill=col,
                                width=1, tags=tags)
        self.canvas.create_line(apex, apex + 2, cw_end, top, fill=col,
                                width=1, tags=tags)

        # 平衡重
        cw_w = max(6, int(counter * 0.22))
        self.canvas.create_rectangle(cw_end - cw_w, top, cw_end + 4, top + 14,
                                     fill=col, outline='', tags=tags)

        # 小车与吊钩
        trolley = x + s * jib * 0.62
        hook_bottom = top + height * 0.30
        self.canvas.create_line(trolley, top, trolley, hook_bottom, fill=col,
                                width=1, tags=tags)
        self.canvas.create_rectangle(trolley - 3, hook_bottom,
                                     trolley + 3, hook_bottom + 7,
                                     fill=col, outline='', tags=tags)

    def draw_cranes(self):
        ground = H - 40
        # 右侧那台大的，跟参考图一样伸进画面中央
        self.draw_crane(760, ground, 300, 300, 70)
        # 远处两台小的
        self.draw_crane(120, ground - 8, 165, 130, 42)
        self.draw_crane(255, ground - 4, 120, 95, 30, flip=True)

    def glow_text(self, x, y, text, font, color, glow, layers=7, spread=1.6):
        """霓虹辉光：由外向内叠若干层，越外层越接近背景色。

        tkinter 画布没有透明度，所以只能把辉光色跟背景色混合后画实色，
        再往上叠本体。层数多了会糊，7 层左右刚好。
        """
        bg = sky_at(y / H)
        for i in range(layers, 0, -1):
            t = (i / layers) ** 1.5
            c = blend(glow, bg, t * 0.72)
            for dx, dy in ((0, 0), (spread * i * 0.5, 0),
                           (-spread * i * 0.5, 0), (0, spread * i * 0.5),
                           (0, -spread * i * 0.5)):
                self.canvas.create_text(x + dx, y + dy, text=text, font=font,
                                        fill=hexof(c), tags='ui')
        self.canvas.create_text(x, y, text=text, font=font, fill=color, tags='ui')

    # ------------------------------------------------------------ 菜单

    def clear(self):
        # Text 控件不是画布图元，canvas.delete('all') 删不掉它。
        # 不显式销毁的话，切回菜单后那个日志框会浮在窗口上。
        if getattr(self, 'log', None) is not None:
            try:
                self.log.destroy()
            except Exception:
                pass
            self.log = None
        self.canvas.delete('all')

    def draw_menu(self):
        self.mode = 'menu'
        self.clear()
        self.buttons = {}

        self.canvas.create_rectangle(0, 0, W, H, fill=hexof(sky_at(0.5)),
                                     outline='', tags='bg')
        self.paint_sky()

        # 标题
        self.glow_text(W / 2, 118, '花 娅 陌 质 流', self.f_title, '#ffffff', NEON)
        self.canvas.create_text(W / 2, 162, text='等待篠雨的日子里',
                                font=self.f_sub, fill=NEON_SOFT, tags='ui')

        # 四个按钮
        self.make_button('write', '写 文 章', '打开编辑器，在浏览器里写', 0)
        self.make_button('preview', '看 效 果', '在浏览器里预览站点', 1)
        self.make_button('publish', '发布上线', '提交并推送到 GitHub', 2)
        self.make_button('setup', '首次设置', '检查环境、安装依赖', 3)

        # 状态栏
        self.status_y = H - 22
        self.canvas.create_text(30, self.status_y, text='', anchor='w',
                                font=self.f_hint, fill=DIM, tags='status')
        self.canvas.create_text(W - 30, self.status_y, text='Esc 退出',
                                anchor='e', font=self.f_hint, fill=DIM, tags='ui')
        self.refresh_status()

    def make_button(self, key, label, hint, index):
        col = index % 2
        row = index // 2
        bw, bh = 300, 92
        gap_x, gap_y = 40, 26
        start_x = (W - (bw * 2 + gap_x)) / 2
        start_y = 218

        x1 = start_x + col * (bw + gap_x)
        y1 = start_y + row * (bh + gap_y)
        x2, y2 = x1 + bw, y1 + bh

        tag = f'btn_{key}'
        self.buttons[key] = dict(x1=x1, y1=y1, x2=x2, y2=y2, tag=tag,
                                 label=label, hint=hint)
        self.paint_button(key, hover=False)

        self.canvas.tag_bind(tag, '<Enter>', lambda e, k=key: self.set_hover(k, True))
        self.canvas.tag_bind(tag, '<Leave>', lambda e, k=key: self.set_hover(k, False))
        self.canvas.tag_bind(tag, '<Button-1>', lambda e, k=key: self.launch(k))

    def paint_button(self, key, hover=False):
        b = self.buttons[key]
        tag = b['tag']
        self.canvas.delete(tag)

        if hover:
            face = (58, 8, 48)
            edge = NEON
            text_col = '#ffffff'
            hint_col = NEON_SOFT
        else:
            face = (36, 4, 42)
            edge = '#8a2b6b'
            text_col = '#ffd9ef'
            hint_col = '#b98aa8'

        cx = (b['x1'] + b['x2']) / 2
        cy = (b['y1'] + b['y2']) / 2

        # 悬停时先铺一层外发光
        if hover:
            for i in range(5, 0, -1):
                g = blend(NEON_RGB, sky_at(cy / H), 0.55 + i * 0.07)
                pts = rounded_points(b['x1'] - i * 1.6, b['y1'] - i * 1.6,
                                     b['x2'] + i * 1.6, b['y2'] + i * 1.6,
                                     12 + i, steps=6)
                self.canvas.create_polygon(pts, fill=hexof(g), outline='',
                                           tags=tag)

        pts = rounded_points(b['x1'], b['y1'], b['x2'], b['y2'], 12)
        self.canvas.create_polygon(pts, fill=hexof(face), outline=edge,
                                   width=2, tags=tag)

        # 左边缘一道青色高光，蒸汽波常见的霓虹描边
        self.canvas.create_line(b['x1'] + 6, b['y1'] + 16,
                                b['x1'] + 6, b['y2'] - 16,
                                fill=CYAN if hover else '#3f7f8a',
                                width=3, tags=tag)

        self.canvas.create_text(cx, cy - 12, text=b['label'], font=self.f_btn,
                                fill=text_col, tags=tag)
        self.canvas.create_text(cx, cy + 20, text=b['hint'], font=self.f_hint,
                                fill=hint_col, tags=tag)

    def set_hover(self, key, on):
        if self.mode != 'menu' or self.busy:
            return
        if self.hover == key and on:
            return
        if not on and self.hover != key:
            return
        if self.hover and self.hover != key:
            self.paint_button(self.hover, hover=False)
        self.hover = key if on else None
        self.paint_button(key, hover=on)

    # ------------------------------------------------------------ 状态

    def refresh_status(self, recheck=True):
        """刷新状态栏。

        这里以前是这样写的：每 4 秒同步跑一次 `git remote get-url origin`。
        两个后果，都很难受：

          1. 那个 subprocess 没带 CREATE_NO_WINDOW，于是每 4 秒
             闪出一个控制台黑框又立刻关掉
          2. 同步调用发生在 Tk 主线程上，界面每 4 秒被冻住一次，
             鼠标基本点不动

        现在改成：git 检查丢到后台线程，结果缓存起来；主线程只负责
        照着缓存重绘。回到菜单时才重新探一次（draw_menu 会调这里）。
        """
        if self.mode != 'menu':
            return
        if recheck:
            self._probe_remote_async()
        self._paint_status()

    def _probe_remote_async(self):
        """后台线程里探一次 git 远端，探完回主线程重绘"""
        if getattr(self, '_probing', False):
            return
        self._probing = True

        def work():
            remote = None
            git = shutil.which('git')
            if git:
                try:
                    r = subprocess.run(
                        [git, 'remote', 'get-url', 'origin'],
                        cwd=str(ROOT), capture_output=True, text=True,
                        timeout=8, creationflags=NO_WINDOW)
                    if r.returncode == 0:
                        remote = r.stdout.strip()
                except Exception:
                    pass
            self._remote = remote
            self._probing = False
            try:
                self.root.after(0, self._paint_status)
            except Exception:
                pass

        threading.Thread(target=work, daemon=True).start()

    def _paint_status(self):
        """只重绘，不做任何阻塞操作"""
        if self.mode != 'menu':
            return
        deps = (ROOT / 'node_modules').exists()
        remote = getattr(self, '_remote', None)

        parts = []
        parts.append((('依赖 已就绪' if deps else '依赖 未安装'), deps))
        parts.append((('备份 已连接' if remote else '备份 未连接'), bool(remote)))

        # 后台还在跑的进程也列出来。返回菜单不会停掉它们，
        # 不显示的话用户会以为已经关了。
        running = [v['title'] for k, v in self.procs.items()
                   if v['proc'].poll() is None]
        if running:
            parts.append(('运行中 ' + '、'.join(running), True))

        self.canvas.delete('status')
        x = 30
        for text, good in parts:
            col = '#7dffb0' if good else '#ffb36b'
            self.canvas.create_oval(x, self.status_y - 4, x + 8, self.status_y + 4,
                                    fill=col, outline='', tags='status')
            item = self.canvas.create_text(x + 15, self.status_y, text=text,
                                           anchor='w', font=self.f_hint,
                                           fill=DIM, tags='status')
            bbox = self.canvas.bbox(item)
            x = bbox[2] + 26

        # 有后台进程时，右下角给一个「停止后台」。
        # 返回菜单不会停进程，所以得留一个明确的收尾入口。
        self.canvas.delete('stopall')
        if running:
            self.canvas.create_text(
                W - 92, self.status_y, text='停止后台', anchor='e',
                font=self.f_hint, fill='#ff9b6b', tags=('stopall',))
            self.canvas.tag_bind('stopall', '<Button-1>', lambda e: self.stop_all_ui())

    def stop_all_ui(self):
        self.stop_all()
        self._paint_status()

    # ------------------------------------------------------------ 运行界面

    def show_running(self, title, key=None):
        self.mode = 'running'
        self.active = key
        self.hover = None
        self.clear()
        self.canvas.create_rectangle(0, 0, W, H, fill=hexof(sky_at(0.5)),
                                     outline='', tags='bg')
        self.paint_sky()

        self.glow_text(W / 2, 62, title, self.f_btn, '#ffffff', NEON, layers=5)

        # 有别的进程还在后台跑时，提示一句 —— 否则用户会以为切走了就没了
        others = [v['title'] for k, v in self.procs.items()
                  if k != key and v['proc'].poll() is None]
        sub = '输出实时显示在下面'
        if others:
            sub += '　·　后台还在跑：' + '、'.join(others)
        self.canvas.create_text(W / 2, 96, text=sub,
                                font=self.f_hint, fill=NEON_SOFT, tags='ui')

        # 日志区用真正的 Text 控件叠在画布上，方便滚动和选中
        self.log = tk.Text(self.root, bg='#12000f', fg='#e8d0e0',
                           insertbackground=NEON, font=self.f_log,
                           relief='flat', bd=0, wrap='word',
                           highlightthickness=1, highlightbackground='#8a2b6b')
        self.canvas.create_window(W / 2, 396, window=self.log,
                                  width=W - 96, height=320)

        self.make_small_button('back', '返 回', 90, H - 46, self.back_to_menu)
        self.stop_btn = self.make_small_button('stop', '停 止', W - 190, H - 46,
                                               self.stop_proc)
        # 只有真的在跑才显示「停止」
        state = 'normal' if (key and self.is_running(key)) else 'hidden'
        self.canvas.itemconfigure(self.stop_btn, state=state)

    def make_small_button(self, key, label, x, y, cmd):
        tag = f'small_{key}'
        w, h = 100, 36
        pts = rounded_points(x, y - h / 2, x + w, y + h / 2, 9)
        self.canvas.create_polygon(pts, fill='#2a0430', outline='#8a2b6b',
                                   width=2, tags=(tag, 'ui'))
        self.canvas.create_text(x + w / 2, y, text=label, font=self.f_hint,
                                fill='#ffd9ef', tags=(tag, 'ui'))
        self.canvas.tag_bind(tag, '<Button-1>', lambda e: cmd())
        self.canvas.tag_bind(tag, '<Enter>', lambda e: self.canvas.itemconfigure(
            self.canvas.find_withtag(tag)[0], fill='#4a0850'))
        self.canvas.tag_bind(tag, '<Leave>', lambda e: self.canvas.itemconfigure(
            self.canvas.find_withtag(tag)[0], fill='#2a0430'))
        return tag

    def back_to_menu(self):
        """回到菜单。

        以前这里写的是 `if self.proc: return` —— 只要还有进程在跑，
        点「返回」就完全没反应，看着像界面卡死了。用户遇到的就是这个。

        其实返回根本不需要先停进程：编辑器和预览留在后台继续跑就行，
        菜单底部会显示它们还在运行。要停哪个再单独停。
        """
        self.draw_menu()

    def log_write(self, text):
        if getattr(self, 'log', None) and self.log.winfo_exists():
            self.log.insert('end', text)
            self.log.see('end')

    def poll_queue(self):
        try:
            while True:
                kind, key, payload = self.outq.get_nowait()
                if kind == 'out':
                    # 只把「正在看的那个进程」的输出打到日志上，
                    # 否则编辑器和预览的输出会混在一起
                    if self.active == key:
                        self.log_write(payload)
                elif kind == 'done':
                    self.on_proc_done(key, payload)
        except queue.Empty:
            pass
        self.root.after(100, self.poll_queue)

    def on_proc_done(self, key, code):
        self.procs.pop(key, None)
        if self.active == key:
            self.busy = False
            self.canvas.itemconfigure(self.stop_btn, state='hidden')
            if code == 0:
                self.log_write('\n─── 完成 ───\n')
            else:
                self.log_write(f'\n─── 结束，退出码 {code} ───\n')

    # ------------------------------------------------------------ 执行

    def resolve(self, name):
        """Windows 上 pnpm / npm 是 .cmd，要用 which 找出真实路径。"""
        return shutil.which(name) or name

    def is_running(self, key):
        entry = self.procs.get(key)
        return bool(entry and entry['proc'].poll() is None)

    def spawn(self, key, args, title, show=True):
        """启动一个后台进程。

        与早先最大的不同：用 key 区分进程，可以同时跑多个。
        写文章（编辑器 4322）和看效果（预览 4321）本来就该并存 ——
        编辑器里的「排版」模式要靠预览服务取页面。以前只有一个
        self.proc，开一个顶掉另一个，排版因此根本没法用。

        同一个 key 已在跑就直接切过去，不会起第二份（端口会撞）。
        """
        if self.is_running(key):
            if show:
                self.show_running(title, key)
            return

        if show:
            self.show_running(title, key)

        env = dict(os.environ)
        env['PYTHONIOENCODING'] = 'utf-8'
        env['FORCE_COLOR'] = '0'

        def worker():
            try:
                proc = subprocess.Popen(
                    args, cwd=str(ROOT), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                    env=env, bufsize=1, universal_newlines=True,
                    encoding='utf-8', errors='replace',
                    creationflags=NO_WINDOW)
                self.procs[key] = {'proc': proc, 'title': title}
                for line in proc.stdout:
                    self.outq.put(('out', key, line))
                code = proc.wait()
                self.outq.put(('done', key, code))
            except Exception as exc:
                self.outq.put(('out', key, f'启动失败：{exc}\n'))
                self.outq.put(('done', key, 1))

        threading.Thread(target=worker, daemon=True).start()

    def stop_proc(self):
        """停掉当前正在看的那个进程。"""
        entry = self.procs.get(self.active) if self.active else None
        if not entry:
            return
        pid = entry['proc'].pid
        self.log_write('\n正在停止…\n')
        try:
            if IS_WIN:
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)],
                               capture_output=True, creationflags=NO_WINDOW)
            else:
                entry['proc'].terminate()
        except Exception:
            pass

    def stop_all(self):
        """把所有后台进程停掉（菜单里的「停止后台」用）"""
        for key in list(self.procs.keys()):
            self.active = key
            entry = self.procs.get(key)
            if entry:
                try:
                    subprocess.run(
                        ['taskkill', '/F', '/T', '/PID', str(entry['proc'].pid)],
                        capture_output=True, creationflags=NO_WINDOW)
                except Exception:
                    pass
        self.procs.clear()
        self.active = None

    # ------------------------------------------------------------ 四个动作

    def need_deps(self):
        if (ROOT / 'node_modules').exists():
            return True
        self.show_running('还没装依赖')
        self.log_write('项目依赖还没有安装。\n\n请先返回，选「首次设置」。\n')
        self.busy = False
        self.canvas.itemconfigure(self.stop_btn, state='hidden')
        return False

    def launch(self, key):
        if key == 'write':
            if not self.need_deps():
                return
            # 编辑器要连着预览一起开。
            # 编辑器里的「排版」模式需要预览服务（4321）在场才能取到页面，
            # 只开编辑器的话排版会报「先打开看效果」。预览放后台、不弹浏览器。
            # 显式 --host 127.0.0.1：astro dev 默认只绑 localhost（Windows 上
            # 常解析成 IPv6 ::1），那样 127.0.0.1 连不上，代理会失败。
            self.spawn('preview',
                       [self.resolve('pnpm'), 'dev', '--host', '127.0.0.1'],
                       '看效果', show=False)
            self.spawn('editor', [self.resolve('pnpm'), 'editor', '--open'],
                       '写文章')
        elif key == 'preview':
            if not self.need_deps():
                return
            self.spawn('preview',
                       [self.resolve('pnpm'), 'dev', '--host', '127.0.0.1'],
                       '看效果')
            self.root.after(5000, self.open_browser)
        elif key == 'publish':
            if not self.need_deps():
                return
            self.start_publish()
        elif key == 'setup':
            self.spawn('setup', [self.resolve('pnpm'), 'install'], '首次设置')

    def open_browser(self):
        try:
            os.startfile('http://localhost:4321')
        except Exception:
            pass

    def start_publish(self):
        """发布前先确认能连上 GitHub，再直接开始发布。"""
        self.show_running('发布上线', 'publish')
        self.log_write('正在检查能否连上 GitHub…\n')
        self.busy = True

        def probe():
            git = shutil.which('git')
            ok = False
            detail = ''
            if not git:
                detail = '没有找到 git，请先做「首次设置」。'
            else:
                try:
                    r = subprocess.run([git, 'ls-remote', '--heads', 'origin'],
                                       cwd=str(ROOT), capture_output=True,
                                       text=True, timeout=40,
                                       creationflags=NO_WINDOW)
                    ok = r.returncode == 0
                    detail = (r.stderr or '').strip()
                except Exception as exc:
                    detail = str(exc)
            self.root.after(0, lambda: self.after_probe(ok, detail))

        threading.Thread(target=probe, daemon=True).start()

    def after_probe(self, ok, detail):
        if not ok:
            self.busy = False
            self.log_write(
                '连不上 GitHub。\n\n'
                '最常见的原因是代理没开：\n'
                '  1. 打开 Clash Verge\n'
                '  2. 确认「订阅」里已经导入了节点\n'
                '  3. 打开「系统代理」开关\n\n'
                '然后返回重试。\n')
            if detail:
                self.log_write(f'\n（细节：{detail[:300]}）\n')
            return

        self.log_write('连接正常，开始发布…\n')
        self.do_publish(auto_message())

    def do_publish(self, message):
        self.show_running('发布上线', 'publish')
        self.busy = True
        self.canvas.itemconfigure(self.stop_btn, state='normal')
        git = shutil.which('git') or 'git'

        def worker():
            def run(args, timeout=None):
                self.outq.put(('out', f'$ git {" ".join(args)}\n'))
                r = subprocess.run([git] + args, cwd=str(ROOT),
                                   capture_output=True, text=True,
                                   encoding='utf-8', errors='replace',
                                   timeout=timeout, creationflags=NO_WINDOW)
                if r.stdout:
                    self.outq.put(('out', r.stdout))
                if r.stderr:
                    self.outq.put(('out', r.stderr))
                return r.returncode

            run(['add', '-A'])
            changed = subprocess.run([git, 'status', '--short'], cwd=str(ROOT),
                                     capture_output=True, text=True,
                                     encoding='utf-8', errors='replace',
                                     creationflags=NO_WINDOW)
            if not changed.stdout.strip():
                self.outq.put(('out', '\n没有任何改动，不用发布。\n'))
                self.outq.put(('done', 0))
                return

            self.outq.put(('out', '\n这次要提交的文件：\n'))
            self.outq.put(('out', changed.stdout + '\n'))

            if run(['commit', '-m', message]) != 0:
                self.outq.put(('out', '\n提交失败，把上面的报错发给我看看。\n'))
                self.outq.put(('done', 1))
                return

            self.outq.put(('out', '\n正在推送到 GitHub…\n'))
            code = run(['push'], timeout=180)
            if code == 0:
                self.outq.put(('out', '\n推送成功！等一两分钟刷新网址就能看到更新。\n'))
            else:
                self.outq.put(('out',
                               '\n推送失败。常见原因：\n'
                               '  - 代理掉了，重开 Clash Verge 再试\n'
                               '  - 还没登录 GitHub：gh auth login\n'
                               '  - 缺 workflow 权限：gh auth refresh -s workflow\n'))
            self.outq.put(('done', code))

        threading.Thread(target=worker, daemon=True).start()

    # ------------------------------------------------------------ 交互

    def on_escape(self):
        # 日志页按 Esc：先回菜单（不停进程），再按一次才退出。
        # 以前在日志页按 Esc 会直接停掉进程，容易误伤正在跑的编辑器。
        if self.mode == 'running':
            self.back_to_menu()
        else:
            self.on_close()

    def on_close(self):
        """退出前把后台进程收干净 —— 否则编辑器/预览会变成孤儿进程
        一直占着 4321 / 4322 端口，下次启动就冲突。"""
        running = [k for k in self.procs if self.is_running(k)]
        if running:
            try:
                self.stop_all()
            except Exception:
                pass
        self.root.destroy()


def work_area():
    """屏幕可用区域（扣掉任务栏）。"""
    if IS_WIN:
        import ctypes.wintypes as wt

        class RECT(ctypes.Structure):
            _fields_ = [('l', wt.LONG), ('t', wt.LONG),
                        ('r', wt.LONG), ('b', wt.LONG)]

        rc = RECT()
        # SPI_GETWORKAREA = 48
        ctypes.windll.user32.SystemParametersInfoW(48, 0, ctypes.byref(rc), 0)
        if rc.r > rc.l and rc.b > rc.t:
            return rc.r - rc.l, rc.b - rc.t
    return 1920, 1080


def center_window(win, w, h):
    """把窗口摆到工作区正中央。

    Windows 给新窗口的默认位置是层叠下来的，可能把窗口底部推到屏幕外面，
    底下那排状态栏就看不见了。所以自己算一次位置，顺便保证不越界。
    """
    win.update_idletasks()
    aw, ah = work_area()
    title_bar = 40                      # 标题栏大约占这么多
    x = max(0, (aw - w) // 2)
    y = max(0, (ah - (h + title_bar)) // 2)
    win.geometry(f'{w}x{h}+{x}+{y}')


def crash_box(message):
    """无控制台启动（pythonw）时，崩溃会静默消失。

    所以兜一个系统级消息框，把真实错误摆到用户面前，
    顺便写一份日志方便事后查。
    """
    try:
        log = Path(os.environ.get('TEMP', '.')) / 'huayamozhiliu-crash.log'
        log.write_text(message, encoding='utf-8')
    except Exception:
        pass
    try:
        ctypes.windll.user32.MessageBoxW(
            0, message[:1500], '花娅陌质流 启动失败', 0x10)
    except Exception:
        print(message)


def main():
    if not IS_WIN:
        print('这个窗口目前只针对 Windows 写。')
    try:
        root = tk.Tk()
        app = Studio(root)
        # 点窗口的 X 也要走 on_close —— 否则编辑器/预览会变成孤儿进程
        # 继续占着 4321 / 4322，下次启动直接端口冲突。
        root.protocol('WM_DELETE_WINDOW', app.on_close)
        center_window(root, W, H)
        # 窗口真正映射到屏幕之后，系统可能又把它摆到别处（层叠位置之类），
        # 所以等它显示出来再摆一次，确保稳稳落在屏幕中央。
        root.after(80, lambda: center_window(root, W, H))
        root.after(600, lambda: center_window(root, W, H))
        # 启动器应该自己冒到前面来，否则双击后可能藏在别的窗口后面
        root.lift()
        root.attributes('-topmost', True)
        root.after(1200, lambda: root.attributes('-topmost', False))
        root.focus_force()
        root.mainloop()
    except Exception:
        import traceback
        crash_box(traceback.format_exc())
        raise


if __name__ == '__main__':
    main()
