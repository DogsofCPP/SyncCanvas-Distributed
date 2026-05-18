/**
 * Prometheus 指标中间件 - SyncCanvas
 *
 * 成员 B：将此中间件集成到 ws-server.js
 *
 * 使用方式:
 *   const { metricsMiddleware, metrics } = require('./metrics');
 *   app.use('/metrics', metricsMiddleware);
 *
 *   // 在消息处理中使用:
 *   metrics.messagesReceived.inc({ canvas_id });
 *   metrics.latency.observe({ canvas_id }, latencySeconds);
 */

const client = require('prom-client');

// 创建注册表
const register = new client.Registry();

// 添加默认指标
client.collectDefaultMetrics({ register });

// ============================================================================
// 自定义指标
// ============================================================================

// 消息计数器
const messagesReceived = new client.Counter({
  name: 'synccanvas_messages_received_total',
  help: '接收到的消息总数',
  labelNames: ['action', 'canvas_id'],
  registers: [register],
});

// 发送消息计数器
const messagesSent = new client.Counter({
  name: 'synccanvas_messages_sent_total',
  help: '发送的消息总数',
  labelNames: ['action', 'canvas_id'],
  registers: [register],
});

// 在线用户数
const onlineUsers = new client.Gauge({
  name: 'synccanvas_online_users_total',
  help: '当前在线用户数',
  registers: [register],
});

// 各画布在线用户
const canvasOnlineUsers = new client.Gauge({
  name: 'synccanvas_canvas_online_users',
  help: '各画布在线用户数',
  labelNames: ['canvas_id'],
  registers: [register],
});

// 端到端延迟直方图
const endToEndLatency = new client.Histogram({
  name: 'synccanvas_end_to_end_latency_seconds',
  help: '端到端延迟（从收到消息到广播完成）',
  labelNames: ['canvas_id'],
  buckets: [0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

// 消息处理延迟直方图
const processingLatency = new client.Histogram({
  name: 'synccanvas_processing_latency_seconds',
  help: '消息处理延迟（服务端处理时间）',
  labelNames: ['action', 'canvas_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [register],
});

// Redis 操作延迟直方图
const redisLatency = new client.Histogram({
  name: 'synccanvas_redis_latency_seconds',
  help: 'Redis 操作延迟',
  labelNames: ['operation'],
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05],
  registers: [register],
});

// Redis 操作计数器
const redisOperations = new client.Counter({
  name: 'synccanvas_redis_operations_total',
  help: 'Redis 操作总数',
  labelNames: ['operation'],
  registers: [register],
});

// WebSocket 连接数
const wsConnections = new client.Gauge({
  name: 'synccanvas_ws_connections_total',
  help: '当前 WebSocket 连接数',
  registers: [register],
});

// 各画布 WebSocket 连接数
const canvasWsConnections = new client.Gauge({
  name: 'synccanvas_canvas_ws_connections',
  help: '各画布 WebSocket 连接数',
  labelNames: ['canvas_id'],
  registers: [register],
});

// 入站字节数
const bytesReceived = new client.Counter({
  name: 'synccanvas_bytes_received_total',
  help: '接收到的字节数',
  registers: [register],
});

// 出站字节数
const bytesSent = new client.Counter({
  name: 'synccanvas_bytes_sent_total',
  help: '发送的字节数',
  registers: [register],
});

// 各画布操作数
const canvasOperations = new client.Counter({
  name: 'synccanvas_canvas_operations_total',
  help: '各画布操作数',
  labelNames: ['canvas_id', 'action'],
  registers: [register],
});

// 错误计数器
const errors = new client.Counter({
  name: 'synccanvas_errors_total',
  help: '错误总数',
  labelNames: ['type', 'canvas_id'],
  registers: [register],
});

// ============================================================================
// Express/Koa 中间件
// ============================================================================

async function metricsMiddleware(ctx, next) {
  await next();
  ctx.body = await register.metrics();
}

// ============================================================================
// 导出
// ============================================================================

module.exports = {
  register,
  metricsMiddleware,

  // 指标对象
  metrics: {
    messagesReceived,
    messagesSent,
    onlineUsers,
    canvasOnlineUsers,
    endToEndLatency,
    processingLatency,
    redisLatency,
    redisOperations,
    wsConnections,
    canvasWsConnections,
    bytesReceived,
    bytesSent,
    canvasOperations,
    errors,
  },
};
