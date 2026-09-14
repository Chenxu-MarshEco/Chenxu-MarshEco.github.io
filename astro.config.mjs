// @ts-check
import { defineConfig } from 'astro/config';

// 站点部署在 GitHub Pages 的「用户站点」仓库（仓库名 = 用户名.github.io）上，
// 所以站点根路径就是 /，不需要额外配置 base。
// 如果你以后改成普通项目仓库（例如 blog），把 base 改成 '/blog' 即可。
export default defineConfig({
  site: 'https://chenxu-marsheco.github.io',
  base: '/',

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
