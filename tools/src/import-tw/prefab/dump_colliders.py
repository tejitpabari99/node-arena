#!/usr/bin/env python3
"""Dump Tower War obstacle / building collider data to colliders.json (FROZEN input).

Not reproducible in TS (needs UnityPy on the original Unity bundles), so the output
is committed and treated like the other frozen prefab inputs. Re-run only to refresh.

Run (needs the TW extract + its venv with UnityPy 1.25.4):
  TW_EXTRACT=<tower-war>/_extract \
  <tower-war>/_tools/venv/bin/python -I \
    tools/src/import-tw/prefab/dump_colliders.py [out.json]

TW_EXTRACT's parent is the TW root (bundles live in <root>/base/...). Default out =
colliders.json next to this script. All values are Unity world units, float32 as
dumped (no rounding). Yaw = rotation about +Y in degrees (Unity left-handed, +Y up).
"""
import json
import math
import os
import sys

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '6000.0.82f1'
EXTRACT = os.environ.get('TW_EXTRACT')
if not EXTRACT:
    sys.exit('TW_EXTRACT is not set: point it at the Tower War extract directory (the one containing assets/ and converted/).')
ROOT = os.path.dirname(EXTRACT.rstrip('/'))
AA = ROOT + '/base/assets/aa/Android/'
ASSETS = AA + 'defaultlocalgroup_assets_all_cb16a4f1857519c9c09b930305d4f18b.bundle'
DATA = ROOT + '/base/assets/bin/Data/data.unity3d'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'colliders.json')

OBSTACLE = 'Assets/Addressables/Prefabs/Game/Obstacle.prefab'
BUILDINGS = {  # key -> addressable path
    'Tower': 'Prefabs/Houses/Tower.prefab',
    'House': 'Prefabs/Houses/House (None).prefab',
    'HouseArtillery': 'Prefabs/Houses/HouseArtillery (None).prefab',
    'HouseAttack': 'Prefabs/Houses/House_Attack (None).prefab',
    'SelectableFortess': 'Prefabs/Houses/Fortess/SelectableFortess (None).prefab',
    'CaptureRocketTower': 'Prefabs/Houses/CaptureRocketTower.prefab',
    'BossTower': 'Prefabs/Houses/BossTower.prefab',
    'Trolley': 'Prefabs/Houses/Trolley.prefab',
}
COLLIDERS = ('BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshCollider')

env = UnityPy.load(ASSETS)
BY = {o.path_id: o for o in env.objects}
_cache = {}


def tt(pid):
    if pid not in _cache:
        _cache[pid] = BY[pid].read_typetree()
    return _cache[pid]


def v3(d):
    return [d['x'], d['y'], d['z']]


def yaw_deg(q):  # rotation about +Y, from quaternion x,y,z,w (Unity)
    x, y, z, w = q
    return math.degrees(math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)))


def go_info(go_pid):
    go = tt(go_pid)
    comps = {}
    for c in go['m_Component']:
        pid = c['component']['m_PathID']
        comps.setdefault(BY[pid].type.name, []).append(pid)
    tr = tt(comps['Transform'][0])
    return go, comps, tr


def layer_names():
    e = UnityPy.load(DATA)
    out = {}
    for o in e.objects:
        if o.type.name == 'TagManager':
            out['layers'] = o.read_typetree()['layers']
        if o.type.name == 'PhysicsManager':
            out['matrix'] = o.read_typetree()['m_LayerCollisionMatrix']
    return out


LN = layer_names()
LAYERS = LN['layers']


def collider_rec(ctype, c):
    r = {'type': ctype, 'isTrigger': bool(c['m_IsTrigger']), 'enabled': bool(c['m_Enabled'])}
    if ctype == 'BoxCollider':
        r['size'] = v3(c['m_Size']); r['center'] = v3(c['m_Center'])
    elif ctype == 'SphereCollider':
        r['radius'] = c['m_Radius']; r['center'] = v3(c['m_Center'])
    elif ctype == 'CapsuleCollider':
        r['radius'] = c['m_Radius']; r['height'] = c['m_Height']; r['direction'] = c['m_Direction']; r['center'] = v3(c['m_Center'])
    else:
        r['mesh'] = c.get('m_Mesh')
    return r


def walk(go_pid, chain, path, out):
    """chain = [(scale, pos, quat)] root-first incl. this node; out gets every collider node."""
    go, comps, tr = go_info(go_pid)
    node = (v3(tr['m_LocalScale']), v3(tr['m_LocalPosition']),
            [tr['m_LocalRotation'][k] for k in 'xyzw'] if isinstance(tr['m_LocalRotation'], dict) else tr['m_LocalRotation'])
    chain = chain + [node]
    p = path + [go['m_Name']]
    cols = [(t, collider_rec(t, tt(pid))) for t in COLLIDERS for pid in comps.get(t, [])]
    if cols:
        eff = [1.0, 1.0, 1.0]
        for s, _, _ in chain:
            eff = [a * b for a, b in zip(eff, s)]
        out.append({
            'path': '/'.join(p), 'name': go['m_Name'], 'layer': go['m_Layer'], 'layerName': LAYERS[go['m_Layer']],
            'localScale': node[0], 'localPosition': node[1], 'localYawDeg': yaw_deg(node[2]),
            'effectiveScaleFromRoot': eff,  # product of local scales root..this node
            'colliders': [c for _, c in cols],
        })
    for ch in tr['m_Children']:
        walk(tt(ch['m_PathID'])['m_GameObject']['m_PathID'], chain, p, out)


def containers():
    return {k: v for k, v in env.container.items()}


CT = containers()


def prefab_root(addr):
    for k, v in CT.items():
        if k == addr or k.endswith('/' + addr):
            return v.path_id
    raise SystemExit('missing prefab ' + addr)


def dump_obstacle():
    root = prefab_root(OBSTACLE)
    go, comps, tr = go_info(root)
    oc = tt(comps['MonoBehaviour'][0])
    # allElements = MeshRenderers (index = S[i] / OCP[i] / OCR[i] in level JSON); small/big = MeshFilters
    mr_go = {pid['m_PathID']: tt(pid['m_PathID'])['m_GameObject']['m_PathID'] for pid in oc['allElements']}
    small = {tt(p['m_PathID'])['m_GameObject']['m_PathID'] for p in oc['smallObstacles']}
    big = {tt(p['m_PathID'])['m_GameObject']['m_PathID'] for p in oc['bigObstacles']}
    kids = []
    walk(root, [], [], kids)
    by_go = {}
    for k in kids:
        by_go[k['path']] = k
    children = []
    # map GO pid -> collider record by path walk order
    gopids = {}

    def idx_walk(gp, path):
        g, cs, t = go_info(gp)
        pp = path + [g['m_Name']]
        gopids['/'.join(pp)] = gp
        for ch in t['m_Children']:
            idx_walk(tt(ch['m_PathID'])['m_GameObject']['m_PathID'], pp)
    idx_walk(root, [])
    for i, (mr, gpid) in enumerate(mr_go.items()):
        path = next(p for p, g in gopids.items() if g == gpid)
        rec = by_go[path]
        box = next(c for c in rec['colliders'] if c['type'] == 'BoxCollider')
        sx, _, sz = rec['effectiveScaleFromRoot']
        children.append({
            'index': i, 'name': rec['name'], 'path': rec['path'],
            'variant': 'big' if gpid in big else 'small' if gpid in small else 'unknown',
            'variantBasis': 'GO of child MeshFilter listed in ObstacleContainer.bigObstacles / smallObstacles',
            'layer': rec['layer'], 'layerName': rec['layerName'],
            'localPosition': rec['localPosition'], 'localScale': rec['localScale'], 'yawDeg': rec['localYawDeg'],
            'effectiveScale': rec['effectiveScaleFromRoot'],
            'box': {'size': box['size'], 'center': box['center'], 'isTrigger': box['isTrigger']},
            'footprint': {'w': box['size'][0] * sx, 'd': box['size'][2] * sz,
                          'formula': 'size.x*effScale.x, size.z*effScale.z (child local frame; rotate by yawDeg)'},
        })
    return {'prefab': OBSTACLE, 'rootLayer': go['m_Layer'],
            'indexBasis': 'index = position in ObstacleContainer.allElements = level JSON OCP/OCR/S index',
            'children': children}


def dump_buildings():
    res = {}
    for key, addr in BUILDINGS.items():
        out = []
        walk(prefab_root('Assets/Addressables/' + addr), [], [], out)
        res[key] = {'prefab': 'Assets/Addressables/' + addr, 'colliderNodes': out}
    return res


def layer_matrix():
    m = LN['matrix']
    named = [i for i, n in enumerate(LAYERS) if n]
    pairs = {}
    asym = []
    for a in named:
        for b in named:
            if b < a:
                continue
            ab = (m[a] >> b) & 1
            ba = (m[b] >> a) & 1
            if ab != ba:
                asym.append([LAYERS[a], LAYERS[b]])
            pairs['%s|%s' % (LAYERS[a], LAYERS[b])] = bool(ab and ba)
    return {'layers': {str(i): n for i, n in enumerate(LAYERS) if n}, 'raw': m,
            'rawBasis': 'm_LayerCollisionMatrix[a] bit b = layers a,b collide (symmetric; asymmetric pairs listed)',
            'asymmetricPairs': asym, 'collides': pairs}


def main():
    ob = dump_obstacle()
    bl = dump_buildings()
    lm = layer_matrix()
    house = bl['House']
    bnode = next(n for n in house['colliderNodes'] if n['name'] == 'Building')
    tower = bl['Tower']
    trig = next((n for n in tower['colliderNodes'] if n['name'] == 'TowerRadius'), None)
    reach = {}
    if trig:
        tl = trig['layerName']
        for n in house['colliderNodes']:
            k = '%s|%s' % tuple(sorted([tl, n['layerName']], key=lambda s: LAYERS.index(s)))
            reach[n['name']] = {'layerName': n['layerName'], 'matrixCollides': lm['collides'].get(k)}
    doc = {
        'schema': 'tw-colliders/1', 'frozen': True, 'units': 'Unity world units (float32 as dumped); yaw deg about +Y',
        'source': {'bundle': os.path.basename(ASSETS), 'dataUnity3d': 'bin/Data/data.unity3d (TagManager, PhysicsManager)',
                   'unity': '6000.0.82f1', 'script': 'tools/src/import-tw/prefab/dump_colliders.py'},
        'obstacle': ob,
        'building': {'prefab': house['prefab'], 'collider': bnode},
        'tower': tower,
        'house': house,
        'buildings': bl,
        'towerTriggerVsHouseColliders': {'towerTriggerNode': trig['path'] if trig else None,
                                         'towerTriggerLayer': trig['layerName'] if trig else None, 'byHouseCollider': reach},
        'layerMatrix': lm,
    }
    with open(OUT, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print('wrote', OUT)


main()
