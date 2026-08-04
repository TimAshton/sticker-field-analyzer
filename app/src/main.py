import os
import cv2
from ultralytics import YOLO
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from PIL import Image


# -------------------------------------------------------------
# 1. SETUP TOOLS (Downloading models happens automatically here)
# -------------------------------------------------------------
print("🔄 Loading AI Models... (This takes a moment on run #1)")
yolo_model = YOLO("yolov8n.pt") 
clip_model = SentenceTransformer("clip-ViT-B-32")

# Spin up a local, in-memory database
qdrant = QdrantClient(":memory:")
qdrant.create_collection(
    collection_name="street_stickers",
    vectors_config=VectorParams(size=512, distance=Distance.COSINE),
)

# -------------------------------------------------------------
# 2. SEED THE DATABASE (Cataloging your first baseline "Pokemon")
# -------------------------------------------------------------
def catalog_master_sticker(id_num, image_path, artist, design_name):
    if not os.path.exists(image_path):
        print(f"⚠️ Missing baseline image: {image_path}. Skipping catalog seed.")
        return
        
    # Open using PIL instead of cv2 for CLIP compatibility
    pil_img = Image.open(image_path)
    embedding = clip_model.encode(pil_img).tolist() 
    
    # Store it in Qdrant...
    qdrant.upsert(
        collection_name="street_stickers",
        points=[
            PointStruct(
                id=id_num,
                vector=embedding,
                payload={"artist": artist, "design_name": design_name}
            )
        ]
    )
    print(f"✅ Cataloged Baseline: '{design_name}' by {artist}!")

# -------------------------------------------------------------
# 3. THE LIVE WORKFLOW PIPELINE (Your Flowchart)
# -------------------------------------------------------------
from transformers import Owlv2Processor, Owlv2ForObjectDetection
import torch

print("🔄 Loading OwLv2 Sticker Locator AI...")
# Load the open-vocabulary object detector
owl_processor = Owlv2Processor.from_pretrained("google/owlv2-base-patch16-ensemble")
owl_model = Owlv2ForObjectDetection.from_pretrained("google/owlv2-base-patch16-ensemble")

def scan_street_wall(field_image_path, geo_location):
    if not os.path.exists(field_image_path):
        print(f"❌ Error: Cannot find your street photo at {field_image_path}")
        return

    processed_dir = "processed_stickers"
    os.makedirs(processed_dir, exist_ok=True)

    print(f"\n🧠 AI is scanning the wall layout for stickers: {field_image_path}...")
    image_cv = cv2.imread(field_image_path)
    image_pil = Image.open(field_image_path).convert("RGB")
    
    # 🎯 Instruct the AI exactly what physical objects to isolate on the wall
    texts = [["a street sticker", "a label", "a vinyl decal"]]
    inputs = owl_processor(text=texts, images=image_pil, return_tensors="pt")
    
    with torch.no_grad():
        outputs = owl_model(**inputs)
    
    # Process target boundaries and filter by a confidence threshold
    target_sizes = torch.tensor([image_pil.size[::-1]])
    results = owl_processor.post_process_object_detection(outputs, target_sizes=target_sizes, threshold=0.15)
    
    boxes = results[0]["boxes"]
    scores = results[0]["scores"]
    
    print(f"🎯 Vision AI pinpointed {len(boxes)} distinct sticker boundaries on the wall.")

    sticker_count = 0
    for box, score in zip(boxes, scores):
        x1, y1, x2, y2 = map(int, box.tolist())
        
        # Buffer the box safely to make sure we don't truncate a jagged tail edge
        padding = 35 # 👈 Increased slightly to give asymmetric shapes breathing room
        y1_pad = max(0, y1 - padding)
        y2_pad = min(image_cv.shape[0], y2 + padding)
        x1_pad = max(0, x1 - padding)
        x2_pad = min(image_cv.shape[1], x2 + padding)
        
        rough_crop = image_cv[y1_pad:y2_pad, x1_pad:x2_pad]
        if rough_crop.size == 0 or rough_crop.shape[0] < 50 or rough_crop.shape[1] < 50:
            continue

        # 🎯 ADVANCED DIE-CUT MASKING UPGRADE
        gray_crop = cv2.cvtColor(rough_crop, cv2.COLOR_BGR2GRAY)
        blurred_crop = cv2.GaussianBlur(gray_crop, (5, 5), 0)
        
        # Pull sharp structural border lines out of the crop window
        edges = cv2.Canny(blurred_crop, 30, 150)
        
        # Thickens structural lines to securely close the outermost loop shape
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        dilated_edges = cv2.dilate(edges, kernel, iterations=1)
        
        crop_contours, _ = cv2.findContours(dilated_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if crop_contours:
            # Target the absolute largest layout boundary inside this region
            largest_contour = max(crop_contours, key=cv2.contourArea)
            cx, cy, cw, ch = cv2.boundingRect(largest_contour)
            
            # Guardrail: Check that our boundary tracking didn't shrink down to zero
            if cw > 40 and ch > 40:
                sticker_crop = rough_crop[cy:cy+ch, cx:cx+cw]
            else:
                sticker_crop = image_cv[max(0, y1):min(image_cv.shape[0], y2), max(0, x1):min(image_cv.shape[1], x2)]
        else:
            # Fallback to straight AI box coordinates if no distinct borders form
            sticker_crop = image_cv[max(0, y1):min(image_cv.shape[0], y2), max(0, x1):min(image_cv.shape[1], x2)]

        # 💾 Save out to the clean processed output folder asset directory
        crop_filename = os.path.join(processed_dir, f"extracted_sticker_{sticker_count}.png")
        cv2.imwrite(crop_filename, sticker_crop)
        print(f"💾 Refined die-cut custom asset saved: {crop_filename}")
        
        # --- (Your working PIL conversion and Qdrant matching logic connects right here) ---
        sticker_count += 1




# -------------------------------------------------------------
# 4. EXECUTION
# -------------------------------------------------------------
# Step A: Teach our database what your sticker looks like using your sample image
print("🌱 Seeding the database catalog using your sample image...")
catalog_master_sticker(
    id_num=1, 
    image_path="raw_sticker_fields/sample_001.jpg", 
    artist="ObeyGiant", 
    design_name="Space Banana"
)

# Step B: Bypass the YOLO detector filter and force the image straight into CLIP to test the RAG match!
print("\n🧪 Testing database matching bypass...")
if os.path.exists("raw_sticker_fields/sample_001.jpg"):
    
    pil_crop = Image.open("raw_sticker_fields/sample_001.jpg")
    crop_embedding = clip_model.encode(pil_crop).tolist() 
    
    # 🔎 Query Engine Syntax
    search_results = qdrant.query_points(
        collection_name="street_stickers",
        query=crop_embedding,
        limit=1
    ).points
    
    if search_results:
        best_match = search_results[0]
        matched_card = best_match.payload
        print(f"✨ MATCH FOUND!")
        
        prompt = f"""\n[LLM PROMPT GENERATED]:
        Here is a newly spotted sticker at Portland, OR. 
        Our database says it matches Artist {matched_card['artist']}'s design '{matched_card['design_name']}'. 
        Please format a new Pokédex catalog entry!"""
        print(prompt)
    else:
        print("❓ Result: No database match found.")
else:
    print("Could not find file for test bypass.")


# Step C: Scan a messy photo containing that sticker somewhere on the wall
scan_street_wall(
    field_image_path="raw_sticker_fields/sample_001.jpg", 
    geo_location="Portland, OR - Mississippi"
)
