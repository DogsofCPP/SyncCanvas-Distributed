/**
 * SyncCanvas WebSocket 服务端骨架
 * 第 1 天产出物 - 仅打印日志，不做实际处理
 *
 * 启动方式: node server/index.js
 * 依赖: npm install ws
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3000;
const WS_PATH = '/ws';

// ==================== HTTP 服务器（静态文件） ====================
const httpServer = http.createServer((req, res) => {
  // 简单静态文件服务
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

// ==================== WebSocket 服务器 ====================
const wss = new WebSocket.Server({ server: httpServer, path: WS_PATH });

// 在线用户映射: userId -> WebSocket
const clients = new Map();

// 生成简单 userId
function generateUserId() {
  return 'user-' + Math.random().toString(36).substr(2, 9);
}

// 处理 WebSocket 连接
wss.on('connection', (ws, req) => {
  const userId = generateUserId();
  clients.set(userId, ws);

  console.log(`[+] 用户连接: ${userId} (当前在线: ${clients.size})`);

  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'welcome',
    user_id: userId,
    message: '连接成功！'
  }));

  // 处理客户端消息
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[收到消息] ${userId}:`, JSON.stringify(message));

      // TODO: 后续在这里添加序列号生成、Redis 广播等逻辑
      // 目前仅打印日志

    } catch (err) {
      console.error(`[!] 消息解析失败: ${err.message}`);
    }
  });

  // 处理断开连接
  ws.on('close', () => {
    clients.delete(userId);
    console.log(`[-] 用户断开: ${userId} (当前在线: ${clients.size})`);
  });

  // 错误处理
  ws.on('error', (err) => {
    console.error(`[!] WebSocket 错误 (${userId}): ${err.message}`);
    clients.delete(userId);
  });
});

// ==================== 启动服务器 ====================
httpServer.listen(PORT, () => {
  console.log('===========================================');
  console.log(' SyncCanvas WebSocket 服务器');
  console.log(` 端口: http://localhost:${PORT}`);
  console.log(` WebSocket: ws://localhost:${PORT}${WS_PATH}`);
  console.log('===========================================');
  console.log('等待连接...');
  console.log('');
  console.log('提示: 打开浏览器访问 http://localhost:' + PORT);
  console.log('提示: 运行前先启动 docker-compose up');
  console.log('');
});
