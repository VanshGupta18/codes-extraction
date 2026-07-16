import os
import pika
import json
import threading
import asyncio
from hdbcli import dbapi
import aicore_client

EVENT_MESH_URI = os.environ.get("EVENT_MESH_URI")
HANA_HOST = os.environ.get("HANA_HOST")
HANA_PORT = int(os.environ.get("HANA_PORT", "39015"))
HANA_USER = os.environ.get("HANA_USER")
HANA_PASSWORD = os.environ.get("HANA_PASSWORD")

def _get_hana_conn():
    if not HANA_HOST:
        return None
    return dbapi.connect(
        address=HANA_HOST,
        port=HANA_PORT,
        user=HANA_USER,
        password=HANA_PASSWORD
    )

def handle_message(ch, method, properties, body):
    payload = json.loads(body)
    print(f"[EventMesh] Received TariffApproved: {payload}")
    
    mat_num = payload.get("MaterialNumber")
    desc = payload.get("Description")
    
    if not mat_num or not desc:
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return
        
    # Asynchronously get embedding and save to HANA
    async def process():
        emb = await aicore_client.get_embedding(desc)
        conn = _get_hana_conn()
        if conn:
            cursor = conn.cursor()
            # Convert embedding to string for REAL_VECTOR insert
            emb_str = f"[{','.join(map(str, emb.tolist()))}]"
            try:
                cursor.execute(
                    'UPSERT "HSN_MATERIALEMBEDDINGS" ("MATERIALNUMBER", "EMBEDDING") VALUES (?, TO_REAL_VECTOR(?))',
                    (mat_num, emb_str)
                )
                conn.commit()
            except Exception as e:
                print(f"[EventMesh] DB Error: {e}")
            finally:
                cursor.close()
                conn.close()

    asyncio.run(process())
    ch.basic_ack(delivery_tag=method.delivery_tag)

def start_listener():
    if not EVENT_MESH_URI:
        print("[EventMesh] No URI configured. Listener not started.")
        return
        
    try:
        parameters = pika.URLParameters(EVENT_MESH_URI)
        connection = pika.BlockingConnection(parameters)
        channel = connection.channel()
        
        # Ensure queue exists and is bound to the topic
        queue_name = "hsn_lookup_queue"
        channel.queue_declare(queue=queue_name, durable=True)
        
        channel.basic_consume(queue=queue_name, on_message_callback=handle_message)
        print("[EventMesh] Started listening for TariffApproved events...")
        channel.start_consuming()
    except Exception as e:
        print(f"[EventMesh] Connection failed: {e}")

def start_background():
    t = threading.Thread(target=start_listener, daemon=True)
    t.start()
