/**
 * SyncCanvas WebSocket 网关服务。
 *
 * 启动方式: node server/index.js
 * 依赖: npm install ws kafkajs ioredis
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
  getNextSequenceId,
  publish,
  subscribe,
  closeRedis,
  CHANNEL_CANVAS_OPERATIONS,
} = require('./redis-client');
const {
  connectMongo,
  saveStroke,
  getStrokesByCanvas,
  closeMongo,
} = require('./mongo-client');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3000;
const WS_PATH = '/ws';

// ==================== HTTP 服务（静态文件） ====================
const httpServer = http.createServer((req, res) => {
  // 简单静态文件服务，默认返回 public/index.html。
  let filePath = req.url === '/' ? '/index.html' : req.url;
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
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(content);
  });
});

// ==================== WebSocket 服务 ====================
const wss = new WebSocket.Server({ server: httpServer, path: WS_PATH });

// 在线用户映射: userId -> WebSocket
const clients = new Map();

// 默认画布 ID
const DEFAULT_CANVAS_ID = 'default';

/**
 * 加载画布历史操作
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<Array>} 历史操作数组
 */
async function loadCanvasHistory(canvasId = DEFAULT_CANVAS_ID) {
  try {
    const history = await getStrokesByCanvas(canvasId, { limit: 10000 });
    console.log(`[MongoDB] 已加载历史操作: ${history.length} 条`);
    return history;
  } catch (err) {
    console.error(`[!] 加载历史失败: ${err.message}`);
    return [];
  }
}

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
 * 生成单调递增的 sequence_id（使用 Redis INCR）。
 *
 * @returns {Promise<number>} 操作序列号
 */
async function generateSequenceId() {
  return await getNextSequenceId();
}

/**
 * 根据客户端消息组装完整 Canvas 操作对象（使用 Redis INCR 生成 sequence_id）。
 *
 * @param {object} message 客户端传入的绘画消息
 * @param {string} userId 当前 WebSocket 用户 ID
 * @returns {Promise<object>} 完整的 Canvas 操作对象
 */
async function buildCanvasOperation(message, userId) {
  // 兼容前端 action 字段：客户端传 action 时映射为 msg_type。
  const msgType = message.msg_type || message.action || 'draw';

  return {
    msg_type: msgType,
    sequence_id: await generateSequenceId(),
    user_id: message.user_id || userId,
    stroke_id: message.stroke_id || generateStrokeId(),
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
  const message = JSON.parse(data.toString());
  console.log(`[收到消息] userId=${userId}, stroke_id=${message.stroke_id}, points=${message.points?.length || 0}`);

  const operation = await buildCanvasOperation(message, userId);

  // 广播给其他客户端
  await publish(CHANNEL_CANVAS_OPERATIONS, operation);

  // 发送到 Kafka
  await sendCanvasOperation(operation);

  // 存储到 MongoDB
  await saveStroke(operation);
  console.log(`[完成] stroke_id=${operation.stroke_id}, 点数=${operation.points.length}`);
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

  // 发送画布历史
  try {
    const history = await loadCanvasHistory();
    if (history.length > 0) {
      ws.send(JSON.stringify({
        type: 'sync_response',
        canvas_id: DEFAULT_CANVAS_ID,
        operations: history,
        total: history.length,
      }));
      console.log(`[同步] 已向 ${userId} 发送 ${history.length} 条历史操作`);
    }
  } catch (err) {
    console.error(`[!] 发送历史失败: ${err.message}`);
  }

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
  const message = JSON.stringify(operation);
  let sentCount = 0;

  clients.forEach((clientWs, clientId) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
      sentCount++;
    }
  });

  console.log(`[广播] 已发送给 ${sentCount} 个客户端: sequence_id=${operation.sequence_id}`);
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
 * 启动 HTTP 和 WebSocket 服务。
 */
async function startServer() {
  await connectMongo();
  await initKafkaProducer();
  await startRedisSubscription(CHANNEL_CANVAS_OPERATIONS);

  httpServer.listen(PORT, () => {
    console.log('===========================================');
    console.log(' SyncCanvas WebSocket 网关服务');
    console.log(` 端口: http://localhost:${PORT}`);
    console.log(` WebSocket: ws://localhost:${PORT}${WS_PATH}`);
    console.log(` Redis: localhost:6379`);
    console.log(' Redis Channel:', CHANNEL_CANVAS_OPERATIONS);
    console.log(' Kafka Topic: canvas-operations');
    console.log('===========================================');
    console.log('等待连接...');
    console.log('');
    console.log('提示: 打开浏览器访问 http://localhost:' + PORT);
    console.log('提示: 运行前先启动 docker-compose up');
    console.log('');
  });
}

/**
 * 优雅关闭服务和 Redis 连接。
 *
 * @param {string} signal 退出信号
 */
async function gracefulShutdown(signal) {
  console.log(`[进程退出] 收到 ${signal}，正在关闭服务...`);

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

// 监听进程退出信号，确保 Kafka Producer 可以优雅断开。
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 启动网关服务。
startServer().catch((err) => {
  console.error(`[!] 服务启动失败: ${err.message}`);
  process.exit(1);
});
