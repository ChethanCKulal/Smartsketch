
import os
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HUGGINGFACE_API_KEY")

if not token:
    print("Token not found. Check the variable name in .env.")
else:
    response = requests.get(
        "https://huggingface.co/api/whoami-v2",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20
    )
    print("Authentication status:", response.status_code)
    if response.ok:
        print("Account being used:", response.json().get("name"))
    else:
        print("Response:", response.text[:300])
