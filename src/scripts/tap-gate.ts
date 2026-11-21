/**
 * 触屏上的「第一下只开卡、第二下才跟着走」。
 *
 * 站长 2026-11-21 的原话：
 *   「手机端浮卡优化：手机端想要点开精华和圣经详情时 点击一下虽然会弹出浮卡 但是同时也
 *    相当于单击了精华条目 导致浏览器直接开始加载跳转到精华页面了 手机端所有有浮卡的
 *    应规定点击一下先不跳转出浮卡 再点一下才跳转」
 *
 * 为什么手机上会出现"点一下两件事一起发生"：那些卡都是**跟着鼠标悬停**做的
 * （`pointerover` 时把卡片搬进浮层），而手指点下去时浏览器会**先发 pointerover、再发 click**
 * —— 于是卡片刚亮起来，紧接着的那一下 click 就把链接打开了，用户根本来不及看一眼。
 *
 * 所以这里统一拦一道：**没有悬停能力的设备**上，点在一个"有卡的链接"上时
 *   · 第一下：只开卡（`open`），拦掉跳转；
 *   · 第二下（同一张卡）：放行。
 * 点在别处（包括卡片自己里面的链接）不受影响，也不影响电脑鼠标。
 *
 * 只收「有卡的链接」这几种：
 *   · `a.mem`            —— 成员名片（MemberCard.astro）
 *   · `a.daily__card`    —— 首页精华大殿那张卡（HomeDailyEssence.astro）
 *   · `a.phover__label`  —— 正文里的悬停图（PageContent.astro 的 `[[文字|图片|链接]]`）
 *
 * 卡本身长什么样、怎么显示都由各自的组件管，这里只决定"这一下要不要让它跳"。
 */

interface Entry {
  /** 有卡的那种元素（选择器） */
  sel: string;
  /** 第一下时把卡打开（组件自己知道怎么开） */
  open?: (el: HTMLElement) => void;
  /** 状态作废时把卡收回去（没必要的话可以不写） */
  close?: (el: HTMLElement) => void;
}

const ENTRIES: Entry[] = [];
/** 已经"开了卡、还没跟着走"的那个元素 / 它属于哪一种卡 */
let armed: HTMLElement | null = null;
let armedEntry: Entry | null = null;
let timer = 0;

/** 没有任何悬停能力的设备（手机 / 平板）；桌面鼠标恒为 false */
const touchOnly = () => window.matchMedia('(hover: none)').matches;

/** 把"等着第二下"的状态作废（顺带让卡收起来） */
function reset() {
  window.clearTimeout(timer);
  timer = 0;
  const el = armed;
  const entry = armedEntry;
  armed = null;
  armedEntry = null;
  if (el && entry?.close) entry.close(el);
}

function install() {
  const w = window as unknown as { __tapGate?: boolean };
  if (w.__tapGate) return;
  w.__tapGate = true;

  /*
    捕获阶段：要在链接自己（以及页面别处那些"点了才跳"的监听）之前决定这一下算不算数。
    `stopPropagation` 一并做掉：不拦的话，页面里那些 "click 里自己 location.href" 的写法
    照样会跳，preventDefault 只挡得住浏览器默认的链接行为。
  */
  document.addEventListener(
    'click',
    (ev) => {
      if (!touchOnly()) return;
      const t = ev.target as Element | null;
      if (!t || !t.closest) return;

      /* 卡片/浮层里面的东西（"去精华页看这一条 ›"那类）照旧一下就走 */
      if (t.closest('.memlayer, .annlayer, .daily__pop, .phover__pop')) return;

      /* 取**最里面**那一层：外层卡片里套着成员名时，手指点到的是成员名 */
      let owner: HTMLElement | null = null;
      let entry: Entry | null = null;
      for (const e of ENTRIES) {
        const hit = t.closest(e.sel) as HTMLElement | null;
        if (hit && (!owner || owner.contains(hit))) {
          owner = hit;
          entry = e;
        }
      }

      /* 没点在有卡的东西上：把"等着第二下"的状态清掉（点别处 = 放弃这张卡） */
      if (!owner || !entry) {
        reset();
        return;
      }

      if (owner === armed) {
        /* 第二下：放它走（卡片可以跟着收起，那是组件自己的事） */
        window.clearTimeout(timer);
        timer = 0;
        armed = null;
        armedEntry = null;
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();
      reset();
      armed = owner;
      armedEntry = entry;
      /* 5 秒内没有再点它，就当用户放弃了，下次还是"第一下开卡" */
      timer = window.setTimeout(reset, 5000);
      entry.open?.(owner);
    },
    true
  );

  /* 滚动：状态作废（不然滚远了再点同一个位置会莫名其妙直接跳） */
  window.addEventListener('scroll', reset, { passive: true });
}

/**
 * 登记一种"有卡的链接"。
 * 页面里几处组件各调一次；同一页上重复调也不会装两遍监听。
 */
export function tapGate(sel: string, open?: (el: HTMLElement) => void, close?: (el: HTMLElement) => void) {
  if (!ENTRIES.some((e) => e.sel === sel)) ENTRIES.push({ sel, open, close });
  install();
}
