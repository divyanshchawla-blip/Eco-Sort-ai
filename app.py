import pandas as pd
import os
import numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import (
    MobileNetV2, preprocess_input, decode_predictions
)
from tensorflow.keras.preprocessing import image as keras_image
from PIL import Image
import io
import base64
from io import BytesIO

# --- 1. Load MobileNetV2 Model and Define Category Mappings ---
print("Loading pretrained AI model (MobileNetV2)... this happens once.")
model = MobileNetV2(weights="imagenet")
print("Model loaded. Ready to classify photos.\n")

CATEGORY_KEYWORDS = {
    "Hazardous / E-Waste": [
        "cellular_telephone", "iPod", "laptop", "notebook", "desktop_computer",
        "remote_control", "joystick", "modem", "hard_disc", "printer",
        "monitor", "screen", "digital_watch", "electric_fan", "microwave",
        "hair_dryer", "power_drill", "stopwatch", "cassette_player",
        "polaroid_camera", "radio", "loudspeaker", "projector"
    ],
    "Wet / Organic Waste": [
        "banana", "orange", "lemon", "pineapple", "strawberry", "fig",
        "pomegranate", "corn", "broccoli", "cauliflower", "zucchini",
        "cucumber", "artichoke", "mushroom", "bell_pepper", "head_cabbage",
        "spaghetti_squash", "acorn_squash", "butternut_squash", "cardoon",
        "custard_apple", "granny_smith", "hay"
    ],
    "Dry / Recyclable": [
        "pop_bottle", "water_bottle", "beer_bottle", "wine_bottle",
        "pill_bottle", "plastic_bag", "shopping_basket", "milk_can",
        "tin_can", "packet", "carton", "crate", "bucket", "envelope",
        "paper_towel", "book_jacket", "comic_book", "menu", "vase",
        "goblet", "beaker", "cocktail_shaker", "soup_bowl", "wooden_spoon",
        "paper_bag", "newspaper"
    ]
}

def map_to_waste_category(imagenet_label):
    """Takes a raw ImageNet label (e.g. 'water_bottle') and returns waste bin."""
    label_lower = imagenet_label.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw.replace("_", " ") in label_lower.replace("_", " "):
                return category
    return "General / Unclassified"

# --- 2. Python AI Backend Function ---
def classify_image_backend(image_b64_data):
    """Classifies a base64 encoded image using MobileNetV2 and maps to a waste category."""
    try:
        # Remove the 'data:image/png;base64,' prefix if present
        if ',' in image_b64_data:
            header, image_b64_data = image_b64_data.split(',', 1)

        image_bytes = base64.b64decode(image_b64_data)
        img = Image.open(BytesIO(image_bytes)).convert("RGB")

        # Preprocess for MobileNetV2 (needs 224x224)
        img_resized = img.resize((224, 224))
        x = keras_image.img_to_array(img_resized)
        x = np.expand_dims(x, axis=0)
        x = preprocess_input(x)

        # Run the real AI prediction
        preds = model.predict(x, verbose=0)
        top1 = decode_predictions(preds, top=1)[0][0] # Get the top prediction
        imagenet_label = top1[1]
        confidence = top1[2]

        # Map to waste category
        category = map_to_waste_category(imagenet_label)
        print(f"Classified as: {category} (ImageNet label: {imagenet_label}, Confidence: {confidence:.2f})")
        
        # Return all relevant classification details
        return {"object_name": imagenet_label, "confidence": float(confidence), "waste_category": category}

    except Exception as e:
        print(f"Error processing image in backend: {e}")
        return {"object_name": "error", "confidence": 0.0, "waste_category": "other"} # Fallback category

# --- 3. CSV Export Function and Price Mapping ---
CSV_FILE_PATH = 'classification_results.csv'

def export_to_csv(object_name, confidence, waste_category, price):
    """Exports classification results to a CSV file."""
    data = {
        'Object Name': [object_name],
        'Confidence': [confidence],
        'Waste Category': [waste_category],
        'Price (₹)': [price] if price is not None else [None],
        'Timestamp': [pd.Timestamp.now()]
    }
    df_new_row = pd.DataFrame(data)

    if not os.path.exists(CSV_FILE_PATH):
        # File doesn't exist, create with header
        df_new_row.to_csv(CSV_FILE_PATH, index=False)
        print(f"Created new CSV '{CSV_FILE_PATH}' and added classification result.")
    else:
        # File exists, append without header
        df_new_row.to_csv(CSV_FILE_PATH, mode='a', header=False, index=False)
        print(f"Appended classification result to '{CSV_FILE_PATH}'.")

# Define a simple way to get price from category, mirroring JS CATEGORY_INFO
category_prices = {
    "Wet / Organic Waste": 4,
    "Dry / Recyclable": 12,
    "Hazardous / E-Waste": 25,
    "General / Unclassified": 2
}

# Example of how you would use these functions in a backend API endpoint:
# (This part is illustrative and would be wrapped in a web framework like Flask/Django)
if __name__ == '__main__':
    print("\nThis is a demonstration of the backend functions.\n")
    # Simulate receiving image data (e.g., from a web request)
    # For testing, we'll use a dummy base64 string
    dummy_image_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    print("Simulating image classification...")
    classification_result = classify_image_backend(dummy_image_b64)
    
    if classification_result["waste_category"] != "error":
        object_name = classification_result["object_name"]
        confidence = classification_result["confidence"]
        waste_category = classification_result["waste_category"]
        price = category_prices.get(waste_category, None)

        print("\n--- Simulated Classification Result ---")
        print(f"Object Name: {object_name}")
        print(f"Confidence: {confidence:.2f}")
        print(f"Waste Category: {waste_category}")
        print(f"Assigned Price: ₹{price}")

        print("\nSimulating export to CSV...")
        export_to_csv(object_name, confidence, waste_category, price)
    else:
        print("Classification failed for dummy image.")