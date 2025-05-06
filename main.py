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
    app.run(host="localhost", port=8000, debug=True)
