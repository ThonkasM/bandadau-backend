<?php

// ICU MessageFormat. Avoid apostrophes (ICU quoting). Dates arrive pre-formatted as <name>Text (America/La_Paz).
return [
    'REGISTRATION_CONFIRMED' => ['title' => '¡Inscripción confirmada!', 'body' => 'Ya tienes tu entrada para «{eventTitle}».'],
    'REGISTRATION_FAILED' => [
        'title' => 'No pudimos completar tu inscripción',
        'body' => '{reason, select, INSUFFICIENT_FUNDS {Saldo insuficiente: recarga créditos para inscribirte a «{eventTitle}».} EVENT_FULL {«{eventTitle}» ya no tiene cupos.} other {No se pudo completar tu inscripción a «{eventTitle}». No se te cobró nada.}}',
    ],
    'REGISTRATION_CANCELLED' => ['title' => 'Inscripción cancelada', 'body' => 'Tu inscripción a «{eventTitle}» fue cancelada y se reembolsaron {refundedCredits, number} créditos.'],
    'EVENT_REMINDER' => ['title' => 'Recordatorio de evento', 'body' => '«{eventTitle}» empieza el {startsAtText}. {venue}'],
    'EVENT_CANCELLED' => ['title' => 'Evento cancelado', 'body' => 'Tu evento «{eventTitle}» fue cancelado. Inscripciones afectadas: {confirmedRegistrations, number}.'],
    'NEW_EVENT' => ['title' => 'Nuevo evento', 'body' => '«{eventTitle}» fue publicado.'],
    'NEW_COMMENT' => ['title' => 'Nuevo comentario', 'body' => 'Alguien comentó tu publicación.'],
    'NEW_REACTION' => ['title' => 'Nueva reacción', 'body' => 'Alguien reaccionó a tu publicación.'],
    'NEW_FOLLOWER' => ['title' => 'Nuevo seguidor', 'body' => 'Tienes un nuevo seguidor.'],
    'GROUP_REQUEST' => ['title' => 'Solicitud para unirse al grupo', 'body' => 'Alguien quiere unirse a «{groupName}».'],
    'TOPUP_PAID' => ['title' => 'Recarga acreditada', 'body' => 'Se acreditaron {amountCredits, number} créditos. Tu saldo es {balanceCredits, number}.'],
    'CONTENT_FLAGGED' => ['title' => 'Contenido ocultado', 'body' => 'Uno de tus contenidos fue ocultado por moderación.'],
    'ALERT' => ['title' => 'Alerta de la plataforma', 'body' => '{message}'],
    'WELCOME' => ['title' => '¡Bienvenido a Bandada U!', 'body' => 'Tu cuenta está lista. Explora los eventos y las comunidades de tu universidad.'],
];
