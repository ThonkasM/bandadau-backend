<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http\Support;

use Bandada\Notification\InterfaceAdapters\Controllers\Http\Problem\ProblemException;
use Illuminate\Support\Facades\Lang;
use Illuminate\Support\Facades\Validator;

/** Wraps Laravel's validator and reports failures as VALIDATION_FAILED with per-field stable codes. */
final class RequestValidator
{
    private const array RULE_CODES = [
        'Required' => 'REQUIRED',
        'In' => 'INVALID_VALUE',
        'Uuid' => 'INVALID_FORMAT',
        'Date' => 'INVALID_FORMAT',
        'DateFormat' => 'INVALID_FORMAT',
        'Regex' => 'INVALID_FORMAT',
        'String' => 'INVALID_TYPE',
        'Integer' => 'INVALID_TYPE',
        'Boolean' => 'INVALID_TYPE',
        'Array' => 'INVALID_TYPE',
        'Min' => 'OUT_OF_RANGE',
        'Max' => 'OUT_OF_RANGE',
        'Between' => 'OUT_OF_RANGE',
        'Prohibited' => 'NOT_ALLOWED',
    ];

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $rules
     * @return array<string, mixed> validated data
     */
    public static function validate(array $data, array $rules): array
    {
        $validator = Validator::make($data, $rules);
        if (! $validator->fails()) {
            return $validator->validated();
        }
        $errors = [];
        foreach ($validator->failed() as $field => $failures) {
            $rule = (string) array_key_first($failures);
            $code = self::RULE_CODES[$rule] ?? 'INVALID';
            $errors[] = [
                'field' => $field,
                'pointer' => '/'.str_replace('.', '/', $field),
                'code' => $code,
                'message' => (string) Lang::get("validation_codes.{$code}", ['field' => $field]),
            ];
        }

        throw ProblemException::validation($errors);
    }
}
