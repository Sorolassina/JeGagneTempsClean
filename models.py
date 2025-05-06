# models.py - Database models for our application
from app import db
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import enum
from datetime import date
from sqlalchemy import func

class SubscriptionStatus(enum.Enum):
    ACTIVE = "Actif"
    INACTIVE = "Inactif"
    EXPIRED = "Expiré"
    TRIAL = "Essai"
class UserType(enum.Enum):
    CUSTOMER = "customer"
    BUSINESS = "business"

class ServiceCategory(enum.Enum):
    HAIRDRESSER = "Coiffeur"
    RESTAURANT = "Restaurant"
    CAR_WASH = "Lavage Auto"
    OTHER = "Autre"

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), nullable=False)
    is_blocked = db.Column(db.Boolean, default=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    user_type = db.Column(db.Enum(UserType), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    oauth_provider = db.Column(db.String(20), nullable=True)
    
    # 💳 Abonnement
    subscription_status = db.Column(db.Enum(SubscriptionStatus), default=SubscriptionStatus.INACTIVE, nullable=False)
    subscription_start = db.Column(db.Date, nullable=True)
    subscription_end = db.Column(db.Date, nullable=True)

    # Relationships
    business = db.relationship('Business', backref='owner', uselist=False, cascade="all, delete-orphan")
    queue_entries = db.relationship('QueueEntry', backref='customer', lazy='dynamic', 
                                   foreign_keys='QueueEntry.customer_id', cascade="all, delete-orphan")
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
        
    def check_password(self, password):
        if self.password_hash:
            return check_password_hash(self.password_hash, password)
        return False
    
    def is_subscription_active(self):
        today = date.today()
        return (
            self.subscription_status == SubscriptionStatus.ACTIVE and
            self.subscription_end and self.subscription_end >= today
        )
    
    def __repr__(self):
        return f'<User {self.username}>'

class Review(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rating = db.Column(db.Integer, nullable=False)  # Note de 1 à 5
    comment = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Foreign keys
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    business_id = db.Column(db.Integer, db.ForeignKey("business.id"), nullable=False)

    # Relations
    user = db.relationship("User", backref="reviews")
    business = db.relationship("Business", backref="reviews")
    
class Business(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    address = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    category = db.Column(db.Enum(ServiceCategory), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    opening_hours = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)
    
    # Relationships
    services = db.relationship('Service', backref='business', lazy='dynamic', cascade="all, delete-orphan")
    
    @property
    def average_rating(self):
        result = db.session.query(func.avg(Review.rating)).filter_by(business_id=self.id).scalar()
        return result if result else 0
    
    def __repr__(self):
        return f'<Business {self.name}>'

class Service(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    business_id = db.Column(db.Integer, db.ForeignKey('business.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    duration_minutes = db.Column(db.Integer, default=10)
    price = db.Column(db.Float, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    
    # Relationships
    queue_entries = db.relationship('QueueEntry', backref='service', lazy='dynamic', cascade="all, delete-orphan")
    
    def __repr__(self):
        return f'<Service {self.name}>'
    
    def current_queue_size(self):
        return QueueEntry.query.filter_by(
            service_id=self.id, 
            status=QueueStatus.WAITING
        ).count()
    
    def estimated_wait_time(self):
        """Calculate estimated wait time in minutes based on queue size and service duration"""
        return self.current_queue_size() * self.duration_minutes


class QueueStatus(enum.Enum):
    WAITING = "waiting"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class QueueEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    service_id = db.Column(db.Integer, db.ForeignKey('service.id'), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    queue_position = db.Column(db.Integer, nullable=False)
    status = db.Column(db.Enum(QueueStatus), default=QueueStatus.WAITING)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    notified_at = db.Column(db.DateTime, nullable=True)
    confirmed = db.Column(db.Boolean, default=False)
    notification_seen = db.Column(db.Boolean, default=False)
    estimated_time = db.Column(db.DateTime, nullable=True)

    


    def __repr__(self):
        return f'<QueueEntry {self.id}: {self.status.value}>'
    
    @classmethod
    def get_next_position(cls, service_id):
        """Get the next available position in the queue for a service"""
        last_entry = cls.query.filter_by(
            service_id=service_id,
            status=QueueStatus.WAITING
        ).order_by(cls.queue_position.desc()).first()
        
        if last_entry:
            return last_entry.queue_position + 1
        return 1

class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    message = db.Column(db.String(255), nullable=False)
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='notifications')