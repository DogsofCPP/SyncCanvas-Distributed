/**
 * SyncCanvas WebSocket 网关服务。
 *
 * 启动方式: node server/index.js
 * 依赖: npm install ws kafkajs
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

// 内存序列号，第一阶段先使用本机递增，后续可替换为 Redis INCR。
let currentSequenceId = Date.now();

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
 * 生成单调递增的 sequence_id。
 *
 * @returns {number} 操作序列号
 */
function generateSequenceId() {
  currentSequenceId += 1;
  return currentSequenceId;
}

/**
 * 根据客户端消息组装完整 Canvas 操作对象。
 *
 * @param {object} message 客户端传入的绘画消息
 * @param {string} userId 当前 WebSocket 用户 ID
 * @returns {object} 完整的 Canvas 操作对象
 */
function buildCanvasOperation(message, userId) {
  // 兼容前端 action 字段：客户端传 action 时映射为 msg_type。
  const msgType = message.msg_type || message.action || 'draw';

  return {
    msg_type: msgType,
    sequence_id: generateSequenceId(),
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
  // 先解析客户端 JSON 消息。
  const message = JSON.parse(data.toString());
  console.log(`[收到消息] ${userId}:`, JSON.stringify(message));

  // 组装持久化需要的完整操作对象。
  const operation = buildCanvasOperation(message, userId);

  // 将绘画操作发送到 Kafka，由 Java persistence-service 负责消费和写入 MongoDB。
  await sendCanvasOperation(operation);
  console.log(`[Kafka] 已发送画布操作: sequence_id=${operation.sequence_id}, user_id=${operation.user_id}`);
}

// 处理 WebSocket 连接。
wss.on('connection', (ws) => {
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
 * 启动 HTTP 和 WebSocket 服务。
 */
async function startServer() {
  // 服务启动时初始化 Kafka Producer。
  await initKafkaProducer();

  httpServer.listen(PORT, () => {
    console.log('===========================================');
    console.log(' SyncCanvas WebSocket 网关服务');
    console.log(` 端口: http://localhost:${PORT}`);
    console.log(` WebSocket: ws://localhost:${PORT}${WS_PATH}`);
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
 * 优雅关闭服务和 Kafka Producer。
 *
 * @param {string} signal 退出信号
 */
async function gracefulShutdown(signal) {
  console.log(`[进程退出] 收到 ${signal}，正在关闭 Kafka Producer...`);

  try {
    await closeKafkaProducer();
  } catch (err) {
    console.error(`[!] Kafka Producer 关闭失败: ${err.message}`);
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
