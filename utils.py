# utils.py - Utility functions for our application
import math
from models import Business, ServiceCategory, QueueEntry
from flask import request
from flask_mail import Message
from datetime import datetime, timedelta
from app import mail
from app import db
from app import app
from datetime import datetime, timedelta
from models import  Notification, QueueEntry  # à adapter à tes modèles exacts
from twilio.rest import Client
import os

def calculate_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the Haversine distance between two points 
    on the earth (specified in decimal degrees)
    """
    # Convert decimal degrees to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])

    # Haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371  # Radius of earth in kilometers
    return c * r

def get_nearby_businesses(latitude, longitude, category=None, max_distance=10):
    """
    Get businesses within a certain distance from the given coordinates
    Optionally filtered by category
    """
    businesses = Business.query.filter_by(is_active=True).all()
    nearby_businesses = []
    
    for business in businesses:
        if business.latitude and business.longitude:
            distance = calculate_distance(
                latitude, 
                longitude, 
                business.latitude, 
                business.longitude
            )
            
            # Filter by category if specified
            if category and category != 'all':
                try:
                    cat_enum = ServiceCategory(category)
                    if business.category != cat_enum:
                        continue
                except ValueError:
                    pass
            
            if distance <= max_distance:
                business.distance = distance
                nearby_businesses.append(business)
    
    # Sort by distance
    nearby_businesses.sort(key=lambda b: b.distance)
    
    return nearby_businesses

def format_distance(distance):
    """Format distance in km or m"""
    if distance < 1:
        return f"{int(distance * 1000)} m"
    else:
        return f"{distance:.1f} km"

def format_waiting_time(minutes):
    """Format waiting time in hours and minutes"""
    if minutes < 60:
        return f"{minutes} min"
    else:
        hours = minutes // 60
        mins = minutes % 60
        return f"{hours}h {mins}min"

def notify_admin_login(user):
    msg = Message(
        subject="🚨 Connexion administrateur détectée",
        sender="sorolassina58@gmail.com",
        recipients=[user.email]
    )

    # Version texte brut fallback (obligatoire pour certains clients mail)
    msg.body = f"""
Connexion admin détectée pour {user.username}

Date : {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
IP : {request.remote_addr}
Navigateur : {request.user_agent.string}
Email : {user.email}
"""

    # Version HTML
    msg.html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background-color: #f7f7f7; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 6px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <h2 style="color: #333333;">🔐 Connexion Administrateur Détectée</h2>
            <p>Bonjour <strong>{user.username}</strong>,</p>
            <p>Une connexion à votre compte administrateur vient d’être enregistrée avec les informations suivantes :</p>
            <ul style="line-height: 1.6;">
                <li><strong>🕒 Date :</strong> {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}</li>
                <li><strong>🌍 IP :</strong> {request.remote_addr}</li>
                <li><strong>🧭 Navigateur :</strong> {request.user_agent.string}</li>
                <li><strong>📧 Email :</strong> {user.email}</li>
            </ul>
            <p style="margin-top: 20px;">Si vous n'êtes pas à l'origine de cette connexion, contactez immédiatement le support.</p>
            <p style="color: #888; font-size: 0.9em;">— L'équipe Je Gagne Temps</p>
        </div>
    </body>
    </html>
    """
    mail.send(msg)

def send_sms(to_number, message):
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_PHONE_NUMBER")

    if not all([account_sid, auth_token, from_number]):
        print("❌ Informations Twilio manquantes dans le .env")
        return

    try:
        client = Client(account_sid, auth_token)
        client.messages.create(
            body=message,
            from_=from_number,
            to=to_number
        )
        print(f"✅ SMS envoyé à {to_number}")
    except Exception as e:
        print(f"❌ Erreur d’envoi SMS : {e}")

def notify_upcoming_customers():
    now = datetime.utcnow()
    upcoming_entries = QueueEntry.query.filter(
        QueueEntry.estimated_time <= now + timedelta(minutes=10),
        QueueEntry.estimated_time > now,
        QueueEntry.notified_at == None
    ).all()

    for entry in upcoming_entries:
        # Envoyer SMS et notifier
        send_sms(entry.user.phone, "Votre passage est dans 10 minutes.")
        entry.notified_at = now
        db.session.commit()

def check_missed_appointments():
    now = datetime.utcnow()
    entries = QueueEntry.query.filter(
        QueueEntry.estimated_time <= now - timedelta(minutes=2),
        QueueEntry.confirmed == False
    ).all()

    for entry in entries:
        # Récupérer l'entrée suivante
        next_entry = QueueEntry.query.filter_by(service_id=entry.service_id)\
            .filter(QueueEntry.position == entry.position + 1).first()
        
        if next_entry:
            # Échange des positions
            entry.position += 1
            next_entry.position -= 1

            send_sms(entry.user.phone, "Vous avez manqué votre tour, votre position a été décalée.")
            send_sms(next_entry.user.phone, "Votre tour est avancé !")
            db.session.commit()

def create_notification(user_id, message):
    notif = Notification(user_id=user_id, message=message)
    db.session.add(notif)
    db.session.commit()

@app.cli.command("check_upcoming_turns")
def check_upcoming_turns():
    now = datetime.utcnow()
    upcoming_time = now + timedelta(minutes=10)
    
    queues = QueueEntry.query.filter(
        QueueEntry.estimated_time <= upcoming_time,
        QueueEntry.notified == False
    ).all()
    
    for q in queues:
        user = q.user
        # Envoie SMS
        send_sms(user.phone, f"⏰ Votre passage est prévu dans 10 minutes pour le service {q.service.name}.")
        # Crée une notification persistante
        create_notification(user.id, f"Préparez-vous ! Votre tour arrive dans 10 minutes.")
        # Marque comme notifié
        q.notified = True
        db.session.commit()

def get_next_user(service_id):
    return (
        QueueEntry.query
        .filter_by(service_id=service_id)
        .order_by(QueueEntry.queue_position.asc())
        .first()
    )

@app.cli.command("reorganize_queue")
def reorganize_queue():
    now = datetime.utcnow()
    late_queues = QueueEntry.query.filter(
        QueueEntry.estimated_time < now,
        QueueEntry.confirmed == False,
        QueueEntry.status == "WAITING"
    ).all()
    
    for q in late_queues:
        next_user = get_next_user(q.service_id, q.position + 1)
        if next_user:
            # Inverse les positions
            q.position, next_user.position = next_user.position, q.position
            db.session.commit()
            
            send_sms(q.user.phone, "⚠️ Vous avez été retardé. Votre place a été échangée avec la suivante.")
            send_sms(next_user.user.phone, "🎉 Vous passez maintenant plus tôt dans la file.")
            
            create_notification(q.user.id, "Votre place a été échangée à cause d’un retard.")
            create_notification(next_user.user.id, "Bonne nouvelle ! Vous passez plus tôt.")

