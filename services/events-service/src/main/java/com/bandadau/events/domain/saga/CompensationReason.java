package com.bandadau.events.domain.saga;

/** Why a void-ticket / refund-credits command is sent (AsyncAPI enum). */
public enum CompensationReason { SAGA_COMPENSATION, USER_CANCELLATION, EVENT_CANCELLED }
