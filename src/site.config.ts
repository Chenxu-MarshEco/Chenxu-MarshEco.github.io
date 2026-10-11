/**
 * ============================================================
 *  站点配置 —— 你平时最常改的就是这个文件
 * ============================================================
 *  改完保存，重新构建（或开发服务器会自动刷新）即可生效。
 *  这里只放"站点的身份信息"，具体的颜色/字体等美术设定在
 *  src/styles/tokens.css 里。
 */

export type NavItem = {
  /** 显示在导航栏上的文字 */
  label: string;
  /** 链接地址，站内用 / 开头 */
  href: string;
};

export type SocialLink = {
  label: string;
  href: string;
  /** 右侧的小字说明，可留空 */
  note?: string;
};

/** 首页大板块里的一个子版块。href 留空 = 占位，暂不可点 */
export type HomeBoardItem = {
  label: string;
  href?: string;
  /** 子版块上的一行小字 */
  note?: string;
};

/** 首页的一个大板块 */
export type HomeBoard = {
  id: string;
  title: string;
  subtitle: string;
  /** 板块背景图，放 public/img/home/ 下 */
  image: string;
  /** 点击这个板块跳到哪里 */
  href: string;
  /** 该板块自己页面里的子版块。href 留空 = 占位 */
  items: HomeBoardItem[];
};

/**
 * 首页两个大板块的数据。
 *
 * 放在独立的 JSON（src/data/home-boards.json）里而不是写死在本文件中，
 * 是为了让本地编辑器能直接读写它 —— 让编辑器去改 TypeScript 源码
 * 很容易把格式弄坏，改 JSON 则简单可靠。手改那个 JSON 也完全没问题。
 */
import homeBoardsData from './data/home-boards.json';
/*
  站点上那些「介绍 / 说明」句子（页头那句签名、meta description …）2026-10-10 挪进了
  `src/data/site-copy.json`，编辑器「文案」面板里能直接改（留空 = 不显示）。
  这一份只是把它读进来 —— **别再往这个文件里写死介绍句**，那一类句子一律走那份 JSON。
*/
import { copy as siteCopy, text as copyText } from './utils/site-copy';

export const site = {
  /** 浏览器标题栏和页头显示的名字 */
  title: '花涧堂',
  /** 副标题 / 一句话签名，会显示在页头和首页（＝文案面板里的「首页那句签名」） */
  tagline: copyText(siteCopy.site?.tagline),
  /**
   * 站点的 meta description，也会用于 RSS（＝文案面板里的「分享卡片 / 搜索结果那句描述」）。
   * ⚠ 这句话**只出现在分享卡片 / 搜索结果 / RSS 里**，页面上看不见（页面上显示的是 tagline）。
   */
  description: copyText(siteCopy.site?.description),

  /** 你的名字 / 笔名 */
  author: 'Chenxu',
  /** 版权信息里显示的年份起点 */
  since: 2026,

  /** 站点语言，影响 HTML lang 属性 */
  lang: 'zh-CN',

  /** 顶部导航栏 */
  nav: [
    { label: '首页', href: '/' },
    { label: '文章', href: '/posts' },
    { label: '手记', href: '/notes' },
    { label: '标签', href: '/tags' },
    { label: '归档', href: '/archive' },
    { label: '友链', href: '/friends' },
    { label: '关于', href: '/about' },
  ] as NavItem[],

  /**
   * 首页的两个大板块（数据在 src/data/home-boards.json）。
   *
   * 首页只显示这两个大板块本身，点进去才在各自的页面里列出 items。
   * 子版块的 href 留空就显示成「待定」占位。
   * 可以用编辑器里的「子版块」面板增删改，也可以直接改那个 JSON。
   */
  homeBoards: homeBoardsData.boards as HomeBoard[],

  /**
   * 花娅陌质流 子页面里列出的站点栏目。
   * 首页顶部导航已经去掉，这些入口挪到了这里。
   */
  sectionLinks: [
    { label: '首页', href: '/' },
    { label: '文章', href: '/posts' },
    { label: '手记', href: '/notes' },
    { label: '标签', href: '/tags' },
    { label: '归档', href: '/archive' },
    { label: '关于', href: '/about' },
  ] as NavItem[],

  /*
    ⚠ 原来这里有个 `aboutIntro`（关于页的自我介绍）。
    2026-10-10 它挪进了 `src/data/site-copy.json` 的 `about.intro` —— 编辑器「文案」面板里能改，
    留空就不显示（原来它写着两句占位说明，会直接显示在 /about/ 页面上）。
    这一类"介绍句"以后一律走那份 JSON，别再往这个文件里加。
  */

  /** 联系方式，显示在关于页 */
  contacts: [
    { label: '邮箱', value: '1398894932@qq.com' },
    { label: 'GitHub', value: 'Chenxu-MarshEco', href: 'https://github.com/Chenxu-MarshEco' },
  ] as { label: string; value: string; href?: string }[],

  /** 侧栏 / 关于页的社交链接 */
  socials: [
    { label: 'GitHub', href: 'https://github.com/Chenxu-MarshEco' },
  ] as SocialLink[],

  /**
   * 友情链接。image 可留空，留空就只显示文字。
   * ⚠ 2026-10-10：原来这里放着一条**占位的**「示例友链」（链到 example.com，说明写的是
   * 「这里可以放朋友的站点，把这段换成真的就行。」）—— 那是模板自带的，会在 /friends/ 上
   * 真的显示成一张卡片。按用户要求（「不要留任何这种生造的句子」）清空了：
   * 现在那一页只显示「还没有友链。」；有真友链时往这个数组里加就行（格式见上面那个例子）。
   */
  friends: [] as { name: string; href: string; description: string; image: string }[],

  /** 首页顶部是否显示那句 tagline */
  showTagline: true,

  /** 首页"最近写的"显示几篇 */
  homePostCount: 8,

  /** 是否在文章页面显示目录 */
  showToc: true,

  /** 页脚底部的一行小字 */
  footerNote: '本站内容除特别注明外均为原创，转载请注明出处。',
};

export default site;
