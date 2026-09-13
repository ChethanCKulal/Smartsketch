import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

from routes.health import health_bp
from routes.recognize import recognize_bp
from routes.chat import chat_bp
from routes.export import export_bp

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv()

def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "8")) * 1024 * 1024
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(recognize_bp, url_prefix="/api")
    app.register_blueprint(chat_bp, url_prefix="/api")
    app.register_blueprint(export_bp, url_prefix="/api")
    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=True)
