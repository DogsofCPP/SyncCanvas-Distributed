package com.synccanvas.persistence.model;

import java.time.Instant;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonAlias;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * 画布操作模型，对应 MongoDB 中 operations 集合的一条记录。
 */
@Document(collection = "operations")
public class CanvasOperation {

    /**
     * MongoDB 文档主键。
     */
    @Id
    private String id;

    /**
     * 消息类型，例如绘制、撤销或其他操作类型。
     */
    @JsonAlias("msg_type")
    private String msgType;

    /**
     * 操作序列号，用于历史查询时按顺序增量拉取。
     */
    @JsonAlias("sequence_id")
    private Long sequenceId;

    /**
     * 发起操作的用户 ID。
     */
    @JsonAlias("user_id")
    private String userId;

    /**
     * 笔画 ID，用于标识一次完整的绘制轨迹。
     */
    @JsonAlias("stroke_id")
    private String strokeId;

    /**
     * 笔画包含的坐标点数组。
     */
    private List<Point> points;

    /**
     * 笔画颜色。
     */
    private String color;

    /**
     * 笔画宽度。
     */
    private Double width;

    /**
     * 网关传入的业务时间戳。
     */
    private Long timestamp;

    /**
     * 服务写入 MongoDB 的时间。
     */
    private Instant createdAt;

    /**
     * 获取文档主键。
     *
     * @return 文档主键
     */
    public String getId() {
        return id;
    }

    /**
     * 设置文档主键。
     *
     * @param id 文档主键
     */
    public void setId(String id) {
        this.id = id;
    }

    /**
     * 获取消息类型。
     *
     * @return 消息类型
     */
    public String getMsgType() {
        return msgType;
    }

    /**
     * 设置消息类型。
     *
     * @param msgType 消息类型
     */
    public void setMsgType(String msgType) {
        this.msgType = msgType;
    }

    /**
     * 获取操作序列号。
     *
     * @return 操作序列号
     */
    public Long getSequenceId() {
        return sequenceId;
    }

    /**
     * 设置操作序列号。
     *
     * @param sequenceId 操作序列号
     */
    public void setSequenceId(Long sequenceId) {
        this.sequenceId = sequenceId;
    }

    /**
     * 获取用户 ID。
     *
     * @return 用户 ID
     */
    public String getUserId() {
        return userId;
    }

    /**
     * 设置用户 ID。
     *
     * @param userId 用户 ID
     */
    public void setUserId(String userId) {
        this.userId = userId;
    }

    /**
     * 获取笔画 ID。
     *
     * @return 笔画 ID
     */
    public String getStrokeId() {
        return strokeId;
    }

    /**
     * 设置笔画 ID。
     *
     * @param strokeId 笔画 ID
     */
    public void setStrokeId(String strokeId) {
        this.strokeId = strokeId;
    }

    /**
     * 获取笔画点数组。
     *
     * @return 笔画点数组
     */
    public List<Point> getPoints() {
        return points;
    }

    /**
     * 设置笔画点数组。
     *
     * @param points 笔画点数组
     */
    public void setPoints(List<Point> points) {
        this.points = points;
    }

    /**
     * 获取笔画颜色。
     *
     * @return 笔画颜色
     */
    public String getColor() {
        return color;
    }

    /**
     * 设置笔画颜色。
     *
     * @param color 笔画颜色
     */
    public void setColor(String color) {
        this.color = color;
    }

    /**
     * 获取笔画宽度。
     *
     * @return 笔画宽度
     */
    public Double getWidth() {
        return width;
    }

    /**
     * 设置笔画宽度。
     *
     * @param width 笔画宽度
     */
    public void setWidth(Double width) {
        this.width = width;
    }

    /**
     * 获取业务时间戳。
     *
     * @return 业务时间戳
     */
    public Long getTimestamp() {
        return timestamp;
    }

    /**
     * 设置业务时间戳。
     *
     * @param timestamp 业务时间戳
     */
    public void setTimestamp(Long timestamp) {
        this.timestamp = timestamp;
    }

    /**
     * 获取创建时间。
     *
     * @return 创建时间
     */
    public Instant getCreatedAt() {
        return createdAt;
    }

    /**
     * 设置创建时间。
     *
     * @param createdAt 创建时间
     */
    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
