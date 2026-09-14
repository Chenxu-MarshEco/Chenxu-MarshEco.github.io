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
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts, notes };
