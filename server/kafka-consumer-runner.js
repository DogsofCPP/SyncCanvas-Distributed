/**
 * Kafka Consumer 独立运行入口
 */
const { initKafkaConsumer, closeKafkaConsumer } = require('./kafka-consumer');

async function main() {
  console.log('[启动] Kafka Consumer 服务...');
  
  try {
    await initKafkaConsumer();
    console.log('[就绪] Kafka Consumer 已启动，等待消息...');
  } catch (err) {
    console.error(`[错误] Kafka Consumer 启动失败: ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('[关闭] 正在关闭 Kafka Consumer...');
  await closeKafkaConsumer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[关闭] 正在关闭 Kafka Consumer...');
  await closeKafkaConsumer();
  process.exit(0);
});

main();
