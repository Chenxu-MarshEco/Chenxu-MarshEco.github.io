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
      // 代码高亮主题。想换配色只改这一行，可选值见 https://shiki.style/themes
      theme: 'github-dark-default',
      wrap: true,
    },
  },

  devToolbar: {
    enabled: false,
  },
});
