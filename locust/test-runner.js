/**
 * SyncCanvas 端到端延迟压测脚本
 *
 * 使用方式: node locust/test-runner.js
 *
 * 测试场景:
 * 1. 单连接延迟基准：单用户单连接，测量 P50/P95/P99
 * 2. 200 用户并发：同时打开 200 个 WebSocket 连接，测量端到端延迟
 * 3. 基础设施探测：HTTP、WebSocket、MongoDB 健康检查与延迟
 *
 * 依赖: npm install ws (已在 package.json 中)
 */

'use strict';

const WebSocket = require('ws');
const http = require('http');

// ============================================================================
// 配置
// ============================================================================

const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '200', 10);
const STROKES_PER_USER = parseInt(process.env.STROKES_PER_USER || '50', 10);
const POINTS_PER_STROKE = parseInt(process.env.POINTS_PER_STROKE || '5', 10);

// ============================================================================
// 工具函数
// ============================================================================

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms) {
  if (ms === undefined || ms === null || isNaN(ms)) return 'N/A';
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function generatePoints(count = 5) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    x: randomBetween(100, 1800),
    y: randomBetween(100, 1000),
    t: now + i * 10,
  }));
}

let _strokeCounter = 0;
function generateStrokeMessage() {
  const stroke_id = `stress-${Date.now()}-${String(++_strokeCounter).padStart(6, '0')}`;
  return {
    action: 'stroke',
    stroke_id,
    points: generatePoints(POINTS_PER_STROKE),
    color: ['#FF5733', '#33FF57', '#3357FF', '#FF33F5'][Math.floor(Math.random() * 4)],
    width: [1, 2, 3, 5, 8][Math.floor(Math.random() * 5)],
  };
}

// ============================================================================
// 延迟统计
// ============================================================================

class LatencyStats {
  constructor() {
    // stroke_id -> [BigInt sendTime, number index]  (index: 1-based send sequence)
    this.sendTimes = new Map();
    this.deliveryLatencies = []; // ms, for global stats
  }

  recordSend(strokeId) {
    this.sendTimes.set(strokeId, {
      time: process.hrtime.bigint(),
      seq: this.sendTimes.size + 1,
    });
  }

  recordDelivery(strokeId) {
    const entry = this.sendTimes.get(strokeId);
    if (entry !== undefined) {
      const latency = Number(process.hrtime.bigint() - entry.time) / 1e6;
      this.deliveryLatencies.push(latency);
      this.sendTimes.delete(strokeId);
      return latency;
    }
    return null;
  }

  getRaw() {
    return this.deliveryLatencies;
  }

  getReport() {
    if (this.deliveryLatencies.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
    }
    const arr = this.deliveryLatencies;
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      count: arr.length,
      min: Math.min(...arr),
      avg: sum / arr.length,
      p50: percentile(arr, 50),
      p95: percentile(arr, 95),
      p99: percentile(arr, 99),
      max: Math.max(...arr),
    };
  }
}

// ============================================================================
// 单用户连接压测
// ============================================================================

async function singleUserTest() {
  console.log('\n' + '='.repeat(70));
  console.log('  [场景 1] 单连接延迟基准测试');
  console.log(`  ${STROKES_PER_USER} 条消息, ${POINTS_PER_STROKE} 点/条`);
  console.log('='.repeat(70));

  const stats = new LatencyStats();
  let connected = false;
  let messageCount = 0;
  let serverUserId = null;

  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      connected = true;
      console.log('  WebSocket 已连接');
      sendNext();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') {
          serverUserId = msg.user_id;
          console.log(`  用户 ID: ${serverUserId}`);
        }
        // 服务端广播 stroke 时会包含 stroke_id（由服务端用 Redis INCR 重新编号）
        // 关键：用我们发送的 stroke_id 前缀匹配，因为服务端保留了 stroke_id 字段
        if (msg.stroke_id && typeof msg.stroke_id === 'string' && msg.stroke_id.startsWith('stress-')) {
          const lat = stats.recordDelivery(msg.stroke_id);
          if (lat !== null) {
            process.stdout.write(`\r  已收到广播: ${stats.deliveryLatencies.length}/${messageCount}  latest=${formatMs(lat)}    `);
          }
        }
      } catch (e) {}
    });

    ws.on('error', (err) => {
      console.error(`\n  WebSocket 错误: ${err.message}`);
    });

    ws.on('close', () => {
      if (!connected) return;
      connected = false;
      const report = stats.getReport();
      console.log(`\n`);
      console.log(`  发送消息: ${messageCount}`);
      console.log(`  收到广播: ${report.count} 条`);
      console.log(`  延迟 P50: ${formatMs(report.p50)}`);
      console.log(`  延迟 P95: ${formatMs(report.p95)}`);
      console.log(`  延迟 P99: ${formatMs(report.p99)}`);
      console.log(`  延迟平均: ${formatMs(report.avg)}`);
      console.log(`  延迟范围: ${formatMs(report.min)} ~ ${formatMs(report.max)}`);
      resolve({ stats, report, raw: stats.getRaw() });
    });

    function sendNext() {
      if (messageCount >= STROKES_PER_USER) {
        setTimeout(() => ws.close(), 3000); // 等待3秒以接收所有广播
        return;
      }
      const msg = generateStrokeMessage();
      stats.recordSend(msg.stroke_id);
      ws.send(JSON.stringify(msg));
      messageCount++;
      setTimeout(sendNext, 50); // 50ms 间隔模拟真实采集
    }

    setTimeout(() => {
      if (connected) {
        console.log('\n  超时，强制关闭');
        ws.close();
      }
      resolve({ stats, report: stats.getReport(), raw: stats.getRaw() });
    }, 30000);
  });
}

// ============================================================================
// 多用户并发压测
// ============================================================================

async function multiUserTest() {
  console.log('\n' + '='.repeat(70));
  console.log(`  [场景 2] ${CONCURRENCY} 用户并发压测`);
  console.log(`  每用户 ${STROKES_PER_USER} 条消息, ${POINTS_PER_STROKE} 点/条`);
  console.log('='.repeat(70));

  let totalSent = 0;
  let totalReceived = 0;
  const allLatencies = [];

  function createUser(userIndex) {
    return new Promise((resolve) => {
      const stats = new LatencyStats();
      let ws;
      let sentCount = 0;
      let resolved = false;
      const sendDelay = randomBetween(30, 80);

      const connect = () => {
        ws = new WebSocket(WS_URL);

        ws.on('open', () => {
          sendNext();
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.stroke_id && typeof msg.stroke_id === 'string' && msg.stroke_id.startsWith('stress-')) {
              const lat = stats.recordDelivery(msg.stroke_id);
              if (lat !== null) totalReceived++;
            }
          } catch (e) {}
        });

        ws.on('close', () => {
          if (!resolved) {
            resolved = true;
            allLatencies.push(...stats.getRaw());
            const r = stats.getReport();
            resolve({ count: r.count, raw: stats.getRaw() });
          }
        });

        ws.on('error', () => {
          if (!resolved) {
            resolved = true;
            resolve({ count: 0, raw: [] });
          }
        });
      };

      function sendNext() {
        if (sentCount >= STROKES_PER_USER) {
          setTimeout(() => ws.close(), 1000);
          return;
        }
        const msg = generateStrokeMessage();
        stats.recordSend(msg.stroke_id);
        ws.send(JSON.stringify(msg));
        sentCount++;
        totalSent++;
        setTimeout(sendNext, sendDelay);
      }

      connect();
    });
  }

  console.log(`  正在建立 ${CONCURRENCY} 个 WebSocket 连接...`);
  const startTime = process.hrtime.bigint();

  // 分批启动，每批20个，间隔100ms，避免瞬时洪泛
  const batchSize = 20;
  const batches = Math.ceil(CONCURRENCY / batchSize);
  const results = [];
  for (let b = 0; b < batches; b++) {
    const batchStart = b * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, CONCURRENCY);
    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(createUser(i));
    }
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    if (b < batches - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
    const done = batchEnd;
    process.stdout.write(`\r  进度: ${done}/${CONCURRENCY} 用户已建立连接...`);
  }

  const totalTime = Number(process.hrtime.bigint() - startTime) / 1e6;

  // 全局延迟统计
  const globalReport = (() => {
    if (allLatencies.length === 0) return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
    const arr = allLatencies;
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      count: arr.length,
      min: Math.min(...arr),
      avg: sum / arr.length,
      p50: percentile(arr, 50),
      p95: percentile(arr, 95),
      p99: percentile(arr, 99),
      max: Math.max(...arr),
    };
  })();

  console.log(`\n`);
  console.log('  ' + '-'.repeat(68));
  console.log(`  总发送消息:    ${totalSent}`);
  console.log(`  收到广播:      ${totalReceived} (${(totalReceived / totalSent * 100).toFixed(1)}%)`);
  console.log(`  总耗时:        ${totalTime.toFixed(0)} ms`);
  console.log(`  吞吐量:        ${(totalSent / totalTime * 1000).toFixed(1)} msg/s`);
  console.log('  ' + '-'.repeat(68));
  console.log(`  全局延迟 P50:  ${formatMs(globalReport.p50)}`);
  console.log(`  全局延迟 P95:  ${formatMs(globalReport.p95)}`);
  console.log(`  全局延迟 P99:  ${formatMs(globalReport.p99)}`);
  console.log(`  全局延迟平均:  ${formatMs(globalReport.avg)}`);
  console.log('  ' + '-'.repeat(68));

  return { totalSent, totalReceived, totalTime, allLatencies, globalReport };
}

// ============================================================================
// 基础设施探测
// ============================================================================

async function pingServices() {
  console.log('\n' + '='.repeat(70));
  console.log('  [场景 3] 基础设施健康检查');
  console.log('='.repeat(70));

  const checks = {};

  // HTTP - WebSocket server
  await new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(`${API_BASE}/api/v1/health`, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        checks.websocketServer = { latency: ms, status: res.statusCode };
        console.log(`  WebSocket 网关 (${API_BASE}/api/v1/health): ${ms.toFixed(2)}ms [${res.statusCode}]`);
        resolve();
      });
    });
    req.on('error', () => {
      checks.websocketServer = { latency: null, status: 'DOWN' };
      console.log('  WebSocket 网关: DOWN');
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      checks.websocketServer = { latency: null, status: 'TIMEOUT' };
      console.log('  WebSocket 网关: TIMEOUT');
      resolve();
    });
  });

  // HTTP - persistence-service (MongoDB)
  await new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get('http://localhost:3001/api/v1/health', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        checks.persistenceService = { latency: ms, status: res.statusCode };
        console.log(`  Persistence 服务 (MongoDB): ${ms.toFixed(2)}ms [${res.statusCode}]`);
        resolve();
      });
    });
    req.on('error', () => {
      checks.persistenceService = { latency: null, status: 'DOWN' };
      console.log('  Persistence 服务 (MongoDB): DOWN');
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      checks.persistenceService = { latency: null, status: 'TIMEOUT' };
      console.log('  Persistence 服务 (MongoDB): TIMEOUT');
      resolve();
    });
  });

  // HTTP - Kafka UI
  await new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get('http://localhost:8080', (res) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      checks.kafkaUI = { latency: ms, status: res.statusCode };
      console.log(`  Kafka UI: ${ms.toFixed(2)}ms [${res.statusCode}]`);
      resolve();
    });
    req.on('error', () => {
      checks.kafkaUI = { latency: null, status: 'DOWN' };
      console.log('  Kafka UI: DOWN');
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      checks.kafkaUI = { latency: null, status: 'TIMEOUT' };
      console.log('  Kafka UI: TIMEOUT');
      resolve();
    });
  });

  // HTTP - operations API
  await new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get('http://localhost:3001/api/v1/operations?from=0&limit=1', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const ops = res.statusCode === 200 ? JSON.parse(data) : null;
        checks.operationsAPI = { latency: ms, status: res.statusCode, ops };
        const msg = ops && ops.data ? `, count=${ops.data.count} 条历史操作` : '';
        console.log(`  Operations API: ${ms.toFixed(2)}ms [${res.statusCode}]${msg}`);
        resolve();
      });
    });
    req.on('error', () => {
      checks.operationsAPI = { latency: null, status: 'DOWN' };
      console.log('  Operations API: DOWN');
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      checks.operationsAPI = { latency: null, status: 'TIMEOUT' };
      console.log('  Operations API: TIMEOUT');
      resolve();
    });
  });

  // WebSocket RTT
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let done = false;

    ws.on('open', () => {
      const start = process.hrtime.bigint();
      ws.send(JSON.stringify({ type: 'rtt_test', t: Date.now() }));
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          console.log('  WebSocket RTT: TIMEOUT (服务端未回复 rtt_test)');
          ws.close();
          resolve();
        }
      }, 3000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'rtt_response' || msg.type) {
            if (!done) {
              done = true;
              clearTimeout(timer);
              const ms = Number(process.hrtime.bigint() - start) / 1e6;
              checks.wsRTT = { latency: ms };
              console.log(`  WebSocket RTT: ${ms.toFixed(2)}ms`);
              ws.close();
              resolve();
            }
          }
        } catch (e) {}
      });
    });

    ws.on('close', () => {
      if (!done) {
        done = true;
        console.log('  WebSocket RTT: CONNECTION CLOSED');
        resolve();
      }
    });
  });

  console.log('-'.repeat(70));
  return checks;
}

// ============================================================================
// 主入口
// ============================================================================

async function main() {
  console.log('\n' + '#'.repeat(70));
  console.log('  SyncCanvas 端到端延迟压测工具');
  console.log(`  WebSocket: ${WS_URL}`);
  console.log(`  HTTP API:  ${API_BASE}`);
  console.log(`  并发用户:  ${CONCURRENCY}`);
  console.log('#'.repeat(70));

  // 预热
  console.log('\n  [预热] 建立一次连接...');
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => ws.close());
    ws.on('close', resolve);
    setTimeout(resolve, 3000);
  });

  const overallStart = process.hrtime.bigint();

  // 场景 1: 单连接延迟基准
  const singleResult = await singleUserTest();

  // 场景 2: 多用户并发
  const multiResult = await multiUserTest();

  // 场景 3: 基础设施探测
  const healthChecks = await pingServices();

  const overallTime = Number(process.hrtime.bigint() - overallStart) / 1e6;

  // 汇总报告
  console.log('\n' + '='.repeat(70));
  console.log('  压测汇总报告');
  console.log('='.repeat(70));
  console.log(`\n  [单连接基准]`);
  console.log(`    发送/收到: ${STROKES_PER_USER}/${singleResult.report.count}`);
  console.log(`    P50: ${formatMs(singleResult.report.p50)}`);
  console.log(`    P95: ${formatMs(singleResult.report.p95)}`);
  console.log(`    P99: ${formatMs(singleResult.report.p99)}`);

  if (multiResult.totalSent > 0) {
    console.log(`\n  [200用户并发]`);
    console.log(`    发送/收到: ${multiResult.totalSent}/${multiResult.totalReceived}`);
    console.log(`    P50: ${formatMs(multiResult.globalReport.p50)}`);
    console.log(`    P95: ${formatMs(multiResult.globalReport.p95)}`);
    console.log(`    P99: ${formatMs(multiResult.globalReport.p99)}`);
    console.log(`    吞吐量: ${(multiResult.totalSent / multiResult.totalTime * 1000).toFixed(1)} msg/s`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('  验收标准参考:');
  console.log('  ─────────────────────────────────────────────────────────────────');
  const singleP99 = singleResult.report.p99 || 0;
  const singleP95 = singleResult.report.p95 || 0;
  const singleAvg = singleResult.report.avg || 0;
  const multiP99 = multiResult.globalReport.p99 || 0;
  const multiP95 = multiResult.globalReport.p95 || 0;
  const deliveryRate = multiResult.totalSent > 0
    ? (multiResult.totalReceived / multiResult.totalSent * 100).toFixed(1)
    : 'N/A';

  console.log(`  场景一：高频作画（200并发, ${multiResult.totalSent}条消息）`);
  console.log(`    送达率: ${deliveryRate}% ${parseFloat(deliveryRate) >= 95 ? '✓' : '✗'} (目标 ≥95%)`);
  console.log(`    P95延迟: ${formatMs(multiP95)} ${multiP95 <= 200 ? '✓' : '✗'} (目标 ≤200ms)`);
  console.log(`    P99延迟: ${formatMs(multiP99)} ${multiP99 <= 500 ? '✓' : '✗'} (目标 ≤500ms)`);

  console.log(`\n  场景二：冷启动（拉取历史）`);
  const opsCheck = healthChecks.operationsAPI;
  if (opsCheck && opsCheck.ops) {
    console.log(`    历史操作数: ${opsCheck.ops.data?.count || 0}`);
    console.log(`    查询延迟: ${formatMs(opsCheck.latency)} ${(opsCheck.latency || 0) <= 200 ? '✓' : '✗'} (目标 ≤200ms)`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`  总耗时: ${overallTime.toFixed(0)} ms`);
  console.log('='.repeat(70));

  process.exit(0);
}

main().catch((err) => {
  console.error('压测失败:', err);
  process.exit(1);
});
