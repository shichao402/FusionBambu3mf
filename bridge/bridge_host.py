import json
import queue
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import adsk.core

import fusion_ops

EVENT_ID = 'FusionBambuBridge_Event'
PORT = 17890

_queue = queue.Queue()
_httpd = None
_thread = None
_custom_event = None
_handler = None


class _ExecHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        while True:
            try:
                item = _queue.get_nowait()
            except queue.Empty:
                return
            method, path, body, done, box = item
            try:
                status, payload = fusion_ops.dispatch(method, path, body)
                box['status'] = status
                box['payload'] = payload
            except Exception:
                box['status'] = 500
                box['payload'] = {'error': traceback.format_exc()}
            finally:
                done.set()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, format, *args):
        return

    def _origin(self):
        origin = self.headers.get('Origin') or ''
        allowed = (
            'http://127.0.0.1:17890',
            'http://localhost:17890',
            'http://localhost:1420',
            'http://127.0.0.1:1420',
            'tauri://localhost',
            'http://tauri.localhost',
        )
        return origin if origin in allowed else allowed[0]

    def _send(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', self._origin())
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        self._dispatch('GET', None)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0') or '0')
        raw = self.rfile.read(length) if length else b''
        body = None
        if raw:
            try:
                body = json.loads(raw.decode('utf-8'))
            except Exception:
                self._send(400, {'error': '请求体不是 JSON'})
                return
        self._dispatch('POST', body)

    def _dispatch(self, method, body):
        path = self.path.split('?', 1)[0]
        done = threading.Event()
        box = {}
        _queue.put((method, path, body, done, box))
        try:
            adsk.core.Application.get().fireCustomEvent(EVENT_ID, '')
        except Exception:
            self._send(500, {'error': traceback.format_exc()})
            return
        if not done.wait(180):
            self._send(504, {'error': 'Fusion 主线程超时'})
            return
        self._send(box.get('status', 500), box.get('payload', {'error': '无结果'}))


def _drain_queue():
    while True:
        try:
            item = _queue.get_nowait()
        except queue.Empty:
            return
        done = item[3]
        box = item[4]
        box['status'] = 503
        box['payload'] = {'error': '桥已停止'}
        done.set()


def start(handlers):
    global _httpd, _thread, _custom_event, _handler
    stop()
    app = adsk.core.Application.get()
    _custom_event = app.registerCustomEvent(EVENT_ID)
    _handler = _ExecHandler()
    _custom_event.add(_handler)
    handlers.append(_handler)

    ThreadingHTTPServer.allow_reuse_address = True
    _httpd = ThreadingHTTPServer(('127.0.0.1', PORT), _Handler)
    _thread = threading.Thread(target=_httpd.serve_forever, name='FusionBambuBridgeHttp', daemon=True)
    _thread.start()


def stop():
    global _httpd, _thread, _custom_event, _handler
    server = _httpd
    thread = _thread
    _httpd = None
    _thread = None
    if server:
        try:
            server.shutdown()
        except Exception:
            pass
        try:
            server.server_close()
        except Exception:
            pass
    if thread and thread is not threading.current_thread():
        thread.join(timeout=5)
    _drain_queue()
    if _custom_event and _handler:
        try:
            _custom_event.remove(_handler)
        except Exception:
            pass
    _handler = None
    _custom_event = None
    try:
        adsk.core.Application.get().unregisterCustomEvent(EVENT_ID)
    except Exception:
        pass
