/**
 * Canvas 操作 Kafka Consumer 模块，负责消费 Kafka 消息并批量写入 MongoDB。
 */

const { kafka, CANVAS_OPERATIONS_TOPIC } = require('./kafka-producer');
const { saveOperations } = require('./mongo-client');

/**
 * Kafka Consumer 消费组 ID。
 */
const GROUP_ID = process.env.KAFKA_CONSUMER_GROUP || 'persistence-service';

/**
 * 批量写入阈值，缓冲区达到该数量后立即写入 MongoDB。
 */
const BATCH_SIZE = 500;

/**
 * 定时刷盘间隔，单位毫秒。
 */
const FLUSH_INTERVAL_MS = 1000;

/**
 * Kafka Consumer 实例。
 */
const consumer = kafka.consumer({ groupId: GROUP_ID });

/**
 * 内存缓冲区，用于暂存尚未写入 MongoDB 的操作。
 */
let operationBuffer = [];

/**
 * 标记当前是否正在执行批量写入，避免定时器和消费回调同时刷盘。
 */
let flushing = false;

/**
 * 定时刷盘任务 ID。
 */
let flushTimer = null;

/**
 * 初始化 Kafka Consumer，并开始消费 canvas-operations Topic。
 */
async function initKafkaConsumer() {
  await consumer.connect();
  // 从头订阅可以避免服务首次启动时 Topic 已有未处理消息却被跳过；写入 MongoDB 使用 upsert，重复消费不会重复插入。
  await consumer.subscribe({ topic: CANVAS_OPERATIONS_TOPIC, fromBeginning: true });

  // 每隔 1 秒检查一次缓冲区，避免低流量时消息长时间停留在内存中。
  flushTimer = setInterval(() => {
    flushBuffer('schedule').catch((err) => {
      console.error(`[Kafka] 定时批量写入失败: ${err.message}`);
    });
  }, FLUSH_INTERVAL_MS);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const operation = JSON.parse(message.value.toString());
        addToBuffer(operation);
      } catch (err) {
        console.error(`[Kafka] 消息解析失败: ${err.message}`);
      }
    },
  });

  console.log(`[Kafka] Consumer 已启动: topic=${CANVAS_OPERATIONS_TOPIC}, groupId=${GROUP_ID}`);
}

/**
 * 将操作加入缓冲区，并在达到阈值时触发批量保存。
 *
 * @param {object} operation Canvas 操作
 */
function addToBuffer(operation) {
  operationBuffer.push(operation);

  // 达到 500 条时立即批量写入 MongoDB。
  if (operationBuffer.length >= BATCH_SIZE) {
    flushBuffer('batch-size').catch((err) => {
      console.error(`[Kafka] 批量写入失败: ${err.message}`);
    });
  }
}

/**
 * 将缓冲区中的操作批量写入 MongoDB。
 *
 * @param {string} reason 触发刷盘的原因
 */
async function flushBuffer(reason) {
  if (flushing || operationBuffer.length === 0) {
    return;
  }

  flushing = true;
  const batch = operationBuffer;
  operationBuffer = [];

  try {
    // 第一阶段保持简单：消费到的 Kafka 消息直接 insertMany 写入 MongoDB。
    await saveOperations(batch);
    console.log(`[MongoDB] 批量保存完成: count=${batch.length}, reason=${reason}`);
  } catch (err) {
    // 写入失败时把数据放回缓冲区，避免短暂故障导致消息直接丢失。
    operationBuffer = batch.concat(operationBuffer);
    console.error(`[MongoDB] 批量保存失败，已放回缓冲区: count=${batch.length}, reason=${reason}, error=${err.message}`);
  } finally {
    flushing = false;
  }
}

/**
 * 优雅关闭 Kafka Consumer，并在退出前刷入剩余缓冲数据。
 */
async function closeKafkaConsumer() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  await flushBuffer('shutdown');
  await consumer.disconnect();
  console.log('[Kafka] Consumer 已关闭');
}

module.exports = {
  initKafkaConsumer,
  closeKafkaConsumer,
};
