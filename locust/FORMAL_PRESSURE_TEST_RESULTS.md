# SyncCanvas 正式压力测试结果

执行时间：2026-05-31  
测试地址：`http://127.0.0.1:3000`  
压测脚本：`locust/locustfile.py`  
认证方式：本地生成合法 JWT，每个虚拟用户使用独立 `username` 和 `token`。该方式用于隔离 WebSocket 发包性能，避免把 bcrypt 注册/登录接口作为本次压测瓶颈。

## 测试场景

| 场景 | 并发人数 | 目标每秒消息数 | 目标 P99 |
| --- | ---: | ---: | ---: |
| 场景一：高频作画 | 200 | 2000 | < 50 ms |
| 场景二：冷启动（加载历史） | 50 | 500 | < 200 ms |
| 场景三：多画布隔离 | 100（跨 5 画布） | 1000 | < 50 ms |

## 结果汇总

| 场景 | 实际并发 | 主要指标 | 请求数 | 失败数 | 实际吞吐 | P50 | P95 | P99 | 是否达标 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 高频作画 | 200 | WS `message echo` | 3927 | 0 | 54.32/s | 2600 ms | 5800 ms | 7100 ms | 未达标 |
| 冷启动历史加载 | 50 | WS `cold start history` | 1689 | 0 | 10.22/s | 360 ms | 2000 ms | 2900 ms | 未达标 |
| 多画布隔离 | 100 | WS `message echo` | 15312 | 0 | 234.13/s | 1700 ms | 5100 ms | 6700 ms | 未达标 |

说明：

- 三个场景的业务请求均未达到目标 P99。
- 场景一存在连接与接收失败，整体失败数为 78。
- 场景二 Locust 到达 60 秒后没有自然退出，已手动停止；CSV 统计文件已生成。
- 场景三没有请求失败，但 P99 和吞吐均未达到目标。
- Locust 在场景一和场景三中提示本机 CPU 使用率超过 90%，单机压测端可能限制了实际发压能力，结果应理解为“当前本机单进程 Locust + 当前服务部署”的测量结果。

## 场景一：高频作画

执行命令：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless --scenario draw -u 200 -r 50 -t 60s --host http://127.0.0.1:3000 --csv locust/results/draw_200u_2000mps_rerun --html locust/results/draw_200u_2000mps_rerun.html --only-summary
```

结果文件：

```text
locust/results/draw_200u_2000mps_rerun.html
locust/results/draw_200u_2000mps_rerun_stats.csv
locust/results/draw_200u_2000mps_rerun_failures.csv
```

关键结果：

| 指标 | 结果 |
| --- | ---: |
| WS connect 请求数 | 185 |
| WS connect 失败数 | 44 |
| WS message echo 请求数 | 3927 |
| WS message echo 失败数 | 0 |
| WS send 请求数 | 4651 |
| WS send 吞吐 | 64.34/s |
| WS message echo 吞吐 | 54.32/s |
| WS message echo P50 | 2600 ms |
| WS message echo P95 | 5800 ms |
| WS message echo P99 | 7100 ms |
| 目标 P99 | < 50 ms |
| 结论 | 未达标 |

失败明细：

| 类型 | 次数 |
| --- | ---: |
| `WS connect: TimeoutError('timed out')` | 29 |
| `WS connect: WebSocketTimeoutException('Connection timed out')` | 15 |
| `WS receive: WebSocketTimeoutException('Connection timed out')` | 34 |

## 场景二：冷启动（加载历史）

执行命令：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless --scenario history -u 50 -r 50 -t 60s --host http://127.0.0.1:3000 --csv locust/results/history_50u_500mps_rerun --html locust/results/history_50u_500mps_rerun.html --only-summary
```

结果文件：

```text
locust/results/history_50u_500mps_rerun_stats.csv
locust/results/history_50u_500mps_rerun_failures.csv
```

关键结果：

| 指标 | 结果 |
| --- | ---: |
| cold start history 请求数 | 1689 |
| cold start history 失败数 | 0 |
| cold start history 吞吐 | 10.22/s |
| cold start history 平均延迟 | 651.87 ms |
| cold start history P50 | 360 ms |
| cold start history P95 | 2000 ms |
| cold start history P99 | 2900 ms |
| 目标 P99 | < 200 ms |
| 结论 | 未达标 |

备注：

该场景达到运行时间后 Locust 未自然退出，已手动停止。已生成 CSV 统计文件，但未生成 HTML 报告。

## 场景三：多画布隔离

执行命令：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless --scenario multi -u 100 -r 50 -t 60s --host http://127.0.0.1:3000 --csv locust/results/multi_100u_1000mps_rerun --html locust/results/multi_100u_1000mps_rerun.html --only-summary
```

结果文件：

```text
locust/results/multi_100u_1000mps_rerun.html
locust/results/multi_100u_1000mps_rerun_stats.csv
locust/results/multi_100u_1000mps_rerun_failures.csv
```

关键结果：

| 指标 | 结果 |
| --- | ---: |
| WS connect 请求数 | 100 |
| WS connect 失败数 | 0 |
| WS message echo 请求数 | 15312 |
| WS message echo 失败数 | 0 |
| WS send 请求数 | 15946 |
| WS send 吞吐 | 243.82/s |
| WS message echo 吞吐 | 234.13/s |
| WS message echo P50 | 1700 ms |
| WS message echo P95 | 5100 ms |
| WS message echo P99 | 6700 ms |
| 目标 P99 | < 50 ms |
| 结论 | 未达标 |

隔离结果：

`multi` 场景未出现 `canvas isolation` 失败，说明本次测试中未观测到跨画布串消息。

## 结论

本次按指定并发规模执行后，三个场景均未达到目标 P99，且实际吞吐远低于目标消息数。

主要观察：

- 高频作画场景在 200 并发下出现 WebSocket 连接超时和接收超时。
- 冷启动场景没有失败请求，但历史加载延迟明显高于目标。
- 多画布场景没有隔离错误，但延迟和吞吐未达标。
- 单机 Locust 压测端 CPU 超过 90%，建议后续使用 Locust 分布式 worker 或降低单机压力，以区分压测端瓶颈和服务端瓶颈。

建议后续优化方向：

1. 使用 Locust 分布式模式拆分发压端，避免单机 CPU 成为瓶颈。
2. 服务端减少 WebSocket 消息处理中的同步阻塞，重点观察 Redis Pub/Sub、Kafka producer、日志输出和历史加载。
3. 高频作画场景下优先关闭或降级逐条 console 日志，避免日志 I/O 放大延迟。
4. 冷启动场景评估快照命中率、历史操作数量和 `sync_response` 序列化体积。
5. 复测时分别采集服务端 CPU、内存、Redis/Kafka/MongoDB 指标，并与 Locust CSV 对齐分析。
