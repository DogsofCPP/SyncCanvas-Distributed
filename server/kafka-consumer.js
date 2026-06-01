/**
 * Canvas 操作 Kafka Consumer 模块，负责消费 Kafka 消息并批量写入 MongoDB。
 */

const { kafka, CANVAS_OPERATIONS_TOPIC } = require('./kafka-producer');
const { saveStrokesBatch } = require('./mongo-client');

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
 * 被撤销的 stroke_id 集合，用于在批量写入时过滤掉已撤销的笔画。
 * key: stroke_id, value: true
 */
const undoneSet = new Map();

/**
 * undoneSet 的最大容量，防止内存无限增长。
 */
const MAX_UNDONE_SET_SIZE = 10000;

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
  // 如果是 undo 消息，将其对应的 stroke_id 记录到 undoneSet
  const kind = operation.msg_type || operation.action || operation.type;
  if (kind === 'undo' && operation.stroke_id) {
    if (undoneSet.size >= MAX_UNDONE_SET_SIZE) {
      // 达到上限时清空最早的 1000 条
      const keys = Array.from(undoneSet.keys()).slice(0, 1000);
      keys.forEach(k => undoneSet.delete(k));
    }
    undoneSet.set(operation.stroke_id, true);
  }

  // 撤销消息本身不需要写入 MongoDB
  if (kind === 'undo') return;

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

  // 过滤掉已经被撤销的笔画（按 stroke_id 精确匹配）
  const strokeIdsToExclude = new Set(undoneSet.keys());
  const filteredBatch = operationBuffer.filter(op => {
    if (op.stroke_id && strokeIdsToExclude.has(op.stroke_id)) {
      return false;
    }
    return true;
  });

  const excludedCount = operationBuffer.length - filteredBatch.length;
  const batch = filteredBatch;
  operationBuffer = [];

  // 如果全部被过滤掉了，直接跳过写入
  if (batch.length === 0) {
    console.log(`[Kafka] 刷盘跳过（全部被撤销过滤）: excluded=${excludedCount}, reason=${reason}`);
    flushing = false;
    return;
  }

  try {
    const byCanvas = {};
    for (const op of batch) {
      const cid = op.canvas_id || 'default';
      if (!byCanvas[cid]) byCanvas[cid] = [];
      byCanvas[cid].push(op);
    }
    for (const [cid, ops] of Object.entries(byCanvas)) {
      await saveStrokesBatch(ops, cid);
    }
    console.log(`[Kafka] 批量保存完成: count=${batch.length}, excluded=${excludedCount}, reason=${reason}`);
  } catch (err) {
    // 写入失败时把数据放回缓冲区，避免短暂故障导致消息直接丢失。
    operationBuffer = batch.concat(operationBuffer);
    console.error(`[Kafka] 批量保存失败，已放回缓冲区: count=${batch.length}, reason=${reason}, error=${err.message}`);
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
