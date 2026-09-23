/*
 * ============================================================================
 *  顶栏那两个控件：站内搜索框 + 随机跳转
 * ----------------------------------------------------------------------------
 *  位置在 BoardDrawer.astro 的 .corner 里，回到顶部左边。
 *  参考的是 Minecraft Wiki / PRTS 那套搜索体验（用户 2026-09-22 点名要的）：
 *    · 边打字边在下面展开候选（不用先跳一页再看结果）；
 *    · 回车：够强就直接进那一页，不够强就进中转页把所有可能列出来；
 *    · 上下键选候选，Esc 收起来。
 *  差别只有一处：本站的中转页会把「精华里的某一条」也单列出来，
 *  点进去直接落到冰室精华页里那条的位置（/salon/#<id>）。
 *
 *  这个文件被 BoardDrawer.astro 用 ?raw 内联（同 src/music/player.js）：
 *  不能 import/export、不能出现「闭合脚本标签」那几个字面字符。
 *  索引与打分的对象在 src/search/core.js（内联在本文件之前）。
 * ============================================================================
 */
(function () {
  'use strict';

  var S = window.HuayaSearch;
  if (!S) return;

  /* ======================================================================
   *  一、搜索框
   * ==================================================================== */
  var wrap = document.getElementById('site-search');
  var input = document.getElementById('site-search-input');
  var go = document.getElementById('site-search-go');
  var pop = document.getElementById('site-search-pop');
  var rowsBox = document.getElementById('site-search-rows');
  var hint = document.getElementById('site-search-hint');
  var allBtn = document.getElementById('site-search-all');

  if (wrap && input && pop && rowsBox) {
    /** 当前查询的全部命中（不打折的那个表） */
    var list = [];
    /** 下面真正显示出来的那几行 */
    var rows = [];
    /** 键盘选中的是第几行；-1 = 没选，回车交给「直达/中转」的判断 */
    var active = -1;
    var LIMIT = 8;

    /* ---- 开合 ---- */
    function openPop() {
      if (pop.hidden) {
        pop.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }
    }
    function closePop() {
      if (pop.hidden) return;
      pop.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    /* ---- 画 ---- */
    /** 标题太长就切一刀：精华条目的标题是整段正文，卡片上放不下 */
    function clip(s, n) {
      return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function renderRow(entry, i) {
      var it = entry.it;
      var snip = S.snippet(it, input.value);
      // 摘录没命中（说明是靠标题/地址命上的）就退回索引里带的副标题
      var sub = snip || S.esc(it.sub || it.h);
      // 站外的条目单独标一下，并且新开标签页 —— 别把正在浏览的人带出站
      var badge = it.ext ? '外链' : S.KIND[it.k] || it.k;
      return (
        '<a class="srch__row" id="srch-row-' + i + '" role="option" aria-selected="false" href="' +
        S.esc(it.h) +
        '"' +
        (it.ext ? ' target="_blank" rel="noopener"' : '') +
        '>' +
        '<span class="srch__rowTop">' +
        '<span class="srch__rowTitle">' +
        S.mark(clip(it.t, 44), input.value) +
        '</span>' +
        '<span class="srch__kind">' +
        S.esc(badge) +
        '</span>' +
        '</span>' +
        (sub ? '<span class="srch__rowSub">' + sub + '</span>' : '') +
        '</a>'
      );
    }

    function render() {
      var q = input.value;
      list = S.search(q, 0);
      rows = list.slice(0, LIMIT);
      active = -1;

      if (!S.ready()) {
        rowsBox.innerHTML = '<p class="srch__note">正在载入索引…</p>';
        openPop();
        if (hint) hint.textContent = '';
        if (allBtn) allBtn.hidden = true;
        return;
      }

      if (!q.trim()) {
        // 空框没什么可列的：收起来，别占着屏幕
        closePop();
        return;
      }

      var html = '';
      if (!rows.length) {
        html = '<p class="srch__note">没有找到「' + S.esc(clip(q.trim(), 30)) + '」</p>';
      } else {
        for (var i = 0; i < rows.length; i++) html += renderRow(rows[i], i);
      }
      rowsBox.innerHTML = html;
      openPop();
      /*
        页脚那行字是这个功能唯一的「说明书」：回车到底会去哪儿。
        不说的话，用户不知道自己是会被直接带走还是被送到中转页。
      */
      var d = S.direct(list);
      if (hint) {
        if (d) hint.textContent = '回车：直接打开「' + clip(d.title, 16) + '」';
        else if (list.length) hint.textContent = '回车：看全部 ' + list.length + ' 条结果';
        else hint.textContent = '';
      }
      if (allBtn) {
        allBtn.hidden = !list.length;
        allBtn.textContent = '全部 ' + list.length + ' 条 →';
      }
    }

    /** 键盘选中态：改 aria 与样式，并把选中的那行滚进视野 */
    function paintActive() {
      var nodes = rowsBox.querySelectorAll('.srch__row');
      for (var i = 0; i < nodes.length; i++) {
        var on = i === active;
        nodes[i].classList.toggle('is-active', on);
        nodes[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (active >= 0 && rows[active]) input.setAttribute('aria-activedescendant', 'srch-row-' + active);
      else input.removeAttribute('aria-activedescendant');
      if (active >= 0 && nodes[active] && nodes[active].scrollIntoView) {
        nodes[active].scrollIntoView({ block: 'nearest' });
      }
    }

    /** 上下键在候选里走一圈；从第一行再往上就回到「没选」 */
    function move(delta) {
      if (!rows.length) return;
      if (active < 0) active = delta > 0 ? 0 : rows.length - 1;
      else {
        active += delta;
        if (active >= rows.length) active = -1;
        if (active < -1) active = rows.length - 1;
      }
      paintActive();
    }

    /** 回车 / 点放大镜：先看有没有键盘选中的那一行，再按强弱决定直达或中转 */
    function submit() {
      if (active >= 0 && rows[active]) {
        location.href = rows[active].it.h;
        return;
      }
      if (!S.ready()) {
        S.load().then(submit);
        return;
      }
      var d = S.direct(list);
      if (d) {
        location.href = d.href;
        return;
      }
      location.href = S.transitUrl(input.value);
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', function () {
      S.load().then(render);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        closePop();
      }
    });
    if (go) {
      // 点放大镜==回车（按钮在框内，点它不会让框失焦）
      go.addEventListener('click', submit);
    }
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        location.href = S.transitUrl(input.value);
      });
    }
    // 鼠标一进这一块就先把索引取上：等真敲字/点随机时就不用等网络了
    wrap.addEventListener('mouseenter', function () {
      S.load();
    });
    // 点别处收起来。用 mousedown：它比 click 早，但不影响点结果行本身的跳转
    document.addEventListener('mousedown', function (e) {
      if (!wrap.contains(e.target)) closePop();
    });
  }

  /* ======================================================================
   *  二、随机跳转
   * ==================================================================== */
  var jump = document.getElementById('random-jump');
  if (jump) {
    var LAST = 'huajiantang.random.last';
    var remember = function (href) {
      try {
        sessionStorage.setItem(LAST, href);
      } catch (e) {
        /* 私密模式等场景：记不住就算了 */
      }
    };
    var recall = function () {
      try {
        return sessionStorage.getItem(LAST) || '';
      } catch (e) {
        return '';
      }
    };

    jump.addEventListener('mouseenter', function () {
      S.load();
    });
    jump.addEventListener('focus', function () {
      S.load();
    });
    jump.addEventListener('click', function () {
      S.load().then(function () {
        var pool = S.randomPool(location.pathname);
        // 上一次去过的那一页这次不去了：连抽两次同一页会让人觉得「这功能没在动」
        var last = recall();
        if (pool.length > 1 && last) {
          var trimmed = pool.filter(function (p) {
            return p.href !== last;
          });
          if (trimmed.length) pool = trimmed;
        }
        if (!pool.length) return;
        var pick = pool[Math.floor(Math.random() * pool.length)];
        remember(pick.href);
        location.href = pick.href;
      });
    });
  }
})();
