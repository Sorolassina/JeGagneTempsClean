// queue.js - Queue management functionality for Je Gagne Temps

document.addEventListener('DOMContentLoaded', () => {
  // Initialize queue management for business dashboard
  initBusinessQueueManagement();
  
  // Initialize queue view for customers
  initCustomerQueueView();
  
  // Handle queue join button
  const joinQueueBtns = document.querySelectorAll('.join-queue-btn');
  joinQueueBtns.forEach(btn => {
    btn.addEventListener('click', handleJoinQueue);
  });
  
  // Handle queue leave button
  const leaveQueueBtns = document.querySelectorAll('.leave-queue-btn');
  leaveQueueBtns.forEach(btn => {
    btn.addEventListener('click', handleLeaveQueue);
  });
  
  // Periodically refresh queue data
  if (document.getElementById('queue-data-container')) {
    setInterval(refreshQueueData, 30000); // Refresh every 30 seconds
  }
});

// Business dashboard queue management
function initBusinessQueueManagement() {
  const updateQueueForms = document.querySelectorAll('.update-queue-form');
  updateQueueForms.forEach(form => {
    form.addEventListener('submit', function(e) {
      if (!navigator.onLine) {
        e.preventDefault();
        
        // Store the action for later sync
        const formData = new FormData(form);
        const data = {};
        for (let [key, value] of formData.entries()) {
          data[key] = value;
        }
        
        queueAction('update_queue', form.action, 'POST', data);
        
        alert('Vous êtes hors ligne. Cette action sera synchronisée lorsque vous serez de nouveau en ligne.');
        
        // Visually update the UI
        const entryId = formData.get('entry_id');
        const status = formData.get('status');
        updateQueueEntryUI(entryId, status);
      }
    });
  });
  
  // Drag and drop for reordering queue
  const queueLists = document.querySelectorAll('.queue-list');
  queueLists.forEach(list => {
    if (typeof Sortable !== 'undefined') {
      Sortable.create(list, {
        animation: 150,
        ghostClass: 'queue-item-ghost',
        onEnd: function(evt) {
          // Update queue positions after drag
          const serviceId = list.dataset.serviceId;
          const items = list.querySelectorAll('.queue-item');
          
          const positions = [];
          items.forEach((item, index) => {
            positions.push({
              entry_id: item.dataset.entryId,
              position: index + 1
            });
          });
          
          // Update positions if online
          if (navigator.onLine) {
            updateQueuePositions(serviceId, positions);
          } else {
            // Store for later sync
            queueAction('reorder_queue', '/update-queue-positions', 'POST', {
              service_id: serviceId,
              positions: positions
            });
            
            alert('Vous êtes hors ligne. Le réarrangement de la file sera synchronisé lorsque vous serez de nouveau en ligne.');
          }
        }
      });
    }
  });
  
  // Add quick action buttons
  const queueItems = document.querySelectorAll('.queue-item');
  queueItems.forEach(item => {
    const actionsContainer = item.querySelector('.queue-item-actions');
    if (actionsContainer) {
      const completeBtn = document.createElement('button');
      completeBtn.classList.add('btn', 'btn-sm', 'btn-success', 'ms-1');
      completeBtn.innerHTML = '<i class="fas fa-check"></i>';
      completeBtn.title = 'Marquer comme terminé';
      
      completeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const entryId = item.dataset.entryId;
        quickUpdateQueueEntry(entryId, 'COMPLETED');
      });
      
      const cancelBtn = document.createElement('button');
      cancelBtn.classList.add('btn', 'btn-sm', 'btn-danger', 'ms-1');
      cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
      cancelBtn.title = 'Annuler';
      
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const entryId = item.dataset.entryId;
        quickUpdateQueueEntry(entryId, 'CANCELLED');
      });
      
      actionsContainer.appendChild(completeBtn);
      actionsContainer.appendChild(cancelBtn);
    }
  });
}

// Customer queue view initialization
function initCustomerQueueView() {
  const queuePositions = document.querySelectorAll('.queue-position-indicator');
  
  queuePositions.forEach(indicator => {
    const position = parseInt(indicator.dataset.position);
    const waitTime = parseInt(indicator.dataset.waitTime);
    
    // Update styling based on position
    if (position <= 3) {
      indicator.classList.add('queue-small');
    } else if (position <= 8) {
      indicator.classList.add('queue-medium');
    } else {
      indicator.classList.add('queue-large');
    }
    
    // Add estimated time if available
    if (!isNaN(waitTime)) {
      const timeText = document.createElement('div');
      timeText.classList.add('queue-wait-time');
      timeText.textContent = formatWaitTime(waitTime);
      indicator.appendChild(timeText);
    }
  });
}

// Handle joining a queue
function handleJoinQueue(e) {
  const btn = e.currentTarget;
  const serviceId = btn.dataset.serviceId;
  const form = document.getElementById(`join-queue-form-${serviceId}`);
  
  if (!navigator.onLine) {
    e.preventDefault();
    
    // Store the join action for later
    queueAction('join_queue', form.action, 'POST', { service_id: serviceId });
    
    // Update UI optimistically
    btn.disabled = true;
    btn.textContent = 'En file d\'attente';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-success');
    
    alert('Vous êtes hors ligne. Votre place dans la file sera réservée lorsque vous serez de nouveau en ligne.');
  }
}

// Handle leaving a queue
function handleLeaveQueue(e) {
  const btn = e.currentTarget;
  const entryId = btn.dataset.entryId;
  const form = document.getElementById(`leave-queue-form-${entryId}`);
  
  if (!navigator.onLine) {
    e.preventDefault();
    
    // Store the leave action for later
    queueAction('leave_queue', form.action, 'POST', { entry_id: entryId });
    
    // Update UI optimistically
    const queueCard = btn.closest('.queue-card');
    if (queueCard) {
      queueCard.style.opacity = '0.5';
    }
    
    alert('Vous êtes hors ligne. Votre départ de la file sera enregistré lorsque vous serez de nouveau en ligne.');
  }
}

// Quick update queue entry status
function quickUpdateQueueEntry(entryId, status) {
  if (navigator.onLine) {
    fetch('/update-queue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `entry_id=${entryId}&status=${status}`
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      
      // Update UI
      updateQueueEntryUI(entryId, status);
    })
    .catch(error => {
      console.error('Error updating queue:', error);
      alert('Erreur lors de la mise à jour de la file d\'attente. Veuillez réessayer.');
    });
  } else {
    // Store for later sync
    queueAction('update_queue', '/update-queue', 'POST', {
      entry_id: entryId,
      status: status
    });
    
    // Update UI optimistically
    updateQueueEntryUI(entryId, status);
    
    alert('Vous êtes hors ligne. La mise à jour sera synchronisée lorsque vous serez de nouveau en ligne.');
  }
}

// Update queue positions after reordering
function updateQueuePositions(serviceId, positions) {
  fetch('/update-queue-positions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      service_id: serviceId,
      positions: positions
    })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Update UI with new positions
      positions.forEach(pos => {
        const item = document.querySelector(`.queue-item[data-entry-id="${pos.entry_id}"]`);
        if (item) {
          const positionSpan = item.querySelector('.queue-position');
          if (positionSpan) {
            positionSpan.textContent = pos.position;
          }
        }
      });
    }
  })
  .catch(error => {
    console.error('Error updating queue positions:', error);
    alert('Erreur lors de la mise à jour des positions. Veuillez réessayer.');
  });
}

// Store queue action for offline sync
function queueAction(type, url, method, data) {
  const queuedActions = JSON.parse(localStorage.getItem('queued_actions') || '[]');
  
  queuedActions.push({
    type: type,
    url: url,
    method: method,
    data: data,
    timestamp: Date.now()
  });
  
  localStorage.setItem('queued_actions', JSON.stringify(queuedActions));
}

// Update UI after queue status change
function updateQueueEntryUI(entryId, status) {
  const queueItem = document.querySelector(`.queue-item[data-entry-id="${entryId}"]`);
  
  if (queueItem) {
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      // Fade out and remove item
      queueItem.style.opacity = '0.5';
      setTimeout(() => {
        queueItem.classList.add('slide-out');
        setTimeout(() => {
          queueItem.remove();
          
          // Update queue positions
          const queueList = document.querySelector('.queue-list');
          if (queueList) {
            const items = queueList.querySelectorAll('.queue-item');
            items.forEach((item, index) => {
              const positionSpan = item.querySelector('.queue-position');
              if (positionSpan) {
                positionSpan.textContent = index + 1;
              }
            });
          }
        }, 300);
      }, 500);
    } else if (status === 'IN_PROGRESS') {
      queueItem.classList.add('in-progress');
    }
  }
}

// Refresh queue data
function refreshQueueData() {
  if (!navigator.onLine) return;
  
  const container = document.getElementById('queue-data-container');
  if (!container) return;
  
  const businessId = container.dataset.businessId;
  
  fetch(`/queue-data/${businessId}`)
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        // Update service queues
        for (const serviceId in data.queues) {
          updateServiceQueueUI(serviceId, data.queues[serviceId]);
        }
      }
    })
    .catch(error => {
      console.error('Error refreshing queue data:', error);
    });
}

// Update service queue UI with new data
function updateServiceQueueUI(serviceId, queueEntries) {
  const queueList = document.querySelector(`.queue-list[data-service-id="${serviceId}"]`);
  if (!queueList) return;
  
  // Clear current list
  queueList.innerHTML = '';
  
  // Add new entries
  if (queueEntries.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'text-center p-4 text-muted';
    emptyState.textContent = 'Aucun client en attente';
    queueList.appendChild(emptyState);
  } else {
    queueEntries.forEach(entry => {
      const queueItem = document.createElement('div');
      queueItem.className = 'queue-item';
      queueItem.dataset.entryId = entry.id;
      
      queueItem.innerHTML = `
        <div class="d-flex align-items-center">
          <div class="queue-position">${entry.position}</div>
          <div>
            <strong>${entry.customer_name}</strong>
            <div class="text-muted small">En attente depuis ${formatWaitingTime(entry.wait_time)}</div>
          </div>
        </div>
        <div class="queue-item-actions">
          <form class="update-queue-form" action="/update-queue" method="POST">
            <input type="hidden" name="entry_id" value="${entry.id}">
            <input type="hidden" name="status" value="IN_PROGRESS">
            <button type="submit" class="btn btn-sm btn-primary">Commencer</button>
          </form>
        </div>
      `;
      
      queueList.appendChild(queueItem);
    });
    
    // Re-initialize quick actions
    initBusinessQueueManagement();
  }
  
  // Update queue count
  const countBadge = document.querySelector(`.queue-count[data-service-id="${serviceId}"]`);
  if (countBadge) {
    countBadge.textContent = queueEntries.length;
    
    // Update badge color
    countBadge.className = 'queue-count badge';
    if (queueEntries.length === 0) {
      countBadge.classList.add('bg-success');
    } else if (queueEntries.length <= 5) {
      countBadge.classList.add('bg-primary');
    } else if (queueEntries.length <= 10) {
      countBadge.classList.add('bg-warning', 'text-dark');
    } else {
      countBadge.classList.add('bg-danger');
    }
  }
}

// Format wait time for display
function formatWaitTime(minutes) {
  if (minutes < 60) {
    return `${minutes} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h${mins > 0 ? ` ${mins}min` : ''}`;
  }
}

// Format waiting time from timestamp
function formatWaitingTime(seconds) {
  if (seconds < 60) {
    return `${seconds} secondes`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} minutes`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`;
  }
}
