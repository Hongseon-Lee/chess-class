// 오프라인에서도 앱이 열리게 한다.
//
// 앱 파일 한 벌을 통째로 저장해 두고, 앱은 언제나 그 한 벌로만 돈다. 그래서 한 화면에
// 옛 파일과 새 파일이 섞이는 일이 없고, 인터넷이 느리거나 없어도 똑같이 열린다.
//
// 새로 배포하면 아래 BUILD가 바뀐다. 브라우저는 이 파일이 달라진 것을 보고 새 워커를 깔고,
// 새 워커는 새 한 벌을 전부 받은 뒤에야 옛 것과 자리를 바꾼다. 다 받지 못하면 옛 한 벌이
// 그대로 남는다. 자리가 바뀌면 앱(js/app.js)이 화면을 한 번 새로 불러와 새 내용을 보여준다.

// 이 배포의 지문. 배포할 때 tools/sitefiles.py가 내보내는 파일들로 계산해 바꿔 넣는다.
// 이 줄은 손으로 고치지 않는다. 'dev'인 채로는(개발 중인 사본) 아무것도 저장하지 않는다.
const BUILD = '2026-10-17.cecf2dcf'

const CACHE_PREFIX = 'chessclass-'
const CACHE = CACHE_PREFIX + BUILD
const STORES = BUILD !== 'dev'

// 저장해 둘 파일 전부. `python3 tools/sitefiles.py check`가 이 목록과 실제 파일을 대조한다.
// 파일을 더하거나 빼면 여기도 고친다.
const PRECACHE = [
  './',
  './css/app.css',
  './data/curriculum.json',
  './img/apple-touch-icon.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon.svg',
  './img/pieces/Chess_bdt45.svg',
  './img/pieces/Chess_blt45.svg',
  './img/pieces/Chess_kdt45.svg',
  './img/pieces/Chess_klt45.svg',
  './img/pieces/Chess_ndt45.svg',
  './img/pieces/Chess_nlt45.svg',
  './img/pieces/Chess_pdt45.svg',
  './img/pieces/Chess_plt45.svg',
  './img/pieces/Chess_qdt45.svg',
  './img/pieces/Chess_qlt45.svg',
  './img/pieces/Chess_rdt45.svg',
  './img/pieces/Chess_rlt45.svg',
  './index.html',
  './js/app.js',
  './js/board.js',
  './js/lesson-runner.js',
  './js/progress.js',
  './js/vendor/chess.js',
  './manifest.webmanifest',
]

// 위 목록을 완전한 주소로 바꿔 둔 것. 요청이 왔을 때 우리가 맡을 것인지 바로 알 수 있다.
const PRECACHED = new Set(PRECACHE.map((url) => new URL(url, self.location).href))

self.addEventListener('install', (event) => {
  if (!STORES) {
    event.waitUntil(self.skipWaiting())
    return
  }
  // 하나라도 못 받으면 설치 전체가 실패하고, 지금 쓰던 워커와 그 한 벌이 그대로 남는다.
  // reload는 브라우저의 HTTP 캐시에 남은 옛 파일을 받지 않게 한다.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  // 이 앱이 만든 옛 캐시만 지운다. 같은 주소(예: 사용자이름.github.io)의 다른 앱 캐시는 건드리지 않는다.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (!STORES) return
  const request = event.request
  if (request.method !== 'GET') return

  // 저장해 둔 앱 파일만 맡는다. `?` 뒤는 떼고 본다(누가 `?utm=…`을 붙인 링크로 들어와도
  // 앱이 열려야 한다). 그 밖의 주소는 손대지 않아서 브라우저가 평소대로 처리한다.
  const url = new URL(request.url)
  const address = url.origin + url.pathname
  if (!PRECACHED.has(address)) {
    // 페이지 이동이면 네트워크의 답을 그대로 건넨다. 아무 답도 하지 않고 브라우저에 맡기면,
    // 그 주소가 다른 주소로 넘겨질 때 화면이 뜨지 않고 멈추는 브라우저가 있다(Chrome 155에서 확인).
    if (request.mode === 'navigate') event.respondWith(fetch(request))
    return
  }

  // 저장해 둔 것이 사라졌을 때만(브라우저가 저장 공간을 비운 경우) 네트워크로 간다.
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(address, { ignoreVary: true }))
      .then((cached) => cached || fetch(request))
  )
})

// 앱이 "오프라인 준비가 됐는가, 지금 어느 배포인가"를 물으면 답한다.
// 워커가 깔려 있다는 것만으로는 준비됐다고 하지 않는다. 한 벌이 실제로 다 있는지 센다.
self.addEventListener('message', (event) => {
  const port = event.ports && event.ports[0]
  if (!port || !event.data || event.data.type !== 'status') return
  if (!STORES) {
    port.postMessage({ build: BUILD, complete: false })
    return
  }
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.keys())
      .then((keys) => {
        const stored = new Set(keys.map((key) => key.url))
        const complete = [...PRECACHED].every((address) => stored.has(address))
        port.postMessage({ build: BUILD, complete })
      })
      .catch(() => port.postMessage({ build: BUILD, complete: false }))
  )
})
