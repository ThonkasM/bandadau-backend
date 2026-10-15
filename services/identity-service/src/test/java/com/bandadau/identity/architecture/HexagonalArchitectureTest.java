package com.bandadau.identity.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.library.Architectures;

@AnalyzeClasses(packages = "com.bandadau.identity", importOptions = ImportOption.DoNotIncludeTests.class)
class HexagonalArchitectureTest {

    @ArchTest
    static final ArchRule layers = Architectures.layeredArchitecture().consideringOnlyDependenciesInLayers()
            .layer("Domain").definedBy("..domain..")
            .layer("Application").definedBy("..application..")
            .layer("AdapterIn").definedBy("..adapter.in..")
            .layer("AdapterOut").definedBy("..adapter.out..")
            .layer("Config").definedBy("..config..")
            .whereLayer("Config").mayNotBeAccessedByAnyLayer()
            .whereLayer("AdapterIn").mayOnlyBeAccessedByLayers("Config")
            .whereLayer("AdapterOut").mayOnlyBeAccessedByLayers("Config")
            .whereLayer("Application").mayOnlyBeAccessedByLayers("AdapterIn", "AdapterOut", "Config")
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "AdapterIn", "AdapterOut", "Config");

    @ArchTest
    static final ArchRule domainIsFrameworkFree = noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "jakarta..", "org.hibernate..",
                    "com.fasterxml..", "tools.jackson..", "org.slf4j..");

    @ArchTest
    static final ArchRule applicationIsFrameworkFree = noClasses().that().resideInAPackage("..application..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework..", "jakarta..", "com.nimbusds..",
                    "tools.jackson..", "com.fasterxml..");

    @ArchTest
    static final ArchRule webAdaptersNeverTouchOutAdaptersOrServices = noClasses()
            .that().resideInAPackage("..adapter.in..")
            .should().dependOnClassesThat().resideInAnyPackage("..adapter.out..", "..application.service..");

    @ArchTest
    static final ArchRule outAdaptersNeverTouchInAdapters = noClasses()
            .that().resideInAPackage("..adapter.out..")
            .should().dependOnClassesThat().resideInAnyPackage("..adapter.in..", "..application.service..");

    @ArchTest
    static final ArchRule portsAreInterfaces = classes().that().resideInAnyPackage("..application.port.out..").and().areTopLevelClasses()
            .should().beInterfaces();

    @ArchTest
    static final ArchRule useCasesCarryNoSpringAnnotations = noClasses().that().resideInAPackage("..application.service..")
            .should().beAnnotatedWith("org.springframework.stereotype.Service")
            .orShould().beAnnotatedWith("org.springframework.stereotype.Component");
}
