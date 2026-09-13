"""Shared Flask app fixture for route tests."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402


@pytest.fixture()
def app():
    # Ensure no real network calls are possible during tests.
    os.environ["GEMINI_API_KEY"] = ""
    os.environ["HUGGINGFACE_API_KEY"] = ""
    return create_app()


@pytest.fixture()
def client(app):
    return app.test_client()
