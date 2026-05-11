/**
 * SyncCanvas 输入采集器
 * 第 1 天产出物 - 50ms 定时采集点，输出到控制台
 *
 * 使用方式: 将此脚本引入 index.html 或在控制台运行
 *
 * TODO: 第 2-4 天整合到 index.html，发送 WebSocket 消息
 */

class StrokeCollector {
  constructor() {
    // 当前笔画状态
    this.isDrawing = false;
    this.currentStrokeId = null;
    this.currentPoints = [];
    this.currentTool = 'pen';
    this.currentColor = '#ffffff';
    this.currentWidth = 3;

    // 50ms 定时器 ID
    this.timerId = null;

    // 回调函数
    this.onSegmentReady = null; // (segment) => void
  }

  /**
   * 开始采集
   * @param {Object} options 配置选项
   * @param {Function} options.onSegmentReady 片段就绪回调
   */
  start(options = {}) {
    this.onSegmentReady = options.onSegmentReady || null;

    // 启动 50ms 定时器
    this.timerId = setInterval(() => {
      this.flush();
    }, 50);

    // 绑定鼠标事件
    this.bindEvents();

    console.log('[Collector] 输入采集器已启动 (50ms 采样)');
  }

  /**
   * 停止采集
   */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.unbindEvents();
    console.log('[Collector] 输入采集器已停止');
  }

  /**
   * 设置工具类型
   */
  setTool(tool) {
    this.currentTool = tool;
  }

  /**
   * 设置颜色
   */
  setColor(color) {
    this.currentColor = color;
  }

  /**
   * 设置线条宽度
   */
  setWidth(width) {
    this.currentWidth = width;
  }

  /**
   * 绑定鼠标事件
   */
  bindEvents() {
    this._onMouseDown = this.handleMouseDown.bind(this);
    this._onMouseMove = this.handleMouseMove.bind(this);
    this._onMouseUp = this.handleMouseUp.bind(this);

    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  /**
   * 解绑鼠标事件
   */
  unbindEvents() {
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  /**
   * 鼠标按下 - 开始新笔画
   */
  handleMouseDown(e) {
    // 忽略工具栏点击
    if (e.target.closest('#toolbar')) return;

    this.isDrawing = true;
    this.currentStrokeId = crypto.randomUUID();
    this.currentPoints = [{
      x: e.clientX,
      y: e.clientY,
      t: Date.now()
    }];

    console.log('[Collector] 笔画开始:', this.currentStrokeId);
  }

  /**
   * 鼠标移动 - 记录点
   */
  handleMouseMove(e) {
    if (!this.isDrawing) return;

    this.currentPoints.push({
      x: e.clientX,
      y: e.clientY,
      t: Date.now()
    });
  }

  /**
   * 鼠标抬起 - 结束笔画
   */
  handleMouseUp() {
    if (!this.isDrawing) return;

    this.isDrawing = false;

    // 发送最后一批点
    if (this.currentPoints.length > 0) {
      this.emitSegment();
    }

    console.log('[Collector] 笔画结束:', this.currentStrokeId);
    this.currentStrokeId = null;
    this.currentPoints = [];
  }

  /**
   * 定时器触发 - 发送累积的点
   */
  flush() {
    if (!this.isDrawing || this.currentPoints.length === 0) {
      return;
    }

    this.emitSegment();
  }

  /**
   * 发送片段
   */
  emitSegment() {
    if (this.currentPoints.length === 0) return;

    const segment = {
      action: this.currentTool === 'eraser' ? 'erase' : 'stroke',
      stroke_id: this.currentStrokeId,
      points: [...this.currentPoints], // 复制数组
      color: this.currentColor,
      width: this.currentWidth
    };

    // 清空当前点
    this.currentPoints = [];

    // 输出到控制台
    console.log('[Collector] 发送片段:', JSON.stringify(segment, null, 2));

    // 调用回调
    if (this.onSegmentReady) {
      this.onSegmentReady(segment);
    }
  }

  /**
   * 获取当前状态（调试用）
   */
  getStatus() {
    return {
      isDrawing: this.isDrawing,
      strokeId: this.currentStrokeId,
      pointsCount: this.currentPoints.length,
      tool: this.currentTool,
      color: this.currentColor,
      width: this.currentWidth
    };
  }
}

// ==================== 全局实例 ====================
const collector = new StrokeCollector();

// 自动启动（控制台测试用）
// collector.start();

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StrokeCollector, collector };
}

console.log('[Collector] 模块已加载');
console.log('[Collector] 使用 collector.start() 开始采集');
console.log('[Collector] 使用 collector.stop() 停止采集');
console.log('[Collector] 使用 collector.setTool("pen"|"eraser") 切换工具');
console.log('[Collector] 使用 collector.setColor("#fff") 设置颜色');
console.log('[Collector] 使用 collector.setWidth(3) 设置宽度');
console.log('[Collector] 使用 collector.getStatus() 查看状态');
