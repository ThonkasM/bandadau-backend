<!doctype html>
<html lang="{{ $lang }}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1c2733;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px;">
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:12px;">{{ $title }}</td></tr>
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:20px;">{{ $body }}</td></tr>
@if (! empty($link))
<tr><td style="padding-bottom:24px;"><a href="{{ $link }}" style="background:#1d6fd8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;">{{ $cta }}</a></td></tr>
@endif
<tr><td style="font-size:12px;color:#6b7785;line-height:1.4;">{{ $footer }}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
