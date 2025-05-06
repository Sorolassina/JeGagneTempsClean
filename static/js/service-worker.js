// service-worker.js - Service Worker for Je Gagne Temps PWA

const CACHE_NAME = 'je-gagne-temps-v1';
const DYNAMIC_CACHE = 'je-gagne-temps-dynamic-v1';

// Resources to cache on install
const STATIC_RESOURCES = [
  '/',
  '/static/css/style.css',
  '/static/js/main.js',
  '/static/js/maps.js',
  '/static/js/queue.js',
  '/static/js/offline.js',
  '/static/images/logo.svg',
  '/static/manifest.json',
  '/login',
  '/offline'
];

// Install event - Cache static resources
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static resources');
        return cache.addAll(STATIC_RESOURCES);
      })
  );
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DYNAMIC_CACHE) {
            console.log('Service Worker: Clearing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  return self.clients.claim();
});

// Fetch event - Serve from cache when possible
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and browser extensions
  if (event.request.method !== 'GET' || 
      !event.request.url.startsWith('http')) {
    return;
  }
  
  // Skip Google Maps requests and other third-party resources
  if (event.request.url.includes('maps.googleapis.com') ||
      event.request.url.includes('fonts.googleapis.com') ||
      event.request.url.includes('cdn')) {
    return;
  }
  
  // Handle API requests differently (network first, fall back to offline data)
  if (event.request.url.includes('/api/')) {
    return event.respondWith(networkFirstStrategy(event.request));
  }
  
  // For non-API requests, use cache-first approach
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached response if found
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache', event.request.url);
          return cachedResponse;
        }
        
        // Otherwise, fetch from network
        console.log('Service Worker: Fetching resource', event.request.url);
        return fetch(event.request)
          .then((networkResponse) => {
            // Exit early if response is not valid
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Cache the response for future use
            const responseToCache = networkResponse.clone();
            caches.open(DYNAMIC_CACHE)
              .then((cache) => {
                console.log('Service Worker: Caching new resource', event.request.url);
                cache.put(event.request, responseToCache);
              });
            
            return networkResponse;
          })
          .catch((error) => {
            console.log('Service Worker: Fetch failed; returning offline page', error);
            
            // If it's an HTML page, show the offline page
            if (event.request.headers.get('Accept').includes('text/html')) {
              return caches.match('/offline');
            }
            
            // For CSS/JS resources, return an empty response
            return new Response('', { status: 408, statusText: 'Offline' });
          });
      })
  );
});

// Network-first strategy for API requests
function networkFirstStrategy(request) {
  return fetch(request)
    .then((networkResponse) => {
      // Clone the response for caching
      const clonedResponse = networkResponse.clone();
      
      caches.open(DYNAMIC_CACHE)
        .then((cache) => {
          cache.put(request, clonedResponse);
        });
      
      return networkResponse;
    })
    .catch((error) => {
      console.log('Service Worker: API fetch failed, falling back to cache', error);
      
      return caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // If no cached response, return offline JSON
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'You are offline',
              offline: true
            }),
            { 
              headers: { 'Content-Type': 'application/json' },
              status: 200
            }
          );
        });
    });
}

// Background sync for queued actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-queued-actions') {
    console.log('Service Worker: Syncing queued actions');
    event.waitUntil(syncQueuedActions());
  }
});

// Function to sync queued actions
function syncQueuedActions() {
  return self.clients.matchAll()
    .then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SYNC_QUEUED_ACTIONS'
        });
      });
    });
}

// Push notification event
self.addEventListener('push', (event) => {
  let data = { title: 'Je Gagne Temps', body: 'Notification' };
  
  if (event.data) {
    data = JSON.parse(event.data.text());
  }
  
  const options = {
    body: data.body,
    icon: '/static/images/logo.svg',
    badge: '/static/images/logo.svg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
