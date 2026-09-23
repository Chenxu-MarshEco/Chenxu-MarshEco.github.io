/*
 * ============================================================================
 *  /search/ 中转页的脚本
 * ----------------------------------------------------------------------------
 *  从顶栏搜索框回车、但匹配「不够强」时落到这里（够强就直接进那一页了）。
 *  它把同一个查询的**全部**命中按种类分组铺开，让人自己挑。
 *  参考的也是 Minecraft Wiki / PRTS 的搜索结果页：一页列全、分组、每条都能点。
 *
 *  本站的特殊要求（用户原话）：冰室精华里的每一条精华都能单独跳转，
 *  所以 kind=essence 的那些条目点的不是 /salon/，而是 /salon/#<id> —— 
 *  精华页那边会直接滚到那一条的位置。
 *
 *  内联方式同 src/music/player.js（不加 import / 不出现闭合脚本标签）。
 * ============================================================================
 */
(function () {
  'use strict';

  var S = window.HuayaSearch;
  var page = document.getElementById('srch-page');
  if (!S || !page) return;

  var form = document.getElementById('srch-page-form');
  var input = document.getElementById('srch-page-input');
  var sum = document.getElementById('srch-page-sum');
  var body = document.getElementById('srch-page-body');

  /** 每组先铺这么多条，剩下的点「再显示」再加 —— 一次塞几千个节点会卡住滚动 */
  var STEP = 50;
  var shown = Object.create(null);

  function esc(s) {
    return S.esc(s);
  }

  function clip(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** 一条结果（中转页里竖排成一行一行的卡片） */
  function itemHtml(entry, q) {
    var it = entry.it;
    var meta = it.sub ? it.sub + ' · ' + it.h : it.h;
    return (
      '<li class="srchPage__item">' +
      '<a class="srchPage__link" href="' + esc(it.h) + '"' +
      (it.ext ? ' target="_blank" rel="noopener"' : '') +
      '>' +
      '<span class="srchPage__title">' + S.mark(clip(it.t, 90), q) + '</span>' +
      '<span class="srchPage__meta">' + esc(clip(meta, 120)) + '</span>' +
      '</a></li>'
    );
  }

  /**
   * 按种类分组渲染。
   * 组的先后不是写死的：**哪一组里出现了排在最前面的那条，哪一组就在最上面**。
   * 写死顺序的话，明明精华那条分最高，却因为「页面/文章」排在前面而被压到下面，
   * 而且顶栏下拉里的第一条会和中转页的第一条对不上（这两处必须是同一套排序的下游）。
   * 组内保持 core.js 的排序（分数高的在前），所以第一组的第一条就是全局第一条。
   */
  function renderList(list, q) {
    if (!list.length) {
      body.innerHTML =
        '<p class="srchPage__none">没有找到和「' + esc(clip(q, 40)) + '」有关的任何东西。<br>' +
        '换个短一点的词试试，或者从下面的页面清单里直接挑。</p>' + directory();
      sum.textContent = '「' + clip(q, 40) + '」：0 条结果';
      return;
    }

    var groups = Object.create(null);
    var order = [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i].it.k || 'page';
      if (!groups[k]) {
        groups[k] = [];
        order.push(k);
      }
      groups[k].push(list[i]);
    }

    var html = '';
    var used = 0;
    for (var g = 0; g < order.length; g++) {
      var kind = order[g];
      var arr = groups[kind];
      used += arr.length;
      var take = Math.min(arr.length, shown[kind] || STEP);
      var items = '';
      for (var j = 0; j < take; j++) items += itemHtml(arr[j], q);
      html +=
        '<section class="srchPage__group" data-kind="' + esc(kind) + '">' +
        '<h2 class="srchPage__groupTitle">' + esc(S.KIND[kind] || kind) +
        '<span class="srchPage__count">' + arr.length + ' 条</span></h2>' +
        '<ul class="srchPage__items">' + items + '</ul>' +
        (arr.length > take
          ? '<button class="srchPage__more" type="button" data-more="' + esc(kind) + '">再显示 ' +
            Math.min(STEP, arr.length - take) + ' 条</button>'
          : '') +
        '</section>';
    }
    // 理论上不会有：core.js 的排序里冒出一个这里不认识的 k 时别把结果吞掉
    if (used < list.length) {
      html += '<p class="srchPage__none">还有 ' + (list.length - used) + ' 条没归类的结果。</p>';
    }
    body.innerHTML = html;
    sum.textContent = '「' + clip(q, 40) + '」：共 ' + list.length + ' 条结果，按种类分好组了';
  }

  /** 空查询时的页面清单：全站整页都在这儿，等于一张「随便逛逛」的目录 */
  function directory() {
    var all = S.all() || [];
    var pages = [];
    var seen = Object.create(null);
    for (var i = 0; i < all.length; i++) {
      var it = all[i];
      if (it.k !== 'page' || seen[it.h]) continue;
      seen[it.h] = 1;
      pages.push(it);
    }
    pages.sort(function (a, b) {
      return a.h < b.h ? -1 : a.h > b.h ? 1 : 0;
    });
    var html = '<h2 class="srchPage__groupTitle">全站页面<span class="srchPage__count">' +
      pages.length + ' 个</span></h2><ul class="srchPage__items srchPage__items--dir">';
    for (var j = 0; j < pages.length; j++) {
      html +=
        '<li class="srchPage__item"><a class="srchPage__link" href="' + esc(pages[j].h) + '">' +
        '<span class="srchPage__title">' + esc(pages[j].t) + '</span>' +
        '<span class="srchPage__meta">' + esc(pages[j].h) + '</span></a></li>';
    }
    return html + '</ul>';
  }

  /** 空查询：不搜，但把中转页变成一张能用的目录 */
  function renderEmpty() {
    body.innerHTML = directory();
    var n = (S.all() || []).length;
    sum.textContent = '全站索引共 ' + n + ' 条：整页 ' + countKind('page') + ' 个，精华 ' +
      countKind('essence') + ' 条，都可以从这里直接点进去';
  }

  function countKind(k) {
    var all = S.all() || [];
    var n = 0;
    for (var i = 0; i < all.length; i++) if (all[i].k === k) n++;
    return n;
  }

  function run(q, push) {
    var val = String(q || '').trim();
    if (input) input.value = val;
    if (push) {
      try {
        history.pushState({ q: val }, '', S.transitUrl(val));
      } catch (e) {
        /* 老浏览器/沙箱里失败也无所谓，页面照常渲染 */
      }
    }
    if (!S.ready()) {
      sum.textContent = '正在载入索引…';
      body.innerHTML = '';
    }
    S.load().then(function () {
      if (val) renderList(S.search(val, 0), val);
      else renderEmpty();
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      shown = Object.create(null); // 换了查询词，「再显示」的进度要重新算
      run(input ? input.value : '', true);
    });
  }
  if (body) {
    body.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
      if (!btn) return;
      var kind = btn.getAttribute('data-more');
      shown[kind] = (shown[kind] || STEP) + STEP;
      renderList(S.search(input ? input.value : '', 0), input ? input.value : '');
    });
  }
  window.addEventListener('popstate', function () {
    shown = Object.create(null);
    run(new URLSearchParams(location.search).get('q') || '', false);
  });

  run(new URLSearchParams(location.search).get('q') || '', false);
})();
