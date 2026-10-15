<?php

return [
    'VALIDATION_FAILED' => ['title' => 'Datos inválidos', 'detail' => 'Uno o más campos no cumplen las reglas.'],
    'MALFORMED_REQUEST' => ['title' => 'Petición mal formada', 'detail' => 'El cuerpo de la petición no es un JSON válido.'],
    'INVALID_CURSOR' => ['title' => 'Cursor inválido', 'detail' => 'El cursor de paginación es inválido o fue manipulado.'],
    'IDEMPOTENCY_KEY_REQUIRED' => ['title' => 'Falta la clave de idempotencia', 'detail' => 'Esta operación requiere la cabecera Idempotency-Key.'],
    'IDEMPOTENCY_KEY_INVALID' => ['title' => 'Clave de idempotencia inválida', 'detail' => 'La cabecera Idempotency-Key debe ser un UUID.'],
    'UNAUTHORIZED' => ['title' => 'No autenticado', 'detail' => 'El token de acceso no es válido o expiró. Vuelve a iniciar sesión.'],
    'FORBIDDEN' => ['title' => 'Acceso denegado', 'detail' => 'No tienes permiso para realizar esta operación.'],
    'NOT_FOUND' => ['title' => 'Recurso no encontrado', 'detail' => 'El recurso solicitado no existe.'],
    'NOTIFICATION_NOT_FOUND' => ['title' => 'Notificación no encontrada', 'detail' => 'No existe una notificación con el identificador indicado.'],
    'METHOD_NOT_ALLOWED' => ['title' => 'Método no permitido', 'detail' => 'El método HTTP no está permitido para este recurso.'],
    'UNSUPPORTED_MEDIA_TYPE' => ['title' => 'Tipo de contenido no soportado', 'detail' => 'El tipo de contenido de la petición no es soportado.'],
    'CONFLICT' => ['title' => 'Conflicto', 'detail' => 'La operación entra en conflicto con el estado actual del recurso.'],
    'IDEMPOTENCY_IN_PROGRESS' => ['title' => 'Petición en curso', 'detail' => 'Ya se está procesando una petición con esta Idempotency-Key. Reintenta en unos segundos.'],
    'IDEMPOTENCY_KEY_REUSED' => ['title' => 'Clave de idempotencia reutilizada', 'detail' => 'La Idempotency-Key ya se usó con una petición diferente. Genera una clave nueva.'],
    'TYPE_NOT_MUTABLE' => ['title' => 'Tipo no silenciable', 'detail' => 'Las notificaciones de tipo :type no se pueden silenciar.'],
    'INVALID_DEVICE_TOKEN' => ['title' => 'Token de dispositivo inválido', 'detail' => 'El token del dispositivo debe tener entre 8 y 512 caracteres.'],
    'RATE_LIMITED' => ['title' => 'Demasiadas peticiones', 'detail' => 'Has hecho demasiadas peticiones. Intenta de nuevo más tarde.'],
    'INTERNAL_ERROR' => ['title' => 'Error interno', 'detail' => 'Ocurrió un error inesperado. Ya lo estamos revisando.'],
    'DEPENDENCY_UNAVAILABLE' => ['title' => 'Servicio no disponible', 'detail' => 'Una dependencia no está disponible en este momento. Intenta más tarde.'],
];
