# SyncCanvas Locust 压力测试说明

本 Locust 脚本使用真实 WebSocket 连接进行压测。每个虚拟用户都会携带 `token` 和 `canvas_id` 连接到服务端：

```text
ws://<host>/ws?canvas_id=<canvas_id>&token=<jwt>
```

Smoke test 结果和环境说明见 [`PRESSURE_TEST_REPORT.md`](./PRESSURE_TEST_REPORT.md)。正式压测复测结果见 [`FORMAL_PRESSURE_TEST_RESULTS.md`](./FORMAL_PRESSURE_TEST_RESULTS.md)。

## 安装依赖

```bash
python -m pip install locust websocket-client
```

也可以直接使用本目录下的依赖文件：

```bash
python -m pip install -r locust/requirements.txt
```

如果 Windows 终端中的 `python` 仍指向 WindowsApps 占位程序，可以使用本机已安装的 Python 绝对路径：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m pip install -r locust/requirements.txt
```

## 启动服务

```bash
docker compose up -d
node server/index.js
```

如果需要测试“冷启动历史加载”并覆盖 MongoDB 持久化历史，请同时启动持久化相关服务。

## 场景一：高频作画

目标：200 并发用户，2000 条消息/秒，P99 < 50 ms。

Windows PowerShell：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless ^
  --scenario draw ^
  -u 200 -r 50 -t 60s ^
  --host http://127.0.0.1:3000
```

Linux/macOS：

```bash
locust -f locust/locustfile.py --headless \
  --scenario draw \
  -u 200 -r 50 -t 60s \
  --host http://localhost:3000
```

## 场景二：冷启动历史加载

目标：50 并发用户，500 次冷启动历史加载/秒，P99 < 200 ms。

服务端只有在画布存在历史记录时才会发送 `sync_response`，因此建议在执行本场景前先向目标画布写入一些笔画数据。

Windows PowerShell：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless ^
  --scenario history ^
  -u 50 -r 50 -t 60s ^
  --host http://127.0.0.1:3000
```

Linux/macOS：

```bash
locust -f locust/locustfile.py --headless \
  --scenario history \
  -u 50 -r 50 -t 60s \
  --host http://localhost:3000
```

## 场景三：多画布隔离

目标：100 并发用户，跨 5 个画布，1000 条消息/秒，P99 < 50 ms。

Windows PowerShell：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless ^
  --scenario multi ^
  --canvas-ids canvas-load-test-001,canvas-load-test-002,canvas-load-test-003,canvas-load-test-004,canvas-load-test-005 ^
  -u 100 -r 50 -t 60s ^
  --host http://127.0.0.1:3000
```

Linux/macOS：

```bash
locust -f locust/locustfile.py --headless \
  --scenario multi \
  --canvas-ids canvas-load-test-001,canvas-load-test-002,canvas-load-test-003,canvas-load-test-004,canvas-load-test-005 \
  -u 100 -r 50 -t 60s \
  --host http://localhost:3000
```

## 速率控制

默认每个虚拟用户的速率为 10 次/秒，因此在指定并发数下会形成以下目标总速率：

| 场景 | 并发用户数 | 单用户速率 | 目标总速率 | 目标 P99 |
| --- | ---: | ---: | ---: | ---: |
| `draw` | 200 | 10/s | 2000/s | < 50 ms |
| `history` | 50 | 10/s | 500/s | < 200 ms |
| `multi` | 100 | 10/s | 1000/s | < 50 ms |

可以通过 `--message-rate` 覆盖单用户速率，例如：

```bash
locust -f locust/locustfile.py --headless --scenario draw --message-rate 5 -u 200 -r 50 -t 60s --host http://localhost:3000
```

## 认证选项

脚本默认使用 `--auth-mode generated`，即本地生成合法 JWT。这样可以避免把 bcrypt 注册/登录接口作为压测瓶颈，更适合测试 WebSocket 发包、广播和历史加载链路。

如果需要测试真实注册/登录链路，可以显式使用：

```bash
locust -f locust/locustfile.py --headless --scenario draw --auth-mode api -u 10 -r 2 -t 30s --host http://localhost:3000
```

也可以通过 `--token` 传入已有 JWT。但多个并发用户共用同一个 token 时，会共享同一个 username，不建议用于真实并发验证。

如果服务端修改了 JWT 密钥，请通过 `--jwt-secret` 保持一致：

```bash
locust -f locust/locustfile.py --headless --scenario draw --jwt-secret your-secret -u 200 -r 50 -t 60s --host http://localhost:3000
```

## 输出报告

建议正式压测时导出 CSV 和 HTML 报告：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless ^
  --scenario draw ^
  -u 200 -r 50 -t 60s ^
  --host http://127.0.0.1:3000 ^
  --csv locust/results/draw_200u_2000mps ^
  --html locust/results/draw_200u_2000mps.html
```

常用结果文件：

```text
*_stats.csv
*_stats_history.csv
*_failures.csv
*.html
```
