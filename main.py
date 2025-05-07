# main.py - Entry point for our Flask application
from app import app
from views import *  # Import all routes
from google_auth import google_auth, get_google_auth_url, GOOGLE_OAUTH_CONFIGURED
from dotenv import load_dotenv
load_dotenv()

# Register blueprints
app.register_blueprint(google_auth)

# Ajouter des variables globales pour les templates
app.jinja_env.globals.update(
    GOOGLE_OAUTH_CONFIGURED=GOOGLE_OAUTH_CONFIGURED,
    get_google_auth_url=get_google_auth_url
)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))  # Utilisé par Render ou localement
    host = os.environ.get("HOST", "0.0.0.0")  # Par défaut: "0.0.0.0" pour accepter toutes les IPs
    app.run(host=host, port=port)