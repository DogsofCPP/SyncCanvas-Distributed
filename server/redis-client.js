/**
 * Redis 客户端模块
 * - INCR: 分布式序列号生成
 * - Pub/Sub: 消息广播
 */

const Redis = require('ioredis');

/**
 * Redis 配置
 */
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

/**
 * Pub/Sub 频道名称
 */
const CHANNEL_CANVAS_OPERATIONS = 'canvas:operations';

/**
 * Redis Client 主客户端（用于 INCR 和普通操作）
 */
const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

/**
 * Redis Subscriber 用于订阅 Pub/Sub 消息
 */
const redisSubscriber = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

/**
 * 连接成功事件
 */
redisClient.on('connect', () => {
  console.log(`[Redis] Client 已连接: ${REDIS_HOST}:${REDIS_PORT}`);
});

redisClient.on('error', (err) => {
  console.error(`[Redis] Client 错误: ${err.message}`);
});

redisSubscriber.on('connect', () => {
  console.log(`[Redis] Subscriber 已连接: ${REDIS_HOST}:${REDIS_PORT}`);
});

redisSubscriber.on('error', (err) => {
  console.error(`[Redis] Subscriber 错误: ${err.message}`);
});

/**
 * 获取下一个 sequence_id（原子操作）
 *
 * @returns {Promise<number>} 序列号
 */
async function getNextSequenceId() {
  const sequenceId = await redisClient.incr('canvas:sequence_id');
  return sequenceId;
}

/**
 * 发布消息到频道
 *
 * @param {string} channel 频道名
 * @param {object} message 消息对象
 * @returns {Promise<number>} 订阅者数量
 */
async function publish(channel, message) {
  const count = await redisClient.publish(channel, JSON.stringify(message));
  return count;
}

/**
 * 订阅频道的消息回调类型
 * @param {object} message 消息对象
 */
// 频道 -> 处理器映射（支持多画布订阅）
const channelHandlers = new Map();

/**
 * 订阅频道
 *
 * @param {string} channel 频道名
 * @param {function} handler 消息处理函数
 */
async function subscribe(channel, handler) {
  channelHandlers.set(channel, handler);
  await redisSubscriber.subscribe(channel);
  console.log(`[Redis] 已订阅频道: ${channel}`);
}

/**
 * 取消订阅频道
 *
 * @param {string} channel 频道名
 */
async function unsubscribe(channel) {
  channelHandlers.delete(channel);
  await redisSubscriber.unsubscribe(channel);
  console.log(`[Redis] 已取消订阅频道: ${channel}`);
}

/**
 * 处理订阅到的消息
 */
redisSubscriber.on('message', (ch, message) => {
  const handler = channelHandlers.get(ch);
  if (handler) {
    try {
      const parsed = JSON.parse(message);
      handler(parsed);
    } catch (err) {
      console.error(`[Redis] 消息解析失败: ${err.message}, 原始消息: ${message}`);
    }
  }
});

/**
 * Redis 缓存最近 N 条操作（用于新用户加入时快速全量同步）
 * key: canvas:{canvasId}  -> List[LIMIT 条最新操作 JSON]
 */
const CANVAS_CACHE_LIMIT = 500;

/**
 * 将操作写入画布缓存（LPUSH + LTRIM 保持最近 N 条）
 */
async function cacheStrokeOperation(canvasId, operation) {
  try {
    const key = `canvas:${canvasId}`;
    await redisClient.lpush(key, JSON.stringify(operation));
    await redisClient.ltrim(key, 0, CANVAS_CACHE_LIMIT - 1);
  } catch (err) {
    console.error(`[Redis] 缓存写入失败: ${err.message}`);
  }
}

/**
 * 读取画布缓存中的所有操作（按 sequence_id 升序返回）
 */
async function getCachedOperations(canvasId) {
  try {
    const key = `canvas:${canvasId}`;
    const raw = await redisClient.lrange(key, 0, CANVAS_CACHE_LIMIT - 1);
    if (!raw || raw.length === 0) return [];

    const operations = raw
      .map(item => {
        try { return JSON.parse(item); } catch { return null; }
      })
      .filter(Boolean);

    // 按 sequence_id 升序排列
    operations.sort((a, b) => (a.sequence_id || 0) - (b.sequence_id || 0));
    return operations;
  } catch (err) {
    console.error(`[Redis] 缓存读取失败: ${err.message}`);
    return [];
  }
}

/**
 * 获取缓存中最新一条操作的 sequence_id
 */
async function getCachedLatestSeqId(canvasId) {
  try {
    const key = `canvas:${canvasId}`;
    const raw = await redisClient.lindex(key, 0);
    if (!raw) return 0;
    const op = JSON.parse(raw);
    return op.sequence_id || 0;
  } catch {
    return 0;
  }
}

/**
 * 关闭 Redis 连接
 */
async function closeRedis() {
  await redisClient.quit();
  await redisSubscriber.quit();
  console.log('[Redis] 连接已关闭');
}

module.exports = {
  REDIS_HOST,
  REDIS_PORT,
  CHANNEL_CANVAS_OPERATIONS,
  CANVAS_CACHE_LIMIT,
  getNextSequenceId,
  publish,
  subscribe,
  unsubscribe,
  cacheStrokeOperation,
  getCachedOperations,
  getCachedLatestSeqId,
  closeRedis,
  _redisClient: redisClient,
};
