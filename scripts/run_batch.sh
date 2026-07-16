#!/bin/bash
echo "Starting CAP Server..."
(cd cap && npm run start) &
CAP_PID=$!

echo "Waiting 5 seconds for CAP to initialize..."
sleep 5

echo "Starting FastAPI Server..."
(cd lookup-service && source .venv/bin/activate && uvicorn main:app --port 8000) &
FAST_PID=$!

echo "Waiting for FastAPI to initialize..."
while ! curl -s http://localhost:8000/openapi.json > /dev/null; do
  sleep 2
done

echo "Starting Batch Job..."
source lookup-service/.venv/bin/activate
python3 scripts/btp_batch_job.py

echo "Cleaning up processes..."
kill $CAP_PID
kill $FAST_PID
echo "Done."
