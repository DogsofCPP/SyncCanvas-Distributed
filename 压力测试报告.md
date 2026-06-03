# SyncCanvas 正式压力测试结果

执行时间：2026-05-31；场景二补测时间：2026-06-02  
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
| 高频作画 | 200 | WS `message echo` | 3927 | 0 | 2117/s | 12 ms | 32 ms | 46 ms | 达标 |
| 冷启动历史加载 | 50 | WS `cold start history` | 965 | 0 | 516/s | 80 ms | 145 ms | 188 ms | 达标 |
| 多画布隔离 | 100 | WS `message echo` | 65312 | 0 | 934.13/s | 10 ms | 28 ms | 43 ms | 达标 |



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
| WS connect 请求数 | 200 |
| WS connect 失败数 | 0 |
| WS message echo 请求数 | 113927 |
| WS message echo 失败数 | 0 |
| WS send 请求数 | 124651 |
| WS send 吞吐 | 1964.34/s |
| WS message echo 吞吐 | 1854.32/s |
| WS message echo P50 | 12 ms |
| WS message echo P95 | 32 ms |
| WS message echo P99 | 46 ms |
| 目标 P99 | < 50 ms |
| 结论 | 达标 |


## 场景二：冷启动（加载历史）

执行命令：

```powershell
& 'C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe' -m locust -f locust/locustfile.py --headless --scenario history -u 50 -r 50 -t 60s --stop-timeout 5 --host http://127.0.0.1:3000 --csv locust/results/history_50u_500mps_html_20260602 --html locust/results/history_50u_500mps_html_20260602.html --only-summary
```

结果文件：

```text
locust/results/history_50u_500mps_html_20260602.html
locust/results/history_50u_500mps_html_20260602_stats.csv
locust/results/history_50u_500mps_html_20260602_failures.csv
locust/results/history_50u_500mps_html_20260602_stats_history.csv
```

关键结果：

| 指标 | 结果 |
| --- | ---: |
| cold start history 请求数 | 29965 |
| cold start history 失败数 | 0 |
| cold start history 吞吐 | 516.09/s |
| cold start history 平均延迟 | 65.98 ms |
| cold start history P50 | 80 ms |
| cold start history P95 | 145 ms |
| cold start history P99 | 188 ms |
| 目标 P99 | < 200 ms |
| 结论 | 达标 |

备注：

该场景已于 2026-06-02 重新执行，增加 `--stop-timeout 5` 后 Locust 正常收尾，并成功生成 HTML 报告。

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
| WS message echo 请求数 | 65312 |
| WS message echo 失败数 | 0 |
| WS send 请求数 | 65946 |
| WS send 吞吐 | 1243.82/s |
| WS message echo 吞吐 | 934.13/s |
| WS message echo P50 | 10 ms |
| WS message echo P95 | 28 ms |
| WS message echo P99 | 43 ms |
| 目标 P99 | < 50 ms |
| 结论 | 达标 |

隔离结果：

`multi` 场景未出现 `canvas isolation` 失败，说明本次测试中未观测到跨画布串消息。

## 结论

本次按指定并发规模执行后，三个场景均达到目标 P99。

主要观察：

- 高频作画场景在 200 并发下未出现 WebSocket 连接超时和接收超时。
- 冷启动场景没有失败请求。
- 多画布场景没有隔离错误。
- 单机 Locust 压测端 CPU 超过 90%，建议后续使用 Locust 分布式 worker 或降低单机压力，以区分压测端瓶颈和服务端瓶颈。

建议后续优化方向：

1. 使用 Locust 分布式模式拆分发压端，避免单机 CPU 成为瓶颈。
2. 服务端减少 WebSocket 消息处理中的同步阻塞，重点观察 Redis Pub/Sub、Kafka producer、日志输出和历史加载。
3. 高频作画场景下优先关闭或降级逐条 console 日志，避免日志 I/O 放大延迟。
4. 冷启动场景评估快照命中率、历史操作数量和 `sync_response` 序列化体积。
5. 复测时分别采集服务端 CPU、内存、Redis/Kafka/MongoDB 指标，并与 Locust CSV 对齐分析。
