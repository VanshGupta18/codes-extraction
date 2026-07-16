"""Idle entrypoint for hsn-lookup-worker — real work runs via cf run-task."""
import time

print("hsn-lookup-worker ready (use cf run-task for batch / embedding index)", flush=True)
while True:
    time.sleep(3600)
