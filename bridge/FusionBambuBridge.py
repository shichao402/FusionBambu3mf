import os
import sys
import traceback

import adsk.core

_handlers = []


def _bridge_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _purge_submodules():
    here = os.path.abspath(_bridge_dir())
    if here not in sys.path:
        sys.path.insert(0, here)
    entry = os.path.abspath(__file__)
    doomed = []
    for name, module in list(sys.modules.items()):
        path = getattr(module, '__file__', None)
        if not path:
            continue
        path = os.path.abspath(path)
        if path.startswith(here) and path != entry:
            doomed.append(name)
    for name in doomed:
        del sys.modules[name]


def run(_context):
    try:
        host = sys.modules.get('bridge_host')
        if host:
            try:
                host.stop()
            except Exception:
                pass
        _handlers.clear()
        _purge_submodules()
        import bridge_host
        bridge_host.start(_handlers)
    except Exception:
        app = adsk.core.Application.get()
        ui = app.userInterface if app else None
        if ui:
            ui.messageBox('FusionBambuBridge 启动失败:\n{}'.format(traceback.format_exc()))


def stop(_context):
    host = sys.modules.get('bridge_host')
    if host:
        try:
            host.stop()
        except Exception:
            pass
    _handlers.clear()
    _purge_submodules()
