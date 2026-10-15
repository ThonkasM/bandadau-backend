#!/bin/sh
# Roles: web (default) | worker | relay | any other command.
set -e
cd /var/www/html
role="${1:-web}"

fail_fast_env() {
    php artisan bandada:check-env
}

case "$role" in
    web)
        echo web > /tmp/bandada-role
        fail_fast_env
        mkdir -p /tmp/nginx/body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
        if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
            attempts=0
            until php artisan migrate --force --no-interaction; do
                attempts=$((attempts + 1))
                if [ "$attempts" -ge 30 ]; then
                    echo "database not reachable after $attempts attempts" >&2
                    exit 1
                fi
                echo "waiting for the database (attempt $attempts)..." >&2
                sleep 2
            done
        fi
        exec supervisord -c /etc/supervisord.conf
        ;;
    worker)
        echo worker > /tmp/bandada-role
        fail_fast_env
        touch /tmp/bandada-heartbeat
        php artisan bandada:wait-for-schema
        exec php artisan bandada:consume
        ;;
    relay)
        echo relay > /tmp/bandada-role
        fail_fast_env
        touch /tmp/bandada-heartbeat
        php artisan bandada:wait-for-schema
        exec php artisan bandada:relay
        ;;
    *)
        exec "$@"
        ;;
esac
