/*
 * RGPia Web Service – service registry.
 * Each entry becomes one tab. To add a service:
 *   1. Put a self-contained page in services/<id>/index.html
 *   2. Add an entry below. The tab order follows this list; the first one opens by default.
 */
window.RGPIA_SERVICES = [
  {
    id: 'safe-tour',                 // used in the address: …/#safe-tour
    label: 'Safe Tour',              // tab text
    title: '서울 안심 도보길',          // browser tab title while selected
    path: 'services/safe-tour/',     // page loaded in the tab
    allow: 'geolocation',            // browser features the page may ask for
    description: '지금 위치에서 걸어서 1시간 안의 서울 관광지를 CCTV가 비추는 길로 안내',
  },
];
