#!/bin/bash
# Run on the Alibaba Cloud server as root.
# Usage: bash setup.sh

set -e

echo "=== 1. Install MySQL ==="
apt update -y
apt install mysql-server nginx -y
systemctl start mysql
systemctl enable mysql

echo "=== 2. Configure MySQL memory limit ==="
cat >> /etc/mysql/mysql.conf.d/mysqld.cnf << 'EOF'
innodb_buffer_pool_size = 128M
EOF
systemctl restart mysql

echo "=== 3. Create MySQL database and user ==="
read -p "Enter MySQL password for epq_user: " DB_PASS
mysql -e "CREATE DATABASE IF NOT EXISTS epq_tutor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS 'epq_user'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON epq_tutor.* TO 'epq_user'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

echo "=== 4. Set up backend ==="
mkdir -p /opt/epq-tutor-backend
cp -r . /opt/epq-tutor-backend/
cd /opt/epq-tutor-backend

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

echo "Edit .env before continuing:"
cp .env.example .env
echo "  DATABASE_URL=mysql+pymysql://epq_user:${DB_PASS}@localhost:3306/epq_tutor"
echo "  Set SECRET_KEY, TUTOR_USERNAME, TUTOR_PASSWORD in .env"
read -p "Press Enter after editing .env..."

echo "=== 5. Run migrations ==="
.venv/bin/alembic upgrade head

echo "=== 6. Create tutor account ==="
.venv/bin/python init_tutor.py

echo "=== 7. Install systemd service ==="
cp deploy/epq-tutor.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable epq-tutor
systemctl start epq-tutor

echo "=== 8. Configure nginx ==="
cp deploy/nginx.conf /etc/nginx/sites-available/epq-tutor
ln -sf /etc/nginx/sites-available/epq-tutor /etc/nginx/sites-enabled/epq-tutor
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Done. Upload frontend dist/ to /opt/epq-tutor/dist/ next. ==="
