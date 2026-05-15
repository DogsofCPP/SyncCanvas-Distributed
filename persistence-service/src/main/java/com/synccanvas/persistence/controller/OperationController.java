package com.synccanvas.persistence.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.synccanvas.persistence.model.CanvasOperation;
import com.synccanvas.persistence.repository.CanvasOperationRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 画布操作接口控制器，提供历史查询和健康检查能力。
 */
@RestController
public class OperationController {

    /**
     * 默认查询数量。
     */
    private static final int DEFAULT_LIMIT = 1000;

    /**
     * 最大查询数量，避免一次拉取过多数据。
     */
    private static final int MAX_LIMIT = 5000;

    /**
     * 画布操作仓库，用于读取 MongoDB 中的历史操作。
     */
    private final CanvasOperationRepository canvasOperationRepository;

    /**
     * 构造接口控制器并注入仓库。
     *
     * @param canvasOperationRepository 画布操作仓库
     */
    public OperationController(CanvasOperationRepository canvasOperationRepository) {
        this.canvasOperationRepository = canvasOperationRepository;
    }

    /**
     * 查询指定 sequenceId 之后的历史操作。
     *
     * @param from 起始 sequenceId，只返回大于该值的数据
     * @param limit 返回数量限制，默认 1000，最大 5000
     * @return 统一格式的历史操作响应
     */
    @GetMapping("/api/v1/operations")
    public ApiResponse<Map<String, Object>> getOperations(
            @RequestParam(defaultValue = "0") Long from,
            @RequestParam(defaultValue = "1000") Integer limit) {
        int safeLimit = normalizeLimit(limit);

        // 使用 Repository 方法完成 sequenceId 过滤、升序排序和数量限制。
        List<CanvasOperation> operations = canvasOperationRepository
                .findBySequenceIdGreaterThanOrderBySequenceIdAsc(from, PageRequest.of(0, safeLimit));

        Map<String, Object> data = new HashMap<>();
        data.put("from", from);
        data.put("limit", safeLimit);
        data.put("count", operations.size());
        data.put("operations", operations);

        return ApiResponse.ok(data);
    }

    /**
     * 健康检查接口，用于确认 persistence-service 正在运行。
     *
     * @return 统一格式的健康检查响应
     */
    @GetMapping("/api/v1/health")
    public ApiResponse<String> health() {
        return ApiResponse.ok("persistence-service is running");
    }

    /**
     * 规范化 limit 参数，保证默认值和最大值符合接口约定。
     *
     * @param limit 用户传入的 limit
     * @return 规范化后的 limit
     */
    private int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    /**
     * 统一接口响应结构。
     *
     * @param <T> data 字段的数据类型
     */
    public static class ApiResponse<T> {

        /**
         * 业务状态码，0 表示成功。
         */
        private Integer code;

        /**
         * 响应消息。
         */
        private String message;

        /**
         * 响应数据。
         */
        private T data;

        /**
         * 创建成功响应。
         *
         * @param data 响应数据
         * @param <T> 响应数据类型
         * @return 成功响应对象
         */
        public static <T> ApiResponse<T> ok(T data) {
            ApiResponse<T> response = new ApiResponse<>();
            response.setCode(0);
            response.setMessage("ok");
            response.setData(data);
            return response;
        }

        /**
         * 获取业务状态码。
         *
         * @return 业务状态码
         */
        public Integer getCode() {
            return code;
        }

        /**
         * 设置业务状态码。
         *
         * @param code 业务状态码
         */
        public void setCode(Integer code) {
            this.code = code;
        }

        /**
         * 获取响应消息。
         *
         * @return 响应消息
         */
        public String getMessage() {
            return message;
        }

        /**
         * 设置响应消息。
         *
         * @param message 响应消息
         */
        public void setMessage(String message) {
            this.message = message;
        }

        /**
         * 获取响应数据。
         *
         * @return 响应数据
         */
        public T getData() {
            return data;
        }

        /**
         * 设置响应数据。
         *
         * @param data 响应数据
         */
        public void setData(T data) {
            this.data = data;
        }
    }
}
