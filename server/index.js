/**
 * SyncCanvas 网关服务
 * - HTTP REST API: 认证 + 画布管理
 * - WebSocket: 按 canvas_id 隔离广播
 *
 * 启动方式: node server/index.js
 * 依赖: npm install
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
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
  getNextSequenceId,
  publish,
  subscribe,
  unsubscribe,
  cacheStrokeOperation,
  getCachedOperations,
  getCachedLatestSeqId,
  closeRedis,
  _redisClient,
} = require('./redis-client');
const {
  connectMongo,
  getStrokesByCanvas,
  getLatestSequenceId,
  clearCanvas,
  deleteStrokeById,
  closeMongo,
} = require('./mongo-client');
const { initAuthCollections } = require('./auth-mongo');
const { authMiddleware } = require('./middleware/auth');
const { handleAuthRoute } = require('./routes/auth');
const { handleCanvasRoute } = require('./routes/canvas');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const WS_PATH = '/ws';

// ==================== HTTP 服务 ====================

const httpServer = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // REST API 路由
  if (pathname.startsWith('/api/v1/auth/')) {
    await handleAuthRoute(req, res);
    return;
  }

  if (pathname.startsWith('/api/v1/canvases')) {
    if (parsed.query.token || req.headers.authorization) {
      await new Promise((resolve) => {
        authMiddleware(req, res, resolve);
      });
      if (!req.user) return;
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: { code: 1001, message: '需要认证' }
      }));
      return;
    }
    await handleCanvasRoute(req, res);
    return;
  }

  // 静态文件服务
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, '..', 'public', filePath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(content);
  });
});

// ==================== WebSocket 服务 ====================

const wss = new WebSocket.Server({ server: httpServer, path: WS_PATH });

// 在线用户映射: userId -> { ws, canvasId, username }
const clients = new Map();

// canvasId -> Set of userIds (用于按画布隔离广播)
const canvasRooms = new Map();

// canvasId -> Redis subscription callback (用于按画布隔离 Redis 消息)
const canvasSubscriptions = new Map();

/**
 * 解析 WebSocket URL 中的 canvas_id
 */
function parseCanvasId(request) {
  const parsed = url.parse(request.url, true);
  return parsed.query.canvas_id || null;
}

/**
 * 加入画布房间
 */
function joinCanvasRoom(userId, canvasId) {
  if (!canvasId) return;

  if (!canvasRooms.has(canvasId)) {
    canvasRooms.set(canvasId, new Set());
  }
  canvasRooms.get(canvasId).add(userId);

  console.log(`[Room] ${userId} 加入画布 ${canvasId} (房间人数: ${canvasRooms.get(canvasId).size})`);
}

/**
 * 离开画布房间
 */
async function leaveCanvasRoom(userId, canvasId) {
  if (!canvasId) return;

  const room = canvasRooms.get(canvasId);
  if (room) {
    room.delete(userId);
    if (room.size === 0) {
      canvasRooms.delete(canvasId);
      await cleanupCanvasRoom(canvasId);
    }
  }

  const clientInfo = clients.get(userId);
  const roomSize = canvasRooms.get(canvasId)?.size || 0;
  console.log(`[Room] ${userId} 离开画布 ${canvasId} (房间人数: ${roomSize})`);
}

/**
 * 清理画布房间的 Redis 订阅
 */
async function cleanupCanvasRoom(canvasId) {
  if (canvasSubscriptions.has(canvasId)) {
    canvasSubscriptions.delete(canvasId);
  }

  const redisChannel = `canvas:${canvasId}`;
  try {
    await unsubscribe(redisChannel);
    console.log(`[Redis] 已取消订阅画布频道: ${redisChannel}`);
  } catch (err) {
    console.error(`[!] 取消订阅失败: ${err.message}`);
  }
}

/**
 * 订阅画布频道
 */
async function subscribeCanvas(canvasId) {
  if (canvasSubscriptions.has(canvasId)) return;
  if (!canvasId) return;

  const channel = `canvas:${canvasId}`;
  const handler = (message) => {
    broadcastToCanvas(canvasId, message);
  };

  canvasSubscriptions.set(canvasId, handler);
  await subscribe(channel, handler);
  console.log(`[Redis] 已订阅画布频道: ${channel}`);
}

/**
 * 向同一画布的所有客户端广播
 */
function broadcastToCanvas(canvasId, operation) {
  const room = canvasRooms.get(canvasId);
  if (!room || room.size === 0) return;

  const message = JSON.stringify(operation);
  let sentCount = 0;

  room.forEach((userId) => {
    const clientInfo = clients.get(userId);
    if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
      clientInfo.ws.send(message);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`[Broadcast] 画布 ${canvasId}: 已发送给 ${sentCount} 个客户端, seq=${operation.sequence_id}`);
  }
}

/**
 * 加载画布历史操作（新用户加入时全量同步）
 * 优先级：Redis 缓存（最近 500 条） -> MongoDB（全量兜底）
 */
async function loadCanvasHistory(canvasId) {
  // 1. 先从 Redis 缓存拉（毫秒级，通常能覆盖近期操作）
  const cached = await getCachedOperations(canvasId);
  if (cached && cached.length > 0) {
    const cachedSeqId = cached[cached.length - 1].sequence_id || 0;
    console.log(`[History] 画布 ${canvasId}: Redis 缓存命中 ${cached.length} 条, 最新 seq=${cachedSeqId}`);

    // 2. 从 MongoDB 补拉缓存之后的增量
    const dbOps = await getStrokesByCanvas(canvasId, {
      sinceSequenceId: cachedSeqId,
      limit: 10000,
    });

    if (dbOps && dbOps.length > 0) {
      // 合并去重（dbOps 的 sequence_id > cachedSeqId）
      const merged = [...cached];
      for (const op of dbOps) {
        const exists = merged.some(m => m.stroke_id === op.stroke_id);
        if (!exists) merged.push(op);
      }
      merged.sort((a, b) => (a.sequence_id || 0) - (b.sequence_id || 0));
      console.log(`[History] 画布 ${canvasId}: MongoDB 补充 ${dbOps.length} 条增量, 合计 ${merged.length} 条`);
      return merged;
    }

    return cached;
  }

  // 3. 缓存为空，直接从 MongoDB 全量拉
  try {
    const history = await getStrokesByCanvas(canvasId, { limit: 10000 });
    console.log(`[History] 画布 ${canvasId}: MongoDB 全量加载 ${history.length} 条`);
    return history;
  } catch (err) {
    console.error(`[!] 加载历史失败: ${err.message}`);
    return [];
  }
}

/**
 * 生成 userId
 */
function generateUserId() {
  return 'user-' + Math.random().toString(36).substr(2, 9);
}

/**
 * 生成 stroke_id
 */
function generateStrokeId() {
  return 'stroke-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * 组装 Canvas 操作对象
 */
async function buildCanvasOperation(message, userId, canvasId) {
  const msgType = message.action || message.msg_type || 'stroke';

  return {
    canvas_id: canvasId,
    action: msgType,
    msg_type: msgType,
    sequence_id: await getNextSequenceId(),
    user_id: userId,
    stroke_id: message.stroke_id || generateStrokeId(),
    points: Array.isArray(message.points) ? message.points : [],
    color: message.color || '#000000',
    width: message.width || 3,
    timestamp: message.timestamp || Date.now(),
  };
}

/**
 * 处理 WebSocket 客户端消息
 */
async function handleClientMessage(userId, canvasId, data) {
  const message = JSON.parse(data.toString());
  console.log(`[消息] userId=${userId}, canvas=${canvasId}, stroke_id=${message.stroke_id}, points=${message.points?.length || 0}`);

  // 处理清空画布操作（同步撤销）
  if (message.type === 'clear' || message.action === 'clear') {
    const operation = {
      canvas_id: canvasId,
      action: 'clear',
      msg_type: 'clear',
      sequence_id: await getNextSequenceId(),
      user_id: userId,
      timestamp: Date.now(),
      triggered_by: userId,
    };

    // 删除 MongoDB 中的所有笔画
    await clearCanvas(canvasId);

    // 清除 Redis 缓存
    try {
      await _redisClient.del(`canvas:${canvasId}`);
    } catch (_) {}

    console.log(`[Clear] 用户 ${userId} 清空了画布 ${canvasId}`);

    // 广播给所有客户端（包括发送者，用于同步状态）
    await publish(`canvas:${canvasId}`, operation);
    return;
  }

  // 处理单个笔画撤销操作
  if (message.type === 'undo' || message.action === 'undo') {
    const strokeId = message.stroke_id;
    if (!strokeId) {
      console.warn(`[Undo] 缺少 stroke_id`);
      return;
    }

    const operation = {
      canvas_id: canvasId,
      action: 'undo',
      msg_type: 'undo',
      sequence_id: await getNextSequenceId(),
      user_id: userId,
      stroke_id: strokeId,
      timestamp: Date.now(),
    };

    // 从 MongoDB 中删除该笔画
    await deleteStrokeById(strokeId);
    console.log(`[Undo] 用户 ${userId} 撤销了笔画 ${strokeId}`);

    // 广播给所有客户端
    await publish(`canvas:${canvasId}`, operation);
    return;
  }

  const operation = await buildCanvasOperation(message, userId, canvasId);

  // 1. Redis 缓存最近 500 条（新用户加入时快速拉取全量历史）
  await cacheStrokeOperation(canvasId, operation);

  // 2. Redis Pub/Sub 实时广播给同画布的其他客户端
  await publish(`canvas:${canvasId}`, operation);

  // 3. Kafka 异步持久化，MongoDB 写入只由 Consumer 批量处理
  sendCanvasOperation(operation).catch(err => {
    console.error(`[Kafka] 发送失败: ${err.message}`);
  });
}

/**
 * WebSocket 连接处理
 */
wss.on('connection', async (ws, req) => {
  const canvasId = parseCanvasId(req);
  const userId = generateUserId();
  const clientInfo = { ws, canvasId, userId };
  clients.set(userId, clientInfo);

  console.log(`[+] 用户连接: ${userId}, canvas=${canvasId || '(无)'}, 当前在线: ${clients.size}`);

  ws.send(JSON.stringify({
    type: 'welcome',
    user_id: userId,
    canvas_id: canvasId,
    message: '连接成功'
  }));

  if (canvasId) {
    await joinCanvasRoom(userId, canvasId);

    await subscribeCanvas(canvasId);

    const history = await loadCanvasHistory(canvasId);
    if (history.length > 0) {
      ws.send(JSON.stringify({
        type: 'sync_response',
        canvas_id: canvasId,
        operations: history,
        latest_sequence_id: history.length > 0 ? history[history.length - 1].sequence_id : 0,
        total: history.length
      }));
    }
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'pong') {
        return;
      }

      const msgCanvasId = msg.canvas_id || canvasId;
      if (msgCanvasId && msgCanvasId !== canvasId) {
        await leaveCanvasRoom(userId, canvasId);
        await joinCanvasRoom(userId, msgCanvasId);
        clientInfo.canvasId = msgCanvasId;
        await subscribeCanvas(msgCanvasId);

        const history = await loadCanvasHistory(msgCanvasId);
        if (history.length > 0) {
          ws.send(JSON.stringify({
            type: 'sync_response',
            canvas_id: msgCanvasId,
            operations: history,
            latest_sequence_id: history.length > 0 ? history[history.length - 1].sequence_id : 0,
            total: history.length
          }));
        }
        return;
      }

      await handleClientMessage(userId, canvasId, data);
    } catch (err) {
      console.error(`[!] 消息处理失败: ${err.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        code: 1002,
        message: '消息格式错误'
      }));
    }
  });

  ws.on('close', async () => {
    await leaveCanvasRoom(userId, canvasId);
    clients.delete(userId);
    console.log(`[-] 用户断开: ${userId}, canvas=${canvasId}, 当前在线: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[!] WebSocket 错误 (${userId}): ${err.message}`);
    clients.delete(userId);
  });
});

// ==================== 启动服务 ====================

async function startServer() {
  await connectMongo();
  await initAuthCollections();
  await initKafkaProducer();
  await initKafkaConsumer();

  httpServer.listen(PORT, HOST, () => {
    console.log('===========================================');
    console.log(' SyncCanvas 网关服务 v2.0');
    console.log(` HTTP API:  http://${HOST === '0.0.0.0' ? getLocalIP() : HOST}:${PORT}/api/v1/`);
    console.log(` WebSocket: ws://${HOST === '0.0.0.0' ? getLocalIP() : HOST}:${PORT}/ws`);
    console.log(` 提示: 打开 http://${HOST === '0.0.0.0' ? getLocalIP() : HOST}:${PORT} 访问应用`);
    console.log('===========================================');
  });

function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}
}

async function gracefulShutdown(signal) {
  console.log(`[进程退出] 收到 ${signal}，正在关闭服务...`);

  try {
    await closeKafkaProducer();
  } catch (err) {
    console.error(`[!] Kafka Producer 关闭失败: ${err.message}`);
  }

  try {
    await closeKafkaConsumer();
  } catch (err) {
    console.error(`[!] Kafka Consumer 关闭失败: ${err.message}`);
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

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer().catch((err) => {
  console.error(`[!] 服务启动失败: ${err.message}`);
  process.exit(1);
});
