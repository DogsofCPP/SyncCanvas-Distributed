package com.synccanvas.persistence.model;

/**
 * 画笔轨迹点模型，表示一次绘画操作中的单个坐标点。
 */
public class Point {

    /**
     * 点的横坐标。
     */
    private Double x;

    /**
     * 点的纵坐标。
     */
    private Double y;

    /**
     * 点产生时的时间戳或相对时间。
     */
    private Long t;

    /**
     * 获取点的横坐标。
     *
     * @return 横坐标
     */
    public Double getX() {
        return x;
    }

    /**
     * 设置点的横坐标。
     *
     * @param x 横坐标
     */
    public void setX(Double x) {
        this.x = x;
    }

    /**
     * 获取点的纵坐标。
     *
     * @return 纵坐标
     */
    public Double getY() {
        return y;
    }

    /**
     * 设置点的纵坐标。
     *
     * @param y 纵坐标
     */
    public void setY(Double y) {
        this.y = y;
    }

    /**
     * 获取点产生时的时间。
     *
     * @return 时间戳或相对时间
     */
    public Long getT() {
        return t;
    }

    /**
     * 设置点产生时的时间。
     *
     * @param t 时间戳或相对时间
     */
    public void setT(Long t) {
        this.t = t;
    }
}
