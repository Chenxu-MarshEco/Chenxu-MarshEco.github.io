/**
 * `/feed/` 那一条时间轴 —— 2026-11-21 加。
 *
 * 站长原话：
 *   「为推流动态的详情页面也加上精华 圣经一样的时间轴 可根据时间轴查动态 跳转
 *    时间轴跟着动态滚动 注意推流动态页用的是翻页模式 可能需要特殊适配」
 *
 * 为什么不在 `timelines.json` 里新加一条：那里面每一条都是**人写的历史**
 * （花娅年代记、纷鸟衔来的记录……），由编辑器维护、有它自己的名字和点。
 * 推流动态的"日子"是**从 git 提交里现算的**：今天推一条，轴就该长到今天，
 * 没有人在编辑器里维护它。所以这条轴在构建期按这次的提交清单现造一份，
 * 形状和 `Timeline` 一模一样，`Timeline.astro` 那边一行都不用改。
 *
 * 一天一个点（`kind: 'event'`，小塔吊）：点一下 = 跳到那一天最近的那条推流。
 * 名字就写 `MM-DD`（是日期本身，不是描述）。
 */
import { dayOf, paramOf, type Timeline, type TimelinePoint } from './timelines';

export interface FeedTimeline {
  /** 现造的那条轴 */
  timeline: Timeline;
  /** 和传进来的条目**一一对应**的位置（0~1），页面里写成 `data-tl-param` */
  params: number[];
}

export function feedTimeline(entries: { day: string }[]): FeedTimeline {
  /* 有一天算一天；空日子的（理论上不会有）不参与 —— 免得 `dayOf` 给出 NaN */
  const days = [...new Set(entries.map((e) => String(e.day || '')).filter(Boolean))].sort();
  const points: TimelinePoint[] = days.map((d) => ({
    id: `feed-${d}`,
    side: 'left',
    kind: 'event',
    date: d,
    /* 轴上那个点的名字：就是这一天的日期（`MM-DD`），不加任何说明 */
    label: d.slice(5),
  }));

  const timeline: Timeline = {
    id: 'feed',
    title: '推流动态',
    leftName: '推流动态',
    rightName: '',
    /*
      一刻度一天：这条轴只跨几十天，默认的 19 天/格会只剩两三个刻度，
      "按日子查动态"就成了空话。天数太少时（只有几天）不强塞，交给组件自己算。
    */
    tickDays: days.length >= 3 ? 1 : undefined,
    points,
    spans: [],
  };

  return { timeline, params: entries.map((e) => paramOf(timeline, dayOf(e.day))) };
}
