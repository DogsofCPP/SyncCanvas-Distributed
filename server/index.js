/**
 * SyncCanvas WebSocket 网关 + Node.js 持久化服务。
 *
 * 启动方式: node server/index.js
 * 依赖: npm install ws kafkajs ioredis mongodb
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  initKafkaProducer,
  sendCanvasOperation,
  closeKafkaProducer,
} = require('./kafka-producer');
const {
  initKafkaConsumer,
  closeKafkaConsumer,
} = require('./kafka-consumer');
const {
  DEFAULT_CANVAS_ID,
  initMongo,
  findOperationsAfter,
  findLatestSnapshot,
  listCanvases,
  closeMongo,
} = require('./mongo-client');
const {
  getNextSequenceId,
  publish,
  subscribe,
  closeRedis,
  CHANNEL_CANVAS_OPERATIONS,
} = require('./redis-client');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3000;
const WS_PATH = '/ws';
const DEFAULT_HISTORY_LIMIT = 1000;
const MAX_HISTORY_LIMIT = 5000;

/**
 * 返回统一 JSON 响应。
 *
 * @param {import('http').ServerResponse} res HTTP 响应对象
 * @param {object|string|null} data 响应数据
 * @param {number} statusCode HTTP 状态码
 */
function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    code: 0,
    message: 'ok',
    data,
  }));
}

/**
 * 返回错误 JSON 响应。
 *
 * @param {import('http').ServerResponse} res HTTP 响应对象
 * @param {string} message 错误消息
 * @param {number} statusCode HTTP 状态码
 */
function sendError(res, message, statusCode = 500) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    code: -1,
    message,
    data: null,
  }));
}

/**
 * 规范化历史查询 limit 参数。
 *
 * @param {number} limit 用户传入的 limit
 * @returns {number} 安全的 limit
 */
function normalizeLimit(limit) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(Math.floor(limit), MAX_HISTORY_LIMIT);
}

/**
 * 读取请求中的 canvas_id，没有传时使用默认画布。
 *
 * @param {URL} url 请求 URL
 * @returns {string} 画布 ID
 */
function getCanvasIdFromUrl(url) {
  return url.searchParams.get('canvas_id') || DEFAULT_CANVAS_ID;
}

/**
 * 处理历史操作查询接口。
 *
 * @param {URL} url 请求 URL
 * @param {import('http').ServerResponse} res HTTP 响应对象
 */
async function handleOperationsApi(url, res) {
  const canvasId = getCanvasIdFromUrl(url);
  const from = Number(url.searchParams.get('from') || 0);
  const limit = normalizeLimit(Number(url.searchParams.get('limit') || DEFAULT_HISTORY_LIMIT));
  const safeFrom = Number.isFinite(from) && from >= 0 ? Math.floor(from) : 0;

  // 按 SCHEMA.md 要求，operations 查询必须按 canvas_id 隔离。
  const operations = await findOperationsAfter(canvasId, safeFrom, limit);

  sendJson(res, {
    canvas_id: canvasId,
    from: safeFrom,
    limit,
    count: operations.length,
    operations,
  });
}

/**
 * 处理最新快照查询接口。
 *
 * @param {URL} url 请求 URL
 * @param {import('http').ServerResponse} res HTTP 响应对象
 */
async function handleLatestSnapshotApi(url, res) {
  const canvasId = getCanvasIdFromUrl(url);
  const snapshot = await findLatestSnapshot(canvasId);
  sendJson(res, snapshot);
}

/**
 * 处理画布列表查询接口。
 *
 * @param {URL} url 请求 URL
 * @param {import('http').ServerResponse} res HTTP 响应对象
 */
async function handleCanvasesApi(url, res) {
  const limit = normalizeLimit(Number(url.searchParams.get('limit') || 100));
  const canvases = await listCanvases(limit);
  sendJson(res, {
    limit,
    count: canvases.length,
    canvases,
  });
}

/**
 * 处理静态文件请求。
 *
 * @param {import('http').IncomingMessage} req HTTP 请求对象
 * @param {import('http').ServerResponse} res HTTP 响应对象
 */
function handleStaticFile(req, res) {
  // 简单静态文件服务，默认返回 public/index.html。
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, '..', 'public', filePath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
    res.end(content);
  });
}

// ==================== HTTP 服务（API + 静态文件） ====================
const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      sendJson(res, 'server persistence is running');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/operations') {
      await handleOperationsApi(url, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/snapshots/latest') {
      await handleLatestSnapshotApi(url, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/canvases') {
      await handleCanvasesApi(url, res);
      return;
    }

    handleStaticFile(req, res);
  } catch (err) {
    console.error(`[HTTP] 请求处理失败: ${err.message}`);
    sendError(res, err.message);
  }
});

// ==================== WebSocket 服务 ====================
const wss = new WebSocket.Server({ server: httpServer, path: WS_PATH });

// 在线用户映射: userId -> WebSocket
const clients = new Map();

/**
 * 生成简单 userId。
 *
 * @returns {string} 用户 ID
 */
function generateUserId() {
  return 'user-' + Math.random().toString(36).substr(2, 9);
}

/**
 * 生成简单 stroke_id。
 *
 * @returns {string} 笔画 ID
 */
function generateStrokeId() {
  return 'stroke-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * 生成单调递增的 sequence_id，当前使用 Redis INCR，并按 canvas_id 隔离。
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<number>} 操作序列号
 */
async function generateSequenceId(canvasId) {
  return await getNextSequenceId(canvasId);
}

/**
 * 根据客户端消息组装完整 Canvas 操作对象。
 *
 * @param {object} message 客户端传入的绘画消息
 * @param {string} userId 当前 WebSocket 用户 ID
 * @returns {Promise<object>} 完整的 Canvas 操作对象
 */
async function buildCanvasOperation(message, userId) {
  // 兼容前端 action 字段：客户端传 action 时映射为 msg_type。
  const msgType = message.msg_type || message.action || 'draw';
  const canvasId = message.canvas_id || DEFAULT_CANVAS_ID;

  return {
    canvas_id: canvasId,
    msg_type: msgType,
    action: message.action || msgType,
    sequence_id: await generateSequenceId(canvasId),
    user_id: message.user_id || userId,
    stroke_id: message.stroke_id || generateStrokeId(),
    segment_index: Number.isInteger(message.segment_index) ? message.segment_index : 0,
    points: Array.isArray(message.points) ? message.points : [],
    color: message.color || '#000000',
    width: message.width || 3,
    timestamp: message.timestamp || Date.now(),
  };
}

/**
 * 处理单条 WebSocket 客户端消息。
 *
 * @param {string} userId 当前用户 ID
 * @param {Buffer|string} data WebSocket 原始消息
 */
async function handleClientMessage(userId, data) {
  // 先解析客户端 JSON 消息。
  const message = JSON.parse(data.toString());
  console.log(`[收到消息] ${userId}:`, JSON.stringify(message));

  // 组装持久化和广播需要的完整操作对象。
  const operation = await buildCanvasOperation(message, userId);
  console.log(`[序列号] canvas_id=${operation.canvas_id}, sequence_id=${operation.sequence_id}`);

  // 通过 Redis Pub/Sub 广播给 WebSocket 客户端。
  await publish(CHANNEL_CANVAS_OPERATIONS, operation);
  console.log(`[Redis] 已广播画布操作: canvas_id=${operation.canvas_id}, sequence_id=${operation.sequence_id}`);

  // 将绘画操作发送到 Kafka，由本进程内的 Kafka Consumer 消费并写入 MongoDB。
  await sendCanvasOperation(operation);
  console.log(`[Kafka] 已发送画布操作: canvas_id=${operation.canvas_id}, sequence_id=${operation.sequence_id}`);
}

// 处理 WebSocket 连接。
wss.on('connection', async (ws) => {
  const userId = generateUserId();
  clients.set(userId, ws);

  console.log(`[+] 用户连接: ${userId} (当前在线: ${clients.size})`);

  // 发送欢迎消息。
  ws.send(JSON.stringify({
    type: 'welcome',
    user_id: userId,
    message: '连接成功',
  }));

  // 处理客户端消息。
  ws.on('message', async (data) => {
    try {
      await handleClientMessage(userId, data);
    } catch (err) {
      console.error(`[!] 消息处理失败: ${err.message}`);
    }
  });

  // 处理断开连接。
  ws.on('close', () => {
    clients.delete(userId);
    console.log(`[-] 用户断开: ${userId} (当前在线: ${clients.size})`);
  });

  // 错误处理。
  ws.on('error', (err) => {
    console.error(`[!] WebSocket 错误 (${userId}): ${err.message}`);
    clients.delete(userId);
  });
});

/**
 * 广播消息给所有 WebSocket 客户端。
 *
 * @param {object} operation 画布操作对象
 */
function broadcastToClients(operation) {
  const message = JSON.stringify({
    type: 'broadcast',
    ...operation,
  });
  let sentCount = 0;

  clients.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
      sentCount++;
    }
  });

  console.log(`[广播] 已发送给 ${sentCount} 个客户端: canvas_id=${operation.canvas_id}, sequence_id=${operation.sequence_id}`);
}

/**
 * 订阅 Redis Pub/Sub 频道，接收广播并转发给 WebSocket 客户端。
 *
 * @param {string} channel 频道名
 */
async function startRedisSubscription(channel) {
  await subscribe(channel, (message) => {
    broadcastToClients(message);
  });
}

/**
 * 启动 HTTP、WebSocket、Kafka、Redis 和 MongoDB。
 */
async function startServer() {
  // 服务启动时初始化所有基础组件。
  await initMongo();
  await initKafkaProducer();
  await initKafkaConsumer();
  await startRedisSubscription(CHANNEL_CANVAS_OPERATIONS);

  httpServer.listen(PORT, () => {
    console.log('===========================================');
    console.log(' SyncCanvas Node.js 网关 + 持久化服务');
    console.log(` 端口: http://localhost:${PORT}`);
    console.log(` WebSocket: ws://localhost:${PORT}${WS_PATH}`);
    console.log(' HTTP API: /api/v1/operations, /api/v1/snapshots/latest, /api/v1/canvases, /api/v1/health');
    console.log(' Redis: localhost:6379');
    console.log(' Kafka Topic: canvas-operations');
    console.log(' MongoDB: mongodb://localhost:27017/sync_canvas');
    console.log('===========================================');
    console.log('等待连接...');
    console.log('');
    console.log('提示: 打开浏览器访问 http://localhost:' + PORT);
    console.log('提示: 运行前先启动 docker-compose up -d');
    console.log('');
  });
}

/**
 * 优雅关闭服务和外部连接。
 *
 * @param {string} signal 退出信号
 */
async function gracefulShutdown(signal) {
  console.log(`[进程退出] 收到 ${signal}，正在关闭服务...`);

  try {
    await closeKafkaConsumer();
  } catch (err) {
    console.error(`[!] Kafka Consumer 关闭失败: ${err.message}`);
  }

  try {
    await closeKafkaProducer();
  } catch (err) {
    console.error(`[!] Kafka Producer 关闭失败: ${err.message}`);
  }

  try {
    await closeRedis();
  } catch (err) {
    console.error(`[!] Redis 关闭失败: ${err.message}`);
  }

  try {
    await closeMongo();
  } catch (err) {
    console.error(`[!] MongoDB 关闭失败: ${err.message}`);
  } finally {
    process.exit(0);
  }
}

// 监听进程退出信号，确保 Kafka、Redis、MongoDB 可以优雅断开。
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 启动网关服务。
startServer().catch((err) => {
  console.error(`[!] 服务启动失败: ${err.message}`);
  process.exit(1);
});
