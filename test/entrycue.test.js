'use strict';

/**
 * 入场口令（entryCues）引擎用例：
 *  - 圆心进入矩形严格内部的全部进入时刻（起点在内按 0s、贴边/角点相切不计、
 *    同一次停留只计一次、退化矩形不可进入、分段直线解析不采样）
 *  - normalizeEntryCues 规整
 *  - evaluateEntryCues：按口令顺序在时窗内严格递增贪心触发；
 *    错过时窗 / 前序未完成状态传播
 *  - analyzeEntryCues 全场景分组与内置样例
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

const T = 12;
const RECT = { x: 40, y: 40, width: 20, height: 20 }; // [40,60]×[40,60]

function approx(actual, expected, tol = 1e-6, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label || '值'} 期望 ${expected}，实际 ${actual}`
  );
}

function mover(keys, radius) {
  return { id: 'a', name: '甲', radius: radius || 0, keys: keys };
}

// ---------- rectCenterEntryTimes ----------

test('入场时刻：零半径水平横穿，进入时刻为左边界交点（与半径无关）', () => {
  const p = mover([{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }]);
  // 即便带大安全半径，核对只看圆心 -> 时刻仍为 t=4
  const pBig = mover([{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }], 99);
  const ts = core.rectCenterEntryTimes(p.keys, 10, RECT);
  const tsBig = core.rectCenterEntryTimes(pBig.keys, 10, RECT);
  assert.deepEqual(ts, [4]);
  assert.deepEqual(tsBig, [4], '安全半径不影响入场核对');
});

test('入场时刻：起点已在矩形严格内部按 t=0 进入', () => {
  const p = mover([{ t: 0, x: 50, y: 50 }, { t: 10, x: 150, y: 50 }]);
  assert.deepEqual(core.rectCenterEntryTimes(p.keys, 10, RECT), [0]);

  // 全程停在内部：只有 t=0 一次
  const stay = mover([{ t: 0, x: 50, y: 50 }]);
  assert.deepEqual(core.rectCenterEntryTimes(stay.keys, T, RECT), [0]);
});

test('入场时刻：起点恰在边界上不算 0 秒进入，真正跨入后再计', () => {
  // t=0 圆心在左边界 (40,50)，随后向右进入内部：进入时刻是穿越之后，
  // 但子段 [0, ...] 的左端点为 0（边界点本身不计停留起点，跨过即入），
  // 按“从矩形外（含边界）进入内部”的左端点语义记 t=0。
  const p = mover([{ t: 0, x: 40, y: 50 }, { t: 10, x: 100, y: 50 }]);
  const ts = core.rectCenterEntryTimes(p.keys, 10, RECT);
  approx(ts[0], 0, 1e-9);
  assert.equal(ts.length, 1);

  // 起点在边界但向外走：不进入
  const out = mover([{ t: 0, x: 40, y: 50 }, { t: 10, x: 0, y: 50 }]);
  assert.deepEqual(core.rectCenterEntryTimes(out.keys, 10, RECT), []);

  // 起点在边界且沿边界滑行：贴边未进入，不计
  const slide = mover([{ t: 0, x: 40, y: 40 }, { t: 10, x: 100, y: 40 }]);
  assert.deepEqual(core.rectCenterEntryTimes(slide.keys, 10, RECT), []);
});

test('入场时刻：沿边运动（贴边）不计', () => {
  // 沿 y=40（顶边）、y=60（底边）、x=40（左边）、x=60（右边）滑行均不进入
  const paths = [
    [{ t: 0, x: 0, y: 40 }, { t: 10, x: 100, y: 40 }],
    [{ t: 0, x: 0, y: 60 }, { t: 10, x: 100, y: 60 }],
    [{ t: 0, x: 40, y: 0 }, { t: 10, x: 40, y: 100 }],
    [{ t: 0, x: 60, y: 0 }, { t: 10, x: 60, y: 100 }]
  ];
  paths.forEach((keys, i) => {
    assert.deepEqual(core.rectCenterEntryTimes(keys, 10, RECT), [], `路径 ${i} 贴边不计`);
  });
});

test('入场时刻：仅切到角点（V 形反弹）未进入内部，不计', () => {
  // (0,0)->(40,40)->(0,80)：只经过角点 (40,40)，不开矩形
  const keys = [{ t: 0, x: 0, y: 0 }, { t: 4, x: 40, y: 40 }, { t: 8, x: 0, y: 80 }];
  assert.deepEqual(core.rectCenterEntryTimes(keys, 8, RECT), []);
});

test('入场时刻：斜穿角区进入矩形给出一次进入', () => {
  // (0,0)->(100,100)：t=4 入 (40,40)，t=6 出 (60,60)
  const keys = [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 100 }];
  assert.deepEqual(core.rectCenterEntryTimes(keys, 10, RECT), [4]);
});

test('入场时刻：多次进出给出全部进入时刻（每次停留一次）', () => {
  // 0->4 x:0->100（入 t=4? x=40 时 t=1.6），4->8 返回（再次入 x=60 时 t=5.6）
  const keys = [{ t: 0, x: 0, y: 50 }, { t: 4, x: 100, y: 50 }, { t: 8, x: 0, y: 50 }];
  const ts = core.rectCenterEntryTimes(keys, 8, RECT);
  assert.equal(ts.length, 2);
  approx(ts[0], 1.6, 1e-9);
  approx(ts[1], 5.6, 1e-9);
});

test('入场时刻：进入后静止（同一次停留）只计一次', () => {
  const keys = [{ t: 0, x: 0, y: 50 }, { t: 4, x: 50, y: 50 }, { t: 8, x: 50, y: 50 }];
  assert.deepEqual(core.rectCenterEntryTimes(keys, 8, RECT), [3.2]);
});

test('入场时刻：跨关键帧连续停留合并，不重复计数', () => {
  const one = [{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }];
  const split = [
    { t: 0, x: 0, y: 50 },
    { t: 5, x: 50, y: 50 },
    { t: 10, x: 100, y: 50 }
  ];
  assert.deepEqual(core.rectCenterEntryTimes(split, 10, RECT),
    core.rectCenterEntryTimes(one, 10, RECT));
});

test('入场时刻：零宽/零高退化矩形不可进入', () => {
  const keys = [{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }];
  assert.deepEqual(core.rectCenterEntryTimes(keys, 10, { x: 40, y: 40, width: 0, height: 20 }), []);
  assert.deepEqual(core.rectCenterEntryTimes(keys, 10, { x: 40, y: 40, width: 20, height: 0 }), []);
});

test('入场时刻：轨迹不经过矩形返回空', () => {
  const keys = [{ t: 0, x: 0, y: 200 }, { t: 10, x: 100, y: 200 }];
  assert.deepEqual(core.rectCenterEntryTimes(keys, 10, RECT), []);
});

// ---------- normalizeEntryCues ----------

test('normalizeEntryCues：缺省 id/name/时窗、时窗钳制与倒置交换、非法项过滤', () => {
  const out = core.normalizeEntryCues([
    { performerId: 'a', x: 1, y: 2, width: 30, height: 40 },              // from/to 缺省
    { performerId: 'b', x: 0, y: 0, width: 10, height: 10, from: 9, to: 3 }, // 倒置交换
    { performerId: 'c', x: 0, y: 0, width: -5, height: 10 },              // 负宽丢弃
    { x: 0, y: 0, width: 1, height: 1 },                                  // 无 performerId 丢弃
    { performerId: 'd', x: 'x', y: 0, width: 1, height: 1 },             // 非数字丢弃
    null
  ], T);
  assert.equal(out.length, 2);
  assert.ok(out[0].id);
  assert.equal(out[0].name, '入口 1');
  assert.equal(out[0].from, 0);
  assert.equal(out[0].to, T);
  assert.equal(out[1].from, 3, '倒置时窗自动交换');
  assert.equal(out[1].to, 9);
});

test('normalizeEntryCues：空输入与非法 duration 安全', () => {
  assert.deepEqual(core.normalizeEntryCues(null, T), []);
  assert.throws(() => core.normalizeEntryCues([], 0), /duration/);
});

// ---------- evaluateEntryCues ----------

test('口令顺序：各项取时窗内严格递增的最早进入，错过项之后全部前序未完成', () => {
  // 甲匀速横穿：t=4 进入唯一入口
  const p = mover([{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }]);
  const cues = core.normalizeEntryCues([
    { id: 'c1', performerId: 'a', name: '第一项', x: 40, y: 40, width: 20, height: 20, from: 0, to: 5 },
    { id: 'c2', performerId: 'a', name: '第二项', x: 40, y: 40, width: 20, height: 20, from: 0, to: 5 },
    { id: 'c3', performerId: 'a', name: '第三项', x: 40, y: 40, width: 20, height: 20, from: 0, to: 5 },
    { id: 'c4', performerId: 'a', name: '第四项', x: 40, y: 40, width: 20, height: 20, from: 0, to: 5 }
  ], 10);
  const rs = core.evaluateEntryCues(p, cues, 10);
  assert.equal(rs[0].status, 'triggered');
  approx(rs[0].triggerTime, 4, 1e-9);
  // 同一次停留不能重复触发：第二项窗内进入不严格晚于 4 -> 错过（order）
  assert.equal(rs[1].status, 'missed');
  assert.equal(rs[1].reason, 'order');
  // 后续全部前序未完成
  assert.equal(rs[2].status, 'blocked');
  assert.equal(rs[2].reason, 'prev');
  assert.equal(rs[3].status, 'blocked');
});

test('时窗：窗端点包含（容差），窗外进入按 early/late 错过', () => {
  const p = mover([{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }]);
  const base = { performerId: 'a', x: 40, y: 40, width: 20, height: 20 };
  function cue(from, to) {
    return core.normalizeEntryCues([Object.assign({ id: 'c', from: from, to: to }, base)], 10)[0];
  }
  approx(core.evaluateEntryCues(p, [cue(4, 6)], 10)[0].triggerTime, 4, 1e-9, '左端点包含');
  // 时窗起点严格晚于进入 -> early
  assert.equal(core.evaluateEntryCues(p, [cue(5, 7)], 10)[0].status, 'missed');
  assert.equal(core.evaluateEntryCues(p, [cue(5, 7)], 10)[0].reason, 'early');
  // 入口放在 x=80（进入 t=8），时窗 [1,7] -> late
  const lateCue = core.normalizeEntryCues(
    [Object.assign({ id: 'c', from: 1, to: 7 }, base, { x: 80 })], 10)[0];
  const lr = core.evaluateEntryCues(p, [lateCue], 10)[0];
  assert.equal(lr.status, 'missed');
  assert.equal(lr.reason, 'late');
});

test('时窗：多段进入（多次停留）各自可被相邻口令消费，严格递增', () => {
  // 往返两次进入：t=1.6 与 t=5.6
  const p = mover([{ t: 0, x: 0, y: 50 }, { t: 4, x: 100, y: 50 }, { t: 8, x: 0, y: 50 }]);
  const mk = function (id, from, to) {
    return { id: id, performerId: 'a', name: id, x: 40, y: 40, width: 20, height: 20, from: from, to: to };
  };
  const rs = core.evaluateEntryCues(p, core.normalizeEntryCues([
    mk('c1', 0, 3),   // 取 1.6
    mk('c2', 0, 8),   // 取 5.6（严格晚于 1.6）
    mk('c3', 0, 8)    // 无更多停留 -> order 错过
  ], 8), 8);
  assert.equal(rs[0].status, 'triggered');
  approx(rs[0].triggerTime, 1.6, 1e-6);
  assert.equal(rs[1].status, 'triggered');
  approx(rs[1].triggerTime, 5.6, 1e-6);
  assert.equal(rs[2].status, 'missed');
  assert.equal(rs[2].reason, 'order');
});

test('never：圆心全程未进入矩形 -> missed/never，entries 为空', () => {
  const p = mover([{ t: 0, x: 0, y: 200 }, { t: 10, x: 100, y: 200 }]);
  const cues = core.normalizeEntryCues(
    [{ id: 'c', performerId: 'a', x: 40, y: 40, width: 20, height: 20, from: 0, to: 10 }], 10);
  const rs = core.evaluateEntryCues(p, cues, 10);
  assert.equal(rs[0].status, 'missed');
  assert.equal(rs[0].reason, 'never');
  assert.deepEqual(rs[0].entries, []);
});

test('起点在矩形内：第一项按 t=0 触发（时窗含 0）', () => {
  const p = mover([{ t: 0, x: 50, y: 50 }, { t: 10, x: 150, y: 50 }]);
  const cues = core.normalizeEntryCues([
    { id: 'c1', performerId: 'a', x: 40, y: 40, width: 20, height: 20, from: 0, to: 2 },
    { id: 'c2', performerId: 'a', x: 120, y: 40, width: 20, height: 20, from: 0, to: 10 }
  ], 10);
  const rs = core.evaluateEntryCues(p, cues, 10);
  assert.equal(rs[0].status, 'triggered');
  approx(rs[0].triggerTime, 0, 1e-9);
  // 离开后进入第二个入口：x=120 时 t=7，严格晚于 0 -> 触发
  assert.equal(rs[1].status, 'triggered');
  approx(rs[1].triggerTime, 7, 1e-9);
});

test('表演者不存在：口令标记 missed/missing', () => {
  const cues = core.normalizeEntryCues(
    [{ id: 'c', performerId: 'ghost', x: 0, y: 0, width: 10, height: 10 }], T);
  const rs = core.evaluateEntryCues(null, cues, T);
  assert.equal(rs[0].status, 'missed');
  assert.equal(rs[0].reason, 'missing');
});

test('时窗外的进入时刻仍在 entries 中返回（供前端展示/跳转）', () => {
  const p = mover([{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }]);
  const cues = core.normalizeEntryCues(
    [{ id: 'c', performerId: 'a', x: 40, y: 40, width: 20, height: 20, from: 8, to: 9 }], 10);
  const r = core.evaluateEntryCues(p, cues, 10)[0];
  assert.equal(r.status, 'missed');
  assert.deepEqual(r.entries, [4]);
});

// ---------- analyzeEntryCues ----------

test('analyzeEntryCues：按表演者分组、结果与规整后口令对齐、不表演者互不影响', () => {
  const scene = {
    duration: 10,
    performers: [
      { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 50 }, { t: 10, x: 100, y: 50 }] },
      { id: 'b', radius: 0, keys: [{ t: 0, x: 0, y: 200 }, { t: 10, x: 100, y: 200 }] }
    ],
    entryCues: [
      { id: 'a1', performerId: 'a', x: 40, y: 40, width: 20, height: 20, from: 0, to: 10 },
      { id: 'b1', performerId: 'b', x: 40, y: 40, width: 20, height: 20, from: 0, to: 10 }
    ]
  };
  const r = core.analyzeEntryCues(scene);
  assert.equal(r.cues.length, 2);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].cue.id, 'a1');
  assert.equal(r.results[0].status, 'triggered');
  approx(r.results[0].triggerTime, 4, 1e-9);
  assert.equal(r.results[1].status, 'missed');
  assert.equal(r.results[1].reason, 'never');
});

test('analyzeEntryCues：内置样例 5 项口令：触发/触发/错过(early)/前序未完成/起点 0s', () => {
  const s = core.builtinScene();
  const r = core.analyzeEntryCues(s);
  const byId = {};
  r.results.forEach((e) => { byId[e.cue.id] = e; });
  approx(byId.e1.triggerTime, 0.505, 1e-3, '甲左侧口');
  assert.equal(byId.e1.status, 'triggered');
  approx(byId.e2.triggerTime, 2.455, 1e-3, '甲二道口');
  assert.equal(byId.e3.status, 'missed');
  assert.equal(byId.e3.reason, 'early');
  assert.equal(byId.e4.status, 'blocked');
  assert.equal(byId.e4.reason, 'prev');
  assert.equal(byId.e5.status, 'triggered');
  approx(byId.e5.triggerTime, 0, 1e-9, '乙起点已在入口内按 0s');
});

test('analyzeEntryCues：无口令旧场景兼容', () => {
  const r = core.analyzeEntryCues({ duration: T, performers: core.builtinScene().performers });
  assert.deepEqual(r.cues, []);
  assert.deepEqual(r.results, []);
});
