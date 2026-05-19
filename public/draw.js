(function () {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const penBtn = document.getElementById('penBtn');
  const eraserBtn = document.getElementById('eraserBtn');
  const colorPicker = document.getElementById('colorPicker');
  const strokeWidth = document.getElementById('strokeWidth');
  const widthValue = document.getElementById('widthValue');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const wsStatus = document.getElementById('wsStatus');
  const userIdEl = document.getElementById('userId');
  const onlineCountEl = document.getElementById('onlineCount');
  const sequenceIdEl = document.getElementById('sequenceId');
  const currentCanvasLabel = document.getElementById('currentCanvasLabel');

  // 检测当前环境，自动选择 WebSocket 地址
  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.startsWith('192.168.') ||
                      window.location.hostname.startsWith('10.') ||
                      window.location.hostname.startsWith('198.18.');
  
  // HTTPS 页面必须使用 wss://，HTTP 页面使用 ws://
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsBaseUrl = isLocalhost ? 'ws://localhost:3000/ws' : wsProtocol + '//' + window.location.host + '/ws';
  const backgroundColor = '#ffffff';
  const operations = [];
  const undoneKeys = new Set();
  const strokeRenderState = new Map();

  let currentUserId = null;
  let currentCanvasId = null;
  let currentCanvasName = '';
  let latestSequenceId = 0;
  let localSequenceId = Date.now();
  let isDrawing = false;
  let lastPoint = null;
  let collectorStarted = false;

  function buildWsUrl(canvasId) {
    return `${wsBaseUrl}?canvas_id=${encodeURIComponent(canvasId)}`;
  }

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    redrawCanvas();
  }

  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function resetCanvasState() {
    operations.length = 0;
    undoneKeys.clear();
    strokeRenderState.clear();
    latestSequenceId = 0;
    localSequenceId = Date.now();
    isDrawing = false;
    lastPoint = null;
    onlineCountEl.textContent = '0';
    userIdEl.textContent = currentUserId || '-';
    updateSequenceStatus();
    updateUndoRedoButtons();
    clearCanvas();
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function getActiveTool() {
    return collector.getStatus().tool;
  }

  function getDrawStyle(action, color, width) {
    if (action === 'erase') {
      return {
        color: backgroundColor,
        width: Math.max(Number(width) || 1, 1) * 3
      };
    }

    return {
      color: color || '#000000',
      width: Math.max(Number(width) || 1, 1)
    };
  }

  function drawLine(fromPoint, toPoint) {
    const action = getActiveTool() === 'eraser' ? 'erase' : 'stroke';
    const style = getDrawStyle(action, colorPicker.value, strokeWidth.value);

    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(fromPoint.x, fromPoint.y);
    ctx.lineTo(toPoint.x, toPoint.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(point) {
    const action = getActiveTool() === 'eraser' ? 'erase' : 'stroke';
    const style = getDrawStyle(action, colorPicker.value, strokeWidth.value);

    ctx.save();
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(style.width / 2, 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSmoothPoints(points, color, width) {
    if (points.length === 0) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      const point = points[0];
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(width / 2, 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }

  function normalizeOperation(message, options = {}) {
    const points = Array.isArray(message.points)
      ? message.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    const action = message.action || message.msg_type || 'stroke';

    const operation = {
      action: action === 'erase' ? 'erase' : 'stroke',
      canvas_id: message.canvas_id || currentCanvasId,
      stroke_id: message.stroke_id || crypto.randomUUID(),
      points,
      color: message.color || '#000000',
      width: Number(message.width) || 3,
      user_id: message.user_id || currentUserId || 'local',
      timestamp: Number(message.timestamp) || Date.now(),
      sequence_id: Number.isFinite(message.sequence_id) ? message.sequence_id : null,
      local_sequence_id: options.localSequenceId || null,
      local_key: options.localKey || null,
      optimistic: Boolean(options.optimistic)
    };
    
    return operation;
  }

  function getOperationKey(operation) {
    if (Number.isFinite(operation.sequence_id)) {
      return `seq:${operation.sequence_id}`;
    }

    return `local:${operation.local_sequence_id}`;
  }

  function getOperationOrder(operation) {
    if (Number.isFinite(operation.sequence_id)) {
      return operation.sequence_id;
    }

    return operation.local_sequence_id;
  }

  function compareOperations(a, b) {
    return getOperationOrder(a) - getOperationOrder(b);
  }

  function addOperation(operation) {
    if (operation.points.length === 0) return;

    if (Number.isFinite(operation.sequence_id)) {
      latestSequenceId = Math.max(latestSequenceId, operation.sequence_id);
    }

    const duplicateIndex = operations.findIndex((item) => {
      if (operation.local_key && item.local_key === operation.local_key) return true;
      return getOperationKey(item) === getOperationKey(operation);
    });

    if (duplicateIndex >= 0) {
      operations[duplicateIndex] = operation;
    } else {
      operations.push(operation);
    }

    operations.sort(compareOperations);
    updateSequenceStatus();
    updateUndoRedoButtons();
  }

  function drawOperation(operation, stateMap) {
    const style = getDrawStyle(operation.action, operation.color, operation.width);
    const history = stateMap.get(operation.stroke_id) || [];
    const points = history.concat(operation.points);

    drawSmoothPoints(points, style.color, style.width);
    stateMap.set(operation.stroke_id, points.slice(-2));
  }

  function redrawCanvas() {
    console.log('[SyncCanvas] redrawCanvas called, operations.length:', operations.length);
    clearCanvas();
    strokeRenderState.clear();
    
    const visibleOps = operations.filter((operation) => !undoneKeys.has(getOperationKey(operation)));
    console.log('[SyncCanvas] visible operations:', visibleOps.length);
    
    visibleOps
      .sort(compareOperations)
      .forEach((operation) => {
        drawOperation(operation, strokeRenderState);
      });
  }

  function handleLocalSegment(segment) {
    segment.canvas_id = currentCanvasId;

    if (segment.is_preview) {
      return;
    }

    localSequenceId = Math.max(localSequenceId + 1, latestSequenceId + 1, Date.now());
    const localKey = `${segment.stroke_id}:${segment.timestamp}:${localSequenceId}`;
    const operation = normalizeOperation(segment, {
      localSequenceId,
      localKey,
      optimistic: true
    });

    addOperation(operation);
    redrawCanvas();
  }

  function handleRemoteOperation(message) {
    if (message.canvas_id && currentCanvasId && message.canvas_id !== currentCanvasId) {
      return;
    }

    if (message.is_preview) {
      const operation = normalizeOperation(message);
      const lastTwoPoints = operation.points.slice(-2);

      if (lastTwoPoints.length === 2) {
        drawLine(lastTwoPoints[0], lastTwoPoints[1]);
      } else if (lastTwoPoints.length === 1) {
        drawDot(lastTwoPoints[0]);
      }
      return;
    }

    const operation = normalizeOperation(message);

    if (operation.user_id === currentUserId) {
      const pending = operations.find((item) => (
        item.optimistic &&
        item.stroke_id === operation.stroke_id &&
        item.points.length === operation.points.length
      ));

      if (pending) {
        operation.local_key = pending.local_key;
      }
    }

    addOperation(operation);
    redrawCanvas();
  }

  function handleCollectorMessage(rawData) {
    let message;

    try {
      message = JSON.parse(rawData);
    } catch (error) {
      console.warn('[SyncCanvas] 无法解析 WebSocket 消息', error);
      return;
    }

    if (message.type === 'welcome') {
      currentUserId = message.user_id || currentUserId;
      userIdEl.textContent = currentUserId || '-';
      return;
    }

    if (message.type === 'sync_response') {
      console.log('[SyncCanvas] 收到 sync_response:', {
        canvas_id: message.canvas_id,
        operations_count: message.operations?.length || 0,
        latest_sequence_id: message.latest_sequence_id,
        total: message.total
      });

      operations.length = 0;
      undoneKeys.clear();
      strokeRenderState.clear();

      if (Array.isArray(message.operations)) {
        message.operations.forEach((item) => {
          const operation = normalizeOperation(item);
          if (operation.points.length > 0) {
            operations.push(operation);
          }
        });
      }

      console.log('[SyncCanvas] 处理后的 operations:', operations.length);

      operations.sort(compareOperations);
      latestSequenceId = operations.reduce((max, operation) => (
        Math.max(max, Number(operation.sequence_id) || 0)
      ), 0);
      
      console.log('[SyncCanvas] 排序后 latestSequenceId:', latestSequenceId);
      console.log('[SyncCanvas] 即将调用 redrawCanvas');
      
      redrawCanvas();
      updateSequenceStatus();
      updateUndoRedoButtons();
      
      console.log('[SyncCanvas] redrawCanvas 完成');
      return;
    }

    // 处理服务器广播的清空画布消息
    if (message.type === 'clear' || message.action === 'clear' || message.msg_type === 'clear') {
      console.log(`[SyncCanvas] 收到清空画布广播 from ${message.user_id}`);
      operations.length = 0;
      undoneKeys.clear();
      strokeRenderState.clear();
      latestSequenceId = Number(message.sequence_id) || 0;
      redrawCanvas();
      updateSequenceStatus();
      updateUndoRedoButtons();
      return;
    }

    // 处理服务器广播的撤销笔画消息
    if (message.type === 'undo' || message.action === 'undo' || message.msg_type === 'undo') {
      const strokeId = message.stroke_id;
      if (strokeId) {
        console.log(`[SyncCanvas] 收到撤销笔画广播 from ${message.user_id}: ${strokeId}`);
        // 从本地操作列表中移除该笔画
        const index = operations.findIndex((op) => op.stroke_id === strokeId);
        if (index >= 0) {
          operations.splice(index, 1);
        }
        // 重建 undoneKeys，排除被撤销的 stroke_id
        const newUndoneKeys = new Set();
        undoneKeys.forEach((key) => {
          if (!key.includes(strokeId)) {
            newUndoneKeys.add(key);
          }
        });
        undoneKeys.clear();
        newUndoneKeys.forEach((key) => undoneKeys.add(key));

        redrawCanvas();
        updateSequenceStatus();
        updateUndoRedoButtons();
      }
      return;
    }

    if (Number.isFinite(message.online_count)) {
      onlineCountEl.textContent = String(message.online_count);
    }

    if (message.type === 'broadcast' || message.points || message.msg_type || message.action) {
      handleRemoteOperation(message);
    }
  }

  function setActiveTool(tool) {
    collector.setTool(tool);
    penBtn.classList.toggle('active', tool === 'pen');
    eraserBtn.classList.toggle('active', tool === 'eraser');
    canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
  }

  function updateSequenceStatus() {
    sequenceIdEl.textContent = String(latestSequenceId);
  }

  function updateUndoRedoButtons() {
    const hasVisibleOperation = operations.some((operation) => !undoneKeys.has(getOperationKey(operation)));
    undoBtn.disabled = !hasVisibleOperation;
    redoBtn.disabled = undoneKeys.size === 0;
  }

  function undoLastOperation() {
    const visibleOperations = operations
      .filter((operation) => !undoneKeys.has(getOperationKey(operation)))
      .sort(compareOperations);
    const operation = visibleOperations[visibleOperations.length - 1];

    if (!operation) return;

    undoneKeys.add(getOperationKey(operation));
    redrawCanvas();
    updateUndoRedoButtons();
  }

  function redoLastOperation() {
    const undoneOperations = operations
      .filter((operation) => undoneKeys.has(getOperationKey(operation)))
      .sort(compareOperations);
    const operation = undoneOperations[undoneOperations.length - 1];

    if (!operation) return;

    undoneKeys.delete(getOperationKey(operation));
    redrawCanvas();
    updateUndoRedoButtons();
  }

  function openCanvas(canvasId, canvasName) {
    if (!canvasId) return;

    currentCanvasId = canvasId;
    currentCanvasName = canvasName || canvasId;
    currentCanvasLabel.textContent = currentCanvasName;

    if (collectorStarted) {
      collector.stop();
    } else {
      collectorStarted = true;
    }

    resetCanvasState();
    wsStatus.textContent = '连接中';
    wsStatus.className = 'disconnected';

    requestAnimationFrame(() => {
      resizeCanvas();
      collector.start({ wsUrl: buildWsUrl(canvasId), canvasId });
    });
  }

  function disconnectCanvas() {
    if (collectorStarted) {
      collector.stop();
      collectorStarted = false;
    }

    currentCanvasId = null;
    currentCanvasName = '';
    currentCanvasLabel.textContent = '未选择画布';
    resetCanvasState();
    wsStatus.textContent = '未连接';
    wsStatus.className = 'disconnected';
  }

  penBtn.addEventListener('click', () => setActiveTool('pen'));
  eraserBtn.addEventListener('click', () => setActiveTool('eraser'));

  colorPicker.addEventListener('input', (event) => {
    collector.setColor(event.target.value);
  });

  strokeWidth.addEventListener('input', (event) => {
    const width = Number(event.target.value);
    widthValue.textContent = String(width);
    collector.setWidth(width);
  });

  undoBtn.addEventListener('click', () => {
    const visibleOperations = operations
      .filter((operation) => !undoneKeys.has(getOperationKey(operation)))
      .sort(compareOperations);
    const operation = visibleOperations[visibleOperations.length - 1];

    if (!operation) return;

    // 发送撤销消息到服务器
    collector.send({
      type: 'undo',
      canvas_id: currentCanvasId,
      action: 'undo',
      stroke_id: operation.stroke_id,
    });

    // 本地撤销
    undoneKeys.add(getOperationKey(operation));
    redrawCanvas();
    updateUndoRedoButtons();
  });
  redoBtn.addEventListener('click', redoLastOperation);

  clearBtn.addEventListener('click', () => {
    if (operations.length === 0) {
      return; // 画布已空，无需操作
    }

    // 确认清空
    const confirmed = window.confirm('确定要清空画布吗？这将同步清除所有用户的笔画。');
    if (!confirmed) {
      return;
    }

    // 发送清空消息到服务器
    collector.send({
      type: 'clear',
      canvas_id: currentCanvasId,
      action: 'clear',
    });

    // 本地清空
    operations.length = 0;
    undoneKeys.clear();
    latestSequenceId = 0;
    redrawCanvas();
    updateSequenceStatus();
    updateUndoRedoButtons();
  });

  canvas.addEventListener('mousedown', (event) => {
    if (!currentCanvasId) return;
    isDrawing = true;
    lastPoint = getCanvasPoint(event);
    drawDot(lastPoint);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!isDrawing || !lastPoint) return;

    const point = getCanvasPoint(event);
    drawLine(lastPoint, point);
    lastPoint = point;
  });

  canvas.addEventListener('mouseup', () => {
    isDrawing = false;
    lastPoint = null;
  });

  canvas.addEventListener('mouseleave', () => {
    isDrawing = false;
    lastPoint = null;
  });

  collector.on('segment', handleLocalSegment);
  collector.on('message', handleCollectorMessage);
  collector.on('connect', () => {
    wsStatus.textContent = '已连接';
    wsStatus.className = 'connected';
  });
  collector.on('disconnect', () => {
    wsStatus.textContent = '未连接';
    wsStatus.className = 'disconnected';
  });
  collector.on('error', () => {
    wsStatus.textContent = '连接错误';
    wsStatus.className = 'disconnected';
  });

  window.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  setActiveTool('pen');
  collector.setColor(colorPicker.value);
  collector.setWidth(Number(strokeWidth.value));
  updateSequenceStatus();
  updateUndoRedoButtons();

  window.SyncCanvasDraw = {
    openCanvas,
    disconnectCanvas,
    getCurrentCanvasId: () => currentCanvasId,
    getCurrentCanvasName: () => currentCanvasName
  };
}());
