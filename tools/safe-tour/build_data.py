"""Build the Safe Tour data set for all of Seoul.

Inputs
  --pbf   OpenStreetMap extract covering Seoul (e.g. BBBike "Seoul.osm.pbf")
  --cctv  전국CCTV표준데이터 CSV for Seoul (EUC-KR/CP949 or UTF-8)

Output (services/safe-tour/data/)
  index.json        projection, tile size, list of tiles, CCTV purposes, data dates
  places.json       tourist destinations (named, notable OSM features) with their 구
  districts.json    Seoul's 25 구 with simplified boundaries
  areas-large.json  big parks, mountains and the Han river, simplified
  tiles/<i>_<j>.json  walking graph, small areas and CCTV sites for one tile

Coordinates are metres east/north of (LAT0, LON0). Graph vertices carry a global id so
edges from neighbouring tiles join up when the client loads several tiles.
"""
import argparse, csv, json, math, os, shutil
import osmium

# Seoul (Special City) bounding box, a little generous
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 37.41, 37.72, 126.73, 127.27
LAT0, LON0 = LAT_MIN, LON_MIN
KX = round(111320 * math.cos(math.radians(37.56)), 2)
KY = 110540
TILE = 2000  # metres

WALK_CLASS = {  # 0 footpath, 1 steps, 2 alley, 3 local road, 4 arterial
    'footway': 0, 'pedestrian': 0, 'path': 0, 'corridor': 0, 'cycleway': 0, 'bridleway': 0,
    'steps': 1,
    'living_street': 2, 'residential': 2, 'service': 2, 'unclassified': 2, 'track': 2,
    'tertiary': 3, 'tertiary_link': 3,
    'secondary': 4, 'secondary_link': 4, 'primary': 4, 'primary_link': 4,
}
PURPOSES = ['생활방범', '어린이보호', '다목적', '시설물관리', '재난재해',
            '쓰레기단속', '차량방범', '기타', '교통단속', '교통정보수집']

# Destination categories: (label, test on tags)
PLACE_KINDS = [
    ('궁궐·유적', lambda t: t.get('historic') in ('palace', 'castle', 'city_gate', 'archaeological_site', 'fort', 'tomb', 'temple')),
    ('박물관', lambda t: t.get('tourism') == 'museum'),
    ('미술관', lambda t: t.get('tourism') == 'gallery' or t.get('amenity') == 'arts_centre'),
    ('전망·명소', lambda t: t.get('tourism') in ('viewpoint', 'attraction', 'theme_park', 'zoo', 'aquarium')),
    ('사찰·성당', lambda t: t.get('amenity') == 'place_of_worship' and t.get('building') not in (None, 'yes') or t.get('amenity') == 'place_of_worship' and 'wikidata' in t),
    ('시장', lambda t: t.get('amenity') == 'marketplace'),
    ('공원', lambda t: t.get('leisure') in ('park', 'garden')),
]

# Well-known districts and landmarks that OSM does not tag as attractions.
# OSM name -> (name shown in the app, category). Matched by exact name, any element type.
CURATED = {
    '명동': ('명동', '거리·동네'), '인사동': ('인사동', '거리·동네'), '익선동 한옥마을 Ikseondong': ('익선동 한옥거리', '거리·동네'),
    '홍대거리': ('홍대 거리', '거리·동네'), '이태원': ('이태원', '거리·동네'), '경리단길': ('경리단길', '거리·동네'),
    '가로수길': ('가로수길', '거리·동네'), '성수동1가': ('성수동', '거리·동네'), '대학로': ('대학로', '거리·동네'),
    '연남동': ('연남동', '거리·동네'), '압구정로데오': ('압구정로데오', '거리·동네'), '신촌': ('신촌', '거리·동네'),
    '이화벽화마을': ('이화벽화마을', '거리·동네'), '동대문디자인플라자': ('동대문디자인플라자(DDP)', '전망·명소'),
    '63스퀘어': ('63스퀘어', '전망·명소'), '서울로 7017': ('서울로7017', '전망·명소'), '청계광장': ('청계광장', '전망·명소'),
    '별마당 도서관': ('별마당 도서관', '전망·명소'), '청와대': ('청와대', '궁궐·유적'), '국회의사당': ('국회의사당', '전망·명소'),
    '더현대 서울': ('더현대 서울', '전망·명소'), '북악 팔각정': ('북악팔각정', '전망·명소'),
    '낙산공원': ('낙산공원', '공원'), '노들섬': ('노들섬', '공원'), '여의도한강공원': ('여의도한강공원', '공원'),
    '뚝섬한강공원': ('뚝섬한강공원', '공원'), '망원한강공원': ('망원한강공원', '공원'), '경의선숲길공원': ('경의선숲길', '공원'),
    '인왕산': ('인왕산', '공원'), '서울함공원': ('서울함공원', '공원'),
    '노량진수산시장': ('노량진수산시장', '시장'), '망원시장': ('망원시장', '시장'),
    '은평한옥마을': ('은평한옥마을', '거리·동네'), '샤로수길': ('샤로수길', '거리·동네'),
    '선유도공원': ('선유도공원', '공원'), '석촌호수': ('석촌호수', '공원'), '불광천': ('불광천', '공원'),
    '금천체육공원': ('금천체육공원', '공원'), '서울창포원': ('서울창포원', '공원'), '홍릉수목원': ('홍릉수목원', '공원'),
    '길동생태공원': ('길동생태공원', '공원'), '천호공원': ('천호공원', '공원'), '관악산': ('관악산', '공원'),
    '도봉산': ('도봉산', '공원'), '수락산': ('수락산', '공원'), '불암산': ('불암산', '공원'),
    '호압사': ('호압사', '사찰·성당'), '길상사': ('길상사', '사찰·성당'), '4.19민주묘지': ('국립4·19민주묘지', '궁궐·유적'),
    '양천향교': ('양천향교', '궁궐·유적'), '세종대왕기념관': ('세종대왕기념관', '박물관'),
    '고척스카이돔': ('고척스카이돔', '전망·명소'), '마장축산물시장': ('마장축산물시장', '시장'),
}

SEOUL_GU = ['종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구',
            '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구',
            '관악구', '서초구', '강남구', '송파구', '강동구']


def inside(lat, lon):
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def xy(lat, lon):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def walkable(t):
    h = t.get('highway')
    if h not in WALK_CLASS:
        return False
    if t.get('foot') in ('no', 'private') or t.get('area') == 'yes' and h != 'pedestrian':
        return False
    if t.get('access') in ('private', 'no') and t.get('foot') not in ('yes', 'designated', 'permissive'):
        return False
    if h == 'service' and t.get('service') in ('parking_aisle', 'drive-through'):
        return False
    return True


def area_kind(t):
    if t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('water'):
        return 'w'
    if (t.get('leisure') in ('park', 'garden', 'nature_reserve') or t.get('natural') in ('wood', 'scrub', 'heath')
            or t.get('landuse') in ('forest', 'grass', 'recreation_ground', 'meadow')):
        return 'g'
    if t.get('historic') in ('palace', 'castle', 'archaeological_site') or t.get('tourism') == 'attraction':
        return 'h'
    return None


MINOR = ('/', '안내', '어린이공원', '쉼터', '화장실', '놀이터', '주차장', '정류장', '입구', '출구', '소공원', '쌈지공원',
         '산책로', '오거리', '사거리', '센터', '키즈', '수영장')
MIN_PER_GU = 8      # top up 구 with few notable places from the candidates below


def place_kind(t, notable=True):
    """Category label for a destination. notable=True requires a wikidata link."""
    if 'name' not in t or (notable and 'wikidata' not in t):
        return None
    if not notable and any(m in t['name'] for m in MINOR):
        return None
    for label, test in PLACE_KINDS:
        try:
            if test(t):
                return label
        except Exception:
            pass
    return None


def rdp(pts, eps):
    """Ramer–Douglas–Peucker simplification of a list of (x, y)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(r, eps):
    """Simplify a closed ring: split at the point farthest from the start, simplify both halves."""
    if r and r[0] == r[-1]:
        r = r[:-1]
    if len(r) < 4:
        return r
    far = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
    return rdp(r[:far + 1], eps)[:-1] + rdp(r[far:] + [r[0]], eps)[:-1]


def ring_area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []        # (node ids, coords, class, name)
        self.areas = []       # (kind, [rings]) rings as lists of (x, y)
        self.places = {}      # name -> (kind, x, y, size)
        self.districts = {}   # 구 name -> [rings]
        self.extra = {}       # name -> (kind, x, y, score, en): candidates without wikidata

    def _place(self, t, x, y, size=0):
        cur = CURATED.get(t.get('name'))
        if cur:
            name, kind = cur
        else:
            name, kind = t.get('name:ko') or t.get('name'), place_kind(t)
        if not kind:
            kind = place_kind(t, notable=False)
            if kind:
                # rank: museums/attractions/markets first, then by area (parks)
                base = {'박물관': 3, '미술관': 2, '전망·명소': 3, '시장': 3, '궁궐·유적': 2, '공원': 0, '사찰·성당': 1}.get(kind, 0)
                if kind == '공원' and size < 20000:
                    return
                score = base + min(size / 100000, 5)
                prev = self.extra.get(name)
                if prev is None or score > prev[3]:
                    self.extra[name] = (kind, x, y, score, t.get('name:en', ''))
            return
        prev = self.places.get(name)
        if prev is None or size > prev[3]:
            self.places[name] = (kind, x, y, size, t.get('name:en', ''))

    def node(self, n):
        if not n.tags or not n.location.valid() or not inside(n.location.lat, n.location.lon):
            return
        t = {k: v for k, v in n.tags}
        x, y = xy(n.location.lat, n.location.lon)
        self._place(t, x, y)

    def _curated_line(self, t, coords):
        # streets such as 가로수길 are mapped as named ways
        if t.get('name') in CURATED and coords:
            mid = coords[len(coords) // 2]
            self._place(t, mid[0], mid[1], 1)

    def way(self, w):
        t = {k: v for k, v in w.tags}
        if t.get('name') in CURATED and 'highway' in t:
            try:
                self._curated_line(t, [xy(nd.location.lat, nd.location.lon) for nd in w.nodes])
            except osmium.InvalidLocationError:
                pass
        if not walkable(t):
            return
        try:
            locs = [(nd.ref, nd.location.lat, nd.location.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(locs) < 2 or not any(inside(la, lo) for _, la, lo in locs):
            return
        self.ways.append(([r for r, _, _ in locs], [xy(la, lo) for _, la, lo in locs],
                          WALK_CLASS[t['highway']], t.get('name', '')))

    def area(self, a):
        t = {k: v for k, v in a.tags}
        if t.get('boundary') == 'administrative' and t.get('admin_level') == '6' and t.get('name') in SEOUL_GU:
            try:
                rings = [[xy(n.lat, n.lon) for n in outer] for outer in a.outer_rings()]
            except osmium.InvalidLocationError:
                return
            # Seoul's 중구 shares its name with other cities' 중구: keep the one inside Seoul
            if rings and all(0 < p[0] < (LON_MAX - LON0) * KX and 0 < p[1] < (LAT_MAX - LAT0) * KY for p in rings[0][:20]):
                prev = self.districts.get(t['name'])
                if prev is None or sum(map(ring_area, rings)) > sum(map(ring_area, prev)):
                    self.districts[t['name']] = rings
            return
        kind = area_kind(t)
        is_place = place_kind(t) or t.get('name') in CURATED
        if not kind and not is_place:
            return
        rings = []
        try:
            for outer in a.outer_rings():
                r = [xy(n.lat, n.lon) for n in outer]
                if len(r) > 3:
                    rings.append(r)
        except osmium.InvalidLocationError:
            return
        if not rings:
            return
        big = max(rings, key=ring_area)
        size = ring_area(big)
        if is_place or place_kind(t, notable=False):
            cx = sum(p[0] for p in big) / len(big)
            cy = sum(p[1] for p in big) / len(big)
            if 0 <= cx <= (LON_MAX - LON0) * KX and 0 <= cy <= (LAT_MAX - LAT0) * KY:
                self._place(t, cx, cy, size)
        if kind and size >= 400:
            self.areas.append((kind, rings, size))


def build_graph(ways):
    use = {}
    for ids, _, _, _ in ways:
        for n in ids:
            use[n] = use.get(n, 0) + 1
        use[ids[0]] += 1
        use[ids[-1]] += 1
    gid, gxy = {}, []

    def vid(n, p):
        if n not in gid:
            gid[n] = len(gxy)
            gxy.append(p)
        return gid[n]

    edges = []   # (a, b, length, class, name, inner points)
    for ids, pts, cls, name in ways:
        s = 0
        for k in range(1, len(ids)):
            if use[ids[k]] >= 2 or k == len(ids) - 1:
                seg = pts[s:k + 1]
                if k - s >= 1 and not (ids[s] == ids[k] and k - s < 2):
                    L = sum(math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]) for i in range(1, len(seg)))
                    a, b = vid(ids[s], pts[s]), vid(ids[k], pts[k])
                    inner = rdp(seg, 1.0)[1:-1]
                    edges.append((a, b, L, cls, name, inner))
                s = k
    return gxy, edges


def read_cctv(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp949'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    rows = list(csv.DictReader(text.splitlines()))
    merged = {}
    for r in rows:
        try:
            lat, lon = float(r['WGS84위도']), float(r['WGS84경도'])
        except (KeyError, ValueError):
            continue
        if not inside(lat, lon):
            continue
        x, y = xy(lat, lon)
        x, y = round(x, 1), round(y, 1)
        purpose = (r.get('설치목적구분') or '').strip()
        p = PURPOSES.index(purpose) if purpose in PURPOSES else PURPOSES.index('기타')
        n = int(r.get('카메라대수') or 1)
        key = (x, y, p)
        if key in merged:
            merged[key][2] += n
            continue
        addr = (r.get('소재지도로명주소') or r.get('소재지지번주소') or '').replace('서울특별시 ', '')
        agency = (r.get('관리기관명') or '').replace('서울특별시 ', '')
        merged[key] = [x, y, n, p, addr, r.get('설치연월', ''), agency]
    date = max((r.get('데이터기준일자', '') for r in rows), default='')
    return list(merged.values()), date, len(rows)


def point_in_rings(x, y, rings):
    hit = False
    for r in rings:
        j = len(r) - 1
        for i in range(len(r)):
            (xi, yi), (xj, yj) = r[i], r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def tile_of(x, y):
    return (int(x // TILE), int(y // TILE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--cctv', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../services/safe-tour/data'))
    a = ap.parse_args()

    h = Collect()
    h.apply_file(a.pbf, locations=True)
    gxy, edges = build_graph(h.ways)
    cams, cams_date, cams_rows = read_cctv(a.cctv)

    tiles = {}

    def T(key):
        if key not in tiles:
            tiles[key] = {'v': {}, 'e': [], 'names': {}, 'a': [], 'c': []}
        return tiles[key]

    for ea, eb, L, cls, name, inner in edges:
        mx, my = (gxy[ea][0] + gxy[eb][0]) / 2, (gxy[ea][1] + gxy[eb][1]) / 2
        t = T(tile_of(mx, my))
        for v in (ea, eb):
            t['v'][v] = gxy[v]
        if name not in t['names']:
            t['names'][name] = len(t['names'])
        t['e'].append([ea, eb, round(L, 1), cls, t['names'][name], [round(c) for p in inner for c in p]])

    large = []
    for kind, rings, size in h.areas:
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        span = max(max(xs) - min(xs), max(ys) - min(ys))
        if span > TILE:
            simp = [simplify_ring(r, 8) for r in rings]
            large.append([kind, [[round(c) for p in r for c in p] for r in simp if len(r) > 3]])
        else:
            simp = [simplify_ring(r, 2) for r in rings]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            T(tile_of(cx, cy))['a'].append([kind, [[round(c) for p in r for c in p] for r in simp if len(r) > 3]])

    for c in cams:
        T(tile_of(c[0], c[1]))['c'].append(c)

    missing = [g for g in SEOUL_GU if g not in h.districts]
    if missing:
        raise SystemExit('district boundaries not found: ' + ', '.join(missing))
    # places: [name, category, x, y, english name, 구]; places outside Seoul are dropped
    places = []
    for name, (kind, x, y, size, en) in sorted(h.places.items()):
        gu = next((g for g in SEOUL_GU if point_in_rings(x, y, h.districts[g])), None)
        if gu:
            places.append([name, kind, round(x), round(y), en, gu])
    taken = {p[0] for p in places}
    by_gu = {}
    for name, (kind, x, y, score, en) in h.extra.items():
        if name in taken:
            continue
        gu = next((g for g in SEOUL_GU if point_in_rings(x, y, h.districts[g])), None)
        if gu:
            by_gu.setdefault(gu, []).append((score, name, kind, x, y, en))
    for gu, cands in by_gu.items():
        have = sum(1 for p in places if p[5] == gu)
        for score, name, kind, x, y, en in sorted(cands, reverse=True)[:max(0, MIN_PER_GU - have)]:
            places.append([name, kind, round(x), round(y), en, gu])
    places.sort()
    districts = []
    for g in SEOUL_GU:
        rings = h.districts[g]
        big = max(rings, key=ring_area)
        cx = sum(p[0] for p in big) / len(big)
        cy = sum(p[1] for p in big) / len(big)
        districts.append([g, round(cx), round(cy), [[round(c) for p in simplify_ring(r, 25) for c in p] for r in rings]])

    out = a.out
    tdir = os.path.join(out, 'tiles')
    if os.path.isdir(tdir):
        shutil.rmtree(tdir)
    os.makedirs(tdir)
    total = 0
    index_tiles = []
    for (i, j), t in sorted(tiles.items()):
        if not t['e'] and not t['c']:
            continue
        verts = []
        for v, (x, y) in t['v'].items():
            verts += [v, round(x), round(y)]
        body = {'v': verts, 'e': t['e'], 'names': list(t['names']), 'a': t['a'], 'c': t['c']}
        path = os.path.join(tdir, f'{i}_{j}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(body, f, ensure_ascii=False, separators=(',', ':'))
        total += os.path.getsize(path)
        index_tiles.append(f'{i}_{j}')

    index = {
        'lat0': LAT0, 'lon0': LON0, 'kx': KX, 'ky': KY, 'tile': TILE,
        'bounds': [0, 0, round((LON_MAX - LON0) * KX), round((LAT_MAX - LAT0) * KY)],
        'tiles': index_tiles, 'purposes': PURPOSES, 'camsDate': cams_date,
        'counts': {'vertices': len(gxy), 'edges': len(edges), 'cctvSites': len(cams),
                   'cctvCameras': sum(c[2] for c in cams), 'places': len(places)},
    }
    for name, obj in (('index.json', index), ('places.json', places), ('areas-large.json', large), ('districts.json', districts)):
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(index['counts'], ensure_ascii=False),
          f'tiles {len(index_tiles)} ({total/1e6:.1f} MB)',
          f'large areas {len(large)} ({os.path.getsize(os.path.join(out, "areas-large.json"))/1e6:.1f} MB)',
          f'cctv rows {cams_rows} ({cams_date})')


if __name__ == '__main__':
    main()
