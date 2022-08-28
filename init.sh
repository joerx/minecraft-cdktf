#!/bin/bash

rpm --import https://yum.corretto.aws/corretto.key
curl -L -o /etc/yum.repos.d/corretto.repo https://yum.corretto.aws/corretto.repo
yum install -y java-17-amazon-corretto-devel.x86_64

adduser minecraft
mkdir -p /opt/minecraft/server
cd /opt/minecraft/server

wget "${downloadUrl}"
cat <<- EOF > /etc/systemd/system/minecraft.service 
[Unit]
Description=Minecraft Server
After=network.target

[Service]
User=minecraft
Nice=5
KillMode=none
SuccessExitStatus=0 1
InaccessibleDirectories=/root /sys /srv /media -/lost+found
NoNewPrivileges=true
WorkingDirectory=/opt/minecraft/server
ReadWriteDirectories=/opt/minecraft/server
ExecStart=/usr/bin/java -Xmx1024M -Xms1024M -jar server.jar nogui

[Install]
WantedBy=multi-user.target
EOF

echo "eula=true" > /opt/minecraft/server/eula.txt
chown -R minecraft:minecraft /opt/minecraft/
chmod 664 /etc/systemd/system/minecraft.service

systemctl daemon-reload
systemctl enable minecraft
systemctl start minecraft
