/*
 * ============================================================================
 *  站内搜索的内核：取索引 + 匹配打分 + 排序 + 高亮
 * ----------------------------------------------------------------------------
 *  顶栏那个搜索框（src/search/ui.js）和 /search/ 中转页（src/search/transit.js）
 *  都用这一份 —— 两边必须是同一套规则，否则「回车直达的那一条」和
 *  「中转页里的第一条」会指向不同的东西，用起来就是坏的。
 *
 *  这些文件都被 .astro 用 ?raw 读成字符串、原样内联进页面（同 src/music/player.js），
 *  所以只能写最普通的浏览器 API：不能 import/export，不能有 TS 语法，
 *  也不能出现「闭合脚本标签」那几个字面字符（会把 <script> 提前截断，
 *  后面的代码就变成页面上的文字了）。内联的地方有构建期检查，真写了会直接构建报错。
 *
 *  索引本身是构建期生成的 /search.json（见 tools/search/index.mjs）：
 *  静态站没有后端，只有把清单先做出来、浏览器本地过滤，敲字那一下才不用等网络。
 * ============================================================================
 */
(function () {
  'use strict';

  var S_ALREADY = window.HuayaSearch;
  /*
    /search/ 那一页上这个文件会被内联两次（顶栏一次、中转页自己一次）。
    先到的那个装完就返回：两边共用同一份索引和同一套打分，
    也只会发一次 /search.json 请求。CFG 只有一个值，谁先装都一样。
  */
  if (S_ALREADY) return;

  var CFG = window.__SEARCH_CFG__ || { index: '/search.json', home: '/search/' };

  /** 种类显示名。和 tools/search/index.mjs 里写进索引的 k 一一对应 */
  var KIND = {
    page: '页面',
    anchor: '位置',
    essence: '精华',
    post: '文章',
    note: '手记',
    nav: '导航',
    ice: '冰山',
    point: '时间轴',
    map: '地图',
  };

  /** 中转页分组的先后：整页在前，页内位置在后 */
  var ORDER = ['page', 'post', 'note', 'essence', 'anchor', 'nav', 'ice', 'point', 'map'];

  /* ------------------------------------------------------------------ 小工具 */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 查询与索引正文都走这一套归一：小写 + 空白压成一个空格 */
  function norm(s) {
    return String(s === null || s === undefined ? '' : s)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function termsOf(q) {
    return norm(q).split(' ').filter(Boolean);
  }

  /**
   * needle 的字符是不是按顺序出现在 hay 里（不要求连着）。
   * 中文没有词边界，「冰精」这种掐头去尾的打法用得上：命中「冰室精华」。
   */
  function inOrder(needle, hay) {
    var i = 0;
    for (var k = 0; k < hay.length && i < needle.length; k++) {
      if (hay[k] === needle[i]) i++;
    }
    return i === needle.length;
  }

  /**
   * 一条的打分。这些数字没有量纲，只用来**排序**和判「够不够强」，
   * 分档的依据是「人对搜索结果的预期」：
   *   标题一模一样 > 标题开头 > 标题里有 > 正文里有 > 地址里有 > 只是散落着出现。
   * 散落的（inOrder）给分很低：它误命中最多的，只在别的都没命中时才该露头。
   */
  function scoreOf(it, q) {
    var t = it._t;
    var s = it._s;
    var h = it._h;
    if (t === q) return 120;
    if (t.indexOf(q) === 0) return 100;
    if (t.indexOf(q) >= 0) return 82;
    if (s.indexOf(q) >= 0) return 56;
    if (h.indexOf(q) >= 0) return 40;
    if (inOrder(q, t)) return 34;
    if (inOrder(q, s)) return 16;
    return 0;
  }

  /* ------------------------------------------------------------------ 索引 */

  var items = null;
  var inflight = null;

  /** 索引只在第一次真的要搜索时取一次；失败也算「取过了」，不给每敲一个字都重试 */
  function load() {
    if (items) return Promise.resolve(items);
    if (inflight) return inflight;
    inflight = fetch(CFG.index, { credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.json() : { items: [] };
      })
      .then(function (j) {
        var list = (j && j.items) || [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i];
          it._t = norm(it.t);
          it._s = norm(it.s);
          it._h = norm(it.h);
        }
        items = list;
        return items;
      })
      .catch(function () {
        items = [];
        return items;
      });
    return inflight;
  }

  /** 已经取回来了吗（用来决定要不要显示「载入中」） */
  function ready() {
    return !!items;
  }

  /* ------------------------------------------------------------------ 搜索 */

  /**
   * q 里用空格分开的每个词都要命中（AND）。多词时取各自分数的平均，
   * 每多一个词加一点：命中「冰室 精华」显然比只命中「精华」更接近想要的东西。
   */
  function search(q, limit) {
    var list = items || [];
    var terms = termsOf(q);
    if (!terms.length) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var sc = 0;
      if (terms.length === 1) {
        sc = scoreOf(it, terms[0]);
      } else {
        var sum = 0;
        var ok = true;
        for (var j = 0; j < terms.length; j++) {
          var one = scoreOf(it, terms[j]);
          if (!one) {
            ok = false;
            break;
          }
          sum += one;
        }
        if (ok) sc = Math.round(sum / terms.length) + (terms.length - 1) * 6;
      }
      if (sc > 0) out.push({ it: it, score: sc });
    }
    /*
      排序必须**确定**：分数 → 标题短的在前（同样分数下短标题更像「就是它」）
      → 地址字母序。少了最后那一档，同分条目的先后会随引擎实现变，
      中转页和顶栏下拉就可能不一致。
    */
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.it.t.length !== b.it.t.length) return a.it.t.length - b.it.t.length;
      return a.it.h < b.it.h ? -1 : a.it.h > b.it.h ? 1 : 0;
    });
    return limit ? out.slice(0, limit) : out;
  }

  /**
   * 回车该直接进页面、还是进中转页？
   * 用户的原话是「根据文字的匹配程度 直接进入对应页面或是进入一个新的搜索中转页面」。
   * 这里的判据（两条都写死成常量，方便以后调）：
   *   · 头一条必须够强：STRONG 分 = 标题以查询开头（100）或一模一样（120）；
   *   · 还得甩开第二名：GAP 分以内的并列，说明「有好几个都像」，那就该给中转页让人挑。
   *   · 另一种情形：整个站只有一条结果、且它不是靠散落字符蒙上的 —— 只有一条就没有歧义。
   */
  var STRONG = 100;
  var GAP = 16;
  function direct(list) {
    if (!list || !list.length) return null;
    var top = list[0];
    var second = list[1];
    if (top.score >= STRONG && (!second || top.score - second.score >= GAP)) {
      return { href: top.it.h, title: top.it.t };
    }
    if (list.length === 1 && top.score >= 56) return { href: top.it.h, title: top.it.t };
    return null;
  }

  /** 中转页地址（带上查询词） */
  function transitUrl(q) {
    var s = String(q === null || q === undefined ? '' : q).trim();
    return s ? CFG.home + '?q=' + encodeURIComponent(s) : CFG.home;
  }

  /**
   * 随机跳转的抽签池：**整页**才算（页面 / 文章 / 手记），
   * 页内锚点和精华条目虽然也能跳，但「随机跳转」跳到某个段落中间是件莫名其妙的事。
   * /search/ 自己不进池子（跳到搜索页等于没跳），当前页也不进（原地打转没有随机感）。
   */
  function randomPool(here) {
    var list = items || [];
    var seen = Object.create(null);
    var out = [];
    var cur = String(here || '').replace(/\/$/, '');
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.k !== 'page' && it.k !== 'post' && it.k !== 'note') continue;
      var h = it.h;
      if (h.indexOf('/search/') === 0 || h.indexOf('#') >= 0) continue;
      if (h.replace(/\/$/, '') === cur) continue;
      if (seen[h]) continue;
      seen[h] = 1;
      out.push({ href: h, title: it.t });
    }
    return out;
  }

  /* ------------------------------------------------------------ 文本加工 */

  /**
   * 把 text 里命中的每个词包进 <mark>。
   * 先把所有命中区间找出来、合并、再一次性输出 —— 直接逐个词 replace 的话，
   * 两个词挨着（或一个词是另一个的前缀）会套出嵌套的 <mark> 或者漏掉后半段。
   * 文本一律走 esc()，标记是拼上去的；查询词不参与拼接，所以它没有任何注入的机会。
   */
  function mark(text, q) {
    var s = String(text === null || text === undefined ? '' : text);
    var terms = termsOf(q).sort(function (a, b) {
      return b.length - a.length;
    });
    if (!terms.length) return esc(s);
    var low = s.toLowerCase();
    var hits = [];
    for (var i = 0; i < terms.length; i++) {
      var from = 0;
      var at;
      while ((at = low.indexOf(terms[i], from)) >= 0) {
        hits.push([at, at + terms[i].length]);
        from = at + terms[i].length;
      }
    }
    if (!hits.length) return esc(s);
    hits.sort(function (a, b) {
      return a[0] - b[0];
    });
    var out = '';
    var cur = 0;
    for (var k = 0; k < hits.length; k++) {
      if (hits[k][0] < cur) {
        if (hits[k][1] > cur) cur = hits[k][1];
        continue;
      }
      out += esc(s.slice(cur, hits[k][0])) + '<mark>' + esc(s.slice(hits[k][0], hits[k][1])) + '</mark>';
      cur = hits[k][1];
    }
    return out + esc(s.slice(cur));
  }

  /** 结果卡片上那一行正文摘录：命中位置前后各切一点，只在这条真的靠正文命中时才有 */
  function snippet(it, q) {
    var s = String(it.s || '');
    var low = s.toLowerCase();
    var terms = termsOf(q);
    var at = -1;
    for (var i = 0; i < terms.length && at < 0; i++) at = low.indexOf(terms[i]);
    if (at < 0) return '';
    var from = Math.max(0, at - 24);
    var to = Math.min(s.length, at + 60);
    return (from > 0 ? '…' : '') + mark(s.slice(from, to), q) + (to < s.length ? '…' : '');
  }

  window.HuayaSearch = {
    KIND: KIND,
    ORDER: ORDER,
    load: load,
    ready: ready,
    search: search,
    direct: direct,
    transitUrl: transitUrl,
    randomPool: randomPool,
    mark: mark,
    snippet: snippet,
    esc: esc,
    norm: norm,
    terms: termsOf,
    /** 索引全部条目（中转页要按种类分组数数；取回来之前是 null） */
    all: function () {
      return items;
    },
  };
})();
