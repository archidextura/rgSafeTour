# RGPia Web Service

여러 웹 서비스를 탭으로 모아 GitHub Pages로 게시하는 정적 사이트입니다. (가칭)

| 탭 | 서비스 | 경로 |
|---|---|---|
| Safe Tour | 서울 안심 도보길 – 관광지 사이를 CCTV가 비추는 길로 안내 | `services/safe-tour/` |

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

## Safe Tour 데이터 갱신

```bash
tools/safe-tour/fetch_osm.sh /tmp/osm
python3 tools/safe-tour/build_data.py --osm /tmp/osm --cctv <서울 CCTV 표준데이터.csv>
```

- 보행 도로망: © OpenStreetMap 기여자 (ODbL)
- CCTV: 공공데이터포털 전국CCTV표준데이터 – 서울특별시 자치구 제공분 (2026-05-21 기준). 구청 관리 CCTV만 포함되어 경찰·문화재·민간 CCTV는 빠져 있습니다.

앱 안에서 최신 CSV를 불러와 바꿔 쓸 수도 있습니다(브라우저에만 저장).

## 로컬에서 보기

```bash
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000` 을 엽니다.
