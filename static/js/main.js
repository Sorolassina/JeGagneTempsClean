// main.js - Main JavaScript functionality for Je Gagne Temps

document.addEventListener('DOMContentLoaded', () => {
  // Initialize tooltips and popovers
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  popoverTriggerList.map(function (popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl);
  });

  // Flash message auto-close
  const alerts = document.querySelectorAll('.alert-dismissible');
  alerts.forEach(alert => {
    setTimeout(() => {
      const bsAlert = new bootstrap.Alert(alert);
      bsAlert.close();
    },
    5000);
  });

  // Register service worker for PWA functionality
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/js/service-worker.js')
      .then(registration => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
      });
  }

  // Check for online/offline status
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Handle location button on homepage
  const findNearbyBtn = document.getElementById('find-nearby');
  if (findNearbyBtn) {
    findNearbyBtn.addEventListener('click', getUserLocation);
  }

  // Handle search form
  const searchForm = document.getElementById('search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', function(e) {
      const locationInput = document.getElementById('include-location');
      if (locationInput && locationInput.checked) {
        e.preventDefault();
        getUserLocation(function(position) {
          const latInput = document.createElement('input');
          latInput.type = 'hidden';
          latInput.name = 'latitude';
          latInput.value = position.coords.latitude;
          
          const lngInput = document.createElement('input');
          lngInput.type = 'hidden';
          lngInput.name = 'longitude';
          lngInput.value = position.coords.longitude;
          
          searchForm.appendChild(latInput);
          searchForm.appendChild(lngInput);
          searchForm.submit();
        });
      }
    });
  }

  // Initialize distance display
  updateDistanceDisplay();
});

// Update online/offline status indicator
function updateOnlineStatus() {
  const offlineBanner = document.getElementById('offline-banner');
  if (!offlineBanner) return;
  
  if (navigator.onLine) {
    offlineBanner.classList.remove('visible');
    
    // Sync any queued actions from local storage
    syncQueuedActions();
  } else {
    offlineBanner.classList.add('visible');
  }
}

// Get user's current location
function getUserLocation(callback) {
  const locationLoader = document.getElementById('location-loader');
  if (locationLoader) locationLoader.style.display = 'block';
  
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      // Success
      (position) => {
        if (locationLoader) locationLoader.style.display = 'none';
        
        // Save position to localStorage for offline use
        localStorage.setItem('user_latitude', position.coords.latitude);
        localStorage.setItem('user_longitude', position.coords.longitude);
        localStorage.setItem('location_timestamp', Date.now());
        
        if (callback) {
          callback(position);
        } else {
          // Default behavior - redirect to search with coordinates
          window.location.href = `/search?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}`;
        }
      },
      // Error
      (error) => {
        if (locationLoader) locationLoader.style.display = 'none';
        
        let errorMessage;
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = "Vous avez refusé l'accès à votre localisation.";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Les informations de localisation ne sont pas disponibles.";
            break;
          case error.TIMEOUT:
            errorMessage = "La demande de localisation a expiré.";
            break;
          default:
            errorMessage = "Une erreur inconnue s'est produite lors de la géolocalisation.";
        }
        
        showAlert(errorMessage, 'danger');
        
        // Use approximate location or fallback
        useFallbackLocation();
      },
      // Options
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  } else {
    if (locationLoader) locationLoader.style.display = 'none';
    showAlert("La géolocalisation n'est pas prise en charge par votre navigateur.", 'warning');
    useFallbackLocation();
  }
}

// Use approximate location or ask for manual entry
function useFallbackLocation() {
  // Check if we have a recent cached location
  const cachedLat = localStorage.getItem('user_latitude');
  const cachedLng = localStorage.getItem('user_longitude');
  const timestamp = localStorage.getItem('location_timestamp');
  
  // Use cached location if it's less than 24 hours old
  if (cachedLat && cachedLng && timestamp && (Date.now() - timestamp < 24 * 60 * 60 * 1000)) {
    window.location.href = `/search?latitude=${cachedLat}&longitude=${cachedLng}&cached=true`;
  } else {
    // Show modal for manual location entry
    const locationModal = new bootstrap.Modal(document.getElementById('location-modal'));
    if (locationModal) {
      locationModal.show();
    }
  }
}

// Show alert messages
function showAlert(message, type = 'info') {
  const alertContainer = document.getElementById('alert-container');
  if (!alertContainer) return;
  
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} alert-dismissible fade show`;
  alert.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  
  alertContainer.appendChild(alert);
  
  // Auto-close after 5 seconds
  setTimeout(() => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 300);
  }, 5000);
}

// Update distance display in search results
function updateDistanceDisplay() {
  const distanceElements = document.querySelectorAll('.distance');
  distanceElements.forEach(el => {
    const distance = parseFloat(el.dataset.distance);
    if (!isNaN(distance)) {
      if (distance < 1) {
        el.textContent = `${Math.round(distance * 1000)} m`;
      } else {
        el.textContent = `${distance.toFixed(1)} km`;
      }
    }
  });
}

// Sync queued actions when back online
function syncQueuedActions() {
  // Get queued actions from localStorage
  const queuedActions = JSON.parse(localStorage.getItem('queued_actions') || '[]');
  if (queuedActions.length === 0) return;
  
  // Process each action
  const newQueue = queuedActions.filter(action => {
    // Try to perform the action
    fetch(action.url, {
      method: action.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(action.data)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to sync action');
      }
      return response.json();
    })
    .then(data => {
      console.log('Action synced successfully:', action.type);
    })
    .catch(error => {
      console.error('Failed to sync action:', error);
      return true; // Keep in queue
    });
    
    return false; // Remove from queue
  });
  
  // Update the queue
  localStorage.setItem('queued_actions', JSON.stringify(newQueue));
  
  // Refresh the page if actions were synced
  if (newQueue.length < queuedActions.length) {
    showAlert('Vos actions ont été synchronisées avec succès.', 'success');
    setTimeout(() => window.location.reload(), 2000);
  }
}
