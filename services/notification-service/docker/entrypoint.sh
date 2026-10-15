#!/bin/sh
# Roles: web (default) | worker | relay | any other command (infra runs `php artisan notifications:consume`).
set -e
cd /var/www/html
role="${1:-web}"

case "$role" in
    web)
        echo web > /tmp/bandada-role
        php artisan bandada:check-env
        mkdir -p /tmp/nginx/body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
        # DynamoDB tables are created by bandadau-infra: verify they exist and retry until they do.
        php artisan bandada:wait-for-schema
        exec supervisord -c /etc/supervisord.conf
        ;;
    worker)
        echo worker > /tmp/bandada-role
        php artisan bandada:check-env
        touch /tmp/bandada-heartbeat
        php artisan bandada:wait-for-schema
        exec php artisan notifications:consume
        ;;
    relay)
        echo relay > /tmp/bandada-role
        touch /tmp/bandada-heartbeat
        exec php artisan notifications:relay-outbox
        ;;
    *)
        exec "$@"
        ;;
esac
