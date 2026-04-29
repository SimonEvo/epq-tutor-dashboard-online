#!/bin/bash
# Usage: ./deploy.sh [server_ip]
SERVER=${1:-121.43.194.213}

rsync -avz --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.env' --exclude='*.db' \
  ./ root@$SERVER:/opt/epq-tutor-backend/

ssh root@$SERVER "systemctl restart epq-tutor && systemctl status epq-tutor --no-pager -l"
