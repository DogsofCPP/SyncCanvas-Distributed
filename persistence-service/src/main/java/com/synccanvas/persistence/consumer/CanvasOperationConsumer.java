package com.synccanvas.persistence.consumer;

import java.util.ArrayList;
import java.util.List;
import java.time.Instant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.synccanvas.persistence.model.CanvasOperation;
import com.synccanvas.persistence.repository.CanvasOperationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 画布操作 Kafka 消费者，负责接收网关发送的绘画操作消息。
 */
@Component
public class CanvasOperationConsumer {

    /**
     * 日志对象，用于记录消费和持久化过程。
     */
    private static final Logger log = LoggerFactory.getLogger(CanvasOperationConsumer.class);

    /**
     * 批量写入阈值，缓冲区达到该数量后立即批量保存。
     */
    private static final int BATCH_SIZE = 500;

    /**
     * JSON 解析器，用于将 Kafka 消息转换为 Java 对象。
     */
    private final ObjectMapper objectMapper;

    /**
     * 画布操作仓库，用于将操作写入 MongoDB。
     */
    private final CanvasOperationRepository canvasOperationRepository;

    /**
     * 内存缓冲区，用于暂存尚未写入 MongoDB 的画布操作。
     */
    private final List<CanvasOperation> operationBuffer = new ArrayList<>();

    /**
     * 构造 Kafka 消费者并注入依赖。
     *
     * @param objectMapper JSON 解析器
     * @param canvasOperationRepository 画布操作仓库
     */
    public CanvasOperationConsumer(ObjectMapper objectMapper, CanvasOperationRepository canvasOperationRepository) {
        this.objectMapper = objectMapper;
        this.canvasOperationRepository = canvasOperationRepository;
    }

    /**
     * 监听 canvas-operations Topic，将消息解析后放入内存缓冲区。
     *
     * @param message Kafka 中的原始 JSON 消息
     */
    @KafkaListener(topics = "${app.kafka.topic}", groupId = "persistence-service")
    public void consume(String message) {
        try {
            // 每收到一条 Kafka 消息，先使用 Jackson 解析为 CanvasOperation 对象。
            CanvasOperation operation = objectMapper.readValue(message, CanvasOperation.class);
            if (operation.getCreatedAt() == null) {
                operation.setCreatedAt(Instant.now());
            }

            addToBuffer(operation);
        } catch (Exception ex) {
            // 解析失败时先记录错误，避免服务静默失败。
            log.error("画布操作解析失败，message={}", message, ex);
        }
    }

    /**
     * 将画布操作加入缓冲区，并在达到批量阈值时触发批量保存。
     *
     * @param operation 画布操作
     */
    private void addToBuffer(CanvasOperation operation) {
        boolean shouldFlush;

        // Kafka 消费线程和定时任务可能同时访问缓冲区，因此这里使用 synchronized 保证线程安全。
        synchronized (operationBuffer) {
            operationBuffer.add(operation);
            shouldFlush = operationBuffer.size() >= BATCH_SIZE;
        }

        if (shouldFlush) {
            flushBuffer("batch-size");
        }
    }

    /**
     * 每隔 1 秒检查一次缓冲区，如果有待保存数据就批量写入 MongoDB。
     */
    @Scheduled(fixedRate = 1000)
    public void flushBufferBySchedule() {
        flushBuffer("schedule");
    }

    /**
     * 将缓冲区中的数据复制出来并使用 saveAll 批量保存。
     *
     * @param reason 触发批量保存的原因
     */
    private void flushBuffer(String reason) {
        List<CanvasOperation> batch;

        // 只在复制和清空缓冲区时持有锁，减少 Kafka 消费线程等待时间。
        synchronized (operationBuffer) {
            if (operationBuffer.isEmpty()) {
                return;
            }

            batch = new ArrayList<>(operationBuffer);
            operationBuffer.clear();
        }

        try {
            // 第一阶段微批处理：直接调用 Spring Data MongoDB 的 saveAll 批量保存。
            canvasOperationRepository.saveAll(batch);
            log.info("画布操作批量持久化完成，count={}，reason={}", batch.size(), reason);
        } catch (Exception ex) {
            log.error("画布操作批量持久化失败，count={}，reason={}", batch.size(), reason, ex);
        }
    }
}
