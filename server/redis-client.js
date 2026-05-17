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
let messageHandler = null;

/**
 * 标记：subscriber 是否已完全就绪（subscribe 命令已发送 + 连接已建立）。
 */
let subscriberReady = false;

/**
 * 订阅频道。
 *
 * @param {string} channel 频道名
 * @param {function} handler 消息处理函数
 */
async function subscribe(channel, handler) {
  messageHandler = handler;

  // 等待 subscriber 连接就绪，再发 SUBSCRIBE 命令。
  // ioredis 的 subscribe() 会在连接就绪后立即发出命令，
  // 但由于 server/index.js 没有 await，这里需要显式等待 ready。
  await new Promise((resolve) => {
    if (redisSubscriber.status === 'ready') {
      resolve();
    } else {
      redisSubscriber.once('ready', resolve);
    }
  });

  await redisSubscriber.subscribe(channel);
  subscriberReady = true;
  console.log(`[Redis] 已订阅频道: ${channel}`);
}

/**
 * 取消订阅频道
 *
 * @param {string} channel 频道名
 */
async function unsubscribe(channel) {
  await redisSubscriber.unsubscribe(channel);
  console.log(`[Redis] 已取消订阅频道: ${channel}`);
}

/**
 * 处理订阅到的消息。
 */
redisSubscriber.on('message', (ch, message) => {
  if (!subscriberReady || !messageHandler) {
    return;
  }
  try {
    const parsed = JSON.parse(message);
    messageHandler(parsed);
  } catch (err) {
    console.error(`[Redis] 消息解析失败: ${err.message}, 原始消息: ${message}`);
  }
});

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
  getNextSequenceId,
  publish,
  subscribe,
  unsubscribe,
  closeRedis,
};
