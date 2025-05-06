// offline.js - Offline functionality for Je Gagne Temps

// This script handles offline functionality and caching strategies for the PWA
document.addEventListener('DOMContentLoaded', () => {
  // Check if browser supports required PWA features
  if ('serviceWorker' in navigator && 'caches' in window && 'localStorage' in window) {
    initOfflineSupport();
  } else {
    console.log('Browser does not support all required PWA features');
  }

  // Listen for online/offline events
  window.addEventListener('online', handleOnlineStatus);
  window.addEventListener('offline', handleOnlineStatus);

  // Initial check
  handleOnlineStatus();
});

// Initialize offline support features
function initOfflineSupport() {
  // Cache important data for offline use
  cacheCategories();
  cacheUserData();
  
  // Handle forms that should work offline
  setupOfflineForms();
  
  // Handle "save for offline" buttons
  const offlineButtons = document.querySelectorAll('.save-offline-btn');
  offlineButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const businessId = btn.dataset.businessId;
      if (businessId) {
        saveBusinessForOffline(businessId);
      }
    });
  });
}

// Handle online/offline status changes
function handleOnlineStatus() {
  const offlineBanner = document.getElementById('offline-banner');
  if (!offlineBanner) return;
  
  if (navigator.onLine) {
    offlineBanner.classList.remove('visible');
    
    // Process queued actions when back online
    processQueuedActions();
    
    // Update "offline mode" indicators
    document.querySelectorAll('.offline-indicator').forEach(el => {
      el.style.display = 'none';
    });
    
    // Re-enable online-only features
    document.querySelectorAll('.online-only').forEach(el => {
      el.classList.remove('disabled');
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
        el.disabled = false;
      }
    });
  } else {
    offlineBanner.classList.add('visible');
    
    // Show "offline mode" indicators
    document.querySelectorAll('.offline-indicator').forEach(el => {
      el.style.display = 'block';
    });
    
    // Disable online-only features
    document.querySelectorAll('.online-only').forEach(el => {
      el.classList.add('disabled');
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
        el.disabled = true;
      }
    });
  }
}

// Process queued actions when back online
function processQueuedActions() {
  const queuedActions = JSON.parse(localStorage.getItem('queued_actions') || '[]');
  if (queuedActions.length === 0) return;
  
  console.log(`Processing ${queuedActions.length} queued actions`);
  
  // Create a copy of the queue to process
  const actionsToProcess = [...queuedActions];
  
  // Clear the queue immediately to avoid duplicate processing
  localStorage.setItem('queued_actions', '[]');
  
  // Process each action
  const processPromises = actionsToProcess.map(action => {
    return new Promise((resolve, reject) => {
      console.log(`Processing action: ${action.type}`);
      
      // Prepare the request options
      const options = {
        method: action.method,
        headers: {
          'Content-Type': action.method === 'GET' ? 'application/x-www-form-urlencoded' : 'application/json',
        }
      };
      
      // Add body for non-GET requests
      if (action.method !== 'GET') {
        if (action.data instanceof FormData) {
          options.body = action.data;
          delete options.headers['Content-Type']; // Let browser set content-type for FormData
        } else if (typeof action.data === 'object') {
          options.body = JSON.stringify(action.data);
        } else {
          options.body = action.data;
        }
      }
      
      // Send the request
      fetch(action.url, options)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
          }
          return response.text();
        })
        .then(data => {
          console.log(`Action ${action.type} processed successfully`);
          resolve(action);
        })
        .catch(error => {
          console.error(`Failed to process action ${action.type}:`, error);
          reject(action);
        });
    });
  });
  
  // Handle results
  Promise.allSettled(processPromises).then(results => {
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    
    // Re-queue failed actions
    if (failed.length > 0) {
      const currentQueue = JSON.parse(localStorage.getItem('queued_actions') || '[]');
      
      failed.forEach(failedPromise => {
        currentQueue.push(failedPromise.reason);
      });
      
      localStorage.setItem('queued_actions', JSON.stringify(currentQueue));
    }
    
    // Show notification
    if (successful > 0) {
      showNotification(`${successful} actions synchronisées avec succès.`, 'success');
      
      // Reload the page if we're on a page that might have been affected
      const currentPath = window.location.pathname;
      if (currentPath.includes('/profile') || 
          currentPath.includes('/service/') || 
          currentPath.includes('/business-dashboard')) {
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    }
  });
}

// Cache service categories for offline use
function cacheCategories() {
  const categories = document.querySelectorAll('[data-category-value]');
  if (categories.length > 0) {
    const categoryData = [];
    
    categories.forEach(cat => {
      categoryData.push({
        value: cat.dataset.categoryValue,
        label: cat.textContent.trim()
      });
    });
    
    localStorage.setItem('service_categories', JSON.stringify(categoryData));
  }
}

// Cache user data for offline use
function cacheUserData() {
  const userDataEl = document.getElementById('user-data');
  if (userDataEl) {
    const userData = {
      id: userDataEl.dataset.userId,
      name: userDataEl.dataset.userName,
      type: userDataEl.dataset.userType,
      is_logged_in: userDataEl.dataset.isLoggedIn === 'true'
    };
    
    localStorage.setItem('user_data', JSON.stringify(userData));
  }
}

// Setup forms to work offline
function setupOfflineForms() {
  const offlineForms = document.querySelectorAll('.offline-form');
  
  offlineForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      if (!navigator.onLine) {
        e.preventDefault();
        
        // Get form data
        const formData = new FormData(form);
        const formObject = {};
        for (const [key, value] of formData.entries()) {
          formObject[key] = value;
        }
        
        // Queue form submission
        const queuedActions = JSON.parse(localStorage.getItem('queued_actions') || '[]');
        queuedActions.push({
          type: form.dataset.actionType || 'form_submit',
          url: form.action,
          method: form.method.toUpperCase(),
          data: formObject,
          timestamp: Date.now()
        });
        
        localStorage.setItem('queued_actions', JSON.stringify(queuedActions));
        
        // Show confirmation
        showNotification('Votre action sera traitée lorsque vous serez de nouveau en ligne.', 'info');
        
        // Handle specific form types
        if (form.classList.contains('join-queue-form')) {
          handleOfflineQueueJoin(formObject);
        }
      }
    });
  });
}

// Handle queue joining when offline
function handleOfflineQueueJoin(formData) {
  const serviceId = formData.service_id;
  const button = document.querySelector(`.join-queue-btn[data-service-id="${serviceId}"]`);
  
  if (button) {
    button.disabled = true;
    button.textContent = 'En attente de connexion...';
    button.classList.add('btn-secondary');
    button.classList.remove('btn-primary');
  }
  
  // Add to "my queues" list if on profile page
  const queueList = document.querySelector('.my-queues-list');
  if (queueList) {
    const serviceName = document.querySelector(`[data-service-id="${serviceId}"]`).closest('.service-card').querySelector('.service-name').textContent;
    const businessName = document.querySelector('.business-name').textContent;
    
    const queueItem = document.createElement('div');
    queueItem.className = 'queue-card mb-3 p-3 border rounded';
    queueItem.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <h5>${serviceName}</h5>
          <p class="text-muted mb-0">${businessName}</p>
        </div>
        <div class="text-center">
          <span class="queue-position-indicator bg-warning px-3 py-2 rounded-circle">?</span>
          <div class="text-muted small mt-1">Hors ligne</div>
        </div>
      </div>
      <div class="offline-indicator text-warning small mt-2">
        <i class="fas fa-exclamation-triangle"></i> Sera confirmé lorsque vous serez en ligne
      </div>
    `;
    
    queueList.appendChild(queueItem);
  }
}

// Save a business for offline viewing
function saveBusinessForOffline(businessId) {
  // If we're on the business page, save its data
  const businessElement = document.querySelector('.business-details');
  if (businessElement) {
    const businessData = {
      id: businessId,
      name: document.querySelector('.business-name').textContent,
      description: document.querySelector('.business-description')?.textContent || '',
      address: document.querySelector('.business-address')?.textContent || '',
      category: document.querySelector('.business-category')?.textContent || '',
      phone: document.querySelector('.business-phone')?.textContent || '',
      opening_hours: document.querySelector('.business-hours')?.textContent || '',
      services: []
    };
    
    // Save services
    const serviceCards = document.querySelectorAll('.service-card');
    serviceCards.forEach(card => {
      const serviceId = card.dataset.serviceId;
      const serviceName = card.querySelector('.service-name').textContent;
      const serviceDescription = card.querySelector('.service-description')?.textContent || '';
      const servicePrice = card.querySelector('.service-price')?.textContent || '';
      const serviceDuration = card.querySelector('.service-duration')?.textContent || '';
      
      businessData.services.push({
        id: serviceId,
        name: serviceName,
        description: serviceDescription,
        price: servicePrice,
        duration: serviceDuration
      });
    });
    
    // Save to localStorage
    const savedBusinesses = JSON.parse(localStorage.getItem('saved_businesses') || '[]');
    
    // Remove if already exists
    const existingIndex = savedBusinesses.findIndex(b => b.id == businessId);
    if (existingIndex !== -1) {
      savedBusinesses.splice(existingIndex, 1);
    }
    
    // Add to saved businesses
    savedBusinesses.push(businessData);
    localStorage.setItem('saved_businesses', JSON.stringify(savedBusinesses));
    
    // Update button
    const saveButton = document.querySelector('.save-offline-btn');
    if (saveButton) {
      saveButton.textContent = 'Enregistré pour hors ligne';
      saveButton.disabled = true;
      saveButton.classList.remove('btn-outline-primary');
      saveButton.classList.add('btn-success');
    }
    
    showNotification('Ce service a été enregistré pour une consultation hors ligne.', 'success');
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const notificationContainer = document.getElementById('notification-container');
  if (!notificationContainer) return;
  
  const notification = document.createElement('div');
  notification.className = `alert alert-${type} alert-dismissible fade show`;
  notification.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  
  notificationContainer.appendChild(notification);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}
