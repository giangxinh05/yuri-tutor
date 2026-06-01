// Thay đổi tên phiên bản (v2) để ép trình duyệt tải lại cache mới nhất
const CACHE_NAME = 'yuri-workspace-v2'; 

// Danh sách các file tĩnh cần lưu offline
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/admin.html',
    '/style.css',
    '/admin-style.css',
    '/app.js',
    '/admin-app.js',
    '/utils.js', // <-- File cực kỳ quan trọng vừa được bổ sung
    '/manifest.json'
];

// Cài đặt Service Worker và lưu Cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Đang lưu trữ dữ liệu offline...');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
    // Bắt buộc Service Worker mới thay thế cái cũ ngay lập tức mà không cần chờ đợi
    self.skipWaiting(); 
});

// Kích hoạt và dọn dẹp bộ nhớ đệm cũ (nếu có bản v1, nó sẽ bị xóa để dùng v2)
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Đang dọn dẹp cache cũ:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Giành quyền kiểm soát toàn bộ các trang ngay lập tức
    self.clients.claim(); 
});

// Chặn các yêu cầu tải file và kiểm tra Cache trước
self.addEventListener('fetch', event => {
    // Chỉ cache các request lấy file (GET), bỏ qua các thao tác đẩy dữ liệu (POST, PUT, PATCH, DELETE) lên Firebase
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Trả về dữ liệu từ Cache nếu có. Nếu không, tiếp tục lấy từ Internet.
                return cachedResponse || fetch(event.request).catch(() => {
                    console.log('[Service Worker] Mất kết nối mạng và không tìm thấy file trong cache.');
                });
            })
    );
});