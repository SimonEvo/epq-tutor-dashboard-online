#!/bin/bash
# Deploy both frontend and backend.
# Usage: ./deploy.sh [server_ip]
SERVER=${1:-121.43.194.213}

echo "=== Deploying backend ==="
cd "$(dirname "$0")/epq-tutor-backend"
rsync -avz --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.env' --exclude='*.db' \
  ./ root@$SERVER:/opt/epq-tutor-backend/
ssh root@$SERVER "systemctl restart epq-tutor && systemctl status epq-tutor --no-pager -l"

echo ""
echo "=== Deploying frontend ==="
cd ../tutoring-system
npm run build && rsync -avz dist/ root@$SERVER:/opt/epq-tutor/dist/

echo ""
echo "=== Deploying gantt-pro ==="
ssh root@$SERVER "mkdir -p /opt/gantt-pro"
rsync -avz ../gantt-chart-tool/gantt-pro.html root@$SERVER:/opt/gantt-pro/gantt-pro.html

echo ""
echo "=== Done ==="
