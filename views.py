# views.py - Route definitions for our application
import os
import logging
from flask import render_template, redirect, url_for, flash, request, jsonify, session, abort
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash
from app import app, db
from models import User,Notification, Business, Service, QueueEntry, UserType, ServiceCategory, QueueStatus, Review
from utils import get_nearby_businesses, calculate_distance, notify_admin_login
from datetime import datetime, timedelta
from flask_mail import Message
from app import app, mail
import random


@app.route("/admin_verify_code", methods=["GET", "POST"])
def admin_verify_code():
    if request.method == "POST":
        entered_code = request.form.get("code")
        stored_code = session.get("admin_code")
        expiration = session.get("admin_code_expiration")

        if not stored_code or not expiration:
            flash("Aucun code n’a été généré. Veuillez en demander un nouveau.", "warning")
            return redirect(url_for("admin_request_code"))

        if datetime.now() > datetime.fromisoformat(expiration):
            flash("Le code a expiré. Veuillez en demander un nouveau.", "warning")
            session.pop("admin_code", None)
            session.pop("admin_code_expiration", None)
            return redirect(url_for("admin_request_code"))

        if entered_code == stored_code:
            session.pop("admin_code", None)
            session.pop("admin_code_expiration", None)
            session["admin_authenticated"] = True
            flash("Connexion administrateur validée.", "success")
            return redirect(url_for("admin_users"))

        flash("Code incorrect. Veuillez réessayer.", "danger")

    return render_template("admin_verify_code.html")


# Home page route
@app.route('/')
def index():
    featured_businesses = Business.query.filter_by(is_active=True).limit(6).all()
    return render_template('index.html', featured_businesses=featured_businesses)

@app.route("/admin_request_code")
def admin_request_code():
    code = str(random.randint(100000, 999999))
    session["admin_code"] = code
    session["admin_code_expiration"] = (datetime.now() + timedelta(minutes=30)).isoformat()

    msg = Message("🔐 Code de connexion administrateur", recipients=[app.config["ADMIN_EMAIL"]])
    msg.body = f"Voici votre code de connexion administrateur : {code}\n\nIl est valable 30 minutes."

    try:
        mail.send(msg)
        flash("Un code temporaire a été envoyé à l'adresse de l'administrateur.", "info")
    except Exception as e:
        flash("Erreur lors de l'envoi de l'e-mail. Contactez le support.", "danger")
        print(f"Mail error: {e}")
    
    return redirect(url_for("admin_verify_code"))

@app.route("/admin_logout")
@login_required
def admin_logout():
    logout_user()
    session.pop("admin_mail_sent", None)
    flash("Déconnexion réussie.", "success")
    return redirect(url_for("index"))

@app.route("/admin/users")
def admin_users():
    if not session.get("admin_authenticated"):
        flash("Accès refusé. Authentification admin requise.", "danger")
        return redirect(url_for("admin_request_code"))
    # Affiche la page admin si authentifié
    users = User.query.all()
    return render_template("admin_users.html", users=users)

@app.route("/admin/users/<int:user_id>/toggle_block", methods=["POST"])
def toggle_user_block(user_id):
    if not session.get("admin_authenticated"):
        abort(403)
    user = User.query.get_or_404(user_id)
    user.is_blocked = not user.is_blocked
    db.session.commit()
    action = "bloqué" if user.is_blocked else "débloqué"
    flash(f"L'utilisateur {user.username} a été {action}.", "success")
    return redirect(url_for("admin_users"))

@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
def delete_user(user_id):
    if not session.get("admin_authenticated"):
        abort(403)
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    return redirect(url_for("admin_users"))


# Login route
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = User.query.filter_by(email=email).first()
        
        if user and user.check_password(password):
            login_user(user)
            next_page = request.args.get('next')
            if next_page:
                return redirect(next_page)
            return redirect(url_for('index'))
        else:
            flash('Email ou mot de passe incorrect.', 'danger')
    
    return render_template('login.html')

# Logout route
@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

# User registration route
@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    if request.method == 'POST':
        email = request.form.get('email')
        username = request.form.get('username')
        password = request.form.get('password')
        user_type = UserType.CUSTOMER
        
        # Check if user already exists
        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            flash('Un compte avec cet email existe déjà.', 'danger')
            return render_template('login.html')
            
        # Create new user
        new_user = User(
            username=username,
            email=email,
            user_type=user_type
        )
        new_user.set_password(password)
        
        db.session.add(new_user)
        db.session.commit()
        
        login_user(new_user)
        flash('Compte créé avec succès!', 'success')
        return redirect(url_for('index'))
        
    return render_template('login.html')

# Business registration route
@app.route('/register-business', methods=['GET', 'POST'])
@login_required
def register_business():
    if current_user.user_type == UserType.BUSINESS and current_user.business:
        return redirect(url_for('business_dashboard'))

    # ⚠️ Ajoute ceci AVANT d’afficher le template
    has_business = Business.query.filter_by(user_id=current_user.id).first() is not None

    if request.method == 'POST':
        name = request.form.get('name')
        description = request.form.get('description')
        address = request.form.get('address')
        phone = request.form.get('phone')
        category = ServiceCategory[request.form.get('category')] #ServiceCategory(request.form.get('category'))
        latitude = float(request.form.get('latitude'))
        longitude = float(request.form.get('longitude'))
        opening_hours = request.form.get('opening_hours')
        
        # Update user type
        current_user.user_type = UserType.BUSINESS
        
        # Create business
        business = Business(
            user_id=current_user.id,
            name=name,
            description=description,
            address=address,
            phone=phone,
            category=category,
            latitude=latitude,
            longitude=longitude,
            opening_hours=opening_hours
        )
        
        db.session.add(business)
        db.session.commit()
        
        flash('Entreprise enregistrée avec succès!', 'success')
        return redirect(url_for('business_dashboard'))
        
    return render_template('register_business.html', categories=ServiceCategory, has_business=has_business, google_maps_api_key=os.environ.get("GOOGLE_MAPS_API_KEY"))

# Business dashboard route
@app.route('/business-dashboard')
@login_required
def business_dashboard():
    if current_user.user_type != UserType.BUSINESS or not current_user.business:
        flash('Vous devez enregistrer votre entreprise pour accéder au tableau de bord.', 'warning')
        return redirect(url_for('register_business'))
        
    business = current_user.business
    services = business.services.all()
    
    # Get all active queue entries for each service
    queue_data = {}
    for service in services:
        queue_entries = QueueEntry.query.filter_by(
            service_id=service.id,
            status=QueueStatus.WAITING
        ).order_by(QueueEntry.queue_position).all()
        queue_data[service.id] = queue_entries
        
    return render_template('business_dashboard.html', 
                           business=business, 
                           services=services, 
                           queue_data=queue_data)

#Delete business route
@app.route("/business/<int:business_id>/delete", methods=["POST"])
@login_required
def delete_business(business_id):
    business = Business.query.get_or_404(business_id)
    
    #On se rassure que l'utilisateur est bien le propriétaire de l'entreprise
    if business.user_id != current_user.id:
        flash("Action non autorisée.", "danger")
        return redirect(url_for("business_dashboard"))

    db.session.delete(business)
    db.session.commit()
    flash("Entreprise supprimée avec succès.", "success")
    return redirect(url_for("business_dashboard"))


# Edit business route
@app.route("/business/<int:business_id>/edit", methods=["GET", "POST"])
@login_required
def edit_business(business_id):
    business = Business.query.get_or_404(business_id)

    #On se rassure que l'utilisateur est bien le propriétaire de l'entreprise
    if business.user_id != current_user.id:
        flash("Accès non autorisé.", "danger")
        return redirect(url_for("business_dashboard"))
    
    if request.method == "POST":
        business.name = request.form["name"]
        business.phone = request.form["phone"]
        business.description = request.form["description"]
        business.category = request.form["category"]
        business.address = request.form["address"]
        business.latitude = request.form["latitude"]
        business.longitude = request.form["longitude"]
        business.opening_hours = request.form["opening_hours"]
        db.session.commit()
        flash("Entreprise mise à jour avec succès.", "success")
        return redirect(url_for("business_dashboard"))

    return render_template("edit_business.html", business=business, categories=ServiceCategory,google_maps_api_key=os.environ.get("GOOGLE_MAPS_API_KEY"))


# Add service route
@app.route('/add-service', methods=['POST'])
@login_required
def add_service():
    if current_user.user_type != UserType.BUSINESS or not current_user.business:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
        
    name = request.form.get('name')
    description = request.form.get('description')
    duration_minutes = int(request.form.get('duration_minutes'))
    price = float(request.form.get('price')) if request.form.get('price') else None
    
    service = Service(
        business_id=current_user.business.id,
        name=name,
        description=description,
        duration_minutes=duration_minutes,
        price=price
    )
    
    db.session.add(service)
    db.session.commit()
    
    return redirect(url_for('business_dashboard'))

# Update queue status route
@app.route('/update-queue', methods=['POST'])
@login_required
def update_queue():
    if current_user.user_type != UserType.BUSINESS or not current_user.business:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
        
    entry_id = request.form.get('entry_id')
    status = QueueStatus(request.form.get('status'))
    
    entry = QueueEntry.query.get(entry_id)
    if not entry or entry.service.business_id != current_user.business.id:
        return jsonify({'success': False, 'error': 'Queue entry not found'}), 404
        
    entry.status = status
    db.session.commit()
    
    # If an entry is marked as completed/cancelled, update queue positions
    if status in [QueueStatus.COMPLETED, QueueStatus.CANCELLED]:
        update_queue_positions(entry.service_id, entry.queue_position)
    
    return redirect(url_for('business_dashboard'))

def update_queue_positions(service_id, removed_position):
    """Update queue positions after an entry is removed"""
    entries = QueueEntry.query.filter_by(
        service_id=service_id,
        status=QueueStatus.WAITING
    ).filter(QueueEntry.queue_position > removed_position).all()
    
    for entry in entries:
        entry.queue_position -= 1
    
    db.session.commit()

# Search for services route
@app.route('/search',methods=['GET', 'POST'])
def search():
    query = request.args.get('q', '')
    category = request.args.get('category', '')
    lat = request.args.get('latitude')
    lng = request.args.get('longitude')
    
    businesses = Business.query.filter_by(is_active=True)
    
    if category and category != 'all':
        try:
            cat_enum = ServiceCategory(category)
            businesses = businesses.filter_by(category=cat_enum)
        except ValueError:
            pass
    
    if query:
        businesses = businesses.filter(Business.name.ilike(f'%{query}%'))
    
    businesses = businesses.all()
    
    # Sort by distance if coordinates are provided
    if lat and lng:
        try:
            lat, lng = float(lat), float(lng)
            for business in businesses:
                business.distance = calculate_distance(lat, lng, business.latitude, business.longitude)
            businesses.sort(key=lambda b: b.distance)
        except (ValueError, TypeError):
            pass

    return render_template('search_results.html', 
                           businesses=businesses,
                           query=query,
                           category=category,
                           categories=ServiceCategory)

# Get nearby businesses API route
@app.route('/api/nearby-businesses')
def api_nearby_businesses():
    try:
        latitude = float(request.args.get('latitude'))
        longitude = float(request.args.get('longitude'))
        category = request.args.get('category')
        
        businesses = get_nearby_businesses(latitude, longitude, category)
        
        return jsonify({
            'success': True,
            'businesses': [
                {
                    'id': b.id,
                    'name': b.name,
                    'category': b.category.value,
                    'latitude': b.latitude,
                    'longitude': b.longitude,
                    'distance': b.distance,
                    'address': b.address
                } 
                for b in businesses
            ]
        })
    except Exception as e:
        logging.error(f"Error getting nearby businesses: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Service details route
@app.route('/service/<int:business_id>')
def service_details(business_id):
    business = Business.query.get_or_404(business_id)
    services = business.services.filter_by(is_active=True).all()
    
    for service in services:
        service.queue_size = service.current_queue_size()
        service.wait_time = service.estimated_wait_time()
    
    return render_template('service_details.html', business=business, services=services)

# Join queue route
@app.route('/join-queue/<int:service_id>', methods=['POST'])
@login_required
def join_queue(service_id):
    if current_user.user_type != UserType.CUSTOMER:
        flash('Les entreprises ne peuvent pas rejoindre une file d\'attente.', 'danger')
        return redirect(url_for('index'))

    service = Service.query.get_or_404(service_id)

    # Vérifie si l'utilisateur est déjà dans la file
    existing_entry = QueueEntry.query.filter_by(
        service_id=service_id,
        customer_id=current_user.id,
        status=QueueStatus.WAITING
    ).first()

    if existing_entry:
        flash('Vous êtes déjà dans cette file d\'attente.', 'warning')
    else:
        # Récupère la prochaine position
        next_position = QueueEntry.get_next_position(service_id)

        # Calcul de l'heure estimée de passage
        estimated = datetime.utcnow() + timedelta(minutes=(next_position - 1) * service.duration_minutes)

        # Création de l'entrée
        entry = QueueEntry(
            service_id=service_id,
            customer_id=current_user.id,
            queue_position=next_position,
            status=QueueStatus.WAITING,
            estimated_time=estimated
        )

        db.session.add(entry)
        db.session.commit()

        flash('Vous avez rejoint la file d\'attente avec succès!', 'success')

    return redirect(url_for('service_details', business_id=service.business_id))

# User profile route
@app.route('/profile', methods=['GET', 'POST'])
@login_required
def user_profile():
    # Get active queue entries for the user
    active_queues = QueueEntry.query.filter_by(
        customer_id=current_user.id,
        status=QueueStatus.WAITING
    ).all()
    
    for entry in active_queues:
        entry.business = entry.service.business
        entry.position = entry.queue_position
        entry.estimated_wait = entry.service.duration_minutes * (entry.queue_position - 1)
    
    return render_template('user_profile.html', active_queues=active_queues)

# Leave queue route
@app.route('/leave-queue/<int:entry_id>', methods=['POST'])
@login_required
def leave_queue(entry_id):
    entry = QueueEntry.query.get_or_404(entry_id)
    
    if entry.customer_id != current_user.id:
        flash('Vous n\'êtes pas autorisé à effectuer cette action.', 'danger')
        return redirect(url_for('user_profile'))
    
    service_id = entry.service_id
    position = entry.queue_position
    
    entry.status = QueueStatus.CANCELLED
    db.session.commit()
    
    # Update queue positions
    update_queue_positions(service_id, position)
    
    flash('Vous avez quitté la file d\'attente.', 'success')
    return redirect(url_for('user_profile'))

@app.route("/business/<int:business_id>")
def business_detail(business_id):
    business = Business.query.get_or_404(business_id)
    return render_template("business_detail.html", business=business)

@app.route("/business/<int:business_id>/reviews")
def load_reviews(business_id):
    business = Business.query.get_or_404(business_id)
    reviews = Review.query.filter_by(business_id=business.id).order_by(Review.id.desc()).all()
    return render_template("review_list.html", reviews=reviews)

#Soumission des avis
@app.route("/business/<int:business_id>/review", methods=["POST", "GET"])
@login_required
def submit_review(business_id):
    business = Business.query.get_or_404(business_id)
    rating = request.form.get("rating")
    comment = request.form.get("comment", "").strip()
    print("✅business_id:", business_id)
   
    if not rating:
        flash("Veuillez sélectionner une note.", "warning")
        return redirect(url_for("search"))

    # Vérifie si un avis existe déjà
    existing = Review.query.filter_by(user_id=current_user.id, business_id=business_id).first()
    if existing:
        existing.rating = rating
        existing.comment = comment
        flash("Votre avis a été mis à jour.", "info")
    else:
        new_review = Review(
            rating=rating,
            comment=comment,
            user_id=current_user.id,
            business_id=business.id
        )
        db.session.add(new_review)
        flash("Merci pour votre avis !", "success")

    db.session.commit()

    flash("Merci pour votre avis !", "success")
    return redirect(url_for("search"))


@app.route('/notification/<int:id>/read', methods=['POST'])
@login_required
def mark_notification_read(id):
    notif = Notification.query.get_or_404(id)
    if notif.user_id != current_user.id:
        abort(403)
    notif.is_read = True
    db.session.commit()
    return redirect(request.referrer or url_for('index'))

# Error handlers
@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html', error_code=404, message="Page non trouvée"), 404

@app.errorhandler(500)
def server_error(e):
    return render_template('error.html', error_code=500, message="Erreur serveur"), 500
