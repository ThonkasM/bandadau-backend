plugins {
    java
    id("org.springframework.boot") version "4.0.8"
}

group = "com.bandadau"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:4.0.8"))
    annotationProcessor(platform("org.springframework.boot:spring-boot-dependencies:4.0.8"))

    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.springframework.boot:spring-boot-starter-amqp")
    implementation("org.springframework.boot:spring-boot-starter-mail")
    runtimeOnly("org.postgresql:postgresql")
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testImplementation("org.testcontainers:testcontainers-rabbitmq")
    testImplementation("com.tngtech.archunit:archunit-junit5:1.5.1")
    testImplementation("org.awaitility:awaitility")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.test {
    useJUnitPlatform {
        excludeTags("integration")
    }
}

val integrationTest by tasks.registering(Test::class) {
    description = "Integration tests (Testcontainers: Postgres, RabbitMQ). Requires Docker."
    group = "verification"
    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = sourceSets["test"].runtimeClasspath
    useJUnitPlatform {
        includeTags("integration")
    }
    shouldRunAfter(tasks.test)
    maxHeapSize = "768m"
}

tasks.withType<Test> {
    maxHeapSize = "768m"
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = false
    }
}

tasks.bootJar {
    archiveFileName = "app.jar"
}
