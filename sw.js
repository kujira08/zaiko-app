// Service Worker - 常に最新版を取得する設定
// ⚠️ 画面の中身を変えたのに反映されないときは、ここの数字を上げる。
//    ファイルが変われば新しいSWが入り、activateで古いキャッシュを全部消す。
const CACHE_NAME = 'zaiko-v3';  // 2026-08-30 ログイン画面の統一＋「アプリを更新」ボタン追加

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
