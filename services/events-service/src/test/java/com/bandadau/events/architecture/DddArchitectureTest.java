package com.bandadau.events.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = "com.bandadau.events", importOptions = ImportOption.DoNotIncludeTests.class)
class DddArchitectureTest {

    @ArchTest
    static final ArchRule layers = layeredArchitecture().consideringOnlyDependenciesInLayers()
            .layer("Domain").definedBy("..domain..")
            .layer("Application").definedBy("..application..")
            .layer("Infrastructure").definedBy("..infrastructure..")
            .layer("Interfaces").definedBy("..interfaces..")
            .whereLayer("Interfaces").mayOnlyBeAccessedByLayers("Infrastructure")
            .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer()
            .whereLayer("Application").mayOnlyBeAccessedByLayers("Interfaces", "Infrastructure")
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Interfaces", "Infrastructure");

    @ArchTest
    static final ArchRule pureDomain = noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "jakarta..", "com.fasterxml..",
                    "tools.jackson..", "org.slf4j..", "org.hibernate..");

    @ArchTest
    static final ArchRule applicationHasNoFrameworkOrInfrastructure = noClasses().that().resideInAPackage("..application..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "jakarta..", "tools.jackson..",
                    "..infrastructure..", "..interfaces..", "com.rabbitmq..");

    @ArchTest
    static final ArchRule aggregatesReferenceOthersById = noClasses().that().resideInAPackage("..domain.registration..").and().haveSimpleNameNotEndingWith("Policy")
            .should().dependOnClassesThat().haveSimpleName("Event");

    @ArchTest
    static final ArchRule sagaKnowsNoOtherAggregate = noClasses().that().resideInAPackage("..domain.saga..")
            .should().dependOnClassesThat().haveFullyQualifiedName("com.bandadau.events.domain.event.Event")
            .orShould().dependOnClassesThat().haveFullyQualifiedName("com.bandadau.events.domain.registration.Registration");

    @ArchTest
    static final ArchRule repositoriesAreInterfacesInDomain = classes().that().haveSimpleNameEndingWith("Repository")
            .and().resideInAPackage("..domain..").should().beInterfaces();

    @ArchTest
    static final ArchRule controllersDoNotTouchPersistence = noClasses().that().resideInAPackage("..interfaces..")
            .should().dependOnClassesThat().resideInAnyPackage("..infrastructure.persistence..", "..infrastructure.messaging..");
}
