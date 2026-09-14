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

  /**
   * 首页的两个大板块。
   *
   * 首页只显示这两个大板块本身（不显示子版块），点进去才在各自的
   * 页面里列出 items。子版块的 href 留空就显示成「待定」占位。
   */
  homeBoards: [
    {
      id: 'yongcheng',
      title: '甬城晴雨',
      subtitle: '甬神晴奇雨仰',
      image: '/img/home/block-yongcheng.jpg',
      href: '/yongcheng',
      items: [
        { label: '子版块一' },
        { label: '子版块二' },
        { label: '子版块三' },
        { label: '子版块四' },
      ],
    },
    {
      id: 'huaya',
      title: '花娅陌域',
      subtitle: '绮花阈限带',
      image: '/img/home/block-huaya.jpg',
      href: '/huaya',
      items: [
        { label: '花娅陌质流', href: '/huaya/mozhiliu' },
        { label: '花娅远位面', href: '/huaya/yuanweimian' },
        { label: '子版块三' },
        { label: '子版块四' },
      ],
    },
  ] as HomeBoard[],

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
