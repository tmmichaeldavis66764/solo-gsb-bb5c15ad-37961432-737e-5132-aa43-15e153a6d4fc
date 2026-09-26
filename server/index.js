'use strict';

const path = require('path');
const express = require('express');
const core = require('../public/core.js');

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: 0
}));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/** 内置交叉样例（含关键帧安全半径），前端启动时加载 */
app.get('/api/sample', (_req, res) => {
  res.json(core.builtinScene());
});

/**
 * 把入参场景规整为 API 出参形式：每个关键帧都带显式半径 r
 * （缺省继承的帧解析为表演者当前 radius），禁入矩形经坐标/尺寸规整，
 * 便于集成方直接消费。
 */
function resolveScene(duration, performers, obstacles, entryCues) {
  return {
    duration: duration,
    obstacles: core.normalizeObstacles(obstacles),
    entryCues: core.normalizeEntryCues(entryCues, duration),
    performers: performers.map((p) => {
      const base = Math.max(0, Number(p.radius) || 0);
      const ks = core.normalizeKeys(p.keys, base);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        radius: base,
        keys: ks.map((k) => ({
          t: k.t,
          x: k.x,
          y: k.y,
          r: k.r === null ? base : k.r
        }))
      };
    })
  };
}

/**
 * 场景碰撞分析（与前端同一份解析引擎，便于集成/校验）。
 * body: {
 *   duration,
 *   performers:[{name?,radius,keys:[{t,x,y,r?}]}],
 *   obstacles?:[{id?,name?,x,y,width,height}]   // 舞台禁入矩形（可空/缺省）
 *   entryCues?:[{id?,name?,performerId,x,y,width,height,from?,to?}]
 * }
 * 关键帧 r 为可选安全半径（开伞/展开道具），缺省继承表演者 radius。
 * 每对返回精确碰撞区间与最小安全余量 minMargin/minMarginT
 * （distance(t)-(rA+rB) 的连续全局最小值及发生时刻），pairs 按余量升序；
 * obstacleConflicts 为每位表演者 × 每个禁入矩形的精确侵入区间，按首次
 * 进入时刻升序；entryCueResults 为按口令顺序核对的入场口令结果
 * （触发/错过时窗/前序未完成）；场景级另附 minMargin/minMarginT/minMarginPair 与
 * firstObstacleEntry/firstObstacleConflict。旧请求（无 obstacles/entryCues）
 * 完全兼容。
 */
app.post('/api/analyze', (req, res) => {
  try {
    const scene = req.body || {};
    const duration = Number(scene.duration);
    const performers = Array.isArray(scene.performers) ? scene.performers : [];
    const rawObstacles = scene.obstacles;
    const rawEntryCues = scene.entryCues;

    if (!(duration > 0) || !isFinite(duration)) {
      return res.status(400).json({ error: 'duration 必须为正数（秒）' });
    }
    if (performers.length < 2 || performers.length > 8) {
      return res.status(400).json({ error: '表演者人数需为 2～8 人' });
    }
    if (rawObstacles !== undefined && rawObstacles !== null && !Array.isArray(rawObstacles)) {
      return res.status(400).json({ error: 'obstacles 必须为数组' });
    }
    if (rawEntryCues !== undefined && rawEntryCues !== null && !Array.isArray(rawEntryCues)) {
      return res.status(400).json({ error: 'entryCues 必须为数组' });
    }

    performers.forEach((p, idx) => {
      if (!Array.isArray(p.keys) || p.keys.length === 0) {
        throw new Error(`第 ${idx + 1} 人至少需要 1 个走位点`);
      }
      if (!(Number(p.radius) >= 0) || !isFinite(Number(p.radius))) {
        throw new Error(`第 ${idx + 1} 人身体半径需为非负数`);
      }
      p.keys.forEach((k, ki) => {
        ['t', 'x', 'y'].forEach((f) => {
          if (!isFinite(Number(k[f]))) {
            throw new Error(`第 ${idx + 1} 人存在非法走位点（${f} 非数字）`);
          }
        });
        if (Number(k.t) < 0 || Number(k.t) > duration) {
          throw new Error(`第 ${idx + 1} 人存在超出 [0, ${duration}] 的时刻`);
        }
        if (k.r !== undefined && k.r !== null && k.r !== '') {
          if (!isFinite(Number(k.r)) || Number(k.r) < 0) {
            throw new Error(`第 ${idx + 1} 人第 ${ki + 1} 个关键帧安全半径需为非负数`);
          }
        }
      });
    });

    // 禁入矩形入参校验（缺省/空数组直接跳过，保持旧请求兼容）
    (rawObstacles || []).forEach((o, idx) => {
      if (!o || typeof o !== 'object') {
        throw new Error(`第 ${idx + 1} 个禁入矩形格式非法`);
      }
      ['x', 'y', 'width', 'height'].forEach((f) => {
        if (!isFinite(Number(o[f]))) {
          throw new Error(`第 ${idx + 1} 个禁入矩形的 ${f} 必须为有限数`);
        }
      });
      if (Number(o.width) < 0 || Number(o.height) < 0) {
        throw new Error(`第 ${idx + 1} 个禁入矩形的 width/height 不能为负`);
      }
    });

    // 入场口令入参校验（缺省/空数组直接跳过，保持旧请求兼容）
    const performerIds = new Set(performers.map((p) => String(p.id)));
    (rawEntryCues || []).forEach((cu, idx) => {
      if (!cu || typeof cu !== 'object') {
        throw new Error(`第 ${idx + 1} 个入场口令格式非法`);
      }
      if (cu.performerId === undefined || cu.performerId === null || cu.performerId === '') {
        throw new Error(`第 ${idx + 1} 个入场口令缺少 performerId`);
      }
      if (!performerIds.has(String(cu.performerId))) {
        throw new Error(`第 ${idx + 1} 个入场口令的 performerId 不存在`);
      }
      ['x', 'y', 'width', 'height'].forEach((f) => {
        if (!isFinite(Number(cu[f]))) {
          throw new Error(`第 ${idx + 1} 个入场口令的 ${f} 必须为有限数`);
        }
      });
      if (Number(cu.width) < 0 || Number(cu.height) < 0) {
        throw new Error(`第 ${idx + 1} 个入场口令的 width/height 不能为负`);
      }
      ['from', 'to'].forEach((f) => {
        if (cu[f] !== undefined && cu[f] !== null && cu[f] !== '' &&
            (!isFinite(Number(cu[f])) || Number(cu[f]) < 0 || Number(cu[f]) > duration)) {
          throw new Error(`第 ${idx + 1} 个入场口令的 ${f} 需在 [0, ${duration}] 内`);
        }
      });
    });

    const obstacles = core.normalizeObstacles(rawObstacles);
    const entryCues = core.normalizeEntryCues(rawEntryCues || [], duration);
    const result = core.analyzeScene({ duration, performers, obstacles });
    // 口令已在上方规整（补全 id/name/时窗），直接对规整结果分组核对
    const entryCueAnalysis = core.analyzeEntryCues({
      duration,
      performers,
      entryCues: entryCues
    });
    res.json(Object.assign(
      { scene: resolveScene(duration, performers, obstacles, entryCues) },
      result,
      {
        entryCues: entryCues,
        entryCueResults: entryCueAnalysis.results
      }
    ));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 兜底返回首页（仅根路径；其余静态资源缺失正常 404）
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`走位轨迹碰撞排练台已启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
