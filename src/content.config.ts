import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 内容集合定义。
 *
 * 每个集合对应 src/content/ 下的一个文件夹，文件夹里的每个 .md 文件就是一篇文章。
 * 文件名（不含 .md）就是这篇文章的网址，例如：
 *   src/content/posts/hello-world.md  ->  /posts/hello-world/
 *
 * schema 定义了每篇文章开头 frontmatter 里允许出现的字段，
 * 字段写错或类型不对，构建时会直接报错，这样就不会悄悄写坏。
 */

/** 博客文章 */
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    /** 写成 2026-09-14 或 "2026-09-14 20:30" 都可以 */
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    /** 封面图，填 public 下的路径，例如 /img/cover.png */
    cover: z.string().optional(),
    /** 草稿：true 时不会出现在列表和构建产物里 */
    draft: z.boolean().default(false),
    /** 置顶排序，数字越大越靠前 */
    pinned: z.number().default(0),
    /**
     * 所属子版块。填 src/data/home-boards.json 里各子版块的 id，
     * 例如 ['huaya-a']。填了之后这篇文章会出现在对应大板块页面的
     * 那个子版块下面。可以同时归到多个子版块。
     */
    subs: z.array(z.string()).default([]),
    /**
     * 认领这一天：true 时首页「涣源溪水钟」上这一天的格子会变成可点的
     * ——点一下直接进这篇文章；同一天有好几篇认领就进 /day/<日期>/ 那一页。
     * 编辑器里就是日期旁边那个勾选框（2026-10-06 加）。
     */
    calendar: z.boolean().default(false),
  }),
});

/** 手记 / 周记：比文章更短、更随意的记录 */
const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** 可选：所属周次，例如 2026-W37，用于按周归档 */
    week: z.string().optional(),
    /** 可选：当天心情或天气，纯粹显示用 */
    mood: z.string().optional(),
    tags: z.array(z.string()).default([]),
    /**
     * 封面图，和文章一样：填 public 下的路径，例如 /img/uploads/x.png。
     * 手记以前没有这个字段，所以列表里永远看不到图。
     */
    cover: z.string().optional(),
    draft: z.boolean().default(false),
    /** 同 posts.subs：所属子版块 */
    subs: z.array(z.string()).default([]),
    /** 同 posts.calendar：认领这一天（首页日历上那一天可点） */
    calendar: z.boolean().default(false),
  }),
});

/**
 * 黎语堂（/liyutang）的帖子。
 *
 * 和文章 / 手记的区别：**一个文件 = 一个帖子**，而它属于哪个版块由**文件所在的目录**决定：
 *   src/content/liyutang/notice/welcome.md  ->  /liyutang/notice/welcome/
 *                                            （版块 notice，见 src/data/liyutang.json 的 boards）
 * 所以 frontmatter 里**不用**再写一遍版块 —— 那会是第二份真相。
 *
 * 群友的「回帖」不在这里：那是 Twikoo 的评论，存在腾讯云开发的数据库里。
 * 这份 Markdown 只放站长 / 共创者写的帖子正文（静态站没法让访客生成新页面）。
 */
const liyutang = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/liyutang' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** 发帖人（显示在帖子标题下面；不写就是站长） */
    author: z.string().optional(),
    /** 置顶排序，数字越大越靠前 */
    pinned: z.number().default(0),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts, notes, liyutang };

