/*
 * ============================================================================
 * 地图标注的存盘接口（2026-11-02）
 * ----------------------------------------------------------------------------
 * 编辑器「地图」面板画完路/地点要写回 src/data/maps.json。这条验收钉三件事：
 *   ① **图的锚点绝不给编辑器改** —— 只换 roads / places，origin / 比例 / 图一个字节不动
 *      （用户最怕的就是"锚点被改坏、所有标注集体偏位"）
 *   ② 脏数据进不来：坐标不是数字 / 颜色不是 #rrggbb / 只有一个点的"路" / 没名字的地点
 *      全被丢掉
 *   ③ 起点/终点/颜色/线宽/虚线这些该留的都留下，重存一次不变形
 *
 * 跑法：node tools/checks/maps-api-check.mjs
 * （会在一份副本里起编辑器服务，不碰真仓库的数据）
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'maps-api-copy');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------------------------------------------------------------- 副本 */
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore', windowsHide: true }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore', windowsHide: true });

const file = path.join(DST, 'src/data/maps.json');
const before = JSON.parse(fs.readFileSync(file, 'utf8'));
const target = before.maps.find((m) => m.id === 'huaya-superflat');
check('副本里读到了目标地图', Boolean(target), target?.id);

/* 记下"绝不该变"的那几样 */
const frozen = {
  src: target.src,
  width: target.width,
  height: target.height,
  originX: target.originX,
  originZ: target.originZ,
  blocksPerPixel: target.blocksPerPixel,
  name: target.name,
};

/* ---------------------------------------------------------------- 起服务 */
const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 400 && !base; i += 1) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
check('副本里的编辑器起得来', Boolean(base), base || elog.slice(-200));

try {
  if (!base) throw new Error('没有服务地址');

  /* ---- ① GET 带完整标注 ---- */
  console.log('\n================ ① 读 ================');
  const get1 = await (await fetch(`${base}/api/maps`)).json();
  const one = (get1.maps ?? []).find((m) => m.id === 'huaya-superflat');
  check('GET /api/maps 回得来、带原点/比例', Boolean(one) && one.originX === frozen.originX && one.blocksPerPixel === frozen.blocksPerPixel,
    JSON.stringify({ originX: one?.originX, bpp: one?.blocksPerPixel }));
  check('GET 里带着完整的 roads / places（编辑器要能直接画）',
    Array.isArray(one?.roads) && Array.isArray(one?.places), `roads=${one?.roads?.length} places=${one?.places?.length}`);

  /* ---- ② 存：好数据要原样留下 ---- */
  console.log('\n================ ② 存好数据 ================');
  const good = {
    id: 'huaya-superflat',
    roads: [
      { id: 'r1', name: '主路', color: '#ff5fb0', width: 5, points: [[-2560, -2560], [0, 0], [128, 256]] },
      { id: 'r2', color: '#7ee081', dashed: true, points: [[-100, -100], [100, 100]] },
    ],
    places: [
      { id: 'p1', name: '出生点', wx: 0, wz: 0, color: '#ffd166', icon: '🏠', note: '样例' },
      { id: 'p2', name: '北门', wx: 0, wz: -256 },
    ],
  };
  const r1 = await (await fetch(`${base}/api/maps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good),
  })).json();
  check('★ POST 成功，回的是条数', r1.ok === true && r1.map?.roads === 2 && r1.map?.places === 2, JSON.stringify(r1.map));

  const after = JSON.parse(fs.readFileSync(file, 'utf8')).maps.find((m) => m.id === 'huaya-superflat');
  check('★ 锚点 / 图 / 尺寸 一个字节都没变（编辑器改不了它们）',
    after.src === frozen.src && after.width === frozen.width && after.height === frozen.height
    && after.originX === frozen.originX && after.originZ === frozen.originZ
    && after.blocksPerPixel === frozen.blocksPerPixel,
    JSON.stringify({ src: after.src, originX: after.originX, bpp: after.blocksPerPixel }));
  check('名字 / 维度这些也原样', after.name === frozen.name && after.dimension === target.dimension);

  const road = after.roads.find((r) => r.id === 'r1');
  check('★ 路：名字 / 颜色 / 线宽 / 折线三个点都在',
    road?.name === '主路' && road?.color === '#ff5fb0' && road?.width === 5
    && road.points.length === 3 && road.points[0][0] === -2560 && road.points[2][1] === 256,
    JSON.stringify(road));
  check('路的虚线标记也留下了', after.roads.find((r) => r.id === 'r2')?.dashed === true);
  const place = after.places.find((p) => p.id === 'p1');
  check('★ 地点：名字 / 坐标 / 颜色 / 图标 / 备注都在',
    place?.name === '出生点' && place.wx === 0 && place.wz === 0
    && place.color === '#ffd166' && place.icon === '🏠' && place.note === '样例',
    JSON.stringify(place));

  /* 别的地图不能被动 */
  const other = JSON.parse(fs.readFileSync(file, 'utf8')).maps.find((m) => m.id === 'huaya-overworld');
  const otherBefore = before.maps.find((m) => m.id === 'huaya-overworld');
  check('别的图（主世界）完全没被碰', JSON.stringify(other.places) === JSON.stringify(otherBefore.places)
    && other.originX === otherBefore.originX);

  /* ---- ③ 脏数据要挡住 ---- */
  console.log('\n================ ③ 脏数据 ================');
  const dirty = {
    id: 'huaya-superflat',
    roads: [
      { id: 'bad1', points: [[0, 0]] },                                  // 只有一个点 → 丢
      { id: 'bad2', points: [['a', 0], [1, 2]] },                         // 坐标不是数字 → 剩下的点不足 2 个 → 丢
      { id: 'ok1', color: '#zzzzzz', width: 999, points: [[0, 0], [10, 10]] }, // 颜色/线宽非法 → 那两个字段丢，路留着
    ],
    places: [
      { id: 'badp', name: '', wx: 0, wz: 0 },                             // 没名字 → 丢
      { id: 'badp2', name: 'NaN', wx: 'x', wz: 0 },                       // 坐标不是数字 → 丢
      { id: 'okp', name: '好的', wx: 12.345678, wz: -7, icon: '📍' },
    ],
  };
  const r2 = await (await fetch(`${base}/api/maps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dirty),
  })).json();
  check('★ 脏数据被挡住：只剩 1 条路 / 1 个地点', r2.map?.roads === 1 && r2.map?.places === 1, JSON.stringify(r2.map));
  const after2 = JSON.parse(fs.readFileSync(file, 'utf8')).maps.find((m) => m.id === 'huaya-superflat');
  check('非法颜色 / 线宽被丢掉，路本身留着',
    after2.roads[0].id === 'ok1' && !('color' in after2.roads[0]) && !('width' in after2.roads[0]),
    JSON.stringify(after2.roads[0]));
  check('★ 坐标保留三位小数（12.345678 → 12.346）', after2.places[0].wx === 12.346, String(after2.places[0].wx));

  /* ---- ④ 没地图 / 没 id 要报错，不能把文件写坏 ---- */
  console.log('\n================ ④ 边界 ================');
  const r3 = await fetch(`${base}/api/maps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roads: [], places: [] }) });
  check('没给 id → 400', r3.status === 400, String(r3.status));
  const r4 = await fetch(`${base}/api/maps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '不存在的图', roads: [], places: [] }) });
  check('不存在的图 → 404', r4.status === 404, String(r4.status));
  const stillOk = (() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).maps.length >= 2; } catch { return false; }
  })();
  check('★ 报错之后 maps.json 还是好的（没被写坏）', stillOk);
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  try { editor.kill(); } catch { /* 忽略 */ }
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
