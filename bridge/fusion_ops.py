import json
import os
import tempfile

import adsk.core
import adsk.fusion

_backup = None


def dispatch(method, path, body):
    if method == 'GET' and path == '/health':
        return 200, health()
    if method == 'GET' and path == '/parameters':
        return 200, {'parameters': parameters()}
    if method == 'GET' and path == '/structure':
        return 200, {'nodes': structure()}
    if method == 'POST' and path == '/parameters/apply':
        return apply_parameters(body or {})
    if method == 'POST' and path == '/parameters/restore':
        return restore_parameters()
    if method == 'POST' and path == '/export/mesh3mf':
        return export_mesh(body or {})
    return 404, {'error': '未知路径 {}'.format(path)}


def _design():
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        raise RuntimeError('当前没有打开的设计')
    return app, design


def _version():
    manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'FusionBambuBridge.manifest')
    try:
        with open(manifest_path, 'r', encoding='utf-8') as handle:
            return json.load(handle).get('version', '')
    except Exception:
        return ''


def health():
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct) if app else None
    doc = app.activeDocument if app else None
    return {
        'ok': True,
        'version': _version(),
        'documentName': doc.name if doc else '',
        'hasDesign': design is not None,
    }


def parameters():
    _app, design = _design()
    rows = []
    for index in range(design.userParameters.count):
        param = design.userParameters.item(index)
        if not param.isFavorite:
            continue
        rows.append({
            'name': param.name,
            'expression': param.expression,
            'comment': param.comment or '',
            'unit': param.unit or '',
        })
    return rows


def _suppressed(occurrence):
    try:
        return bool(occurrence.isSuppressed)
    except Exception:
        return False


def _component_node(occurrence, parent_path):
    if not occurrence.isLightBulbOn or _suppressed(occurrence):
        return None
    name = occurrence.name
    path = name if not parent_path else parent_path + '/' + name
    component = occurrence.component
    children = []
    for index in range(component.bRepBodies.count):
        body = component.bRepBodies.item(index)
        if not body.isLightBulbOn:
            continue
        children.append({
            'kind': 'body',
            'name': body.name,
            'componentName': component.name,
            'path': path + '/' + body.name,
            'children': [],
        })
    for index in range(occurrence.childOccurrences.count):
        child = _component_node(occurrence.childOccurrences.item(index), path)
        if child:
            children.append(child)
    return {
        'kind': 'component',
        'name': name,
        'componentName': component.name,
        'path': path,
        'children': children,
    }


def structure():
    _app, design = _design()
    root = design.rootComponent
    nodes = []
    for index in range(root.occurrences.count):
        node = _component_node(root.occurrences.item(index), '')
        if node:
            nodes.append(node)
    if root.bRepBodies.count:
        root_children = []
        for index in range(root.bRepBodies.count):
            body = root.bRepBodies.item(index)
            if not body.isLightBulbOn:
                continue
            root_children.append({
                'kind': 'body',
                'name': body.name,
                'componentName': root.name,
                'path': body.name,
                'children': [],
            })
        if root_children:
            nodes.append({
                'kind': 'component',
                'name': root.name,
                'componentName': root.name,
                'path': root.name,
                'children': root_children,
            })
    return nodes


def apply_parameters(body):
    global _backup
    values = body.get('parameters') or {}
    if not isinstance(values, dict) or not values:
        return 400, {'error': 'parameters 不能为空'}
    _app, design = _design()
    if body.get('backup', True) or _backup is None:
        _backup = {}
        for index in range(design.userParameters.count):
            param = design.userParameters.item(index)
            _backup[param.name] = param.expression
    for name, expression in values.items():
        param = design.userParameters.itemByName(name)
        if not param:
            return 400, {'error': '没有参数 {}'.format(name)}
        param.expression = str(expression)
    adsk.doEvents()
    return 200, {'ok': True}


def restore_parameters():
    global _backup
    if not _backup:
        return 400, {'error': '没有可恢复的参数备份'}
    _app, design = _design()
    for name, expression in _backup.items():
        param = design.userParameters.itemByName(name)
        if param:
            param.expression = expression
    adsk.doEvents()
    _backup = None
    return 200, {'ok': True}


def export_mesh(body):
    _app, design = _design()
    directory = body.get('directory') or tempfile.gettempdir()
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, 'fusion-mesh.3mf')
    if os.path.exists(path):
        os.remove(path)
    options = design.exportManager.createC3MFExportOptions(design.rootComponent, path)
    options.sendToPrintUtility = False
    options.isOneFilePerBody = False
    options.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementMedium
    design.exportManager.execute(options)
    if not os.path.exists(path):
        return 500, {'error': '导出没有生成文件'}
    return 200, {'path': path}
