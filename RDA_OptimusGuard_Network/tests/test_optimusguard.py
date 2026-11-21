import io
import json
import pathlib
import ssl
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'src'))
from optimusguard import DOMAINS, HOSTS, _NoRedirect, analyze_har, main, report, scan, test_host, write_csv


def _har(entries):
    return json.dumps({'log': {'entries': entries}})


def _entry(url, status=200, elapsed=10):
    return {'request': {'url': url, 'headers': [{'name': 'Cookie', 'value': 'SECRET'}]},
            'response': {'status': status, 'content': {'text': 'SECRET'}},
            'time': elapsed}


class Tests(unittest.TestCase):
    def test_domains(self):
        self.assertEqual(len(DOMAINS), 31)
        self.assertEqual(len(set(DOMAINS)), 31)
        self.assertEqual(len(HOSTS), 32)
        self.assertTrue(all('*' not in host for host in HOSTS))
        self.assertIn('ws.chatgpt.com', HOSTS)
        self.assertIn('chatgpt.com', HOSTS)

    def test_har_privacy(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = pathlib.Path(tmp) / 'test.har'
            file.write_text(_har([
                _entry('https://user:SECRET@chatgpt.com/private?token=SECRET#SECRET', 403, 45.678),
                _entry('ftp://chatgpt.com/SECRET'),
                'not-an-entry',
                {'request': {'url': 'https://oaistatic.com/a'}},
            ]), encoding='utf-8')
            result = analyze_har(file)
            self.assertEqual(result[0]['host'], 'chatgpt.com')
            self.assertEqual(result[0]['status'], 403)
            self.assertEqual(result[0]['error'], 'HTTP_ERROR')
            self.assertEqual(result[0]['duration_ms'], 45.7)
            self.assertEqual(result[1]['host'], 'oaistatic.com')
            self.assertEqual(result[1]['status'], 0)
            blob = str(result)
            self.assertNotIn('SECRET', blob)
            self.assertNotIn('/private', blob)
            self.assertNotIn('ftp', blob)

    def test_har_string_status_and_bom(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = pathlib.Path(tmp) / 'bom.har'
            file.write_bytes(b'\xef\xbb\xbf' + _har([_entry('wss://ws.chatgpt.com/backend', '101', 1)]).encode())
            result = analyze_har(file)
            self.assertEqual(result[0]['scheme'], 'wss')
            self.assertEqual(result[0]['status'], 101)
            self.assertEqual(result[0]['error'], '')

    def test_har_rejects_bad_shape_and_oversize(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = pathlib.Path(tmp) / 'bad.har'
            file.write_text('[]', encoding='utf-8')
            with self.assertRaises(ValueError):
                analyze_har(file)
            file.write_text('{"log":{"entries":{}}}', encoding='utf-8')
            with self.assertRaises(ValueError):
                analyze_har(file)
            file.write_text('{}', encoding='utf-8')
            with mock.patch.object(pathlib.Path, 'stat', return_value=mock.Mock(st_size=101 * 1024 * 1024)):
                with self.assertRaises(ValueError):
                    analyze_har(file)

    def test_redirect_handler_does_not_follow(self):
        handler = _NoRedirect()
        request = urllib.request.Request('https://chatgpt.com/', method='HEAD')
        headers = urllib.request.email.message_from_string('Location: https://evil.example/SECRET\r\n')
        with self.assertRaises(urllib.error.HTTPError) as caught:
            handler.http_error_302(request, None, 302, 'Found', headers)
        self.assertEqual(caught.exception.code, 302)
        self.assertNotIsInstance(caught.exception, urllib.request.Request)

    def test_dns_failure_stops_at_dns(self):
        with mock.patch('optimusguard._resolve', side_effect=TimeoutError('lookup SECRET')):
            result = test_host('chatgpt.com', timeout=0.2)
        self.assertEqual(result['dns'], 'FAIL')
        self.assertEqual(result['tcp443'], 'NOT_TESTED')
        self.assertEqual(result['tls'], 'NOT_TESTED')
        self.assertEqual(result['http'], 'NOT_TESTED')
        self.assertEqual(result['detail'], 'TimeoutError')
        self.assertNotIn('SECRET', str(result))

    def test_tcp_failure_is_fail(self):
        with mock.patch('optimusguard._resolve', return_value=['203.0.113.10']), \
             mock.patch('optimusguard.socket.create_connection', side_effect=TimeoutError()):
            result = test_host('chatgpt.com', timeout=0.2)
        self.assertEqual(result['dns'], 'OK')
        self.assertEqual(result['tcp443'], 'FAIL')
        self.assertEqual(result['tls'], 'NOT_TESTED')
        self.assertEqual(result['http'], 'NOT_TESTED')
        self.assertEqual(result['ip_count'], 1)

    def test_tls_failure_keeps_tcp_ok(self):
        connection = mock.Mock()
        with mock.patch('optimusguard._resolve', return_value=['203.0.113.10']), \
             mock.patch('optimusguard.socket.create_connection', return_value=connection), \
             mock.patch('optimusguard.ssl.SSLContext.wrap_socket', side_effect=ssl.SSLError('bad cert')):
            result = test_host('chatgpt.com', timeout=0.2)
        self.assertEqual(result['tcp443'], 'OK')
        self.assertEqual(result['tls'], 'FAIL')
        self.assertEqual(result['http'], 'NOT_TESTED')
        self.assertEqual(result['detail'], 'SSLError')
        connection.close.assert_called()

    def test_http_status_and_transport_error(self):
        connection = mock.Mock()
        tls = mock.Mock()
        opener = mock.Mock()
        opener.open.side_effect = urllib.error.HTTPError(
            'https://chatgpt.com/', 302, 'Found', hdrs=None, fp=None)
        with mock.patch('optimusguard._resolve', return_value=['203.0.113.10']), \
             mock.patch('optimusguard.socket.create_connection', return_value=connection), \
             mock.patch('optimusguard.ssl.SSLContext.wrap_socket', return_value=tls), \
             mock.patch('optimusguard.urllib.request.build_opener', return_value=opener) as build:
            redirect = test_host('chatgpt.com', timeout=0.2)
        self.assertIsInstance(build.call_args.args[0], _NoRedirect)
        self.assertEqual(redirect['tls'], 'OK')
        self.assertEqual(redirect['http'], '302')
        self.assertEqual(redirect['detail'], '')
        opened = opener.open.call_args.args[0]
        self.assertEqual(opened.get_method(), 'HEAD')
        self.assertEqual(opened.full_url, 'https://chatgpt.com/')

        opener.open.side_effect = urllib.error.URLError(TimeoutError('slow SECRET'))
        with mock.patch('optimusguard._resolve', return_value=['203.0.113.10']), \
             mock.patch('optimusguard.socket.create_connection', return_value=connection), \
             mock.patch('optimusguard.ssl.SSLContext.wrap_socket', return_value=tls), \
             mock.patch('optimusguard.urllib.request.build_opener', return_value=opener):
            broken = test_host('chatgpt.com', timeout=0.2)
        self.assertEqual(broken['http'], 'ERROR')
        self.assertEqual(broken['detail'], 'TimeoutError')
        self.assertNotIn('SECRET', str(broken))

    def test_scan_isolates_unexpected_errors(self):
        def fake(host):
            if host == 'bad.example':
                raise RuntimeError('boom SECRET')
            return {'host': host, 'dns': 'OK', 'tcp443': 'OK', 'tls': 'OK', 'http': '200', 'detail': '', 'ip_count': 1}

        with mock.patch('optimusguard.HOSTS', ['ok.example', 'bad.example']), \
             mock.patch('optimusguard.test_host', side_effect=fake):
            rows = scan(workers=2)
        self.assertEqual([row['host'] for row in rows], ['bad.example', 'ok.example'])
        self.assertEqual(rows[0]['dns'], 'FAIL')
        self.assertEqual(rows[0]['detail'], 'RuntimeError')
        self.assertNotIn('SECRET', str(rows))

    def test_report_lists_layer_failures_without_markup_break(self):
        text = report(
            [{'host': 'chat|gpt.com', 'dns': 'OK', 'tcp443': 'FAIL', 'tls': 'NOT_TESTED', 'http': 'NOT_TESTED', 'detail': 'TimeoutError', 'ip_count': 1},
             {'host': 'openai.com', 'dns': 'OK', 'tcp443': 'OK', 'tls': 'OK', 'http': '403', 'detail': '', 'ip_count': 2}],
            [{'host': 'chatgpt.com', 'scheme': 'https', 'status': 0, 'duration_ms': 1, 'error': 'NO_HTTP_STATUS'}],
            '2026-11-21',
        )
        self.assertIn('Hosts avaliados: 2', text)
        self.assertIn('Falhas DNS/TCP/TLS: 1', text)
        self.assertIn('chat/gpt.com', text)
        self.assertNotIn('chat|gpt.com', text)
        self.assertIn('403', text)
        self.assertIn('chatgpt.com', text)

    def test_csv_neutralizes_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'out.csv'
            write_csv(path, [{'host': '=cmd', 'dns': 'OK', 'note': None}])
            text = path.read_text(encoding='utf-8')
            self.assertIn("'=cmd", text)
            self.assertNotIn('\n=cmd', text)

    def test_main_writes_redacted_report(self):
        row = {'host': 'chatgpt.com', 'dns': 'OK', 'tcp443': 'FAIL', 'tls': 'NOT_TESTED', 'http': 'NOT_TESTED', 'detail': 'TimeoutError', 'ip_count': 1}
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp)
            har = out / 'sample.har'
            har.write_text(_har([_entry('https://chatgpt.com/path?token=SECRET', 500, 3)]), encoding='utf-8')
            with mock.patch('optimusguard.scan', return_value=[row]):
                main(['--scan', '--har', str(har), '--out', str(out), '--workers', '2'])
            latest = json.loads((out / 'latest.json').read_text(encoding='utf-8'))
            self.assertEqual(latest['network'][0]['tcp443'], 'FAIL')
            self.assertEqual(latest['har'][0]['status'], 500)
            self.assertNotIn('SECRET', json.dumps(latest))
            written = (out / 'report_').parent.glob('report_*.md')
            self.assertIn('chatgpt.com', next(written).read_text(encoding='utf-8'))
            with mock.patch('sys.stderr', new=io.StringIO()):
                with self.assertRaises(SystemExit):
                    main(['--scan', '--workers', '0'])


if __name__ == '__main__':
    unittest.main()
