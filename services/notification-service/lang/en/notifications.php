<?php

// ICU MessageFormat. Avoid apostrophes (ICU quoting). Dates arrive pre-formatted as <name>Text (America/La_Paz).
return [
    'REGISTRATION_CONFIRMED' => ['title' => 'Registration confirmed!', 'body' => 'You now have your ticket for "{eventTitle}".'],
    'REGISTRATION_FAILED' => [
        'title' => 'We could not complete your registration',
        'body' => '{reason, select, INSUFFICIENT_FUNDS {Insufficient balance: top up credits to register for "{eventTitle}".} EVENT_FULL {"{eventTitle}" has no seats left.} other {We could not complete your registration for "{eventTitle}". You were not charged.}}',
    ],
    'REGISTRATION_CANCELLED' => ['title' => 'Registration cancelled', 'body' => 'Your registration for "{eventTitle}" was cancelled and {refundedCredits, number} credits were refunded.'],
    'EVENT_REMINDER' => ['title' => 'Event reminder', 'body' => '"{eventTitle}" starts on {startsAtText}. {venue}'],
    'EVENT_CANCELLED' => ['title' => 'Event cancelled', 'body' => 'Your event "{eventTitle}" was cancelled. Registrations affected: {confirmedRegistrations, number}.'],
    'NEW_EVENT' => ['title' => 'New event', 'body' => '"{eventTitle}" was published.'],
    'NEW_COMMENT' => ['title' => 'New comment', 'body' => 'Someone commented on your post.'],
    'NEW_REACTION' => ['title' => 'New reaction', 'body' => 'Someone reacted to your post.'],
    'NEW_FOLLOWER' => ['title' => 'New follower', 'body' => 'You have a new follower.'],
    'GROUP_REQUEST' => ['title' => 'Request to join the group', 'body' => 'Someone wants to join "{groupName}".'],
    'TOPUP_PAID' => ['title' => 'Top-up credited', 'body' => '{amountCredits, number} credits were added. Your balance is {balanceCredits, number}.'],
    'CONTENT_FLAGGED' => ['title' => 'Content hidden', 'body' => 'One of your items was hidden by moderation.'],
    'ALERT' => ['title' => 'Platform alert', 'body' => '{message}'],
    'WELCOME' => ['title' => 'Welcome to Bandada U!', 'body' => 'Your account is ready. Explore the events and communities of your university.'],
];
