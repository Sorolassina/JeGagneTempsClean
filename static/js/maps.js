// maps.js - Google Maps integration for Je Gagne Temps

let map;
let markers = [];
let userMarker;
let infoWindow;
let directionsService;
let directionsRenderer;
let geocoder;
let userPosition;

// Initialize the map
function initMap() {
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;
  
  // Default center (could be a major city in the target region)
  const defaultCenter = { lat: 6.1377, lng: 1.2125 }; // Lomé, Togo as example

  // Try to get saved position first
  const savedLat = localStorage.getItem('user_latitude');
  const savedLng = localStorage.getItem('user_longitude');
  let initialCenter = defaultCenter;
  
  if (savedLat && savedLng) {
    initialCenter = { lat: parseFloat(savedLat), lng: parseFloat(savedLng) };
  }
  
  // Create the map with lower zoom level and simplified controls for lower bandwidth
  map = new google.maps.Map(mapContainer, {
    center: initialCenter,
    zoom: 12,
    gestureHandling: 'cooperative',
    zoomControl: true,
    mapTypeControl: false,
    scaleControl: true,
    streetViewControl: false,
    rotateControl: false,
    fullscreenControl: false,
    styles: [
      // Simplified map style for bandwidth optimization
      {
        featureType: "poi",
        stylers: [{ visibility: "off" }]
      },
      {
        featureType: "transit",
        stylers: [{ visibility: "off" }]
      }
    ]
  });
  
  // Create info window for markers
  infoWindow = new google.maps.InfoWindow();
  
  // Initialize directions service and renderer
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    polylineOptions: {
      strokeColor: '#8A2BE2', // Match primary color
      strokeWeight: 5,
      strokeOpacity: 0.7
    }
  });
  directionsRenderer.setMap(map);
  
  // Initialize geocoder
  geocoder = new google.maps.Geocoder();
  
  // Add custom controls for simplified interaction
  addCustomControls();

  // Try to get user's current location
  getUserPositionForMap();
  
  // Load businesses if we're on the search results page
  loadNearbyBusinesses();
}

// Add custom controls to the map
function addCustomControls() {
  // Current location button
  const locationButton = document.createElement("button");
  locationButton.textContent = "📍";
  locationButton.classList.add("custom-map-control");
  locationButton.title = "Ma position";
  
  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(locationButton);
  
  locationButton.addEventListener("click", () => {
    getUserPositionForMap(true);
  });
  
  // Offline map notice if we're using cached data
  if (localStorage.getItem('using_offline_data') === 'true') {
    const offlineNotice = document.createElement("div");
    offlineNotice.textContent = "🔄 Données hors ligne";
    offlineNotice.classList.add("offline-map-notice");
    
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(offlineNotice);
  }
}

// Get user's position specifically for the map
function getUserPositionForMap(recenter = false) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        
        // Save to localStorage
        localStorage.setItem('user_latitude', userPosition.lat);
        localStorage.setItem('user_longitude', userPosition.lng);
        localStorage.setItem('location_timestamp', Date.now());
        
        // Add or update user marker
        if (userMarker) {
          userMarker.setPosition(userPosition);
        } else {
          userMarker = new google.maps.Marker({
            position: userPosition,
            map: map,
            title: "Votre position",
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#4285F4",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2
            },
            zIndex: 1000
          });
        }
        
        // Recenter map if requested
        if (recenter) {
          map.setCenter(userPosition);
          map.setZoom(15);
        }
        
        // Update the URL if on search page
        const searchParams = new URLSearchParams(window.location.search);
        if (window.location.pathname === '/search') {
          searchParams.set('latitude', userPosition.lat);
          searchParams.set('longitude', userPosition.lng);
          
          const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
          window.history.replaceState({}, '', newUrl);
          
          // Reload nearby businesses with new location
          loadNearbyBusinesses();
        }
      },
      (error) => {
        console.error("Error getting user location for map:", error);
        
        // Use cached location if available
        const cachedLat = localStorage.getItem('user_latitude');
        const cachedLng = localStorage.getItem('user_longitude');
        
        if (cachedLat && cachedLng) {
          userPosition = {
            lat: parseFloat(cachedLat),
            lng: parseFloat(cachedLng)
          };
          
          if (recenter) {
            map.setCenter(userPosition);
          }
          
          // Create user marker with cached position
          if (!userMarker) {
            userMarker = new google.maps.Marker({
              position: userPosition,
              map: map,
              title: "Votre dernière position connue",
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#4285F4",
                fillOpacity: 0.7, // Less opaque to indicate it's cached
                strokeColor: "#FFFFFF",
                strokeWeight: 2
              },
              zIndex: 1000
            });
          }
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }
}

// Load nearby businesses from the API or cache
function loadNearbyBusinesses() {
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer || !map) return;
  
  const searchParams = new URLSearchParams(window.location.search);
  const latitude = searchParams.get('latitude');
  const longitude = searchParams.get('longitude');
  const category = searchParams.get('category');
  
  if (!latitude || !longitude) {
    console.log("No coordinates provided for map search");
    return;
  }
  
  // Show loading indicator
  const loader = document.getElementById('map-loader');
  if (loader) loader.style.display = 'block';
  
  // Try to get from API if online
  if (navigator.onLine) {
    fetch(`/api/nearby-businesses?latitude=${latitude}&longitude=${longitude}${category ? '&category=' + category : ''}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        if (data.success) {
          // Save to localStorage for offline use
          localStorage.setItem('nearby_businesses', JSON.stringify(data.businesses));
          localStorage.setItem('nearby_businesses_timestamp', Date.now());
          localStorage.setItem('nearby_businesses_coords', `${latitude},${longitude}`);
          localStorage.setItem('using_offline_data', 'false');
          
          // Add markers to map
          addBusinessMarkers(data.businesses);
        } else {
          throw new Error(data.error || 'Failed to load businesses');
        }
      })
      .catch(error => {
        console.error('Error fetching nearby businesses:', error);
        useOfflineBusinessData();
      })
      .finally(() => {
        if (loader) loader.style.display = 'none';
      });
  } else {
    // Use offline data
    useOfflineBusinessData();
    if (loader) loader.style.display = 'none';
  }
}

// Use cached business data when offline
function useOfflineBusinessData() {
  const businessesJson = localStorage.getItem('nearby_businesses');
  const timestamp = localStorage.getItem('nearby_businesses_timestamp');
  const coords = localStorage.getItem('nearby_businesses_coords');
  
  if (businessesJson && timestamp && coords) {
    // Check if data is less than 24 hours old
    if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
      const businesses = JSON.parse(businessesJson);
      addBusinessMarkers(businesses);
      
      // Add notice that we're using offline data
      localStorage.setItem('using_offline_data', 'true');
      
      const offlineNotice = document.createElement("div");
      offlineNotice.textContent = "🔄 Données hors ligne";
      offlineNotice.classList.add("offline-map-notice");
      
      map.controls[google.maps.ControlPosition.TOP_CENTER].push(offlineNotice);
      
      return;
    }
  }
  
  // If no valid cached data, show empty state
  showEmptyMapState();
}

// Add business markers to the map
function addBusinessMarkers(businesses) {
  // Clear existing markers
  markers.forEach(marker => marker.setMap(null));
  markers = [];
  
  if (!businesses || businesses.length === 0) {
    showEmptyMapState();
    return;
  }
  
  // Create marker for each business
  businesses.forEach(business => {
    const marker = new google.maps.Marker({
      position: { lat: business.latitude, lng: business.longitude },
      map: map,
      title: business.name,
      animation: google.maps.Animation.DROP,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#8A2BE2", // Primary color
        fillOpacity: 0.8,
        strokeColor: "#FFFFFF",
        strokeWeight: 2
      }
    });
    
    // Create info window content
    const content = `
      <div class="info-window">
        <h5>${business.name}</h5>
        <p><strong>${business.category}</strong></p>
        <p>${business.address}</p>
        <p><strong>Distance:</strong> ${formatDistance(business.distance)}</p>
        <a href="/service/${business.id}" class="btn btn-sm btn-primary">Voir détails</a>
        <button class="btn btn-sm btn-outline-primary get-directions-btn" 
          data-lat="${business.latitude}" 
          data-lng="${business.longitude}">
          Obtenir l'itinéraire
        </button>
      </div>
    `;
    
    // Add click listener to open info window
    marker.addListener("click", () => {
      infoWindow.setContent(content);
      infoWindow.open(map, marker);
      
      // Add event listener for directions button
      setTimeout(() => {
        const directionsBtn = document.querySelector('.get-directions-btn');
        if (directionsBtn) {
          directionsBtn.addEventListener('click', (e) => {
            const destLat = parseFloat(e.target.getAttribute('data-lat'));
            const destLng = parseFloat(e.target.getAttribute('data-lng'));
            showDirections({ lat: destLat, lng: destLng });
          });
        }
      }, 100);
    });
    
    markers.push(marker);
  });
  
  // Fit bounds to include all markers
  if (markers.length > 0) {
    const bounds = new google.maps.LatLngBounds();
    markers.forEach(marker => bounds.extend(marker.getPosition()));
    
    // Include user position in bounds if available
    if (userMarker) {
      bounds.extend(userMarker.getPosition());
    }
    
    map.fitBounds(bounds);
    
    // Limit zoom level for better overview
    const listener = google.maps.event.addListener(map, 'idle', function() {
      if (map.getZoom() > 15) map.setZoom(15);
      google.maps.event.removeListener(listener);
    });
  }
}

// Show directions to a business
function showDirections(destination) {
  if (!userPosition) {
    alert("Votre position n'est pas disponible. Veuillez activer la géolocalisation.");
    return;
  }
  
  directionsService.route(
    {
      origin: userPosition,
      destination: destination,
      travelMode: google.maps.TravelMode.DRIVING
    },
    (response, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(response);
        
        // Add custom markers
        const leg = response.routes[0].legs[0];
        
        // Update user marker position
        if (userMarker) userMarker.setMap(null);
        userMarker = new google.maps.Marker({
          position: leg.start_location,
          map: map,
          title: "Votre position",
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#4285F4",
            fillOpacity: 1,
            strokeColor: "#FFFFFF",
            strokeWeight: 2
          },
          zIndex: 1000
        });
        
        // Destination marker
        const destMarker = new google.maps.Marker({
          position: leg.end_location,
          map: map,
          title: leg.end_address,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#8A2BE2",
            fillOpacity: 0.8,
            strokeColor: "#FFFFFF",
            strokeWeight: 2
          }
        });
        
        // Add distance and duration info
        const routeInfoDiv = document.createElement("div");
        routeInfoDiv.classList.add("route-info");
        routeInfoDiv.innerHTML = `
          <div class="card p-2">
            <strong>Distance:</strong> ${leg.distance.text}<br>
            <strong>Durée estimée:</strong> ${leg.duration.text}
          </div>
        `;
        
        map.controls[google.maps.ControlPosition.TOP_CENTER].clear();
        map.controls[google.maps.ControlPosition.TOP_CENTER].push(routeInfoDiv);
        
        // Add reset directions button
        const resetButton = document.createElement("button");
        resetButton.textContent = "✕ Fermer l'itinéraire";
        resetButton.classList.add("custom-map-control", "reset-directions-btn");
        
        map.controls[google.maps.ControlPosition.TOP_RIGHT].push(resetButton);
        
        resetButton.addEventListener("click", () => {
          directionsRenderer.setDirections({ routes: [] });
          map.controls[google.maps.ControlPosition.TOP_CENTER].clear();
          map.controls[google.maps.ControlPosition.TOP_RIGHT].clear();
          destMarker.setMap(null);
          
          // Re-add user marker
          getUserPositionForMap();
          
          // Reload business markers
          loadNearbyBusinesses();
        });
      } else {
        window.alert("L'itinéraire n'a pas pu être calculé: " + status);
      }
    }
  );
}

// Show empty state when no businesses found
function showEmptyMapState() {
  // Clear existing markers
  markers.forEach(marker => marker.setMap(null));
  markers = [];
  
  // Add a message to the map
  const emptyStateDiv = document.createElement("div");
  emptyStateDiv.classList.add("empty-map-state");
  emptyStateDiv.innerHTML = `
    <div class="card p-3 text-center">
      <h5>Aucun service trouvé à proximité</h5>
      <p>Essayez d'élargir votre recherche ou de changer de catégorie.</p>
    </div>
  `;
  
  map.controls[google.maps.ControlPosition.TOP_CENTER].clear();
  map.controls[google.maps.ControlPosition.TOP_CENTER].push(emptyStateDiv);
}

// Format distance for display
function formatDistance(distance) {
  if (distance < 1) {
    return `${Math.round(distance * 1000)} m`;
  } else {
    return `${distance.toFixed(1)} km`;
  }
}

// Initialize map manually if needed (when not using API script callback)
document.addEventListener('DOMContentLoaded', () => {
  const mapContainer = document.getElementById('map-container');
  if (mapContainer && typeof google !== 'undefined') {
    initMap();
  } else if (mapContainer) {
    // Show fallback if Google Maps isn't available
    mapContainer.innerHTML = `
      <div class="fallback-map-container">
        <div class="text-center p-4">
          <h4>Carte non disponible</h4>
          <p>La connexion Google Maps n'est pas disponible. Veuillez vérifier votre connexion internet.</p>
          <button id="retry-map-btn" class="btn btn-primary mt-2">Réessayer</button>
        </div>
      </div>
    `;
    
    const retryBtn = document.getElementById('retry-map-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }
  }
});
