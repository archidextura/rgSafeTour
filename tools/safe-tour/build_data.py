"""Build services/safe-tour/data/seoul-core.json.

Inputs
  --osm   directory of OpenStreetMap API extracts (*.xml) covering the map area
  --cctv  전국CCTV표준데이터 CSV for Seoul (EUC-KR/CP949 or UTF-8)

Output
  Walkable street graph (metres from LAT0/LON0), background areas, and CCTV
  sites inside the map area, merged by location and purpose.
"""
import argparse, csv, glob, json, math, os, xml.etree.ElementTree as ET

LAT0, LON0 = 37.546, 126.970          # south-west corner of the map area
KX = round(111320 * math.cos(math.radians(37.567)), 2)
KY = 110540
CCTV_BBOX = (37.545, 37.588, 126.969, 127.001)  # lat_min, lat_max, lon_min, lon_max

WALK_CLASS = {  # 0 footpath, 1 steps, 2 alley, 3 local road, 4 arterial
    'footway': 0, 'pedestrian': 0, 'path': 0, 'corridor': 0, 'cycleway': 0,
    'steps': 1,
    'living_street': 2, 'residential': 2, 'service': 2, 'unclassified': 2, 'track': 2,
    'tertiary': 3, 'tertiary_link': 3,
    'secondary': 4, 'secondary_link': 4, 'primary': 4, 'primary_link': 4,
}
PURPOSES = ['생활방범', '어린이보호', '다목적', '시설물관리', '재난재해',
            '쓰레기단속', '차량방범', '기타', '교통단속', '교통정보수집']


def xy(lat, lon):
    return (round((lon - LON0) * KX, 1), round((lat - LAT0) * KY, 1))


def load_osm(folder):
    nodes, ways = {}, {}
    for f in sorted(glob.glob(os.path.join(folder, '*.xml'))):
        root = ET.parse(f).getroot()
        for n in root.iter('node'):
            nodes[int(n.get('id'))] = (float(n.get('lat')), float(n.get('lon')))
        for w in root.iter('way'):
            tags = {t.get('k'): t.get('v') for t in w.findall('tag')}
            ways[int(w.get('id'))] = ([int(nd.get('ref')) for nd in w.findall('nd')], tags)
    return nodes, ways


def walkable(tags):
    h = tags.get('highway')
    if h not in WALK_CLASS:
        return False
    if tags.get('foot') in ('no', 'private'):
        return False
    if tags.get('access') in ('private', 'no') and tags.get('foot') not in ('yes', 'designated'):
        return False
    if h == 'service' and tags.get('service') in ('parking_aisle', 'drive-through'):
        return False
    return True


def build_graph(nodes, ways):
    P = lambda n: xy(*nodes[n])
    lines, use = [], {}
    for nds, tags in ways.values():
        if not walkable(tags):
            continue
        nds = [n for n in nds if n in nodes]
        if len(nds) < 2:
            continue
        lines.append((nds, WALK_CLASS[tags['highway']], tags.get('name', '')))
        for n in nds:
            use[n] = use.get(n, 0) + 1
        use[nds[0]] += 1
        use[nds[-1]] += 1

    index, V, E, names, name_index = {}, [], [], [], {}

    def vid(n):
        if n not in index:
            index[n] = len(V)
            V.append(P(n))
        return index[n]

    for nds, cls, name in lines:
        seg = [nds[0]]
        for n in nds[1:]:
            seg.append(n)
            if use[n] >= 2 or n == nds[-1]:
                a, b = vid(seg[0]), vid(seg[-1])
                if a != b or len(seg) > 2:
                    pts = [P(m) for m in seg[1:-1]]
                    length, prev = 0.0, V[a]
                    for p in pts + [V[b]]:
                        length += math.hypot(p[0] - prev[0], p[1] - prev[1])
                        prev = p
                    if name not in name_index:
                        name_index[name] = len(names)
                        names.append(name)
                    E.append([a, b, int(round(length)), cls, name_index[name],
                              [int(round(c)) for p in pts for c in p]])
                seg = [n]
    return [int(round(c)) for p in V for c in p], E, names


def build_areas(nodes, ways):
    areas, water = [], []
    for nds, t in ways.values():
        nds_in = [n for n in nds if n in nodes]
        if t.get('waterway') in ('stream', 'river', 'canal') and len(nds_in) > 1:
            water.append([int(c) for n in nds_in for c in xy(*nodes[n])])
        kind = None
        if (t.get('leisure') in ('park', 'garden') or t.get('natural') == 'wood'
                or t.get('landuse') in ('forest', 'grass', 'recreation_ground')):
            kind = 'g'
        elif t.get('natural') == 'water' or t.get('waterway') == 'riverbank':
            kind = 'w'
        elif t.get('historic') in ('palace', 'castle') or (t.get('tourism') == 'attraction' and len(nds) > 4):
            kind = 'h'
        if not kind or len(nds) < 4 or nds[0] != nds[-1]:
            continue
        out = []
        for n in nds_in:
            x, y = xy(*nodes[n])
            q = (round(x / 2) * 2, round(y / 2) * 2)   # 2 m grid is plenty for fills
            if not out or out[-1] != q:
                out.append(q)
        if len(out) > 3:
            areas.append([kind, [int(c) for p in out for c in p]])
    return areas, water


def read_csv(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp949'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return list(csv.DictReader(text.splitlines()))


def build_cctv(path):
    rows = read_csv(path)
    lat_min, lat_max, lon_min, lon_max = CCTV_BBOX
    merged = {}
    for r in rows:
        try:
            lat, lon = float(r['WGS84위도']), float(r['WGS84경도'])
        except (KeyError, ValueError):
            continue
        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
            continue
        x, y = xy(lat, lon)
        purpose = r.get('설치목적구분', '').strip()
        p = PURPOSES.index(purpose) if purpose in PURPOSES else PURPOSES.index('기타')
        count = int(r.get('카메라대수') or 1)
        key = (x, y, p)
        if key in merged:
            merged[key][2] += count
            continue
        address = (r.get('소재지도로명주소') or r.get('소재지지번주소') or '').replace('서울특별시 ', '')
        agency = r.get('관리기관명', '').replace('서울특별시 ', '')
        merged[key] = [x, y, count, p, address, r.get('설치연월', ''), agency]
    date = max((r.get('데이터기준일자', '') for r in rows), default='')
    return list(merged.values()), date, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--cctv', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '../../services/safe-tour/data/seoul-core.json'))
    a = ap.parse_args()

    nodes, ways = load_osm(a.osm)
    V, E, names = build_graph(nodes, ways)
    areas, water = build_areas(nodes, ways)
    cams, date, total = build_cctv(a.cctv)
    data = {'lat0': LAT0, 'lon0': LON0, 'kx': KX, 'ky': KY, 'V': V, 'E': E, 'names': names,
            'areas': areas, 'water': water, 'cams': cams, 'purposes': PURPOSES, 'camsDate': date}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'vertices {len(V)//2}  edges {len(E)}  areas {len(areas)}  '
          f'cctv sites {len(cams)} (of {total} rows, {date})  -> {os.path.getsize(a.out):,} bytes')


if __name__ == '__main__':
    main()
