// Service Worker - 常に最新版を取得する設定
// ⚠️ 画面の中身を変えたのに反映されないときは、ここの数字を上げる。
//    ファイルが変われば新しいSWが入り、activateで古いキャッシュを全部消す。
const CACHE_NAME = 'zaiko-v5';  // 2026-09-04 セッション認証へ移行

// インストール時：キャッシュしない（常にネットワークから取得）
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// アクティベート時：古いキャッシュをすべて削除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// フェッチ：常にネットワーク優先、失敗時のみキャッシュ
self.addEventListener('fetch', (e) => {
  // GAS APIはキャッシュしない
  if (e.request.url.includes('script.google.com')) return;

  // ホーム画面アイコン用の入れ物ページもキャッシュしない。
  // ここをキャッシュすると、入れ物を直したときに古いまま残り、
  // 更新ボタンを持たないぶん直す手段がなくなる。
  if (/\/zaiko-app\/(portal|customers|dashboard|quote)\//.test(e.request.url)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 成功したらキャッシュに保存
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
