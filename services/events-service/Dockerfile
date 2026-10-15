# syntax=docker/dockerfile:1
# events-service: multi-stage build, context = this folder. Java 25 (Temurin), Gradle, non-root runtime.

FROM gradle:9-jdk25 AS build
WORKDIR /workspace
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY src ./src
# SKIP_TESTS=false also runs unit + architecture tests (no Docker needed); integration tests: `make test-java`.
ARG SKIP_TESTS=true
RUN --mount=type=cache,target=/home/gradle/.gradle \
    if [ "$SKIP_TESTS" = "true" ]; then gradle --no-daemon -q bootJar -x test; else gradle --no-daemon -q build; fi

FROM eclipse-temurin:25-jre
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 bandada && useradd --system --uid 10001 --gid bandada --no-create-home bandada \
    && mkdir -p /app /data && chown -R bandada:bandada /app /data
WORKDIR /app
COPY --from=build --chown=bandada:bandada /workspace/build/libs/app.jar /app/app.jar
USER bandada
ENV PORT=7004 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+UseSerialGC -XX:+ExitOnOutOfMemoryError -Xss512k"
EXPOSE 7004
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD ["bash", "-c", "curl -fsS http://127.0.0.1:${PORT:-7004}/health/ready >/dev/null"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
