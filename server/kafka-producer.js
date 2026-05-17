/**
 * Canvas 操作 Kafka Producer 模块，负责把网关收到的绘画消息发送到 Kafka。
 */

const { Kafka } = require('kafkajs');

/**
 * Kafka 默认 Broker 地址。
 */
const DEFAULT_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';

/**
 * Canvas 操作固定发送的 Topic。
 */
const CANVAS_OPERATIONS_TOPIC = 'canvas-operations';

/**
 * 全局 Kafka 实例，Producer 和 Consumer 可以共用相同 Broker 配置。
 */
const kafka = new Kafka({
  clientId: 'synccanvas-gateway',
  brokers: [DEFAULT_BROKER],
});

/**
 * Canvas 操作 Kafka Producer 类，封装连接、发送和关闭逻辑。
 */
class KafkaCanvasProducer {
  /**
   * 创建 Kafka Producer 实例。
   */
  constructor() {
    this.producer = kafka.producer();
    this.connected = false;
  }

  /**
   * 初始化 Kafka Producer 连接。
   */
  async init() {
    if (this.connected) {
      return;
    }

    // 服务启动时建立 Kafka 连接，后续 WebSocket 消息可以直接发送。
    await this.producer.connect();
    this.connected = true;
    console.log(`[Kafka] Producer 已连接: ${DEFAULT_BROKER}`);
  }

  /**
   * 发送一条 Canvas 操作消息到 Kafka。
   *
   * @param {object} operation 完整的画布操作对象
   */
  async send(operation) {
    if (!this.connected) {
      throw new Error('Kafka Producer 尚未初始化');
    }

    // Kafka 消息 value 使用 JSON 字符串，方便 Consumer 直接解析后写入 MongoDB。
    await this.producer.send({
      topic: CANVAS_OPERATIONS_TOPIC,
      messages: [
        {
          key: String(operation.sequence_id),
          value: JSON.stringify(operation),
        },
      ],
    });
  }

  /**
   * 关闭 Kafka Producer 连接。
   */
  async close() {
    if (!this.connected) {
      return;
    }

    await this.producer.disconnect();
    this.connected = false;
    console.log('[Kafka] Producer 已关闭');
  }
}

/**
 * 全局 Kafka Producer 实例，供网关入口复用。
 */
const kafkaCanvasProducer = new KafkaCanvasProducer();

/**
 * 初始化 Kafka Producer。
 */
async function initKafkaProducer() {
  await kafkaCanvasProducer.init();
}

/**
 * 发送 Canvas 操作到 Kafka。
 *
 * @param {object} operation 完整的画布操作对象
 */
async function sendCanvasOperation(operation) {
  await kafkaCanvasProducer.send(operation);
}

/**
 * 优雅关闭 Kafka Producer。
 */
async function closeKafkaProducer() {
  await kafkaCanvasProducer.close();
}

module.exports = {
  CANVAS_OPERATIONS_TOPIC,
  DEFAULT_BROKER,
  kafka,
  initKafkaProducer,
  sendCanvasOperation,
  closeKafkaProducer,
};
