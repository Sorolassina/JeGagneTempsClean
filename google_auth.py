# google_auth.py - Google OAuth authentication blueprint
import json
import os
import logging
import requests
from app import db
from flask import Blueprint, redirect, request, url_for, flash
from flask_login import login_required, login_user, logout_user
from models import User, UserType
from oauthlib.oauth2 import WebApplicationClient
from dotenv import load_dotenv
load_dotenv()

# Check if Google OAuth credentials are available
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"

# Get the redirect URL from environment or use development domain
REPLIT_DEV_DOMAIN = os.environ.get("REPLIT_DEV_DOMAIN", "localhost")
#DEV_REDIRECT_URL = f'https://{REPLIT_DEV_DOMAIN}/google_login/callback'
DEV_REDIRECT_URL = os.environ.get("REDIRECT_URI")
# Check if Google OAuth is configured
GOOGLE_OAUTH_CONFIGURED = GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET

# Display setup instructions if Google OAuth is not configured
if not GOOGLE_OAUTH_CONFIGURED:
    print("""
NOTICE: Google OAuth is not configured. The 'Sign in with Google' option will be disabled.
To enable Google authentication:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Add the callback URL to Authorized redirect URIs
4. Set the GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables
""")
else:
    print(f"""
Google OAuth is configured! Users can sign in with their Google accounts.
Callback URL: {DEV_REDIRECT_URL}
""")

# Initialize OAuth client only if credentials are available
client = WebApplicationClient(GOOGLE_CLIENT_ID) if GOOGLE_OAUTH_CONFIGURED else None

google_auth = Blueprint("google_auth", __name__)

@google_auth.route("/google_login")
def login():
    if not client:
        flash("Google OAuth n'est pas configuré.", "danger")
        return redirect(url_for("login"))
        
    # Get Google's OAuth 2.0 provider configuration
    try:
        # Ajouter un timeout court pour éviter les longs délais de réponse
        google_provider_cfg = requests.get(GOOGLE_DISCOVERY_URL, timeout=5).json()
        authorization_endpoint = google_provider_cfg["authorization_endpoint"]

        # Use the hardcoded redirect URL
        callback_url = DEV_REDIRECT_URL
        
        # Log the callback URL being used
        logging.info(f"Using Google callback URL: {callback_url}")
        print(f"OAUTH DEBUG: Callback URL = {callback_url}")
        print(f"OAUTH DEBUG: Auth endpoint = {authorization_endpoint}")
        print(f"OAUTH DEBUG: REPLIT_DEV_DOMAIN = {REPLIT_DEV_DOMAIN}")
        
        # Enregistrez la URL complète pour vérification
        if GOOGLE_CLIENT_ID:
            print(f"CLIENT_ID: {GOOGLE_CLIENT_ID[:5]}...{GOOGLE_CLIENT_ID[-5:]}")
        else:
            print("CLIENT_ID: Non configuré")
        
        # Créer l'URL manuellement pour contourner des problèmes potentiels
        manual_uri = (
            f"{authorization_endpoint}?"
            f"client_id={GOOGLE_CLIENT_ID}&"
            f"redirect_uri={callback_url}&"
            f"response_type=code&"
            f"scope=openid%20email%20profile&"
            f"prompt=select_account"
        )
        
        # Log l'URL manuelle pour débogage
        print(f"OAUTH DEBUG: URL manuelle créée = {manual_uri}")
        
        # Utiliser l'approche client pour comparaison
        request_uri = client.prepare_request_uri(
            authorization_endpoint,
            redirect_uri=callback_url,
            scope=["openid", "email", "profile"],
            prompt="select_account",  # Force the Google account selector screen
        )
        
        # Log l'URL client pour débogage
        print(f"OAUTH DEBUG: URL client créée = {request_uri}")
        
        # Utiliser l'URL manuelle puisqu'elle fonctionne mieux
        final_uri = manual_uri
        return redirect(final_uri)
    except Exception as e:
        logging.error(f"Error initiating Google login: {str(e)}")
        flash("Une erreur s'est produite lors de la connexion avec Google.", "danger")
        return redirect(url_for("login"))

@google_auth.route("/google_login/callback")
def callback():
    if not client:
        flash("Google OAuth n'est pas configuré.", "danger")
        return redirect(url_for("login"))
        
    try:
        # Get authorization code from Google
        code = request.args.get("code")
        # Ajouter un timeout court pour éviter les longs délais de réponse
        google_provider_cfg = requests.get(GOOGLE_DISCOVERY_URL, timeout=5).json()
        token_endpoint = google_provider_cfg["token_endpoint"]

        # Use the same hardcoded redirect URL as in the login function
        callback_url = DEV_REDIRECT_URL
        full_callback_url = f"{callback_url}?{request.query_string.decode()}"
        
        # Log detailed information for debugging
        print(f"OAUTH DEBUG: Processing callback with URL: {full_callback_url}")
        print(f"OAUTH DEBUG: Token endpoint = {token_endpoint}")
        print(f"OAUTH DEBUG: Code received = {code}")
        print(f"OAUTH DEBUG: Query string = {request.query_string.decode()}")
        
        # Log the callback URL being used
        logging.info(f"Processing callback with URL: {full_callback_url}")

        # Prepare and send request to get tokens
        token_url, headers, body = client.prepare_token_request(
            token_endpoint,
            authorization_response=full_callback_url,
            redirect_url=callback_url,
            code=code,
        )
        # Make sure the credentials are not None
        if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
            logging.error("Google OAuth credentials are not set properly")
            flash("Erreur de configuration OAuth", "danger")
            return redirect(url_for("login"))
            
        # Log that we're making the token request
        logging.info(f"Making token request to: {token_url}")
        
        token_response = requests.post(
            token_url,
            headers=headers,
            data=body,
            auth=(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
            timeout=10  # Ajouter un timeout pour éviter les longs délais
        )
        
        # Log the status of the response
        logging.info(f"Token response status: {token_response.status_code}")

        # Parse the tokens
        client.parse_request_body_response(json.dumps(token_response.json()))

        # Get user info from Google
        userinfo_endpoint = google_provider_cfg["userinfo_endpoint"]
        uri, headers, body = client.add_token(userinfo_endpoint)
        userinfo_response = requests.get(uri, headers=headers, data=body, timeout=10)

        # Verify user info
        userinfo = userinfo_response.json()
        if userinfo.get("email_verified"):
            users_email = userinfo["email"]
            users_name = userinfo.get("given_name", users_email.split('@')[0])
        else:
            flash("L'email Google n'est pas vérifié.", "danger")
            return redirect(url_for("login"))

        # Check if user exists, create if not
        user = User.query.filter_by(email=users_email).first()
        if not user:
            user = User(
                username=users_name, 
                email=users_email, 
                user_type=UserType.CUSTOMER,
                oauth_provider="google"
            )
            db.session.add(user)
            db.session.commit()

        # Log in the user
        login_user(user)
        flash(f"Bienvenue, {user.username}!", "success")
        return redirect(url_for("index"))
        
    except Exception as e:
        logging.error(f"Error during Google callback: {str(e)}")
        
        # Log more detailed information about the error
        import traceback
        error_traceback = traceback.format_exc()
        logging.error(f"Detailed error traceback: {error_traceback}")
        
        # Display detailed error for debugging purposes
        error_details = str(e)
        print(f"OAUTH ERROR DETAILS: {error_details}")
        
        # Check for specific common OAuth errors
        if "redirect_uri_mismatch" in error_details.lower():
            # Utiliser l'URL de callback fixe pour être sûr
            flash(f"Erreur d'authentification: L'URL de redirection ne correspond pas à celle configurée dans la console Google. Veuillez vérifier vos paramètres OAuth. URL utilisée: {DEV_REDIRECT_URL}", "danger")
        elif "invalid_client" in error_details.lower():
            flash("Erreur d'authentification: ID client ou secret invalide. Vérifiez vos identifiants OAuth.", "danger")
        elif "access_denied" in error_details.lower():
            flash("Vous avez refusé l'accès à votre compte Google.", "warning")
        else:
            flash(f"Erreur Google OAuth: {error_details}", "danger")
        
        return redirect(url_for("login"))

# Fonction pour obtenir l'URL d'authentification Google
def get_google_auth_url():
    """Génère l'URL d'authentification Google à utiliser partout dans l'application"""
    try:
        google_provider_cfg = requests.get(GOOGLE_DISCOVERY_URL, timeout=5).json()
        authorization_endpoint = google_provider_cfg["authorization_endpoint"]
        
        # Créer manuellement l'URL
        manual_uri = (
            f"{authorization_endpoint}?"
            f"client_id={GOOGLE_CLIENT_ID}&"
            f"redirect_uri={DEV_REDIRECT_URL}&"
            f"response_type=code&"
            f"scope=openid%20email%20profile&"
            f"prompt=select_account"
        )
        return manual_uri
    except Exception as e:
        logging.error(f"Error generating Google auth URL: {str(e)}")
        return None
        
@google_auth.route("/oauth-test")
def oauth_test():
    """Route de test pour afficher les informations de configuration OAuth"""
    oauth_info = {
        "GOOGLE_OAUTH_CONFIGURED": GOOGLE_OAUTH_CONFIGURED,
        "CLIENT_ID_PREFIX": (GOOGLE_CLIENT_ID[:8] + "...") if GOOGLE_CLIENT_ID else "Non configuré",
        "CLIENT_SECRET_PREFIX": (GOOGLE_CLIENT_SECRET[:3] + "...") if GOOGLE_CLIENT_SECRET else "Non configuré",
        "REPLIT_DEV_DOMAIN": REPLIT_DEV_DOMAIN,
        "CALLBACK_URL": DEV_REDIRECT_URL,
    }
    
    # Obtenir l'URL d'authentification
    manual_uri = get_google_auth_url()
    
    # Ajouter l'URL au dictionnaire
    oauth_info["MANUAL_AUTH_URL"] = manual_uri
    
    # Préparer la réponse HTML
    html = "<h1>Google OAuth Configuration</h1>"
    html += "<ul>"
    for key, value in oauth_info.items():
        html += f"<li><strong>{key}:</strong> {value}</li>"
    html += "</ul>"
    
    html += "<h2>Instructions pour Google Cloud Console</h2>"
    html += "<ol>"
    html += f"<li>URI JavaScript autorisées: <code>https://{REPLIT_DEV_DOMAIN}</code></li>"
    html += f"<li>URI de redirection autorisées: <code>{DEV_REDIRECT_URL}</code></li>"
    html += "</ol>"
    
    html += f'<p><a href="{manual_uri}" class="btn btn-primary">Tester connexion Google (URL manuelle)</a></p>'
    
    return html

@google_auth.route("/logout-google")
@login_required
def logout():
    logout_user()
    flash("Vous avez été déconnecté.", "success")
    return redirect(url_for("index"))
