# RGPia Web Service

여러 웹 서비스를 탭으로 모아 GitHub Pages로 게시하는 정적 사이트입니다. (가칭)

| 탭 | 서비스 | 경로 |
|---|---|---|
| Safe Tour | 서울 안심 도보길 – 구·관광지(또는 휴대폰 현재 위치)에서 걸어서 1시간(4km) 안의 서울 관광지를 CCTV가 비추는 길로 안내 | `services/safe-tour/` |

## 구조

```
index.html            탭 셸 (상단 바 + 서비스 프레임)
services.js           서비스 목록 – 탭은 여기서 만들어집니다
assets/               셸 스타일·스크립트
services/<id>/        서비스별 독립 페이지
tools/<id>/           서비스 데이터 생성 스크립트
```

## 서비스 추가하기

1. `services/<id>/index.html`에 독립적으로 동작하는 페이지를 만듭니다.
2. `services.js`의 `RGPIA_SERVICES` 배열에 항목을 추가합니다.

```js
{ id: 'my-service', label: 'My Service', title: '서비스 이름', path: 'services/my-service/', description: '한 줄 설명' }
```

탭 주소는 `…/#my-service`가 됩니다. 각 서비스는 별도 프레임에서 열리므로 스타일과 스크립트가 서로 섞이지 않습니다.

## Safe Tour 동작

- 출발지: 서울 25개 구 중 하나를 고르면 그 구의 관광지 목록이 나오고, 고른 관광지에서 출발합니다. 기본은 종로구 경복궁입니다. 검색창은 서울 전체 관광지를 찾습니다. 지도의 빈 곳을 눌러 출발지를 정할 수도 있습니다.
- 휴대폰(터치 기기)에서는 현재 위치를 자동으로 물어보고, 받으면 그 위치와 해당 구로 바꿉니다. 권한 거부·서울 밖·20초 무응답이면 기본 출발지를 유지합니다. "현재 위치에서 시작" 버튼은 휴대폰에서만 보입니다.
- 목적지: 출발지에서 실제 걷는 길로 4km(시속 4.2km 기준 약 57분) 안에 있는 관광지만 가까운 순으로 보여 줍니다.
- 지도: 서울 전체를 2km 격자 조각(`data/tiles/`)으로 나눠 두고, 출발지 주변 조각만 불러옵니다.
- 셸의 프레임에 `allow="geolocation"`을 주어야 탭 안에서 위치를 물을 수 있습니다(`services.js`의 `allow`).

## Safe Tour 데이터 갱신

```bash
curl -LO https://download.bbbike.org/osm/bbbike/Seoul/Seoul.osm.pbf
pip install osmium
python3 tools/safe-tour/build_data.py --pbf Seoul.osm.pbf --cctv <서울 CCTV 표준데이터.csv>
```

`services/safe-tour/data/`에 `index.json`, `places.json`(관광지와 소속 구), `districts.json`(25개 구 경계), `areas-large.json`(한강·큰 공원), `tiles/*.json`(보행 도로망·작은 녹지·CCTV)이 만들어집니다. 관광지는 OSM에서 이름과 위키데이터가 있는 궁궐·박물관·미술관·명소·공원·시장 등과, 스크립트의 `CURATED` 목록(명동·인사동·홍대 거리 등)을 쓰고, 관광지가 8곳보다 적은 구는 위키데이터가 없는 큰 공원·박물관·명소·시장으로 채웁니다.

- 보행 도로망·관광지: © OpenStreetMap 기여자 (ODbL)
- CCTV: 공공데이터포털 전국CCTV표준데이터 – 서울특별시 자치구 제공분 (2026-05-21 기준, 59,750건). 구청 관리 CCTV만 포함되어 경찰·문화재·민간 CCTV는 빠져 있습니다.

앱 안에서 최신 CSV를 불러와 바꿔 쓸 수도 있습니다(브라우저에만 저장).

## 로컬에서 보기

```bash
python3 -m http.server 0 --bind 127.0.0.1
```

포트를 `0`으로 주면 비어 있는 포트를 자동으로 골라 실행합니다. 터미널에 나오는 `Serving HTTP on 127.0.0.1 port 54321 …`의 포트 번호로 `http://127.0.0.1:54321` 을 엽니다.

정해진 포트를 쓰고 싶다면 사용 중이지 않은 번호를 직접 지정하세요(예: `python3 -m http.server 8790`).
