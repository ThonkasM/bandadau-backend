# syntax=docker/dockerfile:1.7
#
# One image, three roles (decision: a single image keeps one build per service and lets
# bandadau-infra declare `wallet-service` (web), `wallet-worker` and `wallet-relay` from it):
#   web     (default)       supervisord -> php-fpm + nginx on :7005, runs migrations first
#   worker                  php artisan bandada:consume   (SAGA commands consumer)
#   relay                   php artisan bandada:relay     (outbox -> RabbitMQ + housekeeping)
# Build context: this folder.   docker build -t wallet-service .

# ---------------------------------------------------------------- base: PHP 8.4 + extensions
FROM php:8.4-fpm-alpine AS base
COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_pgsql pcntl sockets bcmath opcache

# ---------------------------------------------------------------- dev: tooling image for tests/QA (code is mounted)
FROM base AS dev
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
RUN apk add --no-cache git unzip bash
WORKDIR /app

# ---------------------------------------------------------------- vendor: composer install --no-dev
FROM base AS vendor
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
RUN apk add --no-cache git unzip
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY app ./app
COPY src ./src
RUN composer dump-autoload --no-dev --classmap-authoritative --optimize

# ---------------------------------------------------------------- runtime
FROM base AS runtime
RUN apk add --no-cache nginx supervisor curl tini \
    && addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && mkdir -p /var/www/html /tmp/nginx \
    && rm -f /etc/nginx/http.d/default.conf
WORKDIR /var/www/html

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-bandada.ini
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-bandada.conf
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
COPY docker/healthcheck.sh /usr/local/bin/healthcheck
RUN chmod +x /usr/local/bin/entrypoint /usr/local/bin/healthcheck

COPY --from=vendor --chown=app:app /app/vendor ./vendor
COPY --chown=app:app artisan composer.json ./
COPY --chown=app:app app ./app
COPY --chown=app:app bootstrap ./bootstrap
COPY --chown=app:app config ./config
COPY --chown=app:app database ./database
COPY --chown=app:app lang ./lang
COPY --chown=app:app public ./public
COPY --chown=app:app routes ./routes
COPY --chown=app:app src ./src
RUN mkdir -p storage/framework/cache/data storage/framework/views storage/framework/sessions storage/logs bootstrap/cache \
    && chown -R app:app storage bootstrap/cache /tmp/nginx

USER app
RUN php artisan package:discover --ansi

ENV APP_ENV=production \
    APP_PORT=7005 \
    LOG_CHANNEL=stdout \
    CACHE_STORE=file
EXPOSE 7005
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 CMD ["healthcheck"]
ENTRYPOINT ["/sbin/tini", "--", "entrypoint"]
CMD ["web"]
