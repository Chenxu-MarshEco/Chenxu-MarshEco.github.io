// @ts-check
import { defineConfig } from 'astro/config';
import memlink from './tools/memlink/index.mjs';
import searchIndex from './tools/search/index.mjs';

// 站点部署在 GitHub Pages 的「用户站点」仓库（仓库名 = 用户名.github.io）上，
// 所以站点根路径就是 /，不需要额外配置 base。
// 如果你以后改成普通项目仓库（例如 blog），把 base 改成 '/blog' 即可。
export default defineConfig({
  site: 'https://chenxu-marsheco.github.io',
  base: '/',

  /*
    成员名自动链接：构建完之后逐页重写 HTML，把正文里出现的成员名包成
    「悬停浮出名片、点了跳介绍页」的小块。名字表就是编辑器「成员」面板那张表
    （src/data/salon.json），链接由你填在成员的 `url` 里。
    冰山图页（/iceberg/）整页跳过，两个理由（2026-09-22 量出来的）：
      · 那里的条目本身就是关键词、自带一张悬停详情卡；名字上再叠一张成员卡，
        鼠标停在「Raw太小了还不能产奶」这种词上会同时冒出两张浮层；
      · 名片那坨 DOM 会被插进层标题 / 条目文字里（含成员名的条目有 9 条、
        还有 1 个层标题），页面上看着没事，但文字被拆开、纯文本/复制/验收读数都不对，
        而且条目本身是链接时（如「双开门福瑞爸爸狅草」）名片里的链接会**套在条目链接里**
        （HTML 不允许，解析器会把结构拆坏）。
    细节、边界和怎么关掉：tools/memlink/index.mjs 的头注释。
  */
  /*
    冰室精华页（/salon/）**2026-09-22 起不再跳过**：用户原话「因为冰室精华已经基本
    规范完毕了，所以之前说不要把成员接入精华的限制可以取消了，现在在冰室精华页面里
    指向成员名字时要跟其他页面一样跳出名字和头像 点击可以跳转到该成员链接」。
    （当初跳过的理由见 tools/memlink/index.mjs 头注释：那会儿名字又多又碎；
    现在成员表规范了、条目文字也补齐了，链上反而有用。）
  */
  integrations: [memlink({ skip: ['/iceberg/'] }), searchIndex()],

  // 生成 /posts/xxx/index.html 这样的目录式链接，GitHub Pages 上最稳。
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },

  markdown: {
    shikiConfig: {
      // 代码高亮配色。这里必须同时给「亮色」和「暗色」两套主题。
      // 只配一套的话，在另一种主题下 token 颜色会和代码块背景撞在一起，
      // 浅色的字配浅色的底，几乎看不见。
      // 想换配色改这两个名字即可，可选值见 https://shiki.style/themes
      themes: {
        light: 'github-light-default',
        dark: 'github-dark-default',
      },
      // 关掉 shiki 自带的颜色输出。它默认用 prefers-color-scheme 媒体查询切主题，
      // 而本站是靠 <html data-theme> 切换的（用户可以手动覆盖系统设置），
      // 两者会对不上，所以取色规则改由 src/styles/global.css 自己写。
      defaultColor: false,
      wrap: true,
    },
  },

  devToolbar: {
    enabled: false,
  },
});
