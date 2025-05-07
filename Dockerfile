# Utilise une image légère de Python
FROM python:3.11-slim

# Définir le répertoire de travail
COPY . /app
WORKDIR /app

# Copier les fichiers de requirements (installe plus vite avec cache)
COPY requirements.txt .

# Installer les dépendances
RUN pip install --no-cache-dir -r requirements.txt

# Copier le reste de l'application
COPY . .

# Exposer le port utilisé par Flask
EXPOSE 8000

# Définir la variable d'environnement pour Flask
ENV FLASK_APP=main.py

# Commande de lancement (Render ou Docker Compose la redéfinit)
CMD ["python", "main.py"]