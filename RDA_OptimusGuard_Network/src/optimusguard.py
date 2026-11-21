#!/usr/bin/env python3
"""RDA OptimusGuard: local, read-only network and HAR diagnostics (Python stdlib)."""
import argparse
import csv
import datetime as dt
import json
import pathlib
import socket
import ssl
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlsplit

DOMAINS = [
    '*.auth.openai.com','*.chatgpt.com','*.ct.sendgrid.net','*.intercom.io',
    '*.intercomcdn.com','*.oaistatic.com','*.oaiusercontent.com','*.openai.com',
    '*.oaistatsig.com','android.chat.openai.com','auth0.openai.com',
    'cdn.openaimerge.com','cdn.platform.openai.com','cdn.workos.com',
    'challenges.cloudflare.com','chat.openai.com','desktop.chat.openai.com',
    'forwarder.workos.com','frontend-apps-multi-region.workos.com',
    'humb.apple.com','images.workoscdn.com','ios.chat.openai.com',
    'js.intercomcdn.com','js.stripe.com','o207216.ingest.sentry.io',
    'o33249.ingest.sentry.io','rum.browser-intake-datadoghq.com',
    'setup.auth.openai.com','setup.workos.com','tcr9i.chat.openai.com',
    'workos.imgix.net'
]
# Apexes standing in for wildcard groups. They are samples, not full coverage.
REPRESENTATIVES = [
    'auth.openai.com','chatgpt.com','ct.sendgrid.net','intercom.io',
    'intercomcdn.com','oaistatic.com','oaiusercontent.com','openai.com',
    'oaistatsig.com'
]
HOSTS = sorted(set([x for x in DOMAINS if not x.startswith('*.')] + REPRESENTATIVES + ['ws.chatgpt.com']))
TIMEOUT = 3.0
USER_AGENT = 'RDA-OptimusGuard-Network-Diagnostic/1.0'
HAR_LIMIT = 100 * 1024 * 1024
_CSV_FORMULA = ('=', '+', '-', '@', '\t', '\r')


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Record 3xx as the host's own answer. Do not open the Location target."""

    def http_error_302(self, req, fp, code, msg, headers):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def _blank(host):
    return {
        'host': host,
        'dns': 'FAIL',
        'tcp443': 'NOT_TESTED',
        'tls': 'NOT_TESTED',
        'http': 'NOT_TESTED',
        'detail': '',
        'ip_count': 0,
    }


def _detail(exc):
    """Exception class name only. Messages can echo the URL."""
    if isinstance(exc, urllib.error.HTTPError):
        return type(exc).__name__
    if isinstance(exc, urllib.error.URLError) and exc.reason is not None and not isinstance(exc.reason, str):
        return type(exc.reason).__name__
    return type(exc).__name__


def _resolve(host, timeout):
    box = {}

    def run():
        try:
            infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            box['ips'] = sorted({item[4][0] for item in infos})
        except Exception as exc:
            box['error'] = exc

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise TimeoutError('DNS timeout')
    if 'error' in box:
        raise box['error']
    return box.get('ips', [])


def test_host(host, timeout=TIMEOUT):
    result = _blank(host)
    try:
        ips = _resolve(host, timeout)
    except (OSError, socket.gaierror, TimeoutError) as exc:
        result['detail'] = _detail(exc)
        return result
    if not ips:
        result['detail'] = 'NoAddress'
        return result
    result['dns'] = 'OK'
    result['ip_count'] = len(ips)

    try:
        conn = socket.create_connection((host, 443), timeout=timeout)
    except (OSError, TimeoutError) as exc:
        result['tcp443'] = 'FAIL'
        result['detail'] = _detail(exc)
        return result

    result['tcp443'] = 'OK'
    try:
        ctx = ssl.create_default_context()
        try:
            tls = ctx.wrap_socket(conn, server_hostname=host)
        except (OSError, ssl.SSLError, TimeoutError) as exc:
            result['tls'] = 'FAIL'
            result['detail'] = _detail(exc)
            return result
        result['tls'] = 'OK'
        try:
            tls.close()
        except OSError:
            pass
    finally:
        try:
            conn.close()
        except OSError:
            pass

    try:
        req = urllib.request.Request(
            'https://' + host + '/',
            method='HEAD',
            headers={'User-Agent': USER_AGENT},
        )
        opener = urllib.request.build_opener(_NoRedirect())
        with opener.open(req, timeout=timeout) as resp:
            result['http'] = str(resp.status)
    except urllib.error.HTTPError as exc:
        result['http'] = str(exc.code)
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        result['http'] = 'ERROR'
        result['detail'] = _detail(exc)
    return result


def scan(workers=6):
    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(test_host, host): host for host in HOSTS}
        for future in as_completed(futures):
            host = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:
                row = _blank(host)
                row['detail'] = _detail(exc)
                results.append(row)
    return sorted(results, key=lambda row: row['host'])


def _status(value):
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value if value >= 0 else 0
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return 0


def analyze_har(path):
    """Summarize a local HAR. Outputs keep host, scheme, status and duration only."""
    path = pathlib.Path(path)
    if path.stat().st_size > HAR_LIMIT:
        raise ValueError('HAR acima de 100 MiB: reduza o arquivo antes de analisar.')
    data = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict):
        raise ValueError('HAR inválido: a raiz deve ser um objeto JSON.')
    log = data.get('log')
    if not isinstance(log, dict):
        raise ValueError('HAR inválido: campo log ausente.')
    entries = log.get('entries', [])
    if not isinstance(entries, list):
        raise ValueError('HAR inválido: entries deve ser uma lista.')

    rows = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        request = entry.get('request')
        if not isinstance(request, dict):
            continue
        url = request.get('url', '')
        if not isinstance(url, str) or not url:
            continue
        parsed = urlsplit(url)
        scheme = parsed.scheme.lower()
        if scheme not in ('https', 'http', 'wss', 'ws') or not parsed.hostname:
            continue
        response = entry.get('response')
        response = response if isinstance(response, dict) else {}
        status = _status(response.get('status', 0))
        elapsed = entry.get('time', -1)
        elapsed = round(elapsed, 1) if isinstance(elapsed, (float, int)) and not isinstance(elapsed, bool) and elapsed >= 0 else None
        if status == 0:
            error = 'NO_HTTP_STATUS'
        elif status >= 400:
            error = 'HTTP_ERROR'
        else:
            error = ''
        rows.append({
            'host': parsed.hostname.lower(),
            'scheme': scheme,
            'status': status,
            'duration_ms': elapsed,
            'error': error,
        })
    return rows


def _csv_cell(value):
    if value is None:
        return ''
    text = str(value)
    if text[:1] in _CSV_FORMULA:
        return "'" + text
    return text


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    fieldnames = list(rows[0])
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _csv_cell(row.get(key)) for key in fieldnames})


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def _cell(value):
    return str(value if value is not None else '').replace('|', '/').replace('\n', ' ').replace('\r', ' ')


def _http_code(value):
    return int(value) if isinstance(value, str) and value.isdigit() else None


def report(rows, har_rows, ts):
    failures = [row for row in rows if row.get('dns') == 'FAIL' or row.get('tcp443') == 'FAIL' or row.get('tls') == 'FAIL']
    http_errors = [row for row in rows if row.get('http') == 'ERROR']
    http_status = [row for row in rows if (_http_code(row.get('http')) or 0) >= 400]
    har_issues = [row for row in har_rows if row.get('status', 0) == 0 or row.get('status', 0) >= 400]
    wildcards = [domain for domain in DOMAINS if domain.startswith('*.')]
    lines = [
        '# RDA OptimusGuard — Relatório de diagnóstico',
        '',
        f'Gerado (UTC): {ts}',
        '',
        '## Limitações',
        '',
        '- Verificação executada somente a partir da máquina em que este programa foi rodado.',
        '- Acesso HTTP 401/403/404 isoladamente não comprova bloqueio de rede.',
        '- Redirecionamentos HTTP não são seguidos: um status 3xx significa que o host respondeu.',
        '- Hosts representativos não verificam todos os subdomínios cobertos por curingas: ' + ', '.join(wildcards) + '.',
        '- A porta UDP 3478 e a negociação WebSocket não são testadas por este programa.',
        '- A análise HAR não exporta URLs completas nem credenciais.',
        '',
        '## Sumário',
        '',
        f'- Hosts avaliados: {len(rows)}',
        f'- Falhas DNS/TCP/TLS: {len(failures)}',
        f'- Respostas HTTP >= 400: {len(http_status)} (requer interpretação)',
        f'- Erros de transporte HTTP: {len(http_errors)}',
        f'- Entradas HAR analisadas: {len(har_rows)}',
        f'- Entradas HAR com status 0 ou >= 400: {len(har_issues)}',
        '',
        '## Falhas DNS/TCP/TLS',
        '',
    ]
    if failures:
        lines += ['| Host | DNS | TCP 443 | TLS | Detalhe |', '|---|---|---|---|---|']
        for row in failures:
            lines.append('| ' + ' | '.join(_cell(row.get(key, '')) for key in ('host', 'dns', 'tcp443', 'tls', 'detail')) + ' |')
    else:
        lines.append('Nenhuma falha identificada nos hosts testados (ou exame não executado).')

    lines += ['', '## HTTP', '']
    http_rows = http_status + http_errors
    if http_rows:
        lines += ['| Host | HTTP | Detalhe |', '|---|---|---|']
        for row in http_rows:
            lines.append('| ' + ' | '.join(_cell(row.get(key, '')) for key in ('host', 'http', 'detail')) + ' |')
    else:
        lines.append('Nenhuma resposta HTTP >= 400 ou erro de transporte (ou exame não executado).')

    lines += ['', '## HAR com status 0 ou >= 400', '']
    if har_issues:
        groups = {}
        for row in har_issues:
            key = (row.get('host', ''), row.get('scheme', ''), row.get('status', 0))
            groups[key] = groups.get(key, 0) + 1
        lines += ['| Host | Esquema | Status | Ocorrências |', '|---|---|---|---|']
        ordered = sorted(groups.items(), key=lambda item: (-item[1], item[0][0], item[0][2]))
        for (host, scheme, status), count in ordered[:40]:
            lines.append(f'| {_cell(host)} | {_cell(scheme)} | {_cell(status)} | {count} |')
        if len(ordered) > 40:
            lines.append('')
            lines.append(f'Outros grupos omitidos neste resumo: {len(ordered) - 40}. O CSV contém todas as entradas.')
    else:
        lines.append('Nenhuma entrada HAR com status 0 ou >= 400 (ou HAR não analisado).')

    lines += [
        '',
        '## Recomendações',
        '',
        'Comparar os mesmos testes por Wi-Fi e hotspot móvel, com horário e dispositivo registrados.',
        'Investigar erros recorrentes por hostname e camada antes de solicitar alterações de firewall.',
        'Não enviar HAR bruto ou dados de sessão ao provedor sem revisão e autorização.',
        '',
    ]
    return '\n'.join(lines)


def _failure_count(rows):
    return sum(1 for row in rows if row['dns'] == 'FAIL' or row['tcp443'] == 'FAIL' or row['tls'] == 'FAIL')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Diagnóstico local de conectividade e HAR — sem dependências.')
    parser.add_argument('--scan', action='store_true', help='Verificar DNS, TCP 443, TLS e HTTP HEAD')
    parser.add_argument('--har', type=pathlib.Path, help='Analisar arquivo HAR local, omitindo dados sensíveis das saídas')
    parser.add_argument('--out', type=pathlib.Path, default=pathlib.Path('reports'))
    parser.add_argument('--workers', type=int, default=6, help='Consultas simultâneas (1 a 32)')
    args = parser.parse_args(argv)
    if not args.scan and not args.har:
        parser.error('Informe --scan e/ou --har')
    if not 1 <= args.workers <= 32:
        parser.error('--workers deve estar entre 1 e 32')

    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d_%H%M%S')
    rows = scan(workers=args.workers) if args.scan else []
    har_rows = analyze_har(args.har) if args.har else []
    if rows:
        write_csv(args.out / f'network_{stamp}.csv', rows)
    if har_rows:
        write_csv(args.out / f'har_summary_{stamp}.csv', har_rows)
    generated = now()
    payload = {
        'generated_utc': generated,
        'network': rows,
        'har': har_rows,
        'note': 'Resumo sem URLs completas, tokens, cookies ou cabeçalhos',
    }
    write_json(args.out / 'latest.json', payload)
    (args.out / f'report_{stamp}.md').write_text(report(rows, har_rows, generated), encoding='utf-8')
    print(f'Diagnóstico concluído. Arquivos em: {args.out.resolve()}')
    print(f'Hosts testados: {len(rows)} | Falhas DNS/TCP/TLS: {_failure_count(rows)} | Entradas HAR: {len(har_rows)}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f'Erro: {exc}', file=sys.stderr)
        sys.exit(1)
