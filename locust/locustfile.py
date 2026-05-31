"""
Locust load tests for SyncCanvas.

Scenarios:
  draw     - 200 users, 2000 WS drawing messages/s, target P99 < 50 ms
  history  - 50 users, 500 cold-start history loads/s, target P99 < 200 ms
  multi    - 100 users across 5 canvases, 1000 WS messages/s, target P99 < 50 ms

Install:
  python -m pip install locust websocket-client

Examples:
  locust -f locust/locustfile.py --headless --scenario draw -u 200 -r 50 -t 60s --host http://localhost:3000
  locust -f locust/locustfile.py --headless --scenario history -u 50 -r 50 -t 60s --host http://localhost:3000
  locust -f locust/locustfile.py --headless --scenario multi -u 100 -r 50 -t 60s --host http://localhost:3000

Optional:
  --canvas-ids canvas-a,canvas-b
  --message-rate 10
  --history-timeout 5
  --token <jwt>              Reuse one token. Prefer generated tokens for real concurrency.
  --auth-mode generated      Use generated JWTs by default for load tests.
  --jwt-secret <secret>      JWT secret used by the server.
  --auth-prefix bench        Username prefix for generated test users.
  --auth-password password   Password for generated test users.
"""

import base64
import hashlib
import hmac
import json
import random
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Optional
from urllib.parse import quote, urlparse

import gevent
import websocket
from locust import HttpUser, events, task
from locust.exception import StopUser


DEFAULT_CANVAS_IDS = [
    "canvas-load-test-001",
    "canvas-load-test-002",
    "canvas-load-test-003",
    "canvas-load-test-004",
    "canvas-load-test-005",
]

SCENARIOS = {
    "draw": {
        "users": 200,
        "message_rate": 10.0,
        "total_rate": 2000,
        "target_p99_ms": 50,
        "canvas_count": 1,
    },
    "history": {
        "users": 50,
        "message_rate": 10.0,
        "total_rate": 500,
        "target_p99_ms": 200,
        "canvas_count": 1,
    },
    "multi": {
        "users": 100,
        "message_rate": 10.0,
        "total_rate": 1000,
        "target_p99_ms": 50,
        "canvas_count": 5,
    },
}

COLORS = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#2563eb",
    "#7c3aed",
    "#db2777",
]
WIDTHS = [1, 2, 3, 5, 8, 13]


@dataclass
class WsRequest:
    start_perf: float
    canvas_id: str


def now_ms() -> int:
    return int(time.time() * 1000)


def elapsed_ms(start_perf: float) -> float:
    return (time.perf_counter() - start_perf) * 1000


def scenario_options(environment):
    opts = environment.parsed_options
    scenario_name = getattr(opts, "scenario", "draw")
    scenario = SCENARIOS[scenario_name]
    canvas_ids = [
        item.strip()
        for item in getattr(opts, "canvas_ids", ",".join(DEFAULT_CANVAS_IDS)).split(",")
        if item.strip()
    ]
    canvas_ids = canvas_ids[: scenario["canvas_count"]]
    if not canvas_ids:
        canvas_ids = DEFAULT_CANVAS_IDS[: scenario["canvas_count"]]

    message_rate = getattr(opts, "message_rate", None) or scenario["message_rate"]
    return opts, scenario_name, scenario, canvas_ids, float(message_rate)


def http_to_ws(host: str) -> str:
    parsed = urlparse(host)
    if parsed.scheme == "https":
        scheme = "wss"
    else:
        scheme = "ws"
    netloc = parsed.netloc or parsed.path
    return f"{scheme}://{netloc}"


def make_points(count: Optional[int] = None):
    point_count = count or random.randint(2, 8)
    base = now_ms()
    x = random.uniform(80, 1800)
    y = random.uniform(80, 1000)
    return [
        {
            "x": max(0, min(1920, x + random.uniform(-30, 30) * i)),
            "y": max(0, min(1080, y + random.uniform(-30, 30) * i)),
            "t": base + i * 8,
        }
        for i in range(point_count)
    ]


def make_stroke(canvas_id: str, user_tag: str):
    return {
        "action": "stroke",
        "canvas_id": canvas_id,
        "stroke_id": f"locust-{user_tag}-{uuid.uuid4().hex}",
        "points": make_points(),
        "color": random.choice(COLORS),
        "width": random.choice(WIDTHS),
        "timestamp": now_ms(),
    }


def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def make_jwt(secret: str, username: str, user_id: str, ttl_seconds: int = 7 * 24 * 60 * 60) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "username": username,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    signing_input = ".".join(
        [
            base64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            base64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{base64url(signature)}"


def request_success(environment, request_type: str, name: str, response_time: float, response_length: int = 0):
    environment.events.request.fire(
        request_type=request_type,
        name=name,
        response_time=response_time,
        response_length=response_length,
        exception=None,
    )


def request_failure(environment, request_type: str, name: str, response_time: float, exception: Exception):
    environment.events.request.fire(
        request_type=request_type,
        name=name,
        response_time=response_time,
        response_length=0,
        exception=exception,
    )


@events.init_command_line_parser.add_listener
def add_cli_options(parser):
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS.keys()),
        default="draw",
        help="Load test scenario: draw, history, or multi.",
    )
    parser.add_argument(
        "--canvas-ids",
        default=",".join(DEFAULT_CANVAS_IDS),
        help="Comma-separated canvas IDs used by the test.",
    )
    parser.add_argument(
        "--message-rate",
        type=float,
        default=None,
        help="Per-user messages/cold-starts per second. Defaults to the selected scenario target.",
    )
    parser.add_argument(
        "--history-timeout",
        type=float,
        default=5.0,
        help="Seconds to wait for sync_response in the cold-start scenario.",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="JWT token to put in the WS URL. Auto-register/login is used when omitted.",
    )
    parser.add_argument(
        "--auth-mode",
        choices=("generated", "api"),
        default="generated",
        help="Use generated JWTs or call /api/v1/auth/register + /login. Defaults to generated for load tests.",
    )
    parser.add_argument(
        "--jwt-secret",
        default="synccanvas-secret-key-change-in-production",
        help="JWT secret used when --auth-mode=generated.",
    )
    parser.add_argument(
        "--auth-prefix",
        default="bench",
        help="Generated username prefix for auto-register/login.",
    )
    parser.add_argument(
        "--auth-password",
        default="bench-password",
        help="Password for generated load-test users.",
    )


class SyncCanvasUser(HttpUser):
    wait_time = lambda self: 1

    def on_start(self):
        self.ws = None
        self.reader_greenlet = None
        self.sender_greenlet = None
        self.pending: Dict[str, WsRequest] = {}
        self.closed = False

        opts, scenario_name, scenario, canvas_ids, message_rate = scenario_options(self.environment)
        self.opts = opts
        self.scenario_name = scenario_name
        self.scenario = scenario
        self.canvas_ids = canvas_ids
        self.message_interval = 1.0 / message_rate if message_rate > 0 else 0.1
        self.user_tag = uuid.uuid4().hex[:10]
        self.username = f"{opts.auth_prefix}_{self.user_tag}"
        self.password = opts.auth_password
        self.user_id = f"user-{self.user_tag}"
        self.token = opts.token or self.get_token()
        if not self.token:
            raise StopUser("No token available for WebSocket load test")

        self.canvas_id = self.pick_canvas()

        if self.scenario_name in ("draw", "multi"):
            self.connect_ws(self.canvas_id)
            self.sender_greenlet = gevent.spawn(self.send_loop)

    def get_token(self) -> Optional[str]:
        if self.opts.auth_mode == "generated":
            return make_jwt(self.opts.jwt_secret, self.username, self.user_id)
        return self.login_or_register()

    def on_stop(self):
        self.closed = True
        if self.sender_greenlet is not None:
            self.sender_greenlet.kill(block=False)
        if self.reader_greenlet is not None:
            self.reader_greenlet.kill(block=False)
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass

    def login_or_register(self) -> Optional[str]:
        payload = {"username": self.username, "password": self.password}

        with self.client.post(
            "/api/v1/auth/register",
            json=payload,
            name="/api/v1/auth/register",
            catch_response=True,
            timeout=3,
        ) as response:
            if response.status_code in (201, 409):
                response.success()
            else:
                response.failure(f"register failed: {response.status_code} {response.text[:120]}")
                return None

        with self.client.post(
            "/api/v1/auth/login",
            json=payload,
            name="/api/v1/auth/login",
            catch_response=True,
            timeout=3,
        ) as response:
            if response.status_code != 200:
                response.failure(f"login failed: {response.status_code} {response.text[:120]}")
                return None
            try:
                data = response.json()
                token = data["data"]["token"]
            except Exception as exc:
                response.failure(f"login response missing token: {exc}")
                return None
            response.success()
            return token

    def pick_canvas(self) -> str:
        if self.scenario_name == "multi":
            index = int(self.user_tag[:6], 16) % len(self.canvas_ids)
            return self.canvas_ids[index]
        return self.canvas_ids[0]

    def ws_url(self, canvas_id: str) -> str:
        base = http_to_ws(self.host)
        return f"{base}/ws?canvas_id={quote(canvas_id)}&token={quote(self.token)}"

    def connect_ws(self, canvas_id: str):
        start = time.perf_counter()
        url = self.ws_url(canvas_id)
        try:
            self.ws = websocket.create_connection(url, timeout=5)
            request_success(self.environment, "WS", "connect", elapsed_ms(start))
            self.reader_greenlet = gevent.spawn(self.read_loop)
        except Exception as exc:
            request_failure(self.environment, "WS", "connect", elapsed_ms(start), exc)
            raise StopUser(str(exc))

    def read_loop(self):
        while not self.closed and self.ws is not None:
            try:
                raw = self.ws.recv()
            except Exception as exc:
                if not self.closed:
                    request_failure(self.environment, "WS", "receive", 0, exc)
                return

            try:
                message = json.loads(raw)
            except Exception:
                continue

            if message.get("type") == "welcome":
                continue

            stroke_id = message.get("stroke_id")
            if stroke_id and stroke_id in self.pending:
                pending = self.pending.pop(stroke_id)
                name = "message echo"
                request_success(self.environment, "WS", name, elapsed_ms(pending.start_perf), len(raw))

            if self.scenario_name == "multi" and message.get("canvas_id") not in (None, self.canvas_id):
                request_failure(
                    self.environment,
                    "WS",
                    "canvas isolation",
                    0,
                    AssertionError(f"received {message.get('canvas_id')} while joined to {self.canvas_id}"),
                )

    def send_loop(self):
        next_tick = time.perf_counter()
        while not self.closed:
            next_tick += self.message_interval
            self.send_stroke()
            gevent.sleep(max(0, next_tick - time.perf_counter()))

    def send_stroke(self):
        if self.ws is None:
            return
        message = make_stroke(self.canvas_id, self.user_tag)
        stroke_id = message["stroke_id"]
        start = time.perf_counter()
        try:
            self.pending[stroke_id] = WsRequest(start_perf=start, canvas_id=self.canvas_id)
            self.ws.send(json.dumps(message, separators=(",", ":")))
            request_success(self.environment, "WS", "send", elapsed_ms(start), len(message["points"]))
        except Exception as exc:
            self.pending.pop(stroke_id, None)
            request_failure(self.environment, "WS", "send", elapsed_ms(start), exc)

    @task
    def run_history_cold_start(self):
        if self.scenario_name != "history":
            gevent.sleep(1)
            return

        canvas_id = self.canvas_ids[0]
        start = time.perf_counter()
        ws = None
        try:
            ws = websocket.create_connection(self.ws_url(canvas_id), timeout=self.opts.history_timeout)
            while elapsed_ms(start) < self.opts.history_timeout * 1000:
                raw = ws.recv()
                message = json.loads(raw)
                if message.get("type") == "sync_response":
                    request_success(
                        self.environment,
                        "WS",
                        "cold start history",
                        elapsed_ms(start),
                        len(message.get("operations", [])),
                    )
                    return
                if message.get("type") == "welcome":
                    continue
            raise TimeoutError("sync_response not received")
        except Exception as exc:
            request_failure(self.environment, "WS", "cold start history", elapsed_ms(start), exc)
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass
            gevent.sleep(self.message_interval)


@events.test_start.add_listener
def on_test_start(environment, **_kwargs):
    opts, scenario_name, scenario, canvas_ids, message_rate = scenario_options(environment)
    print("\n" + "=" * 72)
    print("SyncCanvas Locust load test")
    print(f"  scenario:        {scenario_name}")
    print(f"  expected users:  {scenario['users']}")
    print(f"  per-user rate:   {message_rate:.2f}/s")
    print(f"  target rate:     {scenario['total_rate']}/s")
    print(f"  target P99:      < {scenario['target_p99_ms']} ms")
    print(f"  canvas_ids:      {', '.join(canvas_ids)}")
    token_mode = "single supplied token" if opts.token else opts.auth_mode
    print(f"  token mode:      {token_mode}")
    print("=" * 72 + "\n")


@events.test_stop.add_listener
def on_test_stop(environment, **_kwargs):
    _opts, scenario_name, scenario, _canvas_ids, _message_rate = scenario_options(environment)
    stats = environment.stats.get("message echo" if scenario_name != "history" else "cold start history", "WS")
    if not stats or stats.num_requests == 0:
        print("\nNo primary WS latency samples were collected.")
        return

    p99 = stats.get_response_time_percentile(0.99)
    target = scenario["target_p99_ms"]
    status = "PASS" if p99 < target else "FAIL"
    print("\n" + "=" * 72)
    print(f"Primary P99: {p99:.2f} ms, target < {target} ms [{status}]")
    print("=" * 72 + "\n")
