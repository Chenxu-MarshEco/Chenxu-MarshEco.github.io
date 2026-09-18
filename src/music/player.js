/*
 * 全站音乐播放器（没有可见界面：按钮在右上角那一组里）。
 *
 * 这个文件被 MusicPlayer.astro 用 ?raw 读成字符串、原样内联进 <head>，
 * 所以：只能写最普通的浏览器 API，不能 import，不能有 TS 语法，
 * 也不能出现「闭合脚本标签」那几个字面字符（会提前把标签截断，
 * 后面半段就成了页面上的文字）—— MusicPlayer.astro 里有构建期检查，
 * 真写了会直接构建报错，而不是上线后一片空白。
 *
 * 纯静态站（多页 MPA）里 <audio> 会随页面卸载一起死掉，真正的无缝续播
 * 需要把整站改成 SPA —— 对这个站来说风险太大。这里走的是「存档 + 淡入淡出」：
 *   1. 点站内链接时先看目标页认领的第一首是不是我正在放的这首：
 *      · 是同一首 —— 什么都不做，让浏览器正常跳转，歌一直响，新页面按
 *        存档里的进度接着放（不重头）；
 *      · 是别的歌 —— 短淡出（0.26s）；
 *      · 目标页没有歌单 / 没认领第一首 —— 长淡出到静音（0.9s）。
 *   2. 播放进度、当前曲目写在 sessionStorage 里（只在本标签页有效，
 *      关掉标签页就该忘掉），音量与静音写在 localStorage 里。
 *   3. 浏览器的自动播放策略常常会拒绝新的页面直接出声。被拒就把按钮
 *      标成「待启动」，并在用户第一次按下鼠标/键盘时补一次 play()。
 */
(function () {
  'use strict';

  var D = window.__MUSIC_DATA__;
  if (!D || !D.tracks || !D.tracks.length) return;

  var STATE_KEY = 'huajiantang.music.state';
  var VOL_KEY = 'huajiantang.music.volume';

  // 淡入淡出时长（秒）
  var IN_RESUME = 0.18; // 接着放：只需抹掉起播那一下的爆音
  var IN_FRESH = 0.75; // 换歌 / 新页面第一首
  var OUT_SHORT = 0.26; // 目标页是别的歌
  var OUT_LONG = 0.9; // 目标页没歌 / 没认领第一首：慢慢静下去

  var tracks = D.tracks;
  var bySrc = Object.create(null);
  for (var i = 0; i < tracks.length; i++) bySrc[tracks[i].s] = tracks[i];

  /*
    在 <head> 里就把 audio 建出来、把地址填上：这一段执行时就开始拉音频了，
    比等 body 解析完再建要早得多，跳页后的空档因此短很多。
    audio 不带 controls 时 UA 样式表就是 display:none，不会占位。
  */
  var audio = document.createElement('audio');
  audio.id = 'music-audio';
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(audio);

  var cur = null; // 当前这首 {i,t,s}
  var fade = 0; // 淡入淡出系数 0..1，乘以音量
  var vol = 0.7; // 用户音量 0..1
  var muted = false;
  var seq = 0; // 淡入淡出的代次：新的一次开始，旧的立刻作废
  var raf = 0;
  var needsGesture = false;
  /** 长淡出到静音、正在离场：这时任何「顺手存一下」都不许再写存档 */
  var leaving = false;

  var box = null;
  var btn = null;
  var range = null;
  var num = null;
  var hint = null;
  var hintText = null;
  var buffering = false;
  /** 这一轮「按下」之前音乐是不是已经在放（默认 true：不确定时就当它在放，别乱改音量） */
  var downWasPlaying = true;

  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // ---- 音量 / 静音 --------------------------------------------------
  try {
    var savedVol = JSON.parse(localStorage.getItem(VOL_KEY) || 'null');
    if (savedVol && typeof savedVol.v === 'number' && isFinite(savedVol.v)) {
      vol = clamp01(savedVol.v);
      muted = !!savedVol.muted;
    }
  } catch (e) {
    /* 无痕模式读不了 localStorage，用默认值就是 */
  }

  function applyVol() {
    audio.volume = muted ? 0 : clamp01(vol * fade);
  }

  function persistVol() {
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify({ v: vol, muted: muted }));
    } catch (e) {}
  }

  /**
   * 把淡入淡出系数在 sec 秒内线性推到 target。
   * rAF 在后台标签页会停，所以另配一个 setTimeout 兜底 ——
   * 不然「淡出完再跳转」有可能卡在半路，点了链接却不走。
   */
  function rampTo(target, sec, done) {
    seq++;
    var my = seq;
    var fired = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    var from = fade;
    var ms = Math.max(0, sec * 1000);

    function finish() {
      if (my !== seq || fired) return;
      fired = true;
      fade = target;
      applyVol();
      if (done) done();
    }

    if (!ms) {
      finish();
      return;
    }

    var t0 = performance.now ? performance.now() : Date.now();
    var tick = function (now) {
      if (my !== seq) return;
      var k = ((now || Date.now()) - t0) / ms;
      if (k >= 1) {
        raf = 0;
        finish();
        return;
      }
      fade = from + (target - from) * k;
      applyVol();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    setTimeout(function () {
      if (my === seq && !fired) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        finish();
      }
    }, ms + 90);
  }

  // ---- 存档（跨页面接着播全靠它）------------------------------------
  function readState() {
    try {
      return JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function saveState(playing) {
    // 已经决定「这一站不再捡回来了」：pagehide / timeupdate 随后还会来敲门，
    // 不拦住的话刚清掉的存档又被写回去，下一站就会把这半首歌捡起来接着放。
    if (leaving) return;
    try {
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          src: cur ? cur.s : null,
          t: audio.currentTime || 0,
          at: Date.now(),
          playing: playing == null ? !audio.paused : !!playing
        })
      );
    } catch (e) {}
  }

  function clearState() {
    try {
      sessionStorage.removeItem(STATE_KEY);
    } catch (e) {}
  }

  // ---- 放歌 ---------------------------------------------------------
  /** 随机挑一首；歌单只有一首就是它自己 */
  function pick(except) {
    if (tracks.length <= 1) return tracks[0];
    var idx = Math.floor(Math.random() * tracks.length);
    for (var n = 0; n < 8 && tracks[idx] === except; n++) {
      idx = Math.floor(Math.random() * tracks.length);
    }
    if (tracks[idx] === except) idx = (idx + 1) % tracks.length;
    return tracks[idx];
  }

  function playWith(fadeSec) {
    rampTo(1, fadeSec);
    var p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(armGesture);
  }

  /**
   * 「该出声的时候补一次 play()」。
   * 用户第一次动手、点音量键、拖音量条都走这里 —— 不许出现
   * 「点了音量键反而更没声音」（起播那一下被顺手静音了，最像坏了）。
   */
  function ensureSound() {
    if (!audio.paused && !needsGesture) return;
    var wasPlaying = !audio.paused && audio.currentTime > 0.2;
    needsGesture = false;
    // 已经听过一截就别把音量从 0 再拉一遍，否则会先小声一下
    if (!wasPlaying) fade = 0;
    applyVol();
    playWith(wasPlaying ? IN_RESUME : IN_FRESH);
  }

  /** 浏览器不让自动出声：等用户第一次动手再补 */
  function armGesture() {
    if (needsGesture) return;
    needsGesture = true;
    paint();
    var kick = function (e) {
      /*
        按在音量键自己身上时**不要抢着补 play()**：那一下点击是"开始播放"，
        让它自己的 click 处理（见 wire()）先判断该不该静音。
        这里要是先跑了 play()，click 再看到"已经在放了"，就会把用户刚点出来的
        音乐当场静音 —— 正是"点了音量键反而没声音"的根子。
      */
      var t = e && e.target;
      if (t && t.closest && t.closest('#music-vol')) return;
      document.removeEventListener('pointerdown', kick, true);
      document.removeEventListener('keydown', kick, true);
      document.removeEventListener('touchstart', kick, true);
      document.removeEventListener('click', kick, true);
      ensureSound();
    };
    document.addEventListener('pointerdown', kick, true);
    document.addEventListener('keydown', kick, true);
    document.addEventListener('touchstart', kick, true);
    // click 也挂一份：个别触摸流程只派发 click，多一条网不漏
    document.addEventListener('click', kick, true);
  }

  /**
   * 开始放某一首。
   * resumeAt 有值 = 从这一秒接着放（跨页面同一首歌）；
   * 没值 = 从头放，淡入也用长一点的那档。
   */
  function startTrack(t, resumeAt) {
    cur = t;
    audio.src = t.s;
    var seek = function () {
      if (resumeAt == null) return;
      var d = audio.duration;
      var at = resumeAt;
      if (isFinite(d) && d > 0) at = Math.min(at, Math.max(0, d - 0.35));
      try {
        audio.currentTime = at;
      } catch (e) {}
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek, { once: true });
    fade = 0;
    applyVol();
    playWith(resumeAt == null ? IN_FRESH : IN_RESUME);
    paint();
  }

  function next() {
    startTrack(pick(cur));
  }

  // ---- 右上角那颗音箱音量键 -----------------------------------------
  /** 提示条改字并亮出来（只有文字变了才写 DOM） */
  function setHint(text) {
    if (!hint) return;
    if (hintText && hintText.textContent !== text) hintText.textContent = text;
    hint.hidden = false;
  }

  function paint() {
    var playing = !audio.paused && !audio.ended;
    var lvl = muted ? 0 : vol;
    if (btn) {
      btn.classList.toggle('is-muted', lvl <= 0.001);
      btn.classList.toggle('is-loud', lvl > 0.55);
      /*
        is-paused = 还没出声（被自动播放策略挡着，或用户自己按空格暂停了）。
        这颗键会因此长出一个小 ▶ 角标并轻轻呼吸 —— 光靠"暗一点"没人知道要点它。
      */
      btn.classList.toggle('is-paused', !playing);
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      var name = cur ? cur.t : '';
      var label;
      if (needsGesture) label = '点一下开始播放';
      else if (lvl <= 0.001) label = '已静音';
      else label = '音量 ' + Math.round(lvl * 100) + '%';
      btn.title = cur ? label + ' · ' + name : label;
      btn.setAttribute('aria-label', needsGesture ? '点一下开始播放' : '音量');
    }
    // 提示条：还没出声就一直亮着（"待很久才开始放"就是没人告诉用户要点一下）；
    // 点了之后如果还在缓冲，就改说"缓冲中" —— 8MB 一首，慢网下这段等待是真的。
    if (hint) {
      if (needsGesture) {
        setHint('点一下播放');
      } else if (buffering) {
        setHint('缓冲中…');
      } else {
        hint.hidden = true;
      }
    }
    var shown = Math.round(lvl * 100);
    if (range && document.activeElement !== range) range.value = String(shown);
    if (num) num.textContent = shown + '%';
  }

  function wire() {
    box = document.getElementById('music-vol');
    if (!box) return;
    btn = document.getElementById('music-vol-btn');
    range = document.getElementById('music-vol-range');
    num = document.getElementById('music-vol-num');
    hint = document.getElementById('music-hint');
    hintText = document.getElementById('music-hint-text');
    // 按钮默认是 hidden 的：没有歌单的页面不会跑这段脚本，它就一直藏着
    box.hidden = false;

    if (btn) {
      btn.addEventListener('click', function () {
        /*
          按下去之前音乐没在放 → 这一下点击的本意是**"让它响"**，
          绝不能顺手切成静音（用户点了音量键却更没声音，只会觉得功能坏了）。
          已经在放了 → 才是正常的静音开关。
        */
        if (!downWasPlaying) {
          muted = false;
          if (vol <= 0.001) vol = 0.7;
          ensureSound();
          persistVol();
          paint();
          return;
        }
        muted = !muted;
        if (!muted && vol <= 0.001) vol = 0.7;
        applyVol();
        persistVol();
        paint();
      });
    }

    /*
      真按下（按在按钮上、或按在音量条上）就是一记用户手势 ——
      自动播放被挡的时候，只有在这一刻调 play() 浏览器才认。
      先记下"按下之前是不是已经在放"，供上面的 click 判断。
    */
    box.addEventListener(
      'pointerdown',
      function () {
        downWasPlaying = !audio.paused && !audio.ended;
        ensureSound();
      },
      true
    );

    if (range) {
      range.addEventListener('input', function () {
        vol = clamp01(Number(range.value) / 100);
        muted = vol <= 0.001;
        // 只拖音量条也得能把音乐带起来（不然拖了没反应，一样像坏了）
        ensureSound();
        applyVol();
        paint();
      });
      range.addEventListener('change', persistVol);
    }

    // 鼠标停在按钮上滚一下也能调音量
    box.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault();
        vol = clamp01(vol + (e.deltaY > 0 ? -0.05 : 0.05));
        muted = vol <= 0.001;
        ensureSound();
        applyVol();
        persistVol();
        paint();
      },
      { passive: false }
    );

    paint();
  }

  // ---- 跨页面：地址 -> 页面 key，与构建期同一套规则 ------------------
  function normPath(p) {
    if (p.charAt(0) !== '/') p = '/' + p;
    p = p.replace(/\/+$/, '');
    return p || '/';
  }

  function keyForPath(pathname) {
    var p = pathname || '/';
    var base = D.base || '';
    if (base && p.indexOf(base) === 0) p = p.slice(base.length) || '/';
    /*
      浏览器给的 pathname 是百分号编码过的：文件名叫「测试文案」的文章，
      链接 href 在 HTML 里是原文，但 new URL().pathname 会变成 %E6%B5%8B…
      构建期的表里存的是原文，这里不还原就永远匹配不上（会一路退到 /posts）。
      按段解码，顺手躲开 %2F 这种会把一段切成两段的写法。
    */
    p = p
      .split('/')
      .map(function (seg) {
        try {
          return decodeURIComponent(seg);
        } catch (e) {
          return seg;
        }
      })
      .join('/');
    p = normPath(p);
    for (;;) {
      if (Object.prototype.hasOwnProperty.call(D.map, p)) return D.map[p];
      var i = p.lastIndexOf('/');
      if (i <= 0) return null;
      // 往上退一层：/tags/某标签 退到 /tags，于是标签页自动用「标签」那条歌单
      p = p.slice(0, i);
    }
  }

  /**
   * 点击站内链接时决定怎么退场。
   * 返回秒数：0 = 不淡出（同一首歌，直接跳，歌不停）。
   */
  function leavePlan(url) {
    var key = keyForPath(url.pathname);
    var hasOwn = Object.prototype.hasOwnProperty;
    var hasKey = !!key && hasOwn.call(D.pages, key);
    var hasGeneric = hasOwn.call(D.pages, '*');
    if (!hasKey && !hasGeneric) return OUT_LONG; // 目标页没有歌单
    var nextFirst = hasKey ? D.pages[key] : D.pages['*'];
    if (!nextFirst) return OUT_LONG; // 目标页没认领第一首
    if (cur && nextFirst === cur.s) return 0; // 就是这一首：别打断
    return OUT_SHORT;
  }

  document.addEventListener(
    'click',
    function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var el = e.target;
      var a = el && el.closest ? el.closest('a[href]') : null;
      if (!a) return;
      var tgt = a.getAttribute('target');
      if (tgt && tgt !== '_self') return;
      if (a.hasAttribute('download')) return;

      var url;
      try {
        url = new URL(a.href, location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      // 同页锚点、同页刷新式跳转：不动
      if (url.pathname === location.pathname && url.search === location.search) return;

      var wait = leavePlan(url);
      saveState(!audio.paused);
      if (!wait) return; // 交给浏览器：歌一直响，跳过去接着放

      e.preventDefault();
      var long = wait >= OUT_LONG;
      rampTo(0, wait, function () {
        audio.pause();
        if (long) {
          // 都淡到静音了：下一站不该再把这半首歌捡回来
          leaving = true;
          clearState();
        } else {
          saveState(false);
        }
        location.href = url.href;
      });
    },
    true
  );

  audio.addEventListener('ended', next);
  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  audio.addEventListener('volumechange', paint);
  // 真的开始出声 / 卡住等数据：提示条靠这两个事件说"缓冲中"
  audio.addEventListener('playing', function () {
    buffering = false;
    paint();
  });
  audio.addEventListener('waiting', function () {
    buffering = true;
    paint();
  });

  var lastSave = 0;
  audio.addEventListener('timeupdate', function () {
    var now = Date.now();
    if (now - lastSave > 900) {
      lastSave = now;
      saveState();
    }
  });

  // 页面要走的时候把进度存下来；pagehide 比 unload 可靠（手机上尤其）
  window.addEventListener('pagehide', function () {
    saveState();
  });
  window.addEventListener('beforeunload', function () {
    saveState();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveState();
  });
  document.addEventListener('keydown', function (e) {
    // 空格暂停/继续，M 静音 —— 不抢输入框里的键
    var t = e.target;
    var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
    if (e.key === 'm' || e.key === 'M') {
      if (btn) btn.click();
      return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
      if (!cur) return;
      if (audio.paused) playWith(IN_RESUME);
      else {
        saveState(false);
        audio.pause();
      }
      e.preventDefault();
    }
  });

  /*
    起播决策：
      · 存档里的这首正好是这一页认领的第一首 —— 接着放（进度 + 页面切换耗掉的时间）；
      · 否则这一页认领了第一首 —— 从头放它；
      · 都没认领 —— 随机挑一首。
    「同一首歌不要重头开始」就是第一条：上一页点了链接、这一页把它捡回来。
  */
  var saved = readState();
  var entry = null;
  var resumeAt = null;
  if (saved && saved.src && D.first && saved.src === D.first && bySrc[saved.src]) {
    entry = bySrc[saved.src];
    var elapsed = saved.at ? (Date.now() - saved.at) / 1000 : 0;
    if (!(elapsed > 0) || elapsed > 20) elapsed = 0;
    resumeAt = Math.max(0, (Number(saved.t) || 0) + elapsed);
  } else if (D.first && bySrc[D.first]) {
    entry = bySrc[D.first];
  } else {
    entry = pick(null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  startTrack(entry, resumeAt);
})();
