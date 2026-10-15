# events-service developer commands. Everything Java runs inside Docker (no local JDK/Gradle needed).
SHELL := /bin/bash
SVC := events-service
GRADLE_IMAGE ?= gradle:9-jdk25
CACHE_VOLUME ?= bandada-gradle-cache
DOCKER_RUN = docker run --rm --memory $(MEM) -v "$(CURDIR)":/app -w /app -v $(CACHE_VOLUME):/home/gradle/.gradle
MEM ?= 3g

.PHONY: test-unit test-java build image clean

## Unit + architecture tests (no Docker socket needed)
test-unit:
	$(DOCKER_RUN) $(GRADLE_IMAGE) gradle --no-daemon test

## Unit + architecture + Testcontainers integration tests (Postgres + RabbitMQ containers started through the host Docker)
test-java:
	$(DOCKER_RUN) -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
		$(GRADLE_IMAGE) gradle --no-daemon test integrationTest

## Executable jar in build/libs/app.jar
build:
	$(DOCKER_RUN) $(GRADLE_IMAGE) gradle --no-daemon bootJar

image:
	docker build -t bandada/$(SVC) .

clean:
	rm -rf build .gradle
