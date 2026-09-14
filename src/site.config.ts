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

export const site = {
  /** 浏览器标题栏和页头显示的名字 */
  title: '花涧堂',
  /** 副标题 / 一句话签名，会显示在页头和首页 */
  tagline: '等待篠雨的日子里',
  /** 站点的 meta description，也会用于 RSS */
  description: '一个记录想法、笔记和一些不成熟作品的个人站点。',

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

  /** 关于页面里的自我介绍，支持 Markdown 换行（用 \n\n 分段） */
  aboutIntro: [
    '这里还没有写自我介绍。',
    '在编辑器里打开「关于」页面，或者直接改 src/pages/about.astro，把这段话换成你自己的。',
  ],

  /** 联系方式，显示在关于页 */
  contacts: [
    { label: '邮箱', value: '1398894932@qq.com' },
    { label: 'GitHub', value: 'Chenxu-MarshEco', href: 'https://github.com/Chenxu-MarshEco' },
  ] as { label: string; value: string; href?: string }[],

  /** 侧栏 / 关于页的社交链接 */
  socials: [
    { label: 'GitHub', href: 'https://github.com/Chenxu-MarshEco' },
  ] as SocialLink[],

  /** 友情链接。image 可留空，留空就只显示文字 */
  friends: [
    {
      name: '示例友链',
      href: 'https://example.com',
      description: '这里可以放朋友的站点，把这段换成真的就行。',
      image: '',
    },
  ],

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
