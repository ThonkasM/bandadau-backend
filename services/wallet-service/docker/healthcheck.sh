#!/bin/sh
role="$(cat /tmp/bandada-role 2>/dev/null || echo web)"
if [ "$role" = "web" ]; then
    curl -fsS --max-time 4 "http://127.0.0.1:${APP_PORT:-7005}/health/ready" >/dev/null
else
    # workers touch the heartbeat file on every loop iteration (<= ~30 s)
    [ -n "$(find /tmp/bandada-heartbeat -mmin -2 2>/dev/null)" ]
fi
